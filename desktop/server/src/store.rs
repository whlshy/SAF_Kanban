//! Boards on disk: one JSON file per board in `<data dir>/boards/`.
//!
//! Every request reads the file again, so a file restored from a backup or
//! synced in by another program is picked up without a restart. Writes go to
//! a temporary file that then replaces the board file, so a crash can't leave
//! half a board behind.
//!
//! Several programs may use the same folder at once: the app, the command
//! line (`saf-kanban-cli`) and AI apps' MCP servers (`saf-kanban mcp`). They
//! take turns through a lock on `<data dir>/boards.lock`, so a change made by
//! one is never lost to another's. The app looks for changes made by the
//! others (see [`Store::notice_outside_changes`]) to show them right away.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};
use tokio::sync::broadcast;

use crate::error::{ApiError, ApiResult};
use crate::model::{Board, BoardInfo, DeletedTask, Task, FILE_VERSION};

pub const DEFAULT_COLUMNS: [&str; 3] = ["Todo", "Doing", "Done"];
pub const DEFAULT_PRIORITY: &str = "medium";

/// Sent to listeners (the web UI) after every change.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// `boards`: the list of boards changed. `board`: one board's content did.
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NewBoard {
    pub title: String,
    pub issue_link: String,
    /// Defaults to Todo, Doing, Done.
    pub columns: Option<Vec<String>>,
    pub users: Vec<String>,
    /// Tasks to start with, in board order: for a board copied from somewhere
    /// else or brought back from an exported file. A column they name that
    /// isn't in `columns` is added after the others.
    pub tasks: Vec<Task>,
    /// Deleted tasks to start with, oldest first.
    pub history: Vec<DeletedTask>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BoardPatch {
    pub title: Option<String>,
    pub issue_link: Option<String>,
    /// The new list of columns, in order.
    pub columns: Option<Vec<String>>,
    pub users: Option<Vec<String>>,
    /// Old column name -> new name; the column's tasks follow it.
    pub renames: HashMap<String, String>,
}

/// A task as a client sends it. Missing fields mean "empty" when creating or
/// replacing a task, and "unchanged" when patching one.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskInput {
    pub title: Option<String>,
    pub issue_id: Option<String>,
    pub des: Option<String>,
    /// Appended to the existing description with a blank line in between,
    /// inside the write lock so concurrent edits aren't overwritten.
    #[serde(alias = "appendDescription")]
    pub append_des: Option<String>,
    pub column: Option<String>,
    pub priority: Option<String>,
    pub assignee: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MoveInput {
    pub column: String,
    /// Put the task right before this one,
    pub before_id: Option<String>,
    /// or else right after this one. With neither, it keeps its place in the
    /// board order.
    pub after_id: Option<String>,
}

/// Where a deleted task goes back to. Left out, it goes back to the column
/// and place it was deleted from.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RestoreInput {
    pub column: Option<String>,
    /// Put it right before this task,
    pub before_id: Option<String>,
    /// or else right after this one.
    pub after_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskQuery {
    pub column: Option<String>,
    /// An empty value finds unassigned tasks.
    pub assignee: Option<String>,
    pub priority: Option<String>,
    /// Words that must all appear in the title, description, issue ID or assignee.
    pub q: Option<String>,
    /// Only tasks moved into their current column at or after this time
    /// (`YYYY-MM-DD` or ISO timestamp).
    pub since: Option<String>,
    /// Only tasks moved into their current column at or before this time
    /// (`YYYY-MM-DD`, inclusive of the whole day, or ISO timestamp).
    pub until: Option<String>,
    /// At most this many tasks, most recently moved into their column first.
    pub limit: Option<usize>,
}

pub struct Store {
    dir: PathBuf,
    /// Serializes file access inside this process; `boards.lock` does it
    /// between processes.
    lock: RwLock<()>,
    changes: broadcast::Sender<Change>,
    /// How each board file looked after this process last saw or wrote it;
    /// `None` until [`Store::notice_outside_changes`] first runs.
    seen: Mutex<Option<HashMap<String, Stamp>>>,
}

/// When a file was last changed, and its size.
type Stamp = (Option<SystemTime>, u64);

fn stamp(path: &Path) -> Option<Stamp> {
    let metadata = fs::metadata(path).ok()?;
    Some((metadata.modified().ok(), metadata.len()))
}

/// Held while board files are being read or written. Dropping it lets the
/// next one in (closing the lock file releases its lock).
struct Access<'a> {
    _read: Option<RwLockReadGuard<'a, ()>>,
    _write: Option<RwLockWriteGuard<'a, ()>>,
    _file: Option<File>,
}

