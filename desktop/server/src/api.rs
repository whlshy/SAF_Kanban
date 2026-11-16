//! The HTTP API under `/api`, and the web UI on every other path.
//!
//! | Method and path                              | Does                                   |
//! | -------------------------------------------- | -------------------------------------- |
//! | GET    /api/info                             | Server name and version                |
//! | GET    /api/boards                           | List boards                            |
//! | POST   /api/boards                           | Create a board                         |
//! | GET    /api/boards/{board}                   | One board (columns, users)             |
//! | PATCH  /api/boards/{board}                   | Rename; change columns, users          |
//! | DELETE /api/boards/{board}                   | Move the board file to the trash       |
//! | GET    /api/boards/{board}/tasks             | Tasks, optionally filtered             |
//! | POST   /api/boards/{board}/tasks             | Create a task                          |
//! | GET    /api/boards/{board}/tasks/{task}      | One task                               |
//! | PUT    /api/boards/{board}/tasks/{task}      | Replace a task, or create it           |
//! | PATCH  /api/boards/{board}/tasks/{task}      | Change some fields                     |
//! | POST   /api/boards/{board}/tasks/{task}/move | Move to a column and position          |
//! | DELETE /api/boards/{board}/tasks/{task}      | Delete (kept in the history)           |
//! | GET    /api/boards/{board}/history           | Deleted tasks, newest first            |
//! | GET    /api/events                           | Server-sent events, one per change     |
//!
//! Every `/api` request needs `Authorization: Bearer <token>`; `/api/events`
//! also takes `?token=`, because browsers can't set headers on an EventSource.

use std::convert::Infallible;
use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use crate::error::{ApiError, ApiResult};
use crate::model::{Board, BoardInfo, DeletedTask, Task};
use crate::store::{BoardPatch, MoveInput, NewBoard, Store, TaskInput, TaskQuery};

pub struct AppState {
    pub store: Store,
    pub token: String,
    /// The port the server listens on, to recognise requests meant for it.
    pub port: u16,
    /// Folder with the built web UI, if it should be served.
    pub ui_dir: Option<PathBuf>,
}

type Shared = Arc<AppState>;

pub fn router(state: Shared) -> Router {
    let api = Router::new()
        .route("/info", get(info))
        .route("/boards", get(list_boards).post(create_board))
        .route(
            "/boards/{board}",
            get(get_board).patch(update_board).delete(delete_board),
        )
        .route("/boards/{board}/tasks", get(list_tasks).post(create_task))
        .route(
            "/boards/{board}/tasks/{task}",
            get(get_task)
                .put(put_task)
                .patch(patch_task)
                .delete(delete_task),
        )
        .route("/boards/{board}/tasks/{task}/move", post(move_task))
        .route("/boards/{board}/history", get(history))
        .route("/events", get(events))
        .fallback(|| async {
            ApiError::invalid("UNKNOWN_ENDPOINT", "No such API endpoint.")
                .into_response_with(StatusCode::NOT_FOUND)
        })
        .layer(middleware::from_fn_with_state(state.clone(), require_token));

    Router::new()
        .nest("/api", api)
        .fallback(serve_ui)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_local_host,
        ))
        .with_state(state)
}

impl ApiError {
    fn into_response_with(mut self, status: StatusCode) -> Response {
        self.status = status;
        self.into_response()
    }
}

// ---- guards ----

/// A web page on another site can make the browser send requests here. It
/// can't read the answers (no CORS headers are sent), unless its own domain
/// name is pointed at 127.0.0.1 ("DNS rebinding"); then the request arrives
/// with that domain as its Host, and is refused here.
async fn require_local_host(State(state): State<Shared>, request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let allowed = [
        format!("127.0.0.1:{}", state.port),
        format!("localhost:{}", state.port),
    ];
    if !allowed.iter().any(|name| name == host) {
        return ApiError::forbidden_host().into_response();
    }
    next.run(request).await
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

async fn require_token(State(state): State<Shared>, request: Request, next: Next) -> Response {
    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string);
    let in_query = if request.uri().path().ends_with("/events") {
        Query::<TokenQuery>::try_from_uri(request.uri())
            .ok()
            .and_then(|query| query.0.token)
    } else {
        None
    };
    if bearer.or(in_query).as_deref() != Some(state.token.as_str()) {
        return ApiError::unauthorized().into_response();
    }
    next.run(request).await
}

// ---- boards ----

async fn info() -> Json<Value> {
    Json(json!({ "app": "saf-kanban", "version": env!("CARGO_PKG_VERSION"), "api": 1 }))
}

async fn list_boards(State(state): State<Shared>) -> ApiResult<Json<Vec<BoardInfo>>> {
    state.store.list_boards().map(Json)
}

