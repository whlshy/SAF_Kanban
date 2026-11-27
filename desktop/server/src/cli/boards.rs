//! Board lookup and management (`new-board`, `edit-board`, `delete-board`,
//! `import`, `export`) shared across local boards and Google Sheet boards.

use std::collections::HashSet;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::mcp;
use crate::model::SheetBoard;
use crate::sheet;
use crate::store::{
    normalize_script_id, normalize_sheet_id, unique_title, NewBoard, SheetBoardPatch, Store,
    DEFAULT_SHEET_BOARD_ID,
};
use crate::transfer::{
    decrypt_text, export_local_board_json, export_sheets_json, parse_import_file,
    safe_filename_part, today_ymd, ImportedFile,
};

use super::args::{list, read_file_text, Args};
use super::format::{show_board_info, text};
use super::{pretty, usage, Failure};

/// A resolved board: either a local board file or a Google Sheet board entry.
pub(super) enum BoardRef {
    Local(String),
    Sheet(SheetBoard),
}

pub(super) fn sheet_summary(board: &SheetBoard) -> Value {
    json!({
        "id": board.id,
        "type": "sheet",
        "title": sheet::board_title_display(board),
        "sheetId": board.sheet_id,
        "hasScript": !board.script_id.trim().is_empty(),
        "userKey": board.user_key,
        "issueLink": board.jira_link,
    })
}

/// Lists all boards (local first, then Google Sheet), never exposing `scriptId`.
pub(super) fn list_all_boards(store: &Store) -> Result<Vec<Value>, Failure> {
    let local = mcp::run(store, "list_boards", &json!({}))?;
    let mut all: Vec<Value> = local
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|mut item| {
            if let Some(obj) = item.as_object_mut() {
                obj.insert("type".to_string(), json!("local"));
            }
            item
        })
        .collect();
    let sheets = store
        .list_sheets()
        .map_err(|error| Failure::Failed(format!("{} ({})", error.message, error.code)))?;
    all.extend(sheets.iter().map(sheet_summary));
    Ok(all)
}

/// Resolves `<board>` by id, then exact title, then case-insensitive title,
/// searching both local boards and Google Sheet boards.
pub(super) fn find_board(store: &Store, reference: &str) -> Result<BoardRef, Failure> {
    let local_val = mcp::run(store, "list_boards", &json!({}))?;
    let local = local_val.as_array().cloned().unwrap_or_default();
    let sheets = store
        .list_sheets()
        .map_err(|error| Failure::Failed(format!("{} ({})", error.message, error.code)))?;

    if local.iter().any(|board| board["id"] == reference) {
        return Ok(BoardRef::Local(reference.to_string()));
    }
    if let Some(found) = sheets.iter().find(|board| board.id == reference) {
        return Ok(BoardRef::Sheet(found.clone()));
    }

    let wanted = reference.trim();
    let mut matches: Vec<(String, BoardRef)> = Vec::new();
    for exact in [true, false] {
        for board in &local {
            let title = board["title"].as_str().unwrap_or("").trim();
            let hit = if exact {
                title == wanted
            } else {
                title.to_lowercase() == wanted.to_lowercase()
            };
            if hit {
                let id = board["id"].as_str().unwrap_or("").to_string();
                matches.push((id.clone(), BoardRef::Local(id)));
            }
        }
        for board in &sheets {
            let title = sheet::board_title_display(board);
            let hit = if exact {
                title == wanted
            } else {
                title.to_lowercase() == wanted.to_lowercase()
            };
            if hit {
                matches.push((board.id.clone(), BoardRef::Sheet(board.clone())));
            }
        }
        if !matches.is_empty() {
            break;
        }
    }

    match matches.len() {
        1 => Ok(matches.remove(0).1),
        0 => {
            let mut known: Vec<String> = local
                .iter()
                .map(|b| format!("{} [{}]", text(&b["title"]), text(&b["id"])))
                .collect();
            known.extend(
                sheets
                    .iter()
                    .map(|b| format!("{} [{}]", sheet::board_title_display(b), b.id)),
            );
            Err(Failure::Failed(if known.is_empty() {
                format!("There is no board `{reference}`; there are no boards yet.")
            } else {
                format!(
                    "There is no board `{reference}`. The boards are: {}.",
                    known.join(", ")
                )
            }))
        }
        _ => {
            let ids: Vec<String> = matches.into_iter().map(|(id, _)| id).collect();
            Err(Failure::Failed(format!(
                "Several boards are named `{reference}`; give one of their ids instead: {}.",
                ids.join(", ")
            )))
        }
    }
}

