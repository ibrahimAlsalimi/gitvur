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
