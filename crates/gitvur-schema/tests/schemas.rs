//! Fails when the committed JSON Schema files are out of date.

use std::fs;
use std::path::Path;

#[test]
fn committed_schemas_are_up_to_date() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (relpath, expected) in gitvur_schema::schema::generated_files() {
        let actual = fs::read_to_string(root.join(relpath)).unwrap_or_default();
        assert!(
            actual == expected,
            "{relpath} is out of date; run `cargo run -p gitvur-schema --bin gen-schemas`"
        );
    }
}
