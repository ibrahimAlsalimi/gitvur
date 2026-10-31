//! Python backend: tree-sitter-python plus the Python import resolution rules.

use std::collections::{BTreeSet, HashMap};

use gitvur_schema::Language;
use tree_sitter::{Node, Parser, Query, QueryCursor, StreamingIterator};

use super::{
    Binding, CallSite, Callee, DefKind, Definition, Import, LanguageBackend, ParseError,
    ParsedFile, end_line_of, first_error_line, line_of,
};

const QUERY: &str = include_str!("../../queries/python.scm");

/// Receivers that make `x.m()` a call on the enclosing class.
const SELF_NAMES: &[&str] = &["self", "cls"];

pub struct Python {
    language: tree_sitter::Language,
    query: Query,
}

impl Python {
    /// # Panics
    ///
    /// Panics if the embedded query does not compile against the grammar, which a unit
    /// test rules out.
    pub fn new() -> Self {
        let language = tree_sitter::Language::from(tree_sitter_python::LANGUAGE);
        let query = Query::new(&language, QUERY).expect("queries/python.scm is valid");
        Self { language, query }
    }
}

impl Default for Python {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageBackend for Python {
    fn language(&self) -> Language {
        Language::Python
    }

    // Case-sensitive on purpose: `import a` only ever resolves to `a.py`, so `A.PY`
    // could never be the target of an import or carry the module's definitions.
    #[allow(clippy::case_sensitive_file_extension_comparisons)]
    fn handles(&self, relpath: &str) -> bool {
        relpath.ends_with(".py")
    }

    fn parse(&self, relpath: &str, source: &str) -> Result<ParsedFile, ParseError> {
        let mut parser = Parser::new();
        parser
            .set_language(&self.language)
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

        let mut def_nodes = Vec::new();
        let mut call_nodes = Vec::new();
        let mut import_nodes = Vec::new();
        let names = self.query.capture_names();
        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(&self.query, root, source.as_bytes());
        while let Some(m) = matches.next() {
            for capture in m.captures() {
                match names[capture.index as usize] {
                    "definition" => def_nodes.push(capture.node),
                    "call" => call_nodes.push(capture.node),
                    "import" => import_nodes.push(capture.node),
                    _ => {}
                }
            }
        }
        def_nodes.sort_by_key(Node::start_byte);
        def_nodes.dedup_by_key(|n| n.id());
        // Drop nameless nodes before indexing, so `index_of` matches `parsed.definitions`.
        def_nodes.retain(|n| n.child_by_field_name("name").is_some());
        call_nodes.sort_by_key(Node::start_byte);
        import_nodes.sort_by_key(Node::start_byte);

        let text = |n: Node| {
            n.utf8_text(source.as_bytes())
                .unwrap_or_default()
                .to_owned()
        };
        let index_of: HashMap<usize, usize> = def_nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id(), i))
            .collect();

        let mut parsed = ParsedFile::default();
        for node in &def_nodes {
            let Some(name) = node.child_by_field_name("name") else {
                continue; // removed above
            };
            let kind = if node.kind() == "class_definition" {
                DefKind::Class
            } else {
                DefKind::Function
            };
            let start = match node.parent() {
                Some(p) if p.kind() == "decorated_definition" => p,
                _ => *node,
            };
            parsed.definitions.push(Definition {
                kind,
                name: text(name),
                parent: enclosing_definition(*node).and_then(|p| index_of.get(&p.id()).copied()),
                start_line: line_of(start),
                end_line: end_line_of(*node),
                receiver: None,
                internal: false,
            });
        }

        collect_entries(&mut parsed, root, &call_nodes, source, relpath);

