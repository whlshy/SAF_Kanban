//! Plain-text formatting and board view filtering for `saf-kanban-cli`.

use serde_json::{json, Value};

use super::Failure;

pub(super) fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

/// `[id] title · column · priority · assignee · #label1 #label2 · issue X`, leaving out what is empty.
pub(super) fn task_line(task: &Value, with_column: bool) -> String {
    let mut parts = vec![format!("[{}] {}", text(&task["id"]), text(&task["title"]))];
    if with_column {
        parts.push(text(&task["column"]).to_string());
    }
    for field in ["priority", "assignee"] {
        if !text(&task[field]).is_empty() {
            parts.push(text(&task[field]).to_string());
        }
    }
    if let Some(labels) = task["labels"].as_array() {
        let tags: Vec<String> = labels
            .iter()
            .map(text)
            .filter(|name| !name.is_empty())
            .map(|name| format!("#{name}"))
            .collect();
        if !tags.is_empty() {
            parts.push(tags.join(" "));
        }
    }
    if !text(&task["issueId"]).is_empty() {
        parts.push(format!("issue {}", text(&task["issueId"])));
    }
    parts.join(" · ")
}

fn format_label_defs(value: &Value) -> String {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if let Some(name) = item.as_str() {
                        return (!name.is_empty()).then(|| name.to_string());
                    }
                    let name = text(&item["name"]);
                    if name.is_empty() {
                        return None;
                    }
                    let color = text(&item["color"]);
                    Some(if color.is_empty() {
                        name.to_string()
                    } else {
                        format!("{name} ({color})")
                    })
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
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

pub(super) fn show_boards(boards: &Value) -> String {
    let boards = boards.as_array().cloned().unwrap_or_default();
    if boards.is_empty() {
        return "There are no boards yet. Create one with `new-board <name>`.".to_string();
    }
    boards
        .iter()
        .map(|board| {
            if text(&board["type"]) == "sheet" {
                let sheet_id = text(&board["sheetId"]);
                let mut parts = vec![
                    format!("[{}] {}", text(&board["id"]), text(&board["title"])),
                    "Google Sheet".to_string(),
                ];
                if !sheet_id.is_empty() {
                    parts.push(format!("sheet {sheet_id}"));
                }
                if !board["hasScript"].as_bool().unwrap_or(false) {
                    parts.push("no Apps Script".to_string());
                }
                return parts.join(" · ");
            }
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

pub(super) fn show_board(board: &Value) -> String {
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
    let labels = format_label_defs(&board["labels"]);
    if !labels.is_empty() {
        out.push(format!("Labels: {labels}"));
    }
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

pub(super) fn show_tasks(tasks: &Value) -> String {
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

pub(super) fn show_task(task: &Value) -> String {
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
    if let Some(labels) = task["labels"].as_array() {
        let names: Vec<&str> = labels
            .iter()
            .map(text)
            .filter(|name| !name.is_empty())
            .collect();
        if !names.is_empty() {
            out.push(format!("{:<10} {}", "labels", names.join(", ")));
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

pub(super) fn show_deleted(tasks: &Value) -> String {
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

pub(super) fn show_board_info(verb: &str, board: &Value) -> String {
    if text(&board["type"]) == "sheet" {
        let mut lines = vec![format!(
            "{verb} Google Sheet board [{}] {}",
            text(&board["id"]),
            text(&board["title"])
        )];
        if !text(&board["sheetId"]).is_empty() {
            lines.push(format!("Sheet ID: {}", text(&board["sheetId"])));
        }
        if !text(&board["issueLink"]).is_empty() {
            lines.push(format!("Issue link: {}", text(&board["issueLink"])));
        }
        return lines.join("\n");
    }
    let names = |field: &str| -> String {
        board[field]
            .as_array()
            .map(|names| names.iter().map(text).collect::<Vec<_>>().join(", "))
            .filter(|joined| !joined.is_empty())
            .unwrap_or_else(|| "(none)".to_string())
    };
    let mut lines = vec![
        format!(
            "{verb} board [{}] {}",
            text(&board["id"]),
            text(&board["title"])
        ),
        format!("Columns: {}", names("columns")),
        format!("Assignees: {}", names("users")),
    ];
    let labels = format_label_defs(&board["labels"]);
    if !labels.is_empty() {
        lines.push(format!("Labels: {labels}"));
    }
    lines.join("\n")
}

/// Applies `--column` and `--limit` filters to a board view from `get_board`.
pub(super) fn filter_board(
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
