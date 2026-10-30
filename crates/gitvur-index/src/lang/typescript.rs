//! TypeScript backend: tree-sitter-typescript (`typescript` grammar for `.ts`/`.mts`/`.cts`,
//! `tsx` grammar for `.tsx`) plus relative-specifier import resolution.

use std::collections::{BTreeSet, HashMap};

use gitvur_schema::Language;
use tree_sitter::{Node, Parser, Query, QueryCursor, StreamingIterator};

use super::{
    Binding, CallSite, Callee, DefKind, DefaultExport, Definition, Import, LanguageBackend,
    ParseError, ParsedFile, end_line_of, first_error_line, line_of,
};

const QUERY: &str = include_str!("../../queries/typescript.scm");

/// Indexed extensions. `.d.ts` (and `.d.mts`/`.d.cts`) are covered by these suffixes.
const EXTENSIONS: &[&str] = &[".ts", ".tsx", ".mts", ".cts"];
const DECLARATION_EXTENSIONS: &[&str] = &[".d.ts", ".d.mts", ".d.cts"];

/// Suffixes tried, in order, after the exact path when resolving `./x`.
const RESOLUTION_SUFFIXES: &[&str] = &[
    ".ts",
    ".tsx",
    ".d.ts",
    "/index.ts",
    "/index.tsx",
    "/index.d.ts",
];

/// Initialisers that make a module-level `const` a function node.
const FUNCTION_VALUES: &[&str] = &[
    "arrow_function",
    "function_expression",
    "function",
    "generator_function",
];

struct Grammar {
    language: tree_sitter::Language,
    query: Query,
}

impl Grammar {
    fn new(language: tree_sitter::Language) -> Self {
        let query = Query::new(&language, QUERY).expect("queries/typescript.scm is valid");
        Self { language, query }
    }
}

pub struct TypeScript {
    typescript: Grammar,
    tsx: Grammar,
}

impl TypeScript {
    /// # Panics
    ///
    /// Panics if the embedded query does not compile against either grammar, which a
    /// unit test rules out.
    pub fn new() -> Self {
        Self {
            typescript: Grammar::new(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
            tsx: Grammar::new(tree_sitter_typescript::LANGUAGE_TSX.into()),
        }
    }
}

impl Default for TypeScript {
    fn default() -> Self {
        Self::new()
    }
}

/// A definition found in the tree, before it is placed in source order.
struct Pending<'t> {
    /// The node whose descendants belong to this definition (for nesting and calls).
    anchor: Node<'t>,
    /// The node whose lines are the definition's range.
    range: Node<'t>,
    /// The node on whose line the range starts: `range`, or a leading method decorator.
    start: Node<'t>,
    kind: DefKind,
    name: String,
}

// Case-sensitive on purpose, matching how the specifiers in `import` statements are
// resolved against file names.
#[allow(clippy::case_sensitive_file_extension_comparisons)]
impl LanguageBackend for TypeScript {
    fn language(&self) -> Language {
        Language::Typescript
    }

    fn handles(&self, relpath: &str) -> bool {
        EXTENSIONS.iter().any(|ext| relpath.ends_with(ext))
    }

