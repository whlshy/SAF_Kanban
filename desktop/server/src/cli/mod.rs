//! `saf-kanban-cli`: the boards from the command line, for people, scripts
//! and AI agents (see `skill.rs`). It works on the board files directly, so
//! SAF Kanban doesn't have to be open; when it is, its window shows the change
//! within a second or so. Every command runs one of the MCP tools
//! (`mcp::run`), so the two behave the same.

mod args;
mod format;

use std::path::PathBuf;
use std::process::ExitCode;

use serde_json::{json, Map, Value};

use crate::store::{MoveInput, Store};
use crate::{mcp, skill};

use args::{copy_options, list, parse, parse_limit, read_file_text, Args};
use format::{
    filter_board, show_board, show_board_info, show_boards, show_deleted, show_task, show_tasks,
    task_line, text,
};

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
            "Installed the skill for AI agents (Codex, Gemini CLI, GitHub Copilot, Cursor, Claude Code, Antigravity, ...):\n{}",
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
