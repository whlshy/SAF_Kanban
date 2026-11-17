//! The Model Context Protocol side of the server: what AI agents use.
//!
//! MCP is JSON-RPC 2.0. This module answers the handful of methods a server
//! that only offers tools needs (`initialize`, `ping`, `tools/list`,
//! `tools/call`) and defines the tools. It doesn't care how messages arrive:
//! the HTTP endpoint `/mcp` and the stdio bridge (`bridge.rs`) both call
//! [`handle`].

use serde_json::{json, Map, Value};

use crate::error::ApiError;
use crate::model::{Board, DeletedTask, Task};
use crate::store::{BoardPatch, MoveInput, NewBoard, Store, TaskInput, TaskQuery};

/// Protocol revisions this server can talk, newest first.
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "SAF Kanban boards kept on this computer. Start with list_boards to get board ids, \
then get_board to see a board's columns and tasks. Tasks belong to a column (by name) and are ordered within the board; \
use move_task to change a task's column or position and update_task to change its text, priority or assignee. \
Deleted tasks are kept and can be read with list_deleted_tasks.";

/// Runs a tool: `Ok` is the `tools/call` result (including tool failures, as
/// `isError`), `Err` a message for a call that is itself invalid.
pub type ToolCaller<'a> = &'a dyn Fn(&str, &Value) -> Result<Value, String>;

// ---- JSON-RPC ----

fn response(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Answers one incoming message, or a batch of them. `None` when nothing is
/// to be sent back (notifications, and responses from the client).
pub fn handle(message: &Value, call_tool: ToolCaller) -> Option<Value> {
    if let Some(batch) = message.as_array() {
        if batch.is_empty() {
            return Some(error(&Value::Null, -32600, "Invalid request: empty batch"));
        }
        let replies: Vec<Value> = batch
            .iter()
            .filter_map(|each| handle_one(each, call_tool))
            .collect();
        return (!replies.is_empty()).then_some(Value::Array(replies));
    }
    handle_one(message, call_tool)
}

fn handle_one(message: &Value, call_tool: ToolCaller) -> Option<Value> {
    let Some(object) = message.as_object() else {
        return Some(error(
            &Value::Null,
            -32600,
            "Invalid request: expected a JSON object",
        ));
    };
    let id = object.get("id").filter(|id| !id.is_null());
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        // A response to something the client was asked; this server never asks.
        return match (
            id,
            object.contains_key("result") || object.contains_key("error"),
        ) {
            (Some(id), false) => Some(error(id, -32600, "Invalid request: no method")),
            _ => None,
        };
    };
    // Without an id it is a notification: nothing is answered.
    let id = id?;
    let params = object.get("params").cloned().unwrap_or_else(|| json!({}));

    Some(match method {
        "initialize" => {
            let requested = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("");
            let version = PROTOCOL_VERSIONS
                .iter()
                .find(|known| **known == requested)
                .unwrap_or(&PROTOCOL_VERSIONS[0]);
            response(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "saf-kanban", "title": "SAF Kanban", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": INSTRUCTIONS,
                }),
            )
        }
        "ping" => response(id, json!({})),
        "tools/list" => response(id, json!({ "tools": tools() })),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(error(id, -32602, "Invalid params: `name` is required"));
            };
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match call_tool(name, &arguments) {
                Ok(result) => response(id, result),
                Err(message) => error(id, -32602, &message),
            }
        }
        _ => error(id, -32601, &format!("Method not found: {method}")),
    })
}

// ---- tools ----

/// A `tools/call` result carrying `value` as JSON text.
fn tool_result(value: &Value) -> Value {
    json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(value).unwrap_or_default() }], "isError": false })
}

/// A tool that ran and failed: the agent gets the reason and can try again.
pub fn tool_error(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

fn tool(
    name: &str,
    title: &str,
    description: &str,
    read_only: bool,
    properties: Value,
    required: &[&str],
) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": { "type": "object", "properties": properties, "required": required, "additionalProperties": false },
        "annotations": { "readOnlyHint": read_only, "destructiveHint": false, "openWorldHint": false },
    })
}

