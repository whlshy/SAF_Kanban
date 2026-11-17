//! The "AI / API" dialog's skill: shown, installed, and recognised as installed.

mod common;

use axum::http::{Method, StatusCode};
use common::app;
use serde_json::Value;

#[tokio::test]
async fn the_app_shows_and_installs_the_skill() {
    let app = app();
    let claude = app.dir.join("claude-config");
    // Only this test in this file, so nothing else sees the variable.
    std::env::set_var("CLAUDE_CONFIG_DIR", &claude);
    let file = claude.join("skills").join("saf-kanban").join("SKILL.md");

    let connection = app.get("/api/connection").await;
    let cli = connection["cli"].as_str().unwrap();
    assert!(cli.contains("saf-kanban-cli"), "{cli}");

    let skill = app.get("/api/skill").await;
    assert_eq!(skill["installed"], false);
    assert_eq!(skill["file"], file.display().to_string());
    let content = skill["content"].as_str().unwrap();
    // The data folder isn't the usual one, so the skill names it.
    assert!(
        content.contains(&format!("\"{}\" --data-dir", cli.replace('\\', "/"))),
        "{content}"
    );

    let (status, installed) = app.call(Method::POST, "/api/skill", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(installed["file"], file.display().to_string());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), content);

    let skill = app.get("/api/skill").await;
    assert_eq!(
        (skill["installed"].clone(), skill["upToDate"].clone()),
        (Value::Bool(true), Value::Bool(true))
    );

    // An older copy is reported as installed but not up to date.
    std::fs::write(&file, "old").unwrap();
    let skill = app.get("/api/skill").await;
    assert_eq!(
        (skill["installed"].clone(), skill["upToDate"].clone()),
        (Value::Bool(true), Value::Bool(false))
    );
}