    fn parse(&self, relpath: &str, source: &str) -> Result<ParsedFile, ParseError> {
        let grammar = if relpath.ends_with(".tsx") {
            &self.tsx
        } else {
            &self.typescript
        };
        let mut parser = Parser::new();
        parser
            .set_language(&grammar.language)
            .map_err(|e| ParseError::Parser(e.to_string()))?;
        let tree = parser
            .parse(source, None)
            .ok_or_else(|| ParseError::Parser("no tree produced".into()))?;
        let root = tree.root_node();
        if root.has_error() {
            return Err(ParseError::Syntax {
                line: first_error_line(root),
            });
        }

        let mut captured: HashMap<&str, Vec<Node>> = HashMap::new();
        let names = grammar.query.capture_names();
        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(&grammar.query, root, source.as_bytes());
        while let Some(m) = matches.next() {
            for capture in m.captures() {
                captured
                    .entry(names[capture.index as usize])
                    .or_default()
                    .push(capture.node);
            }
        }
        for nodes in captured.values_mut() {
            nodes.sort_by_key(Node::start_byte);
            nodes.dedup_by_key(|n| n.id());
        }
        let nodes = |name: &str| captured.get(name).cloned().unwrap_or_default();
        let text = |n: Node| {
            n.utf8_text(source.as_bytes())
                .unwrap_or_default()
                .to_owned()
        };

        // A declaration file contributes its file node and imports only.
        let declaration_file = DECLARATION_EXTENSIONS.iter().any(|e| relpath.ends_with(e));
        let mut pending = Vec::new();
        if !declaration_file {
            pending.extend(
                nodes("definition")
                    .into_iter()
                    .filter_map(|n| definition(n, &text)),
            );
            for node in nodes("const") {
                pending.extend(const_functions(node, &text));
            }
        }
        pending.sort_by_key(|p| p.anchor.start_byte());
        let index_of: HashMap<usize, usize> = pending
            .iter()
            .enumerate()
            .map(|(i, p)| (p.anchor.id(), i))
            .collect();

        let mut parsed = ParsedFile::default();
        for p in &pending {
            parsed.definitions.push(Definition {
                kind: p.kind,
                name: p.name.clone(),
                parent: enclosing(p.anchor, &index_of),
                start_line: line_of(p.start),
                end_line: end_line_of(p.range),
            });
        }

        for node in nodes("call") {
            let Some(caller) = enclosing(node, &index_of) else {
                continue; // module level
            };
            if parsed.definitions[caller].kind != DefKind::Function {
                continue; // class body, e.g. a field initialiser
            }
            if let Some((callee, line)) = callee(node, &text) {
                parsed.calls.push(CallSite {
                    line,
                    caller,
                    callee,
                });
            }
        }

        for node in nodes("import") {
            parsed.imports.extend(import(node, &text));
        }
        for node in nodes("export") {
            if node.child_by_field_name("source").is_some() {
                parsed.imports.extend(reexport(node, &text));
            } else if let Some(default) = default_export(node, &index_of, &text) {
                parsed.default_export = Some(default);
            }
        }
        parsed.imports.sort_by_key(|i| i.line);
        Ok(parsed)
    }

    fn resolve_module(
        &self,
        importer: &str,
        module: &str,
        files: &BTreeSet<String>,
    ) -> Option<String> {
        let relative = module == "."
            || module == ".."
            || module.starts_with("./")
            || module.starts_with("../");
        if !relative {
            return None; // packages and path aliases are external
        }
        let mut parts: Vec<&str> = importer.split('/').collect();
        parts.pop(); // the importing file itself
        for segment in module.split('/') {
            match segment {
                "" | "." => {}
                ".." => {
                    parts.pop()?;
                }
                s => parts.push(s),
            }
        }
        let base = parts.join("/");
        std::iter::once(base.clone())
            .chain(RESOLUTION_SUFFIXES.iter().map(|suffix| {
                if base.is_empty() {
                    suffix.trim_start_matches('/').to_owned()
                } else {
                    format!("{base}{suffix}")
                }
            }))
            .find(|candidate| files.contains(candidate))
    }
}

/// A class, class method or function declaration.
fn definition<'t>(node: Node<'t>, text: &impl Fn(Node) -> String) -> Option<Pending<'t>> {
    let name = text(node.child_by_field_name("name")?);
    let (kind, range) = match node.kind() {
        "class_declaration" | "abstract_class_declaration" => (DefKind::Class, exported(node)),
        "method_definition" => {
            if node.parent()?.kind() != "class_body" {
                return None; // object literal method
            }
            (DefKind::Function, node)
        }
        "function_declaration" | "generator_function_declaration" => {
            (DefKind::Function, exported(node))
        }
        _ => return None,
    };
    Some(Pending {
        anchor: node,
        range,
        start: leading_decorator(range),
        kind,
        name,
    })
}

