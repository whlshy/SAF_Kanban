//! Client for Google Sheet boards via SAF Kanban Apps Script v5+ (`doPost` +
//! `action=read`, `upsert`, `move`, `delete`, `restore`, `info`).

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::model::SheetBoard;
use crate::store::{parse_time_bound, DEFAULT_PRIORITY};

pub const REQUIRED_SCRIPT_VERSION: u64 = 5;

#[derive(Debug, Clone)]
pub struct ScriptInfo {
    pub version: u64,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetTask {
    pub id: String,
    pub title: String,
    pub issue_id: String,
    pub des: String,
    pub column: String,
    pub priority: String,
    pub assignee: String,
    pub created_at: String,
    pub moved_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetDeletedTask {
    pub id: String,
    pub title: String,
    pub issue_id: String,
    pub des: String,
    pub column: String,
    pub priority: String,
    pub assignee: String,
    pub deleted_at: String,
    pub created_at: String,
    pub moved_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct SheetSnapshot {
    pub columns: Vec<String>,
    pub users: Vec<String>,
    pub tasks: Vec<SheetTask>,
    pub history: Vec<SheetDeletedTask>,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .max_redirects(10)
        .http_status_as_error(false)
        .build()
        .into()
}

fn endpoint_url(script_id: &str) -> Result<String, String> {
    let id = script_id.trim();
    if id.is_empty() {
        return Err(
            "This Google Sheet board has no Apps Script URL configured. Set one with `edit-board <board> --script <URL>` (Apps Script v5 or newer is required)."
                .to_string(),
        );
    }
    if id.starts_with("http://127.0.0.1:") || id.starts_with("http://localhost:") {
        return Ok(id.to_string());
    }
    if id.starts_with("https://") || id.starts_with("http://") {
        return Ok(id.to_string());
    }
    Ok(format!("https://script.google.com/macros/s/{id}/exec"))
}

fn upgrade_message(version: Option<u64>) -> String {
    match version {
        Some(v) => format!(
            "This Google Sheet uses Apps Script v{v}, but the CLI requires Apps Script v{REQUIRED_SCRIPT_VERSION} or newer (with `action=read` and `doPost`). Please update Apps Script from `apps-script/Code.gs` and deploy a new version."
        ),
        None => format!(
            "This Google Sheet's Apps Script is too old for the CLI (Apps Script v{REQUIRED_SCRIPT_VERSION} or newer is required). Please update Apps Script from `apps-script/Code.gs` and deploy a new version."
        ),
    }
}

fn parse_script_json(mut response: ureq::http::Response<ureq::Body>) -> Result<Value, String> {
    let status = response.status().as_u16();
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("Couldn't read response from Apps Script: {e}"))?;
    let trimmed = text.trim();
    let Ok(body) = serde_json::from_str::<Value>(trimmed) else {
        if status == 401
            || status == 403
            || trimmed.contains("<html")
            || trimmed.contains("<!DOCTYPE")
        {
            return Err(
                "Apps Script returned an HTML page instead of JSON. Check that the deployment is set to \"Execute as: Me\" and \"Who has access: Anyone\" (and is deployed at v5+)."
                    .to_string(),
            );
        }
        return Err(format!(
            "Apps Script answered HTTP {status} with non-JSON data."
        ));
    };
    if body.get("status").and_then(Value::as_str) == Some("error") {
        let code = body
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN");
        let version = body.get("version").and_then(Value::as_u64);
        if code == "UNKNOWN_ACTION" && version.is_none_or(|v| v < REQUIRED_SCRIPT_VERSION) {
            return Err(upgrade_message(version));
        }
        let message = body.get("message").and_then(Value::as_str).unwrap_or(code);
        return Err(match code {
            "SHEET_MISMATCH" => {
                let name = body["params"]["name"].as_str().unwrap_or("");
                format!(
                    "Apps Script is bound to a different Google Sheet ({name}), not this board's sheetId."
                )
            }
            "SHEET_NOT_FOUND" => {
                let name = body["params"]["name"].as_str().unwrap_or("kanban");
                format!("Worksheet `{name}` was not found in this Google Sheet.")
            }
            "TASK_NOT_FOUND" => {
                let id = body["params"]["id"].as_str().unwrap_or("");
                format!("There is no task `{id}`.")
            }
            "DUPLICATE_TASK_ID" => {
                let id = body["params"]["id"].as_str().unwrap_or("");
                format!("Task `{id}` is already on the board.")
            }
            _ => format!("Apps Script error ({code}): {message}"),
        });
    }
    if !(200..300).contains(&status) {
        return Err(format!("Apps Script answered HTTP {status}."));
    }
    Ok(body)
}

fn post_script(board: &SheetBoard, payload: Value) -> Result<Value, String> {
    let url = endpoint_url(&board.script_id)?;
    let mut payload = payload;
    if !board.sheet_id.is_empty() {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("sheetId".to_string(), json!(board.sheet_id));
        }
    }
    let response = agent()
        .post(&url)
        .header("Content-Type", "text/plain; charset=utf-8")
        .send_json(payload)
        .map_err(|e| format!("Couldn't reach Apps Script: {e}"))?;
    let body = parse_script_json(response)?;
    let version = body.get("version").and_then(Value::as_u64);
    if version.is_none_or(|v| v < REQUIRED_SCRIPT_VERSION) {
        return Err(upgrade_message(version));
    }
    Ok(body)
}

/// Calls `action=info` (GET) to verify a Google Sheet board's Apps Script URL,
/// version (>= 5), and bound spreadsheet ID.
pub fn check_info(script_id: &str, expected_sheet_id: &str) -> Result<ScriptInfo, String> {
    let url = endpoint_url(script_id)?;
    let sep = if url.contains('?') { '&' } else { '?' };
    let info_url = format!("{url}{sep}action=info");
    let response = agent()
        .get(&info_url)
        .call()
        .map_err(|e| format!("Couldn't reach Apps Script: {e}"))?;
    let body = parse_script_json(response)?;
    let version = body.get("version").and_then(Value::as_u64).unwrap_or(0);
    if version < REQUIRED_SCRIPT_VERSION {
        return Err(upgrade_message((version > 0).then_some(version)));
    }
    let id = body
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !expected_sheet_id.is_empty() && !id.is_empty() && expected_sheet_id != id {
        return Err(format!(
            "The Apps Script belongs to spreadsheet `{id}` ({name}), which does not match `--sheet {expected_sheet_id}`."
        ));
    }
    Ok(ScriptInfo { version, id, name })
}

/// Fetches the complete board state (`columns`, `users`, `tasks`, `history`) in
/// one Apps Script v5 request.
pub fn read_board(board: &SheetBoard) -> Result<SheetSnapshot, String> {
    let body = post_script(board, json!({ "action": "read" }))?;
    let columns: Vec<String> = serde_json::from_value(body["columns"].clone()).unwrap_or_default();
    let users: Vec<String> = serde_json::from_value(body["users"].clone()).unwrap_or_default();
    let tasks: Vec<SheetTask> = serde_json::from_value(body["tasks"].clone()).unwrap_or_default();
    let history: Vec<SheetDeletedTask> =
        serde_json::from_value(body["history"].clone()).unwrap_or_default();
    Ok(SheetSnapshot {
        columns,
        users,
        tasks,
        history,
    })
}

pub fn task_to_json(task: &SheetTask) -> Value {
    let mut obj = json!({
        "id": task.id,
        "title": task.title,
        "issueId": task.issue_id,
        "description": task.des,
        "column": task.column,
        "priority": task.priority,
        "assignee": task.assignee,
        "createdAt": task.created_at,
        "updatedAt": task.moved_at,
    });
    if !task.moved_at.is_empty() {
        obj["movedAt"] = json!(task.moved_at);
    }
    obj
}

pub fn deleted_to_json(task: &SheetDeletedTask) -> Value {
    let mut obj = json!({
        "id": task.id,
        "title": task.title,
        "issueId": task.issue_id,
        "description": task.des,
        "column": task.column,
        "priority": task.priority,
        "assignee": task.assignee,
        "deletedAt": task.deleted_at,
        "createdAt": task.created_at,
    });
    if !task.moved_at.is_empty() {
        obj["movedAt"] = json!(task.moved_at);
    }
    obj
}

pub fn board_title_display(board: &SheetBoard) -> String {
    let trimmed = board.title.trim();
    if !trimmed.is_empty() {
        trimmed.to_string()
    } else if board.id == crate::store::DEFAULT_SHEET_BOARD_ID {
        "SAF Kanban".to_string()
    } else {
        "Untitled board".to_string()
    }
}

/// Converts a fetched snapshot into the same JSON structure returned by
/// `mcp::run("get_board")`, so `cli::format::show_board` renders it identically.
pub fn snapshot_to_board_json(board: &SheetBoard, snapshot: &SheetSnapshot) -> Value {
    let columns: Vec<Value> = snapshot
        .columns
        .iter()
        .map(|name| {
            let tasks: Vec<Value> = snapshot
                .tasks
                .iter()
                .filter(|t| t.column == *name)
                .map(task_to_json)
                .collect();
            json!({ "name": name, "tasks": tasks })
        })
        .collect();
    json!({
        "id": board.id,
        "type": "sheet",
        "title": board_title_display(board),
        "issueLink": board.jira_link,
        "users": snapshot.users,
        "columns": columns,
    })
}

/// Normalizes a Sheet timestamp (`YYYY-MM-DD HH:MM:SS` or ISO) into a UTC-like
/// sortable string matching `parse_time_bound`.
fn comparable_timestamp(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    parse_time_bound(text, false).ok()
}

pub struct SheetTaskFilter<'a> {
    pub column: Option<&'a str>,
    pub assignee: Option<&'a str>,
    pub priority: Option<&'a str>,
    pub query: Option<&'a str>,
    pub since: Option<&'a str>,
    pub until: Option<&'a str>,
    pub limit: Option<usize>,
}