fn taken_titles(store: &Store) -> Result<HashSet<String>, Failure> {
    let mut set = HashSet::new();
    for board in list_all_boards(store)? {
        let title = text(&board["title"]).trim();
        if !title.is_empty() {
            set.insert(title.to_string());
        }
    }
    Ok(set)
}

fn parse_label_defs_arg(raw: &str) -> Result<Value, Failure> {
    let mut defs = Vec::new();
    for item in raw.split(',') {
        let entry = item.trim();
        if entry.is_empty() {
            continue;
        }
        let (name, color) = match entry.rsplit_once(':') {
            Some((left, right)) if !left.trim().is_empty() => (left.trim(), right.trim()),
            _ => (entry, ""),
        };
        if name.is_empty() {
            continue;
        }
        defs.push(json!({ "name": name, "color": color }));
    }
    Ok(Value::Array(defs))
}

pub(super) fn cmd_new_board(store: &Store, args: &Args) -> Result<String, Failure> {
    args.expect(
        &["name"],
        &[
            "columns",
            "users",
            "labels",
            "issue-link",
            "sheet",
            "script",
            "user",
        ],
    )?;
    let shown = |value: Value, plain: String| if args.json { pretty(&value) } else { plain };
    let is_sheet = args.option("sheet").is_some() || args.option("script").is_some();

    if is_sheet {
        if args.option("columns").is_some()
            || args.option("users").is_some()
            || args.option("labels").is_some()
        {
            return Err(usage(
                "Google Sheet boards manage columns, assignees and labels in the spreadsheet's `columns`, `users` and `labels` tabs; omit --columns, --users and --labels.",
            ));
        }
        let raw_script = args.option("script").ok_or_else(|| {
            usage("A Google Sheet board requires --script <URL or ID> (Apps Script v5+).")
        })?;
        let script_id = normalize_script_id(raw_script);
        let mut sheet_id = args
            .option("sheet")
            .map(normalize_sheet_id)
            .unwrap_or_default();

        let info = sheet::check_info(&script_id, &sheet_id).map_err(Failure::Failed)?;
        if sheet_id.is_empty() {
            sheet_id = info.id;
        }
        let taken = taken_titles(store)?;
        let title = unique_title(&args.words[0], &taken, "SAF Kanban");
        let created = store
            .add_sheet(SheetBoard {
                id: String::new(),
                title,
                sheet_id,
                script_id,
                user_key: args.option("user").unwrap_or("").to_string(),
                jira_link: args.option("issue-link").unwrap_or("").to_string(),
            })
            .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
        let view = sheet_summary(&created);
        return Ok(shown(view.clone(), show_board_info("Created", &view)));
    }

    if args.option("user").is_some() {
        return Err(usage(
            "`--user` is only for Google Sheet boards (use `--users` for local boards).",
        ));
    }
    let mut arguments = json!({ "title": args.words[0] });
    if let Some(columns) = args.option("columns") {
        arguments["columns"] = list(columns);
    }
    if let Some(users) = args.option("users") {
        arguments["users"] = list(users);
    }
    if let Some(labels) = args.option("labels") {
        arguments["labels"] = parse_label_defs_arg(labels)?;
    }
    if let Some(link) = args.option("issue-link") {
        arguments["issueLink"] = json!(link);
    }
    let created = mcp::run(store, "create_board", &arguments)?;
    Ok(shown(created.clone(), show_board_info("Created", &created)))
}

