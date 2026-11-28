//! The HTTP API under `/api`, and the web UI on every other path.
//!
//! | Method and path                              | Does                                   |
//! | -------------------------------------------- | -------------------------------------- |
//! | GET    /api/info                             | Server name and version                |
//! | GET    /api/boards                           | List boards                            |
//! | POST   /api/boards                           | Create a board, optionally with tasks  |
//! | GET    /api/boards/{board}                   | One board (columns, users)             |
//! | PATCH  /api/boards/{board}                   | Rename; change columns, users          |
//! | DELETE /api/boards/{board}                   | Move the board file to the trash       |
//! | GET    /api/boards/{board}/export            | The whole board, to keep or copy       |
//! | GET    /api/boards/{board}/tasks             | Tasks, optionally filtered             |
//! | POST   /api/boards/{board}/tasks             | Create a task                          |
//! | GET    /api/boards/{board}/tasks/{task}      | One task                               |
//! | PUT    /api/boards/{board}/tasks/{task}      | Replace a task, or create it           |
//! | PATCH  /api/boards/{board}/tasks/{task}      | Change some fields                     |
//! | POST   /api/boards/{board}/tasks/{task}/move | Move to a column and position          |
//! | DELETE /api/boards/{board}/tasks/{task}      | Delete (kept in the history)           |
//! | GET    /api/boards/{board}/history           | Deleted tasks, newest first            |
//! | POST   /api/boards/{board}/history/{task}/restore | Put a deleted task back as it was |
//! | GET    /api/events                           | Server-sent events, one per change     |
//! | GET    /api/connection                       | Addresses and paths for connecting     |
//! | POST   /api/token                            | Replace the API token                  |
//! | GET    /api/skill                            | The AI agent skill (`SKILL.md`)        |
//! | POST   /api/skill                            | Install the skill for AI agents        |
//! | POST   /mcp                                  | Model Context Protocol (see `mcp`)     |
//!
//! Every request to `/api` and `/mcp` needs `Authorization: Bearer <token>`;
//! `/api/events` also takes `?token=`, because browsers can't set headers on
//! an EventSource.

use std::convert::Infallible;
use std::path::Path as FsPath;
use std::sync::{Arc, RwLock};

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
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
use crate::mcp;
use crate::model::{Board, BoardInfo, DeletedTask, SheetBoard, Task};
use crate::store::{
    AttachmentInfo, BoardPatch, ExportedBoard, MoveInput, NewBoard, RestoreInput, Store, TaskInput,
    TaskQuery,
};
use crate::updater::{UpdateHandle, UpdateState};

pub struct AppState {
    pub store: Store,
    /// Replaced when the user asks for a new token.
    pub token: RwLock<String>,
    /// The port the server listens on, to recognise requests meant for it.
    pub port: u16,
    /// The built web UI, if it should be served.
    pub ui: Option<crate::UiFiles>,
    /// In-app updater handle when running inside the installed desktop app.
    pub updater: Option<Arc<UpdateHandle>>,
}

type Shared = Arc<AppState>;

pub fn router(state: Shared) -> Router {
    let api = Router::new()
        .route("/info", get(info))
        .route("/sheets", get(list_sheets).put(replace_sheets))
        .route("/boards", get(list_boards).post(create_board))
        .route(
            "/boards/{board}",
            get(get_board).patch(update_board).delete(delete_board),
        )
        .route("/boards/{board}/export", get(export_board))
        .route("/boards/{board}/attachments", post(upload_attachment))
        .route(
            "/boards/{board}/attachments/{filename}",
            get(get_attachment),
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
        .route("/boards/{board}/history/{task}/restore", post(restore_task))
        .route("/events", get(events))
        .route("/connection", get(connection))
        .route("/skill", get(skill).post(install_skill))
        .route("/token", post(new_token))
        .route("/update", get(update_status))
        .route("/update/check", post(check_update))
        .route("/update/install", post(install_update))
        .fallback(|| async {
            ApiError::invalid("UNKNOWN_ENDPOINT", "No such API endpoint.")
                .into_response_with(StatusCode::NOT_FOUND)
        })
        // A board sent whole, with its tasks and embedded attachments, can be large.
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), require_token));

    // Everything goes through POST; this server never opens a stream of its
    // own, which the protocol lets it say with 405.
    let mcp = Router::new()
        .route("/mcp", post(mcp_message))
        .layer(middleware::from_fn_with_state(state.clone(), require_token));

    Router::new()
        .nest("/api", api)
        .merge(mcp)
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
    // A browser names the page a request comes from; only this server's own
    // pages may call it. Programs that aren't browsers send no Origin.
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        let origin = origin.to_str().unwrap_or("");
        if !allowed
            .iter()
            .any(|name| origin == format!("http://{name}"))
        {
            return ApiError::forbidden_host().into_response();
        }
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
    if bearer.or(in_query) != Some(current_token(&state)) {
        return ApiError::unauthorized().into_response();
    }
    next.run(request).await
}