pub fn filter_tasks(
    snapshot: &SheetSnapshot,
    filter: &SheetTaskFilter<'_>,
) -> Result<Vec<Value>, String> {
    let since = match filter.since {
        Some(raw) => Some(parse_time_bound(raw, false).map_err(|e| e.message)?),
        None => None,
    };
    let until = match filter.until {
        Some(raw) => Some(parse_time_bound(raw, true).map_err(|e| e.message)?),
        None => None,
    };
    let terms: Vec<String> = filter
        .query
        .map(|q| {
            q.split_whitespace()
                .map(|w| w.to_lowercase())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut matched: Vec<&SheetTask> = snapshot
        .tasks
        .iter()
        .filter(|task| {
            if let Some(col) = filter.column {
                if task.column != col {
                    return false;
                }
            }
            if let Some(assignee) = filter.assignee {
                if assignee.is_empty() {
                    if !task.assignee.trim().is_empty() {
                        return false;
                    }
                } else if task.assignee.to_lowercase() != assignee.to_lowercase() {
                    return false;
                }
            }
            if let Some(priority) = filter.priority {
                if task.priority.to_lowercase() != priority.to_lowercase() {
                    return false;
                }
            }
            if !terms.is_empty() {
                let hay = format!(
                    "{}\n{}\n{}\n{}",
                    task.title, task.des, task.issue_id, task.assignee
                )
                .to_lowercase();
                if !terms.iter().all(|term| hay.contains(term)) {
                    return false;
                }
            }
            if since.is_some() || until.is_some() {
                let Some(ts) = comparable_timestamp(&task.moved_at)
                    .or_else(|| comparable_timestamp(&task.created_at))
                else {
                    return false;
                };
                if let Some(ref s) = since {
                    if &ts < s {
                        return false;
                    }
                }
                if let Some(ref u) = until {
                    if &ts > u {
                        return false;
                    }
                }
            }
            true
        })
        .collect();

    if let Some(limit) = filter.limit {
        let mut indexed: Vec<(usize, &SheetTask)> = matched.into_iter().enumerate().collect();
        indexed.sort_by(|(ia, a), (ib, b)| {
            let ta = comparable_timestamp(&a.moved_at)
                .or_else(|| comparable_timestamp(&a.created_at))
                .unwrap_or_default();
            let tb = comparable_timestamp(&b.moved_at)
                .or_else(|| comparable_timestamp(&b.created_at))
                .unwrap_or_default();
            tb.cmp(&ta).then_with(|| ia.cmp(ib))
        });
        indexed.truncate(limit);
        matched = indexed.into_iter().map(|(_, t)| t).collect();
    }

    Ok(matched.into_iter().map(task_to_json).collect())
}

fn check_priority(priority: &str) -> Result<String, String> {
    let trimmed = priority.trim().to_lowercase();
    if trimmed.is_empty() {
        return Ok(DEFAULT_PRIORITY.to_string());
    }
    match trimmed.as_str() {
        "high" | "medium" | "low" => Ok(trimmed),
        _ => Err(format!(
            "`{priority}` isn't a valid priority. Use `high`, `medium` or `low`."
        )),
    }
}

fn new_task_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..8].to_string()
}