/// UTC with milliseconds, always the same width, so the strings sort by time.
fn format_utc(time: OffsetDateTime) -> String {
    let time = time.to_offset(UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        time.year(),
        u8::from(time.month()),
        time.day(),
        time.hour(),
        time.minute(),
        time.second(),
        time.millisecond()
    )
}

fn now() -> String {
    format_utc(OffsetDateTime::now_utc())
}

/// Parses a `since`/`until` bound (`YYYY-MM-DD` or ISO timestamp) into a UTC
/// timestamp formatted like [`now`]. With `end_of_day`, an omitted time or
/// sub-second part fills to the end of that unit so `--until 2026-11-24`
/// includes the whole day.
fn parse_time_bound(raw: &str, end_of_day: bool) -> ApiResult<String> {
    let invalid = || {
        ApiError::invalid(
            "INVALID_TIME",
            format!(
                "`{raw}` isn't a valid date or time. Use YYYY-MM-DD or an ISO timestamp like 2026-11-24T08:00:00Z."
            ),
        )
    };
    let text = raw.trim();
    if text.len() < 10 {
        return Err(invalid());
    }
    let bytes = text.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(invalid());
    }
    let year: i32 = text[0..4].parse().map_err(|_| invalid())?;
    let month: u8 = text[5..7].parse().map_err(|_| invalid())?;
    let day: u8 = text[8..10].parse().map_err(|_| invalid())?;
    let date = Date::from_calendar_date(year, Month::try_from(month).map_err(|_| invalid())?, day)
        .map_err(|_| invalid())?;

    let rest = &text[10..];
    if rest.is_empty() {
        let time = if end_of_day {
            Time::from_hms_milli(23, 59, 59, 999).map_err(|_| invalid())?
        } else {
            Time::MIDNIGHT
        };
        return Ok(format_utc(PrimitiveDateTime::new(date, time).assume_utc()));
    }

    let rest = rest
        .strip_prefix('T')
        .or_else(|| rest.strip_prefix('t'))
        .or_else(|| rest.strip_prefix(' '))
        .ok_or_else(invalid)?;

    let (time_part, offset) =
        if let Some(stripped) = rest.strip_suffix('Z').or_else(|| rest.strip_suffix('z')) {
            (stripped, UtcOffset::UTC)
        } else if let Some(sign_pos) = rest.rfind(['+', '-']) {
            let sign: i8 = if rest.as_bytes()[sign_pos] == b'+' {
                1
            } else {
                -1
            };
            let tz = &rest[sign_pos + 1..];
            let (tz_h, tz_m) = match tz.split_once(':') {
                Some((h, m)) if h.len() == 2 && m.len() == 2 => (h, m),
                None if tz.len() == 4 => (&tz[0..2], &tz[2..4]),
                _ => return Err(invalid()),
            };
            let h: i8 = tz_h.parse().map_err(|_| invalid())?;
            let m: i8 = tz_m.parse().map_err(|_| invalid())?;
            if !(0..=23).contains(&h) || !(0..=59).contains(&m) {
                return Err(invalid());
            }
            let offset = UtcOffset::from_hms(sign * h, sign * m, 0).map_err(|_| invalid())?;
            (&rest[..sign_pos], offset)
        } else {
            (rest, UtcOffset::UTC)
        };

    let (hms, frac) = match time_part.split_once('.') {
        Some((hms, frac)) if !frac.is_empty() && frac.bytes().all(|b| b.is_ascii_digit()) => {
            (hms, Some(frac))
        }
        Some(_) => return Err(invalid()),
        None => (time_part, None),
    };
    let parts: Vec<&str> = hms.split(':').collect();
    if parts.len() != 2 && parts.len() != 3 {
        return Err(invalid());
    }
    if parts.iter().any(|part| part.len() != 2) {
        return Err(invalid());
    }
    let hour: u8 = parts[0].parse().map_err(|_| invalid())?;
    let minute: u8 = parts[1].parse().map_err(|_| invalid())?;
    let (second, milli) = if parts.len() == 3 {
        let second: u8 = parts[2].parse().map_err(|_| invalid())?;
        let milli: u16 = match frac {
            Some(frac) => {
                let mut digits = frac.chars().take(3).collect::<String>();
                while digits.len() < 3 {
                    digits.push('0');
                }
                digits.parse().map_err(|_| invalid())?
            }
            None if end_of_day => 999,
            None => 0,
        };
        (second, milli)
    } else {
        if frac.is_some() {
            return Err(invalid());
        }
        if end_of_day {
            (59, 999)
        } else {
            (0, 0)
        }
    };
    let time = Time::from_hms_milli(hour, minute, second, milli).map_err(|_| invalid())?;
    Ok(format_utc(
        PrimitiveDateTime::new(date, time).assume_offset(offset),
    ))
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..8].to_string()
}

