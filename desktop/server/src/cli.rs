//! `saf-kanban-cli`: the boards from the command line, for people, scripts
//! and AI agents (see `skill.rs`). It works on the board files directly, so
//! SAF Kanban doesn't have to be open; when it is, its window shows the change
//! within a second or so. Every command runs one of the MCP tools
//! (`mcp::run`), so the two behave the same.

use std::io::Read;
use std::path::PathBuf;
use std::process::ExitCode;

use serde_json::{json, Map, Value};

use crate::store::{MoveInput, Store};
use crate::{default_data_dir, mcp, skill};

const USAGE: &str = "\
SAF Kanban from the command line. Works whether or not the app is open.

Usage: saf-kanban-cli <command> [arguments] [--json] [--data-dir DIR]

  boards                          List the boards
  board <board> [--column C] [--limit N]
                                  Columns with their tasks, and the assignees
  tasks <board> [--column C] [--assignee A] [--priority P] [--search WORDS]
                [--since TIME] [--until TIME] [--limit N]
                                  Find tasks (--assignee \"\" finds unassigned ones)
  task <board> <task>             One task, with its whole description
  add <board> <title> [--column C] [--priority P] [--assignee A] [--issue ID]
                      [--description TEXT | --description-file FILE]
                                  Add a task at the end of a column (default: the first)
  edit <board> <task> [--title T] [--priority P] [--assignee A] [--issue ID]
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
  new-board <name> [--columns A,B,C] [--users A,B]
  edit-board <board> [--name N] [--columns A,B,C] [--rename OLD=NEW] [--users A,B]
  skill [--install | --into DIR]  Print the AI agent skill, or install it: --install puts it
                                  where most agents (~/.agents/skills) and Claude Code
                                  (~/.claude/skills) find it; --into DIR into another
                                  agent's skills folder

<board> is a board's id or exact name; <task> is a task id.
--description - and --append-description - read from standard input (UTF-8 or UTF-16).
--description-file and --append-description-file read from a file (UTF-8 or UTF-16).
--since and --until filter by when a task moved into its current column (YYYY-MM-DD or ISO).
--limit N keeps the N tasks most recently moved into their column.
--json prints JSON instead of text. --data-dir picks another data folder.";

/// What went wrong: the command was mistyped (exit status 2) or it could not
/// be done (1).
enum Failure {
    /// `--help`: not a failure, the usage goes to standard output.
    Help,
    Usage(String),
    Failed(String),
}

fn usage(message: impl Into<String>) -> Failure {
    Failure::Usage(message.into())
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure::Failed(message)
    }
}

/// The command line, split into words and `--name value` options.
struct Args {
    command: String,
    words: Vec<String>,
    options: Vec<(String, String)>,
    json: bool,
    install: bool,
    data_dir: PathBuf,
}

/// Options that are given alone, without a value.
const FLAGS: [&str; 3] = ["json", "install", "help"];

fn parse(raw: Vec<String>) -> Result<Args, Failure> {
    let mut words = Vec::new();
    let mut options = Vec::new();
    let mut flags = Vec::new();
    let mut raw = raw.into_iter();
    while let Some(arg) = raw.next() {
        if arg == "--" {
            words.extend(raw.by_ref());
            break;
        }
        if arg == "-h" {
            flags.push("help".to_string());
            continue;
        }
        let Some(option) = arg.strip_prefix("--") else {
            words.push(arg);
            continue;
        };
        let (name, inline) = match option.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (option.to_string(), None),
        };
        if FLAGS.contains(&name.as_str()) {
            flags.push(name);
            continue;
        }
        let value = match inline {
            Some(value) => value,
            None => raw
                .next()
                .ok_or_else(|| usage(format!("--{name} needs a value.")))?,
        };
        options.push((name, value));
    }

    if flags.iter().any(|flag| flag == "help") || words.first().is_some_and(|word| word == "help") {
        return Err(Failure::Help);
    }
    if words.is_empty() {
        return Err(usage(""));
    }
    let mut data_dir = default_data_dir();
    options.retain(|(name, value)| {
        if name == "data-dir" {
            data_dir = PathBuf::from(value);
            false
        } else {
            true
        }
    });
    Ok(Args {
        command: words.remove(0),
        words,
        options,
        json: flags.iter().any(|flag| flag == "json"),
        install: flags.iter().any(|flag| flag == "install"),
        data_dir,
    })
}

