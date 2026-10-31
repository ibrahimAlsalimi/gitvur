//! JSON Schema generation for the contract files.
//!
//! The generated files are committed under `schemas/` (and `agent/` for the
//! annotations schema). Regenerate with `cargo run -p gitvur-schema --bin gen-schemas`.

use schemars::{JsonSchema, schema_for};

use crate::{
    Annotations, ArchitectureArtifact, Manifest, Report, Structure, StructureDiff, Trace,
    to_canonical_json,
};

/// Every generated schema as `(path relative to the workspace root, canonical JSON)`.
pub fn generated_files() -> Vec<(&'static str, String)> {
    let annotations = render::<Annotations>();
    vec![
        ("schemas/manifest.schema.json", render::<Manifest>()),
        ("schemas/structure.schema.json", render::<Structure>()),
        ("schemas/annotations.schema.json", annotations.clone()),
        ("schemas/report.schema.json", render::<Report>()),
        ("schemas/diff.schema.json", render::<StructureDiff>()),
        ("schemas/trace.schema.json", render::<Trace>()),
        (
            "schemas/architecture.schema.json",
            render::<ArchitectureArtifact>(),
        ),
        ("agent/annotations.schema.json", annotations),
    ]
}

fn render<T: JsonSchema>() -> String {
    to_canonical_json(&schema_for!(T))
}
