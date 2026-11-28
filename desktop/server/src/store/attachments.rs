//! Image attachments stored on disk per local board under
//! `<data dir>/attachments/<boardId>/<sha256-16>.<ext>`.
//!
//! Only raster formats verified by magic bytes (PNG, JPEG, WebP, GIF) are
//! accepted — SVG is deliberately excluded to prevent embedded script XSS.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{ApiError, ApiResult};
use crate::model::Board;

use super::{valid_id, Store};

pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const ATTACHMENT_PREFIX: &str = "attachment:";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub filename: String,
    pub markdown: String,
    pub mime: &'static str,
    pub size: usize,
}

/// Identifies supported raster image formats strictly from their magic bytes.
pub fn detect_image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        return Some(("png", "image/png"));
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some(("jpg", "image/jpeg"));
    }
    if bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a") {
        return Some(("gif", "image/gif"));
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(("webp", "image/webp"));
    }
    None
}

/// Validates that an attachment filename is strictly `<16 lowercase hex>.<ext>`.
pub fn valid_attachment_name(name: &str) -> bool {
    let Some((stem, ext)) = name.split_once('.') else {
        return false;
    };
    if stem.len() != 16 || !stem.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return false;
    }
    matches!(ext, "png" | "jpg" | "webp" | "gif")
}

pub fn mime_for_filename(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, ext)| ext) {
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    }
}

fn sanitize_alt(original_name: Option<&str>) -> String {
    let raw = original_name.unwrap_or("").trim();
    let basename = raw.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let cleaned: String = basename
        .chars()
        .filter(|&c| !matches!(c, '[' | ']' | '\r' | '\n' | '\0'))
        .take(80)
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "image".to_string()
    } else {
        cleaned.to_string()
    }
}

fn hash_prefix_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(16);
    for byte in &digest[..8] {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Scans text for `attachment:<16hex>.<ext>` references.
pub fn extract_attachment_refs(text: &str) -> HashSet<String> {
    let mut found = HashSet::new();
    let mut rest = text;
    while let Some(pos) = rest.find(ATTACHMENT_PREFIX) {
        rest = &rest[pos + ATTACHMENT_PREFIX.len()..];
        let candidate_len = rest
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || *b == b'.')
            .count();
        let candidate = &rest[..candidate_len];
        if valid_attachment_name(candidate) {
            found.insert(candidate.to_string());
        }
        rest = &rest[candidate_len..];
    }
    found
}

fn write_atomic_bytes(path: &PathBuf, bytes: &[u8]) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ApiError::storage)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    fs::write(&tmp, bytes).map_err(ApiError::storage)?;
    if let Err(error) = fs::rename(&tmp, path) {
        // On Windows, rename over an existing file can fail if another writer
        // raced on the identical content hash.
        if path.exists() {
            let _ = fs::remove_file(&tmp);
            return Ok(());
        }
        let _ = fs::remove_file(&tmp);
        return Err(ApiError::storage(error));
    }
    Ok(())
}

impl Store {
    pub(super) fn attachments_dir(&self, board_id: &str) -> PathBuf {
        self.dir.join("attachments").join(board_id)
    }

    pub fn save_attachment(
        &self,
        board_id: &str,
        bytes: &[u8],
        original_name: Option<&str>,
    ) -> ApiResult<AttachmentInfo> {
        if bytes.is_empty() {
            return Err(ApiError::invalid(
                "UNSUPPORTED_IMAGE_TYPE",
                "Image file is empty.",
            ));
        }
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(ApiError::invalid(
                "ATTACHMENT_TOO_LARGE",
                format!(
                    "Image is too large (max {} MB).",
                    MAX_ATTACHMENT_BYTES / (1024 * 1024)
                ),
            ));
        }
        let Some((ext, mime)) = detect_image_type(bytes) else {
            return Err(ApiError::invalid(
                "UNSUPPORTED_IMAGE_TYPE",
                "Only PNG, JPEG, WebP, and GIF images are supported.",
            ));
        };

        let filename = format!("{}.{ext}", hash_prefix_hex(bytes));
        {
            let _guard = self.writing()?;
            // Confirm the target board exists before writing files under its folder.
            self.read(board_id)?;
            let path = self.attachments_dir(board_id).join(&filename);
            if !path.exists() {
                write_atomic_bytes(&path, bytes)?;
            }
        }

