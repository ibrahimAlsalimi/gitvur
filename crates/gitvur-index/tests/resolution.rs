//! One test per resolution rule, on small inline repositories.

use std::fs;

use gitvur_index::{IndexOptions, index};
use gitvur_schema::{EdgeType, Structure};

fn index_files(files: &[(&str, &str)]) -> (Structure, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    for (path, source) in files {
        let path = dir.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, source).unwrap();
    }
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "t".into(),
        },
    )
    .unwrap();
    (out.structure, out.warnings)
}

fn edges(s: &Structure, edge_type: EdgeType) -> Vec<(String, String, u32)> {
    s.edges
        .iter()
        .filter(|e| e.edge_type == edge_type)
        .map(|e| (e.from.clone(), e.to.clone(), e.evidence.line))
        .collect()
}

fn calls(s: &Structure) -> Vec<(String, String, u32)> {
    edges(s, EdgeType::Calls)
}

fn edge(from: &str, to: &str, line: u32) -> (String, String, u32) {
    (from.into(), to.into(), line)
}

fn node_ids(s: &Structure) -> Vec<&str> {
    s.nodes.iter().map(|n| n.id.as_str()).collect()
}

#[test]
fn import_module_and_submodule() {
    let (s, _) = index_files(&[
        ("a/__init__.py", ""),
        ("a/b.py", "def f():\n    pass\n"),
        ("a/c.py", "def g():\n    pass\n"),
        ("main.py", "import a.b\nfrom a import c\nimport json\n"),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Imports),
        [
            edge("file:main.py", "file:a/b.py", 1),
            edge("file:main.py", "file:a/c.py", 2)
        ],
        "submodule wins over a/__init__.py; external modules ignored"
    );
}

#[test]
fn from_import_of_a_name_targets_the_package() {
    let (s, _) = index_files(&[
        ("pkg/__init__.py", "def helper():\n    pass\n"),
        (
            "main.py",
            "from pkg import helper\n\ndef run():\n    helper()\n",
        ),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Imports),
        [edge("file:main.py", "file:pkg/__init__.py", 1)]
    );
    assert_eq!(
        calls(&s),
        [edge(
            "function:main.py:run",
            "function:pkg/__init__.py:helper",
            4
        )]
    );
}

#[test]
fn relative_imports() {
    let (s, _) = index_files(&[
        ("pkg/__init__.py", ""),
        ("pkg/util.py", "def u():\n    pass\n"),
        ("pkg/sub/__init__.py", ""),
        ("pkg/sub/m.py", "from ..util import u\nfrom . import n\n"),
        ("pkg/sub/n.py", ""),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Imports),
        [
            edge("file:pkg/sub/m.py", "file:pkg/sub/n.py", 2),
            edge("file:pkg/sub/m.py", "file:pkg/util.py", 1)
        ]
    );
}

#[test]
fn one_import_edge_per_file_pair_with_first_line() {
    let (s, _) = index_files(&[
        ("u.py", "def a():\n    pass\n\ndef b():\n    pass\n"),
        ("main.py", "from u import b\nimport u\nfrom u import a\n"),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Imports),
        [edge("file:main.py", "file:u.py", 1)]
    );
}

#[test]
fn bare_name_scope_chain_module_level_and_alias() {
    let (s, _) = index_files(&[
        ("lib.py", "def thing():\n    pass\n"),
        (
            "main.py",
            "from lib import thing as alias\n\ndef helper():\n    pass\n\ndef outer():\n    def inner():\n        helper()\n    inner()\n    alias()\n    print()\n",
        ),
    ]);
    assert_eq!(
        calls(&s),
        [
            edge("function:main.py:outer", "function:lib.py:thing", 10),
            edge("function:main.py:outer", "function:main.py:outer.inner", 9),
            edge("function:main.py:outer.inner", "function:main.py:helper", 8),
        ]
    );
}

#[test]
fn constructor_calls_target_the_class() {
    let (s, _) = index_files(&[(
        "m.py",
        "class Store:\n    def __init__(self):\n        pass\n\ndef make():\n    return Store()\n",
    )]);
    assert_eq!(
        calls(&s),
        [edge("function:m.py:make", "class:m.py:Store", 6)]
    );
}

#[test]
fn module_member_calls() {
    let (s, _) = index_files(&[
        ("pkg/__init__.py", ""),
        ("pkg/mod.py", "def func():\n    pass\n"),
        (
            "main.py",
            "import pkg.mod\nimport pkg.mod as pm\nimport json\n\ndef run():\n    pkg.mod.func()\n    pm.func()\n    json.dump()\n    pm.missing()\n",
        ),
    ]);
    assert_eq!(
        calls(&s),
        [edge("function:main.py:run", "function:pkg/mod.py:func", 6)]
    );
}

#[test]
fn self_and_cls_calls_use_the_enclosing_class() {
    let (s, _) = index_files(&[(
        "m.py",
        "class A:\n    def save(self):\n        pass\n\n    def run(self):\n        self.save()\n\n    @classmethod\n    def build(cls):\n        cls.save(None)\n\nclass B:\n    def save(self):\n        pass\n",
    )]);
    assert_eq!(
        calls(&s),
        [
            edge("function:m.py:A.build", "function:m.py:A.save", 10),
            edge("function:m.py:A.run", "function:m.py:A.save", 6)
        ]
    );
    assert_eq!(s.unresolved_calls, []);
}

