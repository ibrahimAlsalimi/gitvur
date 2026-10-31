//! Gitvur data contract v0.3: Rust types for `.gitvur/*.json` and their JSON Schema.
//!
//! The binding rules (IDs, hashing, ordering) are documented in this crate's `README.md`.
//! Every top-level type has a `canonicalize()` method that applies the ordering rules;
//! [`to_canonical_json`] then serialises the value in the canonical byte format.

mod annotations;
mod architecture;
mod common;
mod diff;
mod execution;
mod hash;
mod json;
mod manifest;
mod report;
pub mod schema;
mod structure;
mod trace;
pub mod tree;

pub use annotations::{Annotations, Description, Module};
pub use architecture::{
    Architecture, ArchitectureArtifact, ArchitectureComponent, ArchitectureRelationship,
    ArchitectureSource, architecture_index_hash,
};
pub use common::{Edge, EdgeType, Evidence, Provenance, SourceRange};
pub use diff::{ChangeKind, DiffSummary, EdgeChange, ElementChange, StructureDiff};
pub use execution::{
    EntryKind, EntryPoint, Flow, FlowState, FlowStatus, FlowStep, FlowTransition, TransitionKind,
};
pub use hash::{content_hash, extract_lines, line_count};
pub use json::to_canonical_json;
pub use manifest::{ExtractorInfo, Language, Manifest};
pub use report::{ElementStatus, Issue, Report, Severity, Status, Summary};
pub use structure::{Node, NodeType, Structure, UnresolvedCall};
pub use trace::{Trace, TraceKind, TraceNode};

/// Version of the data contract this crate describes.
pub const SCHEMA_VERSION: &str = "0.3";

/// Readers support the previous contract while new writers emit v0.3.
pub fn supports_schema_version(version: &str) -> bool {
    matches!(version, "0.2" | "0.3")
}

/// `commitSha` value when the repository is not a Git checkout or has no commits.
pub const UNCOMMITTED: &str = "uncommitted";
