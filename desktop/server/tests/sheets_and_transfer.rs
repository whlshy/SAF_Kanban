//! Integration tests for Google Sheet CLI support (via a local mock Apps Script
//! v5 server that simulates Google's POST -> 302 -> GET redirect), `sheets.json`
//! sync with `/api/sheets`, `delete-board`, `import`/`export` (plain and
//! password-encrypted), `--version`, and single-target `skill --install`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::{Arc, Mutex};

use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

use saf_kanban_server::store::Store;

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "saf-kanban-sheets-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn cli(data_dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_saf-kanban-cli"))
        .arg("--data-dir")
        .arg(data_dir)
        .args(args)
        .output()
        .expect("run saf-kanban-cli")
}

fn ok(output: Output) -> String {
    assert!(
        output.status.success(),
        "expected success, got {:?}\nstdout: {}\nstderr: {}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn fail(output: Output) -> String {
    assert!(
        !output.status.success(),
        "expected failure, got success\nstdout: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    String::from_utf8(output.stderr).unwrap()
}

#[derive(Clone)]
struct MockSheetState {
    version: u64,
    spreadsheet_id: String,
    columns: Vec<String>,
    users: Vec<String>,
    labels: Vec<Value>,
    tasks: Vec<Value>,
    history: Vec<Value>,
    /// Stores POST results so the 302 redirect target `/echo?key=...` can return them via GET.
    echo: HashMap<String, Value>,
}

impl MockSheetState {
    fn new(version: u64) -> Self {
        Self {
            version,
            spreadsheet_id: "SHEET_ID_12345".to_string(),
            columns: vec!["Todo".into(), "Doing".into(), "Done".into()],
            users: vec!["Alice".into(), "Bob".into()],
            labels: vec![
                json!({ "name": "Bug", "color": "red" }),
                json!({ "name": "CLI", "color": "blue" }),
            ],
            tasks: vec![],
            history: vec![],
            echo: HashMap::new(),
        }
    }
}

async fn mock_exec_get(
    State(state): State<Arc<Mutex<MockSheetState>>>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<Value> {
    let st = state.lock().unwrap();
    if params.get("action").map(String::as_str) == Some("info") {
        return Json(json!({
            "status": "success",
            "action": "info",
            "version": st.version,
            "id": st.spreadsheet_id,
            "name": "Team Sheet",
        }));
    }
    Json(json!({
        "status": "error",
        "code": "UNKNOWN_ACTION",
        "version": st.version,
    }))
}

async fn mock_exec_post(State(state): State<Arc<Mutex<MockSheetState>>>, body: String) -> Response {
    let payload: Value = serde_json::from_str(&body).unwrap_or_default();
    let mut st = state.lock().unwrap();
    let version = st.version;
    let action = payload["action"].as_str().unwrap_or("");

    let answer = if let Some(sid) = payload["sheetId"].as_str() {
        if !sid.is_empty() && sid != st.spreadsheet_id {
            json!({
                "status": "error",
                "code": "SHEET_MISMATCH",
                "params": { "name": "Team Sheet" },
                "version": version,
            })
        } else {
            run_mock_action(&mut st, action, &payload)
        }
    } else {
        run_mock_action(&mut st, action, &payload)
    };

    // Simulate Google Apps Script's real POST -> 302 -> GET redirect behavior!
    let key = uuid::Uuid::new_v4().simple().to_string();
    st.echo.insert(key.clone(), answer);
    (
        StatusCode::FOUND,
        [(header::LOCATION, format!("/echo?key={key}"))],
    )
        .into_response()
}

fn parse_mock_labels(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        Value::String(text) => text
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn apply_mock_label_mutations(
    existing: &[String],
    replace: Option<Vec<String>>,
    add: Vec<String>,
    remove: Vec<String>,
) -> Vec<String> {
    let mut out = replace.unwrap_or_else(|| existing.to_vec());
    if !remove.is_empty() {
        out.retain(|item| !remove.iter().any(|rem| rem.eq_ignore_ascii_case(item)));
    }
    for item in add {
        if !out.iter().any(|cur| cur.eq_ignore_ascii_case(&item)) {
            out.push(item);
        }
    }
    out
}

fn run_mock_action(st: &mut MockSheetState, action: &str, payload: &Value) -> Value {
    let version = st.version;
    if version < 5 && (action == "read" || action == "restore") {
        return json!({
            "status": "error",
            "code": "UNKNOWN_ACTION",
            "params": { "action": action },
            "version": version,
        });
    }
    match action {
        "read" => json!({
            "status": "success",
            "action": "read",
            "version": version,
            "id": st.spreadsheet_id,
            "name": "Team Sheet",
            "columns": st.columns,
            "users": st.users,
            "labels": st.labels,
            "tasks": st.tasks,
            "history": st.history,
        }),
        "upsert" => {
            let task = &payload["task"];
            let id = task["id"].as_str().unwrap().to_string();
            let existing = st.tasks.iter_mut().find(|t| t["id"] == id);
            if let Some(row) = existing {
                let mut des = task["des"].as_str().unwrap_or("").to_string();
                if let Some(append) = task["appendDes"].as_str().filter(|s| !s.is_empty()) {
                    let prev = row["des"].as_str().unwrap_or("");
                    des = if prev.is_empty() {
                        append.to_string()
                    } else {
                        format!("{prev}\n\n{append}")
                    };
                }
                let prev_labels = parse_mock_labels(&row["labels"]);
                let replace = task
                    .as_object()
                    .and_then(|o| o.get("labels"))
                    .map(parse_mock_labels);
                let add = task
                    .as_object()
                    .and_then(|o| o.get("addLabels"))
                    .map(parse_mock_labels)
                    .unwrap_or_default();
                let remove = task
                    .as_object()
                    .and_then(|o| o.get("removeLabels"))
                    .map(parse_mock_labels)
                    .unwrap_or_default();
                let labels = apply_mock_label_mutations(&prev_labels, replace, add, remove);
                row["title"] = json!(task["title"].as_str().unwrap_or(""));
                row["issueId"] = json!(task["jiraId"].as_str().unwrap_or(""));
                row["des"] = json!(des);
                row["column"] = json!(task["task"].as_str().unwrap_or(""));
                row["priority"] = json!(task["priority"].as_str().unwrap_or("medium"));
                row["assignee"] = json!(task["assignee"].as_str().unwrap_or(""));
                row["labels"] = json!(labels);
            } else {
                let labels = task
                    .as_object()
                    .and_then(|o| o.get("labels"))
                    .map(parse_mock_labels)
                    .unwrap_or_default();
                st.tasks.push(json!({
                    "id": id,
                    "title": task["title"].as_str().unwrap_or(""),
                    "issueId": task["jiraId"].as_str().unwrap_or(""),
                    "des": task["des"].as_str().unwrap_or(""),
                    "column": task["task"].as_str().unwrap_or("Todo"),
                    "priority": task["priority"].as_str().unwrap_or("medium"),
                    "assignee": task["assignee"].as_str().unwrap_or(""),
                    "labels": labels,
                    "createdAt": "2026-11-25 10:00:00",
                    "movedAt": "2026-11-25 10:00:00",
                }));
            }
            json!({ "status": "success", "action": "upsert", "id": id, "version": version })
        }
        "move" => {
            let id = payload["id"].as_str().unwrap();
            let status = payload["status"].as_str().unwrap();
            let Some(pos) = st.tasks.iter().position(|t| t["id"] == id) else {
                return json!({
                    "status": "error",
                    "code": "TASK_NOT_FOUND",
                    "params": { "id": id },
                    "version": version,
                });
            };
            let mut item = st.tasks.remove(pos);
            item["column"] = json!(status);
            item["movedAt"] = json!("2026-11-25 11:00:00");
            if let Some(before) = payload["beforeId"].as_str() {
                if let Some(idx) = st.tasks.iter().position(|t| t["id"] == before) {
                    st.tasks.insert(idx, item);
                } else {
                    st.tasks.push(item);
                }
            } else if let Some(after) = payload["afterId"].as_str() {
                if let Some(idx) = st.tasks.iter().position(|t| t["id"] == after) {
                    st.tasks.insert(idx + 1, item);
                } else {
                    st.tasks.push(item);
                }
            } else {
                st.tasks.push(item);
            }
            json!({ "status": "success", "action": "move", "id": id, "version": version })
        }
        "delete" => {
            let id = payload["id"].as_str().unwrap();
            let Some(pos) = st.tasks.iter().position(|t| t["id"] == id) else {
                return json!({
                    "status": "error",
                    "code": "TASK_NOT_FOUND",
                    "params": { "id": id },
                    "version": version,
                });
            };
            let mut item = st.tasks.remove(pos);
            item["deletedAt"] = json!("2026-11-25 12:00:00");
            st.history.push(item);
            json!({ "status": "success", "action": "delete", "id": id, "version": version })
        }
        "restore" => {
            let id = payload["id"].as_str().unwrap();
            let Some(pos) = st.history.iter().rposition(|t| t["id"] == id) else {
                return json!({
                    "status": "error",
                    "code": "TASK_NOT_FOUND",
                    "params": { "id": id },
                    "version": version,
                });
            };
            let mut item = st.history.remove(pos);
            if let Some(col) = payload["column"].as_str().filter(|s| !s.is_empty()) {
                item["column"] = json!(col);
            }
            st.tasks.push(item);
            json!({ "status": "success", "action": "restore", "id": id, "version": version })
        }
        _ => json!({
            "status": "error",
            "code": "UNKNOWN_ACTION",
            "params": { "action": action },
            "version": version,
        }),
    }
}

async fn mock_echo(
    State(state): State<Arc<Mutex<MockSheetState>>>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<Value> {
    let key = params.get("key").cloned().unwrap_or_default();
    let mut st = state.lock().unwrap();
    Json(
        st.echo
            .remove(&key)
            .unwrap_or_else(|| json!({"status": "error"})),
    )
}

async fn start_mock_server(version: u64) -> (String, Arc<Mutex<MockSheetState>>) {
    let state = Arc::new(Mutex::new(MockSheetState::new(version)));
    let app = Router::new()
        .route("/exec", get(mock_exec_get).post(mock_exec_post))
        .route("/echo", get(mock_echo))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (format!("http://{addr}/exec"), state)
}

#[test]
fn version_flag_and_single_target_skill_install_work() {
    let dir = TempDir::new("version");
    let home = TempDir::new("home");

    let out = ok(cli(dir.path(), &["--version"]));
    assert!(out.contains("saf-kanban-cli"));
    assert!(out.contains(env!("CARGO_PKG_VERSION")));

    let out_short = ok(cli(dir.path(), &["-V"]));
    assert_eq!(out, out_short);

    let installed = Command::new(env!("CARGO_BIN_EXE_saf-kanban-cli"))
        .env("HOME", home.path())
        .env("USERPROFILE", home.path())
        .args(["skill", "--install", "--target", "antigravity"])
        .output()
        .unwrap();
    assert!(installed.status.success());
    assert!(home
        .path()
        .join(".gemini")
        .join("config")
        .join("skills")
        .join("saf-kanban")
        .join("SKILL.md")
        .exists());
    assert!(!home
        .path()
        .join(".claude")
        .join("skills")
        .join("saf-kanban")
        .join("SKILL.md")
        .exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn google_sheet_boards_work_end_to_end_via_apps_script_v5() {
    let dir = TempDir::new("sheet-e2e");
    let (v5_url, state) = start_mock_server(5).await;
    let (v4_url, _) = start_mock_server(4).await;

    // Older v4 script is rejected with a clear upgrade prompt.
    let err = fail(cli(
        dir.path(),
        &["new-board", "Old Sheet", "--script", &v4_url],
    ));
    assert!(err.contains("Apps Script v4"), "got: {err}");
    assert!(err.contains("v5"), "got: {err}");

    // Mismatched sheetId is rejected.
    let err = fail(cli(
        dir.path(),
        &[
            "new-board",
            "Wrong Sheet",
            "--sheet",
            "https://docs.google.com/spreadsheets/d/OTHER_SHEET/edit",
            "--script",
            &v5_url,
        ],
    ));
    assert!(err.contains("does not match"), "got: {err}");

    // Create Google Sheet board (extracts sheetId from full URL automatically).
    let created = ok(cli(
        dir.path(),
        &[
            "new-board",
            "Team Sheet",
            "--sheet",
            "https://docs.google.com/spreadsheets/d/SHEET_ID_12345/edit#gid=0",
            "--script",
            &v5_url,
            "--issue-link",
            "https://example.com/issues/",
        ],
    ));
    assert!(created.contains("Created Google Sheet board"));
    assert!(created.contains("SHEET_ID_12345"));
    assert!(!created.contains(&v5_url), "script URL must not be printed");

    // `boards` lists the Google Sheet without exposing `scriptId`.
    let listed_json: Value =
        serde_json::from_str(&ok(cli(dir.path(), &["boards", "--json"]))).unwrap();
    assert_eq!(listed_json.as_array().unwrap().len(), 1);
    assert_eq!(listed_json[0]["type"], "sheet");
    assert_eq!(listed_json[0]["sheetId"], "SHEET_ID_12345");
    assert_eq!(listed_json[0]["hasScript"], true);
    assert!(listed_json[0].get("scriptId").is_none());

    // Add, read, edit (with atomic appendDes and labels), move, delete, deleted, restore!
    let added: Value = serde_json::from_str(&ok(cli(
        dir.path(),
        &[
            "add",
            "Team Sheet",
            "Ship pure CLI",
            "--priority",
            "high",
            "--assignee",
            "Alice",
            "--labels",
            "CLI,Bug",
            "--description",
            "Line one",
            "--json",
        ],
    )))
    .unwrap();
    let task_id = added["id"].as_str().unwrap().to_string();
    assert_eq!(added["column"], "Todo");
    assert_eq!(added["labels"], json!(["CLI", "Bug"]));

    let edited: Value = serde_json::from_str(&ok(cli(
        dir.path(),
        &[
            "edit",
            "Team Sheet",
            &task_id,
            "--append-description",
            "Line two",
            "--add-label",
            "Urgent",
            "--remove-label",
            "Bug",
            "--json",
        ],
    )))
    .unwrap();
    assert_eq!(edited["description"], "Line one\n\nLine two");
    assert_eq!(edited["labels"], json!(["CLI", "Urgent"]));

    let by_label: Value = serde_json::from_str(&ok(cli(
        dir.path(),
        &["tasks", "Team Sheet", "--label", "urgent", "--json"],
    )))
    .unwrap();
    assert_eq!(by_label.as_array().unwrap().len(), 1);
    assert_eq!(by_label[0]["id"], task_id);

    let board_text = ok(cli(dir.path(), &["board", "Team Sheet"]));
    assert!(board_text.contains("Ship pure CLI"));
    assert!(board_text.contains("Alice"));
    assert!(board_text.contains("#CLI"));

    let moved: Value = serde_json::from_str(&ok(cli(
        dir.path(),
        &["move", "Team Sheet", &task_id, "Done", "--json"],
    )))
    .unwrap();
    assert_eq!(moved["column"], "Done");

    ok(cli(dir.path(), &["delete", "Team Sheet", &task_id]));
    let deleted: Value =
        serde_json::from_str(&ok(cli(dir.path(), &["deleted", "Team Sheet", "--json"]))).unwrap();
    assert_eq!(deleted.as_array().unwrap().len(), 1);
    assert_eq!(deleted[0]["id"], task_id);

    let restored: Value = serde_json::from_str(&ok(cli(
        dir.path(),
        &[
            "restore",
            "Team Sheet",
            &task_id,
            "--column",
            "Doing",
            "--json",
        ],
    )))
    .unwrap();
    assert_eq!(restored["column"], "Doing");
    assert_eq!(restored["labels"], json!(["CLI", "Urgent"]));

    // edit-board updates title, rejects --columns cleanly.
    let err = fail(cli(
        dir.path(),
        &["edit-board", "Team Sheet", "--columns", "A,B"],
    ));
    assert!(err.contains("columns"), "got: {err}");

    ok(cli(
        dir.path(),
        &["edit-board", "Team Sheet", "--name", "Renamed Sheet"],
    ));

    // delete-board removes from local sheets.json without deleting remote Sheet tasks.
    let removed = ok(cli(dir.path(), &["delete-board", "Renamed Sheet"]));
    assert!(removed.contains("not deleted"));
    assert_eq!(state.lock().unwrap().tasks.len(), 1);
    let boards_after: Value =
        serde_json::from_str(&ok(cli(dir.path(), &["boards", "--json"]))).unwrap();
    assert!(boards_after.as_array().unwrap().is_empty());
}

#[test]
fn export_and_import_local_and_encrypted_sheets_and_watcher_sync() {
    let dir_a = TempDir::new("export-src");
    let dir_b = TempDir::new("import-dst");
    let files = TempDir::new("export-files");

    // 1. Local board export -> import -> delete-board (preserving board & task labels).
    ok(cli(
        dir_a.path(),
        &[
            "new-board",
            "Local Work",
            "--columns",
            "Backlog,Done",
            "--labels",
            "Bug:red,Backend:indigo",
        ],
    ));
    ok(cli(
        dir_a.path(),
        &[
            "add",
            "Local Work",
            "Keep me",
            "--labels",
            "Bug,Backend",
            "--description",
            "Saved!",
        ],
    ));
    let local_export = files.path().join("local-board.json");
    ok(cli(
        dir_a.path(),
        &[
            "export",
            "Local Work",
            "--out",
            local_export.to_str().unwrap(),
        ],
    ));
    let imported_local = ok(cli(
        dir_b.path(),
        &["import", local_export.to_str().unwrap()],
    ));
    assert!(imported_local.contains("Imported local board"));
    let board_b = ok(cli(dir_b.path(), &["board", "Local Work"]));
    assert!(board_b.contains("Keep me"));
    assert!(board_b.contains("#Bug"));
    assert!(board_b.contains("Labels: Bug (red), Backend (indigo)"));

    let deleted_local = ok(cli(dir_a.path(), &["delete-board", "Local Work"]));
    assert!(deleted_local.contains("Deleted local board"));

    // 2. Seed sheets.json via Store (simulating desktop app), verify watcher detects CLI edit.
    let store_a = Store::open(dir_a.path()).unwrap();
    let mut rx = store_a.subscribe();
    store_a.notice_outside_changes(); // initial snapshot
    store_a
        .add_sheet(saf_kanban_server::model::SheetBoard {
            id: String::new(),
            title: "Cloud Team".into(),
            sheet_id: "SHEET_ABC".into(),
            script_id: "SCRIPT_XYZ".into(),
            user_key: "Alice".into(),
            jira_link: "https://jira.example/".into(),
        })
        .unwrap();
    // Drain our own announcement.
    let _ = rx.try_recv();

    // 3. Export encrypted settings JSON -> import into dir_b.
    let enc_file = files.path().join("settings-encrypted.json");
    ok(cli(
        dir_a.path(),
        &[
            "export",
            "--sheets",
            "--password",
            "correct-horse-battery",
            "--out",
            enc_file.to_str().unwrap(),
        ],
    ));
    let enc_raw = std::fs::read_to_string(&enc_file).unwrap();
    assert!(
        !enc_raw.contains("SCRIPT_XYZ"),
        "encrypted file must not leak scriptId"
    );

    // Missing password -> error
    let err_missing = fail(cli(dir_b.path(), &["import", enc_file.to_str().unwrap()]));
    assert!(err_missing.contains("--password"));

    // Wrong password -> error
    let err_wrong = fail(cli(
        dir_b.path(),
        &[
            "import",
            enc_file.to_str().unwrap(),
            "--password",
            "wrong-password",
        ],
    ));
    assert!(err_wrong.contains("Wrong password"));

    // Right password -> imports cleanly!
    let imported_sheets = ok(cli(
        dir_b.path(),
        &[
            "import",
            enc_file.to_str().unwrap(),
            "--password",
            "correct-horse-battery",
        ],
    ));
    assert!(imported_sheets.contains("Cloud Team"));
    let store_b = Store::open(dir_b.path()).unwrap();
    let sheets_b = store_b.list_sheets().unwrap();
    assert_eq!(sheets_b.len(), 1);
    assert_eq!(sheets_b[0].sheet_id, "SHEET_ABC");
    assert_eq!(sheets_b[0].script_id, "SCRIPT_XYZ");
    assert_eq!(sheets_b[0].user_key, "Alice");

    // 4. External edit via CLI triggers `notice_outside_changes` on store_a.
    ok(cli(
        dir_a.path(),
        &["edit-board", "Cloud Team", "--name", "Cloud Team Renamed"],
    ));
    store_a.notice_outside_changes();
    let change = rx
        .try_recv()
        .expect("watcher should announce sheets.json change");
    assert_eq!(change.kind, "boards");
}