pub(super) fn cmd_edit_board(store: &Store, args: &Args) -> Result<String, Failure> {
    args.expect(
        &["board"],
        &[
            "name",
            "columns",
            "rename",
            "users",
            "labels",
            "rename-label",
            "issue-link",
            "sheet",
            "script",
            "user",
        ],
    )?;
    if args.options.is_empty() {
        return Err(usage("Say what to change, e.g. --name \"New name\"."));
    }
    let shown = |value: Value, plain: String| if args.json { pretty(&value) } else { plain };

    match find_board(store, &args.words[0])? {
        BoardRef::Sheet(existing) => {
            if args.option("columns").is_some()
                || args.option("users").is_some()
                || args.option("labels").is_some()
                || !args.all("rename").is_empty()
                || !args.all("rename-label").is_empty()
            {
                return Err(Failure::Failed(
                    "Google Sheet boards manage columns, assignees and labels in the spreadsheet's `columns`, `users` and `labels` tabs."
                        .to_string(),
                ));
            }
            let new_sheet_id = args
                .option("sheet")
                .map(normalize_sheet_id)
                .unwrap_or_else(|| existing.sheet_id.clone());
            let new_script_id = args
                .option("script")
                .map(normalize_script_id)
                .unwrap_or_else(|| existing.script_id.clone());
            if (args.option("sheet").is_some() || args.option("script").is_some())
                && !new_script_id.is_empty()
            {
                sheet::check_info(&new_script_id, &new_sheet_id).map_err(Failure::Failed)?;
            }
            let patch = SheetBoardPatch {
                title: args.option("name").map(str::to_string),
                sheet_id: args.option("sheet").map(str::to_string),
                script_id: args.option("script").map(str::to_string),
                user_key: args.option("user").map(str::to_string),
                jira_link: args.option("issue-link").map(str::to_string),
            };
            let updated = store
                .update_sheet(&existing.id, patch)
                .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
            let view = sheet_summary(&updated);
            Ok(shown(view.clone(), show_board_info("Updated", &view)))
        }
        BoardRef::Local(board_id) => {
            if args.option("sheet").is_some()
                || args.option("script").is_some()
                || args.option("user").is_some()
            {
                return Err(usage(
                    "`--sheet`, `--script` and `--user` are only for Google Sheet boards.",
                ));
            }
            let mut arguments = json!({ "board": board_id });
            if let Some(name) = args.option("name") {
                arguments["title"] = json!(name);
            }
            if let Some(columns) = args.option("columns") {
                arguments["columns"] = list(columns);
            }
            if let Some(users) = args.option("users") {
                arguments["users"] = list(users);
            }
            if let Some(labels) = args.option("labels") {
                arguments["labels"] = parse_label_defs_arg(labels)?;
            }
            if let Some(link) = args.option("issue-link") {
                arguments["issueLink"] = json!(link);
            }
            let mut renames = Map::new();
            for rename in args.all("rename") {
                let (from, to) = rename
                    .split_once('=')
                    .ok_or_else(|| usage("--rename takes OLD=NEW."))?;
                renames.insert(from.trim().to_string(), json!(to.trim()));
            }
            if !renames.is_empty() {
                arguments["renameColumns"] = Value::Object(renames);
            }
            let mut label_renames = Map::new();
            for rename in args.all("rename-label") {
                let (from, to) = rename
                    .split_once('=')
                    .ok_or_else(|| usage("--rename-label takes OLD=NEW."))?;
                label_renames.insert(from.trim().to_string(), json!(to.trim()));
            }
            if !label_renames.is_empty() {
                arguments["renameLabels"] = Value::Object(label_renames);
            }
            let updated = mcp::run(store, "update_board", &arguments)?;
            Ok(shown(updated.clone(), show_board_info("Updated", &updated)))
        }
    }
}