        for node in call_nodes {
            let Some(enclosing) = enclosing_definition(node) else {
                continue;
            };
            if enclosing.kind() != "function_definition" {
                continue; // class body
            }
            let Some(&caller) = index_of.get(&enclosing.id()) else {
                continue;
            };
            let Some(function) = node.child_by_field_name("function") else {
                continue;
            };
            if let Some((callee, line)) = callee(function, &text) {
                parsed.calls.push(CallSite {
                    line,
                    caller,
                    callee,
                });
            }
        }

        for node in import_nodes {
            parsed.imports.extend(imports(node, &text));
        }
        Ok(parsed)
    }

    fn resolve_module(
        &self,
        importer: &str,
        module: &str,
        files: &BTreeSet<String>,
    ) -> Option<String> {
        let level = module.chars().take_while(|&c| c == '.').count();
        let rest = &module[level..];
        let mut parts: Vec<&str> = Vec::new();
        if level > 0 {
            parts = importer.split('/').collect();
            parts.pop(); // the importing file itself
            for _ in 1..level {
                parts.pop()?;
            }
        }
        if !rest.is_empty() {
            parts.extend(rest.split('.'));
        }
        let base = parts.join("/");
        let package_init = if base.is_empty() {
            "__init__.py".to_owned()
        } else {
            format!("{base}/__init__.py")
        };
        let candidates = if rest.is_empty() {
            vec![package_init]
        } else {
            vec![format!("{base}.py"), package_init]
        };
        candidates.into_iter().find(|c| files.contains(c))
    }

    fn submodule(&self, module: &str, name: &str) -> Option<String> {
        if module.chars().all(|c| c == '.') {
            Some(format!("{module}{name}"))
        } else {
            Some(format!("{module}.{name}"))
        }
    }
}

fn is_main_guard(node: Node<'_>, text: &impl Fn(Node<'_>) -> String) -> bool {
    let Some(mut condition) = node.child_by_field_name("condition") else {
        return false;
    };
    while condition.kind() == "parenthesized_expression" {
        let Some(inner) = condition.named_child(0) else {
            return false;
        };
        condition = inner;
    }
    if condition.kind() != "comparison_operator"
        || condition.named_child_count() != 2
        || condition.child(1).is_none_or(|n| n.kind() != "==")
    {
        return false;
    }
    let Some(left) = condition.named_child(0) else {
        return false;
    };
    let Some(right) = condition.named_child(1) else {
        return false;
    };
    let is_name = |n: Node<'_>| n.kind() == "identifier" && text(n) == "__name__";
    let is_main = |n: Node<'_>| {
        n.kind() == "string" && matches!(text(n).as_str(), "\"__main__\"" | "'__main__'")
    };
    (is_name(left) && is_main(right)) || (is_name(right) && is_main(left))
}

/// Nearest enclosing `class_definition` or `function_definition`.
fn enclosing_definition(node: Node) -> Option<Node> {
    let mut current = node.parent();
    while let Some(n) = current {
        if matches!(n.kind(), "class_definition" | "function_definition") {
            return Some(n);
        }
        current = n.parent();
    }
    None
}

