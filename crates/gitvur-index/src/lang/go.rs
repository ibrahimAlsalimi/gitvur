//! Go backend: tree-sitter-go, package (directory) name scope, and import paths resolved
//! through the repository's `go.mod` module paths.

use std::collections::{BTreeSet, HashMap};

use gitvur_schema::{EntryKind, Language};
use tree_sitter::{Node, Parser};

use super::{
    Binding, CallSite, Callee, DefKind, Definition, Import, LanguageBackend, NameScope, ParseError,
    ParsedEntry, ParsedFile, end_line_of, first_error_line, line_of,
};

pub struct Go {
    language: tree_sitter::Language,
    /// `(module directory, module path)` from every `go.mod`, longest path first.
    modules: Vec<(String, String)>,
}

impl Go {
    /// `modules` come from the repository's `go.mod` files; without them no import path
    /// resolves.
    pub fn new(mut modules: Vec<(String, String)>) -> Self {
        modules.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.cmp(b)));
        Self {
            language: tree_sitter::Language::from(tree_sitter_go::LANGUAGE),
            modules,
        }
    }
}

fn dir_of(relpath: &str) -> &str {
    relpath.rsplit_once('/').map_or("", |(d, _)| d)
}

/// `*T`, `T`, `T[K]` → `T`.
fn receiver_type(receiver: Node, source: &str) -> Option<String> {
    let mut cursor = receiver.walk();
    let parameter = receiver
        .named_children(&mut cursor)
        .find(|c| c.kind() == "parameter_declaration")?;
    let mut t = parameter.child_by_field_name("type")?;
    loop {
        match t.kind() {
            "pointer_type" | "parenthesized_type" => t = t.named_child(0)?,
            "generic_type" => t = t.child_by_field_name("type")?,
            "type_identifier" => return t.utf8_text(source.as_bytes()).ok().map(str::to_owned),
            _ => return None,
        }
    }
}

/// The receiver's variable name (`s` in `func (s *Service) …`), if any.
fn receiver_name(receiver: Node, source: &str) -> Option<String> {
    let mut cursor = receiver.walk();
    let parameter = receiver
        .named_children(&mut cursor)
        .find(|c| c.kind() == "parameter_declaration")?;
    let name = parameter.child_by_field_name("name")?;
    name.utf8_text(source.as_bytes()).ok().map(str::to_owned)
}

/// `a`, `a.b`, `a.b.c` for plain identifier chains; `None` otherwise.
fn chain(node: Node, source: &str) -> Option<String> {
    match node.kind() {
        "identifier" | "package_identifier" | "field_identifier" => {
            node.utf8_text(source.as_bytes()).ok().map(str::to_owned)
        }
        "selector_expression" => {
            let operand = chain(node.child_by_field_name("operand")?, source)?;
            let field = node
                .child_by_field_name("field")?
                .utf8_text(source.as_bytes())
                .ok()?;
            Some(format!("{operand}.{field}"))
        }
        _ => None,
    }
}

fn callee(function: Node, source: &str, receiver: Option<&str>) -> Option<Callee> {
    let text = |n: Node| {
        n.utf8_text(source.as_bytes())
            .unwrap_or_default()
            .to_owned()
    };
    match function.kind() {
        "identifier" => Some(Callee::Name(text(function))),
        "selector_expression" => {
            let name = text(function.child_by_field_name("field")?);
            let operand = function.child_by_field_name("operand")?;
            let path = chain(operand, source);
            if path.is_some() && path.as_deref() == receiver {
                return Some(Callee::SelfMethod(name));
            }
            Some(Callee::Attribute {
                receiver: path,
                name,
            })
        }
        _ => None, // generic instantiation, function values, calls on call results
    }
}

/// One `Import` per import spec, binding the package name (or alias).
fn imports(item: Node, source: &str, parsed: &mut ParsedFile) {
    let text = |n: Node| {
        n.utf8_text(source.as_bytes())
            .unwrap_or_default()
            .to_owned()
    };
    let mut specs = Vec::new();
    let mut stack = vec![item];
    while let Some(n) = stack.pop() {
        if n.kind() == "import_spec" {
            specs.push(n);
        } else {
            let mut c = n.walk();
            stack.extend(n.named_children(&mut c));
        }
    }
    specs.sort_by_key(Node::start_byte);
    for spec in specs {
        let Some(path) = spec.child_by_field_name("path") else {
            continue;
        };
        let module = text(path).trim_matches(['"', '`']).to_owned();
        let alias = spec.child_by_field_name("name").map(text);
        let local = match alias.as_deref() {
            Some("_" | ".") => None, // side effects / merged names: no binding
            Some(a) => Some(a.to_owned()),
            None => module.rsplit('/').next().map(str::to_owned),
        };
        parsed.imports.push(Import {
            line: line_of(spec),
            module,
            bindings: local
                .into_iter()
                .map(|local| Binding::Module { local })
                .collect(),
        });
    }
}

