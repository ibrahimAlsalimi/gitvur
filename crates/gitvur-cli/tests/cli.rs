//! End-to-end checks of the `gitvur` binary's exit codes and output.

use std::fs;
use std::path::Path;
use std::process::{Command, Output};

fn gitvur(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_gitvur"))
        .args(args)
        .output()
        .unwrap()
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("a.py"),
        "def f():\n    pass\n\ndef g():\n    f()\n",
    )
    .unwrap();
    dir
}

fn path(dir: &tempfile::TempDir) -> &str {
    dir.path().to_str().unwrap()
}

#[test]
fn index_then_validate_exits_zero_without_errors() {
    let dir = repo();
    assert!(gitvur(&["index", path(&dir)]).status.success());
    let out = gitvur(&["validate", path(&dir)]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("0 errors"));
    assert!(dir.path().join(".gitvur/report.json").is_file());
}

#[test]
fn validate_exits_one_on_errors() {
    let dir = repo();
    assert!(gitvur(&["index", path(&dir)]).status.success());
    fs::write(dir.path().join(".gitvur/annotations.json"), "not json").unwrap();
    let out = gitvur(&["validate", path(&dir)]);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("error[schema-invalid]"));
}

#[test]
fn validate_warnings_alone_exit_zero() {
    let dir = repo(); // no .gitvur at all: structure-out-of-date is a warning
    let out = gitvur(&["validate", path(&dir)]);
    assert_eq!(out.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&out.stderr).contains("warning[structure-out-of-date]"));
}

#[test]
fn stale_prints_sorted_ids_and_json() {
    let dir = repo();
    let out = gitvur(&["stale", path(&dir)]);
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "file:a.py\nfunction:a.py:f\nfunction:a.py:g\n"
    );
    assert!(
        !Path::new(&dir.path().join(".gitvur/report.json")).exists(),
        "stale writes nothing"
    );
    let json = gitvur(&["stale", path(&dir), "--json"]);
    let ids: Vec<String> = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(ids, ["file:a.py", "function:a.py:f", "function:a.py:g"]);
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
        ])
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
        ])
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