fn callee(function: Node, text: &impl Fn(Node) -> String) -> Option<(Callee, u32)> {
    match function.kind() {
        "identifier" => Some((Callee::Name(text(function)), line_of(function))),
        "attribute" => {
            let object = function.child_by_field_name("object")?;
            let attribute = function.child_by_field_name("attribute")?;
            let name = text(attribute);
            let line = line_of(attribute);
            if object.kind() == "identifier" && SELF_NAMES.contains(&text(object).as_str()) {
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
        _ => None,
    }
}

/// `a.b.c` for a chain of identifiers; `None` for any other expression.
fn dotted(node: Node, text: &impl Fn(Node) -> String) -> Option<String> {
    match node.kind() {
        "identifier" => Some(text(node)),
        "attribute" => {
            let object = dotted(node.child_by_field_name("object")?, text)?;
            let attribute = text(node.child_by_field_name("attribute")?);
            Some(format!("{object}.{attribute}"))
        }
        _ => None,
    }
}

fn imports(node: Node, text: &impl Fn(Node) -> String) -> Vec<Import> {
    let line = line_of(node);
    let mut cursor = node.walk();
    let names: Vec<Node> = node.children_by_field_name("name", &mut cursor).collect();
    let compact = |n: Node| text(n).split_whitespace().collect::<String>();
    if node.kind() == "import_statement" {
        // `import a.b, c as d`: one import per module.
        return names
            .into_iter()
            .filter_map(|n| {
                let (module, local) = match n.kind() {
                    "dotted_name" => (compact(n), compact(n)),
                    "aliased_import" => (
                        compact(n.child_by_field_name("name")?),
                        compact(n.child_by_field_name("alias")?),
                    ),
                    _ => return None,
                };
                Some(Import {
                    line,
                    module,
                    bindings: vec![Binding::Module { local }],
                })
            })
            .collect();
    }
    let Some(module) = node.child_by_field_name("module_name").map(compact) else {
        return Vec::new();
    };
    let bindings = names
        .into_iter()
        .filter_map(|n| match n.kind() {
            "dotted_name" => Some(Binding::Name {
                imported: compact(n),
                local: compact(n),
            }),
            "aliased_import" => Some(Binding::Name {
                imported: compact(n.child_by_field_name("name")?),
                local: compact(n.child_by_field_name("alias")?),
            }),
            _ => None,
        })
        .collect();
    vec![Import {
        line,
        module,
        bindings,
    }]
}

fn collect_entries(
    parsed: &mut ParsedFile,
    root: Node<'_>,
    call_nodes: &[Node<'_>],
    source: &str,
    relpath: &str,
) {
    let text = |n: Node<'_>| {
        n.utf8_text(source.as_bytes())
            .unwrap_or_default()
            .to_owned()
    };
    let outside: Vec<_> = call_nodes
        .iter()
        .filter(|n| super::outside_runtime_scope(**n))
        .filter_map(|n| {
            let function = n.child_by_field_name("function")?;
            let (callee, line) = callee(function, &text)?;
            Some((*n, super::EntryCall { line, callee }))
        })
        .collect();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "if_statement"
            && super::outside_runtime_scope(node)
            && is_main_guard(node, &text)
            && let Some(body) = node.child_by_field_name("consequence")
        {
            parsed.entries.push(super::ParsedEntry {
                target: None,
                kind: gitvur_schema::EntryKind::MainGuard,
                name: relpath.into(),
                line: line_of(node),
                calls: outside
                    .iter()
                    .filter(|(call, _)| {
                        call.start_byte() >= body.start_byte() && call.end_byte() <= body.end_byte()
                    })
                    .map(|(_, call)| call.clone())
                    .collect(),
            });
        }
        let mut cursor = node.walk();
        stack.extend(node.named_children(&mut cursor));
    }
    if relpath == "__main__.py" || relpath.ends_with("/__main__.py") {
        parsed.entries.push(super::ParsedEntry {
            target: None,
            kind: gitvur_schema::EntryKind::PackageMain,
            name: relpath
                .strip_suffix("/__main__.py")
                .map_or_else(|| "__main__".into(), |p| p.replace('/', ".")),
            line: 1,
            calls: outside.iter().map(|(_, call)| call.clone()).collect(),
        });
    }
    parsed.entries.sort_by_key(|entry| entry.line);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(source: &str) -> ParsedFile {
        Python::new().parse("t.py", source).expect("parses")
    }

    #[test]
    fn query_compiles() {
        let _ = Python::new();
    }

    #[test]
    fn definitions_with_nesting_and_decorators() {
        let parsed = parse(
            "class A:\n    @staticmethod\n    def m():\n        def inner():\n            pass\n        return inner\n\nasync def f():\n    pass\n",
        );
        let defs: Vec<_> = parsed
            .definitions
            .iter()
            .map(|d| (d.name.as_str(), d.parent, d.start_line, d.end_line))
            .collect();
        assert_eq!(
            defs,
            [
                ("A", None, 1, 6),
                ("m", Some(0), 2, 6),
                ("inner", Some(1), 4, 5),
                ("f", None, 8, 9)
            ]
        );
    }

    #[test]
    fn call_shapes() {
        let parsed = parse(
            "def f(self):\n    g()\n    self.m()\n    cls.k()\n    a.b.c()\n    x().y()\n    lambda: h()\n",
        );
        let callees: Vec<_> = parsed
            .calls
            .iter()
            .map(|c| (c.line, c.callee.clone()))
            .collect();
        assert_eq!(
            callees,
            [
                (2, Callee::Name("g".into())),
                (3, Callee::SelfMethod("m".into())),
                (4, Callee::SelfMethod("k".into())),
                (
                    5,
                    Callee::Attribute {
                        receiver: Some("a.b".into()),
                        name: "c".into()
                    }
                ),
                (
                    6,
                    Callee::Attribute {
                        receiver: None,
                        name: "y".into()
                    }
                ),
                (6, Callee::Name("x".into())),
                (7, Callee::Name("h".into())),
            ]
        );
    }

    #[test]
    fn calls_outside_functions_are_skipped() {
        let parsed = parse("g()\nclass A:\n    x = g()\n");
        assert_eq!(parsed.calls, []);
    }

    #[test]
    fn import_shapes() {
        let parsed = parse(
            "import a.b, c as d\nfrom .m import x as y, z\nfrom .. import p\nfrom q import *\n",
        );
        let module = |local: &str| Binding::Module {
            local: local.into(),
        };
        let name = |imported: &str, local: &str| Binding::Name {
            imported: imported.into(),
            local: local.into(),
        };
        assert_eq!(
            parsed.imports,
            [
                Import {
                    line: 1,
                    module: "a.b".into(),
                    bindings: vec![module("a.b")]
                },
                Import {
                    line: 1,
                    module: "c".into(),
                    bindings: vec![module("d")]
                },
                Import {
                    line: 2,
                    module: ".m".into(),
                    bindings: vec![name("x", "y"), name("z", "z")]
                },
                Import {
                    line: 3,
                    module: "..".into(),
                    bindings: vec![name("p", "p")]
                },
                Import {
                    line: 4,
                    module: "q".into(),
                    bindings: vec![]
                },
            ]
        );
    }

    #[test]
    fn syntax_errors_are_reported() {
        let err = Python::new()
            .parse("t.py", "def ok():\n    pass\n\ndef broken(:\n")
            .unwrap_err();
        assert!(matches!(err, ParseError::Syntax { line: 4 }), "{err:?}");
    }

    #[test]
    fn module_resolution() {
        let files: BTreeSet<String> = [
            "a/b.py",
            "a/__init__.py",
            "a/c/__init__.py",
            "pkg/sub/m.py",
            "pkg/n.py",
            "top.py",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let py = Python::new();
        let r = |importer: &str, module: &str| py.resolve_module(importer, module, &files);
        assert_eq!(r("x.py", "a.b").as_deref(), Some("a/b.py"));
        assert_eq!(r("x.py", "a").as_deref(), Some("a/__init__.py"));
        assert_eq!(r("x.py", "a.c").as_deref(), Some("a/c/__init__.py"));
        assert_eq!(r("x.py", "json"), None);
        assert_eq!(r("pkg/sub/m.py", "..n").as_deref(), Some("pkg/n.py"));
        assert_eq!(r("pkg/sub/m.py", ".m").as_deref(), Some("pkg/sub/m.py"));
        assert_eq!(r("a/b.py", ".").as_deref(), Some("a/__init__.py"));
        assert_eq!(r("top.py", "..x"), None, "relative import above the root");
        assert_eq!(py.submodule("..", "n").as_deref(), Some("..n"));
        assert_eq!(py.submodule("a", "b").as_deref(), Some("a.b"));
    }
}