/// Struct and interface type specs become classes; `types` maps their names to indexes.
fn types(item: Node, source: &str, parsed: &mut ParsedFile, types: &mut HashMap<String, usize>) {
    let text = |n: Node| {
        n.utf8_text(source.as_bytes())
            .unwrap_or_default()
            .to_owned()
    };
    let mut c = item.walk();
    for spec in item
        .named_children(&mut c)
        .filter(|n| n.kind() == "type_spec")
    {
        let is_record = spec
            .child_by_field_name("type")
            .is_some_and(|t| matches!(t.kind(), "struct_type" | "interface_type"));
        let Some(name) = spec.child_by_field_name("name").map(text) else {
            continue;
        };
        if !is_record {
            continue;
        }
        types
            .entry(name.clone())
            .or_insert(parsed.definitions.len());
        parsed.definitions.push(Definition {
            kind: DefKind::Class,
            name,
            parent: None,
            start_line: line_of(spec),
            end_line: end_line_of(spec),
            receiver: None,
            internal: false,
        });
    }
}

/// The calling function (definition index) and its receiver variable, if a method.
type Caller = Option<(usize, Option<String>)>;

/// Calls inside function and method bodies (closures included), in source order.
fn calls(
    root: Node,
    source: &str,
    functions: &HashMap<usize, (usize, Option<String>)>,
) -> Vec<CallSite> {
    let mut calls = Vec::new();
    let mut stack: Vec<(Node, Caller)> = vec![(root, None)];
    while let Some((node, caller)) = stack.pop() {
        let caller = functions.get(&node.id()).cloned().or(caller);
        if node.kind() == "call_expression"
            && let (Some((index, receiver)), Some(function)) =
                (&caller, node.child_by_field_name("function"))
            && let Some(callee) = callee(function, source, receiver.as_deref())
        {
            let line = function
                .child_by_field_name("field")
                .map_or_else(|| line_of(function), line_of);
            calls.push((
                node.start_byte(),
                CallSite {
                    line,
                    caller: *index,
                    callee,
                },
            ));
        }
        let mut c = node.walk();
        let children: Vec<Node> = node.named_children(&mut c).collect();
        stack.extend(children.into_iter().map(|child| (child, caller.clone())));
    }
    calls.sort_by_key(|(byte, _)| *byte);
    calls.into_iter().map(|(_, c)| c).collect()
}

impl LanguageBackend for Go {
    fn language(&self) -> Language {
        Language::Go
    }

    #[allow(clippy::case_sensitive_file_extension_comparisons)]
    fn handles(&self, relpath: &str) -> bool {
        relpath.ends_with(".go")
    }

