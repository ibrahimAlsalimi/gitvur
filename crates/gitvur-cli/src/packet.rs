//! `gitvur packet`: the documenting agent's work list.
//!
//! The packet tells the agent exactly what to (re)document, so it never has to infer it.
//! Built from a fresh index, the validator's report, and the current annotations.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::Context as _;
use gitvur_schema::{
    Annotations, EntryPoint, FlowState, NodeType, Report, SourceRange, Status, Structure, Trace,
};
use gitvur_validate::codes::{AI_EDGE_NO_EVIDENCE, SCHEMA_INVALID};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Every node except the project root.
    Initial,
    /// Only what changed or was never documented.
    Incremental,
}

/// What the agent must do with a todo item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    /// Write (or rewrite) the description and set `basedOnHash` to `contentHash`.
    Describe,
    /// Only a child changed: check the existing text still holds, keep it if so, and set
    /// `basedOnHash` to `contentHash`. Rewrite the text only if it is now wrong.
    Rehash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    File,
    Class,
    Function,
    Module,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub status: Status,
    pub action: Action,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModuleRef {
    pub id: String,
    pub name: String,
}

/// A flow the agent must update, with what the validator found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowWork {
    pub id: String,
    /// Steps whose `basedOnHash` no longer matches their node.
    pub stale_steps: Vec<String>,
    /// Every issue reported on the flow, errors first.
    pub issues: Vec<FlowIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FlowIssue {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Packet {
    pub mode: Mode,
    pub commit_sha: String,
    /// Sorted by `id`.
    pub todo: Vec<TodoItem>,
    /// File IDs that belong to no module, sorted.
    pub unassigned_files: Vec<String>,
    /// Modules with a valid ID, sorted by `id`.
    pub existing_modules: Vec<ModuleRef>,
    /// Extractor and agent entry points, sorted by `id`.
    pub entry_points: Vec<EntryPoint>,
    /// The deterministic trace (default limits) of each entry point, sorted by `start`.
    pub traces: Vec<Trace>,
    /// Incremental mode only: flows that are `stale` (and not broken), sorted by `id`.
    pub stale_flows: Vec<FlowWork>,
    /// Incremental mode only: flows that are `broken`, sorted by `id`.
    pub broken_flows: Vec<FlowWork>,
}

/// Builds the packet from already-computed inputs. `report` must come from validating the
/// same `structure` with the same `annotations`.
pub fn build(
    mode: Mode,
    structure: &Structure,
    report: &Report,
    annotations: Option<&Annotations>,
) -> Packet {
    let elements: BTreeMap<&str, &gitvur_schema::ElementStatus> =
        report.elements.iter().map(|e| (e.id.as_str(), e)).collect();
    let mut previous: BTreeMap<&str, &str> = BTreeMap::new();
    let mut modules: BTreeMap<&str, &str> = BTreeMap::new();
    let mut assigned: BTreeSet<&str> = BTreeSet::new();
    if let Some(a) = annotations {
        let hashes: BTreeMap<&str, &str> = structure
            .nodes
            .iter()
            .filter_map(|n| Some((n.id.as_str(), n.content_hash.as_deref()?)))
            .collect();
        for d in a.descriptions.iter().filter(|d| !d.text.trim().is_empty()) {
            // The description that matches the current hash wins; otherwise the first.
            let current = hashes.get(d.id.as_str()) == Some(&d.based_on_hash.as_str());
            if current || !previous.contains_key(d.id.as_str()) {
                previous.insert(d.id.as_str(), d.text.as_str());
            }
        }
        for m in &a.modules {
            // Only modules the validator accepted have an element in the report.
            if elements.contains_key(m.id.as_str()) {
                modules.entry(m.id.as_str()).or_insert(m.name.as_str());
                assigned.extend(m.files.iter().map(String::as_str));
            }
        }
    }

    let mut todo = Vec::new();
    for node in structure
        .nodes
        .iter()
        .filter(|n| n.node_type != NodeType::Project)
    {
        let Some(element) = elements.get(node.id.as_str()) else {
            continue;
        };
        let action = match (mode, element.status) {
            (Mode::Initial, _) | (Mode::Incremental, Status::Undocumented) => Action::Describe,
            (Mode::Incremental, Status::Stale) if element.self_changed == Some(true) => {
                Action::Describe
            }
            (Mode::Incremental, Status::Stale) => Action::Rehash,
            (Mode::Incremental, Status::Documented) => continue,
        };
        todo.push(TodoItem {
            id: node.id.clone(),
            item_type: match node.node_type {
                NodeType::File => ItemType::File,
                NodeType::Class => ItemType::Class,
                NodeType::Function | NodeType::Project => ItemType::Function,
            },
            status: element.status,
            action,
            source: node.source.clone(),
            content_hash: node.content_hash.clone(),
            previous_description: previous.get(node.id.as_str()).map(|t| (*t).to_owned()),
        });
    }
    for &id in modules.keys() {
        if elements
            .get(id)
            .is_some_and(|e| e.status == Status::Undocumented)
        {
            todo.push(TodoItem {
                id: id.to_owned(),
                item_type: ItemType::Module,
                status: Status::Undocumented,
                action: Action::Describe,
                source: None,
                content_hash: None,
                previous_description: None,
            });
        }
    }
    todo.sort_by(|a, b| a.id.cmp(&b.id));

    let unassigned_files = unassigned(structure, &assigned);
    let existing_modules = modules
        .into_iter()
        .map(|(id, name)| ModuleRef {
            id: id.into(),
            name: name.into(),
        })
        .collect();
    let (entry_points, traces) = entries_and_traces(structure, annotations);
    let (stale_flows, broken_flows) = match mode {
        Mode::Initial => (Vec::new(), Vec::new()),
        Mode::Incremental => flow_work(report),
    };
    Packet {
        mode,
        commit_sha: report.commit_sha.clone(),
        todo,
        unassigned_files,
        existing_modules,
        entry_points,
        traces,
        stale_flows,
        broken_flows,
    }
}

/// File IDs not in `assigned`, sorted and unique.
fn unassigned(structure: &Structure, assigned: &BTreeSet<&str>) -> Vec<String> {
    structure
        .nodes
        .iter()
        .filter(|n| n.node_type == NodeType::File && !assigned.contains(n.id.as_str()))
        .map(|n| n.id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// All entry points, and a trace for each. Agent entries whose ID an extractor entry
/// already uses are left out; the validator reports them as `entry-bad-id`.
fn entries_and_traces(
    structure: &Structure,
    annotations: Option<&Annotations>,
) -> (Vec<EntryPoint>, Vec<Trace>) {
    let mut merged = structure.clone();
    let static_ids: BTreeSet<&str> = structure
        .entry_points
        .iter()
        .map(|e| e.id.as_str())
        .collect();
    merged.entry_points.extend(
        annotations
            .into_iter()
            .flat_map(|a| &a.entry_points)
            .filter(|e| !static_ids.contains(e.id.as_str()))
            .cloned(),
    );
    merged.canonicalize();
    let options = gitvur_flow::TraceOptions::default();
    let mut ids: Vec<&str> = merged.entry_points.iter().map(|e| e.id.as_str()).collect();
    ids.dedup();
    let traces = ids
        .into_iter()
        .map(|id| gitvur_flow::trace(&merged, id, &options))
        .collect();
    (merged.entry_points.clone(), traces)
}

fn flow_work(report: &Report) -> (Vec<FlowWork>, Vec<FlowWork>) {
    let (mut stale, mut broken) = (Vec::new(), Vec::new());
    for flow in &report.flows {
        let work = FlowWork {
            id: flow.id.clone(),
            stale_steps: flow.stale_steps.clone(),
            issues: report
                .issues
                .iter()
                .filter(|i| i.id.as_deref() == Some(flow.id.as_str()))
                .map(|i| FlowIssue {
                    code: i.code.clone(),
                    message: i.message.clone(),
                })
                .collect(),
        };
        match flow.status {
            FlowState::Current => {}
            FlowState::Stale => stale.push(work),
            FlowState::Broken => broken.push(work),
        }
    }
    (stale, broken)
}

/// Indexes and validates `repo`, then builds its packet. Returns the packet and any
/// problems with `annotations.json` (the packet is still usable without annotations).
pub fn for_repo(repo: &Path, mode: Mode) -> anyhow::Result<(Packet, Vec<String>)> {
    let (report, input) = gitvur_validate::validate_repo_with_inputs(repo)
        .with_context(|| format!("validating {}", repo.display()))?;
    let problems = report
        .issues
        .iter()
        .filter(|i| i.code == SCHEMA_INVALID || i.code == AI_EDGE_NO_EVIDENCE)
        .map(|i| format!("{}: {}", i.code, i.message))
        .collect();
    Ok((
        build(mode, &input.structure, &report, input.annotations.as_ref()),
        problems,
    ))
}

#[cfg(test)]
mod tests {
    use gitvur_schema::{Description, ElementStatus, Module, Node, Summary};

    use super::*;

    fn node(id: &str, node_type: NodeType, hash: &str) -> Node {
        Node {
            id: id.into(),
            node_type,
            name: id.rsplit(':').next().unwrap().into(),
            parent_id: None,
            source: Some(SourceRange {
                file: "a.py".into(),
                start_line: 1,
                end_line: 2,
            }),
            content_hash: Some(hash.into()),
        }
    }

    fn element(id: &str, status: Status, flags: Option<(bool, bool)>) -> ElementStatus {
        ElementStatus {
            id: id.into(),
            status,
            child_changed: flags.map(|f| f.0),
            self_changed: flags.map(|f| f.1),
        }
    }

    fn fixture() -> (Structure, Report, Annotations) {
        let structure = Structure {
            entry_points: Vec::new(),
            nodes: vec![
                node("class:a.py:A", NodeType::Class, "h-class-new"),
                node("file:a.py", NodeType::File, "h-file-new"),
                node("file:b.py", NodeType::File, "h-b"),
                node("function:a.py:A.m", NodeType::Function, "h-m-new"),
                node("function:a.py:A.n", NodeType::Function, "h-n"),
                node("function:a.py:new", NodeType::Function, "h-new"),
            ],
            edges: vec![],
            unresolved_calls: vec![],
        };
        let report = Report {
            flows: Vec::new(),
            schema_version: "0.2".into(),
            commit_sha: "abc1234".into(),
            summary: Summary::default(),
            elements: vec![
                element("class:a.py:A", Status::Stale, Some((true, false))),
                element("file:a.py", Status::Stale, Some((true, false))),
                element("file:b.py", Status::Documented, None),
                element("function:a.py:A.m", Status::Stale, Some((false, true))),
                element("function:a.py:A.n", Status::Documented, None),
                element("function:a.py:new", Status::Undocumented, None),
                element("module:core", Status::Documented, None),
                element("module:empty", Status::Undocumented, None),
            ],
            issues: vec![],
        };
        let d = |id: &str, hash: &str| Description {
            id: id.into(),
            text: format!("About {id}."),
            based_on_hash: hash.into(),
        };
        let annotations = Annotations {
            entry_points: Vec::new(),
            flows: Vec::new(),
            modules: vec![
                Module {
                    id: "module:core".into(),
                    name: "Core".into(),
                    description: "Core.".into(),
                    files: vec!["file:a.py".into()],
                },
                Module {
                    id: "module:empty".into(),
                    name: "Empty".into(),
                    description: String::new(),
                    files: vec![],
                },
                Module {
                    id: "Bad Id".into(),
                    name: "Bad".into(),
                    description: "x".into(),
                    files: vec!["file:b.py".into()],
                },
            ],
            descriptions: vec![
                d("class:a.py:A", "h-class-old"),
                d("file:a.py", "h-file-old"),
                d("file:b.py", "h-b"),
                d("function:a.py:A.m", "h-m-old"),
                d("function:a.py:A.n", "h-n"),
            ],
            edges: vec![],
        };
        (structure, report, annotations)
    }

    #[test]
    fn incremental_lists_only_changed_and_undocumented() {
        let (structure, report, annotations) = fixture();
        let packet = build(Mode::Incremental, &structure, &report, Some(&annotations));
        let todo: Vec<(&str, Action)> = packet
            .todo
            .iter()
            .map(|t| (t.id.as_str(), t.action))
            .collect();
        assert_eq!(
            todo,
            [
                ("class:a.py:A", Action::Rehash),
                ("file:a.py", Action::Rehash),
                ("function:a.py:A.m", Action::Describe),
                ("function:a.py:new", Action::Describe),
                ("module:empty", Action::Describe),
            ]
        );
        let stale = &packet.todo[2];
        assert_eq!(stale.content_hash.as_deref(), Some("h-m-new"));
        assert_eq!(
            stale.previous_description.as_deref(),
            Some("About function:a.py:A.m.")
        );
        assert_eq!(packet.todo[3].previous_description, None);
        assert_eq!(
            packet.unassigned_files,
            ["file:b.py"],
            "a file only in an invalid module is unassigned"
        );
        assert_eq!(
            packet.existing_modules,
            [
                ModuleRef {
                    id: "module:core".into(),
                    name: "Core".into()
                },
                ModuleRef {
                    id: "module:empty".into(),
                    name: "Empty".into()
                }
            ]
        );
        assert_eq!(packet.commit_sha, "abc1234");
    }

    #[test]
    fn initial_lists_every_node_except_root() {
        let (structure, report, annotations) = fixture();
        let packet = build(Mode::Initial, &structure, &report, Some(&annotations));
        let ids: Vec<&str> = packet.todo.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "class:a.py:A",
                "file:a.py",
                "file:b.py",
                "function:a.py:A.m",
                "function:a.py:A.n",
                "function:a.py:new",
                "module:empty"
            ]
        );
        assert!(packet.todo.iter().all(|t| t.action == Action::Describe));
    }

    #[test]
    fn without_annotations_every_file_is_unassigned() {
        let (structure, mut report, _) = fixture();
        report.elements.retain(|e| !e.id.starts_with("module:"));
        let packet = build(Mode::Incremental, &structure, &report, None);
        assert_eq!(packet.unassigned_files, ["file:a.py", "file:b.py"]);
        assert_eq!(packet.existing_modules, []);
    }

    #[test]
    fn lists_entries_traces_and_flows_needing_work() {
        use gitvur_schema::{
            EntryKind, Evidence, FlowStatus, Issue, Provenance, Severity, TraceKind,
        };
        let (mut structure, mut report, mut annotations) = fixture();
        let entry = |id: &str, kind, target: &str, calls: Vec<String>, provenance| EntryPoint {
            id: id.into(),
            kind,
            name: id.into(),
            target: Some(target.into()),
            raw: None,
            calls,
            evidence: Some(Evidence {
                file: "a.py".into(),
                line: 1,
            }),
            provenance,
        };
        structure.entry_points.push(entry(
            "entry:main-guard:a-py",
            EntryKind::MainGuard,
            "file:a.py",
            vec!["function:a.py:new".into()],
            Provenance::Syntactic,
        ));
        annotations.entry_points.push(entry(
            "entry:job:nightly",
            EntryKind::Job,
            "function:a.py:A.n",
            Vec::new(),
            Provenance::Ai,
        ));
        let status = |id: &str, status, steps: &[&str]| FlowStatus {
            id: id.into(),
            status,
            stale_steps: steps.iter().map(|s| (*s).into()).collect(),
        };
        report.flows = vec![
            status("flow:broken", FlowState::Broken, &[]),
            status("flow:fine", FlowState::Current, &[]),
            status("flow:old", FlowState::Stale, &["s2"]),
        ];
        report.issues.push(Issue {
            severity: Severity::Error,
            code: "flow-dangling-step".into(),
            message: "gone".into(),
            id: Some("flow:broken".into()),
        });

        let packet = build(Mode::Incremental, &structure, &report, Some(&annotations));
        let ids: Vec<&str> = packet.entry_points.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["entry:job:nightly", "entry:main-guard:a-py"]);
        let starts: Vec<&str> = packet.traces.iter().map(|t| t.start.as_str()).collect();
        assert_eq!(starts, ids);
        let roots = |t: &Trace| -> Vec<Option<String>> {
            t.nodes
                .iter()
                .filter(|n| n.depth == 0 && n.kind == TraceKind::Node)
                .map(|n| n.node.clone())
                .collect()
        };
        assert_eq!(roots(&packet.traces[0]), [Some("function:a.py:A.n".into())]);
        assert_eq!(roots(&packet.traces[1]), [Some("function:a.py:new".into())]);
        assert_eq!(
            packet.stale_flows,
            [FlowWork {
                id: "flow:old".into(),
                stale_steps: vec!["s2".into()],
                issues: Vec::new(),
            }]
        );
        assert_eq!(
            packet.broken_flows,
            [FlowWork {
                id: "flow:broken".into(),
                stale_steps: Vec::new(),
                issues: vec![FlowIssue {
                    code: "flow-dangling-step".into(),
                    message: "gone".into(),
                }],
            }]
        );

        let initial = build(Mode::Initial, &structure, &report, Some(&annotations));
        assert_eq!(initial.traces.len(), 2);
        assert!(initial.stale_flows.is_empty() && initial.broken_flows.is_empty());
    }

    #[test]
    fn serialises_in_contract_spelling() {
        let (structure, report, annotations) = fixture();
        let json = gitvur_schema::to_canonical_json(&build(
            Mode::Incremental,
            &structure,
            &report,
            Some(&annotations),
        ));
        assert!(json.starts_with(
            "{\n  \"mode\": \"incremental\",\n  \"commitSha\": \"abc1234\",\n  \"todo\": ["
        ));
        assert!(json.contains("\"previousDescription\""));
        assert!(json.contains("\"unassignedFiles\""));
        assert!(json.contains("\"existingModules\""));
        assert!(json.contains("\"action\": \"rehash\""));
        for key in ["entryPoints", "traces", "staleFlows", "brokenFlows"] {
            assert!(json.contains(&format!("\"{key}\"")), "{key}");
        }
    }
}
