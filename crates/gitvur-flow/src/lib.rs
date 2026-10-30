//! Deterministic breadth-first traces. No I/O and no inferred relationships.
use gitvur_schema::{
    EdgeType, Node, NodeType, Provenance, Structure, Trace, TraceKind, TraceNode, UnresolvedCall,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraceOptions {
    pub max_depth: u32,
    pub max_nodes: u32,
    pub include_semantic: bool,
}
impl Default for TraceOptions {
    fn default() -> Self {
        Self {
            max_depth: 6,
            max_nodes: 300,
            include_semantic: false,
        }
    }
}

struct Graph<'a> {
    nodes: BTreeMap<&'a str, &'a Node>,
    calls: BTreeMap<&'a str, Vec<&'a str>>,
    ambiguous: BTreeMap<&'a str, Vec<&'a UnresolvedCall>>,
}
impl<'a> Graph<'a> {
    fn new(structure: &'a Structure, semantic: bool) -> Self {
        let nodes: BTreeMap<_, _> = structure.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
        let mut calls: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for edge in &structure.edges {
            if edge.edge_type == EdgeType::Calls
                && (edge.provenance == Provenance::Syntactic
                    || (semantic && edge.provenance == Provenance::Semantic))
                && nodes.contains_key(edge.to.as_str())
            {
                calls
                    .entry(edge.from.as_str())
                    .or_default()
                    .push(edge.to.as_str());
            }
        }
        let mut ambiguous: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for call in &structure.unresolved_calls {
            ambiguous.entry(call.from.as_str()).or_default().push(call);
        }
        let mut graph = Self {
            nodes,
            calls,
            ambiguous,
        };
        for children in graph.calls.values_mut() {
            children.sort_by_key(|id| node_key(graph.nodes[id]));
            children.dedup();
        }
        for sites in graph.ambiguous.values_mut() {
            sites.sort_by_key(|c| (&c.evidence.file, c.evidence.line, &c.name, &c.candidates));
            sites.dedup();
        }
        graph
    }
    fn children(&self, id: &'a str) -> Vec<Child<'a>> {
        let mut children: Vec<_> = self
            .calls
            .get(id)
            .into_iter()
            .flatten()
            .map(|id| Child::Node(id))
            .collect();
        children.extend(
            self.ambiguous
                .get(id)
                .into_iter()
                .flatten()
                .map(|call| Child::Ambiguous(call)),
        );
        children.sort_by_key(|child| match child {
            Child::Node(id) => {
                let (file, line, id) = node_key(self.nodes[id]);
                (file, line, 0, id)
            }
            Child::Ambiguous(c) => (
                c.evidence.file.as_str(),
                c.evidence.line,
                1,
                c.name.as_str(),
            ),
        });
        children
    }
}
fn node_key(node: &Node) -> (&str, u32, &str) {
    node.source.as_ref().map_or(("", 0, node.id.as_str()), |s| {
        (&s.file, s.start_line, &node.id)
    })
}
#[derive(Clone, Copy)]
enum Child<'a> {
    Node(&'a str),
    Ambiguous(&'a UnresolvedCall),
}

struct Builder<'a> {
    graph: Graph<'a>,
    output: Trace,
    parents: Vec<Option<usize>>,
    first: BTreeMap<&'a str, usize>,
    queue: VecDeque<usize>,
    opts: TraceOptions,
}
impl<'a> Builder<'a> {
    fn ancestor(&self, mut parent: Option<usize>, id: &str) -> bool {
        while let Some(index) = parent {
            if self.output.nodes[index].node.as_deref() == Some(id) {
                return true;
            }
            parent = self.parents[index];
        }
        false
    }
    fn add(&mut self, child: Child<'a>, parent: Option<usize>) -> String {
        let index = self.output.nodes.len();
        let id = format!("trace:{}", index + 1);
        let depth = parent.map_or(0, |p| self.output.nodes[p].depth + 1);
        let mut item = TraceNode {
            id: id.clone(),
            kind: TraceKind::Node,
            node: None,
            name: String::new(),
            depth,
            children: Vec::new(),
            reference: None,
            candidates: Vec::new(),
            evidence: None,
            truncated: false,
            hidden_children: 0,
        };
        match child {
            Child::Node(target) => {
                item.node = Some(target.into());
                item.name.clone_from(&self.graph.nodes[target].name);
                if let Some(&first) = self.first.get(target) {
                    item.kind = if self.ancestor(parent, target) {
                        TraceKind::Cycle
                    } else {
                        TraceKind::Ref
                    };
                    item.reference = Some(self.output.nodes[first].id.clone());
                } else {
                    self.first.insert(target, index);
                    self.queue.push_back(index);
                }
            }
            Child::Ambiguous(call) => {
                item.kind = TraceKind::Ambiguous;
                item.name.clone_from(&call.name);
                item.evidence = Some(call.evidence.clone());
                item.candidates = call
                    .candidates
                    .iter()
                    .cloned()
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
            }
        }
        self.parents.push(parent);
        self.output.nodes.push(item);
        id
    }
    fn expand(&mut self) {
        while let Some(index) = self.queue.pop_front() {
            let target = self.output.nodes[index]
                .node
                .as_deref()
                .unwrap_or_default()
                .to_owned();
            let children = self
                .graph
                .children(self.graph.nodes[target.as_str()].id.as_str());
            let allowed = if self.output.nodes[index].depth >= self.opts.max_depth {
                0
            } else {
                (self.opts.max_nodes as usize).saturating_sub(self.output.nodes.len())
            };
            let hidden = children.len().saturating_sub(allowed);
            for child in children.into_iter().take(allowed) {
                let id = self.add(child, Some(index));
                self.output.nodes[index].children.push(id);
            }
            self.output.nodes[index].hidden_children = hidden;
            self.output.nodes[index].truncated = hidden > 0;
            self.output.truncated |= hidden > 0;
        }
    }
}

/// Traces a node or static/merged entry ID. Unknown IDs set `Trace.error`.
/// Limits count all occurrences (including stubs); roots have depth zero.
pub fn trace(structure: &Structure, start: &str, opts: &TraceOptions) -> Trace {
    let graph = Graph::new(structure, opts.include_semantic);
    let mut roots = Vec::new();
    let mut known = false;
    if let Some(entry) = structure.entry_points.iter().find(|e| e.id == start) {
        known = true;
        let mut ids: BTreeSet<_> = entry
            .calls
            .iter()
            .map(String::as_str)
            .filter(|id| graph.nodes.contains_key(id))
            .collect();
        if let Some(target) = entry.target.as_deref().filter(|id| {
            graph
                .nodes
                .get(id)
                .is_some_and(|n| n.node_type == NodeType::Function)
        }) {
            ids.insert(target);
        }
        let mut ids: Vec<_> = ids.into_iter().collect();
        ids.sort_by_key(|id| node_key(graph.nodes[id]));
        roots.extend(ids.into_iter().map(Child::Node));
        roots.extend(
            graph
                .ambiguous
                .get(start)
                .into_iter()
                .flatten()
                .map(|c| Child::Ambiguous(c)),
        );
    } else if let Some(node) = graph.nodes.get(start) {
        known = true;
        roots.push(Child::Node(&node.id));
    }
    let mut builder = Builder {
        graph,
        output: Trace {
            start: start.into(),
            roots: Vec::new(),
            nodes: Vec::new(),
            truncated: false,
            hidden_roots: roots.len().saturating_sub(opts.max_nodes as usize),
            error: (!known).then(|| format!("unknown entry or node: {start}")),
        },
        parents: Vec::new(),
        first: BTreeMap::new(),
        queue: VecDeque::new(),
        opts: *opts,
    };
    builder.output.truncated = builder.output.hidden_roots > 0;
    for root in roots.into_iter().take(opts.max_nodes as usize) {
        let id = builder.add(root, None);
        builder.output.roots.push(id);
    }
    builder.expand();
    builder.output
}
