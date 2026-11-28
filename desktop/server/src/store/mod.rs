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

mod attachments;
mod boards;
mod sheets;
mod tasks;

pub use attachments::{
    detect_image_type, extract_attachment_refs, mime_for_filename, valid_attachment_name,
    AttachmentInfo, MAX_ATTACHMENT_BYTES,
};
pub use sheets::{
    normalize_script_id, normalize_sheet_id, unique_title, SheetBoardPatch, DEFAULT_SHEET_BOARD_ID,
};

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};
use tokio::sync::broadcast;

use crate::error::{ApiError, ApiResult};
use crate::model::{Board, DeletedTask, LabelDef, Task, FILE_VERSION};

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

/// Complete exported local board, including Base64 copies of any local image
/// attachments referenced in its tasks or deleted history.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedBoard {
    #[serde(flatten)]
    pub board: Board,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub attachments: HashMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NewBoard {
    pub title: String,
    pub issue_link: String,
    /// Defaults to Todo, Doing, Done.
    pub columns: Option<Vec<String>>,
    pub users: Vec<String>,
    pub labels: Vec<LabelDef>,
    /// Tasks to start with, in board order: for a board copied from somewhere
    /// else or brought back from an exported file. A column they name that
    /// isn't in `columns` is added after the others.
    pub tasks: Vec<Task>,
    /// Deleted tasks to start with, oldest first.
    pub history: Vec<DeletedTask>,
    /// Optional Base64-encoded image attachments from an exported board file.
    pub attachments: HashMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BoardPatch {
    pub title: Option<String>,
    pub issue_link: Option<String>,
    /// The new list of columns, in order.
    pub columns: Option<Vec<String>>,
    pub users: Option<Vec<String>>,
    pub labels: Option<Vec<LabelDef>>,
    /// Old column name -> new column name; the column's tasks follow it.
    pub renames: HashMap<String, String>,
    /// Old label name -> new label name; existing tasks using it are updated.
    pub label_renames: HashMap<String, String>,
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
    pub labels: Option<Vec<String>>,
    pub add_labels: Option<Vec<String>>,
    pub remove_labels: Option<Vec<String>>,
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
    /// An empty value finds unlabeled tasks; otherwise matched case-insensitively.
    pub label: Option<String>,
    /// Words that must all appear in the title, description, issue ID, assignee or labels.
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
    /// How `sheets.json` looked after this process last saw or wrote it.
    seen_sheets: Mutex<Option<Option<Stamp>>>,
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
pub(crate) fn parse_time_bound(raw: &str, end_of_day: bool) -> ApiResult<String> {
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

/// Normalizes a task's labels: splits commas, trims, drops empties, and
/// deduplicates case-insensitively while preserving first-seen casing.
pub(crate) fn clean_labels<I, S>(raw: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();
    for entry in raw {
        for part in entry.as_ref().split(',') {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            if seen.insert(trimmed.to_lowercase()) {
                cleaned.push(trimmed.to_string());
            }
        }
    }
    cleaned
}

/// Applies optional `add` and `remove` mutations on top of `base` labels.
pub(crate) fn apply_label_mutations(
    base: Vec<String>,
    add: Option<Vec<String>>,
    remove: Option<Vec<String>>,
) -> Vec<String> {
    let remove_set: HashSet<String> = remove
        .map(clean_labels)
        .unwrap_or_default()
        .into_iter()
        .map(|name| name.to_lowercase())
        .collect();
    let mut combined = clean_labels(base);
    combined.retain(|name| !remove_set.contains(&name.to_lowercase()));
    if let Some(add) = add {
        for label in clean_labels(add) {
            let key = label.to_lowercase();
            if !remove_set.contains(&key) && !combined.iter().any(|existing| existing.to_lowercase() == key) {
                combined.push(label);
            }
        }
    }
    combined
}

fn normalize_label_color(color: &str) -> String {
    const PALETTE: [&str; 10] = [
        "red", "orange", "amber", "green", "teal", "blue", "indigo", "purple", "pink", "gray",
    ];
    let trimmed = color.trim().to_lowercase();
    if trimmed.is_empty() {
        return String::new();
    }
    if PALETTE.contains(&trimmed.as_str()) {
        return trimmed;
    }
    if let Some(hex) = trimmed.strip_prefix('#') {
        if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return trimmed;
        }
    }
    String::new()
}

/// Stable FNV-1a hash matching JS `hashLabelColor` (UTF-16 code units).
pub(crate) fn hash_label_color(name: &str) -> &'static str {
    const HASH_COLORS: [&str; 9] = [
        "red", "orange", "amber", "green", "teal", "blue", "indigo", "purple", "pink",
    ];
    let lower = name.trim().to_lowercase();
    let mut hash: i32 = 2166136261u32 as i32;
    for unit in lower.encode_utf16() {
        hash ^= i32::from(unit);
        hash = hash.wrapping_mul(16777619);
    }
    let idx = (hash.unsigned_abs() as usize) % HASH_COLORS.len();
    HASH_COLORS[idx]
}

/// Ensures every label in `labels` exists in `board.labels` (case-insensitively),
/// appending missing ones with their deterministic hash color. Returns `true` if
/// `board.labels` grew.
pub(crate) fn sync_board_labels(board: &mut Board, labels: &[String]) -> bool {
    let mut added = false;
    for raw in labels {
        let name = raw.replace(',', " ").trim().to_string();
        if name.is_empty() {
            continue;
        }
        let key = name.to_lowercase();
        if board
            .labels
            .iter()
            .any(|def| def.name.trim().to_lowercase() == key)
        {
            continue;
        }
        board.labels.push(LabelDef {
            color: hash_label_color(&name).to_string(),
            name,
        });
        added = true;
    }
    added
}

/// Trims board label definitions, drops empty names, and refuses case-insensitive duplicates.
pub(crate) fn clean_label_defs(defs: Vec<LabelDef>) -> ApiResult<Vec<LabelDef>> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();
    for def in defs {
        let name = def.name.replace(',', " ").trim().to_string();
        if name.is_empty() {
            continue;
        }
        if !seen.insert(name.to_lowercase()) {
            return Err(ApiError::invalid(
                "DUPLICATE_LABEL",
                format!("`{name}` is listed more than once."),
            ));
        }
        cleaned.push(LabelDef {
            name,
            color: normalize_label_color(&def.color),
        });
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
            seen_sheets: Mutex::new(None),
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

    pub(super) fn remember_sheets(&self) {
        let mut seen = self
            .seen_sheets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if seen.is_some() {
            *seen = Some(stamp(&self.sheets_path()));
        }
    }

    /// Announces the board files (and `sheets.json`) that other programs added,
    /// changed or removed since the last call, so open windows show the change.
    /// The first call only takes note of how things are. The app calls this
    /// every second or so.
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
            let sheets_now = stamp(&self.sheets_path());
            let mut seen = self
                .seen
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut seen_sheets = self
                .seen_sheets
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(before) = seen.as_ref() else {
                *seen = Some(now);
                *seen_sheets = Some(sheets_now);
                return;
            };
            let changed: Vec<String> = now
                .iter()
                .filter(|(id, stamp)| before.get(*id) != Some(stamp))
                .map(|(id, _)| id.clone())
                .collect();
            let removed = before.keys().any(|id| !now.contains_key(id));
            let sheets_changed = seen_sheets.as_ref().is_some_and(|prev| *prev != sheets_now);
            *seen = Some(now);
            *seen_sheets = Some(sheets_now);
            (
                changed.clone(),
                removed || !changed.is_empty() || sheets_changed,
            )
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

    pub(super) fn rename_replacing(from: &Path, to: &Path) -> ApiResult<()> {
        // On Windows another program (an antivirus scanner, a sync tool) may
        // have the file open for a moment; try again before giving up.
        let mut tries = 0;
        loop {
            match fs::rename(from, to) {
                Ok(()) => return Ok(()),
                Err(error)
                    if error.kind() == std::io::ErrorKind::PermissionDenied && tries < 20 =>
                {
                    tries += 1;
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => return Err(ApiError::storage(error)),
            }
        }
    }

    fn write(&self, board: &Board) -> ApiResult<()> {
        let path = self.path(&board.id);
        let temporary = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(board).map_err(ApiError::storage)?;
        fs::write(&temporary, text).map_err(ApiError::storage)?;
        Self::rename_replacing(&temporary, &path)?;
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
}
