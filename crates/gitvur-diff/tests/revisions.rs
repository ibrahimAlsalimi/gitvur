//! Revisions read through `gix` from a temporary Git repository built from
//! `fixtures/py-small`, one commit per scenario. The tests use the `git` CLI only to build
//! that throwaway repository; the code under test never runs `git`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use gitvur_diff::revision::{WORKTREE, index_revision, list_commits, resolve};
use gitvur_diff::{carry_annotations, diff};
use gitvur_schema::{
    Annotations, ChangeKind, Description, Module, StructureDiff, to_canonical_json,
};

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.invalid")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.invalid")
        .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00Z")
        .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:00Z")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

fn edit(dir: &Path, file: &str, from: &str, to: &str) {
    let path = dir.join(file);
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "{file} does not contain {from:?}");
    fs::write(&path, text.replacen(from, to, 1)).unwrap();
}

fn append(dir: &Path, file: &str, text: &str) {
    let path = dir.join(file);
    let mut all = fs::read_to_string(&path).unwrap();
    all.push_str(text);
    fs::write(&path, all).unwrap();
}

fn commit(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// Builds the scenario repository (inside `tmp/py-small`) and returns its path.
fn scenario_repo(tmp: &Path) -> PathBuf {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/py-small");
    let repo = tmp.join("py-small");
    fs::create_dir_all(repo.join("shop")).unwrap();
    for file in [".gitignore", "app.py"] {
        fs::copy(fixture.join(file), repo.join(file)).unwrap();
    }
    for entry in fs::read_dir(fixture.join("shop")).unwrap() {
        let path = entry.unwrap().path();
        fs::copy(&path, repo.join("shop").join(path.file_name().unwrap())).unwrap();
    }
    git(&repo, &["init", "-q", "-b", "main"]);
    commit(&repo, "c1 initial");

    append(
        &repo,
        "shop/utils.py",
        "\n\ndef double(value):\n    return value * 2\n",
    );
    commit(&repo, "c2 add a function");

    edit(
        &repo,
        "shop/utils.py",
        "def slugify(text):\n    return \"-\".join(text.lower().split())\n\n\n",
        "",
    );
    commit(&repo, "c3 remove a function");

    edit(
        &repo,
        "shop/models.py",
        "return self.name.upper()",
        "return self.name.title()",
    );
    commit(&repo, "c4 modify a body");

    edit(
        &repo,
        "shop/models.py",
        "def describe(self):\n        return \"Book",
        "def summary(self):\n        return \"Book",
    );
    commit(&repo, "c5 rename a function");

    let format_price = "def format_price(amount, currency=\"EUR\"):\n    def with_symbol(text):\n        symbol = SYMBOLS.get(currency, currency)\n        return symbol + \" \" + text\n\n    return with_symbol(\"%.2f\" % amount)\n";
    edit(&repo, "shop/utils.py", &format!("{format_price}\n\n"), "");
    append(&repo, "shop/models.py", &format!("\n\n{format_price}"));
    commit(&repo, "c6 move a function to another file");

    edit(
        &repo,
        "shop/store.py",
        "import json\n",
        "import json\n\nfrom shop.utils import to_amount\n",
    );
    commit(&repo, "c7 add an import");

    git(&repo, &["mv", "app.py", "main.py"]);
    commit(&repo, "c8 rename a file");
    repo
}

/// Every file under `dir` (including `.git`) with its bytes.
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut todo = vec![dir.to_path_buf()];
    while let Some(d) = todo.pop() {
        for entry in fs::read_dir(&d).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                todo.push(path);
            } else {
                out.insert(path.clone(), fs::read(&path).unwrap());
            }
        }
    }
    out
}

fn step(repo: &Path, n: u32) -> StructureDiff {
    let a = index_revision(repo, &format!("HEAD~{}", 8 - (n - 1))).unwrap();
    let b = index_revision(repo, &format!("HEAD~{}", 8 - n)).unwrap();
    diff(&a.structure, &b.structure)
}