/// Ids end up in file names and URLs.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Trims the names, drops empty ones and refuses duplicates.
fn clean_names(names: Vec<String>, duplicate_code: &'static str) -> ApiResult<Vec<String>> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();
    for name in names {
        let name = name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        if !seen.insert(name.clone()) {
            return Err(ApiError::invalid(
                duplicate_code,
                format!("`{name}` is listed more than once."),
            ));
        }
        cleaned.push(name);
    }
    Ok(cleaned)
}

fn check_column(board: &Board, column: &str) -> ApiResult<()> {
    if board.columns.iter().any(|name| name == column) {
        Ok(())
    } else {
        Err(ApiError::unknown_column(column, &board.columns))
    }
}

fn find_task(board: &Board, id: &str) -> ApiResult<usize> {
    board
        .tasks
        .iter()
        .position(|task| task.id == id)
        .ok_or_else(|| ApiError::task_not_found(id))
}

impl Store {
    pub fn open(dir: impl Into<PathBuf>) -> std::io::Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(dir.join("boards"))?;
        let (changes, _) = broadcast::channel(64);
        Ok(Self {
            dir,
            lock: RwLock::new(()),
            changes,
            seen: Mutex::new(None),
        })
    }

    /// Locks `boards.lock`: shared for reading, exclusive for writing.
    fn lock_file(&self, exclusive: bool) -> ApiResult<Option<File>> {
        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.dir.join("boards.lock"))
            .map_err(ApiError::storage)?;
        let locked = if exclusive {
            file.lock()
        } else {
            file.lock_shared()
        };
        match locked {
            Ok(()) => Ok(Some(file)),
            // Some network drives can't lock files; go on without.
            Err(error) if error.kind() == std::io::ErrorKind::Unsupported => Ok(None),
            Err(error) => Err(ApiError::storage(error)),
        }
    }

    fn reading(&self) -> ApiResult<Access<'_>> {
        let read = self
            .lock
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(Access {
            _read: Some(read),
            _write: None,
            _file: self.lock_file(false)?,
        })
    }

    fn writing(&self) -> ApiResult<Access<'_>> {
        let write = self
            .lock
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(Access {
            _read: None,
            _write: Some(write),
            _file: self.lock_file(true)?,
        })
    }

    /// The board files and how each looks now; `None` if the folder can't be read.
    fn scan(&self) -> Option<HashMap<String, Stamp>> {
        let mut found = HashMap::new();
        for entry in fs::read_dir(self.dir.join("boards")).ok()? {
            let path = entry.ok()?.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            if let Some(stamp) = stamp(&path) {
                found.insert(id.to_string(), stamp);
            }
        }
        Some(found)
    }

    /// Takes note of a board file this process just wrote or removed, so it
    /// isn't taken for a change made by another program.
    fn remember(&self, id: &str) {
        let mut seen = self
            .seen
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(seen) = seen.as_mut() {
            match stamp(&self.path(id)) {
                Some(stamp) => seen.insert(id.to_string(), stamp),
                None => seen.remove(id),
            };
        }
    }

    /// Announces the board files that other programs added, changed or
    /// removed since the last call, so open windows show the change. The first
    /// call only takes note of how things are. The app calls this every
    /// second or so.
    pub fn notice_outside_changes(&self) {
        let (changed, list_changed) = {
            // This process's own writes hold the write lock until `remember`.
            let _guard = self
                .lock
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(now) = self.scan() else {
                return;
            };
            let mut seen = self
                .seen
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(before) = seen.as_ref() else {
                *seen = Some(now);
                return;
            };
            let changed: Vec<String> = now
                .iter()
                .filter(|(id, stamp)| before.get(*id) != Some(stamp))
                .map(|(id, _)| id.clone())
                .collect();
            let removed = before.keys().any(|id| !now.contains_key(id));
            *seen = Some(now);
            (changed.clone(), removed || !changed.is_empty())
        };
        for id in &changed {
            self.announce("board", Some(id));
        }
        // A title may have changed, or a board come or gone.
        if list_changed {
            self.announce("boards", None);
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Change> {
        self.changes.subscribe()
    }

    /// Tells open windows that the desktop app's update status changed.
    pub fn announce_update(&self) {
        self.announce("update", None);
    }

    fn announce(&self, kind: &'static str, board_id: Option<&str>) {
        // No listeners is fine.
        let _ = self.changes.send(Change {
            kind,
            board_id: board_id.map(str::to_string),
        });
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join("boards").join(format!("{id}.json"))
    }

    fn read(&self, id: &str) -> ApiResult<Board> {
        if !valid_id(id) {
            return Err(ApiError::board_not_found(id));
        }
        let text = match fs::read_to_string(self.path(id)) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(ApiError::board_not_found(id))
            }
            Err(error) => return Err(ApiError::storage(error)),
        };
        let mut board: Board = serde_json::from_str(&text).map_err(ApiError::storage)?;
        if board.version > FILE_VERSION {
            return Err(ApiError::unsupported_file(id));
        }
        // The file name is the id, whatever the file says (e.g. a copied file).
        board.id = id.to_string();
        Ok(board)
    }

    fn write(&self, board: &Board) -> ApiResult<()> {
        let path = self.path(&board.id);
        let temporary = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(board).map_err(ApiError::storage)?;
        fs::write(&temporary, text).map_err(ApiError::storage)?;
        // On Windows another program (an antivirus scanner, a sync tool) may
        // have the file open for a moment; try again before giving up.
        let mut tries = 0;
        loop {
            match fs::rename(&temporary, &path) {
                Ok(()) => break,
                Err(error)
                    if error.kind() == std::io::ErrorKind::PermissionDenied && tries < 20 =>
                {
                    tries += 1;
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => return Err(ApiError::storage(error)),
            }
        }
        self.remember(&board.id);
        Ok(())
    }

    /// Reads a board, changes it and saves it, as one step.
    fn update<T>(&self, id: &str, change: impl FnOnce(&mut Board) -> ApiResult<T>) -> ApiResult<T> {
        let result = {
            let _guard = self.writing()?;
            let mut board = self.read(id)?;
            let result = change(&mut board)?;
            self.write(&board)?;
            result
        };
        self.announce("board", Some(id));
        Ok(result)
    }

    // ---- boards ----

    /// All boards, oldest first. Files that can't be read are skipped.
    pub fn list_boards(&self) -> ApiResult<Vec<BoardInfo>> {
        let _guard = self.reading()?;
        let mut boards = Vec::new();
        for entry in fs::read_dir(self.dir.join("boards")).map_err(ApiError::storage)? {
            let path = entry.map_err(ApiError::storage)?.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            match self.read(id) {
                Ok(board) => boards.push(board),
                Err(error) => {
                    eprintln!("Skipping board file {}: {}", path.display(), error.message)
                }
            }
        }
        boards.sort_by(|a, b| {
            (&a.created_at, &a.title, &a.id).cmp(&(&b.created_at, &b.title, &b.id))
        });
        Ok(boards.iter().map(BoardInfo::from).collect())
    }

    pub fn get_board(&self, id: &str) -> ApiResult<Board> {
        let _guard = self.reading()?;
        self.read(id)
    }

    pub fn create_board(&self, input: NewBoard) -> ApiResult<BoardInfo> {
        let mut columns = match input.columns {
            Some(columns) => clean_names(columns, "DUPLICATE_COLUMN")?,
            None if input.tasks.is_empty() => DEFAULT_COLUMNS
                .iter()
                .map(|name| name.to_string())
                .collect(),
            // The tasks say which columns there are.
            None => Vec::new(),
        };
        let time = now();

        let mut ids = HashSet::new();
        let mut tasks = Vec::new();
        for mut task in input.tasks {
            task.column = task.column.trim().to_string();
            if task.column.is_empty() {
                task.column = match columns.first() {
                    Some(first) => first.clone(),
                    None => DEFAULT_COLUMNS[0].to_string(),
                };
            }
            if !columns.contains(&task.column) {
                columns.push(task.column.clone());
            }
            // Keeps its id where it can, so it can be told apart from a copy.
            if !valid_id(&task.id) || ids.contains(&task.id) {
                task.id = new_id();
                while ids.contains(&task.id) {
                    task.id = new_id();
                }
            }
            ids.insert(task.id.clone());
            if task.priority.is_empty() {
                task.priority = DEFAULT_PRIORITY.to_string();
            }
            if task.created_at.is_empty() {
                task.created_at = time.clone();
            }
            if task.updated_at.is_empty() {
                task.updated_at = task.created_at.clone();
            }
            tasks.push(task);
        }
        let history = input
            .history
            .into_iter()
            .map(|mut deleted| {
                if deleted.deleted_at.is_empty() {
                    deleted.deleted_at = time.clone();
                }
                deleted
            })
            .collect();

        let board = {
            let _guard = self.writing()?;
            let mut id = new_id();
            while self.path(&id).exists() {
                id = new_id();
            }
            let board = Board {
                version: FILE_VERSION,
                id,
                title: input.title.trim().to_string(),
                issue_link: input.issue_link.trim().to_string(),
                columns,
                users: clean_names(input.users, "DUPLICATE_USER")?,
                created_at: time,
                tasks,
                history,
            };
            self.write(&board)?;
            board
        };
        self.announce("boards", Some(&board.id));
        Ok(BoardInfo::from(&board))
    }

    pub fn update_board(&self, id: &str, patch: BoardPatch) -> ApiResult<BoardInfo> {
        let info = self.update(id, |board| {
            if let Some(title) = patch.title {
                board.title = title.trim().to_string();
            }
            if let Some(issue_link) = patch.issue_link {
                board.issue_link = issue_link.trim().to_string();
            }

            // Every name is looked up once, so two columns can swap names.
            let mut renames = HashMap::new();
            for (from, to) in &patch.renames {
                let to = to.trim();
                if to.is_empty() {
                    return Err(ApiError::invalid(
                        "EMPTY_COLUMN_NAME",
                        format!("Column `{from}` can't be renamed to an empty name."),
                    ));
                }
                renames.insert(from.clone(), to.to_string());
            }
            let renamed =
                |name: &String| renames.get(name).cloned().unwrap_or_else(|| name.clone());
            for task in &mut board.tasks {
                task.column = renamed(&task.column);
            }

            let columns = match patch.columns {
                Some(columns) => columns,
                None => board.columns.iter().map(renamed).collect(),
            };
            let columns = clean_names(columns, "DUPLICATE_COLUMN")?;
            for column in board.tasks.iter().map(|task| &task.column) {
                if !columns.contains(column) {
                    let count = board
                        .tasks
                        .iter()
                        .filter(|task| &task.column == column)
                        .count();
                    return Err(ApiError::column_not_empty(column, count));
                }
            }
            board.columns = columns;

            if let Some(users) = patch.users {
                board.users = clean_names(users, "DUPLICATE_USER")?;
            }
            Ok(BoardInfo::from(&*board))
        })?;
        self.announce("boards", Some(id));
        Ok(info)
    }

    /// The file is moved to `<data dir>/trash/` instead of being deleted.
    pub fn delete_board(&self, id: &str) -> ApiResult<()> {
        {
            let _guard = self.writing()?;
            self.read(id)?;
            let trash = self.dir.join("trash");
            fs::create_dir_all(&trash).map_err(ApiError::storage)?;
            let stamp = now().replace(':', "-");
            fs::rename(self.path(id), trash.join(format!("{id}-{stamp}.json")))
                .map_err(ApiError::storage)?;
            self.remember(id);
        }
        self.announce("boards", Some(id));
        Ok(())
    }

    // ---- tasks ----

    pub fn list_tasks(&self, board_id: &str, query: &TaskQuery) -> ApiResult<Vec<Task>> {
        let board = self.get_board(board_id)?;
        if let Some(column) = &query.column {
            check_column(&board, column)?;
        }
        let since = query
            .since
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| parse_time_bound(value, false))
            .transpose()?;
        let until = query
            .until
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| parse_time_bound(value, true))
            .transpose()?;
        let terms: Vec<String> = query
            .q
            .as_deref()
            .unwrap_or("")
            .to_lowercase()
            .split_whitespace()
            .map(str::to_string)
            .collect();
        let mut tasks: Vec<Task> = board
            .tasks
            .into_iter()
            .filter(|task| {
                query
                    .column
                    .as_ref()
                    .is_none_or(|column| &task.column == column)
            })
            .filter(|task| {
                query
                    .assignee
                    .as_ref()
                    .is_none_or(|assignee| &task.assignee == assignee)
            })
            .filter(|task| {
                query
                    .priority
                    .as_ref()
                    .is_none_or(|priority| &task.priority == priority)
            })
            .filter(|task| {
                since
                    .as_ref()
                    .is_none_or(|bound| !task.moved_at.is_empty() && task.moved_at >= *bound)
            })
            .filter(|task| {
                until
                    .as_ref()
                    .is_none_or(|bound| !task.moved_at.is_empty() && task.moved_at <= *bound)
            })
            .filter(|task| {
                let haystack = [&task.title, &task.des, &task.issue_id, &task.assignee]
                    .map(|field| field.to_lowercase())
                    .join("\n");
                terms.iter().all(|term| haystack.contains(term))
            })
            .collect();
        if let Some(limit) = query.limit {
            tasks.sort_by(
                |a, b| match (a.moved_at.is_empty(), b.moved_at.is_empty()) {
                    (true, true) => std::cmp::Ordering::Equal,
                    (true, false) => std::cmp::Ordering::Greater,
                    (false, true) => std::cmp::Ordering::Less,
                    (false, false) => b.moved_at.cmp(&a.moved_at),
                },
            );
            tasks.truncate(limit);
        }
        Ok(tasks)
    }

    pub fn get_task(&self, board_id: &str, task_id: &str) -> ApiResult<Task> {
        let board = self.get_board(board_id)?;
        let index = find_task(&board, task_id)?;
        Ok(board.tasks[index].clone())
    }

    /// Adds a task at the end of the board order, in the first column unless
    /// one is given.
    pub fn create_task(&self, board_id: &str, input: TaskInput) -> ApiResult<Task> {
        self.update(board_id, |board| {
            let mut id = new_id();
            while board.tasks.iter().any(|task| task.id == id) {
                id = new_id();
            }
            add_task(board, id, input)
        })
    }

    /// Replaces the task with this id, or creates it. Used by the web UI,
    /// which picks the id of a new task itself.
    pub fn put_task(&self, board_id: &str, task_id: &str, input: TaskInput) -> ApiResult<Task> {
        if !valid_id(task_id) {
            return Err(ApiError::invalid(
                "INVALID_TASK_ID",
                "A task id may only contain letters, digits, `-` and `_` (at most 64).",
            ));
        }
        self.update(board_id, |board| {
            match board.tasks.iter().position(|task| task.id == task_id) {
                None => add_task(board, task_id.to_string(), input),
                Some(index) => {
                    let column = match input.column.filter(|column| !column.is_empty()) {
                        Some(column) => {
                            check_column(board, &column)?;
                            column
                        }
                        None => board.tasks[index].column.clone(),
                    };
                    let time = now();
                    let task = &mut board.tasks[index];
                    task.title = input.title.unwrap_or_default();
                    task.issue_id = input.issue_id.unwrap_or_default();
                    task.des = input.des.unwrap_or_default();
                    task.priority = input.priority.unwrap_or_default();
                    task.assignee = input.assignee.unwrap_or_default();
                    if task.column != column {
                        task.moved_at = time.clone();
                    }
                    task.column = column;
                    task.updated_at = time;
                    Ok(task.clone())
                }
            }
        })
    }

    /// Changes only the fields that are given.
    pub fn patch_task(&self, board_id: &str, task_id: &str, input: TaskInput) -> ApiResult<Task> {
        if input.des.is_some() && input.append_des.is_some() {
            return Err(ApiError::invalid(
                "CONFLICTING_FIELDS",
                "Give either `description` or `appendDescription`, not both.",
            ));
        }
        self.update(board_id, |board| {
            let index = find_task(board, task_id)?;
            if let Some(column) = &input.column {
                check_column(board, column)?;
            }
            let time = now();
            let task = &mut board.tasks[index];
            if let Some(title) = input.title {
                task.title = title;
            }
            if let Some(issue_id) = input.issue_id {
                task.issue_id = issue_id;
            }
            if let Some(des) = input.des {
                task.des = des;
            }
            if let Some(append) = input.append_des {
                if !append.is_empty() {
                    let existing = task.des.trim_end_matches(['\r', '\n']);
                    if existing.is_empty() {
                        task.des = append;
                    } else {
                        task.des = format!("{existing}\n\n{append}");
                    }
                }
            }
            if let Some(column) = input.column {
                if task.column != column {
                    task.moved_at = time.clone();
                }
                task.column = column;
            }
            if let Some(priority) = input.priority {
                task.priority = priority;
            }
            if let Some(assignee) = input.assignee {
                task.assignee = assignee;
            }
            task.updated_at = time;
            Ok(task.clone())
        })
    }

    pub fn move_task(&self, board_id: &str, task_id: &str, input: MoveInput) -> ApiResult<Task> {
        self.update(board_id, |board| {
            let index = find_task(board, task_id)?;
            check_column(board, &input.column)?;
            // A neighbour that doesn't exist (or is the task itself) is ignored,
            // like a neighbour that was deleted in the meantime.
            let neighbour = |id: &Option<String>| {
                id.as_deref()
                    .filter(|id| *id != task_id && board.tasks.iter().any(|task| task.id == *id))
                    .map(str::to_string)
            };
            let before = neighbour(&input.before_id);
            let after = neighbour(&input.after_id);

            let time = now();
            let mut task = board.tasks.remove(index);
            if task.column != input.column {
                task.moved_at = time.clone();
            }
            task.column = input.column.clone();
            task.updated_at = time;
            let position = |id: &str| board.tasks.iter().position(|task| task.id == id);
            let target = match (before, after) {
                (Some(before), _) => position(&before).unwrap_or(index),
                (None, Some(after)) => position(&after).map(|at| at + 1).unwrap_or(index),
                (None, None) => index,
            };
            board
                .tasks
                .insert(target.min(board.tasks.len()), task.clone());
            Ok(task)
        })
    }

    /// Moves several tasks to a column in a single write. If any task id
    /// doesn't exist, nothing is changed.
    pub fn move_tasks(
        &self,
        board_id: &str,
        task_ids: &[String],
        input: MoveInput,
    ) -> ApiResult<Vec<Task>> {
        self.update(board_id, |board| {
            check_column(board, &input.column)?;
            let mut seen = HashSet::new();
            let mut unique_ids = Vec::new();
            for id in task_ids {
                find_task(board, id)?;
                if seen.insert(id.as_str()) {
                    unique_ids.push(id.clone());
                }
            }
            let moving: HashSet<&str> = unique_ids.iter().map(String::as_str).collect();
            let neighbour = |id: &Option<String>| {
                id.as_deref()
                    .filter(|id| {
                        !moving.contains(*id) && board.tasks.iter().any(|task| task.id == *id)
                    })
                    .map(str::to_string)
            };
            let before = neighbour(&input.before_id);
            let after = neighbour(&input.after_id);
            let time = now();

            if before.is_none() && after.is_none() {
                let mut moved = Vec::with_capacity(unique_ids.len());
                for id in &unique_ids {
                    let index = find_task(board, id)?;
                    let task = &mut board.tasks[index];
                    if task.column != input.column {
                        task.moved_at = time.clone();
                    }
                    task.column = input.column.clone();
                    task.updated_at = time.clone();
                    moved.push(task.clone());
                }
                return Ok(moved);
            }

            let mut moved = Vec::with_capacity(unique_ids.len());
            for id in &unique_ids {
                let index = find_task(board, id)?;
                let mut task = board.tasks.remove(index);
                if task.column != input.column {
                    task.moved_at = time.clone();
                }
                task.column = input.column.clone();
                task.updated_at = time.clone();
                moved.push(task);
            }
            let position = |id: &str| board.tasks.iter().position(|task| task.id == id);
            let target = match (before, after) {
                (Some(before), _) => position(&before).unwrap_or(board.tasks.len()),
                (None, Some(after)) => position(&after)
                    .map(|at| at + 1)
                    .unwrap_or(board.tasks.len()),
                (None, None) => board.tasks.len(),
            };
            let target = target.min(board.tasks.len());
            board.tasks.splice(target..target, moved.iter().cloned());
            Ok(moved)
        })
    }

    /// Removes the task from the board and keeps it in the board's history,
    /// with where it was, so it can be restored.
    pub fn delete_task(&self, board_id: &str, task_id: &str) -> ApiResult<()> {
        self.update(board_id, |board| {
            let index = find_task(board, task_id)?;
            let column = board.tasks[index].column.clone();
            let same_column = |task: &&Task| task.column == column;
            let previous_id = board.tasks[..index].iter().rev().find(same_column);
            let next_id = board.tasks[index + 1..].iter().find(same_column);
            let (previous_id, next_id) = (
                previous_id.map(|task| task.id.clone()).unwrap_or_default(),
                next_id.map(|task| task.id.clone()).unwrap_or_default(),
            );
            let task = board.tasks.remove(index);
            board.history.push(DeletedTask {
                task,
                deleted_at: now(),
                previous_id,
                next_id,
            });
            Ok(())
        })
    }

    /// Puts a deleted task back on the board as it was: the same id, contents
    /// and creation time, in the column and place it was deleted from where
    /// they still exist. Not a new task made from the old one.
    pub fn restore_task(
        &self,
        board_id: &str,
        task_id: &str,
        input: RestoreInput,
    ) -> ApiResult<Task> {
        self.update(board_id, |board| {
            // The latest deletion, if the same id was deleted more than once.
            let at = board
                .history
                .iter()
                .rposition(|deleted| deleted.task.id == task_id)
                .ok_or_else(|| ApiError::deleted_task_not_found(task_id))?;
            if board.tasks.iter().any(|task| task.id == task_id) {
                return Err(ApiError::task_exists(task_id));
            }
            let deleted = &board.history[at];
            let column = match input.column.filter(|column| !column.is_empty()) {
                Some(column) => {
                    check_column(board, &column)?;
                    column
                }
                None if board.columns.contains(&deleted.task.column) => deleted.task.column.clone(),
                None => return Err(ApiError::column_gone(&deleted.task.column, &board.columns)),
            };

            let position = |id: Option<&str>| {
                id.filter(|id| !id.is_empty())
                    .and_then(|id| board.tasks.iter().position(|task| task.id == id))
            };
            // Its old neighbours count only if they are still in that column.
            let neighbour =
                |id: &str| position(Some(id)).filter(|index| board.tasks[*index].column == column);
            let back_home = column == deleted.task.column;
            let target = if let Some(index) = position(input.before_id.as_deref()) {
                index
            } else if let Some(index) = position(input.after_id.as_deref()) {
                index + 1
            } else if let Some(index) = neighbour(&deleted.next_id).filter(|_| back_home) {
                index
            } else if let Some(index) = neighbour(&deleted.previous_id).filter(|_| back_home) {
                index + 1
            } else {
                // The end of the column.
                board.tasks.len()
            };

            let time = now();
            let mut task = board.history.remove(at).task;
            if !back_home {
                task.moved_at = time.clone();
            }
            task.column = column;
            task.updated_at = time;
            board.tasks.insert(target, task.clone());
            Ok(task)
        })
    }

    /// Deleted tasks, newest first.
    pub fn history(&self, board_id: &str) -> ApiResult<Vec<DeletedTask>> {
        let mut history = self.get_board(board_id)?.history;
        history.reverse();
        Ok(history)
    }
}

fn add_task(board: &mut Board, id: String, input: TaskInput) -> ApiResult<Task> {
    let column = match input.column.filter(|column| !column.is_empty()) {
        Some(column) => {
            check_column(board, &column)?;
            column
        }
        None => board
            .columns
            .first()
            .cloned()
            .ok_or_else(ApiError::no_columns)?,
    };
    let time = now();
    let task = Task {
        id,
        title: input.title.unwrap_or_default(),
        issue_id: input.issue_id.unwrap_or_default(),
        des: input.des.unwrap_or_default(),
        column,
        priority: input
            .priority
            .filter(|priority| !priority.is_empty())
            .unwrap_or_else(|| DEFAULT_PRIORITY.to_string()),
        assignee: input.assignee.unwrap_or_default(),
        created_at: time.clone(),
        updated_at: time.clone(),
        moved_at: time,
    };
    board.tasks.push(task.clone());
    Ok(task)
}
