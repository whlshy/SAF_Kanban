//! Board-level CRUD operations on [`Store`].

use std::collections::{HashMap, HashSet};
use std::fs;

use crate::error::{ApiError, ApiResult};
use crate::model::{Board, BoardInfo, FILE_VERSION};

use super::{
    clean_label_defs, clean_labels, clean_names, new_id, now, valid_id, BoardPatch, NewBoard,
    Store, DEFAULT_COLUMNS, DEFAULT_PRIORITY,
};

impl Store {
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
            task.labels = clean_labels(task.labels);
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
                deleted.task.labels = clean_labels(deleted.task.labels);
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
            let mut board = Board {
                version: FILE_VERSION,
                id,
                title: input.title.trim().to_string(),
                issue_link: input.issue_link.trim().to_string(),
                columns,
                users: clean_names(input.users, "DUPLICATE_USER")?,
                labels: clean_label_defs(input.labels)?,
                created_at: time,
                tasks,
                history,
            };
            let task_labels: Vec<String> = board
                .tasks
                .iter()
                .flat_map(|task| task.labels.iter().cloned())
                .collect();
            super::sync_board_labels(&mut board, &task_labels);
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

            if !patch.label_renames.is_empty() {
                let mut label_renames = HashMap::new();
                for (from, to) in &patch.label_renames {
                    let to = to.replace(',', " ").trim().to_string();
                    if to.is_empty() {
                        return Err(ApiError::invalid(
                            "EMPTY_LABEL_NAME",
                            format!("Label `{from}` can't be renamed to an empty name."),
                        ));
                    }
                    label_renames.insert(from.trim().to_lowercase(), to);
                }
                for task in &mut board.tasks {
                    let updated: Vec<String> = task
                        .labels
                        .iter()
                        .map(|label| {
                            label_renames
                                .get(&label.to_lowercase())
                                .cloned()
                                .unwrap_or_else(|| label.clone())
                        })
                        .collect();
                    task.labels = clean_labels(updated);
                }
                if patch.labels.is_none() {
                    for def in &mut board.labels {
                        if let Some(new_name) = label_renames.get(&def.name.to_lowercase()) {
                            def.name = new_name.clone();
                        }
                    }
                    board.labels = clean_label_defs(std::mem::take(&mut board.labels))?;
                }
            }
            if let Some(labels) = patch.labels {
                let cleaned = clean_label_defs(labels)?;
                let allowed: HashSet<String> = cleaned
                    .iter()
                    .map(|def| def.name.trim().to_lowercase())
                    .collect();
                for task in &board.tasks {
                    for label in &task.labels {
                        let key = label.trim().to_lowercase();
                        if !allowed.contains(&key) {
                            let count = board
                                .tasks
                                .iter()
                                .filter(|t| {
                                    t.labels.iter().any(|l| l.trim().to_lowercase() == key)
                                })
                                .count();
                            return Err(ApiError::label_in_use(label, count));
                        }
                    }
                }
                board.labels = cleaned;
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
}
