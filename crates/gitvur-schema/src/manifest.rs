//! `manifest.json`: ties the documentation to a revision of the code. Written by the extractor.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    /// Always [`crate::SCHEMA_VERSION`].
    pub schema_version: String,
    pub project_name: String,
    /// Short (7-character) SHA of `HEAD`, or [`crate::UNCOMMITTED`] when the repository
    /// is not a Git checkout or has no commits.
    pub commit_sha: String,
    /// RFC 3339 UTC timestamp. The only non-deterministic field in the contract.
    pub generated_at: String,
    pub extractor: ExtractorInfo,
    pub languages: Vec<Language>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtractorInfo {
    pub name: String,
    pub version: String,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Language {
    C,
    Go,
    Python,
    Typescript,
}

impl Manifest {
    /// Sorts and deduplicates `languages`.
    pub fn canonicalize(&mut self) {
        self.languages.sort_unstable();
        self.languages.dedup();
    }
}
