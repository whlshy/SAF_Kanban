//! Task CRUD, movement, deletion, restore, and history operations on [`Store`].

use std::collections::HashSet;

use crate::error::{ApiError, ApiResult};
use crate::model::{Board, DeletedTask, Task};

use super::{
    apply_label_mutations, check_column, clean_labels, find_task, new_id, now, parse_time_bound,
    valid_id, MoveInput, RestoreInput, Store, TaskInput, TaskQuery, DEFAULT_PRIORITY,
};

impl Store {
    pub fn list_tasks(&self, board_id: &str, query: &TaskQuery) -> ApiResult<Vec<Task>> {
        let board = self.get_board(board_id)?;
        if let Some(column) = &query.column {
            check_column(&board, column)?;
        }
        let since = query
            .since
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| parse_time_bound(value, false))
            .transpose()?;
        let until = query
            .until
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| parse_time_bound(value, true))
            .transpose()?;
        let terms: Vec<String> = query
            .q
            .as_deref()
            .unwrap_or("")
            .to_lowercase()
            .split_whitespace()
            .map(str::to_string)
            .collect();
        let mut tasks: Vec<Task> = board
            .tasks
            .into_iter()
            .filter(|task| {
                query
                    .column
                    .as_ref()
                    .is_none_or(|column| &task.column == column)
            })
            .filter(|task| {
                query
                    .assignee
                    .as_ref()
                    .is_none_or(|assignee| &task.assignee == assignee)
            })
            .filter(|task| {
                query
                    .priority
                    .as_ref()
                    .is_none_or(|priority| &task.priority == priority)
            })
            .filter(|task| match query.label.as_deref() {
                None => true,
                Some(wanted) => {
                    let needle = wanted.trim().to_lowercase();
                    if needle.is_empty() || needle == "__unlabeled__" {
                        task.labels.is_empty()
                    } else {
                        task.labels.iter().any(|l| l.to_lowercase() == needle)
                    }
                }
            })
            .filter(|task| {
                since
                    .as_ref()
                    .is_none_or(|bound| !task.moved_at.is_empty() && task.moved_at >= *bound)
            })
            .filter(|task| {
                until
                    .as_ref()
                    .is_none_or(|bound| !task.moved_at.is_empty() && task.moved_at <= *bound)
            })
            .filter(|task| {
                let mut fields = vec![
                    task.title.to_lowercase(),
                    task.des.to_lowercase(),
                    task.issue_id.to_lowercase(),
                    task.assignee.to_lowercase(),
                ];
                fields.extend(task.labels.iter().map(|l| l.to_lowercase()));
                let haystack = fields.join("\n");
                terms.iter().all(|term| haystack.contains(term))
            })
            .collect();
        if let Some(limit) = query.limit {
            tasks.sort_by(
                |a, b| match (a.moved_at.is_empty(), b.moved_at.is_empty()) {
                    (true, true) => std::cmp::Ordering::Equal,
                    (true, false) => std::cmp::Ordering::Greater,
                    (false, true) => std::cmp::Ordering::Less,
                    (false, false) => b.moved_at.cmp(&a.moved_at),
                },
            );
            tasks.truncate(limit);
        }
        Ok(tasks)
    }

    pub fn get_task(&self, board_id: &str, task_id: &str) -> ApiResult<Task> {
        let board = self.get_board(board_id)?;
        let index = find_task(&board, task_id)?;
        Ok(board.tasks[index].clone())
    }

    /// Adds a task at the end of the board order, in the first column unless
    /// one is given.
    pub fn create_task(&self, board_id: &str, input: TaskInput) -> ApiResult<Task> {
        let (task, labels_grew) = self.update(board_id, |board| {
            let mut id = new_id();
            while board.tasks.iter().any(|task| task.id == id) {
                id = new_id();
            }
            let task = add_task(board, id, input)?;
            let grew = super::sync_board_labels(board, &task.labels);
            Ok((task, grew))
        })?;
        if labels_grew {
            self.announce("boards", Some(board_id));
        }
        Ok(task)
    }

    /// Replaces the task with this id, or creates it. Used by the web UI,
    /// which picks the id of a new task itself.
    pub fn put_task(&self, board_id: &str, task_id: &str, input: TaskInput) -> ApiResult<Task> {
        if !valid_id(task_id) {
            return Err(ApiError::invalid(
                "INVALID_TASK_ID",
                "A task id may only contain letters, digits, `-` and `_` (at most 64).",
            ));
        }
        let (task, labels_grew) = self.update(board_id, |board| {
            match board.tasks.iter().position(|task| task.id == task_id) {
                None => {
                    let task = add_task(board, task_id.to_string(), input)?;
                    let grew = super::sync_board_labels(board, &task.labels);
                    Ok((task, grew))
                }
                Some(index) => {
                    let column = match input.column.filter(|column| !column.is_empty()) {
                        Some(column) => {
                            check_column(board, &column)?;
                            column
                        }
                        None => board.tasks[index].column.clone(),
                    };
                    let time = now();
                    let new_labels = clean_labels(input.labels.unwrap_or_default());
                    let task_clone = {
                        let task = &mut board.tasks[index];
                        task.title = input.title.unwrap_or_default();
                        task.issue_id = input.issue_id.unwrap_or_default();
                        task.des = input.des.unwrap_or_default();
                        task.priority = input.priority.unwrap_or_default();
                        task.assignee = input.assignee.unwrap_or_default();
                        task.labels = new_labels;
                        if task.column != column {
                            task.moved_at = time.clone();
                        }
                        task.column = column;
                        task.updated_at = time;
                        task.clone()
                    };
                    let grew = super::sync_board_labels(board, &task_clone.labels);
                    Ok((task_clone, grew))
                }
            }
        })?;
        if labels_grew {
            self.announce("boards", Some(board_id));
        }
        Ok(task)
    }

    /// Changes only the fields that are given.
    pub fn patch_task(&self, board_id: &str, task_id: &str, input: TaskInput) -> ApiResult<Task> {
        if input.des.is_some() && input.append_des.is_some() {
            return Err(ApiError::invalid(
                "CONFLICTING_FIELDS",
                "Give either `description` or `appendDescription`, not both.",
            ));
        }
        let (task, labels_grew) = self.update(board_id, |board| {
            let index = find_task(board, task_id)?;
            if let Some(column) = &input.column {
                check_column(board, column)?;
            }
            let time = now();
            let task_clone = {
                let task = &mut board.tasks[index];
                if let Some(title) = input.title {
                    task.title = title;
                }
                if let Some(issue_id) = input.issue_id {
                    task.issue_id = issue_id;
                }
                if let Some(des) = input.des {
                    task.des = des;
                }
                if let Some(append) = input.append_des {
                    if !append.is_empty() {
                        let existing = task.des.trim_end_matches(['\r', '\n']);
                        if existing.is_empty() {
                            task.des = append;
                        } else {
                            task.des = format!("{existing}\n\n{append}");
                        }
                    }
                }
                if let Some(column) = input.column {
                    if task.column != column {
                        task.moved_at = time.clone();
                    }
                    task.column = column;
                }
                if let Some(priority) = input.priority {
                    task.priority = priority;
                }
                if let Some(assignee) = input.assignee {
                    task.assignee = assignee;
                }
                if input.labels.is_some()
                    || input.add_labels.is_some()
                    || input.remove_labels.is_some()
                {
                    let base = input.labels.unwrap_or_else(|| task.labels.clone());
                    task.labels =
                        apply_label_mutations(base, input.add_labels, input.remove_labels);
                }
                task.updated_at = time;
                task.clone()
            };
            let grew = super::sync_board_labels(board, &task_clone.labels);
            Ok((task_clone, grew))
        })?;
        if labels_grew {
            self.announce("boards", Some(board_id));
        }
        Ok(task)
    }

    pub fn move_task(&self, board_id: &str, task_id: &str, input: MoveInput) -> ApiResult<Task> {
        self.update(board_id, |board| {
            let index = find_task(board, task_id)?;
            check_column(board, &input.column)?;
            // A neighbour that doesn't exist (or is the task itself) is ignored,
            // like a neighbour that was deleted in the meantime.
            let neighbour = |id: &Option<String>| {
                id.as_deref()
                    .filter(|id| *id != task_id && board.tasks.iter().any(|task| task.id == *id))
                    .map(str::to_string)
            };
            let before = neighbour(&input.before_id);
            let after = neighbour(&input.after_id);

            let time = now();
            let mut task = board.tasks.remove(index);
            if task.column != input.column {
                task.moved_at = time.clone();
            }
            task.column = input.column.clone();
            task.updated_at = time;
            let position = |id: &str| board.tasks.iter().position(|task| task.id == id);
            let target = match (before, after) {
                (Some(before), _) => position(&before).unwrap_or(index),
                (None, Some(after)) => position(&after).map(|at| at + 1).unwrap_or(index),
                (None, None) => index,
            };
            board
                .tasks
                .insert(target.min(board.tasks.len()), task.clone());
            Ok(task)
        })
    }

    /// Moves several tasks to a column in a single write. If any task id
    /// doesn't exist, nothing is changed.
    pub fn move_tasks(
        &self,
        board_id: &str,
        task_ids: &[String],
        input: MoveInput,
    ) -> ApiResult<Vec<Task>> {
        self.update(board_id, |board| {
            check_column(board, &input.column)?;
            let mut seen = HashSet::new();
            let mut unique_ids = Vec::new();
            for id in task_ids {
                find_task(board, id)?;
                if seen.insert(id.as_str()) {
                    unique_ids.push(id.clone());
                }
            }
            let moving: HashSet<&str> = unique_ids.iter().map(String::as_str).collect();
            let neighbour = |id: &Option<String>| {
                id.as_deref()
                    .filter(|id| {
                        !moving.contains(*id) && board.tasks.iter().any(|task| task.id == *id)
                    })
                    .map(str::to_string)
            };
            let before = neighbour(&input.before_id);
            let after = neighbour(&input.after_id);
            let time = now();

            if before.is_none() && after.is_none() {
                let mut moved = Vec::with_capacity(unique_ids.len());
                for id in &unique_ids {
                    let index = find_task(board, id)?;
                    let task = &mut board.tasks[index];
                    if task.column != input.column {
                        task.moved_at = time.clone();
                    }
                    task.column = input.column.clone();
                    task.updated_at = time.clone();
                    moved.push(task.clone());
                }
                return Ok(moved);
            }

            let mut moved = Vec::with_capacity(unique_ids.len());
            for id in &unique_ids {
                let index = find_task(board, id)?;
                let mut task = board.tasks.remove(index);
                if task.column != input.column {
                    task.moved_at = time.clone();
                }
                task.column = input.column.clone();
                task.updated_at = time.clone();
                moved.push(task);
            }
            let position = |id: &str| board.tasks.iter().position(|task| task.id == id);
            let target = match (before, after) {
                (Some(before), _) => position(&before).unwrap_or(board.tasks.len()),
                (None, Some(after)) => position(&after)
                    .map(|at| at + 1)
                    .unwrap_or(board.tasks.len()),
                (None, None) => board.tasks.len(),
            };
            let target = target.min(board.tasks.len());
            board.tasks.splice(target..target, moved.iter().cloned());
            Ok(moved)
        })
    }

    /// Removes the task from the board and keeps it in the board's history,
    /// with where it was, so it can be restored.
    pub fn delete_task(&self, board_id: &str, task_id: &str) -> ApiResult<()> {
        self.update(board_id, |board| {
            let index = find_task(board, task_id)?;
            let column = board.tasks[index].column.clone();
            let same_column = |task: &&Task| task.column == column;
            let previous_id = board.tasks[..index].iter().rev().find(same_column);
            let next_id = board.tasks[index + 1..].iter().find(same_column);
            let (previous_id, next_id) = (
                previous_id.map(|task| task.id.clone()).unwrap_or_default(),
                next_id.map(|task| task.id.clone()).unwrap_or_default(),
            );
            let task = board.tasks.remove(index);
            board.history.push(DeletedTask {
                task,
                deleted_at: now(),
                previous_id,
                next_id,
            });
            Ok(())
        })
    }

    /// Puts a deleted task back on the board as it was: the same id, contents
    /// and creation time, in the column and place it was deleted from where
    /// they still exist. Not a new task made from the old one.
    pub fn restore_task(
        &self,
        board_id: &str,
        task_id: &str,
        input: RestoreInput,
    ) -> ApiResult<Task> {
        let (task, labels_grew) = self.update(board_id, |board| {
            // The latest deletion, if the same id was deleted more than once.
            let at = board
                .history
                .iter()
                .rposition(|deleted| deleted.task.id == task_id)
                .ok_or_else(|| ApiError::deleted_task_not_found(task_id))?;
            if board.tasks.iter().any(|task| task.id == task_id) {
                return Err(ApiError::task_exists(task_id));
            }
            let deleted = &board.history[at];
            let column = match input.column.filter(|column| !column.is_empty()) {
                Some(column) => {
                    check_column(board, &column)?;
                    column
                }
                None if board.columns.contains(&deleted.task.column) => deleted.task.column.clone(),
                None => return Err(ApiError::column_gone(&deleted.task.column, &board.columns)),
            };

            let position = |id: Option<&str>| {
                id.filter(|id| !id.is_empty())
                    .and_then(|id| board.tasks.iter().position(|task| task.id == id))
            };
            // Its old neighbours count only if they are still in that column.
            let neighbour =
                |id: &str| position(Some(id)).filter(|index| board.tasks[*index].column == column);
            let back_home = column == deleted.task.column;
            let target = if let Some(index) = position(input.before_id.as_deref()) {
                index
            } else if let Some(index) = position(input.after_id.as_deref()) {
                index + 1
            } else if let Some(index) = neighbour(&deleted.next_id).filter(|_| back_home) {
                index
            } else if let Some(index) = neighbour(&deleted.previous_id).filter(|_| back_home) {
                index + 1
            } else {
                // The end of the column.
                board.tasks.len()
            };

            let time = now();
            let mut task = board.history.remove(at).task;
            if !back_home {
                task.moved_at = time.clone();
            }
            task.column = column;
            task.updated_at = time;
            let grew = super::sync_board_labels(board, &task.labels);
            board.tasks.insert(target, task.clone());
            Ok((task, grew))
        })?;
        if labels_grew {
            self.announce("boards", Some(board_id));
        }
        Ok(task)
    }

    /// Deleted tasks, newest first.
    pub fn history(&self, board_id: &str) -> ApiResult<Vec<DeletedTask>> {
        let mut history = self.get_board(board_id)?.history;
        history.reverse();
        Ok(history)
    }
}

fn add_task(board: &mut Board, id: String, input: TaskInput) -> ApiResult<Task> {
    let column = match input.column.filter(|column| !column.is_empty()) {
        Some(column) => {
            check_column(board, &column)?;
            column
        }
        None => board
            .columns
            .first()
            .cloned()
            .ok_or_else(ApiError::no_columns)?,
    };
    let time = now();
    let task = Task {
        id,
        title: input.title.unwrap_or_default(),
        issue_id: input.issue_id.unwrap_or_default(),
        des: input.des.unwrap_or_default(),
        column,
        priority: input
            .priority
            .filter(|priority| !priority.is_empty())
            .unwrap_or_else(|| DEFAULT_PRIORITY.to_string()),
        assignee: input.assignee.unwrap_or_default(),
        labels: apply_label_mutations(
            input.labels.unwrap_or_default(),
            input.add_labels,
            input.remove_labels,
        ),
        created_at: time.clone(),
        updated_at: time.clone(),
        moved_at: time,
    };
    board.tasks.push(task.clone());
    Ok(task)
}
