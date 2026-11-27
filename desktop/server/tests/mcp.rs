//! What an AI agent sees: MCP messages to `/mcp`.

mod common;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use common::{app, code, App, PORT, TOKEN};
use serde_json::{json, Value};

impl App {
    /// Sends one MCP message and returns the status and the answer.
    async fn mcp(&self, message: Value) -> (StatusCode, Value) {
        self.call(Method::POST, "/mcp", message).await
    }

    /// Calls a tool; returns whether it failed and what it said (parsed as
    /// JSON when it succeeded).
    async fn tool(&self, name: &str, arguments: Value) -> (bool, Value) {
        let (status, answer) = self
            .mcp(json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": name, "arguments": arguments } }))
            .await;
        assert_eq!(status, StatusCode::OK, "{answer}");
        assert_eq!(answer["id"], 7);
        let result = &answer["result"];
        let text = result["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("no text in {answer}"));
        let failed = result["isError"].as_bool().unwrap();
        (
            failed,
            if failed {
                json!(text)
            } else {
                serde_json::from_str(text).unwrap()
            },
        )
    }

    async fn ok(&self, name: &str, arguments: Value) -> Value {
        let (failed, value) = self.tool(name, arguments).await;
        assert!(!failed, "{name} failed: {value}");
        value
    }
}

fn titles(tasks: &Value) -> Vec<&str> {
    tasks
        .as_array()
        .unwrap()
        .iter()
        .map(|task| task["title"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn a_client_can_connect_and_list_the_tools() {
    let app = app();
    let initialize = |version: &str| json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": version, "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } } });

    let (status, answer) = app.mcp(initialize("2025-03-26")).await;
    assert_eq!(status, StatusCode::OK);
    let result = &answer["result"];
    assert_eq!(result["protocolVersion"], "2025-03-26");
    assert_eq!(result["serverInfo"]["name"], "saf-kanban");
    assert!(result["capabilities"]["tools"].is_object());
    assert!(result["instructions"]
        .as_str()
        .unwrap()
        .contains("list_boards"));
    // A revision this server doesn't know is answered with its newest.
    assert_eq!(
        app.mcp(initialize("2099-01-01")).await.1["result"]["protocolVersion"],
        "2025-11-25"
    );

    // Notifications get no answer.
    let (status, answer) = app
        .mcp(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
        .await;
    assert_eq!((status, answer), (StatusCode::ACCEPTED, Value::Null));
    assert_eq!(
        app.mcp(json!({ "jsonrpc": "2.0", "id": "p", "method": "ping" }))
            .await
            .1,
        json!({ "jsonrpc": "2.0", "id": "p", "result": {} })
    );

    let (_, answer) = app
        .mcp(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }))
        .await;
    let tools = answer["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "list_boards",
            "get_board",
            "list_tasks",
            "get_task",
            "create_task",
            "update_task",
            "move_task",
            "delete_task",
            "list_deleted_tasks",
            "restore_task",
            "create_board",
            "update_board"
        ]
    );
    for tool in tools {
        assert_eq!(tool["inputSchema"]["type"], "object", "{tool}");
        assert!(tool["description"].as_str().unwrap().len() > 20, "{tool}");
        for required in tool["inputSchema"]["required"].as_array().unwrap() {
            assert!(
                tool["inputSchema"]["properties"][required.as_str().unwrap()].is_object(),
                "{tool}"
            );
        }
    }
    let create = tools
        .iter()
        .find(|tool| tool["name"] == "create_task")
        .unwrap();
    assert_eq!(create["inputSchema"]["required"], json!(["board", "title"]));
    assert_eq!(tools[0]["annotations"]["readOnlyHint"], true);
    assert_eq!(create["annotations"]["readOnlyHint"], false);
}