impl Args {
    /// Checks which options were given.
    fn expect_options(&self, options: &[&str]) -> Result<(), Failure> {
        if let Some((name, _)) = self
            .options
            .iter()
            .find(|(name, _)| !options.contains(&name.as_str()))
        {
            return Err(usage(format!("`{}` has no option --{name}.", self.command)));
        }
        Ok(())
    }

    /// Checks the number of words and which options were given.
    fn expect(&self, words: &[&str], options: &[&str]) -> Result<(), Failure> {
        if self.words.len() != words.len() {
            let wanted: Vec<String> = words.iter().map(|word| format!("<{word}>")).collect();
            return Err(usage(format!(
                "`{}` takes {}{}.",
                self.command,
                if words.is_empty() { "nothing" } else { "" },
                wanted.join(" ")
            )));
        }
        self.expect_options(options)
    }

    fn option(&self, name: &str) -> Option<&str> {
        self.options
            .iter()
            .rev()
            .find(|(each, _)| each == name)
            .map(|(_, value)| value.as_str())
    }

    fn all(&self, name: &str) -> Vec<&str> {
        self.options
            .iter()
            .filter(|(each, _)| each == name)
            .map(|(_, value)| value.as_str())
            .collect()
    }
}

/// `A,B,C` as a list; spaces around the names don't count.
fn list(text: &str) -> Value {
    json!(text
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>())
}

