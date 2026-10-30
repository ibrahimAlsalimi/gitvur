//! Loading `.gitvur/` into a [`RepoBundle`], and reading source slices. Read-only.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use gitvur_schema::{Annotations, Manifest, Report, SCHEMA_VERSION, Structure};
use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppWarning, ErrorCode, WarningCode};

/// Maximum number of lines `read_source` returns.
pub const MAX_SOURCE_LINES: u32 = 2_000;

/// Everything the viewer needs about one repository.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepoBundle {
    /// Canonical absolute path of the repository root.
    pub root: String,
    pub manifest: Manifest,
    pub structure: Structure,
    pub annotations: Option<Annotations>,
    pub report: Option<Report>,
    pub warnings: Vec<AppWarning>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum SourceLanguage {
    Python,
    Typescript,
    Text,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SourceSlice {
    pub file: String,
    /// Line number of `lines[0]`.
    pub start_line: u32,
    pub lines: Vec<String>,
    pub language: SourceLanguage,
}

/// Canonicalises `path` and checks it is a directory.
pub fn repo_root(path: &str) -> Result<PathBuf, AppError> {
    let root = Path::new(path).canonicalize().map_err(|e| {
        AppError::new(ErrorCode::NotADirectory, format!("{path} does not exist"))
            .with_detail(e.to_string())
    })?;
    if !root.is_dir() {
        return Err(AppError::new(
            ErrorCode::NotADirectory,
            format!("{path} is not a folder"),
        ));
    }
    Ok(root)
}

/// Resolves a repo-relative path. Absolute paths, `..`/`.` components, backslashes, and
/// paths whose canonical form leaves the root (including via symlinks) are `path-escape`;
/// a missing file is `io`.
pub fn resolve(root: &Path, relpath: &str) -> Result<PathBuf, AppError> {
    let escape = || {
        AppError::new(
            ErrorCode::PathEscape,
            format!("`{relpath}` is outside the repository"),
        )
    };
    let path = Path::new(relpath);
    if relpath.is_empty()
        || relpath.contains('\\')
        || !path.components().all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(escape());
    }
    let canonical = root
        .join(path)
        .canonicalize()
        .map_err(|e| AppError::io(&format!("cannot open `{relpath}`"), &e))?;
    if canonical.starts_with(root) {
        Ok(canonical)
    } else {
        Err(escape())
    }
}

/// Reads `.gitvur/<name>`: `Ok(None)` if it does not exist.
fn read_gitvur(root: &Path, name: &str) -> Result<Option<(String, SystemTime)>, AppError> {
    let relpath = format!(".gitvur/{name}");
    if fs::symlink_metadata(root.join(&relpath)).is_err() {
        return Ok(None);
    }
    let path = resolve(root, &relpath)?;
    let text = fs::read_to_string(&path)
        .map_err(|e| AppError::io(&format!("cannot read {relpath}"), &e))?;
    let modified = fs::metadata(&path)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    Ok(Some((text, modified)))
}

fn parse<T: serde::de::DeserializeOwned>(name: &str, text: &str) -> Result<T, AppError> {
    serde_json::from_str(text).map_err(|e| {
        AppError::new(
            ErrorCode::SchemaInvalid,
            format!(".gitvur/{name} doesn't match the expected format"),
        )
        .with_detail(e.to_string())
    })
}