fn current_token(state: &AppState) -> String {
    state
        .token
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

// ---- server ----

async fn info(State(state): State<Shared>) -> Json<Value> {
    Json(json!({
        "app": "saf-kanban",
        "version": env!("CARGO_PKG_VERSION"),
        "api": 1,
        "canUpdate": state.updater.is_some(),
    }))
}

fn require_updater(state: &AppState) -> ApiResult<&Arc<UpdateHandle>> {
    state.updater.as_ref().ok_or_else(|| {
        ApiError::invalid(
            "UPDATER_UNAVAILABLE",
            "In-app updates are only available in the installed desktop app.",
        )
    })
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct CheckUpdateInput {
    silent: bool,
}

async fn update_status(State(state): State<Shared>) -> ApiResult<Json<UpdateState>> {
    Ok(Json(require_updater(&state)?.state()))
}

async fn check_update(State(state): State<Shared>, body: Bytes) -> ApiResult<Json<UpdateState>> {
    let updater = require_updater(&state)?;
    let input: CheckUpdateInput = if body.iter().all(u8::is_ascii_whitespace) {
        CheckUpdateInput::default()
    } else {
        serde_json::from_slice(&body).map_err(|error| {
            ApiError::invalid(
                "INVALID_JSON",
                format!("The request body isn't valid: {error}"),
            )
        })?
    };
    updater.check(input.silent);
    Ok(Json(updater.state()))
}

async fn install_update(State(state): State<Shared>) -> ApiResult<(StatusCode, Json<UpdateState>)> {
    let updater = require_updater(&state)?;
    updater
        .install()
        .map_err(|(code, message)| ApiError::invalid(code, message))?;
    Ok((StatusCode::ACCEPTED, Json(updater.state())))
}

/// What a person needs to connect another program: shown in the UI's
/// "AI / API" dialog.
async fn connection(State(state): State<Shared>) -> Json<Value> {
    let base = format!("http://127.0.0.1:{}", state.port);
    Json(json!({
        "apiUrl": format!("{base}/api"),
        "mcpUrl": format!("{base}/mcp"),
        "dataDir": state.store.dir(),
        // For apps that start an MCP server as a program: `<executable> mcp`.
        "executable": std::env::current_exe().ok(),
        // The command line, which the skill teaches agents to use.
        "cli": crate::skill::cli_path(),
    }))
}

fn skill_content(state: &AppState) -> String {
    crate::skill::skill_md(&crate::skill::cli_path(), state.store.dir())
}

/// The skill, and for each place it goes whether it is there and current.
async fn skill(State(state): State<Shared>) -> Json<Value> {
    let content = skill_content(&state);
    let places: Vec<Value> = crate::skill::places()
        .into_iter()
        .map(|(agents, file)| {
            let installed = std::fs::read_to_string(&file).ok();
            json!({
                "agents": agents,
                "file": file,
                "installed": installed.is_some(),
                "upToDate": installed.as_deref() == Some(content.as_str()),
            })
        })
        .collect();
    Json(json!({ "content": content, "places": places }))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct InstallSkillInput {
    agents: Option<String>,
}

/// Installs the skill everywhere it goes, or for a single named target when
/// `{"agents": "<target>"}` is provided.
async fn install_skill(State(state): State<Shared>, body: Bytes) -> ApiResult<Json<Value>> {
    let input: InstallSkillInput = if body.is_empty() {
        InstallSkillInput::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|_| ApiError::invalid("INVALID_JSON", "The request body isn't valid JSON."))?
    };
    let content = skill_content(&state);
    let files = if let Some(target) = input.agents.filter(|value| !value.trim().is_empty()) {
        let Some(file) = crate::skill::install_for(&target, &content).map_err(ApiError::storage)?
        else {
            return Err(ApiError::invalid(
                "UNKNOWN_SKILL_TARGET",
                format!("Unknown skill target `{target}`."),
            ));
        };
        vec![file]
    } else {
        crate::skill::install(&content).map_err(ApiError::storage)?
    };
    Ok(Json(json!({ "files": files })))
}

/// Replaces the API token. Every program using the old one has to be given
/// the new one, which is in the answer.
async fn new_token(State(state): State<Shared>) -> ApiResult<Json<Value>> {
    let token = crate::replace_token(state.store.dir()).map_err(ApiError::storage)?;
    *state
        .token
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = token.clone();
    Ok(Json(json!({ "token": token })))
}

/// One MCP message (or batch) in; its answer out, or 202 when there is none.
async fn mcp_message(State(state): State<Shared>, body: Bytes) -> Response {
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(mcp::error(&Value::Null, -32700, "Parse error")),
        )
            .into_response();
    };
    let call_tool = |name: &str, arguments: &Value| mcp::call_tool(&state.store, name, arguments);
    match mcp::handle(&message, &call_tool) {
        Some(answer) => Json(answer).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}

// ---- sheets ----

async fn list_sheets(State(state): State<Shared>) -> ApiResult<Json<Vec<SheetBoard>>> {
    state.store.list_sheets().map(Json)
}

async fn replace_sheets(
    State(state): State<Shared>,
    Json(boards): Json<Vec<SheetBoard>>,
) -> ApiResult<Json<Vec<SheetBoard>>> {
    state.store.replace_sheets(boards).map(Json)
}

// ---- boards ----

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

/// The whole board as it is kept: settings, tasks, deleted tasks, and Base64
/// copies of referenced attachments. Sending it to `POST /api/boards` makes a
/// new board with the same content.
async fn export_board(
    State(state): State<Shared>,
    Path(board): Path<String>,
) -> ApiResult<Json<ExportedBoard>> {
    state.store.export_board(&board).map(Json)
}

fn decode_percent_utf8(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(val) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(val);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| raw.to_string())
}

