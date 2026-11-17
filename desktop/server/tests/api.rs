//! The API as a client sees it: requests in, status and JSON out.

mod common;

use std::path::PathBuf;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use common::{app, app_in, code, App, PORT, TOKEN};
use saf_kanban_server::store::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn requests_need_the_token_and_a_local_host_name() {
    let app = app();
    let request = |host: &str, auth: Option<&str>| {
        let mut builder = Request::builder()
            .uri("/api/boards")
            .header(header::HOST, host);
        if let Some(auth) = auth {
            builder = builder.header(header::AUTHORIZATION, auth);
        }
        builder.body(Body::empty()).unwrap()
    };
    let local = format!("127.0.0.1:{PORT}");
    let bearer = format!("Bearer {TOKEN}");

    assert_eq!(
        app.send(request(&local, None)).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.send(request(&local, Some("Bearer wrong"))).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.send(request(&local, Some(&bearer))).await.0,
        StatusCode::OK
    );
    assert_eq!(
        app.send(request(&format!("localhost:{PORT}"), Some(&bearer)))
            .await
            .0,
        StatusCode::OK
    );
    // Another site's name pointed at this computer (DNS rebinding), or another port.
    assert_eq!(
        app.send(request("evil.example:41952", Some(&bearer)))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.send(request("127.0.0.1:8080", Some(&bearer))).await.0,
        StatusCode::FORBIDDEN
    );

    // The token in the address is only accepted for the event stream.
    let query = |path: &str| {
        Request::builder()
            .uri(format!("{path}?token={TOKEN}"))
            .header(header::HOST, &local)
            .body(Body::empty())
            .unwrap()
    };
    assert_eq!(
        app.send(query("/api/boards")).await.0,
        StatusCode::UNAUTHORIZED
    );
    let events = app
        .router
        .clone()
        .oneshot(query("/api/events"))
        .await
        .unwrap();
    assert_eq!(events.status(), StatusCode::OK);
    assert_eq!(events.headers()[header::CONTENT_TYPE], "text/event-stream");
}

#[tokio::test]
async fn a_board_can_be_created_changed_and_removed() {
    let app = app();
    let (status, board) = app
        .call(
            Method::POST,
            "/api/boards",
            json!({ "title": "  Work  ", "issueLink": "https://example.com/issues/" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(board["title"], "Work");
    assert_eq!(board["columns"], json!(["Todo", "Doing", "Done"]));
    let id = board["id"].as_str().unwrap();
    let path = format!("/api/boards/{id}");

    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    let (_, other) = app
        .call(
            Method::POST,
            "/api/boards",
            json!({ "title": "Home", "columns": ["待辦", "完成"], "users": ["Amy", " Ben "] }),
        )
        .await;
    assert_eq!(other["columns"], json!(["待辦", "完成"]));
    assert_eq!(other["users"], json!(["Amy", "Ben"]));
    let listed = app.get("/api/boards").await;
    assert_eq!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["title"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Work", "Home"]
    );

    // Renaming a column takes its tasks along; the new list sets the order.
    app.task(id, json!({ "title": "A", "column": "Doing" }))
        .await;
    let (status, board) = app
        .call(Method::PATCH, &path, json!({ "title": "Work 2", "columns": ["Backlog", "In progress", "Done"], "renames": { "Todo": "Backlog", "Doing": "In progress" }, "users": ["Amy"] }))
        .await;
    assert_eq!(status, StatusCode::OK, "{board}");
    assert_eq!(board["title"], "Work 2");
    assert_eq!(board["columns"], json!(["Backlog", "In progress", "Done"]));
    assert_eq!(board["taskCount"], 1);
    assert_eq!(
        app.get(&format!("{path}/tasks")).await[0]["column"],
        "In progress"
    );

    // A column that still has tasks can't be dropped.
    let (status, body) = app
        .call(
            Method::PATCH,
            &path,
            json!({ "columns": ["Backlog", "Done"] }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(code(&body), "COLUMN_NOT_EMPTY");
    assert_eq!(
        body["error"]["params"],
        json!({ "column": "In progress", "count": 1 })
    );
    let (status, body) = app
        .call(
            Method::PATCH,
            &path,
            json!({ "columns": ["Backlog", "In progress", "Backlog"] }),
        )
        .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "DUPLICATE_COLUMN")
    );
    assert_eq!(
        app.get(&path).await["columns"],
        json!(["Backlog", "In progress", "Done"])
    );

    // Deleting moves the file to the trash folder.
    let (status, _) = app.call(Method::DELETE, &path, Value::Null).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body) = app.call(Method::GET, &path, Value::Null).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::NOT_FOUND, "BOARD_NOT_FOUND")
    );
    assert_eq!(app.get("/api/boards").await.as_array().unwrap().len(), 1);
    let trashed: Vec<_> = std::fs::read_dir(app.dir.join("trash")).unwrap().collect();
    assert_eq!(trashed.len(), 1);
}

