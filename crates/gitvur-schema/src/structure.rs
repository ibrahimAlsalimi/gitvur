//! `structure.json`: nodes and static relationships. Written by the extractor.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::common::{Edge, Evidence, SourceRange, canonicalize_edges};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Structure {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    /// Calls with two or more in-repo candidate targets.
    pub unresolved_calls: Vec<UnresolvedCall>,
    /// Deterministic entry points; omitted when empty to preserve v0.2 canonical bytes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<crate::EntryPoint>>"))]
    pub entry_points: Vec<crate::EntryPoint>,
}

/// Node kinds the extractor produces. `module` nodes exist only in `annotations.json`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    Project,
    File,
    Class,
    Function,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub name: String,
    /// Absent only on the project node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub parent_id: Option<String>,
    /// Absent only on the project node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub source: Option<SourceRange>,
    /// `sha256:<64 lowercase hex>`. Absent only on the project node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    #[schemars(regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnresolvedCall {
    /// The calling function.
    pub from: String,
    /// The called name as written at the call site (the last segment for `a.b.name()`).
    pub name: String,
    pub evidence: Evidence,
    /// Every in-repo node the call could target; always two or more.
    pub candidates: Vec<String>,
}

impl Structure {
    /// Sorts nodes by `id`, edges by `(from, to, type, evidence.file, evidence.line)`,
    /// unresolved calls by `(from, evidence.line, name)`, and each candidate list.
    pub fn canonicalize(&mut self) {
        crate::execution::canonicalize_entries(&mut self.entry_points);
        self.nodes.sort_by(|a, b| a.id.cmp(&b.id));
        canonicalize_edges(&mut self.edges);
        for call in &mut self.unresolved_calls {
            call.candidates.sort();
            call.candidates.dedup();
        }
        self.unresolved_calls.sort_by(|a, b| {
            (
                &a.from,
                a.evidence.line,
                &a.name,
                &a.evidence.file,
                &a.candidates,
            )
                .cmp(&(
                    &b.from,
                    b.evidence.line,
                    &b.name,
                    &b.evidence.file,
                    &b.candidates,
                ))
        });
        self.unresolved_calls.dedup();
    }
}
