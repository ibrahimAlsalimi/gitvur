//! `annotations.json`: logical modules, descriptions and hidden relationships.
//! Written by the documenting agent.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::common::{Edge, canonicalize_edges};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Annotations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub architecture: Option<crate::Architecture>,
    pub modules: Vec<Module>,
    pub descriptions: Vec<Description>,
    /// Hidden relationships; every one must have `provenance: "ai"` and evidence.
    pub edges: Vec<Edge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<crate::EntryPoint>>"))]
    pub entry_points: Vec<crate::EntryPoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<crate::Flow>>"))]
    pub flows: Vec<crate::Flow>,
}

/// A logical grouping of files, chosen by the agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Module {
    /// `module:<slug>`, slug matching `[a-z0-9-]+`.
    #[schemars(regex(pattern = r"^module:[a-z0-9-]+$"))]
    pub id: String,
    pub name: String,
    pub description: String,
    /// File node IDs (`file:<relpath>`).
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Description {
    /// ID of the described node.
    pub id: String,
    pub text: String,
    /// The node's `contentHash` when the description was written.
    #[schemars(regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub based_on_hash: String,
}

impl Annotations {
    /// Sorts modules (and each module's files) and descriptions by `id`, and edges
    /// by `(from, to, type, evidence.file, evidence.line)`.
    pub fn canonicalize(&mut self) {
        if let Some(a) = &mut self.architecture {
            a.canonicalize();
        }
        crate::execution::canonicalize_entries(&mut self.entry_points);
        for flow in &mut self.flows {
            flow.transitions.sort();
            flow.transitions.dedup();
        }
        self.flows.sort_by(|a, b| {
            (&a.id, &a.name, &a.description, &a.entry_point).cmp(&(
                &b.id,
                &b.name,
                &b.description,
                &b.entry_point,
            ))
        });
        for module in &mut self.modules {
            module.files.sort();
            module.files.dedup();
        }
        self.modules.sort_by(|a, b| a.id.cmp(&b.id));
        self.descriptions.sort_by(|a, b| {
            (&a.id, &a.based_on_hash, &a.text).cmp(&(&b.id, &b.based_on_hash, &b.text))
        });
        self.descriptions.dedup();
        canonicalize_edges(&mut self.edges);
    }
}
