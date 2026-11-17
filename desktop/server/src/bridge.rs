//! `saf-kanban mcp`: an MCP server on stdin/stdout, for AI apps that start a
//! program instead of connecting to an address (Claude Desktop, for one).
//!
//! It works on the board files directly, so SAF Kanban doesn't have to be
//! open. When it is, its window shows the changes within a second or so (see
//! `Store::notice_outside_changes`); the two take turns on the files.
//!
//! One JSON-RPC message per line in, one per line out.

use std::io::{BufRead, Write};
use std::path::Path;

use serde_json::Value;

use crate::mcp;
use crate::store::Store;

pub fn run(data_dir: &Path) -> std::io::Result<()> {
    let store = Store::open(data_dir)?;
    let call_tool = |name: &str, arguments: &Value| mcp::call_tool(&store, name, arguments);

    let mut output = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(message) => mcp::handle(&message, &call_tool),
            Err(_) => Some(mcp::error(&Value::Null, -32700, "Parse error")),
        };
        if let Some(reply) = reply {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}
