//! Changes made to the board files by other programs reach the app's windows.

use std::time::Duration;

use saf_kanban_server::store::{Change, Store};
use serde_json::json;

fn drain(changes: &mut tokio::sync::broadcast::Receiver<Change>) -> Vec<(String, Option<String>)> {
    let mut seen = Vec::new();
    while let Ok(change) = changes.try_recv() {
        seen.push((change.kind.to_string(), change.board_id));
    }
    seen
}

#[test]
fn changes_by_other_programs_are_announced_and_own_ones_are_not_repeated() {
    let dir = std::env::temp_dir().join(format!(
        "saf-kanban-outside-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let app = Store::open(&dir).unwrap();
    let other = Store::open(&dir).unwrap(); // e.g. the command line
    let board = app.create_board(Default::default()).unwrap().id;
    let mut changes = app.subscribe();

    app.notice_outside_changes(); // takes note of how things are
    assert!(drain(&mut changes).is_empty());

    // The app's own change is announced once, when it is made.
    app.create_task(
        &board,
        serde_json::from_value(json!({ "title": "own" })).unwrap(),
    )
    .unwrap();
    assert_eq!(
        drain(&mut changes),
        [("board".to_string(), Some(board.clone()))]
    );
    app.notice_outside_changes();
    assert!(drain(&mut changes).is_empty());

    // Another program's change is announced when the app looks.
    std::thread::sleep(Duration::from_millis(20));
    other
        .create_task(
            &board,
            serde_json::from_value(json!({ "title": "outside" })).unwrap(),
        )
        .unwrap();
    assert!(drain(&mut changes).is_empty());
    app.notice_outside_changes();
    assert_eq!(
        drain(&mut changes),
        [
            ("board".to_string(), Some(board.clone())),
            ("boards".to_string(), None)
        ]
    );

    // A board added or removed elsewhere changes the list of boards.
    let added = other.create_board(Default::default()).unwrap().id;
    app.notice_outside_changes();
    assert!(drain(&mut changes).contains(&("boards".to_string(), None)));
    other.delete_board(&added).unwrap();
    app.notice_outside_changes();
    assert_eq!(drain(&mut changes), [("boards".to_string(), None)]);

    let _ = std::fs::remove_dir_all(&dir);
}
