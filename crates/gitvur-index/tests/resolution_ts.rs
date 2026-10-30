//! TypeScript resolution rules, on small inline repositories.

use std::fs;

use gitvur_index::{IndexOptions, index};
use gitvur_schema::{EdgeType, Structure};

fn index_files(files: &[(&str, &str)]) -> Structure {
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
    assert_eq!(out.warnings, Vec::<String>::new());
    out.structure
}

fn edges(s: &Structure, edge_type: EdgeType) -> Vec<(String, String, u32)> {
    s.edges
        .iter()
        .filter(|e| e.edge_type == edge_type)
        .map(|e| (e.from.clone(), e.to.clone(), e.evidence.line))
        .collect()
}

fn edge(from: &str, to: &str, line: u32) -> (String, String, u32) {
    (from.into(), to.into(), line)
}

#[test]
fn directory_index_imports_and_barrel_calls() {
    let s = index_files(&[
        ("auth/index.ts", "export { login } from \"./login\";\n"),
        ("auth/login.ts", "export function login() {}\n"),
        (
            "main.ts",
            "import { login } from \"./auth\";\nexport function main() {\n  login();\n}\n",
        ),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Imports),
        [
            edge("file:auth/index.ts", "file:auth/login.ts", 1),
            edge("file:main.ts", "file:auth/index.ts", 1),
        ],
        "the import edge points at the barrel"
    );
    assert_eq!(
        edges(&s, EdgeType::Calls),
        [edge(
            "function:main.ts:main",
            "function:auth/login.ts:login",
            3
        )],
        "the call edge follows the re-export"
    );
}

#[test]
fn aliased_default_and_namespace_imports() {
    let s = index_files(&[
        ("u.ts", "export function cap() {}\nexport class Box {}\n"),
        ("r.ts", "export default class Repo {}\n"),
        ("f.ts", "function helper() {}\nexport default helper;\n"),
        (
            "main.ts",
            "import { cap as c } from \"./u\";\nimport * as u from \"./u\";\nimport Repo from \"./r\";\nimport h from \"./f\";\nexport const run = () => {\n  c();\n  u.cap();\n  new u.Box();\n  new Repo();\n  h();\n};\n",
        ),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Calls),
        [
            edge("function:main.ts:run", "class:r.ts:Repo", 9),
            edge("function:main.ts:run", "class:u.ts:Box", 8),
            edge("function:main.ts:run", "function:f.ts:helper", 10),
            edge("function:main.ts:run", "function:u.ts:cap", 6),
        ]
    );
}

#[test]
fn reexport_with_alias_and_default() {
    let s = index_files(&[
        (
            "impl.ts",
            "export default class Store {}\nexport function work() {}\n",
        ),
        (
            "index.ts",
            "export { default as Store, work as doWork } from \"./impl\";\n",
        ),
        (
            "main.ts",
            "import { Store, doWork } from \".\";\nfunction go() {\n  new Store();\n  doWork();\n}\n",
        ),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Calls),
        [
            edge("function:main.ts:go", "class:impl.ts:Store", 3),
            edge("function:main.ts:go", "function:impl.ts:work", 4),
        ]
    );
}

#[test]
fn overload_target_is_the_implementation() {
    let s = index_files(&[(
        "f.ts",
        "export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: unknown) {}\nfunction g() {\n  f(1);\n}\n",
    )]);
    let ids: Vec<&str> = s.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "file:f.ts",
            "function:f.ts:f",
            "function:f.ts:g",
            "project:root"
        ]
    );
    assert_eq!(
        edges(&s, EdgeType::Calls),
        [edge("function:f.ts:g", "function:f.ts:f", 5)]
    );
}

#[test]
fn this_calls_and_unknown_receivers() {
    let s = index_files(&[
        (
            "a.ts",
            "export class A {\n  render() {}\n  run() {\n    this.render();\n  }\n  only() {}\n}\n",
        ),
        ("b.ts", "export class B {\n  render() {}\n}\n"),
        (
            "main.ts",
            "export function main(x: any) {\n  x.render();\n  x.only();\n}\n",
        ),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Calls),
        [edge("function:a.ts:A.run", "function:a.ts:A.render", 4)]
    );
    assert_eq!(
        s.unresolved_calls.len(),
        1,
        "x.render is ambiguous; x.only has one candidate and is dropped"
    );
    assert_eq!(
        s.unresolved_calls[0].candidates,
        ["function:a.ts:A.render", "function:b.ts:B.render"]
    );
}

#[test]
fn new_resolves_only_to_classes() {
    let s = index_files(&[(
        "m.ts",
        "function notAClass() {}\nexport class K {}\nexport function make() {\n  new notAClass();\n  new K();\n  new Map();\n}\n",
    )]);
    assert_eq!(
        edges(&s, EdgeType::Calls),
        [edge("function:m.ts:make", "class:m.ts:K", 5)]
    );
}

#[test]
fn accessor_pairs_get_suffixes() {
    let s = index_files(&[(
        "m.ts",
        "export class C {\n  get v() {\n    return 1;\n  }\n  set v(x: number) {}\n}\n",
    )]);
    let ids: Vec<&str> = s.nodes.iter().map(|n| n.id.as_str()).collect();
    assert!(
        ids.contains(&"function:m.ts:C.v") && ids.contains(&"function:m.ts:C.v#2"),
        "{ids:?}"
    );
}

#[test]
fn type_only_imports_and_external_packages() {
    let s = index_files(&[
        ("types.d.ts", "export interface U { id: string }\n"),
        (
            "m.ts",
            "import type { U } from \"./types\";\nimport React from \"react\";\nimport { x } from \"@/alias\";\n",
        ),
    ]);
    assert_eq!(
        edges(&s, EdgeType::Imports),
        [edge("file:m.ts", "file:types.d.ts", 1)]
    );
}

#[test]
fn js_files_and_node_modules_are_not_indexed() {
    let s = index_files(&[
        ("a.js", "export function a() {}\n"),
        ("node_modules/p/index.ts", "export function p() {}\n"),
        ("b.ts", ""),
    ]);
    let ids: Vec<&str> = s.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids, ["file:b.ts", "project:root"]);
}

#[test]
fn mixed_python_and_typescript_repo() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.py"), "def f():\n    pass\n").unwrap();
    fs::write(dir.path().join("b.ts"), "export function g() {}\n").unwrap();
    let out = index(
        dir.path(),
        &IndexOptions {
            generated_at: "t".into(),
        },
    )
    .unwrap();
    assert_eq!(
        out.manifest.languages,
        [
            gitvur_schema::Language::Python,
            gitvur_schema::Language::Typescript
        ]
    );
}