/// Loads the four `.gitvur/` files. `manifest.json` and `structure.json` are required;
/// problems with `annotations.json` or `report.json` become warnings.
pub fn open_repository(path: &str) -> Result<RepoBundle, AppError> {
    let root = repo_root(path)?;
    let no_gitvur = || {
        AppError::new(
            ErrorCode::NoGitvur,
            "This repository hasn't been indexed yet",
        )
    };
    let gitvur = root.join(".gitvur");
    match fs::symlink_metadata(&gitvur) {
        Err(_) => return Err(no_gitvur()),
        Ok(m) if m.file_type().is_symlink() => {
            return Err(AppError::new(
                ErrorCode::PathEscape,
                ".gitvur is a symlink; refusing to read through it",
            ));
        }
        Ok(_) => {}
    }
    let (manifest_text, _) = read_gitvur(&root, "manifest.json")?.ok_or_else(no_gitvur)?;
    let (structure_text, structure_time) =
        read_gitvur(&root, "structure.json")?.ok_or_else(no_gitvur)?;
    let manifest: Manifest = parse("manifest.json", &manifest_text)?;
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(AppError::new(
            ErrorCode::SchemaInvalid,
            format!(
                "schema version {} is not supported (expected {SCHEMA_VERSION})",
                manifest.schema_version
            ),
        ));
    }
    let structure: Structure = parse("structure.json", &structure_text)?;

    let mut warnings = Vec::new();
    let warn = |warnings: &mut Vec<AppWarning>, code, message: &str| {
        warnings.push(AppWarning {
            code,
            message: message.to_owned(),
        });
    };
    let annotations = match read_gitvur(&root, "annotations.json")? {
        None => {
            warn(
                &mut warnings,
                WarningCode::AnnotationsMissing,
                "No descriptions yet: .gitvur/annotations.json is missing",
            );
            None
        }
        Some((text, _)) => match parse::<Annotations>("annotations.json", &text) {
            Ok(a) => Some(a),
            Err(e) => {
                let message = format!("{}; descriptions are not shown", e.message);
                warn(&mut warnings, WarningCode::AnnotationsInvalid, &message);
                None
            }
        },
    };
    let report = match read_gitvur(&root, "report.json")? {
        None => {
            warn(
                &mut warnings,
                WarningCode::ReportMissing,
                "Not validated yet: .gitvur/report.json is missing",
            );
            None
        }
        Some((text, report_time)) => match parse::<Report>("report.json", &text) {
            Ok(r) => {
                if report_time < structure_time {
                    warn(
                        &mut warnings,
                        WarningCode::ReportStale,
                        "The report is older than the structure; validate again",
                    );
                }
                Some(r)
            }
            Err(e) => {
                let message = format!("{}; statuses are computed in the app", e.message);
                warn(&mut warnings, WarningCode::ReportInvalid, &message);
                None
            }
        },
    };
    Ok(RepoBundle {
        root: root.to_string_lossy().into_owned(),
        manifest,
        structure,
        annotations,
        report,
        warnings,
    })
}

/// Lines `start..=end` of `file`, plus `context` lines on each side, clamped to the file
/// and capped at [`MAX_SOURCE_LINES`].
pub fn read_source(
    path: &str,
    file: &str,
    start: u32,
    end: u32,
    context: u32,
) -> Result<SourceSlice, AppError> {
    let root = repo_root(path)?;
    let full = resolve(&root, file)?;
    let bytes = fs::read(&full).map_err(|e| AppError::io(&format!("cannot read `{file}`"), &e))?;
    Ok(slice(file, &bytes, start, end, context))
}

/// Lines `start..=end` of `bytes` plus `context` on each side, clamped to the text and
/// capped at [`MAX_SOURCE_LINES`].
pub fn slice(file: &str, bytes: &[u8], start: u32, end: u32, context: u32) -> SourceSlice {
    let text = String::from_utf8_lossy(bytes)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let body = text.strip_suffix('\n').unwrap_or(&text);
    let all: Vec<&str> = body.split('\n').collect();
    let total = u32::try_from(all.len()).unwrap_or(u32::MAX);

    let (start, end) = (start.max(1), end.max(start.max(1)));
    let first = start.saturating_sub(context).max(1).min(total);
    let last = end
        .saturating_add(context)
        .min(total)
        .min(first + MAX_SOURCE_LINES - 1);
    let lines = all[(first - 1) as usize..last as usize]
        .iter()
        .map(|l| (*l).to_owned())
        .collect();
    SourceSlice {
        file: file.to_owned(),
        start_line: first,
        lines,
        language: language_of(file),
    }
}

#[allow(clippy::case_sensitive_file_extension_comparisons)] // matches the extractor's rules
fn language_of(file: &str) -> SourceLanguage {
    if file.ends_with(".py") {
        SourceLanguage::Python
    } else if [".ts", ".tsx", ".mts", ".cts"]
        .iter()
        .any(|e| file.ends_with(e))
    {
        SourceLanguage::Typescript
    } else {
        SourceLanguage::Text
    }
}