/// Method decorators are siblings that precede the method in the class body, not
/// children of it; the range starts at the first of them. (Class decorators are already
/// inside the class or export node.)
fn leading_decorator(node: Node) -> Node {
    let mut start = node;
    while let Some(previous) = start.prev_named_sibling() {
        if previous.kind() != "decorator" {
            break;
        }
        start = previous;
    }
    start
}

/// Module-level `const x = () => …` / `const x = function () …` declarations.
fn const_functions<'t>(node: Node<'t>, text: &impl Fn(Node) -> String) -> Vec<Pending<'t>> {
    let parent_kind = node.parent().map(|p| p.kind());
    let module_level = match parent_kind {
        Some("program") => true,
        Some("export_statement") => node
            .parent()
            .and_then(|p| p.parent())
            .is_some_and(|g| g.kind() == "program"),
        _ => false,
    };
    let is_const = node.child(0).is_some_and(|k| k.kind() == "const");
    if !module_level || !is_const {
        return Vec::new();
    }
    let range = exported(node);
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .filter(|d| d.kind() == "variable_declarator")
        .filter_map(|declarator| {
            let name = declarator.child_by_field_name("name")?;
            let value = declarator.child_by_field_name("value")?;
            if name.kind() != "identifier" || !FUNCTION_VALUES.contains(&value.kind()) {
                return None;
            }
            Some(Pending {
                anchor: value,
                range,
                start: range,
                kind: DefKind::Function,
                name: text(name),
            })
        })
        .collect()
}

/// The surrounding `export …` statement, so the range includes `export` / `export default`.
fn exported(node: Node) -> Node {
    match node.parent() {
        Some(p) if p.kind() == "export_statement" => p,
        _ => node,
    }
}

/// Index of the nearest enclosing definition.
fn enclosing(node: Node, index_of: &HashMap<usize, usize>) -> Option<usize> {
    let mut current = node.parent();
    while let Some(n) = current {
        if let Some(&i) = index_of.get(&n.id()) {
            return Some(i);
        }
        current = n.parent();
    }
    None
}

fn callee(node: Node, text: &impl Fn(Node) -> String) -> Option<(Callee, u32)> {
    if node.kind() == "new_expression" {
        let constructor = node.child_by_field_name("constructor")?;
        return match constructor.kind() {
            "identifier" => Some((
                Callee::New {
                    receiver: None,
                    name: text(constructor),
                },
                line_of(constructor),
            )),
            "member_expression" => {
                let property = constructor.child_by_field_name("property")?;
                let object = constructor.child_by_field_name("object")?;
                Some((
                    Callee::New {
                        receiver: dotted(object, text),
                        name: text(property),
                    },
                    line_of(property),
                ))
            }
            _ => None,
        };
    }
    let function = node.child_by_field_name("function")?;
    match function.kind() {
        "identifier" => Some((Callee::Name(text(function)), line_of(function))),
        "member_expression" => {
            let object = function.child_by_field_name("object")?;
            let property = function.child_by_field_name("property")?;
            let name = text(property);
            let line = line_of(property);
            if object.kind() == "this" {
                return Some((Callee::SelfMethod(name), line));
            }
            Some((
                Callee::Attribute {
                    receiver: dotted(object, text),
                    name,
                },
                line,
            ))
        }
        _ => None, // dynamic `import()`, calls on call results, subscripts
    }
}

/// `a.b.c` for a chain of identifiers; `None` for any other expression (including `this`).
fn dotted(node: Node, text: &impl Fn(Node) -> String) -> Option<String> {
    match node.kind() {
        "identifier" => Some(text(node)),
        "member_expression" => {
            let object = dotted(node.child_by_field_name("object")?, text)?;
            let property = node.child_by_field_name("property")?;
            if property.kind() != "property_identifier" {
                return None;
            }
            Some(format!("{object}.{}", text(property)))
        }
        _ => None,
    }
}

