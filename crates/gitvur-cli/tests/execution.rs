//! CLI integration tests for read-only execution inspection.
use gitvur_schema::{Trace, TraceKind};
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
fn run(repo: &Path, command: &str, rest: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_gitvur"))
        .arg(command)
        .arg(repo)
        .args(rest)
        .output()
        .unwrap()
}
fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("app.py"),
        "def main():\n    main()\n\nif __name__ == '__main__':\n    main()\n",
    )
    .unwrap();
    dir
}
#[test]
fn trace_text_json_limits_and_unknown_ids_do_not_write_repository() {
    let dir = repository();
    let out = run(dir.path(), "trace", &["entry:main-guard:app-py"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("⟲ function:app.py:main"));
    let out = run(dir.path(), "trace", &["function:app.py:main", "--json"]);
    let trace: Trace = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(trace.nodes[1].kind, TraceKind::Cycle);
    let out2 = run(dir.path(), "trace", &["function:app.py:main", "--json"]);
    assert_eq!(out.stdout, out2.stdout);
    let out = run(
        dir.path(),
        "trace",
        &["function:app.py:main", "--depth", "0"],
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("… (1 hidden children)"));
    let out = run(
        dir.path(),
        "trace",
        &["function:app.py:main", "--max-nodes", "0", "--json"],
    );
    let trace: Trace = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(trace.hidden_roots, 1);
    let out = run(dir.path(), "trace", &["missing", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        serde_json::from_slice::<Trace>(&out.stdout)
            .unwrap()
            .error
            .is_some()
    );
    assert!(!dir.path().join(".gitvur").exists());
}
#[test]
fn flows_lists_static_and_ai_entries_without_claiming_validation() {
    let dir = repository();
    fs::create_dir(dir.path().join(".gitvur")).unwrap();
    fs::write(dir.path().join(".gitvur/annotations.json"),r#"{
      "modules":[],"descriptions":[],"edges":[],
      "entryPoints":[{"id":"entry:job:nightly","kind":"job","name":"Nightly","target":"function:app.py:main","calls":[],"evidence":{"file":"app.py","line":1},"provenance":"ai"}],
      "flows":[{"id":"flow:nightly","name":"Nightly","description":"Runs main.","entryPoint":"entry:job:nightly","steps":[],"transitions":[]}]
    }"#).unwrap();
    let before = fs::read(dir.path().join(".gitvur/annotations.json")).unwrap();
    let out = run(dir.path(), "flows", &[]);
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("entry:main-guard:app-py"));
    assert!(text.contains("entry:job:nightly"));
    assert!(text.contains("flow:nightly  Nightly [unchecked]"));
    let out = run(dir.path(), "trace", &["entry:job:nightly", "--json"]);
    assert!(out.status.success());
    assert_eq!(
        fs::read(dir.path().join(".gitvur/annotations.json")).unwrap(),
        before
    );
    assert!(!dir.path().join(".gitvur/report.json").exists());
}

#[test]
fn text_marks_shared_nodes_and_ambiguous_receivers() {
    let dir = repository();
    fs::write(dir.path().join("app.py"), "class A:\n    def save(self):\n        pass\nclass B:\n    def save(self):\n        pass\ndef shared():\n    pass\ndef left():\n    shared()\ndef right():\n    shared()\ndef main(backend):\n    left()\n    right()\n    backend.save()\n").unwrap();
    let out = run(dir.path(), "trace", &["function:app.py:main"]);
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("↻ function:app.py:shared → trace:"));
    assert!(text.contains("? save [function:app.py:A.save, function:app.py:B.save]"));
}
#[cfg(unix)]
#[test]
fn external_annotation_symlinks_are_rejected() {
    let dir = repository();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join(".gitvur")).unwrap();
    fs::write(outside.path().join("annotations.json"), "{}").unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("annotations.json"),
        dir.path().join(".gitvur/annotations.json"),
    )
    .unwrap();
    let out = run(dir.path(), "flows", &[]);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("inside the repository"));
}
