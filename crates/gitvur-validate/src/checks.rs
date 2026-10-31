//! Checks on `annotations.json` against a fresh structure.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;

use gitvur_schema::{
    Annotations, Edge, EdgeType, Issue, Node, NodeType, Provenance, Severity, extract_lines,
    line_count,
};

use crate::codes::{
    AI_EDGE_BAD_PROVENANCE, AI_EDGE_DUPLICATES_STATIC, AI_EDGE_EVIDENCE_MISMATCH,
    AI_EDGE_EVIDENCE_OUT_OF_RANGE, DANGLING_REF, DESCRIPTION_EMPTY, FILE_MULTI_ASSIGNED,
    FILE_UNASSIGNED, MODULE_NOT_MODULE,
};
use crate::{ValidateInput, issue, resolve_in_repo};

/// `module:` followed by a non-empty `[a-z0-9-]+` slug.
pub(crate) fn is_module_id(id: &str) -> bool {
    id.strip_prefix("module:").is_some_and(|slug| {
        !slug.is_empty()
            && slug
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

pub(crate) fn check(input: &ValidateInput, annotations: &Annotations, issues: &mut Vec<Issue>) {
    let nodes: BTreeMap<&str, &Node> = input
        .structure
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n))
        .collect();
    let modules: BTreeMap<&str, &gitvur_schema::Module> = annotations
        .modules
        .iter()
        .filter(|m| is_module_id(&m.id))
        .map(|m| (m.id.as_str(), m))
        .collect();
    let ctx = Context {
        input,
        nodes,
        modules,
    };
    check_modules(&ctx, annotations, issues);
    check_descriptions(&ctx, annotations, issues);
    check_edges(&ctx, annotations, issues);
}

/// Lookups shared by the checks.
struct Context<'a> {
    input: &'a ValidateInput,
    nodes: BTreeMap<&'a str, &'a Node>,
    /// Modules with a valid ID.
    modules: BTreeMap<&'a str, &'a gitvur_schema::Module>,
}

impl Context<'_> {
    /// A structure node or a valid module of the annotations.
    fn known(&self, id: &str) -> bool {
        self.nodes.contains_key(id) || self.modules.contains_key(id)
    }
}

/// Module IDs, module file lists, and one-module-per-file.
fn check_modules(ctx: &Context<'_>, annotations: &Annotations, issues: &mut Vec<Issue>) {
    let nodes = &ctx.nodes;
    let mut assigned: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for module in &annotations.modules {
        if !is_module_id(&module.id) {
            issues.push(issue(
                Severity::Error,
                MODULE_NOT_MODULE,
                Some(&module.id),
                format!(
                    "module ID `{}` is not of the form `module:<slug>` with slug [a-z0-9-]+",
                    module.id
                ),
            ));
        }
        for file in &module.files {
            match nodes.get(file.as_str()) {
                None => issues.push(issue(
                    Severity::Error,
                    DANGLING_REF,
                    Some(&module.id),
                    format!(
                        "module `{}` lists `{file}`, which is not in the structure",
                        module.id
                    ),
                )),
                Some(node) if node.node_type != NodeType::File => issues.push(issue(
                    Severity::Error,
                    DANGLING_REF,
                    Some(&module.id),
                    format!(
                        "module `{}` lists `{file}`, which is not a file node",
                        module.id
                    ),
                )),
                Some(_) => {
                    assigned
                        .entry(file.as_str())
                        .or_default()
                        .insert(module.id.as_str());
                }
            }
        }
    }
    for node in nodes.values().filter(|n| n.node_type == NodeType::File) {
        match assigned.get(node.id.as_str()) {
            None => issues.push(issue(
                Severity::Warning,
                FILE_UNASSIGNED,
                Some(&node.id),
                format!("`{}` belongs to no module", node.id),
            )),
            Some(owners) if owners.len() > 1 => {
                let list: Vec<&str> = owners.iter().copied().collect();
                issues.push(issue(
                    Severity::Error,
                    FILE_MULTI_ASSIGNED,
                    Some(&node.id),
                    format!(
                        "`{}` is in {} modules: {}",
                        node.id,
                        owners.len(),
                        list.join(", ")
                    ),
                ));
            }
            Some(_) => {}
        }
    }
}

fn check_descriptions(ctx: &Context<'_>, annotations: &Annotations, issues: &mut Vec<Issue>) {
    for description in &annotations.descriptions {
        if !ctx.known(&description.id) {
            issues.push(issue(
                Severity::Error,
                DANGLING_REF,
                Some(&description.id),
                format!(
                    "description for `{}`, which is not in the structure",
                    description.id
                ),
            ));
        }
        if description.text.trim().is_empty() {
            issues.push(issue(
                Severity::Warning,
                DESCRIPTION_EMPTY,
                Some(&description.id),
                format!("description for `{}` is empty", description.id),
            ));
        }
    }
}

