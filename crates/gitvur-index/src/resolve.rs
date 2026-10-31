//! Language-independent core: node IDs, duplicate suffixes, import edges and call
//! resolution. The rules are documented in this crate's README.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use gitvur_schema::{
    Edge, EdgeType, Evidence, Node, NodeType, Provenance, SourceRange, Structure, UnresolvedCall,
    content_hash, extract_lines, line_count,
};

use crate::lang::{
    Binding, CallSite, Callee, DefKind, DefaultExport, LanguageBackend, NameScope, ParsedFile,
};

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

pub(crate) fn build_structure(
    project_name: &str,
    files: &[SourceFile<'_>],
    config: &[crate::config::ConfigEntry],
) -> Structure {
    let mut resolver = Resolver::new(files);
    let mut structure = Structure {
        entry_points: Vec::new(),
        nodes: nodes(project_name, files, &resolver.ids),
        edges: resolver.bind_imports(),
        unresolved_calls: Vec::new(),
    };
    let (call_edges, unresolved) = resolver.resolve_calls();
    structure.edges.extend(call_edges);
    structure.unresolved_calls = unresolved;
    resolver.resolve_entries(&mut structure, config);
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
        let base = match (def.parent, &def.receiver) {
            (Some(p), _) => format!("{}.{}", qualified[p], def.name),
            (None, Some(receiver)) => format!("{receiver}.{}", def.name),
            (None, None) => def.name.clone(),
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
                    // A method declared apart from its type is not a top-level name.
                    None if def.receiver.is_some() => resolver
                        .methods
                        .entry(def.name.clone())
                        .or_default()
                        .push((fi, di)),
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
                let targets: Vec<usize> = targets
                    .into_iter()
                    .flatten()
                    .flat_map(|t| package_files(files, t))
                    .collect();
                for target in targets.into_iter().filter(|&t| t != fi) {
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

    fn config_target(&self, entry: &crate::config::ConfigEntry) -> Option<String> {
        match &entry.target {
            crate::config::Target::File(path) => crate::config::relative_path(&entry.file, path)
                .and_then(|p| {
                    self.files
                        .iter()
                        .find(|f| f.relpath == p)
                        .map(|_| format!("file:{p}"))
                }),
            crate::config::Target::Python(specifier) => {
                specifier.split_once(':').and_then(|(module, symbol)| {
                    let module_path = module.replace('.', "/");
                    let path =
                        crate::config::relative_path(&entry.file, &format!("{module_path}.py"))?;
                    let package = crate::config::relative_path(
                        &entry.file,
                        &format!("{module_path}/__init__.py"),
                    )?;
                    let file = self
                        .files
                        .iter()
                        .position(|f| f.relpath == path)
                        .or_else(|| self.files.iter().position(|f| f.relpath == package))?;
                    let mut segments = symbol.split('.');
                    let first = segments.next()?;
                    let mut found = self.lookup_export(file, first);
                    for part in segments {
                        found = found
                            .into_iter()
                            .flat_map(|(f, d)| self.children(f, d, part))
                            .collect();
                    }
                    let found: Vec<_> = found
                        .into_iter()
                        .filter(|&r| self.def(r).kind == DefKind::Function)
                        .collect();
                    (found.len() == 1).then(|| self.ids[found[0].0][found[0].1].clone())
                })
            }
        }
    }

    fn resolve_entries(&self, structure: &mut Structure, config: &[crate::config::ConfigEntry]) {
        use gitvur_schema::{EntryKind, EntryPoint};
        let mut seen = BTreeMap::<String, u32>::new();
        let mut id_for = |kind, name: &str| entry_id(&mut seen, kind, name);
        for entry in config {
            let target = self.config_target(entry);
            structure.entry_points.push(EntryPoint {
                id: id_for(entry.kind, &entry.name),
                kind: entry.kind,
                name: entry.name.clone(),
                target,
                raw: Some(entry.raw.clone()),
                calls: Vec::new(),
                evidence: Some(Evidence {
                    file: entry.file.clone(),
                    line: entry.line,
                }),
                provenance: Provenance::Syntactic,
            });
        }
        for (fi, file) in self.files.iter().enumerate() {
            let Some(parsed) = &file.parsed else {
                continue;
            };
            for entry in &parsed.entries {
                let mut calls = BTreeSet::new();
                let mut ambiguous = Vec::new();
                for call in &entry.calls {
                    match self.resolve_callee(fi, None, &call.callee) {
                        Outcome::Edge((f, d)) => {
                            calls.insert(self.ids[f][d].clone());
                        }
                        Outcome::Ambiguous(targets) => ambiguous.push(UnresolvedCall {
                            from: String::new(),
                            name: called_name(&call.callee).into(),
                            evidence: Evidence {
                                file: file.relpath.clone(),
                                line: call.line,
                            },
                            candidates: targets
                                .into_iter()
                                .map(|(f, d)| self.ids[f][d].clone())
                                .collect(),
                        }),
                        Outcome::Drop => {}
                    }
                }
                if entry.kind == EntryKind::TopLevelCall && calls.is_empty() && ambiguous.is_empty()
                {
                    continue;
                }
                let id = id_for(entry.kind, &entry.name);
                for mut call in ambiguous {
                    call.from.clone_from(&id);
                    structure.unresolved_calls.push(call);
                }
                let target = entry.target.map_or_else(
                    || format!("file:{}", file.relpath),
                    |d| self.ids[fi][d].clone(),
                );
                structure.entry_points.push(EntryPoint {
                    id,
                    kind: entry.kind,
                    name: entry.name.clone(),
                    target: Some(target),
                    raw: None,
                    calls: calls.into_iter().collect(),
                    evidence: Some(Evidence {
                        file: file.relpath.clone(),
                        line: entry.line,
                    }),
                    provenance: Provenance::Syntactic,
                });
            }
        }
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
        self.resolve_callee(file, Some(call.caller), &call.callee)
    }

    fn resolve_callee(&self, file: usize, caller: Option<usize>, callee: &Callee) -> Outcome {
        match callee {
            Callee::Name(name) => decide(self.name_candidates(file, caller, name)),
            Callee::SelfMethod(name) => {
                let mut current = caller.and_then(|d| self.def((file, d)).parent);
                while let Some(d) = current {
                    if self.def((file, d)).kind == DefKind::Class {
                        let mut methods: Vec<DefRef> = self
                            .children(file, d, name)
                            .into_iter()
                            .filter(|&r| self.def(r).kind == DefKind::Function)
                            .collect();
                        if methods.is_empty() && self.scope(file) == NameScope::Package {
                            methods = self.type_members(file, &self.def((file, d)).name, name);
                        }
                        if !methods.is_empty() {
                            return decide(methods);
                        }
                        break;
                    }
                    current = self.def((file, d)).parent;
                }
                // A Go method declared apart from its type: look the type up in the package.
                if let Some(receiver) = caller.and_then(|d| self.def((file, d)).receiver.clone()) {
                    let methods = self.type_members(file, &receiver, name);
                    if !methods.is_empty() {
                        return decide(methods);
                    }
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
                    None => self.name_candidates(file, caller, name),
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
    fn name_candidates(&self, file: usize, caller: Option<usize>, name: &str) -> Vec<DefRef> {
        let mut current = caller;
        while let Some(scope) = current {
            let found = self.children(file, scope, name);
            if !found.is_empty() {
                return found;
            }
            match self.def((file, scope)).parent {
                Some(p) if self.def((file, p)).kind == DefKind::Function => current = Some(p),
                _ => break,
            }
        }
        if let Some(found) = self.top_level[file].get(name) {
            return found.iter().map(|&d| (file, d)).collect();
        }
        let shared = self.shared_candidates(file, name);
        if !shared.is_empty() {
            return shared;
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
            if self.scope(file) == NameScope::Package {
                // A Go package exports what any of its files declares.
                let found = self.shared_candidates(file, &name);
                if !found.is_empty() {
                    return found;
                }
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

    fn scope(&self, file: usize) -> NameScope {
        self.files[file].backend.name_scope()
    }

    /// Top-level definitions named `name` in the other files `file` shares names with: its
    /// package (Go), or every file of its language where only non-internal functions count
    /// (C). Empty for file-scoped languages.
    fn shared_candidates(&self, file: usize, name: &str) -> Vec<DefRef> {
        let others: Vec<usize> = match self.scope(file) {
            NameScope::File => return Vec::new(),
            NameScope::Package => package_files(self.files, file),
            NameScope::Program => (0..self.files.len())
                .filter(|&f| same_language(self.files, f, file))
                .collect(),
        };
        let program = self.scope(file) == NameScope::Program;
        others
            .into_iter()
            .filter(|&f| f != file)
            .flat_map(|f| {
                self.top_level[f]
                    .get(name)
                    .into_iter()
                    .flatten()
                    .map(move |&d| (f, d))
            })
            .filter(|&r| {
                !program || (self.def(r).kind == DefKind::Function && !self.def(r).internal)
            })
            .collect()
    }

    /// Methods named `name` of type `type_name` anywhere in `file`'s package: children of
    /// a class of that name, and methods declared apart from it.
    fn type_members(&self, file: usize, type_name: &str, name: &str) -> Vec<DefRef> {
        let mut found = Vec::new();
        for f in package_files(self.files, file) {
            for (d, def) in definitions(&self.files[f]).iter().enumerate() {
                if def.kind != DefKind::Function || def.name != name {
                    continue;
                }
                let parent_is_type = def.parent.is_some_and(|p| {
                    let parent = self.def((f, p));
                    parent.kind == DefKind::Class
                        && parent.parent.is_none()
                        && parent.name == type_name
                });
                if parent_is_type || def.receiver.as_deref() == Some(type_name) {
                    found.push((f, d));
                }
            }
        }
        found
    }

    /// Name matching on every in-repo method: only two or more candidates are kept.
    fn unknown_receiver(&self, name: &str) -> Outcome {
        match self.methods.get(name) {
            Some(candidates) if candidates.len() >= 2 => decide(candidates.clone()),
            _ => Outcome::Drop,
        }
    }
}

fn same_language(files: &[SourceFile<'_>], a: usize, b: usize) -> bool {
    files[a].backend.language() == files[b].backend.language()
}

/// The files that form one namespace with `file`: its directory's files of the same
/// language for package-scoped languages (Go), else just `file`. Sorted by path.
fn package_files(files: &[SourceFile<'_>], file: usize) -> Vec<usize> {
    if files[file].backend.name_scope() != NameScope::Package {
        return vec![file];
    }
    let dir = |f: usize| files[f].relpath.rsplit_once('/').map_or("", |(d, _)| d);
    (0..files.len())
        .filter(|&f| same_language(files, f, file) && dir(f) == dir(file))
        .collect()
}

fn entry_id(
    seen: &mut BTreeMap<String, u32>,
    kind: gitvur_schema::EntryKind,
    name: &str,
) -> String {
    let mut slug = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "entry" } else { slug };
    let base = format!("entry:{}:{slug}", kind.as_str());
    let count = seen.entry(base.clone()).or_default();
    *count += 1;
    if *count == 1 {
        base
    } else {
        format!("{base}#{count}")
    }
}
