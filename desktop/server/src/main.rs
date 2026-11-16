//! Runs the local server on its own, without the desktop window:
//!
//!   saf-kanban-server [--port 41952] [--data-dir DIR] [--ui-dir DIR]
//!
//! Open the printed address in a browser, or use the API with the printed token.

use std::path::PathBuf;

use saf_kanban_server::{Options, Server, DEFAULT_PORT};

/// `%APPDATA%\SAF Kanban` on Windows, `~/.local/share/saf-kanban` elsewhere.
fn default_data_dir() -> PathBuf {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        return PathBuf::from(app_data).join("SAF Kanban");
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".local").join("share").join("saf-kanban")
}

fn usage() -> ! {
    eprintln!("Usage: saf-kanban-server [--port PORT] [--data-dir DIR] [--ui-dir DIR]");
    std::process::exit(2)
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let mut options = Options {
        data_dir: default_data_dir(),
        port: DEFAULT_PORT,
        ui_dir: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| usage());
        match arg.as_str() {
            "--port" => options.port = value().parse().unwrap_or_else(|_| usage()),
            "--data-dir" => options.data_dir = PathBuf::from(value()),
            "--ui-dir" => options.ui_dir = Some(PathBuf::from(value())),
            _ => usage(),
        }
    }

    let data_dir = options.data_dir.clone();
    let server = Server::bind(options).await?;
    println!("SAF Kanban local server");
    println!("  Address:   {}", server.url());
    println!("  API token: {}", server.token);
    println!("  Data:      {}", data_dir.display());

    server
        .run(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
}