fn tools() -> Vec<Value> {
    let board = json!({ "type": "string", "description": "Board id, from list_boards." });
    let task = json!({ "type": "string", "description": "Task id, from get_board or list_tasks." });
    let priority = json!({ "type": "string", "description": "Usually high, medium or low." });
    let names = |description: &str| json!({ "type": "array", "items": { "type": "string" }, "description": description });
    let text = |description: &str| json!({ "type": "string", "description": description });

    vec![
        tool("list_boards", "List boards", "Lists the boards on this computer with their id, title, columns, assignee names and task count.", true, json!({}), &[]),
        tool(
            "get_board",
            "Get a board",
            "Returns one board: its columns in order, each with its tasks in order, and the names tasks can be assigned to.",
            true,
            json!({ "board": board }),
            &["board"],
        ),
        tool(
            "list_tasks",
            "List tasks",
            "Lists a board's tasks in board order, optionally filtered. All filters must match.",
            true,
            json!({
                "board": board,
                "column": text("Only tasks in this column (exact name)."),
                "assignee": text("Only tasks assigned to this name. An empty string finds unassigned tasks."),
                "priority": text("Only tasks with this priority."),
                "query": text("Words that must all appear in the title, description, issue id or assignee (case-insensitive)."),
            }),
            &["board"],
        ),
        tool("get_task", "Get a task", "Returns one task with all its fields.", true, json!({ "board": board, "task": task }), &["board", "task"]),
        tool(
            "create_task",
            "Create a task",
            "Adds a task at the end of a column. Without `column` it goes to the board's first column; without `priority` it is medium.",
            false,
            json!({
                "board": board,
                "title": text("Short summary of the task."),
                "description": text("Details. May contain line breaks."),
                "column": text("Column name. Must be one of the board's columns."),
                "priority": priority,
                "assignee": text("Who it is assigned to. Normally one of the board's users."),
                "issueId": text("Id in an issue tracker, e.g. SAF-12 or 42."),
            }),
            &["board", "title"],
        ),
        tool(
            "update_task",
            "Update a task",
            "Changes the given fields of a task and leaves the others as they are. To change its column or position use move_task.",
            false,
            json!({
                "board": board,
                "task": task,
                "title": text("New title."),
                "description": text("New description; an empty string clears it."),
                "priority": priority,
                "assignee": text("New assignee; an empty string unassigns the task."),
                "issueId": text("New issue id; an empty string clears it."),
            }),
            &["board", "task"],
        ),
        tool(
            "move_task",
            "Move a task",
            "Moves a task to a column, and optionally to a position: right before `beforeTask`, or right after `afterTask`. With neither, only the column changes.",
            false,
            json!({
                "board": board,
                "task": task,
                "column": text("Column to move the task to (may be the column it is already in, to reorder)."),
                "beforeTask": text("Id of the task this one should come right before."),
                "afterTask": text("Id of the task this one should come right after."),
            }),
            &["board", "task", "column"],
        ),
        tool(
            "delete_task",
            "Delete a task",
            "Removes a task from the board. It is kept in the board's deleted tasks, where people can see it and create it again.",
            false,
            json!({ "board": board, "task": task }),
            &["board", "task"],
        ),
        tool("list_deleted_tasks", "List deleted tasks", "Lists a board's deleted tasks, newest first.", true, json!({ "board": board }), &["board"]),
        tool(
            "create_board",
            "Create a board",
            "Creates a board. Without `columns` it gets Todo, Doing and Done.",
            false,
            json!({
                "title": text("Name of the board."),
                "columns": names("Column names, in order from left to right."),
                "users": names("Names tasks can be assigned to."),
            }),
            &["title"],
        ),
        tool(
            "update_board",
            "Update a board",
            "Renames a board or changes its columns or assignee names. `columns` is the complete new list in order; a column that still has tasks can't be left out. To rename a column, list its new name in `columns` and map old name to new name in `renameColumns`; its tasks follow.",
            false,
            json!({
                "board": board,
                "title": text("New name of the board."),
                "columns": names("The complete list of column names, in order."),
                "renameColumns": { "type": "object", "additionalProperties": { "type": "string" }, "description": "Old column name -> new column name." },
                "users": names("The complete list of names tasks can be assigned to."),
            }),
            &["board"],
        ),
    ]
}

/// A task as agents see it: `des` is spelled out.
fn task_view(task: &Task) -> Value {
    json!({
        "id": task.id,
        "title": task.title,
        "description": task.des,
        "column": task.column,
        "priority": task.priority,
        "assignee": task.assignee,
        "issueId": task.issue_id,
        "createdAt": task.created_at,
        "updatedAt": task.updated_at,
    })
}

fn deleted_view(deleted: &DeletedTask) -> Value {
    let mut view = task_view(&deleted.task);
    view["deletedAt"] = json!(deleted.deleted_at);
    view
}

fn board_view(board: &Board) -> Value {
    let columns: Vec<Value> = board
        .columns
        .iter()
        .map(|name| json!({ "name": name, "tasks": board.tasks.iter().filter(|task| &task.column == name).map(task_view).collect::<Vec<_>>() }))
        .collect();
    json!({ "id": board.id, "title": board.title, "issueLink": board.issue_link, "users": board.users, "columns": columns })
}

struct Arguments<'a>(&'a Map<String, Value>);

