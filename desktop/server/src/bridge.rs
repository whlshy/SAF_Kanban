//! `saf-kanban-server mcp`: an MCP server on stdin/stdout, for AI apps that
//! start a program instead of connecting to an address (Claude Desktop, for
//! one). It answers the protocol itself and passes tool calls on to the
//! running SAF Kanban server, so there is still only one process that reads
//! and writes the board files.
//!
//! One JSON-RPC message per line in, one per line out.

use std::io::{BufRead, Write};
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::{load_token, mcp, read_port};

const NOT_RUNNING: &str = "SAF Kanban isn't running on this computer, so its boards can't be reached. Ask the user to start SAF Kanban, then try again.";

/// Sends one `tools/call` to the running server and returns its result.
fn forward(
    agent: &ureq::Agent,
    data_dir: &Path,
    name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    // Read each time: the app may have been restarted on another port, or the
    // token replaced, since the last call.
    let Ok(token) = load_token(data_dir) else {
        return Ok(mcp::tool_error(NOT_RUNNING));
    };
    let url = format!("http://127.0.0.1:{}/mcp", read_port(data_dir));
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": arguments } });

    let sent = agent
        .post(&url)
        .header("Authorization", &format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .send(request.to_string().as_str());
    let Ok(mut answer) = sent else {
        return Ok(mcp::tool_error(NOT_RUNNING));
    };
    let reply = answer
        .body_mut()
        .read_to_string()
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let Some(reply) = reply else {
        return Ok(mcp::tool_error("SAF Kanban answered with something that isn't an MCP message. Another program may be using its port."));
    };

    if let Some(result) = reply.get("result") {
        return Ok(result.clone());
    }
    // An unknown tool or bad arguments is the caller's mistake; anything else
    // (such as a token that was replaced) is reported as a failed tool call.
    let message = reply["error"]["message"]
        .as_str()
        .unwrap_or("SAF Kanban refused the request.");
    if reply["error"]["code"] == -32602 {
        Err(message.to_string())
    } else {
        Ok(mcp::tool_error(message))
    }
}

pub fn run(data_dir: &Path) -> std::io::Result<()> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        // The answer is read whatever its status; only this computer is contacted.
        .http_status_as_error(false)
        .proxy(None)
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into();
    let call_tool = |name: &str, arguments: &Value| forward(&agent, data_dir, name, arguments);

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
