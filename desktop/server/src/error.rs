//! Errors the API answers with: `{ "error": { "code", "message", ... } }`.
//! The web UI translates by `code`; `message` is for people reading raw
//! responses (and for AI agents).

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    /// Extra fields for the UI's message, e.g. `{ "column": "Doing" }`.
    pub params: Value,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            params: json!({}),
        }
    }

    fn with(mut self, params: Value) -> Self {
        self.params = params;
        self
    }

    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Missing or wrong API token. Send it as `Authorization: Bearer <token>`.",
        )
    }

    pub fn forbidden_host() -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN_HOST",
            "This server only answers requests addressed to 127.0.0.1 or localhost.",
        )
    }

    pub fn board_not_found(id: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "BOARD_NOT_FOUND",
            format!("No board with id `{id}`."),
        )
        .with(json!({ "id": id }))
    }

    pub fn task_not_found(id: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "TASK_NOT_FOUND",
            format!("No task with id `{id}` on this board."),
        )
        .with(json!({ "id": id }))
    }

    pub fn deleted_task_not_found(id: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "DELETED_TASK_NOT_FOUND",
            format!("No deleted task with id `{id}` on this board. The deleted tasks list shows their ids."),
        )
        .with(json!({ "id": id }))
    }

    pub fn task_exists(id: &str) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "TASK_EXISTS",
            format!("A task with id `{id}` is on the board already, so the deleted one can't be brought back under that id."),
        )
        .with(json!({ "id": id }))
    }

    pub fn column_gone(column: &str, columns: &[String]) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "COLUMN_GONE",
            format!(
                "The task was in column `{column}`, which this board no longer has. Give the column to put it back in; the board's columns are: {}.",
                columns.join(", ")
            ),
        )
        .with(json!({ "column": column }))
    }

    pub fn unknown_column(column: &str, columns: &[String]) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "UNKNOWN_COLUMN",
            format!(
                "This board has no column named `{column}`. Its columns are: {}.",
                columns.join(", ")
            ),
        )
        .with(json!({ "column": column }))
    }

    pub fn no_columns() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "NO_COLUMNS",
            "This board has no columns yet, so it can't hold tasks.",
        )
    }

    pub fn invalid(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }

    pub fn column_not_empty(column: &str, count: usize) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "COLUMN_NOT_EMPTY",
            format!("Column `{column}` still has {count} task(s). Move or delete them before removing the column."),
        )
        .with(json!({ "column": column, "count": count }))
    }

    pub fn label_in_use(label: &str, count: usize) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "LABEL_IN_USE",
            format!("Label `{label}` is still used by {count} task(s). Remove it from those tasks before deleting the label."),
        )
        .with(json!({ "label": label, "count": count }))
    }

    pub fn unsupported_file(id: &str) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "UNSUPPORTED_BOARD_FILE",
            format!("Board `{id}` was saved by a newer version of SAF Kanban."),
        )
        .with(json!({ "id": id }))
    }

    pub fn storage(error: impl std::fmt::Display) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "STORAGE_ERROR",
            format!("Could not read or write the board file: {error}"),
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut error = json!({ "code": self.code, "message": self.message });
        if let (Some(target), Some(params)) = (error.as_object_mut(), self.params.as_object()) {
            if !params.is_empty() {
                target.insert("params".into(), self.params.clone());
            }
        }
        (self.status, Json(json!({ "error": error }))).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
