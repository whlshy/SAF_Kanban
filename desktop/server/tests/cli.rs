//! The command line as a person, a script or an AI agent uses it, and several
//! programs working on the same data folder at once.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use saf_kanban_server::store::Store;
use serde_json::{json, Value};

const CLI: &str = env!("CARGO_BIN_EXE_saf-kanban-cli");

struct Folder(PathBuf);

impl Folder {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("saf-kanban-cli-{}", uuid::Uuid::new_v4().simple())))
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn run_in(dir: &Path, args: &[&str], input: Option<&str>) -> Output {
    let mut child = Command::new(CLI)
        .args(args)
        .arg("--data-dir")
        .arg(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    if let Some(input) = input {
        stdin.write_all(input.as_bytes()).unwrap();
    }
    drop(stdin);
    child.wait_with_output().unwrap()
}

fn out(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string()
}

fn err(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

/// Runs a command that must work and returns what it printed.
fn ok(dir: &Path, args: &[&str]) -> String {
    let output = run_in(dir, args, None);
    assert!(output.status.success(), "{args:?} failed: {}", err(&output));
    out(&output)
}

fn json_of(dir: &Path, args: &[&str]) -> Value {
    let mut args = args.to_vec();
    args.push("--json");
    serde_json::from_str(&ok(dir, &args)).unwrap()
}

#[test]
fn boards_and_tasks_can_be_managed_from_the_command_line() {
    let folder = Folder::new();
    let dir = &folder.0;

    assert!(ok(dir, &["boards"]).contains("no boards yet"));
    let created = ok(
        dir,
        &[
            "new-board",
            "Home",
            "--columns",
            "Todo, Doing,Done",
            "--users",
            "Amy,Ben",
        ],
    );
    assert!(created.contains("Columns: Todo, Doing, Done"), "{created}");
    assert!(created.contains("Assignees: Amy, Ben"), "{created}");

    // The board can be named instead of giving its id, in any case.
    let added = ok(
        dir,
        &[
            "add",
            "home",
            "Buy milk",
            "--priority",
            "high",
            "--assignee",
            "Amy",
            "--issue",
            "12",
        ],
    );
    assert!(added.starts_with("Added ["), "{added}");
    assert!(
        added.ends_with("Buy milk · Todo · high · Amy · issue 12"),
        "{added}"
    );
    ok(dir, &["add", "Home", "Take out trash", "--column", "Doing"]);
    let output = run_in(
        dir,
        &["add", "Home", "Write report", "--description", "-"],
        Some("line one\nline two\n"),
    );
    assert!(output.status.success(), "{}", err(&output));

    let board = json_of(dir, &["board", "Home"]);
    let column = |index: usize| -> Vec<String> {
        board["columns"][index]["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|task| task["title"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(column(0), ["Buy milk", "Write report"]);
    assert_eq!(column(1), ["Take out trash"]);
    assert_eq!(
        board["columns"][0]["tasks"][1]["description"],
        "line one\nline two"
    );
    let milk = board["columns"][0]["tasks"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let trash = board["columns"][1]["tasks"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let shown = ok(dir, &["board", "Home"]);
    assert!(
        shown.contains("Todo (2)\n  [") && shown.contains("      line one …"),
        "{shown}"
    );
    assert!(shown.contains("Done (0)\n  (no tasks)"), "{shown}");

    ok(dir, &["move", "Home", &trash, "Todo", "--before", &milk]);
    ok(
        dir,
        &[
            "edit",
            "Home",
            &trash,
            "--priority",
            "low",
            "--assignee",
            "Ben",
        ],
    );
    let todo = ok(dir, &["tasks", "Home", "--column", "Todo"]);
    assert_eq!(todo.lines().count(), 3);
    assert!(
        todo.lines()
            .next()
            .unwrap()
            .ends_with("Take out trash · Todo · low · Ben"),
        "{todo}"
    );
    assert_eq!(
        ok(dir, &["tasks", "Home", "--assignee", ""])
            .lines()
            .count(),
        1
    );
    assert!(ok(dir, &["tasks", "Home", "--search", "MILK"]).contains("Buy milk"));

    let task = ok(dir, &["task", "Home", &milk]);
    assert!(
        task.contains("priority   high") && task.contains("description: (none)"),
        "{task}"
    );

    let deleted = ok(dir, &["delete", "Home", &trash]);
    assert!(
        deleted.contains("Take out trash") && deleted.contains("kept"),
        "{deleted}"
    );
    assert!(ok(dir, &["deleted", "Home"]).contains("Take out trash"));
    // The message says how to undo it, and undoing brings the same task back.
    assert!(
        deleted.contains(&format!("`restore Home {trash}` puts it back")),
        "{deleted}"
    );
    let restored = ok(dir, &["restore", "Home", &trash]);
    assert_eq!(
        restored,
        format!("Restored [{trash}] Take out trash · Todo · low · Ben")
    );
    assert_eq!(ok(dir, &["deleted", "Home"]), "No deleted tasks.");
    assert!(ok(dir, &["tasks", "Home", "--column", "Todo"]).starts_with(&format!("[{trash}]")));
    let again = run_in(dir, &["restore", "Home", &trash], None);
    assert_eq!(again.status.code(), Some(1));
    assert!(
        err(&again).contains("DELETED_TASK_NOT_FOUND"),
        "{}",
        err(&again)
    );
    ok(dir, &["delete", "Home", &trash]);

    let renamed = ok(
        dir,
        &[
            "edit-board",
            "Home",
            "--rename",
            "Done=Finished",
            "--users",
            "Amy",
        ],
    );
    assert!(
        renamed.contains("Columns: Todo, Doing, Finished") && renamed.contains("Assignees: Amy"),
        "{renamed}"
    );
    assert!(ok(dir, &["boards"]).contains("Home · 2 tasks · columns: Todo, Doing, Finished"));
}

#[test]
fn mistakes_are_explained_with_a_failing_exit_status() {
    let folder = Folder::new();
    let dir = &folder.0;
    ok(dir, &["new-board", "Home"]);
    ok(dir, &["new-board", "Work"]);
    ok(dir, &["new-board", "Work"]);

    let cases: [(&[&str], i32, &str); 7] = [
        (
            &["board", "Garden"],
            1,
            "There is no board `Garden`. The boards are:",
        ),
        (&["board", "Work"], 1, "Several boards are named `Work`"),
        (&["move", "Home", "nope", "Todo"], 1, "TASK_NOT_FOUND"),
        (
            &["add", "Home", "x", "--column", "Later"],
            1,
            "Its columns are: Todo, Doing, Done",
        ),
        (&["add", "Home"], 2, "`add` takes <board> <title>"),
        (
            &["tasks", "Home", "--colum", "Todo"],
            2,
            "has no option --colum",
        ),
        (&["frobnicate"], 2, "There is no command `frobnicate`"),
    ];
    for (args, status, message) in cases {
        let output = run_in(dir, args, None);
        assert_eq!(output.status.code(), Some(status), "{args:?}");
        assert!(err(&output).contains(message), "{args:?}: {}", err(&output));
        assert!(out(&output).is_empty(), "{args:?}");
    }

    let help = run_in(dir, &["--help"], None);
    assert!(help.status.success() && out(&help).contains("Usage: saf-kanban-cli"));
}

/// The app, AI apps and the command line may all write at the same moment;
/// none of their changes may be lost.
#[test]
fn programs_writing_at_the_same_time_lose_nothing() {
    let folder = Folder::new();
    let dir = folder.0.clone();
    let store = Store::open(&dir).unwrap();
    let board = store.create_board(Default::default()).unwrap().id;

    let writers: Vec<_> = (0..6)
        .map(|writer| {
            let dir = dir.clone();
            let board = board.clone();
            std::thread::spawn(move || {
                for each in 0..8 {
                    let title = format!("writer {writer} task {each}");
                    ok(&dir, &["add", &board, &title]);
                }
            })
        })
        .collect();
    // Meanwhile this process writes too, as the app would.
    for each in 0..20 {
        let input = serde_json::from_value(json!({ "title": format!("app task {each}") })).unwrap();
        store.create_task(&board, input).unwrap();
    }
    for writer in writers {
        writer.join().unwrap();
    }

    let tasks = store.get_board(&board).unwrap().tasks;
    assert_eq!(tasks.len(), 6 * 8 + 20);
}

#[test]
fn the_skill_points_at_this_command_line_and_installs_for_ai_agents() {
    let folder = Folder::new();
    let dir = &folder.0;
    let home = dir.join("home");

    let skill = ok(dir, &["skill"]);
    assert!(
        skill.starts_with("---\nname: saf-kanban\ndescription: "),
        "{skill}"
    );
    let typed = CLI.replace('\\', "/");
    assert!(
        skill.contains(&format!("\"{typed}\" --data-dir \"")),
        "{skill}"
    );

    let install = |args: &[&str], claude_config: Option<&Path>| {
        let mut command = Command::new(CLI);
        command
            .args(args)
            .arg("--data-dir")
            .arg(dir)
            .env("HOME", &home)
            .env("USERPROFILE", &home)
            .env_remove("CLAUDE_CONFIG_DIR");
        if let Some(config) = claude_config {
            command.env("CLAUDE_CONFIG_DIR", config);
        }
        let output = command.output().unwrap();
        assert!(output.status.success(), "{}", err(&output));
        out(&output)
    };
    let read = |file: &Path| {
        std::fs::read_to_string(file)
            .unwrap()
            .trim_end()
            .to_string()
    };

    // Where most agents, Claude Code, and Antigravity look.
    let printed = install(&["skill", "--install"], None);
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
    let antigravity = home
        .join(".gemini")
        .join("config")
        .join("skills")
        .join("saf-kanban")
        .join("SKILL.md");
    for file in [&shared, &claude, &antigravity] {
        assert!(printed.contains(&file.display().to_string()), "{printed}");
        assert_eq!(read(file), skill);
    }

    // Claude Code's own folder may have been moved.
    let moved = dir.join("claude-config");
    install(&["skill", "--install"], Some(&moved));
    assert_eq!(
        read(&moved.join("skills").join("saf-kanban").join("SKILL.md")),
        skill
    );

    // Any other agent's skills folder.
    let other = dir.join("other-agent").join("skills");
    let printed = install(&["skill", "--into", other.to_str().unwrap()], None);
    let file = other.join("saf-kanban").join("SKILL.md");
    assert!(printed.contains(&file.display().to_string()), "{printed}");
    assert_eq!(read(&file), skill);
}

fn run_bytes(dir: &Path, args: &[&str], input: Option<&[u8]>) -> Output {
    let mut child = Command::new(CLI)
        .args(args)
        .arg("--data-dir")
        .arg(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    if let Some(input) = input {
        stdin.write_all(input).unwrap();
    }
    drop(stdin);
    child.wait_with_output().unwrap()
}

#[test]
fn descriptions_handle_bom_utf16_files_and_appending() {
    let folder = Folder::new();
    let dir = &folder.0;
    ok(dir, &["new-board", "Notes"]);

    // UTF-8 BOM + CRLF via stdin is cleaned cleanly.
    let mut utf8_bom = vec![0xEF, 0xBB, 0xBF];
    utf8_bom.extend_from_slice("第一行\r\n第二行\r\n".as_bytes());
    let output = run_bytes(
        dir,
        &["add", "Notes", "UTF8 BOM", "--description", "-"],
        Some(&utf8_bom),
    );
    assert!(output.status.success(), "{}", err(&output));

    // UTF-16 LE BOM (PowerShell Out-File default) via --description-file.
    let utf16_path = dir.join("desc-utf16.txt");
    let mut utf16_le = vec![0xFF, 0xFE];
    for unit in "你好\r\n世界\r\n".encode_utf16() {
        utf16_le.extend_from_slice(&unit.to_le_bytes());
    }
    std::fs::write(&utf16_path, &utf16_le).unwrap();
    let added = json_of(
        dir,
        &[
            "add",
            "Notes",
            "UTF16 File",
            "--description-file",
            utf16_path.to_str().unwrap(),
        ],
    );
    assert_eq!(added["description"], "你好\n世界");
    let id = added["id"].as_str().unwrap().to_string();

    // UTF-16 BE BOM via --append-description - appends after a blank line.
    let mut utf16_be = vec![0xFE, 0xFF];
    for unit in "補充說明\r\n".encode_utf16() {
        utf16_be.extend_from_slice(&unit.to_be_bytes());
    }
    let output = run_bytes(
        dir,
        &["edit", "Notes", &id, "--append-description", "-"],
        Some(&utf16_be),
    );
    assert!(output.status.success(), "{}", err(&output));
    assert_eq!(
        json_of(dir, &["task", "Notes", &id])["description"],
        "你好\n世界\n\n補充說明"
    );

    // --append-description-file appends again.
    let append_path = dir.join("append.txt");
    std::fs::write(&append_path, "\u{feff}第三段\n").unwrap();
    ok(
        dir,
        &[
            "edit",
            "Notes",
            &id,
            "--append-description-file",
            append_path.to_str().unwrap(),
        ],
    );
    assert_eq!(
        json_of(dir, &["task", "Notes", &id])["description"],
        "你好\n世界\n\n補充說明\n\n第三段"
    );

    // Check UTF-8 BOM task has no stray \u{feff}.
    let tasks = json_of(dir, &["tasks", "Notes"]);
    assert_eq!(tasks[0]["description"], "第一行\n第二行");

    // Appending onto an empty description sets it without leading blank lines.
    let empty_task = json_of(dir, &["add", "Notes", "Empty"]);
    let empty_id = empty_task["id"].as_str().unwrap();
    ok(
        dir,
        &[
            "edit",
            "Notes",
            empty_id,
            "--append-description",
            "First note",
        ],
    );
    assert_eq!(
        json_of(dir, &["task", "Notes", empty_id])["description"],
        "First note"
    );

    // Conflicting description options fail with exit status 2.
    let conflict = run_in(
        dir,
        &[
            "edit",
            "Notes",
            empty_id,
            "--description",
            "a",
            "--append-description",
            "b",
        ],
        None,
    );
    assert_eq!(conflict.status.code(), Some(2));
}

#[test]
fn move_handles_multiple_tasks_atomically() {
    let folder = Folder::new();
    let dir = &folder.0;
    ok(dir, &["new-board", "Batch"]);

    let a = json_of(dir, &["add", "Batch", "A"])["id"]
        .as_str()
        .unwrap()
        .to_string();
    let b = json_of(dir, &["add", "Batch", "B"])["id"]
        .as_str()
        .unwrap()
        .to_string();
    let c = json_of(dir, &["add", "Batch", "C", "--column", "Done"])["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Any bad task id leaves the board untouched.
    let failed = run_in(dir, &["move", "Batch", &a, "missing-id", "Done"], None);
    assert_eq!(failed.status.code(), Some(1));
    assert!(err(&failed).contains("TASK_NOT_FOUND"));
    assert_eq!(json_of(dir, &["task", "Batch", &a])["column"], "Todo");

    // Moving multiple tasks with --before puts them in the given order before C.
    let moved = ok(dir, &["move", "Batch", &b, &a, "Done", "--before", &c]);
    assert_eq!(moved.lines().count(), 2, "{moved}");
    let done = json_of(dir, &["tasks", "Batch", "--column", "Done"]);
    let titles: Vec<&str> = done
        .as_array()
        .unwrap()
        .iter()
        .map(|task| task["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["B", "A", "C"]);
}

#[test]
fn board_limit_and_moved_at_filtering_work_together() {
    let folder = Folder::new();
    let dir = &folder.0;
    let board_id = json_of(dir, &["new-board", "Track"])["id"]
        .as_str()
        .unwrap()
        .to_string();

    let first = json_of(dir, &["add", "Track", "First"]);
    let first_id = first["id"].as_str().unwrap().to_string();
    assert_eq!(first["movedAt"], first["createdAt"]);
    assert!(ok(dir, &["task", "Track", &first_id]).contains("moved "));

    // Editing or reordering within the same column doesn't change movedAt.
    std::thread::sleep(std::time::Duration::from_millis(10));
    let second = json_of(dir, &["add", "Track", "Second"]);
    let second_id = second["id"].as_str().unwrap().to_string();
    ok(
        dir,
        &["edit", "Track", &first_id, "--title", "First edited"],
    );
    ok(
        dir,
        &["move", "Track", &first_id, "Todo", "--after", &second_id],
    );
    assert_eq!(
        json_of(dir, &["task", "Track", &first_id])["movedAt"],
        first["movedAt"]
    );

    // Moving to another column updates movedAt.
    std::thread::sleep(std::time::Duration::from_millis(10));
    let moved = json_of(dir, &["move", "Track", &first_id, "Done"]);
    assert_ne!(moved["movedAt"], first["movedAt"]);

    // Seed an older task (without movedAt) and three dated Done tasks in the file.
    let board_file = dir.join("boards").join(format!("{board_id}.json"));
    let mut raw: Value =
        serde_json::from_str(&std::fs::read_to_string(&board_file).unwrap()).unwrap();
    raw["tasks"] = json!([
        {
            "id": "legacy",
            "title": "Legacy Done",
            "column": "Done",
            "priority": "medium",
            "createdAt": "2026-10-01T00:00:00.000Z",
            "updatedAt": "2026-10-01T00:00:00.000Z"
        },
        {
            "id": "d1",
            "title": "Done Nov 10",
            "column": "Done",
            "priority": "medium",
            "createdAt": "2026-11-01T00:00:00.000Z",
            "updatedAt": "2026-11-10T08:00:00.000Z",
            "movedAt": "2026-11-10T08:00:00.000Z"
        },
        {
            "id": "d2",
            "title": "Done Nov 20",
            "column": "Done",
            "priority": "medium",
            "createdAt": "2026-11-01T00:00:00.000Z",
            "updatedAt": "2026-11-20T12:00:00.000Z",
            "movedAt": "2026-11-20T12:00:00.000Z"
        },
        {
            "id": "d3",
            "title": "Done Nov 24",
            "column": "Done",
            "priority": "medium",
            "createdAt": "2026-11-01T00:00:00.000Z",
            "updatedAt": "2026-11-24T05:00:00.000Z",
            "movedAt": "2026-11-24T05:00:00.000Z"
        },
        {
            "id": "t1",
            "title": "Still Todo",
            "column": "Todo",
            "priority": "high",
            "createdAt": "2026-11-24T06:00:00.000Z",
            "updatedAt": "2026-11-24T06:00:00.000Z",
            "movedAt": "2026-11-24T06:00:00.000Z"
        }
    ]);
    std::fs::write(&board_file, serde_json::to_string_pretty(&raw).unwrap()).unwrap();

    // board --column Done --limit 2 picks the 2 most recently moved tasks and notes how many remain.
    let narrowed = ok(dir, &["board", "Track", "--column", "Done", "--limit", "2"]);
    assert!(!narrowed.contains("Todo ("), "{narrowed}");
    assert!(narrowed.contains("Done (4)"), "{narrowed}");
    assert!(narrowed.contains("Done Nov 24"), "{narrowed}");
    assert!(narrowed.contains("Done Nov 20"), "{narrowed}");
    assert!(!narrowed.contains("Done Nov 10"), "{narrowed}");
    assert!(narrowed.contains("… and 2 more"), "{narrowed}");

    let narrowed_json = json_of(dir, &["board", "Track", "--column", "Done", "--limit", "2"]);
    assert_eq!(narrowed_json["columns"].as_array().unwrap().len(), 1);
    assert_eq!(narrowed_json["columns"][0]["total"], 4);
    assert_eq!(narrowed_json["columns"][0]["tasks"][0]["id"], "d3");
    assert_eq!(narrowed_json["columns"][0]["tasks"][1]["id"], "d2");

    // tasks --since / --until filter by movedAt and exclude legacy tasks without movedAt.
    let ranged = json_of(
        dir,
        &[
            "tasks",
            "Track",
            "--column",
            "Done",
            "--since",
            "2026-11-15",
            "--until",
            "2026-11-24",
        ],
    );
    let ids: Vec<&str> = ranged
        .as_array()
        .unwrap()
        .iter()
        .map(|task| task["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["d2", "d3"]);

    // tasks --limit sorts most recently moved first.
    let limited = json_of(dir, &["tasks", "Track", "--column", "Done", "--limit", "2"]);
    let ids: Vec<&str> = limited
        .as_array()
        .unwrap()
        .iter()
        .map(|task| task["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["d3", "d2"]);

    // Invalid time bound gives a helpful error.
    let bad = run_in(dir, &["tasks", "Track", "--since", "yesterday"], None);
    assert_eq!(bad.status.code(), Some(1));
    assert!(err(&bad).contains("INVALID_TIME"));
}
