//! Export and import files compatible with the web UI and desktop app
//! (`src/components/header/transfer/transferFile.js` and `src/lib/crypto.js`).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use time::{OffsetDateTime, UtcOffset};

use crate::model::{Board, SheetBoard};
use crate::store::{normalize_script_id, normalize_sheet_id};

pub const FILE_APP: &str = "saf-kanban";
pub const FILE_VERSION: u32 = 1;
pub const BOARD_KIND: &str = "board";

pub const PBKDF2_ITERATIONS: u32 = 600_000;
pub const MIN_PASSWORD_LENGTH: usize = 8;
const MAX_ITERATIONS: u32 = 10_000_000;
const KDF: &str = "PBKDF2-SHA256";
const CIPHER: &str = "AES-GCM";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionParams {
    pub kdf: String,
    pub iterations: u32,
    pub cipher: String,
    pub salt: String,
    pub iv: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedSheetBoard {
    title: String,
    sheet_id: String,
    script_id: String,
    user_key: String,
    jira_link: String,
}

/// Decoded contents of a SAF Kanban export file.
#[derive(Debug)]
pub enum ImportedFile {
    Sheets(Vec<SheetBoard>),
    LocalBoard(Board),
    /// Password-protected settings file; call [`decrypt_import`] with the
    /// user's password to obtain [`ImportedFile::Sheets`].
    Encrypted {
        encryption: EncryptionParams,
        data: String,
    },
}

fn iso_now() -> String {
    let t = OffsetDateTime::now_utc().to_offset(UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        t.millisecond()
    )
}

pub fn today_ymd() -> String {
    let t = OffsetDateTime::now_utc();
    format!("{:04}-{:02}-{:02}", t.year(), u8::from(t.month()), t.day())
}

/// Sanitizes a board title for a default export filename, matching
/// `exportLocalBoard` in `transferFile.js`.
pub fn safe_filename_part(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                || (c as u32) < 0x20
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed: String = cleaned.trim().chars().take(60).collect();
    if trimmed.is_empty() {
        "board".to_string()
    } else {
        trimmed
    }
}

pub fn encrypt_text(plaintext: &str, password: &str) -> Result<(EncryptionParams, String), String> {
    if password.chars().count() < MIN_PASSWORD_LENGTH {
        return Err(format!(
            "Password must be at least {MIN_PASSWORD_LENGTH} characters."
        ));
    }
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    getrandom::getrandom(&mut salt).map_err(|e| format!("Couldn't generate salt: {e}"))?;
    getrandom::getrandom(&mut iv).map_err(|e| format!("Couldn't generate IV: {e}"))?;

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut key);

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Encryption error: {e}"))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&iv), plaintext.as_bytes())
        .map_err(|e| format!("Encryption error: {e}"))?;

    Ok((
        EncryptionParams {
            kdf: KDF.to_string(),
            iterations: PBKDF2_ITERATIONS,
            cipher: CIPHER.to_string(),
            salt: BASE64.encode(salt),
            iv: BASE64.encode(iv),
        },
        BASE64.encode(ciphertext),
    ))
}

pub fn decrypt_text(
    encryption: &EncryptionParams,
    data_b64: &str,
    password: &str,
) -> Result<String, String> {
    if encryption.kdf != KDF || encryption.cipher != CIPHER {
        return Err("This encrypted file uses an unsupported encryption format.".to_string());
    }
    if encryption.iterations < 1 || encryption.iterations > MAX_ITERATIONS {
        return Err("This encrypted file has an unsupported PBKDF2 iteration count.".to_string());
    }
    let salt = BASE64
        .decode(encryption.salt.trim())
        .map_err(|_| "This encrypted file is damaged (invalid salt).".to_string())?;
    let iv = BASE64
        .decode(encryption.iv.trim())
        .map_err(|_| "This encrypted file is damaged (invalid IV).".to_string())?;
    if iv.len() != 12 {
        return Err("This encrypted file is damaged (invalid IV length).".to_string());
    }
    let ciphertext = BASE64
        .decode(data_b64.trim())
        .map_err(|_| "This encrypted file is damaged (invalid data).".to_string())?;

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, encryption.iterations, &mut key);

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Decryption error: {e}"))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&iv), ciphertext.as_ref())
        .map_err(|_| "Wrong password, or the file is damaged.".to_string())?;
    String::from_utf8(plaintext).map_err(|_| "Decrypted data is not valid UTF-8.".to_string())
}

