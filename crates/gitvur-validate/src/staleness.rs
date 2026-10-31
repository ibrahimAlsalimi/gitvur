//! Per-element documentation status.

use std::collections::{BTreeMap, BTreeSet};

use gitvur_schema::{Annotations, Description, ElementStatus, NodeType, Status, Structure, tree};

use crate::checks::is_module_id;

/// One status per structure node (except the project), per valid module, and per entry
/// point (extractor or agent): an entry is `documented` when some flow starts from it.
pub(crate) fn elements(
    structure: &Structure,
    annotations: Option<&Annotations>,
) -> Vec<ElementStatus> {
    let mut descriptions: BTreeMap<&str, Vec<&Description>> = BTreeMap::new();
    for d in annotations.into_iter().flat_map(|a| &a.descriptions) {
        if !d.text.trim().is_empty() {
            descriptions.entry(d.id.as_str()).or_default().push(d);
        }
    }

    let mut status: BTreeMap<&str, Status> = BTreeMap::new();
    for node in structure
        .nodes
        .iter()
        .filter(|n| n.node_type != NodeType::Project)
    {
        let s = match (descriptions.get(node.id.as_str()), &node.content_hash) {
            (None, _) => Status::Undocumented,
            (Some(ds), Some(hash)) if ds.iter().any(|d| &d.based_on_hash == hash) => {
                Status::Documented
            }
            (Some(_), _) => Status::Stale,
        };
        status.insert(node.id.as_str(), s);
    }

    let children = tree::children_by_parent(&structure.nodes);

    let mut elements: Vec<ElementStatus> = status
        .iter()
        .map(|(&id, &s)| {
            let (child_changed, self_changed) = if s == Status::Stale {
                let child =
                    tree::child_changed(&children, id, |c| status.get(c) == Some(&Status::Stale));
                (Some(child), Some(!child))
            } else {
                (None, None)
            };
            ElementStatus {
                id: id.to_owned(),
                status: s,
                child_changed,
                self_changed,
            }
        })
        .collect();

    let mut modules: BTreeMap<&str, bool> = BTreeMap::new();
    for m in annotations
        .into_iter()
        .flat_map(|a| &a.modules)
        .filter(|m| is_module_id(&m.id))
    {
        *modules.entry(m.id.as_str()).or_default() |= !m.description.trim().is_empty();
    }
    elements.extend(modules.into_iter().map(|(id, documented)| ElementStatus {
        id: id.to_owned(),
        status: if documented {
            Status::Documented
        } else {
            Status::Undocumented
        },
        child_changed: None,
        self_changed: None,
    }));

    let flow_entries: BTreeSet<&str> = annotations
        .into_iter()
        .flat_map(|a| &a.flows)
        .map(|f| f.entry_point.as_str())
        .collect();
    let entries: BTreeSet<&str> = structure
        .entry_points
        .iter()
        .chain(annotations.into_iter().flat_map(|a| &a.entry_points))
        .map(|e| e.id.as_str())
        .collect();
    elements.extend(entries.into_iter().map(|id| ElementStatus {
        id: id.to_owned(),
        status: if flow_entries.contains(id) {
            Status::Documented
        } else {
            Status::Undocumented
        },
        child_changed: None,
        self_changed: None,
    }));
    elements
}
