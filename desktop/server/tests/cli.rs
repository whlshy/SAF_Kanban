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

    // Where most agents look, and where Claude Code does.
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
    for file in [&shared, &claude] {
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
