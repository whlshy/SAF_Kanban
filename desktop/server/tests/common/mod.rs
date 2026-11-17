//! Shared by the test files: a server on a temporary data folder, called
//! without a network.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use saf_kanban_server::api::{router, AppState};
use saf_kanban_server::store::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

pub const TOKEN: &str = "test-token-0123456789abcdef0123456789abcdef";
pub const PORT: u16 = 41952;

pub struct App {
    pub router: Router,
    pub dir: PathBuf,
}

impl Drop for App {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

pub fn app_in(dir: PathBuf, ui_dir: Option<PathBuf>) -> Router {
    let state = AppState {
        store: Store::open(&dir).unwrap(),
        token: std::sync::RwLock::new(TOKEN.into()),
        port: PORT,
        ui_dir,
    };
    router(Arc::new(state))
}

pub fn app() -> App {
    let dir =
        std::env::temp_dir().join(format!("saf-kanban-test-{}", uuid::Uuid::new_v4().simple()));
    App {
        router: app_in(dir.clone(), None),
        dir,
    }
}

impl App {
    pub async fn send(&self, request: Request<Body>) -> (StatusCode, Vec<u8>) {
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        (
            status,
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
    }

    /// An authorized JSON request.
    pub async fn call(&self, method: Method, path: &str, body: Value) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, format!("127.0.0.1:{PORT}"))
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap();
        let (status, bytes) = self.send(request).await;
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    pub async fn get(&self, path: &str) -> Value {
        let (status, body) = self.call(Method::GET, path, Value::Null).await;
        assert_eq!(status, StatusCode::OK, "GET {path}: {body}");
        body
    }

    pub async fn board(&self) -> String {
        let (status, board) = self
            .call(Method::POST, "/api/boards", json!({ "title": "Work" }))
            .await;
        assert_eq!(status, StatusCode::CREATED);
        board["id"].as_str().unwrap().to_string()
    }

    pub async fn task(&self, board: &str, body: Value) -> Value {
        let (status, task) = self
            .call(Method::POST, &format!("/api/boards/{board}/tasks"), body)
            .await;
        assert_eq!(status, StatusCode::CREATED, "{task}");
        task
    }

    /// Titles of the board's tasks, in board order.
    pub async fn titles(&self, board: &str, query: &str) -> Vec<String> {
        let tasks = self.get(&format!("/api/boards/{board}/tasks{query}")).await;
        tasks
            .as_array()
            .unwrap()
            .iter()
            .map(|task| task["title"].as_str().unwrap().to_string())
            .collect()
    }
}

pub fn code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or("")
}
