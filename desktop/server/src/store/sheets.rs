//! Google Sheet board settings stored in `<data dir>/sheets.json`, shared
//! between the desktop app and `saf-kanban-cli`. Protected by the same
//! `boards.lock` as local board files.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::model::{SheetBoard, FILE_VERSION};

use super::{new_id, Store};

const SHEETS_FILE: &str = "sheets.json";
pub const DEFAULT_SHEET_BOARD_ID: &str = "default";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SheetsFile {
    version: u32,
    boards: Vec<SheetBoard>,
}

/// Patch for an existing Google Sheet board's stored settings.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetBoardPatch {
    pub title: Option<String>,
    pub sheet_id: Option<String>,
    pub script_id: Option<String>,
    pub user_key: Option<String>,
    pub jira_link: Option<String>,
}

/// Extracts a Google Sheet ID from a full spreadsheet URL, or returns the
/// trimmed value as-is. Matches `normalizeBoardField("sheetId", ...)` in the UI.
pub fn normalize_sheet_id(raw: &str) -> String {
    let text = raw.trim();
    if let Some(pos) = text.find("/spreadsheets/d/") {
        let rest = &text[pos + "/spreadsheets/d/".len()..];
        let id: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if !id.is_empty() {
            return id;
        }
    }
    text.to_string()
}

/// Extracts an Apps Script deployment ID from a `/macros/s/<id>/exec` URL, or
/// returns the trimmed value as-is. Matches `normalizeBoardField("scriptId", ...)`
/// in the UI. Local test URLs (`http://127.0.0.1:...` / `http://localhost:...`)
/// are kept intact.
pub fn normalize_script_id(raw: &str) -> String {
    let text = raw.trim();
    if let Some(pos) = text.find("/macros/s/") {
        let rest = &text[pos + "/macros/s/".len()..];
        if let Some(end) = rest.find("/exec") {
            let id = &rest[..end];
            if !id.is_empty()
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return id.to_string();
            }
        }
    }
    text.to_string()
}

/// Matches `uniqueBoardTitle` in `src/store/boards.js`: if `title` is already
/// taken, appends ` (1)`, ` (2)`, ...
pub fn unique_title(title: &str, taken: &HashSet<String>, fallback: &str) -> String {
    let trimmed = title.trim();
    let shown = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    if !taken.contains(shown) {
        return trimmed.to_string();
    }
    let base = strip_numeric_suffix(shown);
    let base = if base.is_empty() { shown } else { base };
    let mut n = 1usize;
    while taken.contains(&format!("{base} ({n})")) {
        n += 1;
    }
    format!("{base} ({n})")
}

fn strip_numeric_suffix(name: &str) -> &str {
    let Some(without_paren) = name.strip_suffix(')') else {
        return name;
    };
    let Some((head, digits)) = without_paren.rsplit_once('(') else {
        return name;
    };
    if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        head.trim_end()
    } else {
        name
    }
}

fn normalize_board(mut board: SheetBoard) -> SheetBoard {
    board.id = board.id.trim().to_string();
    board.title = board.title.trim().to_string();
    board.sheet_id = normalize_sheet_id(&board.sheet_id);
    board.script_id = normalize_script_id(&board.script_id);
    board.user_key = board.user_key.trim().to_string();
    board.jira_link = board.jira_link.trim().to_string();
    board
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &std::path::Path) {}

impl Store {
    pub(super) fn sheets_path(&self) -> PathBuf {
        self.dir.join(SHEETS_FILE)
    }

