//! `report.json`: validation results and per-element documentation status.
//! Written by the validator.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub schema_version: String,
    /// Copied from `manifest.json`.
    pub commit_sha: String,
    pub summary: Summary,
    pub elements: Vec<ElementStatus>,
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Summary {
    pub documented: u32,
    pub stale: u32,
    pub undocumented: u32,
    pub errors: u32,
    pub warnings: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElementStatus {
    pub id: String,
    pub status: Status,
    /// Set only when `status` is `stale`: a direct child of this element is stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub child_changed: Option<bool>,
    /// Set only when `status` is `stale`: the element's own text (outside its direct
    /// children) changed. See the validator README for how this is determined.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub self_changed: Option<bool>,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Documented,
    Stale,
    Undocumented,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Issue {
    pub severity: Severity,
    /// Stable kebab-case identifier, e.g. `dangling-ref`.
    pub code: String,
    pub message: String,
    /// The element the issue is about, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub id: Option<String>,
}

/// Declared so that errors sort before warnings.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

impl Report {
    /// Sorts elements by `id` and issues by `(severity, code, id, message)`.
    pub fn canonicalize(&mut self) {
        self.elements.sort_by(|a, b| {
            (&a.id, a.status, a.child_changed, a.self_changed).cmp(&(
                &b.id,
                b.status,
                b.child_changed,
                b.self_changed,
            ))
        });
        self.elements.dedup();
        self.issues.sort_by(|a, b| {
            (a.severity, &a.code, &a.id, &a.message).cmp(&(b.severity, &b.code, &b.id, &b.message))
        });
        self.issues.dedup();
    }
}
