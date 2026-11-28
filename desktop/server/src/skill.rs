//! The Agent Skill that teaches an AI agent to use the command line
//! (`saf-kanban-cli`): a `SKILL.md` with the tool's real path in it.
//!
//! Agent Skills is an open format, and most agents read personal skills from
//! `~/.agents/skills/<name>/SKILL.md` (Codex, Gemini CLI, GitHub Copilot,
//! Cursor, ...). Claude Code reads from `~/.claude/skills/` and Google
//! Antigravity (App, IDE, CLI) reads global skills from
//! `~/.gemini/config/skills/`.

use std::path::{Path, PathBuf};

pub const NAME: &str = "saf-kanban";

/// The command-line tool that comes with this program: next to it, or this
/// program itself.
pub fn cli_path() -> PathBuf {
    let name = format!("saf-kanban-cli{}", std::env::consts::EXE_SUFFIX);
    match std::env::current_exe() {
        Ok(exe) if exe.file_name().is_some_and(|file| file == name.as_str()) => exe,
        Ok(exe) => exe.with_file_name(name),
        Err(_) => PathBuf::from(name),
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
}

/// Where the skill goes: `(which agents read it, the SKILL.md file)`.
/// `agents` is the shared place; `claude` is Claude Code's (which honours
/// `CLAUDE_CONFIG_DIR`); `antigravity` is Google Antigravity's global skills
/// folder (`~/.gemini/config/skills`).
pub fn places() -> Vec<(&'static str, PathBuf)> {
    let Some(home) = home() else {
        return Vec::new();
    };
    let claude = std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    vec![
        ("agents", skill_file(&home.join(".agents").join("skills"))),
        ("claude", skill_file(&claude.join("skills"))),
        (
            "antigravity",
            skill_file(&home.join(".gemini").join("config").join("skills")),
        ),
    ]
}

/// The skill's file in a folder of skills.
pub fn skill_file(skills_dir: &Path) -> PathBuf {
    skills_dir.join(NAME).join("SKILL.md")
}

fn write(file: &Path, content: &str) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(file, content)
}

/// Writes the skill into a folder of skills and returns the file's path.
pub fn install_into(skills_dir: &Path, content: &str) -> std::io::Result<PathBuf> {
    let file = skill_file(skills_dir);
    write(&file, content)?;
    Ok(file)
}

/// Writes the skill for one named target from [`places`]. Returns `Ok(None)`
/// when `target` is not a known target key.
pub fn install_for(target: &str, content: &str) -> std::io::Result<Option<PathBuf>> {
    let places = places();
    if places.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Can't tell where the home folder is.",
        ));
    }
    let Some((_, file)) = places.into_iter().find(|(agents, _)| *agents == target) else {
        return Ok(None);
    };
    write(&file, content)?;
    Ok(Some(file))
}

/// Writes the skill everywhere in [`places`] and returns the files.
pub fn install(content: &str) -> std::io::Result<Vec<PathBuf>> {
    let places = places();
    if places.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Can't tell where the home folder is.",
        ));
    }
    for (_, file) in &places {
        write(file, content)?;
    }
    Ok(places.into_iter().map(|(_, file)| file).collect())
}

/// Refreshes any skill files that were already installed earlier and are now
/// out of date. Never creates a skill file in a place the user hasn't
/// installed it.
pub fn update_installed(content: &str) -> Vec<PathBuf> {
    let mut updated = Vec::new();
    for (_, file) in places() {
        let Ok(existing) = std::fs::read_to_string(&file) else {
            continue;
        };
        if existing != content && write(&file, content).is_ok() {
            updated.push(file);
        }
    }
    updated
}

/// A path as it can be typed in Git Bash, PowerShell and cmd alike.
fn typed(path: &Path) -> String {
    path.display().to_string().replace('\\', "/")
}

/// The skill, for the tool at `cli` working on the boards in `data_dir`.
pub fn skill_md(cli: &Path, data_dir: &Path) -> String {
    let mut command = format!("\"{}\"", typed(cli));
    if data_dir != crate::default_data_dir() {
        command.push_str(&format!(" --data-dir \"{}\"", typed(data_dir)));
    }
    SKILL.replace("{command}", &command)
}

const SKILL: &str = r#"---
name: saf-kanban
description: Read and change the user's SAF Kanban boards (看板) — both local boards on this computer and Google Sheet boards — list boards, look at tasks, add, edit, move or delete tasks, and manage boards. Use when the user mentions SAF Kanban, their kanban board, or tasks and to-dos on a board.
---

# SAF Kanban

SAF Kanban keeps local boards as files on this computer and shares Google Sheet board settings in the same data folder. Read and change them with its command-line tool. It works whether or not the SAF Kanban desktop app is open; when the app is open, its window shows changes within a second. Google Sheet boards require Apps Script v5 or newer (v6+ for task labels, v7+ for auto-syncing and editing board preset labels).

The tool is this command (keep the quotes):

```
{command}
```

Below it is written as `saf-kanban-cli`; always type the full command above instead. In PowerShell, put `& ` in front of it.

## Commands