pub(super) fn cmd_delete_board(store: &Store, args: &Args) -> Result<String, Failure> {
    args.expect(&["board"], &[])?;
    let shown = |value: Value, plain: String| if args.json { pretty(&value) } else { plain };

    match find_board(store, &args.words[0])? {
        BoardRef::Local(board_id) => {
            let board = store
                .get_board(&board_id)
                .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
            store
                .delete_board(&board_id)
                .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
            let result = json!({
                "deleted": true,
                "type": "local",
                "id": board.id,
                "title": board.title,
            });
            Ok(shown(
                result,
                format!(
                    "Deleted local board [{}] {} (moved to the trash folder).",
                    board.id, board.title
                ),
            ))
        }
        BoardRef::Sheet(board) => {
            let removed = store
                .delete_sheet(&board.id)
                .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
            let title = sheet::board_title_display(&removed);
            let result = json!({
                "deleted": true,
                "type": "sheet",
                "id": removed.id,
                "title": title,
            });
            Ok(shown(
                result,
                format!(
                    "Removed Google Sheet board [{}] {} from SAF Kanban (the Google Sheet itself was not deleted).",
                    removed.id, title
                ),
            ))
        }
    }
}

pub(super) fn cmd_import(store: &Store, args: &Args) -> Result<String, Failure> {
    args.expect(&["file"], &["password"])?;
    let shown = |value: Value, plain: String| if args.json { pretty(&value) } else { plain };
    let raw_text = read_file_text(&args.words[0], "the import file")?;
    let parsed = match parse_import_file(&raw_text).map_err(Failure::Failed)? {
        ImportedFile::Encrypted { encryption, data } => {
            let password = args
                .option("password")
                .map(str::to_string)
                .or_else(|| std::env::var("SAF_KANBAN_PASSWORD").ok().filter(|v| !v.is_empty()))
                .ok_or_else(|| {
                    Failure::Failed(
                        "This export file is password-protected. Pass `--password <PASSWORD>` (or set `SAF_KANBAN_PASSWORD`)."
                            .to_string(),
                    )
                })?;
            let decrypted = decrypt_text(&encryption, &data, &password).map_err(Failure::Failed)?;
            parse_import_file(&decrypted).map_err(Failure::Failed)?
        }
        other => other,
    };

    match parsed {
        ImportedFile::LocalBoard(board) => {
            let taken = taken_titles(store)?;
            let title = unique_title(&board.title, &taken, "Untitled board");
            let created = store
                .create_board(NewBoard {
                    title,
                    issue_link: board.issue_link,
                    columns: Some(board.columns),
                    users: board.users,
                    labels: board.labels,
                    tasks: board.tasks,
                    history: board.history,
                })
                .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
            let value = json!({
                "imported": "local",
                "board": created,
            });
            Ok(shown(
                value,
                format!(
                    "Imported local board [{}] {} ({} task{}).",
                    created.id,
                    created.title,
                    created.task_count,
                    if created.task_count == 1 { "" } else { "s" }
                ),
            ))
        }
        ImportedFile::Sheets(sheets) => {
            let mut taken = taken_titles(store)?;
            let existing_count = store
                .list_sheets()
                .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?
                .len();
            let mut added = Vec::new();
            for (idx, mut item) in sheets.into_iter().enumerate() {
                let fallback = if existing_count == 0 && idx == 0 {
                    "SAF Kanban"
                } else {
                    "Untitled board"
                };
                let title = unique_title(&item.title, &taken, fallback);
                let display = if title.is_empty() {
                    fallback.to_string()
                } else {
                    title.clone()
                };
                taken.insert(display);
                item.title = title;
                item.id = if existing_count == 0 && idx == 0 {
                    DEFAULT_SHEET_BOARD_ID.to_string()
                } else {
                    String::new()
                };
                let saved = store
                    .add_sheet(item)
                    .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
                added.push(sheet_summary(&saved));
            }
            let lines: Vec<String> = added
                .iter()
                .map(|b| format!("  [{}] {}", text(&b["id"]), text(&b["title"])))
                .collect();
            let value = json!({
                "imported": "sheets",
                "boards": added,
            });
            Ok(shown(
                value,
                format!(
                    "Imported {} Google Sheet board{}:\n{}",
                    lines.len(),
                    if lines.len() == 1 { "" } else { "s" },
                    lines.join("\n")
                ),
            ))
        }
        ImportedFile::Encrypted { .. } => Err(Failure::Failed(
            "Nested encrypted files are not supported.".to_string(),
        )),
    }
}

