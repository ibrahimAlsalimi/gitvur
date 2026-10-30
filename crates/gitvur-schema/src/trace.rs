//! Bounded occurrence tree, stored as an arena to avoid recursive serialization.
use crate::Evidence;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum TraceKind {
    Node,
    Ref,
    Cycle,
    Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trace {
    pub start: String,
    /// Occurrence IDs, not source node IDs.
    pub roots: Vec<String>,
    /// Breadth-first allocation order. Children refer to occurrence IDs in this array.
    pub nodes: Vec<TraceNode>,
    pub truncated: bool,
    pub hidden_roots: usize,
    /// Unknown start IDs are explicit failures, not successful empty traces.
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraceNode {
    pub id: String,
    pub kind: TraceKind,
    pub node: Option<String>,
    pub name: String,
    pub depth: u32,
    pub children: Vec<String>,
    /// First occurrence ID, for ref/cycle stubs only.
    pub reference: Option<String>,
    pub candidates: Vec<String>,
    pub evidence: Option<Evidence>,
    pub truncated: bool,
    /// Immediate outgoing occurrences omitted here, not transitive descendants.
    pub hidden_children: usize,
}
