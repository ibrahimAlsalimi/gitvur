//! Standalone architecture is optional, independently validated, and never inferred on load.
use gitvur_schema::{ArchitectureArtifact, architecture_index_hash, to_canonical_json};
use gitvur_validate::{ValidateInput, architecture::for_repository, validate_repo};
use std::{fs, path::Path};

fn copy(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        if e.file_type().unwrap().is_dir() {
            copy(&e.path(), &to.join(e.file_name()));
        } else {
            fs::copy(e.path(), to.join(e.file_name())).unwrap();
        }
    }
}
fn setup() -> (tempfile::TempDir, ValidateInput, ArchitectureArtifact) {
    let dir = tempfile::tempdir().unwrap();
    copy(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/py-flows"),
        dir.path(),
    );
    let structure = gitvur_index::index(
        dir.path(),
        &gitvur_index::IndexOptions {
            generated_at: String::new(),
        },
    )
    .unwrap()
    .structure;
    let mut a: ArchitectureArtifact = serde_json::from_str(include_str!(
        "../../../app/e2e/fixtures/architecture-artifact.json"
    ))
    .unwrap();
    a.index_hash = architecture_index_hash(&structure);
    let input = ValidateInput {
        structure,
        annotations: None,
        repo_root: dir.path().canonicalize().unwrap(),
        commit_sha: "uncommitted".into(),
    };
    (dir, input, a)
}
fn save(input: &ValidateInput, a: &ArchitectureArtifact) {
    fs::write(
        input.repo_root.join(".gitvur/architecture.json"),
        to_canonical_json(a),
    )
    .unwrap();
}
#[test]
fn artifact_is_optional_and_semantics_are_not_proved_by_citations() {
    let (_dir, input, a) = setup();
    assert_eq!(for_repository(&input), (None, vec![]));
    save(&input, &a);
    let (loaded, issues) = for_repository(&input);
    assert_eq!(loaded, Some(a));
    assert!(
        issues.iter().all(|i| i.code == "architecture-unresolved"),
        "{issues:#?}"
    );
    assert!(
        issues
            .iter()
            .any(|i| i.id.as_deref() == Some("arch:notifies"))
    );
    assert_eq!(issues, for_repository(&input).1);
    let report = validate_repo(&input.repo_root).unwrap();
    assert!(
        report
            .issues
            .iter()
            .any(|i| i.code == "architecture-unresolved")
    );
}
#[test]
fn detects_disk_edits_without_reindex_and_dangling_references() {
    let (_dir, input, mut a) = setup();
    save(&input, &a);
    fs::write(
        input.repo_root.join("flowapp/service/orders.py"),
        "# removed\n",
    )
    .unwrap();
    assert!(
        for_repository(&input)
            .1
            .iter()
            .any(|i| i.code == "architecture-stale")
    );
    a.architecture.relationships[0].to = "arch:missing".into();
    a.architecture.components[0].sources[0].node = "file:deleted.py".into();
    save(&input, &a);
    let issues = for_repository(&input).1;
    assert!(issues.iter().any(|i| i.code == "architecture-dangling"));
    assert!(issues.iter().any(|i| i.code == "architecture-source"));
}
#[test]
fn malformed_versions_evidence_cycles_and_snapshot_are_reported() {
    let (_dir, input, mut a) = setup();
    fs::write(input.repo_root.join(".gitvur/architecture.json"), "{").unwrap();
    assert_eq!(for_repository(&input).1[0].code, "architecture-schema");
    a.schema_version = 9;
    a.index_hash = format!("sha256:{}", "0".repeat(64));
    a.architecture.components[0].parent = Some(a.architecture.components[0].id.clone());
    a.architecture.components[0].evidence[0].file = "../outside.py".into();
    save(&input, &a);
    let issues = for_repository(&input).1;
    for code in [
        "architecture-schema",
        "architecture-snapshot",
        "architecture-hierarchy",
        "architecture-evidence",
    ] {
        assert!(issues.iter().any(|i| i.code == code), "{code}");
    }
}
#[test]
fn subsystem_groups_can_reference_descendant_evidence_without_fake_source_nodes() {
    let (_dir, input, mut a) = setup();
    let mut group = a.architecture.components[0].clone();
    group.id = "arch:application".into();
    group.name = "Application".into();
    group.sources.clear();
    a.architecture.components[0].parent = Some(group.id.clone());
    a.architecture.components.push(group);
    save(&input, &a);
    assert!(
        for_repository(&input)
            .1
            .iter()
            .all(|i| i.severity != gitvur_schema::Severity::Error)
    );
}
#[cfg(unix)]
#[test]
fn outside_symlink_artifact_and_evidence_are_rejected() {
    let (_dir, input, mut a) = setup();
    let outside = tempfile::tempdir().unwrap();
    let path = outside.path().join("architecture.json");
    fs::write(&path, to_canonical_json(&a)).unwrap();
    std::os::unix::fs::symlink(&path, input.repo_root.join(".gitvur/architecture.json")).unwrap();
    assert_eq!(for_repository(&input).1[0].code, "architecture-schema");
    fs::remove_file(input.repo_root.join(".gitvur/architecture.json")).unwrap();
    a.architecture.components[0].evidence[0].file = "../architecture.json".into();
    save(&input, &a);
    assert!(
        for_repository(&input)
            .1
            .iter()
            .any(|i| i.code == "architecture-evidence")
    );
}

#[test]
fn an_empty_architecture_can_explain_a_repository_without_inventing_components() {
    let (_dir, input, mut a) = setup();
    a.architecture.components.clear();
    a.architecture.relationships.clear();
    a.architecture.summary = "No meaningful architectural components were identified.".into();
    save(&input, &a);
    assert_eq!(for_repository(&input).1, []);
}
