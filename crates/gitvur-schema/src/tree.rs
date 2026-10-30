//! Tree helpers over `structure.json` nodes, shared by the validator and the diff.

use std::collections::BTreeMap;

use crate::Node;

/// Direct children by parent ID, in node order.
pub fn children_by_parent(nodes: &[Node]) -> BTreeMap<&str, Vec<&str>> {
    let mut children: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for node in nodes {
        if let Some(parent) = &node.parent_id {
            children
                .entry(parent.as_str())
                .or_default()
                .push(node.id.as_str());
        }
    }
    children
}

/// `childChanged`: whether any direct child of `id` is changed by `is_changed`.
///
/// The validator calls it with "child is stale"; the diff with "child is not unchanged".
pub fn child_changed(
    children: &BTreeMap<&str, Vec<&str>>,
    id: &str,
    is_changed: impl Fn(&str) -> bool,
) -> bool {
    children
        .get(id)
        .is_some_and(|cs| cs.iter().any(|c| is_changed(c)))
}