#[test]
fn unknown_receiver_needs_two_candidates() {
    let (s, _) = index_files(&[
        (
            "a.py",
            "class A:\n    def save(self):\n        pass\n\n    def only(self):\n        pass\n",
        ),
        ("b.py", "class B:\n    def save(self):\n        pass\n"),
        (
            "main.py",
            "def run(x):\n    x.save()\n    x.only()\n    x.nothing()\n",
        ),
    ]);
    assert!(
        calls(&s).is_empty(),
        "single candidate must not become an edge: {:?}",
        calls(&s)
    );
    assert_eq!(s.unresolved_calls.len(), 1);
    let u = &s.unresolved_calls[0];
    assert_eq!(
        (u.from.as_str(), u.name.as_str(), u.evidence.line),
        ("function:main.py:run", "save", 2)
    );
    assert_eq!(
        u.candidates,
        ["function:a.py:A.save", "function:b.py:B.save"]
    );
}

#[test]
fn self_call_without_own_method_falls_back_to_name_matching() {
    let (s, _) = index_files(&[(
        "m.py",
        "class A:\n    def run(self):\n        self.save()\n\nclass B:\n    def save(self):\n        pass\n\nclass C:\n    def save(self):\n        pass\n",
    )]);
    assert_eq!(calls(&s), Vec::<(String, String, u32)>::new());
    assert_eq!(
        s.unresolved_calls.len(),
        1,
        "no inheritance resolution; ambiguous by name"
    );
}

#[test]
fn duplicate_definitions_get_suffixes() {
    let (s, _) = index_files(&[(
        "m.py",
        "def f():\n    def inner():\n        pass\n\ndef f():\n    def inner():\n        pass\n\ndef g():\n    f()\n",
    )]);
    let ids = node_ids(&s);
    for id in [
        "function:m.py:f",
        "function:m.py:f.inner",
        "function:m.py:f#2",
        "function:m.py:f#2.inner",
    ] {
        assert!(ids.contains(&id), "{id} missing from {ids:?}");
    }
    assert_eq!(
        s.unresolved_calls.len(),
        1,
        "a call to a redefined name is ambiguous"
    );
}

#[test]
fn call_edges_are_deduplicated_with_first_line() {
    let (s, _) = index_files(&[("m.py", "def a():\n    pass\n\ndef b():\n    a()\n    a()\n")]);
    assert_eq!(calls(&s), [edge("function:m.py:b", "function:m.py:a", 5)]);
}

#[test]
fn reexports_are_followed() {
    let (s, _) = index_files(&[
        ("pkg/__init__.py", "from .impl import work\n"),
        ("pkg/impl.py", "def work():\n    pass\n"),
        (
            "main.py",
            "from pkg import work\n\ndef run():\n    work()\n",
        ),
    ]);
    assert_eq!(
        calls(&s),
        [edge("function:main.py:run", "function:pkg/impl.py:work", 4)]
    );
}

#[test]
fn syntax_error_file_is_a_childless_file_node() {
    let (s, warnings) = index_files(&[
        ("bad.py", "def broken(:\n    pass\n"),
        ("ok.py", "def f():\n    pass\n"),
    ]);
    assert_eq!(
        node_ids(&s),
        [
            "file:bad.py",
            "file:ok.py",
            "function:ok.py:f",
            "project:root"
        ]
    );
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].starts_with("bad.py: syntax error"));
}

#[test]
fn crlf_and_lone_cr_line_numbers() {
    let (s, _) = index_files(&[("m.py", "x = 1\r\n\rdef f():\r\n    pass\r\n")]);
    let f = s.nodes.iter().find(|n| n.id == "function:m.py:f").unwrap();
    let src = f.source.as_ref().unwrap();
    assert_eq!((src.start_line, src.end_line), (3, 4));
}

#[test]
fn walk_honours_gitignore_and_skip_list() {
    let (s, _) = index_files(&[
        (".gitignore", "ignored/\n*.gen.py\n"),
        ("ignored/a.py", ""),
        ("x.gen.py", ""),
        ("dist/b.py", ""),
        ("target/c.py", ""),
        ("node_modules/d.py", ""),
        (".venv/e.py", ""),
        ("pkg/__pycache__/f.py", ""),
        ("readme.md", ""),
        ("keep.py", ""),
        (".hidden/kept.py", ""),
    ]);
    assert_eq!(
        node_ids(&s),
        ["file:.hidden/kept.py", "file:keep.py", "project:root"]
    );
}

#[cfg(unix)]
#[test]
fn symlinks_are_not_followed() {
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.py"), "def s():\n    pass\n").unwrap();
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.py"), "").unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.py"), dir.path().join("s.py")).unwrap();
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "t".into(),
        },
    )
    .unwrap();
    assert_eq!(node_ids(&out.structure), ["file:a.py", "project:root"]);
}

#[test]
fn not_a_git_repo_is_uncommitted() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.py"), "").unwrap();
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "t".into(),
        },
    )
    .unwrap();
    assert_eq!(out.manifest.commit_sha, gitvur_schema::UNCOMMITTED);
}
