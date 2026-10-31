//! C and Go fixtures against their hand-written expectations.

use std::fs;
use std::path::Path;

use gitvur_index::{IndexOptions, index};
use gitvur_schema::{Language, to_canonical_json};

fn check(name: &str, language: Language) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name);
    let opts = IndexOptions {
        generated_at: "fixed".into(),
    };
    let output = index(&root, &opts).unwrap();
    assert!(output.warnings.is_empty(), "{:?}", output.warnings);
    assert_eq!(output.manifest.languages, [language]);
    let expected = fs::read_to_string(root.join("expected/structure.json")).unwrap();
    let actual = to_canonical_json(&output.structure);
    assert!(
        actual == expected,
        "{name}:\n{}",
        similar::TextDiff::from_lines(&expected, &actual).unified_diff()
    );
    let again = index(&root, &opts).unwrap();
    assert_eq!(
        to_canonical_json(&again.structure),
        actual,
        "{name} is deterministic"
    );
}

#[test]
fn c_small_matches_the_hand_written_expectations() {
    check("c-small", Language::C);
}

#[test]
fn go_small_matches_the_hand_written_expectations() {
    check("go-small", Language::Go);
}