    fn read_sheets_unlocked(&self) -> ApiResult<Vec<SheetBoard>> {
        let path = self.sheets_path();
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(ApiError::storage(error)),
        };
        let file: SheetsFile = serde_json::from_str(&text)
            .map_err(|error| ApiError::storage(format!("`{SHEETS_FILE}` is damaged: {error}")))?;
        if file.version > FILE_VERSION {
            return Err(ApiError::invalid(
                "UNSUPPORTED_VERSION",
                format!("`{SHEETS_FILE}` was saved by a newer version of SAF Kanban."),
            ));
        }
        Ok(file.boards.into_iter().map(normalize_board).collect())
    }

    fn write_sheets_unlocked(&self, boards: &[SheetBoard]) -> ApiResult<()> {
        let file = SheetsFile {
            version: FILE_VERSION,
            boards: boards.to_vec(),
        };
        let content = serde_json::to_string_pretty(&file).map_err(ApiError::storage)?;
        let path = self.sheets_path();
        let temp = self.dir.join(format!("{SHEETS_FILE}.{}.tmp", new_id()));
        fs::write(&temp, content).map_err(ApiError::storage)?;
        restrict_permissions(&temp);
        if let Err(error) = Self::rename_replacing(&temp, &path) {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
        restrict_permissions(&path);
        self.remember_sheets();
        Ok(())
    }

    pub fn list_sheets(&self) -> ApiResult<Vec<SheetBoard>> {
        let _guard = self.reading()?;
        self.read_sheets_unlocked()
    }

    pub fn get_sheet(&self, id: &str) -> ApiResult<Option<SheetBoard>> {
        let _guard = self.reading()?;
        let boards = self.read_sheets_unlocked()?;
        Ok(boards.into_iter().find(|board| board.id == id))
    }

    /// Replaces the whole Google Sheet board list (used by the desktop app to
    /// keep its UI state synchronized with `<data dir>/sheets.json`).
    pub fn replace_sheets(&self, boards: Vec<SheetBoard>) -> ApiResult<Vec<SheetBoard>> {
        let _guard = self.writing()?;
        let mut seen_ids = HashSet::new();
        let mut normalized = Vec::with_capacity(boards.len());
        for mut board in boards.into_iter().map(normalize_board) {
            if board.id.is_empty() || !seen_ids.insert(board.id.clone()) {
                let mut id = new_id();
                while !seen_ids.insert(id.clone()) {
                    id = new_id();
                }
                board.id = id;
            }
            normalized.push(board);
        }
        self.write_sheets_unlocked(&normalized)?;
        self.announce("boards", None);
        Ok(normalized)
    }

    /// Adds one Google Sheet board to `sheets.json` with a fresh id (or
    /// `default` when it is the first Google Sheet board, matching the UI).
    pub fn add_sheet(&self, input: SheetBoard) -> ApiResult<SheetBoard> {
        let _guard = self.writing()?;
        let mut boards = self.read_sheets_unlocked()?;
        let mut board = normalize_board(input);
        let id = if boards.is_empty() && board.id.is_empty() {
            DEFAULT_SHEET_BOARD_ID.to_string()
        } else if !board.id.is_empty() && boards.iter().all(|b| b.id != board.id) {
            board.id.clone()
        } else {
            let mut candidate = new_id();
            while boards.iter().any(|b| b.id == candidate) {
                candidate = new_id();
            }
            candidate
        };
        board.id = id;
        boards.push(board.clone());
        self.write_sheets_unlocked(&boards)?;
        self.announce("boards", None);
        Ok(board)
    }

    /// Updates one Google Sheet board's stored settings in `sheets.json`.
    pub fn update_sheet(&self, id: &str, patch: SheetBoardPatch) -> ApiResult<SheetBoard> {
        let _guard = self.writing()?;
        let mut boards = self.read_sheets_unlocked()?;
        let Some(board) = boards.iter_mut().find(|b| b.id == id) else {
            return Err(ApiError::board_not_found(id));
        };
        if let Some(title) = patch.title {
            board.title = title.trim().to_string();
        }
        if let Some(sheet_id) = patch.sheet_id {
            board.sheet_id = normalize_sheet_id(&sheet_id);
        }
        if let Some(script_id) = patch.script_id {
            board.script_id = normalize_script_id(&script_id);
        }
        if let Some(user_key) = patch.user_key {
            board.user_key = user_key.trim().to_string();
        }
        if let Some(jira_link) = patch.jira_link {
            board.jira_link = jira_link.trim().to_string();
        }
        let updated = board.clone();
        self.write_sheets_unlocked(&boards)?;
        self.announce("boards", None);
        Ok(updated)
    }

    /// Removes one Google Sheet board from `sheets.json` (never touches the
    /// remote Google Sheet itself).
    pub fn delete_sheet(&self, id: &str) -> ApiResult<SheetBoard> {
        let _guard = self.writing()?;
        let mut boards = self.read_sheets_unlocked()?;
        let Some(index) = boards.iter().position(|b| b.id == id) else {
            return Err(ApiError::board_not_found(id));
        };
        let removed = boards.remove(index);
        self.write_sheets_unlocked(&boards)?;
        self.announce("boards", None);
        Ok(removed)
    }
}