        let alt = sanitize_alt(original_name);
        Ok(AttachmentInfo {
            markdown: format!("![{alt}]({ATTACHMENT_PREFIX}{filename})"),
            filename,
            mime,
            size: bytes.len(),
        })
    }

    pub fn read_attachment(&self, board_id: &str, filename: &str) -> ApiResult<(Vec<u8>, &'static str)> {
        if !valid_id(board_id) || !valid_attachment_name(filename) {
            return Err(ApiError::attachment_not_found(filename));
        }
        let _guard = self.reading()?;
        let path = self.attachments_dir(board_id).join(filename);
        if !path.is_file() {
            return Err(ApiError::attachment_not_found(filename));
        }
        let bytes = fs::read(&path).map_err(ApiError::storage)?;
        Ok((bytes, mime_for_filename(filename)))
    }

    /// Collects Base64-encoded copies of attachments referenced by a board's
    /// tasks or deleted history for single-file JSON export.
    pub(super) fn export_attachments(&self, board: &Board) -> ApiResult<HashMap<String, String>> {
        let mut refs = HashSet::new();
        for task in &board.tasks {
            refs.extend(extract_attachment_refs(&task.des));
        }
        for deleted in &board.history {
            refs.extend(extract_attachment_refs(&deleted.task.des));
        }
        let mut out = HashMap::new();
        if refs.is_empty() {
            return Ok(out);
        }
        let dir = self.attachments_dir(&board.id);
        for name in refs {
            let path = dir.join(&name);
            if !path.is_file() {
                continue;
            }
            let bytes = fs::read(&path).map_err(ApiError::storage)?;
            if bytes.len() <= MAX_ATTACHMENT_BYTES && detect_image_type(&bytes).is_some() {
                out.insert(name, BASE64.encode(bytes));
            }
        }
        Ok(out)
    }

    /// Restores Base64-encoded attachments from an imported board JSON.
    pub(super) fn import_attachments(
        &self,
        board_id: &str,
        attachments: &HashMap<String, String>,
    ) -> ApiResult<()> {
        if attachments.is_empty() {
            return Ok(());
        }
        let dir = self.attachments_dir(board_id);
        for (filename, b64) in attachments {
            if !valid_attachment_name(filename) {
                return Err(ApiError::invalid(
                    "INVALID_ATTACHMENT",
                    format!("Attachment `{filename}` has an invalid filename."),
                ));
            }
            let bytes = BASE64.decode(b64.trim()).map_err(|_| {
                ApiError::invalid(
                    "INVALID_ATTACHMENT",
                    format!("Attachment `{filename}` isn't valid base64."),
                )
            })?;
            if bytes.len() > MAX_ATTACHMENT_BYTES {
                return Err(ApiError::invalid(
                    "ATTACHMENT_TOO_LARGE",
                    format!("Attachment `{filename}` exceeds the 10 MB limit."),
                ));
            }
            let Some((detected_ext, _)) = detect_image_type(&bytes) else {
                return Err(ApiError::invalid(
                    "UNSUPPORTED_IMAGE_TYPE",
                    format!("Attachment `{filename}` isn't a supported PNG/JPEG/WebP/GIF image."),
                ));
            };
            let expected_ext = filename.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
            if detected_ext != expected_ext {
                return Err(ApiError::invalid(
                    "UNSUPPORTED_IMAGE_TYPE",
                    format!("Attachment `{filename}` content does not match its extension."),
                ));
            }
            write_atomic_bytes(&dir.join(filename), &bytes)?;
        }
        Ok(())
    }

    /// Moves a deleted board's attachment folder into `<data dir>/trash/attachments/`.
    pub(super) fn trash_attachments(&self, board_id: &str, stamp: &str) -> ApiResult<()> {
        let src = self.attachments_dir(board_id);
        if !src.is_dir() {
            return Ok(());
        }
        let dst_parent = self.dir.join("trash").join("attachments");
        fs::create_dir_all(&dst_parent).map_err(ApiError::storage)?;
        fs::rename(src, dst_parent.join(format!("{board_id}-{stamp}")))
            .map_err(ApiError::storage)?;
        Ok(())
    }
}