#[test]
fn diff_prints_a_summary_json_and_carries_annotations() {
    let dir = repo();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["add", "a.py"]);
    git(dir.path(), &["commit", "-q", "-m", "one"]);
    fs::write(
        dir.path().join("a.py"),
        "def f():\n    pass\n\ndef g():\n    f()\n\ndef h():\n    return 1\n",
    )
    .unwrap();
    git(dir.path(), &["commit", "-q", "-am", "two"]);

    let out = gitvur(&["diff", path(&dir), "HEAD~1", "HEAD"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("+1 added · −0 removed · ~1 modified · →0 moved"),
        "{text}"
    );
    assert!(text.contains("+ function:a.py:h"), "{text}");
    assert!(text.contains("~ file:a.py  (contents changed)"), "{text}");

    let json = gitvur(&["diff", path(&dir), "HEAD~1", "HEAD", "--json"]);
    let value: serde_json::Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(value["summary"]["added"], 1);
    assert_eq!(value["toCommit"].as_str().map(str::len), Some(40));

    // Rename the file; a description of `f` (hash unchanged) follows the move.
    assert!(gitvur(&["index", path(&dir)]).status.success());
    let structure: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(dir.path().join(".gitvur/structure.json")).unwrap(),
    )
    .unwrap();
    let hash = structure["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "function:a.py:f")
        .unwrap()["contentHash"]
        .clone();
    let annotations = serde_json::json!({
        "modules": [],
        "descriptions": [{ "id": "function:a.py:f", "basedOnHash": hash, "text": "Does nothing." }],
        "edges": []
    });
    fs::write(
        dir.path().join(".gitvur/annotations.json"),
        annotations.to_string(),
    )
    .unwrap();
    git(dir.path(), &["mv", "a.py", "b.py"]);
    git(dir.path(), &["commit", "-q", "-m", "three"]);
    let out = gitvur(&["diff", path(&dir), "HEAD~1", "HEAD", "--carry-annotations"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let carried = fs::read_to_string(dir.path().join(".gitvur/annotations.json")).unwrap();
    assert!(carried.contains("\"function:b.py:f\""), "{carried}");

    let bad = gitvur(&["diff", path(&dir), "no-such-rev", "HEAD"]);
    assert_eq!(bad.status.code(), Some(1));
}

fn packet(dir: &tempfile::TempDir, mode: &str) -> serde_json::Value {
    let out = gitvur(&["packet", path(dir), "--mode", mode]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

fn todo_ids(packet: &serde_json::Value) -> Vec<(String, String)> {
    packet["todo"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            (
                t["id"].as_str().unwrap().to_owned(),
                t["action"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[test]
fn packet_initial_then_incremental() {
    let dir = repo();
    assert!(gitvur(&["index", path(&dir)]).status.success());

    let initial = packet(&dir, "initial");
    assert_eq!(initial["mode"], "initial");
    assert_eq!(
        todo_ids(&initial),
        [
            ("file:a.py".to_owned(), "describe".to_owned()),
            ("function:a.py:f".to_owned(), "describe".to_owned()),
            ("function:a.py:g".to_owned(), "describe".to_owned()),
        ]
    );
    assert_eq!(initial["unassignedFiles"], serde_json::json!(["file:a.py"]));

    // Document everything from the packet, as the agent would.
    let descriptions: Vec<serde_json::Value> = initial["todo"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| serde_json::json!({"id": t["id"], "text": "Text.", "basedOnHash": t["contentHash"]}))
        .collect();
    let annotations = serde_json::json!({
        "modules": [{"id": "module:core", "name": "Core", "description": "Everything.", "files": ["file:a.py"]}],
        "descriptions": descriptions,
        "edges": []
    });
    fs::write(
        dir.path().join(".gitvur/annotations.json"),
        annotations.to_string(),
    )
    .unwrap();
    let nothing = packet(&dir, "incremental");
    assert_eq!(nothing["todo"], serde_json::json!([]));
    assert_eq!(nothing["unassignedFiles"], serde_json::json!([]));
    assert_eq!(
        nothing["existingModules"],
        serde_json::json!([{"id": "module:core", "name": "Core"}])
    );

    // Change g's body: g is re-described, its file only rehashed, f untouched.
    fs::write(
        dir.path().join("a.py"),
        "def f():\n    pass\n\ndef g():\n    f()\n    f()\n",
    )
    .unwrap();
    let changed = packet(&dir, "incremental");
    assert_eq!(
        todo_ids(&changed),
        [
            ("file:a.py".to_owned(), "rehash".to_owned()),
            ("function:a.py:g".to_owned(), "describe".to_owned())
        ]
    );
    assert_eq!(changed["todo"][1]["previousDescription"], "Text.");
    assert_eq!(changed["todo"][1]["status"], "stale");
}

#[test]
fn packet_is_deterministic_and_can_be_written_to_a_file() {
    let dir = repo();
    let out_file = dir.path().join("packet.json");
    let out = gitvur(&[
        "packet",
        path(&dir),
        "--mode",
        "initial",
        "--out",
        out_file.to_str().unwrap(),
    ]);
    assert!(out.status.success());
    let first = fs::read_to_string(&out_file).unwrap();
    let second =
        String::from_utf8(gitvur(&["packet", path(&dir), "--mode", "initial"]).stdout).unwrap();
    assert_eq!(first, second);
}

#[test]
fn agent_example_annotations_match_the_contract() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../agent/examples/annotations.example.json");
    let text = fs::read_to_string(path).unwrap();
    let annotations: gitvur_schema::Annotations = serde_json::from_str(&text).unwrap();
    assert!(
        annotations
            .edges
            .iter()
            .all(|e| e.provenance == gitvur_schema::Provenance::Ai)
    );
    assert!(annotations.descriptions.iter().all(|d| d.text.len() < 200));
}

#[cfg(unix)]
#[test]
fn never_writes_through_a_symlinked_gitvur_dir() {
    let dir = repo();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join(".gitvur")).unwrap();
    for args in [vec!["index", path(&dir)], vec!["validate", path(&dir)]] {
        let out = gitvur(&args);
        assert!(!out.status.success(), "{args:?} should refuse");
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("symlink"),
            "{args:?}"
        );
    }
    assert_eq!(
        fs::read_dir(outside.path()).unwrap().count(),
        0,
        "nothing written outside the repo"
    );
}

#[test]
fn architecture_packet_supplies_snapshot_prior_output_and_incremental_action_without_rewriting() {
    let dir = repo();
    assert!(gitvur(&["index", path(&dir)]).status.success());
    let packet = || -> serde_json::Value {
        let out = gitvur(&["packet", path(&dir), "--mode", "incremental"]);
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).unwrap()
    };
    let initial = packet();
    assert_eq!(initial["architectureAction"], "create");
    assert_eq!(initial["architectureSchemaVersion"], 1);
    let structure: gitvur_schema::Structure =
        serde_json::from_slice(&fs::read(dir.path().join(".gitvur/structure.json")).unwrap())
            .unwrap();
    let file = structure
        .nodes
        .iter()
        .find(|n| n.id == "file:a.py")
        .unwrap();
    let descriptions:Vec<_>=structure.nodes.iter().filter(|n|n.node_type!=gitvur_schema::NodeType::Project).map(|n|serde_json::json!({"id":n.id,"text":"Defines or invokes a no-op function.","basedOnHash":n.content_hash})).collect();
    fs::write(dir.path().join(".gitvur/annotations.json"),serde_json::to_vec(&serde_json::json!({"modules":[{"id":"module:example","name":"Example","description":"Demonstrates function calls.","files":["file:a.py"]}],"descriptions":descriptions,"edges":[]})).unwrap()).unwrap();
    let architecture = serde_json::json!({"schemaVersion":1,"commitSha":initial["commitSha"],"indexHash":initial["architectureIndexHash"],"architecture":{"version":1,"summary":"Two no-op functions demonstrate a local call.","components":[{"id":"arch:example","name":"Example functions","kind":"library","responsibility":"Defines a no-op function and its caller.","sources":[{"node":"file:a.py","basedOnHash":file.content_hash}],"provenance":"ai","evidence":[{"file":"a.py","line":1}]}],"relationships":[]}});
    let text = serde_json::to_string_pretty(&architecture).unwrap();
    let path_to_artifact = dir.path().join(".gitvur/architecture.json");
    fs::write(&path_to_artifact, &text).unwrap();
    let complete = packet();
    assert_eq!(complete["architectureAction"], "preserve");
    assert_eq!(complete["architecture"], architecture);
    fs::write(
        dir.path().join("added.py"),
        "def new_boundary():\n    pass\n",
    )
    .unwrap();
    let changed = packet();
    assert_eq!(changed["architectureAction"], "review");
    assert_ne!(
        changed["architectureIndexHash"],
        initial["architectureIndexHash"]
    );
    assert_eq!(fs::read_to_string(&path_to_artifact).unwrap(), text);
    fs::write(&path_to_artifact, "{broken").unwrap();
    assert_eq!(packet()["architectureAction"], "repair");
    assert_eq!(gitvur(&["validate", path(&dir)]).status.code(), Some(1));
}
