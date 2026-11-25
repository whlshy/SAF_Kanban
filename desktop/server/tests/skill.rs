//! The "AI / API" dialog's skill: shown, installed in each place agents look,
//! and recognised as installed.

mod common;

use axum::http::{Method, StatusCode};
use common::app;
use serde_json::Value;

#[tokio::test]
async fn the_app_shows_and_installs_the_skill() {
    let app = app();
    let home = app.dir.join("home");
    // Only this test in this file, so nothing else sees these.
    std::env::set_var("HOME", &home);
    std::env::set_var("USERPROFILE", &home);
    std::env::remove_var("CLAUDE_CONFIG_DIR");
    let shared = home
        .join(".agents")
        .join("skills")
        .join("saf-kanban")
        .join("SKILL.md");
    let claude = home
        .join(".claude")
        .join("skills")
        .join("saf-kanban")
        .join("SKILL.md");

    let connection = app.get("/api/connection").await;
    let cli = connection["cli"].as_str().unwrap();
    assert!(cli.contains("saf-kanban-cli"), "{cli}");

    let skill = app.get("/api/skill").await;
    let content = skill["content"].as_str().unwrap();
    // The data folder isn't the usual one, so the skill names it.
    assert!(
        content.contains(&format!("\"{}\" --data-dir", cli.replace('\\', "/"))),
        "{content}"
    );
    let states = |skill: &Value| -> Vec<(String, String, bool, bool)> {
        skill["places"]
            .as_array()
            .unwrap()
            .iter()
            .map(|place| {
                (
                    place["agents"].as_str().unwrap().to_string(),
                    place["file"].as_str().unwrap().to_string(),
                    place["installed"].as_bool().unwrap(),
                    place["upToDate"].as_bool().unwrap(),
                )
            })
            .collect()
    };
    let place = |agents: &str, file: &std::path::Path, installed, current| {
        (
            agents.to_string(),
            file.display().to_string(),
            installed,
            current,
        )
    };
    assert_eq!(
        states(&skill),
        [
            place("agents", &shared, false, false),
            place("claude", &claude, false, false)
        ]
    );
    // Nothing is installed yet, so auto-updating installed skills creates nothing.
    assert!(saf_kanban_server::skill::update_installed(content).is_empty());
    assert!(!shared.exists() && !claude.exists());

    // If only one location was installed earlier and is outdated, only that one is refreshed.
    std::fs::create_dir_all(claude.parent().unwrap()).unwrap();
    std::fs::write(&claude, "outdated").unwrap();
    assert_eq!(
        saf_kanban_server::skill::update_installed(content),
        vec![claude.clone()]
    );
    assert_eq!(std::fs::read_to_string(&claude).unwrap(), content);
    assert!(!shared.exists());
    // Already up to date -> nothing rewritten.
    assert!(saf_kanban_server::skill::update_installed(content).is_empty());

    let (status, installed) = app.call(Method::POST, "/api/skill", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(installed["files"].as_array().unwrap().len(), 2);
    assert_eq!(std::fs::read_to_string(&shared).unwrap(), content);
    assert_eq!(std::fs::read_to_string(&claude).unwrap(), content);
    assert_eq!(
        states(&app.get("/api/skill").await),
        [
            place("agents", &shared, true, true),
            place("claude", &claude, true, true)
        ]
    );

    // An older copy is reported as installed but not up to date.
    std::fs::write(&claude, "old").unwrap();
    assert_eq!(
        states(&app.get("/api/skill").await),
        [
            place("agents", &shared, true, true),
            place("claude", &claude, true, false)
        ]
    );
}
