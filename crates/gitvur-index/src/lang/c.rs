//! C backend: tree-sitter-c, `#include` resolution and program-wide (linker) name scope.
//!
//! Function definitions (with a body) and struct/union definitions (with a body) are nodes;
//! prototypes and macros are not. Definitions inside preprocessor conditionals (header
//! guards) count; nothing is preprocessed or compiled.

use std::collections::{BTreeSet, HashMap};

use gitvur_schema::{EntryKind, Language};
use tree_sitter::{Node, Parser};

use super::{
    CallSite, Callee, DefKind, Definition, Import, LanguageBackend, NameScope, ParseError,
    ParsedEntry, ParsedFile, end_line_of, first_error_line, line_of,
};

/// Preprocessor blocks whose contents are still top-level code.
const PREPROC_BLOCKS: &[&str] = &[
    "preproc_if",
    "preproc_ifdef",
    "preproc_else",
    "preproc_elif",
];

pub struct C {
    language: tree_sitter::Language,
}

impl C {
    pub fn new() -> Self {
        Self {
            language: tree_sitter::Language::from(tree_sitter_c::LANGUAGE),
        }
    }
}

impl Default for C {
    fn default() -> Self {
        Self::new()
    }
}

/// The identifier a declarator declares: through pointers, parentheses and arrays.
fn declared_name(mut node: Node<'_>) -> Option<Node<'_>> {
    loop {
        match node.kind() {
            "identifier" | "type_identifier" | "field_identifier" => return Some(node),
            _ => node = node.child_by_field_name("declarator")?,
        }
    }
}

/// Whether `node` (a function definition or declaration) has the `static` storage class.
fn is_static(node: Node, source: &str) -> bool {
    let mut cursor = node.walk();
    node.children(&mut cursor).any(|c| {
        c.kind() == "storage_class_specifier"
            && c.utf8_text(source.as_bytes()).is_ok_and(|t| t == "static")
    })
}

/// A struct or union with a body inside a top-level item, and the name it is known by.
fn record(item: Node<'_>, source: &str) -> Option<String> {
    let text = |n: Node| {
        n.utf8_text(source.as_bytes())
            .unwrap_or_default()
            .to_owned()
    };
    let specifier = match item.kind() {
        "struct_specifier" | "union_specifier" => item,
        "declaration" | "type_definition" => {
            let t = item.child_by_field_name("type")?;
            if !matches!(t.kind(), "struct_specifier" | "union_specifier") {
                return None;
            }
            t
        }
        _ => return None,
    };
    specifier.child_by_field_name("body")?;
    if let Some(name) = specifier.child_by_field_name("name") {
        return Some(text(name));
    }
    // `typedef struct { … } name;`
    (item.kind() == "type_definition")
        .then(|| {
            item.child_by_field_name("declarator")
                .and_then(declared_name)
        })
        .flatten()
        .map(text)
}

/// Top-level items, looking inside preprocessor conditionals.
fn top_level_items(root: Node<'_>) -> Vec<Node<'_>> {
    let mut items = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let mut cursor = node.walk();
        let children: Vec<Node> = node.named_children(&mut cursor).collect();
        for child in children.into_iter().rev() {
            if PREPROC_BLOCKS.contains(&child.kind()) {
                stack.push(child);
            } else {
                items.push(child);
            }
        }
    }
    items.sort_by_key(Node::start_byte);
    items
}

fn callee(function: Node, source: &str) -> Option<Callee> {
    let text = |n: Node| {
        n.utf8_text(source.as_bytes())
            .unwrap_or_default()
            .to_owned()
    };
    match function.kind() {
        "identifier" => Some(Callee::Name(text(function))),
        "field_expression" => {
            let name = text(function.child_by_field_name("field")?);
            let argument = function.child_by_field_name("argument")?;
            let receiver = (argument.kind() == "identifier").then(|| text(argument));
            Some(Callee::Attribute { receiver, name })
        }
        _ => None, // `(*fp)()`, `table[i]()`: unknown target
    }
}

impl LanguageBackend for C {
    fn language(&self) -> Language {
        Language::C
    }

    #[allow(clippy::case_sensitive_file_extension_comparisons)]
    fn handles(&self, relpath: &str) -> bool {
        relpath.ends_with(".c") || relpath.ends_with(".h")
    }

    fn name_scope(&self) -> NameScope {
        NameScope::Program
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
        let mut functions: HashMap<usize, usize> = HashMap::new(); // node id → definition
        for item in top_level_items(root) {
            match item.kind() {
                "preproc_include" => {
                    if let Some(path) = item.child_by_field_name("path") {
                        parsed.imports.push(Import {
                            line: line_of(path),
                            module: text(path), // keeps "…" or <…>
                            bindings: Vec::new(),
                        });
                    }
                }
                "function_definition" => {
                    let Some(name) = item
                        .child_by_field_name("declarator")
                        .and_then(declared_name)
                        .map(text)
                    else {
                        continue;
                    };
                    let internal = is_static(item, source);
                    let index = parsed.definitions.len();
                    if name == "main" && !internal {
                        parsed.entries.push(ParsedEntry {
                            kind: EntryKind::MainFunction,
                            name: relpath.to_owned(),
                            line: line_of(item),
                            calls: Vec::new(),
                            target: Some(index),
                        });
                    }
                    functions.insert(item.id(), index);
                    parsed.definitions.push(Definition {
                        kind: DefKind::Function,
                        name,
                        parent: None,
                        start_line: line_of(item),
                        end_line: end_line_of(item),
                        receiver: None,
                        internal,
                    });
                }
                _ => {
                    if let Some(name) = record(item, source) {
                        parsed.definitions.push(Definition {
                            kind: DefKind::Class,
                            name,
                            parent: None,
                            start_line: line_of(item),
                            end_line: end_line_of(item),
                            receiver: None,
                            internal: false,
                        });
                    }
                }
            }
        }

        // Calls inside function bodies, in source order.
        let mut stack = vec![(root, None::<usize>)];
        let mut calls = Vec::new();
        while let Some((node, caller)) = stack.pop() {
            let caller = functions.get(&node.id()).copied().or(caller);
            if node.kind() == "call_expression"
                && let (Some(caller), Some(function)) =
                    (caller, node.child_by_field_name("function"))
                && let Some(callee) = callee(function, source)
            {
                calls.push((
                    node.start_byte(),
                    CallSite {
                        line: line_of(function),
                        caller,
                        callee,
                    },
                ));
            }
            let mut cursor = node.walk();
            stack.extend(node.named_children(&mut cursor).map(|c| (c, caller)));
        }
        calls.sort_by_key(|(byte, _)| *byte);
        parsed.calls = calls.into_iter().map(|(_, c)| c).collect();
        Ok(parsed)
    }

    /// `"x.h"`: relative to the including file, else the one indexed file whose path ends
    /// with `/x.h` (a stand-in for `-I` flags, which are never read). `<x.h>`: only a path
    /// with a directory (`<lib/x.h>`), by the same unique-suffix rule; never a bare system
    /// header name.
    fn resolve_module(
        &self,
        importer: &str,
        module: &str,
        files: &BTreeSet<String>,
    ) -> Option<String> {
        let (quoted, path) =
            if let Some(p) = module.strip_prefix('"').and_then(|m| m.strip_suffix('"')) {
                (true, p)
            } else {
                (false, module.strip_prefix('<')?.strip_suffix('>')?)
            };
        if path.is_empty() || path.starts_with('/') || path.contains('\\') {
            return None;
        }
        if quoted {
            let mut parts: Vec<&str> = importer.split('/').collect();
            parts.pop();
            let mut inside = true;
            for segment in path.split('/') {
                match segment {
                    "" | "." => {}
                    ".." => inside &= parts.pop().is_some(),
                    s => parts.push(s),
                }
            }
            let relative = parts.join("/");
            if inside && files.contains(&relative) {
                return Some(relative);
            }
        } else if !path.contains('/') {
            return None;
        }
        if path.split('/').any(|s| s == "..") {
            return None;
        }
        let suffix = format!("/{path}");
        let mut found = files
            .iter()
            .filter(|f| f.as_str() == path || f.ends_with(&suffix));
        let first = found.next()?;
        found.next().is_none().then(|| first.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_resolve_relatively_then_by_unique_suffix() {
        let files: BTreeSet<String> = ["include/a.h", "src/a.c", "src/b.h", "x/dup.h", "y/dup.h"]
            .into_iter()
            .map(String::from)
            .collect();
        let r = |importer: &str, m: &str| C::new().resolve_module(importer, m, &files);
        assert_eq!(r("src/a.c", "\"b.h\"").as_deref(), Some("src/b.h"));
        assert_eq!(
            r("src/a.c", "\"../include/a.h\"").as_deref(),
            Some("include/a.h")
        );
        assert_eq!(r("src/a.c", "\"a.h\"").as_deref(), Some("include/a.h"));
        assert_eq!(r("src/a.c", "\"dup.h\""), None, "two candidates");
        assert_eq!(r("src/a.c", "<a.h>"), None, "bare system-style name");
        assert_eq!(
            r("src/a.c", "<include/a.h>").as_deref(),
            Some("include/a.h")
        );
        assert_eq!(
            r("src/a.c", "\"../../a.h\""),
            None,
            "above the root, no suffix guess"
        );
        assert_eq!(r("src/a.c", "<stdio.h>"), None);
    }

    #[test]
    fn definitions_calls_and_entries() {
        let src = "#ifndef X\n#define X\nstruct s { int a; };\n#endif\n\
                   static int helper(void) { return 1; }\n\
                   char *name(void) { return 0; }\n\
                   int main(void) { helper(); p->run(); (*fp)(); return 0; }\n";
        let parsed = C::new().parse("m.c", src).unwrap();
        let defs: Vec<_> = parsed
            .definitions
            .iter()
            .map(|d| (d.kind, d.name.as_str(), d.internal))
            .collect();
        assert_eq!(
            defs,
            [
                (DefKind::Class, "s", false),
                (DefKind::Function, "helper", true),
                (DefKind::Function, "name", false),
                (DefKind::Function, "main", false),
            ]
        );
        assert_eq!(parsed.calls.len(), 2);
        assert_eq!(parsed.calls[0].callee, Callee::Name("helper".into()));
        assert_eq!(parsed.entries[0].target, Some(3));
    }
}