fn kinds(d: &StructureDiff) -> Vec<String> {
    d.elements
        .iter()
        .map(|e| {
            let from = e
                .moved_from
                .as_deref()
                .map(|f| format!(" <- {f}"))
                .unwrap_or_default();
            let child = match e.child_changed {
                Some(true) => " (child)",
                _ => "",
            };
            format!("{:?} {}{from}{child}", e.change, e.id)
        })
        .collect()
}

fn edges(d: &StructureDiff) -> Vec<String> {
    d.edges
        .iter()
        .map(|e| format!("{:?} {} -> {} {:?}", e.change, e.from, e.to, e.edge_type))
        .collect()
}

#[test]
fn classifies_every_scenario_and_leaves_the_working_tree_alone() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = scenario_repo(tmp.path());
    let before = snapshot(&repo);

    // c2: add a function. Its file is modified because a child changed.
    let d = step(&repo, 2);
    assert_eq!(
        kinds(&d),
        [
            "Modified file:shop/utils.py (child)",
            "Added function:shop/utils.py:double"
        ]
    );
    assert_eq!(d.summary.added, 1);

    // c3: remove a function; the call to it disappears.
    let d = step(&repo, 3);
    assert_eq!(
        kinds(&d),
        [
            "Modified file:shop/utils.py (child)",
            "Removed function:shop/utils.py:slugify"
        ]
    );
    assert_eq!(
        edges(&d),
        [
            "Removed function:shop/orders.py:OrderService.receipt -> function:shop/utils.py:slugify Calls"
        ]
    );

    // c4: modify a body. Only the function changed itself; its class and file contain it.
    let d = step(&repo, 4);
    assert_eq!(
        kinds(&d),
        [
            "Modified class:shop/models.py:Toy (child)",
            "Modified file:shop/models.py (child)",
            "Modified function:shop/models.py:Toy.label",
        ]
    );
    assert_eq!(d.elements[2].child_changed, Some(false));

    // c5: rename a function without touching its body. The `def` line is part of the
    // element's hashed text, so the hash differs: removed + added, not moved.
    let d = step(&repo, 5);
    assert_eq!(
        kinds(&d),
        [
            "Modified class:shop/models.py:Book (child)",
            "Modified file:shop/models.py (child)",
            "Removed function:shop/models.py:Book.describe",
            "Added function:shop/models.py:Book.summary",
        ]
    );

    // c6: move a function (and its nested function) to another file, text unchanged.
    let d = step(&repo, 6);
    assert_eq!(
        kinds(&d),
        [
            "Modified file:shop/models.py (child)",
            "Modified file:shop/utils.py (child)",
            "Moved function:shop/models.py:format_price <- function:shop/utils.py:format_price",
            "Moved function:shop/models.py:format_price.with_symbol <- function:shop/utils.py:format_price.with_symbol",
        ]
    );
    assert_eq!(d.summary.moved, 2);
    assert_eq!((d.summary.added, d.summary.removed), (0, 0));

    // c7: add an import.
    let d = step(&repo, 7);
    assert_eq!(kinds(&d), ["Modified file:shop/store.py"]);
    assert_eq!(
        edges(&d),
        ["Added file:shop/store.py -> file:shop/utils.py Imports"]
    );

    // c8: rename a file. File and function move; their edges follow the move unchanged.
    let d = step(&repo, 8);
    assert_eq!(
        kinds(&d),
        [
            "Moved file:main.py <- file:app.py",
            "Moved function:main.py:main <- function:app.py:main",
        ]
    );
    assert_eq!(edges(&d), Vec::<String>::new());

    // The working tree, index and refs are byte-identical.
    assert_eq!(snapshot(&repo), before);
}