fn check_edges(ctx: &Context<'_>, annotations: &Annotations, issues: &mut Vec<Issue>) {
    let input = ctx.input;
    let static_edges: BTreeSet<(&str, &str, EdgeType)> = input
        .structure
        .edges
        .iter()
        .map(|e| (e.from.as_str(), e.to.as_str(), e.edge_type))
        .collect();
    let mut files = EvidenceFiles::new(input);
    for edge in &annotations.edges {
        let label = format!(
            "{} -> {} ({})",
            edge.from,
            edge.to,
            edge_type_name(edge.edge_type)
        );
        if edge.provenance != Provenance::Ai {
            issues.push(issue(
                Severity::Error,
                AI_EDGE_BAD_PROVENANCE,
                Some(&edge.from),
                format!(
                    "edge {label} in annotations.json has provenance `{}`; only `ai` is allowed",
                    provenance_name(edge.provenance)
                ),
            ));
        }
        for end in [&edge.from, &edge.to] {
            if !ctx.known(end) {
                issues.push(issue(
                    Severity::Error,
                    DANGLING_REF,
                    Some(&edge.from),
                    format!("edge {label} refers to `{end}`, which is not in the structure"),
                ));
            }
        }
        if let Some(problem) = check_evidence(edge, &mut files, &ctx.nodes, &ctx.modules) {
            issues.push(issue(
                problem.0,
                problem.1,
                Some(&edge.from),
                format!("edge {label}: {}", problem.2),
            ));
        }
        if static_edges.contains(&(edge.from.as_str(), edge.to.as_str(), edge.edge_type)) {
            issues.push(issue(
                Severity::Warning,
                AI_EDGE_DUPLICATES_STATIC,
                Some(&edge.from),
                format!("edge {label} duplicates an extractor edge"),
            ));
        }
    }
}

/// Evidence file contents, read once each, through the path-safety check.
pub(crate) struct EvidenceFiles<'i> {
    input: &'i ValidateInput,
    cache: HashMap<String, Option<String>>,
}

impl gitvur_flow::EvidenceSource for EvidenceFiles<'_> {
    fn text(&mut self, file: &str) -> Option<&str> {
        self.get(file)
    }
}

impl<'i> EvidenceFiles<'i> {
    pub(crate) fn new(input: &'i ValidateInput) -> Self {
        Self {
            input,
            cache: HashMap::new(),
        }
    }

    fn get(&mut self, relpath: &str) -> Option<&str> {
        let root = &self.input.repo_root;
        self.cache
            .entry(relpath.to_owned())
            .or_insert_with(|| {
                let path = resolve_in_repo(root, relpath)?;
                let bytes = fs::read(path).ok()?;
                Some(String::from_utf8_lossy(&bytes).into_owned())
            })
            .as_deref()
    }
}

fn check_evidence(
    edge: &Edge,
    files: &mut EvidenceFiles<'_>,
    nodes: &BTreeMap<&str, &Node>,
    modules: &BTreeMap<&str, &gitvur_schema::Module>,
) -> Option<(Severity, &'static str, String)> {
    let evidence = &edge.evidence;
    let Some(text) = files.get(&evidence.file) else {
        return Some((
            Severity::Error,
            AI_EDGE_EVIDENCE_OUT_OF_RANGE,
            format!(
                "evidence file `{}` does not exist or is outside the repository",
                evidence.file
            ),
        ));
    };
    let lines = line_count(text);
    let Some(line) = extract_lines(text, evidence.line, evidence.line) else {
        return Some((
            Severity::Error,
            AI_EDGE_EVIDENCE_OUT_OF_RANGE,
            format!(
                "evidence line {} is outside `{}` (1..={lines})",
                evidence.line, evidence.file
            ),
        ));
    };
    let names = short_names(&edge.to, nodes, modules);
    if names.is_empty() || names.iter().any(|n| line.contains(n.as_str())) {
        return None; // unknown target is reported as dangling-ref
    }
    Some((
        Severity::Warning,
        AI_EDGE_EVIDENCE_MISMATCH,
        format!(
            "evidence line {}:{} does not contain the target's name ({})",
            evidence.file,
            evidence.line,
            names
                .iter()
                .map(|n| format!("`{n}`"))
                .collect::<Vec<_>>()
                .join(" or ")
        ),
    ))
}

/// Names that identify `id` on an evidence line: a node's `name`; for a file also its stem
/// (`login.ts` → `login`); for a module its slug and display name.
fn short_names(
    id: &str,
    nodes: &BTreeMap<&str, &Node>,
    modules: &BTreeMap<&str, &gitvur_schema::Module>,
) -> Vec<String> {
    if let Some(node) = nodes.get(id) {
        let mut names = vec![node.name.clone()];
        if node.node_type == NodeType::File
            && let Some((stem, _)) = node.name.split_once('.')
            && !stem.is_empty()
        {
            names.push(stem.to_owned());
        }
        return names;
    }
    if let Some(module) = modules.get(id) {
        let slug = id.trim_start_matches("module:").to_owned();
        return vec![slug, module.name.clone()];
    }
    Vec::new()
}

fn edge_type_name(edge_type: EdgeType) -> &'static str {
    match edge_type {
        EdgeType::Calls => "calls",
        EdgeType::DependsOn => "depends_on",
        EdgeType::Imports => "imports",
        EdgeType::References => "references",
    }
}

fn provenance_name(provenance: Provenance) -> &'static str {
    match provenance {
        Provenance::Syntactic => "syntactic",
        Provenance::Semantic => "semantic",
        Provenance::Ai => "ai",
    }
}