pub(super) fn cmd_export(store: &Store, args: &Args) -> Result<String, Failure> {
    args.expect_options(&["out", "password"])?;
    let shown = |value: Value, plain: String| if args.json { pretty(&value) } else { plain };
    let password = args.option("password");

    // Determine what to export:
    // - No board names, or `--sheets`: Google Sheet boards settings export.
    // - Single local board name (without `--sheets`): local board file export.
    // - One or more Google Sheet board names: Google Sheet settings export.
    let (json_text, default_name, summary) = if args.words.is_empty() {
        let sheets = store
            .list_sheets()
            .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
        let text = export_sheets_json(&sheets, password).map_err(Failure::Failed)?;
        let suffix = if password.is_some() { "-encrypted" } else { "" };
        let name = format!("saf-kanban-settings-{}{suffix}.json", today_ymd());
        let summary = format!(
            "Exported {} Google Sheet board{}",
            sheets.len(),
            if sheets.len() == 1 { "" } else { "s" }
        );
        (text, name, summary)
    } else if !args.sheets && args.words.len() == 1 {
        match find_board(store, &args.words[0])? {
            BoardRef::Local(id) => {
                if password.is_some() {
                    return Err(usage(
                        "`--password` is only for Google Sheet settings exports, not single local board exports.",
                    ));
                }
                let board = store
                    .get_board(&id)
                    .map_err(|e| Failure::Failed(format!("{} ({})", e.message, e.code)))?;
                let text = export_local_board_json(&board).map_err(Failure::Failed)?;
                let name = format!(
                    "saf-kanban-board-{}-{}.json",
                    safe_filename_part(&board.title),
                    today_ymd()
                );
                let summary = format!("Exported local board [{}] {}", board.id, board.title);
                (text, name, summary)
            }
            BoardRef::Sheet(sheet_board) => {
                let text = export_sheets_json(std::slice::from_ref(&sheet_board), password)
                    .map_err(Failure::Failed)?;
                let suffix = if password.is_some() { "-encrypted" } else { "" };
                let name = format!("saf-kanban-settings-{}{suffix}.json", today_ymd());
                let summary = format!(
                    "Exported Google Sheet board [{}] {}",
                    sheet_board.id,
                    sheet::board_title_display(&sheet_board)
                );
                (text, name, summary)
            }
        }
    } else {
        let mut chosen = Vec::new();
        for reference in &args.words {
            match find_board(store, reference)? {
                BoardRef::Sheet(sheet_board) => chosen.push(sheet_board),
                BoardRef::Local(id) => {
                    return Err(usage(format!(
                        "Board `{id}` is a local board. Export local boards one at a time (`export {id}`), or pass only Google Sheet boards."
                    )));
                }
            }
        }
        let text = export_sheets_json(&chosen, password).map_err(Failure::Failed)?;
        let suffix = if password.is_some() { "-encrypted" } else { "" };
        let name = format!("saf-kanban-settings-{}{suffix}.json", today_ymd());
        let summary = format!(
            "Exported {} Google Sheet board{}",
            chosen.len(),
            if chosen.len() == 1 { "" } else { "s" }
        );
        (text, name, summary)
    };

    if args.option("out") == Some("-") {
        return Ok(json_text);
    }

    let path = match args.option("out") {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(default_name),
    };
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                Failure::Failed(format!("Couldn't create folder {}: {e}", parent.display()))
            })?;
        }
    }
    std::fs::write(&path, &json_text)
        .map_err(|e| Failure::Failed(format!("Couldn't write {}: {e}", path.display())))?;

    let value = json!({
        "exported": true,
        "path": path.display().to_string(),
        "encrypted": password.is_some(),
    });
    Ok(shown(value, format!("{summary} to {}", path.display())))
}