/// Parses a SAF Kanban JSON export file (plain settings, encrypted settings, or
/// single local board), matching `readImportFile` in `transferFile.js`.
pub fn parse_import_file(text: &str) -> Result<ImportedFile, String> {
    let data: Value =
        serde_json::from_str(text).map_err(|_| "The file isn't valid JSON.".to_string())?;
    let Some(obj) = data.as_object() else {
        return Err("This doesn't look like a SAF Kanban export file.".to_string());
    };
    if obj.get("app").and_then(Value::as_str) != Some(FILE_APP) {
        return Err("This doesn't look like a SAF Kanban export file.".to_string());
    }
    let version = obj.get("version").and_then(Value::as_u64).unwrap_or(0);
    if version > u64::from(FILE_VERSION) {
        return Err("This export file was made by a newer version of SAF Kanban.".to_string());
    }

    if let Some(enc_val) = obj.get("encryption") {
        let encryption: EncryptionParams = serde_json::from_value(enc_val.clone())
            .map_err(|_| "This encrypted file has an unsupported format.".to_string())?;
        let Some(cipher_data) = obj.get("data").and_then(Value::as_str) else {
            return Err("This encrypted file is missing its encrypted data.".to_string());
        };
        return Ok(ImportedFile::Encrypted {
            encryption,
            data: cipher_data.to_string(),
        });
    }

    if obj.get("kind").and_then(Value::as_str) == Some(BOARD_KIND) {
        let Some(board_val) = obj.get("board") else {
            return Err("This board export file is missing its board data.".to_string());
        };
        if !board_val.get("tasks").is_some_and(Value::is_array) {
            return Err("This board export file has invalid board data.".to_string());
        }
        let board: Board = serde_json::from_value(board_val.clone())
            .map_err(|e| format!("Couldn't read board data: {e}"))?;
        return Ok(ImportedFile::LocalBoard(board));
    }

    let Some(boards_arr) = obj.get("boards").and_then(Value::as_array) else {
        return Err("This doesn't look like a SAF Kanban export file.".to_string());
    };
    let mut boards = Vec::new();
    for entry in boards_arr {
        let Some(map) = entry.as_object() else {
            continue;
        };
        let get = |key: &str| {
            map.get(key)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        boards.push(SheetBoard {
            id: String::new(),
            title: get("title").trim().to_string(),
            sheet_id: normalize_sheet_id(&get("sheetId")),
            script_id: normalize_script_id(&get("scriptId")),
            user_key: get("userKey").trim().to_string(),
            jira_link: get("jiraLink").trim().to_string(),
        });
    }
    if boards.is_empty() {
        return Err("This export file contains no boards.".to_string());
    }
    Ok(ImportedFile::Sheets(boards))
}

/// Builds a single local board export JSON string matching `exportLocalBoard`.
pub fn export_local_board_json(board: &Board) -> Result<String, String> {
    let payload = json!({
        "app": FILE_APP,
        "kind": BOARD_KIND,
        "version": FILE_VERSION,
        "exportedAt": iso_now(),
        "board": board,
    });
    serde_json::to_string_pretty(&payload).map_err(|e| format!("Couldn't serialize export: {e}"))
}

/// Builds a Google Sheet settings export JSON string (plain or password-encrypted)
/// matching `exportBoards` in `transferFile.js`.
pub fn export_sheets_json(boards: &[SheetBoard], password: Option<&str>) -> Result<String, String> {
    if boards.is_empty() {
        return Err("There are no Google Sheet boards to export.".to_string());
    }
    let exported: Vec<ExportedSheetBoard> = boards
        .iter()
        .map(|b| ExportedSheetBoard {
            title: if b.title.trim().is_empty() {
                if b.id == crate::store::DEFAULT_SHEET_BOARD_ID {
                    "SAF Kanban".to_string()
                } else {
                    "Untitled board".to_string()
                }
            } else {
                b.title.trim().to_string()
            },
            sheet_id: b.sheet_id.clone(),
            script_id: b.script_id.clone(),
            user_key: b.user_key.clone(),
            jira_link: b.jira_link.clone(),
        })
        .collect();
    let settings = json!({
        "app": FILE_APP,
        "version": FILE_VERSION,
        "exportedAt": iso_now(),
        "boards": exported,
    });

    let outer = if let Some(password) = password {
        let plaintext = serde_json::to_string(&settings)
            .map_err(|e| format!("Couldn't serialize settings: {e}"))?;
        let (encryption, data) = encrypt_text(&plaintext, password)?;
        json!({
            "app": FILE_APP,
            "version": FILE_VERSION,
            "encryption": encryption,
            "data": data,
        })
    } else {
        settings
    };

    serde_json::to_string_pretty(&outer).map_err(|e| format!("Couldn't serialize export: {e}"))
}
