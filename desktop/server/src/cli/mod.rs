//! `saf-kanban-cli`: the boards from the command line, for people, scripts
//! and AI agents (see `skill.rs`). Local boards are read and written directly
//! on disk so SAF Kanban doesn't have to be open; Google Sheet boards are
//! accessed through Apps Script v5+ (`sheet.rs`) using the shared settings in
//! `<data dir>/sheets.json`.

mod args;
mod boards;
mod format;

use std::path::PathBuf;
use std::process::ExitCode;

use serde_json::{json, Map, Value};

use crate::sheet::{self, SheetTaskCreate, SheetTaskEdit, SheetTaskFilter};
use crate::store::{MoveInput, Store};
use crate::{mcp, skill};

use args::{copy_options, parse, parse_limit, read_file_text, Args};
use boards::{
    cmd_attach, cmd_delete_board, cmd_edit_board, cmd_export, cmd_import, cmd_new_board,
    find_board, list_all_boards, BoardRef,
};
use format::{
    filter_board, show_board, show_boards, show_deleted, show_task, show_tasks, task_line, text,
};

const USAGE: &str = "\
SAF Kanban from the command line. Works on local boards and Google Sheet boards (Apps Script v5+; labels require v6+).

Usage: saf-kanban-cli <command> [arguments] [--json] [--data-dir DIR]
       saf-kanban-cli --version

  boards                          List local and Google Sheet boards
  board <board> [--column C] [--limit N]
                                  Columns with their tasks, and the assignees
  tasks <board> [--column C] [--assignee A] [--priority P] [--label L] [--search WORDS]
                [--since TIME] [--until TIME] [--limit N]
                                  Find tasks (--assignee \"\" finds unassigned, --label \"\" finds unlabeled)
  task <board> <task>             One task, with its whole description
  add <board> <title> [--column C] [--priority P] [--assignee A] [--issue ID] [--labels A,B]
                      [--description TEXT | --description-file FILE]
                                  Add a task at the end of a column (default: the first)
  edit <board> <task> [--title T] [--priority P] [--assignee A] [--issue ID]
                      [--labels A,B] [--add-label L] [--remove-label L]
                      [--description TEXT | --description-file FILE |
                       --append-description TEXT | --append-description-file FILE]
                                  Change some fields; an empty value clears one
  move <board> <task>... <column> [--before TASK | --after TASK]
                                  Move one or more tasks to a column, optionally next to another
  delete <board> <task>           Delete a task (kept in the deleted tasks)
  deleted <board>                 Deleted tasks, newest first
  restore <board> <task> [--column C] [--before TASK | --after TASK]
                                  Put a deleted task back as it was: same id and
                                  contents, in its old column and place
  attach <board> <image-file>     Attach a local PNG/JPEG/WebP/GIF image (local boards only)
                                  and print its Markdown snippet (![name](attachment:...))
  new-board <name> [--columns A,B,C] [--users A,B] [--labels \"bug:red,feat:blue\"] [--issue-link URL]
                   [--sheet URL|ID] [--script URL|ID] [--user NAME]
                                  Create a local board, or add a Google Sheet board (--script)
  edit-board <board> [--name N] [--columns A,B,C] [--rename OLD=NEW] [--users A,B]
                     [--labels \"bug:red,feat:blue\"] [--rename-label OLD=NEW]
                     [--issue-link URL] [--sheet URL|ID] [--script URL|ID] [--user NAME]
                                  Update a board's settings
  delete-board <board>            Delete a local board, or remove a Google Sheet board from the list
  import <file> [--password PWD]  Import exported Google Sheet settings (plain or encrypted)
                                  or a single local board JSON file
  export [board...] [--sheets] [--out FILE] [--password PWD]
                                  Export a local board, or Google Sheet board settings (--out - for stdout)
  skill [--install [--target agents|claude|antigravity] | --into DIR]
                                  Print the AI agent skill, or install it: --install puts it
                                  where most agents (~/.agents/skills), Claude Code
                                  (~/.claude/skills) and Antigravity (~/.gemini/config/skills)
                                  find it; --into DIR into another agent's skills folder

<board> is a board's id or exact name; <task> is a task id.
--description - and --append-description - read from standard input (UTF-8 or UTF-16).
--description-file and --append-description-file read from a file (UTF-8 or UTF-16).
--since and --until filter by when a task moved into its current column (YYYY-MM-DD or ISO).
--limit N keeps the N tasks most recently moved into their column.
--json prints JSON instead of text. --data-dir picks another data folder.";

/// What went wrong: the command was mistyped (exit status 2) or it could not
/// be done (1).
pub(super) enum Failure {
    /// `--help`: not a failure, the usage goes to standard output.
    Help,
    /// `--version` / `-V`: print the CLI version to standard output.
    Version,
    Usage(String),
    Failed(String),
}

pub(super) fn usage(message: impl Into<String>) -> Failure {
    Failure::Usage(message.into())
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure::Failed(message)
    }
}

fn read_text_option(args: &Args, inline: &str, file_opt: &str) -> Result<Option<String>, Failure> {
    if let Some(value) = args.option(inline) {
        if value == "-" {
            return read_file_text("-", "the description").map(Some);
        }
        return Ok(Some(value.to_string()));
    }
    if let Some(path) = args.option(file_opt) {
        return read_file_text(path, "the description").map(Some);
    }
    Ok(None)
}

fn split_label_values(values: &[&str]) -> Vec<String> {
    crate::store::clean_labels(values.iter().copied())
}

/// Runs the command; returns what to print.
fn run(args: &Args) -> Result<String, Failure> {
    if args.command == "skill" {
        args.expect(&[], &["into", "target"])?;
        let content = skill::skill_md(&skill::cli_path(), &args.data_dir);
        let failed = |error: std::io::Error| format!("Couldn't install the skill: {error}");
        if let Some(dir) = args.option("into") {
            if args.option("target").is_some() {
                return Err(usage("Give either --into or --target, not both."));
            }
            let file = skill::install_into(&PathBuf::from(dir), &content).map_err(failed)?;
            return Ok(format!("Installed the skill: {}", file.display()));
        }
        if let Some(target) = args.option("target") {
            let Some(file) = skill::install_for(target, &content).map_err(failed)? else {
                return Err(usage(format!(
                    "Unknown skill target `{target}`. Use `agents`, `claude` or `antigravity`."
                )));
            };
            return Ok(format!(
                "Installed the skill ({target}): {}",
                file.display()
            ));
        }
        if !args.install {
            return Ok(content.trim_end().to_string());
        }
        let files = skill::install(&content).map_err(failed)?;
        let files: Vec<String> = files
            .iter()
            .map(|file| format!("  {}", file.display()))
            .collect();
        return Ok(format!(
            "Installed the skill for AI agents (Codex, Cursor, Gemini CLI, GitHub Copilot, Claude Code, Antigravity, ...):\n{}",
            files.join("\n")
        ));
    }

    let store = Store::open(&args.data_dir).map_err(|error| {
        format!(
            "Couldn't open the data folder {}: {error}",
            args.data_dir.display()
        )
    })?;
    let call = |name: &str, arguments: Value| -> Result<Value, Failure> {
        Ok(mcp::run(&store, name, &arguments)?)
    };
    let word = |index: usize| args.words[index].clone();
    let shown = |value: Value, plain: String| if args.json { pretty(&value) } else { plain };

    Ok(match args.command.as_str() {
        "boards" => {
            args.expect(&[], &[])?;
            let all = Value::Array(list_all_boards(&store)?);
            shown(all.clone(), show_boards(&all))
        }
        "board" => {
            args.expect(&["board"], &["column", "limit"])?;
            let limit = parse_limit(args)?;
            let columns_wanted = args.all("column");
            let found = match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => call("get_board", json!({ "board": id }))?,
                BoardRef::Sheet(sheet_board) => {
                    let snapshot = sheet::read_board(&sheet_board).map_err(Failure::Failed)?;
                    sheet::snapshot_to_board_json(&sheet_board, &snapshot)
                }
            };
            let found = filter_board(found, &columns_wanted, limit)?;
            shown(found.clone(), show_board(&found))
        }
        "tasks" => {
            args.expect(
                &["board"],
                &[
                    "column", "assignee", "priority", "label", "search", "since", "until", "limit",
                ],
            )?;
            let limit = parse_limit(args)?;
            let tasks = match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => {
                    let mut arguments = Map::new();
                    arguments.insert("board".into(), json!(id));
                    copy_options(
                        args,
                        &mut arguments,
                        &[
                            ("column", "column"),
                            ("assignee", "assignee"),
                            ("priority", "priority"),
                            ("label", "label"),
                            ("search", "query"),
                            ("since", "since"),
                            ("until", "until"),
                        ],
                    )?;
                    if let Some(limit) = limit {
                        arguments.insert("limit".into(), json!(limit));
                    }
                    call("list_tasks", Value::Object(arguments))?
                }
                BoardRef::Sheet(sheet_board) => {
                    let snapshot = sheet::read_board(&sheet_board).map_err(Failure::Failed)?;
                    let matched = sheet::filter_tasks(
                        &snapshot,
                        &SheetTaskFilter {
                            column: args.option("column"),
                            assignee: args.option("assignee"),
                            priority: args.option("priority"),
                            label: args.option("label"),
                            query: args.option("search"),
                            since: args.option("since"),
                            until: args.option("until"),
                            limit,
                        },
                    )
                    .map_err(Failure::Failed)?;
                    Value::Array(matched)
                }
            };
            shown(tasks.clone(), show_tasks(&tasks))
        }
        "task" => {
            args.expect(&["board", "task"], &[])?;
            let task = match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => call("get_task", json!({ "board": id, "task": word(1) }))?,
                BoardRef::Sheet(sheet_board) => {
                    let snapshot = sheet::read_board(&sheet_board).map_err(Failure::Failed)?;
                    let task_id = word(1);
                    let Some(found) = snapshot.tasks.iter().find(|t| t.id == task_id) else {
                        return Err(Failure::Failed(format!("There is no task `{task_id}`.")));
                    };
                    sheet::task_to_json(found)
                }
            };
            shown(task.clone(), show_task(&task))
        }
        "add" => {
            args.expect(
                &["board", "title"],
                &[
                    "column",
                    "priority",
                    "assignee",
                    "issue",
                    "labels",
                    "description",
                    "description-file",
                ],
            )?;
            if args.option("description").is_some() && args.option("description-file").is_some() {
                return Err(usage(
                    "Give either --description or --description-file, not both.",
                ));
            }
            let labels_opt = {
                let raw = args.all("labels");
                (!raw.is_empty()).then(|| split_label_values(&raw))
            };
            let task = match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => {
                    let mut arguments = Map::new();
                    arguments.insert("board".into(), json!(id));
                    arguments.insert("title".into(), json!(word(1)));
                    copy_options(
                        args,
                        &mut arguments,
                        &[
                            ("column", "column"),
                            ("priority", "priority"),
                            ("assignee", "assignee"),
                            ("issue", "issueId"),
                            ("description", "description"),
                        ],
                    )?;
                    if let Some(labels) = labels_opt {
                        arguments.insert("labels".into(), json!(labels));
                    }
                    if let Some(path) = args.option("description-file") {
                        arguments.insert(
                            "description".into(),
                            json!(read_file_text(path, "the description")?),
                        );
                    }
                    call("create_task", Value::Object(arguments))?
                }
                BoardRef::Sheet(sheet_board) => {
                    let des = read_text_option(args, "description", "description-file")?;
                    sheet::add_task(
                        &sheet_board,
                        &SheetTaskCreate {
                            title: &word(1),
                            column: args.option("column"),
                            priority: args.option("priority"),
                            assignee: args.option("assignee"),
                            issue_id: args.option("issue"),
                            des: des.as_deref(),
                            labels: labels_opt,
                        },
                    )
                    .map_err(Failure::Failed)?
                }
            };
            shown(task.clone(), format!("Added {}", task_line(&task, true)))
        }
        "edit" => {
            args.expect(
                &["board", "task"],
                &[
                    "title",
                    "priority",
                    "assignee",
                    "issue",
                    "labels",
                    "add-label",
                    "remove-label",
                    "description",
                    "description-file",
                    "append-description",
                    "append-description-file",
                ],
            )?;
            if args.options.is_empty() {
                return Err(usage("Say what to change, e.g. --title \"New title\"."));
            }
            let desc_options = [
                "description",
                "description-file",
                "append-description",
                "append-description-file",
            ]
            .into_iter()
            .filter(|name| args.option(name).is_some())
            .count();
            if desc_options > 1 {
                return Err(usage(
                    "Use at most one of --description, --description-file, --append-description, --append-description-file.",
                ));
            }
            let labels_opt = {
                let raw = args.all("labels");
                (!raw.is_empty()).then(|| split_label_values(&raw))
            };
            let add_labels_opt = {
                let raw = args.all("add-label");
                (!raw.is_empty()).then(|| split_label_values(&raw))
            };
            let remove_labels_opt = {
                let raw = args.all("remove-label");
                (!raw.is_empty()).then(|| split_label_values(&raw))
            };
            let task = match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => {
                    let mut arguments = Map::new();
                    arguments.insert("board".into(), json!(id));
                    arguments.insert("task".into(), json!(word(1)));
                    copy_options(
                        args,
                        &mut arguments,
                        &[
                            ("title", "title"),
                            ("priority", "priority"),
                            ("assignee", "assignee"),
                            ("issue", "issueId"),
                            ("description", "description"),
                            ("append-description", "appendDescription"),
                        ],
                    )?;
                    if let Some(labels) = labels_opt {
                        arguments.insert("labels".into(), json!(labels));
                    }
                    if let Some(add_labels) = add_labels_opt {
                        arguments.insert("addLabels".into(), json!(add_labels));
                    }
                    if let Some(remove_labels) = remove_labels_opt {
                        arguments.insert("removeLabels".into(), json!(remove_labels));
                    }
                    if let Some(path) = args.option("description-file") {
                        arguments.insert(
                            "description".into(),
                            json!(read_file_text(path, "the description")?),
                        );
                    }
                    if let Some(path) = args.option("append-description-file") {
                        arguments.insert(
                            "appendDescription".into(),
                            json!(read_file_text(path, "the description")?),
                        );
                    }
                    call("update_task", Value::Object(arguments))?
                }
                BoardRef::Sheet(sheet_board) => {
                    let des = read_text_option(args, "description", "description-file")?;
                    let append_des =
                        read_text_option(args, "append-description", "append-description-file")?;
                    sheet::edit_task(
                        &sheet_board,
                        &word(1),
                        &SheetTaskEdit {
                            title: args.option("title"),
                            priority: args.option("priority"),
                            assignee: args.option("assignee"),
                            issue_id: args.option("issue"),
                            des: des.as_deref(),
                            append_des: append_des.as_deref(),
                            labels: labels_opt,
                            add_labels: add_labels_opt,
                            remove_labels: remove_labels_opt,
                        },
                    )
                    .map_err(Failure::Failed)?
                }
            };
            shown(task.clone(), format!("Updated {}", task_line(&task, true)))
        }
        "move" => {
            if args.words.len() < 3 {
                return Err(usage("`move` takes <board> <task>... <column>."));
            }
            args.expect_options(&["before", "after"])?;
            let column = args.words.last().unwrap().clone();
            let task_ids = &args.words[1..args.words.len() - 1];
            match find_board(&store, &args.words[0])? {
                BoardRef::Local(board_id) => {
                    if task_ids.len() == 1 {
                        let mut arguments = Map::new();
                        arguments.insert("board".into(), json!(board_id));
                        arguments.insert("task".into(), json!(task_ids[0]));
                        arguments.insert("column".into(), json!(column));
                        copy_options(
                            args,
                            &mut arguments,
                            &[("before", "beforeTask"), ("after", "afterTask")],
                        )?;
                        let task = call("move_task", Value::Object(arguments))?;
                        shown(task.clone(), format!("Moved {}", task_line(&task, true)))
                    } else {
                        let input = MoveInput {
                            column,
                            before_id: args.option("before").map(str::to_string),
                            after_id: args.option("after").map(str::to_string),
                        };
                        let moved = store
                            .move_tasks(&board_id, task_ids, input)
                            .map_err(|error| format!("{} ({})", error.message, error.code))?;
                        let views: Vec<Value> = moved.iter().map(mcp::task_view).collect();
                        let plain = views
                            .iter()
                            .map(|task| format!("Moved {}", task_line(task, true)))
                            .collect::<Vec<_>>()
                            .join("\n");
                        shown(Value::Array(views), plain)
                    }
                }
                BoardRef::Sheet(sheet_board) => {
                    let views = sheet::move_tasks(
                        &sheet_board,
                        task_ids,
                        &column,
                        args.option("before"),
                        args.option("after"),
                    )
                    .map_err(Failure::Failed)?;
                    if views.len() == 1 {
                        let task = views.into_iter().next().unwrap();
                        shown(task.clone(), format!("Moved {}", task_line(&task, true)))
                    } else {
                        let plain = views
                            .iter()
                            .map(|task| format!("Moved {}", task_line(task, true)))
                            .collect::<Vec<_>>()
                            .join("\n");
                        shown(Value::Array(views), plain)
                    }
                }
            }
        }
        "restore" => {
            args.expect(&["board", "task"], &["column", "before", "after"])?;
            let task = match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => {
                    let mut arguments = Map::new();
                    arguments.insert("board".into(), json!(id));
                    arguments.insert("task".into(), json!(word(1)));
                    copy_options(
                        args,
                        &mut arguments,
                        &[
                            ("column", "column"),
                            ("before", "beforeTask"),
                            ("after", "afterTask"),
                        ],
                    )?;
                    call("restore_task", Value::Object(arguments))?
                }
                BoardRef::Sheet(sheet_board) => sheet::restore_task(
                    &sheet_board,
                    &word(1),
                    args.option("column"),
                    args.option("before"),
                    args.option("after"),
                )
                .map_err(Failure::Failed)?,
            };
            shown(task.clone(), format!("Restored {}", task_line(&task, true)))
        }
        "delete" => {
            args.expect(&["board", "task"], &[])?;
            let task_id = word(1);
            match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => {
                    let task = call("get_task", json!({ "board": id, "task": task_id }))?;
                    let result = call("delete_task", json!({ "board": id, "task": task_id }))?;
                    shown(
                        result,
                        format!(
                            "Deleted [{id}] {}. It is kept in the board's deleted tasks; `restore {} {id}` puts it back.",
                            text(&task["title"]),
                            args.words[0],
                            id = text(&task["id"]),
                        ),
                    )
                }
                BoardRef::Sheet(sheet_board) => {
                    let snapshot = sheet::read_board(&sheet_board).map_err(Failure::Failed)?;
                    let Some(task) = snapshot.tasks.iter().find(|t| t.id == task_id) else {
                        return Err(Failure::Failed(format!("There is no task `{task_id}`.")));
                    };
                    sheet::delete_task(&sheet_board, &task_id).map_err(Failure::Failed)?;
                    let result = json!({ "deleted": true, "id": task.id });
                    shown(
                        result,
                        format!(
                            "Deleted [{}] {}. It is kept in the board's deleted tasks; `restore {} {}` puts it back.",
                            task.id, task.title, args.words[0], task.id
                        ),
                    )
                }
            }
        }
        "deleted" => {
            args.expect(&["board"], &[])?;
            let tasks = match find_board(&store, &args.words[0])? {
                BoardRef::Local(id) => call("list_deleted_tasks", json!({ "board": id }))?,
                BoardRef::Sheet(sheet_board) => {
                    let snapshot = sheet::read_board(&sheet_board).map_err(Failure::Failed)?;
                    // Newest deletion first, matching local `deleted` and HistoryDialog.
                    Value::Array(
                        snapshot
                            .history
                            .iter()
                            .rev()
                            .map(sheet::deleted_to_json)
                            .collect(),
                    )
                }
            };
            shown(tasks.clone(), show_deleted(&tasks))
        }
        "attach" => cmd_attach(&store, args)?,
        "new-board" => cmd_new_board(&store, args)?,
        "edit-board" => cmd_edit_board(&store, args)?,
        "delete-board" => cmd_delete_board(&store, args)?,
        "import" => cmd_import(&store, args)?,
        "export" => cmd_export(&store, args)?,
        other => return Err(usage(format!("There is no command `{other}`."))),
    })
}

pub(super) fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

pub fn main() -> ExitCode {
    let result = parse(std::env::args().skip(1).collect()).and_then(|args| run(&args));
    match result {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(Failure::Help) => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Err(Failure::Version) => {
            println!("saf-kanban-cli {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Err(Failure::Usage(message)) => {
            if !message.is_empty() {
                eprintln!("error: {message}\n");
            }
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
        Err(Failure::Failed(message)) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}