fn string_value(node: Node, text: &impl Fn(Node) -> String) -> String {
    text(node)
        .trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .to_owned()
}

/// `import d, * as ns, { a as b } from "./m"`, `import "./m"`, `import x = require("./m")`.
fn import(node: Node, text: &impl Fn(Node) -> String) -> Option<Import> {
    let line = line_of(node);
    let mut cursor = node.walk();
    let children: Vec<Node> = node.named_children(&mut cursor).collect();
    if let Some(require) = children
        .iter()
        .find(|c| c.kind() == "import_require_clause")
    {
        let local = require
            .named_child(0)
            .filter(|n| n.kind() == "identifier")?;
        let source = require.child_by_field_name("source")?;
        return Some(Import {
            line,
            module: string_value(source, text),
            bindings: vec![Binding::Module { local: text(local) }],
        });
    }
    let module = string_value(node.child_by_field_name("source")?, text);
    let mut bindings = Vec::new();
    for clause in children.iter().filter(|c| c.kind() == "import_clause") {
        let mut cursor = clause.walk();
        for part in clause.named_children(&mut cursor) {
            match part.kind() {
                "identifier" => bindings.push(Binding::Name {
                    imported: "default".into(),
                    local: text(part),
                }),
                "namespace_import" => {
                    let mut c = part.walk();
                    if let Some(local) = part
                        .named_children(&mut c)
                        .find(|n| n.kind() == "identifier")
                    {
                        bindings.push(Binding::Module { local: text(local) });
                    }
                }
                "named_imports" => bindings.extend(specifiers(part, "import_specifier", text)),
                _ => {}
            }
        }
    }
    Some(Import {
        line,
        module,
        bindings,
    })
}

/// `export { a as b } from "./m"`, `export * from "./m"`, `export * as ns from "./m"`.
fn reexport(node: Node, text: &impl Fn(Node) -> String) -> Option<Import> {
    let module = string_value(node.child_by_field_name("source")?, text);
    let mut bindings = Vec::new();
    let mut cursor = node.walk();
    for part in node.named_children(&mut cursor) {
        match part.kind() {
            "export_clause" => bindings.extend(specifiers(part, "export_specifier", text)),
            "namespace_export" => {
                let mut c = part.walk();
                if let Some(local) = part.named_children(&mut c).next() {
                    bindings.push(Binding::Module {
                        local: string_value(local, text),
                    });
                }
            }
            _ => {}
        }
    }
    Some(Import {
        line: line_of(node),
        module,
        bindings,
    })
}

/// `{ name as alias, … }` in import or export clauses.
fn specifiers(clause: Node, kind: &str, text: &impl Fn(Node) -> String) -> Vec<Binding> {
    let mut cursor = clause.walk();
    clause
        .named_children(&mut cursor)
        .filter(|s| s.kind() == kind)
        .filter_map(|s| {
            let imported = string_value(s.child_by_field_name("name")?, text);
            let local = s
                .child_by_field_name("alias")
                .map_or_else(|| imported.clone(), |a| string_value(a, text));
            Some(Binding::Name { imported, local })
        })
        .collect()
}

