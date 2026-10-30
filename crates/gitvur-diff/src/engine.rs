//! The diff engine: element classification, `childChanged`, edge changes.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use gitvur_schema::{
    ChangeKind, DiffSummary, Edge, EdgeChange, EdgeType, ElementChange, Node, NodeType,
    SCHEMA_VERSION, Structure, StructureDiff, tree,
};

/// Compares structure `a` (older) with `b` (newer). Pure and deterministic; the caller
/// fills in `from_commit` / `to_commit`.
///
/// The project node is not an element (it has no hash) and is left out.
pub fn diff(a: &Structure, b: &Structure) -> StructureDiff {
    let nodes_a = elements(a);
    let nodes_b = elements(b);
    let only_a: Vec<&str> = nodes_a
        .keys()
        .filter(|id| !nodes_b.contains_key(*id))
        .copied()
        .collect();
    let only_b: BTreeSet<&str> = nodes_b
        .keys()
        .filter(|id| !nodes_a.contains_key(*id))
        .copied()
        .collect();

    let moved = pair_moves(&nodes_a, &nodes_b, &only_a, &only_b);
    let moved_to: BTreeMap<&str, &str> = moved.iter().map(|(a, b)| (*b, *a)).collect(); // B -> A

    let mut kind_b: BTreeMap<&str, ChangeKind> = BTreeMap::new();
    for (&id, node) in &nodes_b {
        let kind = match nodes_a.get(id) {
            Some(old) if old.content_hash == node.content_hash => ChangeKind::Unchanged,
            Some(_) => ChangeKind::Modified,
            None if moved_to.contains_key(id) => ChangeKind::Moved,
            None => ChangeKind::Added,
        };
        kind_b.insert(id, kind);
    }
    let removed: BTreeSet<&str> = only_a
        .iter()
        .filter(|id| !moved.contains_key(*id))
        .copied()
        .collect();

    // A child counts as changed on either side: added, modified or moved in B; removed,
    // moved away or modified in A.
    let children_a = tree::children_by_parent(&a.nodes);
    let children_b = tree::children_by_parent(&b.nodes);
    let changed_b = |id: &str| kind_b.get(id).is_some_and(|k| *k != ChangeKind::Unchanged);
    let changed_a = |id: &str| {
        moved.contains_key(id)
            || removed.contains(id)
            || kind_b.get(id) == Some(&ChangeKind::Modified)
    };
    let child_changed = |id: &str| {
        tree::child_changed(&children_b, id, changed_b)
            || tree::child_changed(&children_a, id, changed_a)
    };

    let mut summary = DiffSummary::default();
    let mut changes = Vec::new();
    for (&id, &kind) in &kind_b {
        let node = nodes_b[id];
        let flag = child_changed(id);
        match kind {
            ChangeKind::Unchanged => {
                summary.unchanged += 1;
                if flag {
                    changes.push(change(node, kind, None, Some(true)));
                }
            }
            ChangeKind::Modified => {
                summary.modified += 1;
                changes.push(change(node, kind, None, Some(flag)));
            }
            ChangeKind::Moved => {
                summary.moved += 1;
                let from = moved_to.get(id).map(|from| (*from).to_owned());
                changes.push(change(node, kind, from, None));
            }
            ChangeKind::Added | ChangeKind::Removed => {
                summary.added += 1;
                changes.push(change(node, ChangeKind::Added, None, None));
            }
        }
    }
    for id in &removed {
        summary.removed += 1;
        changes.push(change(nodes_a[id], ChangeKind::Removed, None, None));
    }

    let edges = edge_changes(a, b, &moved, &mut summary);

    let mut out = StructureDiff {
        schema_version: SCHEMA_VERSION.into(),
        from_commit: String::new(),
        to_commit: String::new(),
        elements: changes,
        edges,
        summary,
    };
    out.canonicalize();
    out
}

/// Moves: an A-only ID paired with a B-only ID of identical hash. Candidates are taken in
/// ID order on both sides, greedily. Returns A ID -> B ID.
fn pair_moves<'a>(
    nodes_a: &BTreeMap<&'a str, &'a Node>,
    nodes_b: &BTreeMap<&'a str, &'a Node>,
    only_a: &[&'a str],
    only_b: &BTreeSet<&'a str>,
) -> BTreeMap<&'a str, &'a str> {
    let mut by_hash: BTreeMap<&str, VecDeque<&str>> = BTreeMap::new();
    for &id in only_b {
        if let Some(hash) = nodes_b[id].content_hash.as_deref() {
            by_hash.entry(hash).or_default().push_back(id);
        }
    }
    let mut moved = BTreeMap::new();
    for &id in only_a {
        let Some(hash) = nodes_a[id].content_hash.as_deref() else {
            continue;
        };
        if let Some(target) = by_hash.get_mut(hash).and_then(VecDeque::pop_front) {
            moved.insert(id, target);
        }
    }
    moved
}

/// Edges keyed by `(from, to, type)`, A's endpoints mapped through the moves.
fn edge_changes(
    a: &Structure,
    b: &Structure,
    moved: &BTreeMap<&str, &str>,
    summary: &mut DiffSummary,
) -> Vec<EdgeChange> {
    let map = |id: &str| {
        moved
            .get(id)
            .map_or_else(|| id.to_owned(), |to| (*to).to_owned())
    };
    let mut keys_a: BTreeMap<(String, String, EdgeType), &Edge> = BTreeMap::new();
    for e in &a.edges {
        keys_a
            .entry((map(&e.from), map(&e.to), e.edge_type))
            .or_insert(e);
    }
    let mut keys_b: BTreeMap<(String, String, EdgeType), &Edge> = BTreeMap::new();
    for e in &b.edges {
        keys_b
            .entry((e.from.clone(), e.to.clone(), e.edge_type))
            .or_insert(e);
    }
    let mut edges = Vec::new();
    for (key, e) in &keys_b {
        if !keys_a.contains_key(key) {
            summary.edges_added += 1;
            edges.push(edge_change(key, ChangeKind::Added, e));
        }
    }
    for (key, e) in &keys_a {
        if !keys_b.contains_key(key) {
            summary.edges_removed += 1;
            edges.push(edge_change(key, ChangeKind::Removed, e));
        }
    }
    edges
}

fn elements(s: &Structure) -> BTreeMap<&str, &Node> {
    s.nodes
        .iter()
        .filter(|n| n.node_type != NodeType::Project)
        .map(|n| (n.id.as_str(), n))
        .collect()
}

fn change(
    node: &Node,
    change: ChangeKind,
    moved_from: Option<String>,
    child_changed: Option<bool>,
) -> ElementChange {
    ElementChange {
        id: node.id.clone(),
        node_type: node.node_type,
        change,
        moved_from,
        child_changed,
    }
}

fn edge_change(key: &(String, String, EdgeType), change: ChangeKind, edge: &Edge) -> EdgeChange {
    EdgeChange {
        from: key.0.clone(),
        to: key.1.clone(),
        edge_type: key.2,
        change,
        provenance: edge.provenance,
        evidence: edge.evidence.clone(),
    }
}