async fn create_board(
    State(state): State<Shared>,
    Json(input): Json<NewBoard>,
) -> ApiResult<(StatusCode, Json<BoardInfo>)> {
    Ok((StatusCode::CREATED, Json(state.store.create_board(input)?)))
}

async fn get_board(
    State(state): State<Shared>,
    Path(board): Path<String>,
) -> ApiResult<Json<BoardInfo>> {
    let board: Board = state.store.get_board(&board)?;
    Ok(Json(BoardInfo::from(&board)))
}

async fn update_board(
    State(state): State<Shared>,
    Path(board): Path<String>,
    Json(patch): Json<BoardPatch>,
) -> ApiResult<Json<BoardInfo>> {
    state.store.update_board(&board, patch).map(Json)
}

async fn delete_board(
    State(state): State<Shared>,
    Path(board): Path<String>,
) -> ApiResult<StatusCode> {
    state.store.delete_board(&board)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---- tasks ----

async fn list_tasks(
    State(state): State<Shared>,
    Path(board): Path<String>,
    Query(query): Query<TaskQuery>,
) -> ApiResult<Json<Vec<Task>>> {
    state.store.list_tasks(&board, &query).map(Json)
}

async fn create_task(
    State(state): State<Shared>,
    Path(board): Path<String>,
    Json(input): Json<TaskInput>,
) -> ApiResult<(StatusCode, Json<Task>)> {
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_task(&board, input)?),
    ))
}

async fn get_task(
    State(state): State<Shared>,
    Path((board, task)): Path<(String, String)>,
) -> ApiResult<Json<Task>> {
    state.store.get_task(&board, &task).map(Json)
}

async fn put_task(
    State(state): State<Shared>,
    Path((board, task)): Path<(String, String)>,
    Json(input): Json<TaskInput>,
) -> ApiResult<Json<Task>> {
    state.store.put_task(&board, &task, input).map(Json)
}

async fn patch_task(
    State(state): State<Shared>,
    Path((board, task)): Path<(String, String)>,
    Json(input): Json<TaskInput>,
) -> ApiResult<Json<Task>> {
    state.store.patch_task(&board, &task, input).map(Json)
}

async fn move_task(
    State(state): State<Shared>,
    Path((board, task)): Path<(String, String)>,
    Json(input): Json<MoveInput>,
) -> ApiResult<Json<Task>> {
    state.store.move_task(&board, &task, input).map(Json)
}

async fn delete_task(
    State(state): State<Shared>,
    Path((board, task)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    state.store.delete_task(&board, &task)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn history(
    State(state): State<Shared>,
    Path(board): Path<String>,
) -> ApiResult<Json<Vec<DeletedTask>>> {
    state.store.history(&board).map(Json)
}

// ---- events ----

/// One `change` event per change: `{ "kind": "board" | "boards", "boardId" }`.
async fn events(State(state): State<Shared>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.store.subscribe()).filter_map(|change| {
        // A listener that fell behind missed some changes; tell it to reload everything.
        let data = match change {
            Ok(change) => serde_json::to_string(&change).ok()?,
            Err(_) => json!({ "kind": "boards" }).to_string(),
        };
        Some(Ok(Event::default().event("change").data(data)))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ---- web UI ----

fn content_type(path: &FsPath) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Serves a file of the web UI, or the page itself for any other path (the UI
/// has its own routing). The page gets the API token written into it: only
/// this computer can load it, and other sites can't read it.
async fn serve_ui(State(state): State<Shared>, uri: Uri) -> Response {
    let Some(ui_dir) = &state.ui_dir else {
        return (
            StatusCode::NOT_FOUND,
            "The web UI isn't included in this server. The API is under /api.",
        )
            .into_response();
    };

    let relative = FsPath::new(uri.path().trim_start_matches('/'));
    let is_plain = relative
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    let file = ui_dir.join(relative);
    if is_plain
        && !uri.path().ends_with('/')
        && file.is_file()
        && file.file_name().is_some_and(|name| name != "index.html")
    {
        return match std::fs::read(&file) {
            Ok(bytes) => (
                [(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static(content_type(&file)),
                )],
                Body::from(bytes),
            )
                .into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        };
    }

    match std::fs::read_to_string(ui_dir.join("index.html")) {
        Ok(page) => {
            let settings =
                json!({ "token": state.token, "serverVersion": env!("CARGO_PKG_VERSION") });
            let script = format!("<script>window.__SAF_KANBAN_LOCAL__={settings};</script></head>");
            (
                [
                    (
                        header::CONTENT_TYPE,
                        HeaderValue::from_static("text/html; charset=utf-8"),
                    ),
                    (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
                ],
                page.replacen("</head>", &script, 1),
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "The web UI files are missing.").into_response(),
    }
}