/// Decodes text read from standard input or a file, handling UTF-8 (with or
/// without BOM) and UTF-16 (LE/BE with BOM, or LE without BOM), which
/// PowerShell commonly produces.
fn decode_text(bytes: &[u8]) -> Result<String, String> {
    let decode_utf16 = |slice: &[u8], be: bool| -> Result<String, String> {
        let (pairs, remainder) = slice.as_chunks::<2>();
        if !remainder.is_empty() {
            return Err("UTF-16 text has an odd number of bytes.".to_string());
        }
        let units: Vec<u16> = pairs
            .iter()
            .map(|&pair| {
                if be {
                    u16::from_be_bytes(pair)
                } else {
                    u16::from_le_bytes(pair)
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|error| format!("Invalid UTF-16 text: {error}"))
    };

    let decoded = if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8(rest.to_vec()).map_err(|error| format!("Invalid UTF-8 text: {error}"))?
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        decode_utf16(rest, false)?
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        decode_utf16(rest, true)?
    } else if bytes.len() >= 2
        && bytes.len().is_multiple_of(2)
        && bytes.iter().skip(1).step_by(2).any(|b| *b == 0)
        && bytes.contains(&0)
    {
        decode_utf16(bytes, false)?
    } else {
        String::from_utf8(bytes.to_vec()).map_err(|error| format!("Invalid UTF-8 text: {error}"))?
    };

    let cleaned = decoded.strip_prefix('\u{feff}').unwrap_or(&decoded);
    Ok(cleaned
        .replace("\r\n", "\n")
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

fn read_stdin_text(label: &str) -> Result<String, Failure> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Couldn't read {label}: {error}"))?;
    decode_text(&bytes)
        .map_err(|error| Failure::Failed(format!("Couldn't decode {label}: {error}")))
}

fn read_file_text(path: &str, label: &str) -> Result<String, Failure> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Couldn't read {label} from `{path}`: {error}"))?;
    decode_text(&bytes)
        .map_err(|error| Failure::Failed(format!("Couldn't decode {label} from `{path}`: {error}")))
}

fn parse_limit(args: &Args) -> Result<Option<usize>, Failure> {
    args.option("limit")
        .map(|raw| {
            raw.trim()
                .parse::<usize>()
                .map_err(|_| usage("--limit must be a non-negative integer."))
        })
        .transpose()
}

/// Copies the given options into a tool's arguments, under the tool's names.
fn copy_options(
    args: &Args,
    into: &mut Map<String, Value>,
    names: &[(&str, &str)],
) -> Result<(), Failure> {
    for (option, argument) in names {
        if let Some(value) = args.option(option) {
            let value =
                if (*option == "description" || *option == "append-description") && value == "-" {
                    read_stdin_text("the description")?
                } else {
                    value.to_string()
                };
            into.insert(argument.to_string(), json!(value));
        }
    }
    Ok(())
}

/// A board's id from its id or its name.
fn find_board(store: &Store, reference: &str) -> Result<String, Failure> {
    let boards = mcp::run(store, "list_boards", &json!({}))?;
    let boards = boards.as_array().cloned().unwrap_or_default();
    if boards.iter().any(|board| board["id"] == reference) {
        return Ok(reference.to_string());
    }
    let wanted = reference.trim();
    let named = |exact: bool| -> Vec<&Value> {
        boards
            .iter()
            .filter(|board| {
                let title = board["title"].as_str().unwrap_or("").trim();
                if exact {
                    title == wanted
                } else {
                    title.to_lowercase() == wanted.to_lowercase()
                }
            })
            .collect()
    };
    let mut found = named(true);
    if found.is_empty() {
        found = named(false);
    }
    match found.as_slice() {
        [board] => Ok(board["id"].as_str().unwrap_or("").to_string()),
        [] => {
            let known: Vec<String> = boards
                .iter()
                .map(|board| format!("{} [{}]", text(&board["title"]), text(&board["id"])))
                .collect();
            Err(Failure::Failed(if known.is_empty() {
                format!("There is no board `{reference}`; there are no boards yet.")
            } else {
                format!(
                    "There is no board `{reference}`. The boards are: {}.",
                    known.join(", ")
                )
            }))
        }
        several => {
            let ids: Vec<&str> = several
                .iter()
                .filter_map(|board| board["id"].as_str())
                .collect();
            Err(Failure::Failed(format!(
                "Several boards are named `{reference}`; give one of their ids instead: {}.",
                ids.join(", ")
            )))
        }
    }
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

// ---- text output ----

/// `[id] title · column · priority · assignee · issue X`, leaving out what is empty.
fn task_line(task: &Value, with_column: bool) -> String {
    let mut parts = vec![format!("[{}] {}", text(&task["id"]), text(&task["title"]))];
    if with_column {
        parts.push(text(&task["column"]).to_string());
    }
    for field in ["priority", "assignee"] {
        if !text(&task[field]).is_empty() {
            parts.push(text(&task[field]).to_string());
        }
    }
    if !text(&task["issueId"]).is_empty() {
        parts.push(format!("issue {}", text(&task["issueId"])));
    }
    parts.join(" · ")
}

fn first_line(description: &str) -> Option<String> {
    let line = description
        .lines()
        .find(|line| !line.trim().is_empty())?
        .trim();
    let mut short: String = line.chars().take(80).collect();
    if short.len() < line.len() || description.trim().lines().count() > 1 {
        short.push_str(" …");
    }
    Some(short)
}

fn show_boards(boards: &Value) -> String {
    let boards = boards.as_array().cloned().unwrap_or_default();
    if boards.is_empty() {
        return "There are no boards yet. Create one with `new-board <name>`.".to_string();
    }
    boards
        .iter()
        .map(|board| {
            let columns: Vec<&str> = board["columns"]
                .as_array()
                .map(|names| names.iter().map(text).collect())
                .unwrap_or_default();
            let count = board["taskCount"].as_u64().unwrap_or(0);
            format!(
                "[{}] {} · {count} task{} · columns: {}",
                text(&board["id"]),
                text(&board["title"]),
                if count == 1 { "" } else { "s" },
                columns.join(", ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn show_board(board: &Value) -> String {
    let mut out = vec![format!(
        "{} [{}]",
        text(&board["title"]),
        text(&board["id"])
    )];
    let users: Vec<&str> = board["users"]
        .as_array()
        .map(|names| names.iter().map(text).collect())
        .unwrap_or_default();
    out.push(format!(
        "Assignees: {}",
        if users.is_empty() {
            "(none)".to_string()
        } else {
            users.join(", ")
        }
    ));
    if !text(&board["issueLink"]).is_empty() {
        out.push(format!("Issue link: {}", text(&board["issueLink"])));
    }
    for column in board["columns"].as_array().into_iter().flatten() {
        let tasks = column["tasks"].as_array().cloned().unwrap_or_default();
        let total = column["total"]
            .as_u64()
            .map(|count| count as usize)
            .unwrap_or(tasks.len());
        out.push(String::new());
        out.push(format!("{} ({})", text(&column["name"]), total));
        if total == 0 {
            out.push("  (no tasks)".to_string());
        }
        for task in &tasks {
            out.push(format!("  {}", task_line(task, false)));
            if let Some(line) = first_line(text(&task["description"])) {
                out.push(format!("      {line}"));
            }
        }
        if total > tasks.len() {
            out.push(format!("  … and {} more", total - tasks.len()));
        }
    }
    out.join("\n")
}

fn show_tasks(tasks: &Value) -> String {
    let tasks = tasks.as_array().cloned().unwrap_or_default();
    if tasks.is_empty() {
        return "No tasks match.".to_string();
    }
    tasks
        .iter()
        .map(|task| task_line(task, true))
        .collect::<Vec<_>>()
        .join("\n")
}

fn show_task(task: &Value) -> String {
    let mut out = vec![format!("[{}] {}", text(&task["id"]), text(&task["title"]))];
    for (label, field) in [
        ("column", "column"),
        ("priority", "priority"),
        ("assignee", "assignee"),
        ("issue", "issueId"),
        ("created", "createdAt"),
        ("moved", "movedAt"),
        ("updated", "updatedAt"),
        ("deleted", "deletedAt"),
    ] {
        if !text(&task[field]).is_empty() {
            out.push(format!("{label:<10} {}", text(&task[field])));
        }
    }
    let description = text(&task["description"]);
    if description.trim().is_empty() {
        out.push("description: (none)".to_string());
    } else {
        out.push("description:".to_string());
        out.extend(description.lines().map(|line| format!("  {line}")));
    }
    out.join("\n")
}

fn show_deleted(tasks: &Value) -> String {
    let tasks = tasks.as_array().cloned().unwrap_or_default();
    if tasks.is_empty() {
        return "No deleted tasks.".to_string();
    }
    tasks
        .iter()
        .map(|task| {
            format!(
                "{} · deleted {}",
                task_line(task, true),
                text(&task["deletedAt"])
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn show_board_info(verb: &str, board: &Value) -> String {
    let names = |field: &str| -> String {
        board[field]
            .as_array()
            .map(|names| names.iter().map(text).collect::<Vec<_>>().join(", "))
            .filter(|joined| !joined.is_empty())
            .unwrap_or_else(|| "(none)".to_string())
    };
    format!(
        "{verb} board [{}] {}\nColumns: {}\nAssignees: {}",
        text(&board["id"]),
        text(&board["title"]),
        names("columns"),
        names("users")
    )
}

/// Applies `--column` and `--limit` filters to a board view from `get_board`.
fn filter_board(
    mut board: Value,
    columns_wanted: &[&str],
    limit: Option<usize>,
) -> Result<Value, Failure> {
    let all_columns = board["columns"].as_array().cloned().unwrap_or_default();
    let known: Vec<&str> = all_columns
        .iter()
        .map(|column| text(&column["name"]))
        .collect();
    for wanted in columns_wanted {
        if !known.contains(wanted) {
            return Err(Failure::Failed(format!(
                "This board has no column named `{wanted}`. Its columns are: {}. (UNKNOWN_COLUMN)",
                known.join(", ")
            )));
        }
    }
    let mut filtered = Vec::new();
    for mut column in all_columns {
        if !columns_wanted.is_empty() && !columns_wanted.contains(&text(&column["name"])) {
            continue;
        }
        if let Some(limit) = limit {
            if let Some(tasks) = column["tasks"].as_array_mut() {
                let total = tasks.len();
                tasks.sort_by(|a, b| {
                    let a_moved = text(&a["movedAt"]);
                    let b_moved = text(&b["movedAt"]);
                    match (a_moved.is_empty(), b_moved.is_empty()) {
                        (true, true) => std::cmp::Ordering::Equal,
                        (true, false) => std::cmp::Ordering::Greater,
                        (false, true) => std::cmp::Ordering::Less,
                        (false, false) => b_moved.cmp(a_moved),
                    }
                });
                tasks.truncate(limit);
                if total > limit {
                    column["total"] = json!(total);
                }
            }
        }
        filtered.push(column);
    }
    board["columns"] = Value::Array(filtered);
    Ok(board)
}

// ---- commands ----

/// Runs the command; returns what to print.
fn run(args: &Args) -> Result<String, Failure> {
    if args.command == "skill" {
        args.expect(&[], &["into"])?;
        let content = skill::skill_md(&skill::cli_path(), &args.data_dir);
        let failed = |error: std::io::Error| format!("Couldn't install the skill: {error}");
        if let Some(dir) = args.option("into") {
            let file = skill::install_into(&PathBuf::from(dir), &content).map_err(failed)?;
            return Ok(format!("Installed the skill: {}", file.display()));
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
            "Installed the skill for AI agents (Codex, Gemini CLI, GitHub Copilot, Cursor, Claude Code, ...):\n{}",
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
    let board = || find_board(&store, &args.words[0]);
    let word = |index: usize| args.words[index].clone();
    let shown = |value: Value, plain: String| if args.json { pretty(&value) } else { plain };

    Ok(match args.command.as_str() {
        "boards" => {
            args.expect(&[], &[])?;
            let boards = call("list_boards", json!({}))?;
            shown(boards.clone(), show_boards(&boards))
        }
        "board" => {
            args.expect(&["board"], &["column", "limit"])?;
            let limit = parse_limit(args)?;
            let columns_wanted = args.all("column");
            let found = call("get_board", json!({ "board": board()? }))?;
            let found = filter_board(found, &columns_wanted, limit)?;
            shown(found.clone(), show_board(&found))
        }
        "tasks" => {
            args.expect(
                &["board"],
                &[
                    "column", "assignee", "priority", "search", "since", "until", "limit",
                ],
            )?;
            let limit = parse_limit(args)?;
            let mut arguments = Map::new();
            arguments.insert("board".into(), json!(board()?));
            copy_options(
                args,
                &mut arguments,
                &[
                    ("column", "column"),
                    ("assignee", "assignee"),
                    ("priority", "priority"),
                    ("search", "query"),
                    ("since", "since"),
                    ("until", "until"),
                ],
            )?;
            if let Some(limit) = limit {
                arguments.insert("limit".into(), json!(limit));
            }
            let tasks = call("list_tasks", Value::Object(arguments))?;
            shown(tasks.clone(), show_tasks(&tasks))
        }
        "task" => {
            args.expect(&["board", "task"], &[])?;
            let task = call("get_task", json!({ "board": board()?, "task": word(1) }))?;
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
                    "description",
                    "description-file",
                ],
            )?;
            if args.option("description").is_some() && args.option("description-file").is_some() {
                return Err(usage(
                    "Give either --description or --description-file, not both.",
                ));
            }
            let mut arguments = Map::new();
            arguments.insert("board".into(), json!(board()?));
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
            if let Some(path) = args.option("description-file") {
                arguments.insert(
                    "description".into(),
                    json!(read_file_text(path, "the description")?),
                );
            }
            let task = call("create_task", Value::Object(arguments))?;
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
            let mut arguments = Map::new();
            arguments.insert("board".into(), json!(board()?));
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
            let task = call("update_task", Value::Object(arguments))?;
            shown(task.clone(), format!("Updated {}", task_line(&task, true)))
        }
        "move" => {
            if args.words.len() < 3 {
                return Err(usage("`move` takes <board> <task>... <column>."));
            }
            args.expect_options(&["before", "after"])?;
            let board_id = board()?;
            let column = args.words.last().unwrap().clone();
            let task_ids = &args.words[1..args.words.len() - 1];
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
        "restore" => {
            args.expect(&["board", "task"], &["column", "before", "after"])?;
            let mut arguments = Map::new();
            arguments.insert("board".into(), json!(board()?));
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
            let task = call("restore_task", Value::Object(arguments))?;
            shown(task.clone(), format!("Restored {}", task_line(&task, true)))
        }
        "delete" => {
            args.expect(&["board", "task"], &[])?;
            let id = board()?;
            let task = call("get_task", json!({ "board": id, "task": word(1) }))?;
            let result = call("delete_task", json!({ "board": id, "task": word(1) }))?;
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
        "deleted" => {
            args.expect(&["board"], &[])?;
            let tasks = call("list_deleted_tasks", json!({ "board": board()? }))?;
            shown(tasks.clone(), show_deleted(&tasks))
        }
        "new-board" => {
            args.expect(&["name"], &["columns", "users"])?;
            let mut arguments = json!({ "title": word(0) });
            if let Some(columns) = args.option("columns") {
                arguments["columns"] = list(columns);
            }
            if let Some(users) = args.option("users") {
                arguments["users"] = list(users);
            }
            let created = call("create_board", arguments)?;
            shown(created.clone(), show_board_info("Created", &created))
        }
        "edit-board" => {
            args.expect(&["board"], &["name", "columns", "rename", "users"])?;
            if args.options.is_empty() {
                return Err(usage("Say what to change, e.g. --name \"New name\"."));
            }
            let mut arguments = json!({ "board": board()? });
            if let Some(name) = args.option("name") {
                arguments["title"] = json!(name);
            }
            if let Some(columns) = args.option("columns") {
                arguments["columns"] = list(columns);
            }
            if let Some(users) = args.option("users") {
                arguments["users"] = list(users);
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
            let updated = call("update_board", arguments)?;
            shown(updated.clone(), show_board_info("Updated", &updated))
        }
        other => return Err(usage(format!("There is no command `{other}`."))),
    })
}

fn pretty(value: &Value) -> String {
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