/// `export default class C {}`, `export default function f() {}`, `export default name;`.
fn default_export(
    node: Node,
    index_of: &HashMap<usize, usize>,
    text: &impl Fn(Node) -> String,
) -> Option<DefaultExport> {
    let mut cursor = node.walk();
    if !node.children(&mut cursor).any(|c| c.kind() == "default") {
        return None;
    }
    if let Some(declaration) = node.child_by_field_name("declaration") {
        return index_of
            .get(&declaration.id())
            .map(|&i| DefaultExport::Definition(i));
    }
    let value = node.child_by_field_name("value")?;
    (value.kind() == "identifier").then(|| DefaultExport::Name(text(value)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_as(relpath: &str, source: &str) -> ParsedFile {
        TypeScript::new().parse(relpath, source).expect("parses")
    }

    fn defs(parsed: &ParsedFile) -> Vec<(&str, Option<usize>, u32, u32)> {
        parsed
            .definitions
            .iter()
            .map(|d| (d.name.as_str(), d.parent, d.start_line, d.end_line))
            .collect()
    }

    #[test]
    fn queries_compile_for_both_grammars() {
        let _ = TypeScript::new();
    }

    #[test]
    fn handles_extensions() {
        let ts = TypeScript::new();
        for path in ["a.ts", "a.tsx", "a.mts", "a.cts", "a.d.ts"] {
            assert!(ts.handles(path), "{path}");
        }
        for path in ["a.js", "a.jsx", "a.mjs", "a.json"] {
            assert!(!ts.handles(path), "{path}");
        }
    }

    #[test]
    fn classes_methods_accessors_and_decorators() {
        let parsed = parse_as(
            "a.ts",
            "@sealed\nexport abstract class A {\n  abstract run(): void;\n  @log\n  get size(): number {\n    return 1;\n  }\n  set size(v: number) {}\n}\n",
        );
        assert_eq!(
            defs(&parsed),
            [
                ("A", None, 1, 9),
                ("size", Some(0), 4, 7),
                ("size", Some(0), 8, 8)
            ]
        );
    }

    #[test]
    fn overloads_collapse_into_the_implementation() {
        let parsed = parse_as(
            "a.ts",
            "export function f(a: string): string;\nexport function f(a: number): string;\nexport function f(a: unknown): string {\n  return String(a);\n}\n",
        );
        assert_eq!(defs(&parsed), [("f", None, 3, 5)]);
    }

    #[test]
    fn module_level_const_functions_only() {
        let parsed = parse_as(
            "a.ts",
            "export const a = () => 1;\nconst b = function () {};\nlet c = () => 2;\nconst d = 3;\nfunction outer() {\n  const inner = () => 4;\n  function nested() {}\n}\nclass K {\n  handle = () => 5;\n}\nconst o = { m() {} };\n",
        );
        assert_eq!(
            defs(&parsed),
            [
                ("a", None, 1, 1),
                ("b", None, 2, 2),
                ("outer", None, 5, 8),
                ("nested", Some(2), 7, 7),
                ("K", None, 9, 11),
            ]
        );
    }

    #[test]
    fn declaration_files_have_no_definitions_but_keep_imports() {
        let parsed = parse_as(
            "types.d.ts",
            "import type { X } from \"./x\";\nexport declare function f(): void;\nexport declare class C { m(): void; }\n",
        );
        assert_eq!(parsed.definitions, []);
        assert_eq!(parsed.imports.len(), 1);
    }

    #[test]
    fn tsx_uses_the_tsx_grammar() {
        let parsed = parse_as(
            "a.tsx",
            "export function View() {\n  return <div onClick={() => go()} />;\n}\n",
        );
        assert_eq!(defs(&parsed), [("View", None, 1, 3)]);
        assert_eq!(parsed.calls.len(), 1);
    }

    #[test]
    fn call_shapes_and_attribution() {
        let parsed = parse_as(
            "a.ts",
            "class R {\n  x = make();\n  run() {\n    this.save();\n    items.forEach((i) => use(i));\n    new ns.Thing();\n    new Plain();\n    a.b.c();\n    f()();\n    import(\"./m\");\n  }\n}\nboot();\n",
        );
        let calls: Vec<_> = parsed
            .calls
            .iter()
            .map(|c| (c.line, c.caller, c.callee.clone()))
            .collect();
        assert_eq!(
            calls,
            [
                (4, 1, Callee::SelfMethod("save".into())),
                (
                    5,
                    1,
                    Callee::Attribute {
                        receiver: Some("items".into()),
                        name: "forEach".into()
                    }
                ),
                (5, 1, Callee::Name("use".into())),
                (
                    6,
                    1,
                    Callee::New {
                        receiver: Some("ns".into()),
                        name: "Thing".into()
                    }
                ),
                (
                    7,
                    1,
                    Callee::New {
                        receiver: None,
                        name: "Plain".into()
                    }
                ),
                (
                    8,
                    1,
                    Callee::Attribute {
                        receiver: Some("a.b".into()),
                        name: "c".into()
                    }
                ),
                (9, 1, Callee::Name("f".into())),
            ],
            "field initialiser and module-level calls are dropped"
        );
    }

    #[test]
    fn import_and_export_shapes() {
        let parsed = parse_as(
            "a.ts",
            "import D, * as ns from \"./d\";\nimport { a as b, c } from './e';\nimport type { T } from \"./t\";\nimport \"./side\";\nimport x = require(\"./r\");\nexport { p as q } from \"./p\";\nexport * from \"./all\";\nexport * as all from \"./all2\";\n",
        );
        let name = |imported: &str, local: &str| Binding::Name {
            imported: imported.into(),
            local: local.into(),
        };
        let module = |local: &str| Binding::Module {
            local: local.into(),
        };
        let got: Vec<_> = parsed
            .imports
            .iter()
            .map(|i| (i.line, i.module.as_str(), i.bindings.clone()))
            .collect();
        assert_eq!(
            got,
            [
                (1, "./d", vec![name("default", "D"), module("ns")]),
                (2, "./e", vec![name("a", "b"), name("c", "c")]),
                (3, "./t", vec![name("T", "T")]),
                (4, "./side", vec![]),
                (5, "./r", vec![module("x")]),
                (6, "./p", vec![name("p", "q")]),
                (7, "./all", vec![]),
                (8, "./all2", vec![module("all")]),
            ]
        );
    }

    #[test]
    fn default_exports() {
        let class = parse_as("a.ts", "export default class Repo {}\n");
        assert_eq!(class.default_export, Some(DefaultExport::Definition(0)));
        let named = parse_as("a.ts", "function f() {}\nexport default f;\n");
        assert_eq!(named.default_export, Some(DefaultExport::Name("f".into())));
        let anonymous = parse_as("a.ts", "export default () => 1;\n");
        assert_eq!(anonymous.default_export, None);
    }

    #[test]
    fn module_resolution_order() {
        let files: BTreeSet<String> = [
            "src/a.ts",
            "src/b.tsx",
            "src/c.d.ts",
            "src/dir/index.ts",
            "src/x.ts",
            "src/x/index.ts",
            "index.ts",
            "src/exact.ts",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let ts = TypeScript::new();
        let r = |importer: &str, module: &str| ts.resolve_module(importer, module, &files);
        assert_eq!(r("src/m.ts", "./a").as_deref(), Some("src/a.ts"));
        assert_eq!(r("src/m.ts", "./b").as_deref(), Some("src/b.tsx"));
        assert_eq!(r("src/m.ts", "./c").as_deref(), Some("src/c.d.ts"));
        assert_eq!(r("src/m.ts", "./dir").as_deref(), Some("src/dir/index.ts"));
        assert_eq!(
            r("src/m.ts", "./x").as_deref(),
            Some("src/x.ts"),
            "file before index"
        );
        assert_eq!(r("src/m.ts", "./exact.ts").as_deref(), Some("src/exact.ts"));
        assert_eq!(r("src/dir/index.ts", "../a").as_deref(), Some("src/a.ts"));
        assert_eq!(r("src/m.ts", "..").as_deref(), Some("index.ts"));
        assert_eq!(r("src/m.ts", "react"), None);
        assert_eq!(r("src/m.ts", "@/a"), None, "path aliases are out of scope");
        assert_eq!(r("m.ts", "../a"), None, "above the root");
        assert_eq!(
            r("src/m.ts", "./a.js"),
            None,
            ".js specifiers are not mapped"
        );
    }
}