pub struct SheetTaskCreate<'a> {
    pub title: &'a str,
    pub column: Option<&'a str>,
    pub priority: Option<&'a str>,
    pub assignee: Option<&'a str>,
    pub issue_id: Option<&'a str>,
    pub des: Option<&'a str>,
}

pub fn add_task(board: &SheetBoard, input: &SheetTaskCreate<'_>) -> Result<Value, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("A task needs a title.".to_string());
    }
    let snapshot = read_board(board)?;
    let column = match input.column {
        Some(col) => {
            if !snapshot.columns.is_empty() && !snapshot.columns.iter().any(|c| c == col) {
                return Err(format!(
                    "There is no column `{col}`. The columns are: {}.",
                    snapshot.columns.join(", ")
                ));
            }
            col.to_string()
        }
        None => snapshot.columns.first().cloned().ok_or_else(|| {
            "This Google Sheet has no columns defined in its `columns` tab.".to_string()
        })?,
    };
    let priority = check_priority(input.priority.unwrap_or(DEFAULT_PRIORITY))?;
    let id = new_task_id();
    let task_payload = json!({
        "id": id,
        "title": title,
        "jiraId": input.issue_id.unwrap_or(""),
        "des": input.des.unwrap_or(""),
        "task": column,
        "priority": priority,
        "assignee": input.assignee.unwrap_or(""),
    });
    post_script(
        board,
        json!({
            "action": "upsert",
            "task": task_payload,
        }),
    )?;
    let refreshed = read_board(board)?;
    if let Some(created) = refreshed.tasks.iter().find(|t| t.id == id) {
        return Ok(task_to_json(created));
    }
    Ok(json!({
        "id": id,
        "title": title,
        "issueId": input.issue_id.unwrap_or(""),
        "des": input.des.unwrap_or(""),
        "column": column,
        "priority": priority,
        "assignee": input.assignee.unwrap_or(""),
    }))
}

