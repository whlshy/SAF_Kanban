//! SAF Kanban's local server: keeps boards as files on this computer and
//! serves them, over HTTP on 127.0.0.1 only, to the web UI and to other
//! programs such as AI agents. See `api` for the endpoints.

pub mod api;
pub mod error;
pub mod model;
pub mod store;

use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

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

/// Reads the API token, creating one on first run.
pub fn load_token(data_dir: &Path) -> std::io::Result<String> {
    std::fs::create_dir_all(data_dir)?;
    let path = data_dir.join("config.json");
    let mut config: Config = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if config.token.len() < 32 {
        config.token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        std::fs::write(&path, serde_json::to_string_pretty(&config)?)?;
    }
    Ok(config.token)
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
        let state = Arc::new(api::AppState {
            store,
            token: token.clone(),
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