#[tokio::test]
async fn tasks_can_be_created_edited_and_deleted() {
    let app = app();
    let board = app.board().await;
    let tasks = format!("/api/boards/{board}/tasks");

    // Defaults: first column, medium priority.
    let task = app.task(&board, json!({ "title": "Write docs" })).await;
    assert_eq!(task["column"], "Todo");
    assert_eq!(task["priority"], "medium");
    assert_eq!(task["assignee"], "");
    assert_eq!(task["createdAt"], task["updatedAt"]);
    let id = task["id"].as_str().unwrap();
    assert_eq!(id.len(), 8);
    let path = format!("{tasks}/{id}");

    let (status, body) = app
        .call(
            Method::POST,
            &tasks,
            json!({ "title": "X", "column": "Nope" }),
        )
        .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "UNKNOWN_COLUMN")
    );

    // PATCH changes only what is sent.
    let (status, task) = app
        .call(
            Method::PATCH,
            &path,
            json!({ "des": "line 1\nline 2", "assignee": "Amy" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (
            task["title"].as_str(),
            task["des"].as_str(),
            task["assignee"].as_str()
        ),
        (Some("Write docs"), Some("line 1\nline 2"), Some("Amy"))
    );

    // PUT replaces the task (what the web UI sends when a task is saved)...
    let (status, task) = app.call(Method::PUT, &path, json!({ "id": id, "title": "Write the docs", "issueId": "SAF-1", "column": "Todo", "priority": "high" })).await;
    assert_eq!(status, StatusCode::OK, "{task}");
    assert_eq!(
        (
            task["title"].as_str(),
            task["issueId"].as_str(),
            task["des"].as_str(),
            task["assignee"].as_str()
        ),
        (Some("Write the docs"), Some("SAF-1"), Some(""), Some(""))
    );
    // ...or creates it under the id the client chose.
    let (status, task) = app
        .call(
            Method::PUT,
            &format!("{tasks}/ab12cd34"),
            json!({ "title": "From the UI", "column": "Done", "priority": "low" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (task["id"].as_str(), task["column"].as_str()),
        (Some("ab12cd34"), Some("Done"))
    );
    let (status, body) = app
        .call(
            Method::PUT,
            &format!("{tasks}/bad%20id"),
            json!({ "title": "X" }),
        )
        .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "INVALID_TASK_ID")
    );

    assert_eq!(app.get(&path).await["title"], "Write the docs");
    let (status, body) = app
        .call(Method::GET, &format!("{tasks}/missing"), Value::Null)
        .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::NOT_FOUND, "TASK_NOT_FOUND")
    );

    // Deleted tasks stay in the history, newest first.
    assert_eq!(
        app.call(Method::DELETE, &path, Value::Null).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call(Method::DELETE, &format!("{tasks}/ab12cd34"), Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call(Method::DELETE, &path, Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    assert!(app.titles(&board, "").await.is_empty());
    let history = app.get(&format!("/api/boards/{board}/history")).await;
    assert_eq!(
        history
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["title"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["From the UI", "Write the docs"]
    );
    assert_eq!(history[1]["issueId"], "SAF-1");
    assert!(history[0]["deletedAt"].as_str().unwrap().ends_with('Z'));
}

#[tokio::test]
async fn a_board_can_be_exported_and_made_again_from_the_export() {
    let app = app();
    let board = app.board().await;
    app.call(
        Method::PATCH,
        &format!("/api/boards/{board}"),
        json!({ "title": "Work", "users": ["Amy"] }),
    )
    .await;
    let first = app
        .task(
            &board,
            json!({ "title": "First", "column": "Doing", "assignee": "Amy" }),
        )
        .await;
    let gone = app.task(&board, json!({ "title": "Gone" })).await;
    app.task(&board, json!({ "title": "Second" })).await;
    app.call(
        Method::DELETE,
        &format!("/api/boards/{board}/tasks/{}", gone["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;

    let exported = app.get(&format!("/api/boards/{board}/export")).await;
    assert_eq!(exported["title"], "Work");
    assert_eq!(exported["tasks"].as_array().unwrap().len(), 2);
    assert_eq!(exported["history"].as_array().unwrap().len(), 1);

    let (status, copy) = app
        .call(Method::POST, "/api/boards", exported.clone())
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_ne!(copy["id"], exported["id"]);
    assert_eq!(copy["taskCount"], 2);
    let copy = app
        .get(&format!(
            "/api/boards/{}/export",
            copy["id"].as_str().unwrap()
        ))
        .await;
    // Same content, tasks with their ids and times, in a board of its own.
    assert_eq!(copy["tasks"], exported["tasks"]);
    assert_eq!(copy["history"], exported["history"]);
    assert_eq!(copy["columns"], exported["columns"]);
    assert_eq!(copy["users"], exported["users"]);
    assert_eq!(copy["tasks"][0]["id"], first["id"]);

    // Tasks from somewhere else: columns come from the tasks, ids that can't
    // be kept are replaced, and what is missing is filled in.
    let (_, copied) = app
        .call(
            Method::POST,
            "/api/boards",
            json!({
                "title": "From a sheet",
                "columns": ["Todo"],
                "tasks": [
                    { "id": "a", "title": "One", "column": "Todo" },
                    { "id": "a", "title": "Two", "column": " Review " },
                    { "id": "not an id!", "title": "Three" },
                ],
            }),
        )
        .await;
    assert_eq!(copied["columns"], json!(["Todo", "Review"]));
    let tasks = app
        .get(&format!(
            "/api/boards/{}/tasks",
            copied["id"].as_str().unwrap()
        ))
        .await;
    let tasks = tasks.as_array().unwrap();
    assert_eq!(tasks.len(), 3);
    assert_eq!(tasks[0]["id"], "a");
    assert_ne!(tasks[1]["id"], "a");
    assert_eq!(tasks[1]["column"], "Review");
    assert_eq!(tasks[2]["column"], "Todo");
    assert_eq!(tasks[2]["priority"], "medium");
    assert!(!tasks[2]["createdAt"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn moving_puts_a_task_next_to_a_neighbour() {
    let app = app();
    let board = app.board().await;
    let mut ids = std::collections::HashMap::new();
    for title in ["A", "B", "C", "D"] {
        let task = app.task(&board, json!({ "title": title })).await;
        ids.insert(title, task["id"].as_str().unwrap().to_string());
    }
    let move_task = |title: &'static str, body: Value| {
        let path = format!("/api/boards/{board}/tasks/{}/move", ids[title]);
        let app = &app;
        async move { app.call(Method::POST, &path, body).await }
    };

    // Before a neighbour.
    let (status, task) = move_task("D", json!({ "column": "Todo", "beforeId": ids["B"] })).await;
    assert_eq!(
        (status, task["column"].as_str()),
        (StatusCode::OK, Some("Todo"))
    );
    assert_eq!(app.titles(&board, "").await, ["A", "D", "B", "C"]);
    // After a neighbour, into another column.
    move_task("A", json!({ "column": "Doing", "afterId": ids["C"] })).await;
    assert_eq!(app.titles(&board, "").await, ["D", "B", "C", "A"]);
    assert_eq!(app.titles(&board, "?column=Doing").await, ["A"]);
    // `beforeId` wins when both are sent.
    move_task(
        "C",
        json!({ "column": "Doing", "beforeId": ids["A"], "afterId": ids["D"] }),
    )
    .await;
    assert_eq!(app.titles(&board, "?column=Doing").await, ["C", "A"]);
    // No neighbour: only the column changes, the place in the board order stays.
    move_task("D", json!({ "column": "Done" })).await;
    assert_eq!(app.titles(&board, "").await, ["D", "B", "C", "A"]);
    assert_eq!(app.titles(&board, "?column=Done").await, ["D"]);
    // A neighbour that no longer exists is ignored.
    let (status, _) = move_task("B", json!({ "column": "Done", "beforeId": "gone" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(app.titles(&board, "").await, ["D", "B", "C", "A"]);

    let (status, body) = move_task("B", json!({ "column": "Nope" })).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "UNKNOWN_COLUMN")
    );
}

#[tokio::test]
async fn tasks_can_be_filtered() {
    let app = app();
    let board = app.board().await;
    app.task(&board, json!({ "title": "Fix login page", "des": "Safari only", "issueId": "SAF-12", "priority": "high", "assignee": "Amy" })).await;
    app.task(
        &board,
        json!({ "title": "Update docs", "column": "Doing", "priority": "low" }),
    )
    .await;
    app.task(
        &board,
        json!({ "title": "Login rate limit", "column": "Done", "assignee": "Ben" }),
    )
    .await;

    assert_eq!(
        app.titles(&board, "?q=login").await,
        ["Fix login page", "Login rate limit"]
    );
    assert_eq!(
        app.titles(&board, "?q=LOGIN%20safari").await,
        ["Fix login page"]
    );
    assert_eq!(app.titles(&board, "?q=saf-12").await, ["Fix login page"]);
    assert_eq!(
        app.titles(&board, "?assignee=Ben").await,
        ["Login rate limit"]
    );
    assert_eq!(app.titles(&board, "?assignee=").await, ["Update docs"]);
    assert_eq!(
        app.titles(&board, "?priority=medium").await,
        ["Login rate limit"]
    );
    assert_eq!(
        app.titles(&board, "?column=Done&q=login").await,
        ["Login rate limit"]
    );
    let (status, body) = app
        .call(
            Method::GET,
            &format!("/api/boards/{board}/tasks?column=Nope"),
            Value::Null,
        )
        .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "UNKNOWN_COLUMN")
    );
}

#[tokio::test]
async fn boards_are_plain_files_that_survive_a_restart() {
    let app = app();
    let board = app.board().await;
    app.task(&board, json!({ "title": "Keep me", "issueId": "SAF-1" }))
        .await;

    let file = app.dir.join("boards").join(format!("{board}.json"));
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(saved["version"], 1);
    assert_eq!(saved["tasks"][0]["issueId"], "SAF-1");
    assert!(!app
        .dir
        .join("boards")
        .join(format!("{board}.json.tmp"))
        .exists());

    // A new server on the same folder, and a file changed by another program.
    let mut edited = saved.clone();
    edited["tasks"][0]["title"] = json!("Edited outside");
    std::fs::write(&file, edited.to_string()).unwrap();
    let again = App {
        router: app_in(app.dir.clone(), None),
        dir: PathBuf::new(),
    };
    assert_eq!(again.titles(&board, "").await, ["Edited outside"]);
    assert_eq!(app.titles(&board, "").await, ["Edited outside"]);

    // A file from a newer version is refused instead of being overwritten, and
    // board ids can't reach outside the boards folder.
    edited["version"] = json!(99);
    std::fs::write(&file, edited.to_string()).unwrap();
    let (status, body) = app
        .call(Method::GET, &format!("/api/boards/{board}"), Value::Null)
        .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "UNSUPPORTED_BOARD_FILE")
    );
    assert!(app.get("/api/boards").await.as_array().unwrap().is_empty());
    std::fs::write(app.dir.join("config.json"), "{}").unwrap();
    let (status, _) = app
        .call(Method::GET, "/api/boards/..%2Fconfig", Value::Null)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn every_change_is_announced() {
    let dir =
        std::env::temp_dir().join(format!("saf-kanban-test-{}", uuid::Uuid::new_v4().simple()));
    let store = Store::open(&dir).unwrap();
    let mut changes = store.subscribe();
    let board = store.create_board(Default::default()).unwrap();
    let change = changes.recv().await.unwrap();
    assert_eq!(
        (change.kind, change.board_id.as_deref()),
        ("boards", Some(board.id.as_str()))
    );
    store.create_task(&board.id, Default::default()).unwrap();
    let change = changes.recv().await.unwrap();
    assert_eq!(
        (change.kind, change.board_id.as_deref()),
        ("board", Some(board.id.as_str()))
    );
    assert_eq!(
        serde_json::to_value(&change).unwrap(),
        json!({ "kind": "board", "boardId": board.id })
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn the_web_ui_is_served_with_the_token_written_into_the_page() {
    let dir =
        std::env::temp_dir().join(format!("saf-kanban-test-{}", uuid::Uuid::new_v4().simple()));
    let ui = dir.join("ui");
    std::fs::create_dir_all(ui.join("assets")).unwrap();
    std::fs::write(
        ui.join("index.html"),
        "<html><head><title>SAF</title></head><body></body></html>",
    )
    .unwrap();
    std::fs::write(ui.join("assets").join("app.js"), "console.log(1)").unwrap();
    std::fs::write(dir.join("secret.txt"), "secret").unwrap();
    let app = App {
        router: app_in(dir.join("data"), Some(ui)),
        dir,
    };

    let page = |path: &'static str| {
        let app = &app;
        async move {
            let request = Request::builder()
                .uri(path)
                .header(header::HOST, format!("127.0.0.1:{PORT}"))
                .body(Body::empty())
                .unwrap();
            let (status, bytes) = app.send(request).await;
            (status, String::from_utf8(bytes).unwrap())
        }
    };

    let (status, html) = page("/").await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        html.contains(&format!(
            "window.__SAF_KANBAN_LOCAL__={{\"serverVersion\":\"{}\",\"token\":\"{TOKEN}\"}}",
            env!("CARGO_PKG_VERSION")
        )),
        "{html}"
    );
    assert_eq!(
        page("/assets/app.js").await,
        (StatusCode::OK, "console.log(1)".to_string())
    );
    // The UI does its own routing, so unknown paths get the page too.
    assert!(page("/some/route").await.1.contains("__SAF_KANBAN_LOCAL__"));
    assert!(page("/index.html").await.1.contains("__SAF_KANBAN_LOCAL__"));
    // Nothing outside the UI folder is served.
    assert!(!page("/../secret.txt").await.1.contains("secret"));
    assert!(!page("/assets/../../secret.txt").await.1.contains("secret"));
    // API paths never fall through to the page.
    let (status, body) = app.call(Method::GET, "/api/nope", Value::Null).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::NOT_FOUND, "UNKNOWN_ENDPOINT")
    );
}