impl Arguments<'_> {
    /// A string argument, or `None` when it wasn't given.
    fn text(&self, name: &str) -> Result<Option<String>, String> {
        match self.0.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(text)) => Ok(Some(text.clone())),
            Some(_) => Err(format!("`{name}` must be a string.")),
        }
    }

    fn required(&self, name: &str) -> Result<String, String> {
        self.text(name)?
            .ok_or_else(|| format!("`{name}` is required."))
    }

    fn names(&self, name: &str) -> Result<Option<Vec<String>>, String> {
        match self.0.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Array(items)) => items
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_string)
                        .ok_or_else(|| format!("`{name}` must be a list of strings."))
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some),
            Some(_) => Err(format!("`{name}` must be a list of strings.")),
        }
    }
}

fn failed(error: ApiError) -> String {
    format!("{} ({})", error.message, error.code)
}

/// Runs a tool against the boards in `store`. See [`ToolCaller`].
pub fn call_tool(store: &Store, name: &str, arguments: &Value) -> Result<Value, String> {
    if !tools().iter().any(|tool| tool["name"] == name) {
        return Err(format!("Unknown tool: {name}"));
    }
    let empty = Map::new();
    let arguments = Arguments(arguments.as_object().unwrap_or(&empty));
    Ok(match run_tool(store, name, &arguments) {
        Ok(value) => tool_result(&value),
        Err(message) => tool_error(&message),
    })
}

fn run_tool(store: &Store, name: &str, arguments: &Arguments) -> Result<Value, String> {
    let board = || arguments.required("board");
    let task = || arguments.required("task");

    Ok(match name {
        "list_boards" => json!(store.list_boards().map_err(failed)?),
        "get_board" => board_view(&store.get_board(&board()?).map_err(failed)?),
        "list_tasks" => {
            let query = TaskQuery {
                column: arguments.text("column")?,
                assignee: arguments.text("assignee")?,
                priority: arguments.text("priority")?,
                q: arguments.text("query")?,
            };
            json!(store
                .list_tasks(&board()?, &query)
                .map_err(failed)?
                .iter()
                .map(task_view)
                .collect::<Vec<_>>())
        }
        "get_task" => task_view(&store.get_task(&board()?, &task()?).map_err(failed)?),
        "create_task" => {
            let input = TaskInput {
                title: Some(arguments.required("title")?),
                des: arguments.text("description")?,
                column: arguments.text("column")?,
                priority: arguments.text("priority")?,
                assignee: arguments.text("assignee")?,
                issue_id: arguments.text("issueId")?,
            };
            task_view(&store.create_task(&board()?, input).map_err(failed)?)
        }
        "update_task" => {
            let input = TaskInput {
                title: arguments.text("title")?,
                des: arguments.text("description")?,
                column: None,
                priority: arguments.text("priority")?,
                assignee: arguments.text("assignee")?,
                issue_id: arguments.text("issueId")?,
            };
            task_view(
                &store
                    .patch_task(&board()?, &task()?, input)
                    .map_err(failed)?,
            )
        }
        "move_task" => {
            let input = MoveInput {
                column: arguments.required("column")?,
                before_id: arguments.text("beforeTask")?,
                after_id: arguments.text("afterTask")?,
            };
            task_view(
                &store
                    .move_task(&board()?, &task()?, input)
                    .map_err(failed)?,
            )
        }
        "delete_task" => {
            store.delete_task(&board()?, &task()?).map_err(failed)?;
            json!({ "deleted": true })
        }
        "list_deleted_tasks" => json!(store
            .history(&board()?)
            .map_err(failed)?
            .iter()
            .map(deleted_view)
            .collect::<Vec<_>>()),
        "create_board" => {
            let input = NewBoard {
                title: arguments.required("title")?,
                issue_link: String::new(),
                columns: arguments.names("columns")?,
                users: arguments.names("users")?.unwrap_or_default(),
                ..NewBoard::default()
            };
            json!(store.create_board(input).map_err(failed)?)
        }
        "update_board" => {
            let renames = match arguments.0.get("renameColumns") {
                None | Some(Value::Null) => Default::default(),
                Some(Value::Object(map)) => map
                    .iter()
                    .map(|(from, to)| {
                        to.as_str()
                            .map(|to| (from.clone(), to.to_string()))
                            .ok_or_else(|| "`renameColumns` must map names to names.".to_string())
                    })
                    .collect::<Result<_, _>>()?,
                Some(_) => return Err("`renameColumns` must be an object.".to_string()),
            };
            let patch = BoardPatch {
                title: arguments.text("title")?,
                issue_link: None,
                columns: arguments.names("columns")?,
                users: arguments.names("users")?,
                renames,
            };
            json!(store.update_board(&board()?, patch).map_err(failed)?)
        }
        _ => return Err(format!("Unknown tool: {name}")),
    })
}
