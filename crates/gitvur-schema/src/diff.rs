//! Structural diff between two revisions. Written by `gitvur diff --json` and returned by
//! the app's `diff_revisions` command; never stored in `.gitvur/`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::common::{EdgeType, Evidence, Provenance};
use crate::structure::NodeType;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructureDiff {
    pub schema_version: String,
    /// Revision A (the older side), as given or resolved: a full SHA or `worktree`.
    pub from_commit: String,
    /// Revision B (the newer side).
    pub to_commit: String,
    /// Every element that is not `unchanged`, plus unchanged containers with changed
    /// children (none exist with per-element hashes, but the rule is general).
    pub elements: Vec<ElementChange>,
    /// Relationships added or removed, keyed by `(from, to, type)` after mapping moved IDs.
    pub edges: Vec<EdgeChange>,
    pub summary: DiffSummary,
}

/// Declared in alphabetical order so the derived `Ord` matches the serialised strings.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Modified,
    Moved,
    Removed,
    Unchanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElementChange {
    /// The element's ID in B; for `removed`, its ID in A.
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub change: ChangeKind,
    /// For `moved`: the element's ID in A.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub moved_from: Option<String>,
    /// Set on `modified` elements (and unchanged containers with changed children): a
    /// direct child is added, removed, modified or moved. Same rule as the validator's
    /// `childChanged` for stale elements.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub child_changed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EdgeChange {
    /// IDs in B; an endpoint that was removed keeps its ID in A.
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub edge_type: EdgeType,
    /// `added` or `removed`.
    pub change: ChangeKind,
    pub provenance: Provenance,
    /// From the side the edge exists on (B for `added`, A for `removed`).
    pub evidence: Evidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiffSummary {
    pub added: u32,
    pub removed: u32,
    pub modified: u32,
    pub moved: u32,
    pub unchanged: u32,
    pub edges_added: u32,
    pub edges_removed: u32,
}

impl StructureDiff {
    /// Sorts elements by `id` and edges by `(from, to, type, change, evidence)`.
    pub fn canonicalize(&mut self) {
        self.elements
            .sort_by(|a, b| a.id.cmp(&b.id).then(a.change.cmp(&b.change)));
        self.edges.sort_by(|a, b| {
            (&a.from, &a.to, a.edge_type, a.change, &a.evidence).cmp(&(
                &b.from,
                &b.to,
                b.edge_type,
                b.change,
                &b.evidence,
            ))
        });
    }
}