pub struct SheetTaskEdit<'a> {
    pub title: Option<&'a str>,
    pub priority: Option<&'a str>,
    pub assignee: Option<&'a str>,
    pub issue_id: Option<&'a str>,
    pub des: Option<&'a str>,
    pub append_des: Option<&'a str>,
}

pub fn edit_task(
    board: &SheetBoard,
    task_id: &str,
    patch: &SheetTaskEdit<'_>,
) -> Result<Value, String> {
    let snapshot = read_board(board)?;
    let Some(existing) = snapshot.tasks.iter().find(|t| t.id == task_id) else {
        return Err(format!("There is no task `{task_id}`."));
    };
    let title = match patch.title {
        Some(t) => {
            let trimmed = t.trim();
            if trimmed.is_empty() {
                return Err("A task needs a title.".to_string());
            }
            trimmed.to_string()
        }
        None => existing.title.clone(),
    };
    let priority = match patch.priority {
        Some(p) => check_priority(p)?,
        None => existing.priority.clone(),
    };
    let assignee = patch
        .assignee
        .map(str::to_string)
        .unwrap_or_else(|| existing.assignee.clone());
    let issue_id = patch
        .issue_id
        .map(str::to_string)
        .unwrap_or_else(|| existing.issue_id.clone());
    let des = patch
        .des
        .map(str::to_string)
        .unwrap_or_else(|| existing.des.clone());

    let mut task_payload = json!({
        "id": existing.id,
        "title": title,
        "jiraId": issue_id,
        "des": des,
        "task": existing.column,
        "priority": priority,
        "assignee": assignee,
    });
    if let Some(append) = patch.append_des {
        if !append.is_empty() {
            task_payload["appendDes"] = json!(append);
        }
    }
    post_script(
        board,
        json!({
            "action": "upsert",
            "task": task_payload,
        }),
    )?;
    let refreshed = read_board(board)?;
    if let Some(updated) = refreshed.tasks.iter().find(|t| t.id == task_id) {
        return Ok(task_to_json(updated));
    }
    Ok(json!({
        "id": existing.id,
        "title": title,
        "issueId": issue_id,
        "des": des,
        "column": existing.column,
        "priority": priority,
        "assignee": assignee,
    }))
}

