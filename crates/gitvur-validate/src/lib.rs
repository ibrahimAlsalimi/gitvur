//! Validator: checks `structure.json` + `annotations.json` and classifies every element as
//! documented, stale or undocumented.
//!
//! It never trusts `annotations.json`, and [`validate_repo`] never trusts the on-disk
//! `structure.json` either: it re-indexes the repository and compares. Checks and staleness
//! rules are documented in this crate's `README.md`.

use std::path::PathBuf;

use gitvur_schema::{
    Annotations, ElementStatus, Issue, Report, SCHEMA_VERSION, Severity, Status, Structure, Summary,
};

mod checks;
pub mod codes;
mod repo;
mod staleness;

pub use repo::{
    ValidateError, gitvur_dir, load_annotations, resolve_in_repo, validate_repo,
    validate_repo_with_inputs, write_report,
};

/// Everything [`validate`] looks at. `structure` must be a fresh index of `repo_root`.
#[derive(Debug, Clone)]
pub struct ValidateInput {
    pub structure: Structure,
    /// `None` when `annotations.json` is missing or could not be read.
    pub annotations: Option<Annotations>,
    /// Canonical repository root; evidence paths are resolved against it.
    pub repo_root: PathBuf,
    /// Copied into `report.commitSha`.
    pub commit_sha: String,
}

/// Runs every check that needs only the parsed inputs, and computes staleness.
pub fn validate(input: &ValidateInput) -> Report {
    let mut issues = Vec::new();
    if let Some(annotations) = &input.annotations {
        checks::check(input, annotations, &mut issues);
    }
    let elements = staleness::elements(&input.structure, input.annotations.as_ref());
    finish(input.commit_sha.clone(), elements, issues)
}

/// IDs that need (re)documentation: every `stale` or `undocumented` element, sorted.
/// This is the input list for the agent's incremental mode.
pub fn stale_ids(report: &Report) -> Vec<String> {
    let mut ids: Vec<String> = report
        .elements
        .iter()
        .filter(|e| e.status != Status::Documented)
        .map(|e| e.id.clone())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// Builds a canonical report with a summary that matches its contents.
pub(crate) fn finish(
    commit_sha: String,
    elements: Vec<ElementStatus>,
    issues: Vec<Issue>,
) -> Report {
    let count = |f: &dyn Fn(&ElementStatus) -> bool| {
        u32::try_from(elements.iter().filter(|e| f(e)).count()).unwrap_or(u32::MAX)
    };
    let issue_count = |severity| {
        u32::try_from(issues.iter().filter(|i| i.severity == severity).count()).unwrap_or(u32::MAX)
    };
    let summary = Summary {
        documented: count(&|e| e.status == Status::Documented),
        stale: count(&|e| e.status == Status::Stale),
        undocumented: count(&|e| e.status == Status::Undocumented),
        errors: issue_count(Severity::Error),
        warnings: issue_count(Severity::Warning),
    };
    let mut report = Report {
        schema_version: SCHEMA_VERSION.into(),
        commit_sha,
        summary,
        elements,
        issues,
    };
    report.canonicalize();
    report
}

pub(crate) fn issue(severity: Severity, code: &str, id: Option<&str>, message: String) -> Issue {
    Issue {
        severity,
        code: code.into(),
        message,
        id: id.map(str::to_owned),
    }
}
