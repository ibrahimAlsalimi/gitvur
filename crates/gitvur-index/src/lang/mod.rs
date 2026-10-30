//! Language backends turn one source file into a language-independent [`ParsedFile`].
//!
//! Backends only describe what is written in a file. Everything that needs the whole
//! repository (IDs, duplicate suffixes, import and call resolution) lives in
//! `crate::resolve`.

use std::collections::BTreeSet;

use gitvur_schema::Language;
use tree_sitter::Node;

pub mod python;
pub mod typescript;

/// One language supported by the extractor.
pub trait LanguageBackend {
    fn language(&self) -> Language;

    /// Whether this backend indexes the file at `relpath`.
    fn handles(&self, relpath: &str) -> bool;

    /// Parses `source` (the file at `relpath`), whose line endings are already
    /// normalised to `\n`.
    fn parse(&self, relpath: &str, source: &str) -> Result<ParsedFile, ParseError>;

    /// Resolves an import specifier, as written in `importer`, to an indexed file.
    fn resolve_module(
        &self,
        importer: &str,
        module: &str,
        files: &BTreeSet<String>,
    ) -> Option<String>;

    /// The specifier of `name` as a submodule of `module` (`from a import b` → `a.b`),
    /// for languages where an imported name may itself be a module.
    fn submodule(&self, _module: &str, _name: &str) -> Option<String> {
        None
    }
}

/// Why a file produced no definitions.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("syntax error at line {line}")]
    Syntax { line: u32 },
    #[error("parser failed: {0}")]
    Parser(String),
}

/// Everything a backend extracts from one file.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ParsedFile {
    /// In source order (by start position); a parent always precedes its children.
    pub definitions: Vec<Definition>,
    pub imports: Vec<Import>,
    pub calls: Vec<CallSite>,
    /// What `export default` refers to, for languages that have default exports.
    pub default_export: Option<DefaultExport>,
}

/// Target of a file's default export. Imported under the name `default`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefaultExport {
    /// `export default class C {}` / `export default function f() {}`
    Definition(usize),
    /// `export default name;`, resolved like an exported `name`.
    Name(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefKind {
    Class,
    Function,
}

/// A class or function. Qualified names and IDs are computed by the resolver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Definition {
    pub kind: DefKind,
    pub name: String,
    /// Index of the enclosing definition in [`ParsedFile::definitions`].
    pub parent: Option<usize>,
    pub start_line: u32,
    pub end_line: u32,
}

/// One import statement (or one module of a multi-module statement).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Import {
    pub line: u32,
    /// The specifier as written, e.g. `shop.utils`, `.store`, `./auth`.
    pub module: String,
    pub bindings: Vec<Binding>,
}

/// A local name introduced by an import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Binding {
    /// The local name refers to the module itself (`import a.b`, `import a.b as x`).
    /// For `import a.b` the local name is the dotted path `a.b`.
    Module { local: String },
    /// The local name refers to a name defined in (or re-exported by) the module.
    Name { imported: String, local: String },
}

/// A call inside a function definition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSite {
    /// Line of the called name.
    pub line: u32,
    /// Index of the innermost enclosing function in [`ParsedFile::definitions`].
    pub caller: usize,
    pub callee: Callee,
}

/// The syntactic shape of the called expression.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Callee {
    /// `name()`
    Name(String),
    /// `self.name()` / `cls.name()` / `this.name()`
    SelfMethod(String),
    /// `receiver.name()`. `receiver` is the dotted path when the receiver is a plain chain
    /// of identifiers (`a.b`), and `None` for anything else (calls, subscripts, literals).
    Attribute {
        receiver: Option<String>,
        name: String,
    },
    /// `new name()` (`receiver: None`) or `new receiver.name()`. Resolves only to classes,
    /// and never by method-name matching.
    New {
        receiver: Option<String>,
        name: String,
    },
}

// Position helpers shared by the tree-sitter backends.

pub(crate) fn line_of(node: Node) -> u32 {
    u32::try_from(node.start_position().row + 1).unwrap_or(u32::MAX)
}

/// Last line of `node`, not counting a final newline the node may end with.
pub(crate) fn end_line_of(node: Node) -> u32 {
    let end = node.end_position();
    let row = if end.column == 0 && end.row > node.start_position().row {
        end.row - 1
    } else {
        end.row
    };
    u32::try_from(row + 1).unwrap_or(u32::MAX)
}

pub(crate) fn first_error_line(root: Node) -> u32 {
    let mut cursor = root.walk();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.is_error() || node.is_missing() {
            return line_of(node);
        }
        // Push in reverse so the earliest child is visited first.
        let children: Vec<Node> = node.children(&mut cursor).filter(Node::has_error).collect();
        stack.extend(children.into_iter().rev());
    }
    line_of(root)
}