#[tokio::test]
async fn an_agent_can_work_a_board_through_the_tools() {
    let app = app();
    let board = app.ok("create_board", json!({ "title": "Sprint", "columns": ["Todo", "Doing", "Done"], "users": ["Amy", "Ben"] })).await;
    let id = board["id"].as_str().unwrap().to_string();
    assert_eq!(titles(&app.ok("list_boards", json!({})).await), ["Sprint"]);

    let first = app.ok("create_task", json!({ "board": id, "title": "Write docs", "description": "line 1\nline 2", "assignee": "Amy", "issueId": "SAF-1" })).await;
    assert_eq!(
        (
            first["column"].as_str(),
            first["priority"].as_str(),
            first["description"].as_str()
        ),
        (Some("Todo"), Some("medium"), Some("line 1\nline 2"))
    );
    assert!(first.get("des").is_none());
    let second = app
        .ok(
            "create_task",
            json!({ "board": id, "title": "Fix login", "priority": "high" }),
        )
        .await;
    let third = app
        .ok(
            "create_task",
            json!({ "board": id, "title": "Ship", "column": "Doing" }),
        )
        .await;
    let task = |value: &Value| value["id"].as_str().unwrap().to_string();

    // Reorder inside a column, then move across columns next to a neighbour.
    app.ok(
        "move_task",
        json!({ "board": id, "task": task(&second), "column": "Todo", "beforeTask": task(&first) }),
    )
    .await;
    let moved = app.ok("move_task", json!({ "board": id, "task": task(&first), "column": "Doing", "afterTask": task(&third) })).await;
    assert_eq!(moved["column"], "Doing");
    let view = app.ok("get_board", json!({ "board": id })).await;
    assert_eq!(view["users"], json!(["Amy", "Ben"]));
    let columns: Vec<(&str, Vec<&str>)> = view["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|column| (column["name"].as_str().unwrap(), titles(&column["tasks"])))
        .collect();
    assert_eq!(
        columns,
        [
            ("Todo", vec!["Fix login"]),
            ("Doing", vec!["Ship", "Write docs"]),
            ("Done", vec![])
        ]
    );

    // Only the given fields change; an empty string clears one.
    let updated = app
        .ok(
            "update_task",
            json!({ "board": id, "task": task(&first), "title": "Write the docs", "assignee": "" }),
        )
        .await;
    assert_eq!(
        (
            updated["title"].as_str(),
            updated["assignee"].as_str(),
            updated["description"].as_str(),
            updated["column"].as_str()
        ),
        (
            Some("Write the docs"),
            Some(""),
            Some("line 1\nline 2"),
            Some("Doing")
        )
    );
    assert_eq!(
        app.ok("get_task", json!({ "board": id, "task": task(&first) }))
            .await["issueId"],
        "SAF-1"
    );

    assert_eq!(
        titles(
            &app.ok("list_tasks", json!({ "board": id, "column": "Doing" }))
                .await
        ),
        ["Ship", "Write the docs"]
    );
    assert_eq!(
        titles(
            &app.ok(
                "list_tasks",
                json!({ "board": id, "query": "login", "priority": "high" })
            )
            .await
        ),
        ["Fix login"]
    );
    assert_eq!(
        titles(
            &app.ok("list_tasks", json!({ "board": id, "assignee": "" }))
                .await
        )
        .len(),
        3
    );

    // Renaming a column through update_board keeps its tasks.
    let renamed = app.ok("update_board", json!({ "board": id, "title": "Sprint 12", "columns": ["Todo", "In progress", "Done"], "renameColumns": { "Doing": "In progress" } })).await;
    assert_eq!(
        (renamed["title"].as_str(), renamed["columns"].clone()),
        (Some("Sprint 12"), json!(["Todo", "In progress", "Done"]))
    );
    assert_eq!(
        titles(
            &app.ok(
                "list_tasks",
                json!({ "board": id, "column": "In progress" })
            )
            .await
        )
        .len(),
        2
    );

    assert_eq!(
        app.ok("delete_task", json!({ "board": id, "task": task(&third) }))
            .await,
        json!({ "deleted": true })
    );
    let deleted = app.ok("list_deleted_tasks", json!({ "board": id })).await;
    assert_eq!(titles(&deleted), ["Ship"]);
    assert!(deleted[0]["deletedAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(app.get(&format!("/api/boards/{id}")).await["taskCount"], 2);

    // A deletion made by mistake is undone: the same task comes back.
    let restored = app
        .ok("restore_task", json!({ "board": id, "task": task(&third) }))
        .await;
    assert_eq!(restored["id"], third["id"]);
    assert_eq!(restored["title"], "Ship");
    assert_eq!(restored["createdAt"], third["createdAt"]);
    assert_eq!(
        app.ok("list_deleted_tasks", json!({ "board": id })).await,
        json!([])
    );
    let (failed, message) = app
        .tool("restore_task", json!({ "board": id, "task": task(&third) }))
        .await;
    assert!(failed, "{message}");
    assert!(
        message.as_str().unwrap().contains("DELETED_TASK_NOT_FOUND"),
        "{message}"
    );

    // appendDescription adds after a blank line without overwriting, and
    // conflicts with description.
    let appended = app
        .ok(
            "update_task",
            json!({ "board": id, "task": task(&first), "appendDescription": "line 3" }),
        )
        .await;
    assert_eq!(appended["description"], "line 1\nline 2\n\nline 3");
    assert!(appended["movedAt"].as_str().unwrap().ends_with('Z'));
    let (failed, conflict) = app
        .tool(
            "update_task",
            json!({ "board": id, "task": task(&first), "description": "x", "appendDescription": "y" }),
        )
        .await;
    assert!(
        failed && conflict.as_str().unwrap().contains("CONFLICTING_FIELDS"),
        "{conflict}"
    );
    let limited = app
        .ok(
            "list_tasks",
            json!({ "board": id, "column": "In progress", "limit": 1 }),
        )
        .await;
    assert_eq!(limited.as_array().unwrap().len(), 1);

    // The same board through the HTTP API: one store behind both.
    assert_eq!(app.get(&format!("/api/boards/{id}")).await["taskCount"], 3);
}

#[tokio::test]
async fn mistakes_are_explained_to_the_agent() {
    let app = app();
    let board = app.ok("create_board", json!({ "title": "B" })).await;
    let id = board["id"].as_str().unwrap();

    // A tool that ran and failed: readable text, flagged as an error.
    let (failed, text) = app
        .tool(
            "create_task",
            json!({ "board": id, "title": "X", "column": "Nope" }),
        )
        .await;
    assert!(failed);
    assert_eq!(text, "This board has no column named `Nope`. Its columns are: Todo, Doing, Done. (UNKNOWN_COLUMN)");
    assert_eq!(
        app.tool("get_board", json!({ "board": "missing" })).await,
        (true, json!("No board with id `missing`. (BOARD_NOT_FOUND)"))
    );
    assert_eq!(
        app.tool("create_task", json!({ "board": id })).await,
        (true, json!("`title` is required."))
    );
    assert_eq!(
        app.tool("create_task", json!({ "board": id, "title": 5 }))
            .await,
        (true, json!("`title` must be a string."))
    );
    assert_eq!(
        app.tool("update_board", json!({ "board": id, "columns": "Todo" }))
            .await,
        (true, json!("`columns` must be a list of strings."))
    );
    let task = app
        .ok("create_task", json!({ "board": id, "title": "T" }))
        .await;
    let (failed, text) = app
        .tool(
            "update_board",
            json!({ "board": id, "columns": ["Doing", "Done"] }),
        )
        .await;
    assert!(
        failed && text.as_str().unwrap().contains("COLUMN_NOT_EMPTY"),
        "{text}"
    );
    assert_eq!(
        app.ok("get_task", json!({ "board": id, "task": task["id"] }))
            .await["column"],
        "Todo"
    );

    // Calls that are themselves wrong are protocol errors.
    let error = |answer: Value| answer["error"]["code"].as_i64().unwrap();
    let call = |params: Value| json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params });
    assert_eq!(
        error(
            app.mcp(call(json!({ "name": "drop_everything", "arguments": {} })))
                .await
                .1
        ),
        -32602
    );
    assert_eq!(
        error(app.mcp(call(json!({ "arguments": {} }))).await.1),
        -32602
    );
    assert_eq!(
        error(
            app.mcp(json!({ "jsonrpc": "2.0", "id": 1, "method": "resources/list" }))
                .await
                .1
        ),
        -32601
    );
    assert_eq!(error(app.mcp(json!("hello")).await.1), -32600);

    // A batch gets one answer per request; notifications in it get none.
    let (_, batch) = app
        .mcp(json!([
            { "jsonrpc": "2.0", "id": 1, "method": "ping" },
            { "jsonrpc": "2.0", "method": "notifications/initialized" },
            { "jsonrpc": "2.0", "id": 2, "method": "nope" },
        ]))
        .await;
    assert_eq!(batch.as_array().unwrap().len(), 2);
    assert_eq!(
        (batch[0]["id"].as_i64(), batch[1]["error"]["code"].as_i64()),
        (Some(1), Some(-32601))
    );
}

#[tokio::test]
async fn the_endpoint_is_guarded_like_the_api() {
    let app = app();
    let local = format!("127.0.0.1:{PORT}");
    let ping = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }).to_string();
    let post = |host: &str, token: Option<&str>, origin: Option<&str>, body: &str| {
        let mut request = Request::builder()
            .method(Method::POST)
            .uri("/mcp")
            .header(header::HOST, host)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        request.body(Body::from(body.to_string())).unwrap()
    };

    assert_eq!(
        app.send(post(&local, Some(TOKEN), None, &ping)).await.0,
        StatusCode::OK
    );
    assert_eq!(
        app.send(post(&local, None, None, &ping)).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.send(post("evil.example", Some(TOKEN), None, &ping))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    // A page on another site, even with the token; this server's own page is fine.
    assert_eq!(
        app.send(post(
            &local,
            Some(TOKEN),
            Some("https://evil.example"),
            &ping
        ))
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.send(post(
            &local,
            Some(TOKEN),
            Some(&format!("http://{local}")),
            &ping
        ))
        .await
        .0,
        StatusCode::OK
    );

    let (status, bytes) = app.send(post(&local, Some(TOKEN), None, "{not json")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap()["error"]["code"],
        -32700
    );
    // No stream is offered for messages from the server.
    assert_eq!(
        app.call(Method::GET, "/mcp", Value::Null).await.0,
        StatusCode::METHOD_NOT_ALLOWED
    );
}

