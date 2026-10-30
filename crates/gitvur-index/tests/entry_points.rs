use gitvur_index::{IndexOptions, index};
use gitvur_schema::{EntryKind, NodeType, Provenance, to_canonical_json};
use std::{fs, path::Path};

#[test]
fn config_discovery_preserves_evidence_collisions_and_walker_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
    fs::write(dir.path().join("cli.ts"), "export function main() {}\n").unwrap();
    fs::write(
        dir.path().join("package.json"),
        "{\n\"bin\": {\n\"A B\": \"cli.ts\",\n\"a-b\": \"cli.ts\"\n}\n}\n",
    )
    .unwrap();
    for folder in ["ignored", "node_modules", "broken"] {
        fs::create_dir(dir.path().join(folder)).unwrap();
        fs::write(dir.path().join(folder).join("package.json"), "invalid").unwrap();
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(dir.path().join("package.json"), dir.path().join("linked")).unwrap();
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "fixed".into(),
        },
    )
    .unwrap();
    assert_eq!(out.warnings.len(), 1, "{:?}", out.warnings);
    assert!(out.warnings[0].starts_with("broken/package.json:"));
    let entries = &out.structure.entry_points;
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].id, "entry:package-bin:a-b");
    assert_eq!(entries[1].id, "entry:package-bin:a-b#2");
    assert_eq!(entries[0].evidence.as_ref().unwrap().line, 3);
    assert_eq!(entries[1].evidence.as_ref().unwrap().line, 4);
}

#[test]
fn nested_runtime_scopes_do_not_create_script_entries() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("cli.ts"), "function main() {}\nconst callback = () => main();\nclass C { field = main(); }\nexternal();\nvoid main();\n").unwrap();
    fs::write(dir.path().join("cli.py"), "def main():\n    pass\ndef nested():\n    if __name__ == '__main__':\n        main()\nif ('__main__' == __name__):\n    main()\n    callback = lambda: main()\n").unwrap();
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "fixed".into(),
        },
    )
    .unwrap();
    assert_eq!(out.structure.entry_points.len(), 2);
    for entry in &out.structure.entry_points {
        assert_eq!(entry.calls.len(), 1);
    }
}

#[test]
fn repeated_main_guards_receive_ids_in_source_order() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("cli.py"),
        "if __name__ == '__main__':\n    pass\nif __name__ == '__main__':\n    pass\n",
    )
    .unwrap();
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "fixed".into(),
        },
    )
    .unwrap();
    let entries = out.structure.entry_points;
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].id, "entry:main-guard:cli-py");
    assert_eq!(entries[0].evidence.as_ref().unwrap().line, 1);
    assert_eq!(entries[1].id, "entry:main-guard:cli-py#2");
    assert_eq!(entries[1].evidence.as_ref().unwrap().line, 3);
}

#[test]
fn new_flow_fixtures_match_the_hand_written_expectations() {
    for name in ["py-flows", "ts-flows"] {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(name);
        let output = index(
            &root,
            &IndexOptions {
                generated_at: "fixed".into(),
            },
        )
        .unwrap();
        assert!(output.warnings.is_empty(), "{:?}", output.warnings);
        let expected = fs::read_to_string(root.join("expected/structure.json")).unwrap();
        let actual = to_canonical_json(&output.structure);
        assert!(
            actual == expected,
            "{name}: {}",
            similar::TextDiff::from_lines(&expected, &actual).unified_diff()
        );
        assert_eq!(
            to_canonical_json(
                &index(
                    &root,
                    &IndexOptions {
                        generated_at: "fixed".into()
                    }
                )
                .unwrap()
                .structure
            ),
            actual
        );
        for entry in &output.structure.entry_points {
            assert_eq!(entry.provenance, Provenance::Syntactic);
            assert!(entry.evidence.is_some());
            if let Some(target) = &entry.target {
                assert!(output.structure.nodes.iter().any(|n| &n.id == target));
            }
        }
    }
}

#[test]
fn config_paths_and_script_commands_are_data_never_executed() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("pkg/src")).unwrap();
    fs::write(
        dir.path().join("pkg/src/cli.ts"),
        "export function main() {}\nmain();\n",
    )
    .unwrap();
    fs::write(
        dir.path().join("pkg/package.json"),
        r#"{
  "name": "nested",
  "bin": "./src/cli.ts",
  "exports": {".": {"import": "./src/cli.ts", "require": "../../outside.ts"}},
  "scripts": {
    "node": "node ./src/cli.ts",
    "tsnode": "ts-node ./src/cli.ts",
    "tsx": "tsx ./src/cli.ts --flag",
    "bun": "bun ./src/cli.ts",
    "deno": "deno run ./src/cli.ts",
    "unsafe": "tsx ./src/cli.ts; touch MUST_NOT_EXIST",
    "other": "echo ignored"
  }
}"#,
    )
    .unwrap();
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "fixed".into(),
        },
    )
    .unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    assert_eq!(
        out.structure
            .entry_points
            .iter()
            .filter(|e| e.kind == EntryKind::NpmScript)
            .count(),
        6
    );
    assert_eq!(
        out.structure
            .entry_points
            .iter()
            .find(|e| e.kind == EntryKind::PackageBin)
            .unwrap()
            .target
            .as_deref(),
        Some("file:pkg/src/cli.ts")
    );
    assert!(
        out.structure
            .entry_points
            .iter()
            .any(|e| e.raw.as_deref() == Some("../../outside.ts") && e.target.is_none())
    );
    assert!(!dir.path().join("MUST_NOT_EXIST").exists());
    assert!(
        out.structure
            .nodes
            .iter()
            .all(|n| n.node_type != NodeType::File
                || Path::new(&n.id).extension().is_some_and(|ext| ext == "ts"))
    );
}