pub fn move_tasks(
    board: &SheetBoard,
    task_ids: &[String],
    column: &str,
    before_id: Option<&str>,
    after_id: Option<&str>,
) -> Result<Vec<Value>, String> {
    let snapshot = read_board(board)?;
    if !snapshot.columns.is_empty() && !snapshot.columns.iter().any(|c| c == column) {
        return Err(format!(
            "There is no column `{column}`. The columns are: {}.",
            snapshot.columns.join(", ")
        ));
    }
    for id in task_ids {
        if !snapshot.tasks.iter().any(|t| t.id == *id) {
            return Err(format!("There is no task `{id}`."));
        }
    }
    if let Some(b) = before_id {
        if !snapshot.tasks.iter().any(|t| t.id == b) {
            return Err(format!("There is no task `{b}`."));
        }
    }
    if let Some(a) = after_id {
        if !snapshot.tasks.iter().any(|t| t.id == a) {
            return Err(format!("There is no task `{a}`."));
        }
    }

    let mut anchor_after: Option<String> = after_id.map(str::to_string);
    let mut use_before: Option<&str> = before_id;
    for id in task_ids {
        let mut payload = json!({
            "action": "move",
            "id": id,
            "status": column,
        });
        if let Some(b) = use_before.take() {
            payload["beforeId"] = json!(b);
        } else if let Some(ref a) = anchor_after {
            payload["afterId"] = json!(a);
        }
        post_script(board, payload)?;
        anchor_after = Some(id.clone());
    }

    let refreshed = read_board(board)?;
    Ok(task_ids
        .iter()
        .filter_map(|id| refreshed.tasks.iter().find(|t| t.id == *id))
        .map(task_to_json)
        .collect())
}

pub fn delete_task(board: &SheetBoard, task_id: &str) -> Result<(), String> {
    post_script(
        board,
        json!({
            "action": "delete",
            "id": task_id,
        }),
    )?;
    Ok(())
}

pub fn restore_task(
    board: &SheetBoard,
    task_id: &str,
    column: Option<&str>,
    before_id: Option<&str>,
    after_id: Option<&str>,
) -> Result<Value, String> {
    let snapshot = read_board(board)?;
    let Some(deleted) = snapshot.history.iter().rev().find(|h| h.id == task_id) else {
        return Err(format!("There is no deleted task `{task_id}`."));
    };
    let target_col = column.unwrap_or(&deleted.column);
    if !snapshot.columns.is_empty() && !snapshot.columns.iter().any(|c| c == target_col) {
        return Err(format!(
            "Column `{target_col}` no longer exists. Pass --column with one of: {}.",
            snapshot.columns.join(", ")
        ));
    }
    let mut payload = json!({
        "action": "restore",
        "id": task_id,
    });
    if let Some(col) = column {
        payload["column"] = json!(col);
    }
    if let Some(b) = before_id {
        payload["beforeId"] = json!(b);
    }
    if let Some(a) = after_id {
        payload["afterId"] = json!(a);
    }
    post_script(board, payload)?;
    let refreshed = read_board(board)?;
    if let Some(restored) = refreshed.tasks.iter().find(|t| t.id == task_id) {
        return Ok(task_to_json(restored));
    }
    Ok(json!({
        "id": deleted.id,
        "title": deleted.title,
        "column": target_col,
    }))
}
