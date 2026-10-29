//! Golden and determinism tests against the hand-written fixture expectations.

use std::fs;
use std::path::{Path, PathBuf};

use gitvur_index::{IndexOptions, index, write_output};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

fn opts() -> IndexOptions {
    IndexOptions {
        generated_at: "2026-10-29T00:00:00Z".into(),
    }
}

/// Indexes `repo` into a fresh temp dir and returns the bytes of both output files.
fn run(repo: &Path) -> (String, String) {
    let out = tempfile::tempdir().unwrap();
    let output = index(repo, &opts()).unwrap();
    write_output(out.path(), &output).unwrap();
    (
        fs::read_to_string(out.path().join("structure.json")).unwrap(),
        fs::read_to_string(out.path().join("manifest.json")).unwrap(),
    )
}

fn assert_same(expected: &str, actual: &str, what: &str) {
    if expected != actual {
        let diff = similar::TextDiff::from_lines(expected, actual);
        let rendered = diff
            .unified_diff()
            .context_radius(3)
            .header("expected", "actual")
            .to_string();
        panic!("{what} differs from the expected file:\n{rendered}");
    }
}

#[test]
fn py_small_matches_expected() {
    let expected = fs::read_to_string(fixture("py-small").join("expected/structure.json")).unwrap();
    let (structure, _) = run(&fixture("py-small"));
    assert_same(&expected, &structure, "fixtures/py-small structure.json");
}

#[test]
fn ts_small_matches_expected() {
    let expected = fs::read_to_string(fixture("ts-small").join("expected/structure.json")).unwrap();
    let (structure, _) = run(&fixture("ts-small"));
    assert_same(&expected, &structure, "fixtures/ts-small structure.json");
}

#[test]
fn output_is_deterministic() {
    for name in ["py-small", "ts-small"] {
        let first = run(&fixture(name));
        let second = run(&fixture(name));
        assert!(first == second, "{name}: two runs produced different bytes");
    }
}

#[test]
fn node_modules_is_absent() {
    let output = index(&fixture("ts-small"), &opts()).unwrap();
    for node in &output.structure.nodes {
        assert!(
            !node.id.contains("node_modules"),
            "{} should be excluded",
            node.id
        );
    }
    assert!(output.warnings.is_empty(), "{:?}", output.warnings);
    assert_eq!(
        output.manifest.languages,
        [gitvur_schema::Language::Typescript]
    );
}

#[test]
fn ignored_and_skipped_files_are_absent() {
    let output = index(&fixture("py-small"), &opts()).unwrap();
    for node in &output.structure.nodes {
        for excluded in ["build/", "venv/", "scratch/", "expected/"] {
            assert!(
                !node.id.contains(excluded),
                "{} should be excluded",
                node.id
            );
        }
    }
    assert!(output.warnings.is_empty(), "{:?}", output.warnings);
}

#[test]
fn manifest_fields() {
    let output = index(&fixture("py-small"), &opts()).unwrap();
    let m = &output.manifest;
    assert_eq!(m.project_name, "py-small");
    assert_eq!(m.generated_at, "2026-10-29T00:00:00Z");
    assert_eq!(m.extractor.name, "gitvur-index");
    assert_eq!(m.languages, [gitvur_schema::Language::Python]);
    // The fixture lives inside the gitvur checkout, so HEAD (if any) is that repo's.
    assert!(
        m.commit_sha == gitvur_schema::UNCOMMITTED || m.commit_sha.len() == 7,
        "{}",
        m.commit_sha
    );
}
