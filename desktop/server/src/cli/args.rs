//! Argument parsing and text-file/stdin decoding for `saf-kanban-cli`.

use std::io::Read;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::default_data_dir;

use super::{usage, Failure};

/// The command line, split into words and `--name value` options.
pub(super) struct Args {
    pub command: String,
    pub words: Vec<String>,
    pub options: Vec<(String, String)>,
    pub json: bool,
    pub install: bool,
    pub sheets: bool,
    pub data_dir: PathBuf,
}

/// Options that are given alone, without a value.
const FLAGS: [&str; 5] = ["json", "install", "help", "version", "sheets"];

pub(super) fn parse(raw: Vec<String>) -> Result<Args, Failure> {
    let mut words = Vec::new();
    let mut options = Vec::new();
    let mut flags = Vec::new();
    let mut raw = raw.into_iter();
    while let Some(arg) = raw.next() {
        if arg == "--" {
            words.extend(raw.by_ref());
            break;
        }
        if arg == "-h" {
            flags.push("help".to_string());
            continue;
        }
        if arg == "-V" {
            flags.push("version".to_string());
            continue;
        }
        let Some(option) = arg.strip_prefix("--") else {
            words.push(arg);
            continue;
        };
        let (name, inline) = match option.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (option.to_string(), None),
        };
        if FLAGS.contains(&name.as_str()) {
            flags.push(name);
            continue;
        }
        let value = match inline {
            Some(value) => value,
            None => raw
                .next()
                .ok_or_else(|| usage(format!("--{name} needs a value.")))?,
        };
        options.push((name, value));
    }

    if flags.iter().any(|flag| flag == "version") {
        return Err(Failure::Version);
    }
    if flags.iter().any(|flag| flag == "help") || words.first().is_some_and(|word| word == "help") {
        return Err(Failure::Help);
    }
    if words.is_empty() {
        return Err(usage(""));
    }
    let mut data_dir = default_data_dir();
    options.retain(|(name, value)| {
        if name == "data-dir" {
            data_dir = PathBuf::from(value);
            false
        } else {
            true
        }
    });
    Ok(Args {
        command: words.remove(0),
        words,
        options,
        json: flags.iter().any(|flag| flag == "json"),
        install: flags.iter().any(|flag| flag == "install"),
        sheets: flags.iter().any(|flag| flag == "sheets"),
        data_dir,
    })
}

impl Args {
    /// Checks which options were given.
    pub(super) fn expect_options(&self, options: &[&str]) -> Result<(), Failure> {
        if let Some((name, _)) = self
            .options
            .iter()
            .find(|(name, _)| !options.contains(&name.as_str()))
        {
            return Err(usage(format!("`{}` has no option --{name}.", self.command)));
        }
        Ok(())
    }

    /// Checks the number of words and which options were given.
    pub(super) fn expect(&self, words: &[&str], options: &[&str]) -> Result<(), Failure> {
        if self.words.len() != words.len() {
            let wanted: Vec<String> = words.iter().map(|word| format!("<{word}>")).collect();
            return Err(usage(format!(
                "`{}` takes {}{}.",
                self.command,
                if words.is_empty() { "nothing" } else { "" },
                wanted.join(" ")
            )));
        }
        self.expect_options(options)
    }

    pub(super) fn option(&self, name: &str) -> Option<&str> {
        self.options
            .iter()
            .rev()
            .find(|(each, _)| each == name)
            .map(|(_, value)| value.as_str())
    }

    pub(super) fn all(&self, name: &str) -> Vec<&str> {
        self.options
            .iter()
            .filter(|(each, _)| each == name)
            .map(|(_, value)| value.as_str())
            .collect()
    }
}

/// `A,B,C` as a list; spaces around the names don't count.
pub(super) fn list(text: &str) -> Value {
    json!(text
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>())
}

/// Decodes text read from standard input or a file, handling UTF-8 (with or
/// without BOM) and UTF-16 (LE/BE with BOM, or LE without BOM), which
/// PowerShell commonly produces.
fn decode_text(bytes: &[u8]) -> Result<String, String> {
    let decode_utf16 = |slice: &[u8], be: bool| -> Result<String, String> {
        let (pairs, remainder) = slice.as_chunks::<2>();
        if !remainder.is_empty() {
            return Err("UTF-16 text has an odd number of bytes.".to_string());
        }
        let units: Vec<u16> = pairs
            .iter()
            .map(|&pair| {
                if be {
                    u16::from_be_bytes(pair)
                } else {
                    u16::from_le_bytes(pair)
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|error| format!("Invalid UTF-16 text: {error}"))
    };

    let decoded = if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8(rest.to_vec()).map_err(|error| format!("Invalid UTF-8 text: {error}"))?
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        decode_utf16(rest, false)?
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        decode_utf16(rest, true)?
    } else if bytes.len() >= 2
        && bytes.len().is_multiple_of(2)
        && bytes.iter().skip(1).step_by(2).any(|b| *b == 0)
        && bytes.contains(&0)
    {
        decode_utf16(bytes, false)?
    } else {
        String::from_utf8(bytes.to_vec()).map_err(|error| format!("Invalid UTF-8 text: {error}"))?
    };

    let cleaned = decoded.strip_prefix('\u{feff}').unwrap_or(&decoded);
    Ok(cleaned
        .replace("\r\n", "\n")
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

fn read_stdin_text(label: &str) -> Result<String, Failure> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Couldn't read {label}: {error}"))?;
    decode_text(&bytes)
        .map_err(|error| Failure::Failed(format!("Couldn't decode {label}: {error}")))
}

pub(super) fn read_file_text(path: &str, label: &str) -> Result<String, Failure> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Couldn't read {label} from `{path}`: {error}"))?;
    decode_text(&bytes)
        .map_err(|error| Failure::Failed(format!("Couldn't decode {label} from `{path}`: {error}")))
}

pub(super) fn parse_limit(args: &Args) -> Result<Option<usize>, Failure> {
    args.option("limit")
        .map(|raw| {
            raw.trim()
                .parse::<usize>()
                .map_err(|_| usage("--limit must be a non-negative integer."))
        })
        .transpose()
}

/// Copies the given options into a tool's arguments, under the tool's names.
pub(super) fn copy_options(
    args: &Args,
    into: &mut Map<String, Value>,
    names: &[(&str, &str)],
) -> Result<(), Failure> {
    for (option, argument) in names {
        if let Some(value) = args.option(option) {
            let value =
                if (*option == "description" || *option == "append-description") && value == "-" {
                    read_stdin_text("the description")?
                } else {
                    value.to_string()
                };
            into.insert(argument.to_string(), json!(value));
        }
    }
    Ok(())
}
