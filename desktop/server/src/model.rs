//! What a board file holds. Field names are camelCase in the files and in the
//! API, matching the web UI.

use serde::{Deserialize, Serialize};

/// Bumped when the file layout changes in a way older versions can't read.
pub const FILE_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub issue_id: String,
    pub des: String,
    /// Name of the column the task is in.
    pub column: String,
    pub priority: String,
    pub assignee: String,
    /// UTC, like `2026-11-16T08:30:00.000Z`.
    pub created_at: String,
    pub updated_at: String,
    /// UTC time the task last entered its current column. Empty for tasks
    /// saved before this was tracked.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub moved_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeletedTask {
    #[serde(flatten)]
    pub task: Task,
    pub deleted_at: String,
    /// The tasks right before and after it in its column when it was deleted,
    /// to put it back in the same place. Empty when there was none, and in
    /// files from before restoring existed.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub previous_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub next_id: String,
}

/// One board file. `tasks` is in board order: a column shows its tasks in the
/// order they appear here.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Board {
    pub version: u32,
    pub id: String,
    pub title: String,
    /// Prefix for issue links, e.g. `https://github.com/OWNER/REPO/issues/`.
    pub issue_link: String,
    /// Boards are listed oldest first.
    pub created_at: String,
    pub columns: Vec<String>,
    pub users: Vec<String>,
    pub tasks: Vec<Task>,
    /// Deleted tasks, oldest first.
    pub history: Vec<DeletedTask>,
}

/// A board without its tasks and history.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub id: String,
    pub title: String,
    pub issue_link: String,
    pub columns: Vec<String>,
    pub users: Vec<String>,
    pub task_count: usize,
}

impl From<&Board> for BoardInfo {
    fn from(board: &Board) -> Self {
        Self {
            id: board.id.clone(),
            title: board.title.clone(),
            issue_link: board.issue_link.clone(),
            columns: board.columns.clone(),
            users: board.users.clone(),
            task_count: board.tasks.len(),
        }
    }
}