    fn name_scope(&self) -> NameScope {
        NameScope::Package
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
        let text = |n: Node| {
            n.utf8_text(source.as_bytes())
                .unwrap_or_default()
                .to_owned()
        };

        let mut parsed = ParsedFile::default();
        let mut package = String::new();
        // Function node id → (definition index, receiver variable).
        let mut functions: HashMap<usize, (usize, Option<String>)> = HashMap::new();
        let mut type_index: HashMap<String, usize> = HashMap::new();
        let mut cursor = root.walk();
        let items: Vec<Node> = root.named_children(&mut cursor).collect();
        for item in items {
            match item.kind() {
                "package_clause" => {
                    let mut c = item.walk();
                    if let Some(name) = item.named_children(&mut c).next() {
                        package = text(name);
                    }
                }
                "import_declaration" => imports(item, source, &mut parsed),
                "type_declaration" => types(item, source, &mut parsed, &mut type_index),
                "function_declaration" | "method_declaration" => {
                    let Some(name) = item.child_by_field_name("name").map(text) else {
                        continue;
                    };
                    let receiver = item.child_by_field_name("receiver");
                    let type_name = receiver.and_then(|r| receiver_type(r, source));
                    // A child of its type when the type is declared earlier in this file.
                    let parent = type_name.as_ref().and_then(|t| type_index.get(t).copied());
                    let index = parsed.definitions.len();
                    if item.kind() == "function_declaration" && name == "main" && package == "main"
                    {
                        let dir = dir_of(relpath);
                        parsed.entries.push(ParsedEntry {
                            kind: EntryKind::MainFunction,
                            name: if dir.is_empty() {
                                relpath.to_owned()
                            } else {
                                dir.to_owned()
                            },
                            line: line_of(item),
                            calls: Vec::new(),
                            target: Some(index),
                        });
                    }
                    functions.insert(
                        item.id(),
                        (index, receiver.and_then(|r| receiver_name(r, source))),
                    );
                    parsed.definitions.push(Definition {
                        kind: DefKind::Function,
                        name,
                        parent,
                        start_line: line_of(item),
                        end_line: end_line_of(item),
                        receiver: if parent.is_none() { type_name } else { None },
                        internal: false,
                    });
                }
                _ => {}
            }
        }

        parsed.calls = calls(root, source, &functions);
        Ok(parsed)
    }

    /// An import path under a `go.mod` module path names the directory after the module
    /// prefix; the package's first file (by path) stands for it, and import edges and
    /// lookups cover the whole package. Anything else (standard library, other modules) is
    /// outside the repository.
    fn resolve_module(
        &self,
        _importer: &str,
        module: &str,
        files: &BTreeSet<String>,
    ) -> Option<String> {
        let (dir, rest) = self.modules.iter().find_map(|(dir, path)| {
            let rest = module.strip_prefix(path.as_str())?;
            (rest.is_empty() || rest.starts_with('/'))
                .then_some((dir, rest.trim_start_matches('/')))
        })?;
        let target = match (dir.is_empty(), rest.is_empty()) {
            (true, _) => rest.to_owned(),
            (false, true) => dir.clone(),
            (false, false) => format!("{dir}/{rest}"),
        };
        files
            .iter()
            .find(|f| self.handles(f) && dir_of(f) == target)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_resolve_only_under_a_module_path() {
        let files: BTreeSet<String> = ["app/log/a.go", "app/log/b.go", "app/main.go", "lib/x/x.go"]
            .into_iter()
            .map(String::from)
            .collect();
        let go = Go::new(vec![("app".into(), "example.com/app".into())]);
        let r = |m: &str| go.resolve_module("app/main.go", m, &files);
        assert_eq!(r("example.com/app/log").as_deref(), Some("app/log/a.go"));
        assert_eq!(r("example.com/app").as_deref(), Some("app/main.go"));
        assert_eq!(
            r("log"),
            None,
            "a local log/ is not the standard library's log"
        );
        assert_eq!(
            r("example.com/application/x"),
            None,
            "prefix must end at a segment"
        );
        assert_eq!(r("example.com/app/missing"), None);
        assert_eq!(
            Go::new(Vec::new()).resolve_module("a.go", "example.com/app/log", &files),
            None
        );
    }

    #[test]
    fn methods_receivers_and_main() {
        let src = "package main\n\nfunc (t *T) Early() {}\n\ntype T struct{}\n\
                   func (t *T) Late() { t.Early(); t.x.Run(); helper() }\n\
                   func main() { helper() }\n";
        let parsed = Go::new(Vec::new()).parse("cmd/a/main.go", src).unwrap();
        let defs: Vec<_> = parsed
            .definitions
            .iter()
            .map(|d| (d.name.as_str(), d.parent, d.receiver.as_deref()))
            .collect();
        assert_eq!(
            defs,
            [
                ("Early", None, Some("T")),
                ("T", None, None),
                ("Late", Some(1), None),
                ("main", None, None)
            ]
        );
        let calls: Vec<_> = parsed.calls.iter().map(|c| c.callee.clone()).collect();
        assert_eq!(calls[0], Callee::SelfMethod("Early".into()));
        assert_eq!(
            calls[1],
            Callee::Attribute {
                receiver: Some("t.x".into()),
                name: "Run".into()
            }
        );
        assert_eq!(parsed.entries[0].name, "cmd/a");
        assert_eq!(parsed.entries[0].target, Some(3));
    }
}
