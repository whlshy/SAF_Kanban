//! SAF Kanban's local server: keeps boards as files on this computer and
//! serves them, over HTTP on 127.0.0.1 only, to the web UI and to other
//! programs such as AI agents. See `api` for the HTTP endpoints and `mcp` for
//! the tools AI agents get.

pub mod api;
pub mod bridge;
pub mod error;
pub mod mcp;
pub mod model;
pub mod store;

use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

pub const DEFAULT_PORT: u16 = 41952;

pub struct Options {
    /// Where boards and the settings file are kept.
    pub data_dir: PathBuf,
    /// 0 picks any free port.
    pub port: u16,
    /// Folder with the built web UI; `None` serves the API only.
    pub ui_dir: Option<PathBuf>,
}

/// `<data dir>/config.json`.
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    /// Shared with every program allowed to use the API.
    token: String,
}

fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn save_token(data_dir: &Path, token: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let config = Config {
        token: token.to_string(),
    };
    std::fs::write(
        data_dir.join("config.json"),
        serde_json::to_string_pretty(&config)?,
    )
}

/// Reads the API token, creating one on first run.
pub fn load_token(data_dir: &Path) -> std::io::Result<String> {
    let saved: Config = std::fs::read_to_string(data_dir.join("config.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if saved.token.len() >= 32 {
        return Ok(saved.token);
    }
    let token = new_token();
    save_token(data_dir, &token)?;
    Ok(token)
}

/// Replaces the API token; the old one stops working.
pub fn replace_token(data_dir: &Path) -> std::io::Result<String> {
    let token = new_token();
    save_token(data_dir, &token)?;
    Ok(token)
}

/// `<data dir>/server.json`: where the running server listens, for the stdio
/// bridge (`bridge.rs`) to find it.
#[derive(Serialize, Deserialize)]
struct Running {
    port: u16,
}

/// The port of the server last started on this data folder.
pub fn read_port(data_dir: &Path) -> u16 {
    std::fs::read_to_string(data_dir.join("server.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Running>(&text).ok())
        .map_or(DEFAULT_PORT, |running| running.port)
}

pub struct Server {
    pub address: SocketAddr,
    pub token: String,
    listener: TcpListener,
    state: Arc<api::AppState>,
}

impl Server {
    /// Opens the data folder and starts listening, on this computer only.
    pub async fn bind(options: Options) -> std::io::Result<Self> {
        let token = load_token(&options.data_dir)?;
        let store = store::Store::open(&options.data_dir)?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, options.port)).await?;
        let address = listener.local_addr()?;
        let running = Running {
            port: address.port(),
        };
        std::fs::write(
            options.data_dir.join("server.json"),
            serde_json::to_string(&running)?,
        )?;
        let state = Arc::new(api::AppState {
            store,
            token: RwLock::new(token.clone()),
            port: address.port(),
            ui_dir: options.ui_dir,
        });
        Ok(Self {
            address,
            token,
            listener,
            state,
        })
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.address.port())
    }

    /// Answers requests until `shutdown` completes.
    pub async fn run(
        self,
        shutdown: impl std::future::Future<Output = ()> + Send + 'static,
    ) -> std::io::Result<()> {
        axum::serve(self.listener, api::router(self.state))
            .with_graceful_shutdown(shutdown)
            .await
    }
}