```
saf-kanban-cli boards                     List local and Google Sheet boards
saf-kanban-cli board <board> [--column C] [--limit N]
                                          Columns with their tasks in order, assignees, and preset labels
saf-kanban-cli tasks <board> [--column C] [--assignee A] [--priority P] [--label L] [--search WORDS]
                     [--since TIME] [--until TIME] [--limit N]
                                          Find tasks (--assignee "" finds unassigned; --label "" or __unlabeled__ finds unlabeled)
saf-kanban-cli task <board> <task>        One task, with its whole description
saf-kanban-cli add <board> <title> [--column C] [--priority P] [--assignee A] [--issue ID] [--labels A,B]
                   [--description TEXT | --description-file FILE]
                                          Add a task at the end of a column (default: the first)
saf-kanban-cli edit <board> <task> [--title T] [--priority P] [--assignee A] [--issue ID]
                    [--labels A,B] [--add-label L] [--remove-label L]
                    [--description TEXT | --description-file FILE |
                     --append-description TEXT | --append-description-file FILE]
                                          Change some fields; an empty value ("") clears one
saf-kanban-cli move <board> <task>... <column> [--before TASK | --after TASK]
                                          Move one or more tasks to a column, optionally next to another
saf-kanban-cli delete <board> <task>      Delete a task (it is kept in the deleted tasks)
saf-kanban-cli deleted <board>            Deleted tasks, newest first, with their ids
saf-kanban-cli restore <board> <task> [--column C] [--before TASK | --after TASK]
                                          Put a deleted task back as it was: same id and
                                          contents, in its old column and place
saf-kanban-cli new-board <name> [--columns A,B,C] [--users A,B] [--labels "bug:red,feat:blue"] [--issue-link URL]
                         [--sheet URL|ID] [--script URL|ID] [--user NAME]
                                          Create a local board, or add a Google Sheet board (--script)
saf-kanban-cli edit-board <board> [--name N] [--columns A,B,C] [--rename OLD=NEW] [--users A,B]
                          [--labels "bug:red,feat:blue"] [--rename-label OLD=NEW]
                          [--issue-link URL] [--sheet URL|ID] [--script URL|ID] [--user NAME]
                                          --columns and --users are local boards only; --labels and --rename-label
                                          also work on Google Sheet boards (Apps Script v7+)
saf-kanban-cli delete-board <board>       Delete a local board, or remove a Google Sheet board from the list
saf-kanban-cli import <file> [--password PWD]
                                          Import exported Google Sheet settings or a local board JSON
saf-kanban-cli export [board...] [--sheets] [--out FILE] [--password PWD]
                                          Export a local board or Google Sheet settings
```

- `<board>` is a board's id or its exact name. `<task>` is a task id, shown in brackets like `[3f9a1c2e]`.
- Add `--json` to any command to get JSON instead of text.
- To add notes to an existing description without replacing it, use `--append-description` (or `--append-description-file`): it appends after a blank line safely under the lock.
- For a description with several lines, pass `--description -` (or `--append-description -`) to read from standard input, or `--description-file FILE` / `--append-description-file FILE` to read from a file. **In PowerShell, write the text to a temporary file and use `--description-file` / `--append-description-file` instead of piping through standard input**, to avoid PowerShell pipeline encoding issues.
- On a large board, narrow the view with `board <board> --column C --limit N` (or `tasks <board> --column C --limit N`). `--since` and `--until` (`YYYY-MM-DD` or ISO timestamp) filter by when a task last moved into its current column (`movedAt`), and `--limit N` returns the `N` tasks most recently moved into their column.

## How boards work

- Start with `boards`, then `board <board>`: it shows the column names, each column's tasks in order, the assignee names, and any preset labels. Use those exact names.
- Each task is in one column. Priorities are `high`, `medium` and `low`.
- Task descriptions are rendered as GitHub Flavored Markdown (headings, lists, checklists `- [ ]`, tables, code blocks, links, and ```` ```mermaid ```` diagrams) in the web and desktop UI; `task` still prints the raw text for easy reading and editing.
- Labels are hybrid and synced: tasks can use the board's preset labels or any new label name (matched case-insensitively, comma-separated). Saving a new label on a task automatically adds it to the board's global preset labels (local boards and Google Sheet boards with Apps Script v7+) with a deterministic color. On `edit`, prefer `--add-label` / `--remove-label` when adding or removing individual labels so existing labels aren't overwritten (`--labels` replaces the entire label list; `--labels ""` clears all labels).
- Preset label colors accept these 10 palette names — `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`, `gray` — or a `#RRGGBB` hex code (omit the color for an automatic deterministic color).
- Removing a preset label via `edit-board --labels` is rejected (`LABEL_IN_USE`) if any task on the board still uses it; remove it from those tasks first (or rename it with `--rename-label OLD=NEW`, which updates all tasks).
- For local boards, `--rename OLD=NEW` renames a column and its tasks follow it (a column that still has tasks can't be removed). For Google Sheet boards, columns and assignees are managed in the spreadsheet's `columns` and `users` tabs, while preset labels can be edited with `edit-board --labels` / `--rename-label` (requires Apps Script v7+; task labels require v6+).
- Ask the user before deleting tasks, deleting boards (`delete-board`), removing columns, or renaming boards.
- A deleted task can be put back with `restore`, exactly as it was. If a task was deleted by mistake, restore it (find its id with `deleted`) instead of adding it again with `add`, which would make a different task. If its column was removed since, pass `--column`.
- When a command fails it says why (an unknown column, a task id that doesn't exist, an older Apps Script version, ...) and exits with a non-zero status; fix the command and try again.
"#;