#[tokio::test]
async fn the_token_can_be_replaced() {
    let app = app();
    let details = app.get("/api/connection").await;
    assert_eq!(details["apiUrl"], format!("http://127.0.0.1:{PORT}/api"));
    assert_eq!(details["mcpUrl"], format!("http://127.0.0.1:{PORT}/mcp"));
    assert_eq!(details["dataDir"], app.dir.to_str().unwrap());
    assert!(details["executable"].is_string());

    let (status, answer) = app.call(Method::POST, "/api/token", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    let token = answer["token"].as_str().unwrap().to_string();
    assert!(token.len() >= 32 && token != TOKEN);
    let saved: Value =
        serde_json::from_str(&std::fs::read_to_string(app.dir.join("config.json")).unwrap())
            .unwrap();
    assert_eq!(saved["token"], token);

    // The old token stops working at once; the new one works.
    let (status, body) = app.call(Method::GET, "/api/boards", Value::Null).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::UNAUTHORIZED, "UNAUTHORIZED")
    );
    let request = Request::builder()
        .uri("/api/boards")
        .header(header::HOST, format!("127.0.0.1:{PORT}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.send(request).await.0, StatusCode::OK);
}

#[tokio::test]
async fn labels_work_through_mcp_tools() {
    let app = app();

    let (err, created_board) = app
        .tool(
            "create_board",
            json!({
                "title": "MCP Labels",
                "labels": [
                    { "name": "Bug", "color": "red" },
                    { "name": "Backend", "color": "indigo" }
                ]
            }),
        )
        .await;
    assert!(!err);
    let board_id = created_board["id"].as_str().unwrap().to_string();
    assert_eq!(created_board["labels"][0]["name"], "Bug");

    let (err, task) = app
        .tool(
            "create_task",
            json!({
                "board": board_id,
                "title": "MCP task",
                "labels": ["Bug", "API"]
            }),
        )
        .await;
    assert!(!err);
    let task_id = task["id"].as_str().unwrap().to_string();
    assert_eq!(task["labels"], json!(["Bug", "API"]));

    let (err, updated) = app
        .tool(
            "update_task",
            json!({
                "board": board_id,
                "task": task_id,
                "addLabels": ["Urgent"],
                "removeLabels": ["API"]
            }),
        )
        .await;
    assert!(!err);
    assert_eq!(updated["labels"], json!(["Bug", "Urgent"]));

    let (err, listed) = app
        .tool(
            "list_tasks",
            json!({
                "board": board_id,
                "label": "urgent"
            }),
        )
        .await;
    assert!(!err);
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["id"], task_id);

    let (in_use_err, _) = app
        .tool(
            "update_board",
            json!({
                "board": board_id,
                "labels": [{ "name": "Bug", "color": "red" }]
            }),
        )
        .await;
    assert!(in_use_err);

    let (err, _) = app
        .tool(
            "update_board",
            json!({
                "board": board_id,
                "labels": [
                    { "name": "Defect", "color": "red" },
                    { "name": "Urgent", "color": "orange" }
                ],
                "renameLabels": { "Bug": "Defect" }
            }),
        )
        .await;
    assert!(!err);

    let (err, after) = app
        .tool(
            "get_task",
            json!({
                "board": board_id,
                "task": task_id
            }),
        )
        .await;
    assert!(!err);
    assert_eq!(after["labels"], json!(["Defect", "Urgent"]));
}

