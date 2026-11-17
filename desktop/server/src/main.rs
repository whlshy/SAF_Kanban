//! Runs the local server on its own, without the desktop window:
//!
//!   saf-kanban-server [--port 41952] [--data-dir DIR] [--ui-dir DIR]
//!
//! Open the printed address in a browser, or use the API with the printed
//! token. For AI apps that start an MCP server as a program:
//!
//!   saf-kanban-server mcp [--data-dir DIR]

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
    eprintln!("       saf-kanban-server mcp [--data-dir DIR]");
    std::process::exit(2)
}

fn main() -> std::io::Result<()> {
    let mut options = Options {
        data_dir: default_data_dir(),
        port: DEFAULT_PORT,
        ui_dir: None,
    };
    let mut bridge = false;
    let mut args = std::env::args().skip(1).peekable();
    if args.peek().map(String::as_str) == Some("mcp") {
        bridge = true;
        args.next();
    }
    while let Some(arg) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| usage());
        match arg.as_str() {
            "--data-dir" => options.data_dir = PathBuf::from(value()),
            "--port" if !bridge => options.port = value().parse().unwrap_or_else(|_| usage()),
            "--ui-dir" if !bridge => options.ui_dir = Some(PathBuf::from(value())),
            _ => usage(),
        }
    }

    // `mcp`: talk MCP on stdin/stdout for an AI app, passing its tool calls
    // to the server that is already running.
    if bridge {
        return saf_kanban_server::bridge::run(&options.data_dir);
    }
    tokio::runtime::Runtime::new()?.block_on(serve(options))
}

async fn serve(options: Options) -> std::io::Result<()> {
    let data_dir = options.data_dir.clone();
    let server = Server::bind(options).await?;
    println!("SAF Kanban local server");
    println!("  Address:   {}", server.url());
    println!("  MCP:       {}/mcp", server.url());
    println!("  API token: {}", server.token);
    println!("  Data:      {}", data_dir.display());

    server
        .run(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
}
