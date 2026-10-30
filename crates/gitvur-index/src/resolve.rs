//! Language-independent core: node IDs, duplicate suffixes, import edges and call
//! resolution. The rules are documented in this crate's README.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use gitvur_schema::{
    Edge, EdgeType, Evidence, Node, NodeType, Provenance, SourceRange, Structure, UnresolvedCall,
    content_hash, extract_lines, line_count,
};

use crate::lang::{Binding, CallSite, Callee, DefKind, DefaultExport, LanguageBackend, ParsedFile};

/// One discovered file, ready for resolution.
pub(crate) struct SourceFile<'a> {
    pub relpath: String,
    /// Source with line endings normalised to `\n`.
    pub text: String,
    /// `None` when the file failed to parse: it becomes a file node without children.
    pub parsed: Option<ParsedFile>,
    pub backend: &'a dyn LanguageBackend,
}

/// What a local name bound by an import refers to.
#[derive(Debug, Clone)]
enum Bound {
    /// A module; `None` when it is outside the repository.
    Module(Option<usize>),
    /// A name in a module; `file` is `None` when the module is outside the repository.
    Name { file: Option<usize>, name: String },
}

/// A definition, addressed by `(file index, definition index)`.
type DefRef = (usize, usize);

enum Outcome {
    Edge(DefRef),
    Ambiguous(Vec<DefRef>),
    Drop,
}

/// Exactly one candidate is an edge; two or more are ambiguous.
fn decide(mut candidates: Vec<DefRef>) -> Outcome {
    candidates.sort_unstable();
    candidates.dedup();
    match candidates.len() {
        0 => Outcome::Drop,
        1 => Outcome::Edge(candidates[0]),
        _ => Outcome::Ambiguous(candidates),
    }
}

struct Resolver<'f, 'a> {
    files: &'f [SourceFile<'a>],
    /// Node ID of every definition, per file.
    ids: Vec<Vec<String>>,
    bindings: Vec<BTreeMap<String, Bound>>,
    /// Module-level definitions by name, per file.
    top_level: Vec<BTreeMap<String, Vec<usize>>>,
    /// Every method (function whose parent is a class) in the repository, by name.
    methods: BTreeMap<String, Vec<DefRef>>,
}

