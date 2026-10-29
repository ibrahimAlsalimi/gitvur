//! Checks the hand-written `fixtures/*/expected/structure.json` files.
//!
//! These files are the source of truth for the extractor. They are written by
//! reading the fixture source by hand; the only tool allowed is
//! [`fill_expected_hashes`], which fills `contentHash` from each node's declared
//! line range and changes nothing else.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use gitvur_schema::{
    NodeType, Structure, content_hash, extract_lines, line_count, to_canonical_json,
};

const FIXTURES: &[&str] = &["py-small", "ts-small"];

/// Files that must exist in the fixtures so the exclusion rules are exercised.
/// `build/generated.py` is hidden by the fixture's own `.gitignore`, so it must be
/// committed with `git add -f`; this test fails in CI if that was forgotten.
const EXCLUDED_FILES: &[&str] = &[
    "py-small/build/generated.py",
    "py-small/scratch/notes.py",
    "py-small/venv/lib/python3.12/site-packages/vendored.py",
    "ts-small/node_modules/left-pad/index.ts",
];

fn fixture_dir(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

fn expected_path(name: &str) -> PathBuf {
    fixture_dir(name).join("expected/structure.json")
}

fn load(name: &str) -> (String, Structure) {
    let text = fs::read_to_string(expected_path(name)).expect("read expected/structure.json");
    let structure = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{name}: expected/structure.json does not deserialise: {e}"));
    (text, structure)
}

#[test]
fn expected_structures_are_canonical() {
    for name in FIXTURES {
        let (text, structure) = load(name);
        let mut canonical = structure.clone();
        canonical.canonicalize();
        assert_eq!(structure, canonical, "{name}: not in canonical order");
        assert!(
            to_canonical_json(&canonical) == text,
            "{name}: bytes differ from canonical JSON"
        );
    }
}

#[test]
fn expected_hashes_match_fixture_sources() {
    for name in FIXTURES {
        let (_, structure) = load(name);
        for node in &structure.nodes {
            if node.node_type == NodeType::Project {
                assert!(
                    node.source.is_none() && node.content_hash.is_none(),
                    "{}",
                    node.id
                );
                continue;
            }
            let source = node
                .source
                .as_ref()
                .unwrap_or_else(|| panic!("{}: no source", node.id));
            let text = fs::read_to_string(fixture_dir(name).join(&source.file))
                .unwrap_or_else(|e| panic!("{}: cannot read {}: {e}", node.id, source.file));
            if node.node_type == NodeType::File {
                assert_eq!(node.id, format!("file:{}", source.file));
                assert_eq!(source.start_line, 1, "{}", node.id);
                assert_eq!(source.end_line, line_count(&text), "{}", node.id);
            }
            let lines = extract_lines(&text, source.start_line, source.end_line)
                .unwrap_or_else(|| panic!("{}: range out of bounds", node.id));
            assert_eq!(
                node.content_hash.as_deref(),
                Some(content_hash(&lines).as_str()),
                "{}: stale hash; run the ignored `fill_expected_hashes` test",
                node.id
            );
        }
    }
}

#[test]
fn expected_references_exist() {
    for name in FIXTURES {
        let (_, structure) = load(name);
        let ids: BTreeSet<&str> = structure.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(
            ids.len(),
            structure.nodes.len(),
            "{name}: duplicate node id"
        );
        let known = |id: &str, what: &str| assert!(ids.contains(id), "{name}: {what} {id} missing");
        for node in &structure.nodes {
            if let Some(parent) = &node.parent_id {
                known(parent, "parent");
            }
        }
        for edge in &structure.edges {
            known(&edge.from, "edge source");
            known(&edge.to, "edge target");
        }
        for call in &structure.unresolved_calls {
            known(&call.from, "unresolved caller");
            assert!(
                call.candidates.len() >= 2,
                "{name}: {} has < 2 candidates",
                call.from
            );
            for candidate in &call.candidates {
                known(candidate, "candidate");
            }
        }
    }
}

#[test]
fn excluded_fixture_files_are_present() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    for relpath in EXCLUDED_FILES {
        assert!(root.join(relpath).is_file(), "{relpath} is missing");
    }
}

#[test]
fn expected_ranges_and_evidence_are_consistent() {
    for name in FIXTURES {
        let (_, structure) = load(name);
        let by_id: std::collections::BTreeMap<&str, &gitvur_schema::Node> =
            structure.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
        for node in &structure.nodes {
            if !matches!(node.node_type, NodeType::Class | NodeType::Function) {
                continue;
            }
            let source = node.source.as_ref().expect("source");
            let relpath = node.id.split(':').nth(1).unwrap_or_default();
            assert_eq!(relpath, source.file, "{name}: {} file mismatch", node.id);
            let parent = node.parent_id.as_deref().and_then(|p| by_id.get(p));
            let parent_src = parent
                .and_then(|p| p.source.as_ref())
                .expect("parent source");
            assert!(
                parent_src.start_line <= source.start_line
                    && source.end_line <= parent_src.end_line,
                "{name}: {} lies outside its parent",
                node.id
            );
        }
        let evidence = structure
            .edges
            .iter()
            .map(|e| (&e.from, &e.evidence))
            .chain(
                structure
                    .unresolved_calls
                    .iter()
                    .map(|c| (&c.from, &c.evidence)),
            );
        for (from, ev) in evidence {
            let src = by_id[from.as_str()].source.as_ref().expect("source");
            assert!(
                ev.file == src.file && src.start_line <= ev.line && ev.line <= src.end_line,
                "{name}: evidence {}:{} lies outside {from}",
                ev.file,
                ev.line
            );
        }
    }
}

/// Fills `contentHash` for every node from its declared `source` range.
/// Run explicitly: `cargo test -p gitvur-schema --test fixtures -- --ignored`.
#[test]
#[ignore = "helper that rewrites expected files; run by hand"]
fn fill_expected_hashes() {
    for name in FIXTURES {
        let (_, mut structure) = load(name);
        for node in &mut structure.nodes {
            let Some(source) = &node.source else { continue };
            let text =
                fs::read_to_string(fixture_dir(name).join(&source.file)).expect("read source");
            let lines = extract_lines(&text, source.start_line, source.end_line)
                .unwrap_or_else(|| panic!("{}: range out of bounds", node.id));
            node.content_hash = Some(content_hash(&lines));
        }
        // Deliberately not canonicalised: ordering stays as written by hand.
        fs::write(expected_path(name), to_canonical_json(&structure)).expect("write");
    }
}
