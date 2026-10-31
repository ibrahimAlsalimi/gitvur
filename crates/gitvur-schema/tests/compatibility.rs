use gitvur_schema::{Annotations, Manifest, Report, Structure, to_canonical_json};
use std::{fs, path::Path};

#[test]
fn committed_v02_files_still_load_without_execution_metadata() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    for name in ["py-small", "ts-small"] {
        let dir = root.join(name).join(".gitvur");
        let manifest: Manifest =
            serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest.schema_version, "0.2");
        let structure_text = fs::read_to_string(dir.join("structure.json")).unwrap();
        let structure: Structure = serde_json::from_str(&structure_text).unwrap();
        assert_eq!(structure.entry_points.len(), 0);
        assert_eq!(to_canonical_json(&structure), structure_text);
        let annotations: Annotations =
            serde_json::from_str(&fs::read_to_string(dir.join("annotations.json")).unwrap())
                .unwrap();
        assert_eq!(annotations.entry_points.len(), 0);
        assert_eq!(annotations.flows.len(), 0);
        let report: Report =
            serde_json::from_str(&fs::read_to_string(dir.join("report.json")).unwrap()).unwrap();
        assert_eq!(report.flows.len(), 0);
    }
}

#[test]
fn new_flow_arrays_round_trip_without_reordering_steps() {
    let mut annotations: Annotations = serde_json::from_value(serde_json::json!({
        "modules": [], "descriptions": [], "edges": [], "entryPoints": [],
        "flows": [{
            "id": "flow:example", "name": "Example", "description": "An ordered flow.",
            "entryPoint": "entry:other:example",
            "steps": [
                {"id": "z", "node": "function:a.py:start", "label": "Starts", "basedOnHash": format!("sha256:{}", "a".repeat(64))},
                {"id": "a", "node": "function:a.py:end", "label": "Ends", "basedOnHash": format!("sha256:{}", "b".repeat(64))}
            ],
            "transitions": [{"from": "z", "to": "a", "kind": "call", "provenance": "syntactic"}]
        }]
    })).unwrap();
    annotations.canonicalize();
    assert_eq!(annotations.flows[0].steps[0].id, "z");
    let encoded = to_canonical_json(&annotations);
    assert_eq!(
        serde_json::from_str::<Annotations>(&encoded).unwrap(),
        annotations
    );
    let invalid = encoded.replace(
        "\"label\": \"Starts\"",
        "\"inventedField\": true, \"label\": \"Starts\"",
    );
    assert!(serde_json::from_str::<Annotations>(&invalid).is_err());
}

#[test]
fn standalone_architecture_round_trips_rejects_unknown_fields_and_has_stable_snapshot_hash() {
    let mut a: gitvur_schema::ArchitectureArtifact = serde_json::from_str(include_str!(
        "../../../app/e2e/fixtures/architecture-artifact.json"
    ))
    .unwrap();
    a.canonicalize();
    let text = gitvur_schema::to_canonical_json(&a);
    assert_eq!(
        serde_json::from_str::<gitvur_schema::ArchitectureArtifact>(&text).unwrap(),
        a
    );
    let mut unknown: serde_json::Value = serde_json::from_str(&text).unwrap();
    unknown["coordinates"] = serde_json::json!({"x":1});
    assert!(serde_json::from_value::<gitvur_schema::ArchitectureArtifact>(unknown).is_err());
    let mut s: gitvur_schema::Structure = serde_json::from_str(include_str!(
        "../../../fixtures/py-flows/.gitvur/structure.json"
    ))
    .unwrap();
    let hash = gitvur_schema::architecture_index_hash(&s);
    s.nodes.reverse();
    s.edges.reverse();
    assert_eq!(hash, gitvur_schema::architecture_index_hash(&s));
    assert_eq!(a.index_hash, hash);
}