pub(crate) fn build_structure(project_name: &str, files: &[SourceFile<'_>]) -> Structure {
    let mut resolver = Resolver::new(files);
    let mut structure = Structure {
        nodes: nodes(project_name, files, &resolver.ids),
        edges: resolver.bind_imports(),
        unresolved_calls: Vec::new(),
    };
    let (call_edges, unresolved) = resolver.resolve_calls();
    structure.edges.extend(call_edges);
    structure.unresolved_calls = unresolved;
    structure.canonicalize();
    structure
}

fn definitions<'p>(file: &'p SourceFile<'_>) -> &'p [crate::lang::Definition] {
    file.parsed
        .as_ref()
        .map_or(&[], |p| p.definitions.as_slice())
}

fn called_name(callee: &Callee) -> &str {
    match callee {
        Callee::Name(name)
        | Callee::SelfMethod(name)
        | Callee::Attribute { name, .. }
        | Callee::New { name, .. } => name,
    }
}

/// Qualified names joined with `.`, with `#2`, `#3`… for duplicates in source order.
/// A child of a suffixed definition is qualified under the suffixed name.
fn definition_ids(file: &SourceFile<'_>) -> Vec<String> {
    let defs = definitions(file);
    let mut qualified: Vec<String> = Vec::with_capacity(defs.len());
    let mut seen: HashMap<String, u32> = HashMap::new();
    for def in defs {
        let base = match def.parent {
            Some(p) => format!("{}.{}", qualified[p], def.name),
            None => def.name.clone(),
        };
        let count = seen.entry(base.clone()).or_insert(0);
        *count += 1;
        qualified.push(if *count == 1 {
            base
        } else {
            format!("{base}#{count}")
        });
    }
    defs.iter()
        .zip(qualified)
        .map(|(def, q)| {
            let prefix = match def.kind {
                DefKind::Class => "class",
                DefKind::Function => "function",
            };
            format!("{prefix}:{}:{q}", file.relpath)
        })
        .collect()
}

fn nodes(project_name: &str, files: &[SourceFile<'_>], ids: &[Vec<String>]) -> Vec<Node> {
    let mut nodes = vec![Node {
        id: "project:root".into(),
        node_type: NodeType::Project,
        name: project_name.into(),
        parent_id: None,
        source: None,
        content_hash: None,
    }];
    for (fi, file) in files.iter().enumerate() {
        let file_id = format!("file:{}", file.relpath);
        let name = file.relpath.rsplit('/').next().unwrap_or(&file.relpath);
        nodes.push(Node {
            id: file_id.clone(),
            node_type: NodeType::File,
            name: name.into(),
            parent_id: Some("project:root".into()),
            source: Some(SourceRange {
                file: file.relpath.clone(),
                start_line: 1,
                end_line: line_count(&file.text),
            }),
            content_hash: Some(content_hash(&file.text)),
        });
        for (di, def) in definitions(file).iter().enumerate() {
            let Some(lines) = extract_lines(&file.text, def.start_line, def.end_line) else {
                continue;
            };
            nodes.push(Node {
                id: ids[fi][di].clone(),
                node_type: match def.kind {
                    DefKind::Class => NodeType::Class,
                    DefKind::Function => NodeType::Function,
                },
                name: def.name.clone(),
                parent_id: Some(
                    def.parent
                        .map_or_else(|| file_id.clone(), |p| ids[fi][p].clone()),
                ),
                source: Some(SourceRange {
                    file: file.relpath.clone(),
                    start_line: def.start_line,
                    end_line: def.end_line,
                }),
                content_hash: Some(content_hash(&lines)),
            });
        }
    }
    nodes
}

impl<'f, 'a> Resolver<'f, 'a> {
    fn new(files: &'f [SourceFile<'a>]) -> Self {
        let mut resolver = Resolver {
            files,
            ids: files.iter().map(definition_ids).collect(),
            bindings: vec![BTreeMap::new(); files.len()],
            top_level: vec![BTreeMap::new(); files.len()],
            methods: BTreeMap::new(),
        };
        for (fi, file) in files.iter().enumerate() {
            let defs = definitions(file);
            for (di, def) in defs.iter().enumerate() {
                match def.parent {
                    None => resolver.top_level[fi]
                        .entry(def.name.clone())
                        .or_default()
                        .push(di),
                    Some(p) if def.kind == DefKind::Function && defs[p].kind == DefKind::Class => {
                        resolver
                            .methods
                            .entry(def.name.clone())
                            .or_default()
                            .push((fi, di));
                    }
                    Some(_) => {}
                }
            }
        }
        resolver
    }

    /// Binds every imported local name and returns one `imports` edge per
    /// (importer, imported) file pair, with the first import line as evidence.
    fn bind_imports(&mut self) -> Vec<Edge> {
        let files = self.files;
        let file_set: BTreeSet<String> = files.iter().map(|f| f.relpath.clone()).collect();
        let file_index: HashMap<&str, usize> = files
            .iter()
            .enumerate()
            .map(|(i, f)| (f.relpath.as_str(), i))
            .collect();
        let mut import_edges: BTreeMap<(usize, usize), u32> = BTreeMap::new();
        for (fi, file) in files.iter().enumerate() {
            let Some(parsed) = &file.parsed else { continue };
            let resolve = |module: &str| {
                file.backend
                    .resolve_module(&file.relpath, module, &file_set)
                    .and_then(|path| file_index.get(path.as_str()).copied())
            };
            for import in &parsed.imports {
                let module_file = resolve(&import.module);
                let mut targets = Vec::new();
                if import.bindings.is_empty() {
                    targets.push(module_file);
                }
                for binding in &import.bindings {
                    let (local, bound) = match binding {
                        Binding::Module { local } => (local, Bound::Module(module_file)),
                        Binding::Name { imported, local } => {
                            let submodule = file
                                .backend
                                .submodule(&import.module, imported)
                                .and_then(|m| resolve(&m));
                            if submodule.is_some() {
                                (local, Bound::Module(submodule))
                            } else {
                                let name = imported.clone();
                                (
                                    local,
                                    Bound::Name {
                                        file: module_file,
                                        name,
                                    },
                                )
                            }
                        }
                    };
                    targets.push(match &bound {
                        Bound::Module(target) | Bound::Name { file: target, .. } => *target,
                    });
                    self.bindings[fi].insert(local.clone(), bound);
                }
                for target in targets.into_iter().flatten().filter(|&t| t != fi) {
                    let line = import_edges.entry((fi, target)).or_insert(import.line);
                    *line = (*line).min(import.line);
                }
            }
        }
        import_edges
            .into_iter()
            .map(|((from, to), line)| Edge {
                from: format!("file:{}", files[from].relpath),
                to: format!("file:{}", files[to].relpath),
                edge_type: EdgeType::Imports,
                provenance: Provenance::Syntactic,
                evidence: Evidence {
                    file: files[from].relpath.clone(),
                    line,
                },
                note: None,
            })
            .collect()
    }

    /// Resolves every call site: one `calls` edge per (caller, target) with the first call
    /// line as evidence, plus the ambiguous call sites.
    fn resolve_calls(&self) -> (Vec<Edge>, Vec<UnresolvedCall>) {
        let mut call_edges: BTreeMap<(DefRef, DefRef), u32> = BTreeMap::new();
        let mut unresolved = Vec::new();
        for (fi, file) in self.files.iter().enumerate() {
            let Some(parsed) = &file.parsed else { continue };
            for call in &parsed.calls {
                match self.resolve_call(fi, call) {
                    Outcome::Drop => {}
                    Outcome::Edge(target) => {
                        let line = call_edges
                            .entry(((fi, call.caller), target))
                            .or_insert(call.line);
                        *line = (*line).min(call.line);
                    }
                    Outcome::Ambiguous(candidates) => unresolved.push(UnresolvedCall {
                        from: self.ids[fi][call.caller].clone(),
                        name: called_name(&call.callee).to_owned(),
                        evidence: Evidence {
                            file: file.relpath.clone(),
                            line: call.line,
                        },
                        candidates: candidates
                            .iter()
                            .map(|&(f, d)| self.ids[f][d].clone())
                            .collect(),
                    }),
                }
            }
        }
        let edges = call_edges
            .into_iter()
            .map(|(((ff, fd), (tf, td)), line)| Edge {
                from: self.ids[ff][fd].clone(),
                to: self.ids[tf][td].clone(),
                edge_type: EdgeType::Calls,
                provenance: Provenance::Syntactic,
                evidence: Evidence {
                    file: self.files[ff].relpath.clone(),
                    line,
                },
                note: None,
            })
            .collect();
        (edges, unresolved)
    }

    fn def(&self, (f, d): DefRef) -> &crate::lang::Definition {
        &definitions(&self.files[f])[d]
    }

    /// Direct children of definition `parent` named `name`.
    fn children(&self, file: usize, parent: usize, name: &str) -> Vec<DefRef> {
        definitions(&self.files[file])
            .iter()
            .enumerate()
            .filter(|(_, d)| d.parent == Some(parent) && d.name == name)
            .map(|(i, _)| (file, i))
            .collect()
    }

    fn resolve_call(&self, file: usize, call: &CallSite) -> Outcome {
        match &call.callee {
            Callee::Name(name) => decide(self.name_candidates(file, call.caller, name)),
            Callee::SelfMethod(name) => {
                let mut current = self.def((file, call.caller)).parent;
                while let Some(d) = current {
                    if self.def((file, d)).kind == DefKind::Class {
                        let methods: Vec<DefRef> = self
                            .children(file, d, name)
                            .into_iter()
                            .filter(|&r| self.def(r).kind == DefKind::Function)
                            .collect();
                        if !methods.is_empty() {
                            return decide(methods);
                        }
                        break;
                    }
                    current = self.def((file, d)).parent;
                }
                self.unknown_receiver(name)
            }
            Callee::Attribute {
                receiver: Some(receiver),
                name,
            } => match self.bindings[file].get(receiver) {
                Some(Bound::Module(Some(module))) => decide(self.lookup_export(*module, name)),
                Some(Bound::Module(None)) => Outcome::Drop,
                Some(Bound::Name { .. }) | None => self.unknown_receiver(name),
            },
            Callee::Attribute {
                receiver: None,
                name,
            } => self.unknown_receiver(name),
            Callee::New { receiver, name } => {
                let candidates = match receiver {
                    None => self.name_candidates(file, call.caller, name),
                    Some(receiver) => match self.bindings[file].get(receiver) {
                        Some(Bound::Module(Some(module))) => self.lookup_export(*module, name),
                        _ => Vec::new(),
                    },
                };
                decide(
                    candidates
                        .into_iter()
                        .filter(|&r| self.def(r).kind == DefKind::Class)
                        .collect(),
                )
            }
        }
    }

    /// Candidates for a bare name: the scope chain, then module level, then imports. The
    /// first level with any match wins.
    fn name_candidates(&self, file: usize, caller: usize, name: &str) -> Vec<DefRef> {
        let mut scope = caller;
        loop {
            let found = self.children(file, scope, name);
            if !found.is_empty() {
                return found;
            }
            match self.def((file, scope)).parent {
                Some(p) if self.def((file, p)).kind == DefKind::Function => scope = p,
                _ => break,
            }
        }
        if let Some(found) = self.top_level[file].get(name) {
            return found.iter().map(|&d| (file, d)).collect();
        }
        match self.bindings[file].get(name) {
            Some(Bound::Name {
                file: Some(module),
                name: imported,
            }) => self.lookup_export(*module, imported),
            _ => Vec::new(),
        }
    }

    /// Module-level definitions named `name` in `file`, following re-exports (a name the
    /// module itself imports from another in-repo module). The name `default` refers to
    /// the module's default export.
    fn lookup_export(&self, file: usize, name: &str) -> Vec<DefRef> {
        let mut visited = BTreeSet::new();
        let (mut file, mut name) = (file, name.to_owned());
        while visited.insert((file, name.clone())) {
            if name == "default" {
                match self.files[file]
                    .parsed
                    .as_ref()
                    .and_then(|p| p.default_export.as_ref())
                {
                    Some(DefaultExport::Definition(d)) => return vec![(file, *d)],
                    Some(DefaultExport::Name(local)) => {
                        name.clone_from(local);
                        continue;
                    }
                    None => {}
                }
            }
            if let Some(found) = self.top_level[file].get(&name) {
                return found.iter().map(|&d| (file, d)).collect();
            }
            match self.bindings[file].get(&name) {
                Some(Bound::Name {
                    file: Some(next),
                    name: imported,
                }) => {
                    (file, name) = (*next, imported.clone());
                }
                _ => break,
            }
        }
        Vec::new()
    }

    /// Name matching on every in-repo method: only two or more candidates are kept.
    fn unknown_receiver(&self, name: &str) -> Outcome {
        match self.methods.get(name) {
            Some(candidates) if candidates.len() >= 2 => decide(candidates.clone()),
            _ => Outcome::Drop,
        }
    }
}
