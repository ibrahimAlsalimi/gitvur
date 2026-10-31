//! Agent-authored architecture: standalone artifact plus legacy annotation compatibility.
use crate::{Evidence, Provenance};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Architecture {
    pub version: u32,
    pub summary: String,
    pub components: Vec<ArchitectureComponent>,
    pub relationships: Vec<ArchitectureRelationship>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchitectureComponent {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub responsibility: String,
    pub sources: Vec<ArchitectureSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub parent: Option<String>,
    pub provenance: Provenance,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchitectureSource {
    pub node: String,
    #[schemars(regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub based_on_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchitectureRelationship {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    pub label: String,
    pub provenance: Provenance,
    pub evidence: Vec<Evidence>,
}

impl Architecture {
    pub fn canonicalize(&mut self) {
        self.components.sort_by(|a, b| a.id.cmp(&b.id));
        self.relationships.sort_by(|a, b| a.id.cmp(&b.id));
        for c in &mut self.components {
            c.sources.sort_by(|a, b| a.node.cmp(&b.node));
            c.evidence.sort();
            c.evidence.dedup();
        }
        for r in &mut self.relationships {
            r.evidence.sort();
            r.evidence.dedup();
        }
    }
}

/// Standalone agent output. The index fingerprint is supplied by `gitvur packet`.
/// Layout and validation status are deliberately not part of the authored contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchitectureArtifact {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub commit_sha: String,
    #[schemars(regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub index_hash: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub design_notes: Vec<String>,
    pub architecture: Architecture,
}

impl ArchitectureArtifact {
    pub fn canonicalize(&mut self) {
        self.architecture.canonicalize();
    }
}

/// Canonical structural snapshot identity; independent of manifest timestamps.
pub fn architecture_index_hash(structure: &crate::Structure) -> String {
    let mut structure = structure.clone();
    structure.canonicalize();
    crate::content_hash(&crate::to_canonical_json(&structure))
}
