//! Types shared by `structure.json` and `annotations.json`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A location that justifies an edge: the line where the relationship is visible.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    /// Path relative to the repository root, `/`-separated.
    pub file: String,
    /// 1-based line number.
    #[schemars(range(min = 1))]
    pub line: u32,
}

/// The lines an element occupies in a file. Lines are 1-based and inclusive.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRange {
    /// Path relative to the repository root, `/`-separated.
    pub file: String,
    #[schemars(range(min = 1))]
    pub start_line: u32,
    #[schemars(range(min = 1))]
    pub end_line: u32,
}

/// Kind of relationship. Declared in alphabetical order so the derived `Ord`
/// matches the order of the serialised strings.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    Calls,
    DependsOn,
    Imports,
    References,
}

/// Who established a relationship. Order (used only as a sort tie-breaker):
/// `syntactic`, `semantic`, `ai`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    Syntactic,
    Semantic,
    Ai,
}

/// A directed relationship between two nodes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edge {
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub edge_type: EdgeType,
    pub provenance: Provenance,
    pub evidence: Evidence,
    /// Free-text explanation; written by the agent for `ai` edges.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl Edge {
    fn sort_key(&self) -> (&str, &str, EdgeType, &str, u32, Provenance, Option<&str>) {
        (
            &self.from,
            &self.to,
            self.edge_type,
            &self.evidence.file,
            self.evidence.line,
            self.provenance,
            self.note.as_deref(),
        )
    }
}

/// Sorts edges by `(from, to, type, evidence.file, evidence.line)`, then
/// provenance and note as tie-breakers, and drops exact duplicates.
pub(crate) fn canonicalize_edges(edges: &mut Vec<Edge>) {
    edges.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
    edges.dedup();
}
