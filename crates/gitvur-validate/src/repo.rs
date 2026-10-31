//! Repository-level validation: fresh index, on-disk comparison, lenient loading, output.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use gitvur_index::{IndexError, IndexOptions, index};
use gitvur_schema::{Annotations, Issue, Report, Severity, to_canonical_json};

use crate::codes::{AI_EDGE_NO_EVIDENCE, SCHEMA_INVALID, STRUCTURE_OUT_OF_DATE};
use crate::{ValidateInput, finish, issue, validate};

#[derive(Debug, thiserror::Error)]
pub enum ValidateError {
    #[error("cannot open repository {path}: {source}")]
    Repo { path: PathBuf, source: io::Error },
    #[error(transparent)]
    Index(#[from] IndexError),
}

/// Resolves a repo-relative, `/`-separated path against the canonical `root`. Returns
/// `None` for absolute paths, `..`/`.` components, backslashes, missing files, and paths
/// that leave the root after canonicalisation (including through symlinks).
pub fn resolve_in_repo(root: &Path, relpath: &str) -> Option<PathBuf> {
    if relpath.is_empty() || relpath.contains('\\') {
        return None;
    }
    let path = Path::new(relpath);
    if !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    let canonical = root.join(path).canonicalize().ok()?;
    canonical.starts_with(root).then_some(canonical)
}

/// Reads `.gitvur/<name>`. `Ok(None)` when it does not exist; `Err` when it exists but is
/// unreadable or resolves outside the repository.
fn read_gitvur_file(root: &Path, name: &str) -> Result<Option<String>, String> {
    let relpath = format!(".gitvur/{name}");
    if fs::symlink_metadata(root.join(&relpath)).is_err() {
        return Ok(None);
    }
    let path = resolve_in_repo(root, &relpath)
        .ok_or_else(|| format!("{relpath} resolves outside the repository"))?;
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| format!("cannot read {relpath}: {e}"))
}

/// Parses `annotations.json` leniently: edges without `evidence` are reported as
/// `ai-edge-no-evidence` and removed, then the rest must deserialise exactly.
/// Any other problem is `schema-invalid` and yields `None`.
pub fn load_annotations(text: &str, issues: &mut Vec<Issue>) -> Option<Annotations> {
    let mut value: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            issues.push(issue(
                Severity::Error,
                SCHEMA_INVALID,
                None,
                format!("annotations.json is not valid JSON: {e}"),
            ));
            return None;
        }
    };
    if let Some(edges) = value
        .get_mut("edges")
        .and_then(serde_json::Value::as_array_mut)
    {
        let mut index = 0;
        edges.retain(|edge| {
            index += 1;
            // Non-objects are kept so deserialisation reports them as `schema-invalid`.
            let has_evidence =
                !edge.is_object() || edge.get("evidence").is_some_and(|e| !e.is_null());
            if !has_evidence {
                let end = |key: &str| {
                    edge.get(key)
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("?")
                        .to_owned()
                };
                let from = end("from");
                issues.push(issue(
                    Severity::Error,
                    AI_EDGE_NO_EVIDENCE,
                    (from != "?").then_some(from.as_str()),
                    format!("edge #{index} ({from} -> {}) has no evidence", end("to")),
                ));
            }
            has_evidence
        });
    }
    match serde_json::from_value(value) {
        Ok(annotations) => Some(annotations),
        Err(e) => {
            issues.push(issue(
                Severity::Error,
                SCHEMA_INVALID,
                None,
                format!("annotations.json does not match the schema: {e}"),
            ));
            None
        }
    }
}

/// Indexes `repo` afresh, compares with `.gitvur/structure.json`, loads
/// `.gitvur/annotations.json`, and validates. Reads only; see [`write_report`].
pub fn validate_repo(repo: &Path) -> Result<Report, ValidateError> {
    validate_repo_with_inputs(repo).map(|(report, _)| report)
}

/// Like [`validate_repo`], but also returns the fresh structure and parsed annotations it
/// validated, so callers need not index or parse again.
pub fn validate_repo_with_inputs(repo: &Path) -> Result<(Report, ValidateInput), ValidateError> {
    let root = repo.canonicalize().map_err(|source| ValidateError::Repo {
        path: repo.to_path_buf(),
        source,
    })?;
    let fresh = index(
        &root,
        &IndexOptions {
            generated_at: String::new(),
        },
    )?;
    let mut issues = Vec::new();

    let out_of_date =
        |message: String| issue(Severity::Warning, STRUCTURE_OUT_OF_DATE, None, message);
    match read_gitvur_file(&root, "structure.json") {
        Ok(Some(text)) if text == to_canonical_json(&fresh.structure) => {}
        Ok(Some(_)) => issues.push(out_of_date(
            ".gitvur/structure.json differs from a fresh index; run `gitvur index`".into(),
        )),
        Ok(None) => issues.push(out_of_date(
            ".gitvur/structure.json is missing; run `gitvur index`".into(),
        )),
        Err(message) => issues.push(out_of_date(message)),
    }

    let annotations = match read_gitvur_file(&root, "annotations.json") {
        Ok(Some(text)) => load_annotations(&text, &mut issues),
        Ok(None) => None,
        Err(message) => {
            issues.push(issue(Severity::Error, SCHEMA_INVALID, None, message));
            None
        }
    };

    let input = ValidateInput {
        structure: fresh.structure,
        annotations,
        repo_root: root,
        commit_sha: fresh.manifest.commit_sha,
    };
    let report = validate(&input);
    issues.extend(report.issues);
    Ok((
        finish(report.commit_sha, report.elements, issues, report.flows),
        input,
    ))
}

/// `<repo>/.gitvur` for writing. Refuses a `.gitvur` that is a symlink, so output can never
/// land outside the repository's own `.gitvur/` directory.
pub fn gitvur_dir(repo: &Path) -> io::Result<PathBuf> {
    let dir = repo.canonicalize()?.join(".gitvur");
    if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(io::Error::other(format!(
            "{} is a symlink; refusing to write through it",
            dir.display()
        )));
    }
    Ok(dir)
}

/// Writes `report.json` into `dir` (created if missing) via a temporary file and rename.
pub fn write_report(dir: &Path, report: &Report) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(".report.json.tmp");
    fs::write(&tmp, to_canonical_json(report))?;
    fs::rename(&tmp, dir.join("report.json"))
}