async fn upload_attachment(
    State(state): State<Shared>,
    Path(board): Path<String>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<AttachmentInfo>)> {
    let original_name = headers
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(decode_percent_utf8);
    let saved = state
        .store
        .save_attachment(&board, &body, original_name.as_deref())?;
    Ok((StatusCode::CREATED, Json(saved)))
}

async fn get_attachment(
    State(state): State<Shared>,
    Path((board, filename)): Path<(String, String)>,
) -> ApiResult<Response> {
    let (bytes, mime) = state.store.read_attachment(&board, &filename)?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(mime)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, max-age=31536000, immutable"),
            ),
            (
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            ),
        ],
        Body::from(bytes),
    )
        .into_response())
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

/// The body is optional: without one the task goes back where it was.
async fn restore_task(
    State(state): State<Shared>,
    Path((board, task)): Path<(String, String)>,
    body: Bytes,
) -> ApiResult<Json<Task>> {
    let input: RestoreInput = if body.iter().all(u8::is_ascii_whitespace) {
        RestoreInput::default()
    } else {
        serde_json::from_slice(&body).map_err(|error| {
            ApiError::invalid(
                "INVALID_JSON",
                format!("The request body isn't valid: {error}"),
            )
        })?
    };
    state.store.restore_task(&board, &task, input).map(Json)
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
    let Some(ui) = &state.ui else {
        return (
            StatusCode::NOT_FOUND,
            "The web UI isn't included in this server. The API is under /api.",
        )
            .into_response();
    };

    let path = uri.path().trim_start_matches('/');
    if !path.is_empty() && !path.ends_with('/') && path != "index.html" {
        if let Some(bytes) = ui(path) {
            return (
                [(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static(content_type(FsPath::new(path))),
                )],
                Body::from(bytes),
            )
                .into_response();
        }
    }

    // Every other address is the app itself, which reads the address.
    let page = ui("index.html").and_then(|bytes| String::from_utf8(bytes).ok());
    match page {
        Some(page) => {
            let settings = json!({
                "token": current_token(&state),
                "serverVersion": env!("CARGO_PKG_VERSION"),
                "canUpdate": state.updater.is_some(),
            });
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
        None => (StatusCode::NOT_FOUND, "The web UI files are missing.").into_response(),
    }
}