#[test]
fn deterministic_and_resolves_commits_and_the_worktree() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = scenario_repo(tmp.path());

    let a = index_revision(&repo, "HEAD~7").unwrap();
    let b = index_revision(&repo, "HEAD").unwrap();
    let once = to_canonical_json(&diff(&a.structure, &b.structure));
    let again = to_canonical_json(&diff(
        &index_revision(&repo, "HEAD~7").unwrap().structure,
        &index_revision(&repo, "HEAD").unwrap().structure,
    ));
    assert_eq!(once, again);
    assert_eq!(a.sha, resolve(&repo, "HEAD~7").unwrap());
    assert_eq!(a.sha.len(), 40);

    // The worktree is HEAD here, so nothing differs; an uncommitted edit shows up.
    let worktree = index_revision(&repo, WORKTREE).unwrap();
    assert_eq!(worktree.sha, WORKTREE);
    assert_eq!(diff(&b.structure, &worktree.structure).elements, vec![]);
    append(&repo, "main.py", "\n\ndef extra():\n    return 1\n");
    let edited = index_revision(&repo, WORKTREE).unwrap();
    assert_eq!(
        kinds(&diff(&b.structure, &edited.structure)),
        [
            "Modified file:main.py (child)",
            "Added function:main.py:extra"
        ]
    );

    let commits = list_commits(&repo, 3).unwrap();
    let subjects: Vec<&str> = commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects.len(), 3);
    assert!(subjects.contains(&"c8 rename a file"));
    assert!(
        commits
            .iter()
            .all(|c| c.short.len() == 7 && c.author == "Test")
    );

    assert!(index_revision(&repo, "no-such-branch").is_err());
}

#[test]
fn carries_annotations_only_for_moves_with_matching_hashes() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = scenario_repo(tmp.path());
    let a = index_revision(&repo, "HEAD~1").unwrap().structure;
    let b = index_revision(&repo, "HEAD").unwrap().structure;
    let d = diff(&a, &b);
    let hash = |id: &str| {
        a.nodes
            .iter()
            .find(|n| n.id == id)
            .and_then(|n| n.content_hash.clone())
            .unwrap()
    };
    let annotations = Annotations {
        modules: vec![Module {
            id: "module:entry".into(),
            name: "Entry".into(),
            description: "Entry point.".into(),
            files: vec!["file:app.py".into()],
        }],
        descriptions: vec![
            Description {
                id: "function:app.py:main".into(),
                based_on_hash: hash("function:app.py:main"),
                text: "Runs the demo.".into(),
            },
            Description {
                // Written for an older version: the hash no longer matches, so it stays.
                id: "file:app.py".into(),
                based_on_hash: "sha256:".to_owned() + &"0".repeat(64),
                text: "Old.".into(),
            },
            Description {
                id: "function:shop/orders.py:OrderService.place".into(),
                based_on_hash: hash("function:shop/orders.py:OrderService.place"),
                text: "Not moved.".into(),
            },
        ],
        edges: vec![],
    };
    let (carried, count) = carry_annotations(&annotations, &d, &b);
    assert_eq!(count, 2);
    let ids: Vec<&str> = carried.descriptions.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "file:app.py",
            "function:main.py:main",
            "function:shop/orders.py:OrderService.place"
        ]
    );
    assert_eq!(carried.modules[0].files, ["file:main.py"]);
    assert_eq!(
        d.elements
            .iter()
            .filter(|e| e.change == ChangeKind::Moved)
            .count(),
        2
    );
}

#[test]
fn reads_files_at_a_revision() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = scenario_repo(tmp.path());
    let old = gitvur_diff::revision::read_file(&repo, "HEAD~1", "app.py")
        .unwrap()
        .unwrap();
    assert!(String::from_utf8(old).unwrap().contains("def main"));
    assert_eq!(
        gitvur_diff::revision::read_file(&repo, "HEAD", "app.py").unwrap(),
        None
    );
    assert_eq!(
        gitvur_diff::revision::read_file(&repo, "HEAD", "shop").unwrap(),
        None
    );
}
