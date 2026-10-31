//! Entry point and flow validation on a temporary copy of `fixtures/py-flows`.

use std::fs;
use std::path::{Path, PathBuf};

use gitvur_index::{IndexOptions, index, write_output};
use gitvur_schema::{
    Annotations, EntryKind, EntryPoint, Evidence, Flow, FlowState, FlowStatus, FlowStep,
    FlowTransition, Module, NodeType, Provenance, Report, Severity, Status, Structure,
    TransitionKind, to_canonical_json,
};
use gitvur_validate::{codes, stale_ids, validate_repo};

struct Scenario {
    dir: tempfile::TempDir,
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".gitvur" || name == "expected" {
            continue;
        }
        let target = to.join(name);
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

impl Scenario {
    /// py-flows with a fresh structure and the annotations from [`annotations`].
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/py-flows");
        copy_dir(&fixture, dir.path());
        let s = Self { dir };
        s.reindex();
        s.write(&annotations(&s.structure()));
        s
    }

    fn root(&self) -> PathBuf {
        self.dir.path().canonicalize().unwrap()
    }

    fn structure(&self) -> Structure {
        let options = IndexOptions {
            generated_at: "t".into(),
        };
        index(&self.root(), &options).unwrap().structure
    }

    fn reindex(&self) {
        let options = IndexOptions {
            generated_at: "t".into(),
        };
        let out = index(&self.root(), &options).unwrap();
        write_output(&self.root().join(".gitvur"), &out).unwrap();
    }

    fn write(&self, annotations: &Annotations) {
        fs::write(
            self.root().join(".gitvur/annotations.json"),
            to_canonical_json(annotations),
        )
        .unwrap();
    }

    fn update(&self, f: impl FnOnce(&mut Annotations)) {
        let mut a = annotations(&self.structure());
        f(&mut a);
        self.write(&a);
    }

    fn edit(&self, relpath: &str, old: &str, new: &str) {
        let path = self.root().join(relpath);
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains(old), "{relpath} has no `{old}`");
        fs::write(path, text.replacen(old, new, 1)).unwrap();
    }

    fn validate(&self) -> Report {
        validate_repo(&self.root()).unwrap()
    }
}

fn hash(structure: &Structure, id: &str) -> String {
    let node = structure.nodes.iter().find(|n| n.id == id).unwrap();
    node.content_hash.clone().unwrap()
}

fn step(structure: &Structure, id: &str, node: &str, label: &str) -> FlowStep {
    FlowStep {
        id: id.into(),
        node: node.into(),
        label: label.into(),
        based_on_hash: hash(structure, node),
    }
}

fn transition(from: &str, to: &str, kind: TransitionKind) -> FlowTransition {
    FlowTransition {
        from: from.into(),
        to: to.into(),
        kind,
        label: None,
        provenance: Provenance::Syntactic,
        evidence: None,
    }
}

fn ai(mut t: FlowTransition, label: Option<&str>, file: &str, line: u32) -> FlowTransition {
    t.provenance = Provenance::Ai;
    t.label = label.map(str::to_owned);
    t.evidence = Some(Evidence {
        file: file.into(),
        line,
    });
    t
}

const SUBMIT: &str = "function:flowapp/service/orders.py:submit";

/// One module, an HTTP route entry, and three valid flows:
/// - `flow:cli-order`: main → submit → validate (and back), plus the `saved` event;
/// - `flow:self-check`: the backends main guard branching into `Cache.save`;
/// - `flow:http-order`: the route handler alone.
fn annotations(structure: &Structure) -> Annotations {
    let files = structure
        .nodes
        .iter()
        .filter(|n| n.node_type == NodeType::File)
        .map(|n| n.id.clone())
        .collect();
    let s = |id, node, label| step(structure, id, node, label);
    Annotations {
        modules: vec![Module {
            id: "module:app".into(),
            name: "App".into(),
            description: "Everything.".into(),
            files,
        }],
        descriptions: Vec::new(),
        edges: Vec::new(),
        entry_points: vec![EntryPoint {
            id: "entry:http-route:post-orders".into(),
            kind: EntryKind::HttpRoute,
            name: "POST /orders".into(),
            target: Some("function:flowapp/api.py:handle".into()),
            raw: None,
            calls: Vec::new(),
            evidence: Some(Evidence {
                file: "flowapp/api.py".into(),
                line: 8,
            }),
            provenance: Provenance::Ai,
        }],
        flows: vec![
            Flow {
                id: "flow:cli-order".into(),
                name: "CLI places an order".into(),
                description: "From the console script to the saved event.".into(),
                entry_point: "entry:console-script:flow-shop".into(),
                steps: vec![
                    s("s1", "function:flowapp/cli.py:main", "Starts an order"),
                    s("s2", SUBMIT, "Coordinates the order"),
                    s(
                        "s3",
                        "function:flowapp/domain/rules.py:validate",
                        "Checks it",
                    ),
                    s(
                        "s4",
                        "function:flowapp/storage/events.py:on_saved",
                        "Notifies",
                    ),
                ],
                transitions: vec![
                    transition("s1", "s2", TransitionKind::Call),
                    transition("s2", "s3", TransitionKind::Call),
                    transition("s3", "s2", TransitionKind::Return),
                    ai(
                        transition("s2", "s4", TransitionKind::Event),
                        Some("saved"),
                        "flowapp/service/orders.py",
                        7,
                    ),
                ],
            },
            Flow {
                id: "flow:self-check".into(),
                name: "Backends self-check".into(),
                description: "Running the backends module directly.".into(),
                entry_point: "entry:main-guard:flowapp-backends-py".into(),
                steps: vec![
                    s("s1", "file:flowapp/backends.py", "Creates a cache sink"),
                    s("s2", "function:flowapp/backends.py:Cache.save", "Saves"),
                ],
                transitions: vec![ai(
                    transition("s1", "s2", TransitionKind::Branch),
                    Some("when run as a script"),
                    "flowapp/backends.py",
                    23,
                )],
            },
            Flow {
                id: "flow:http-order".into(),
                name: "HTTP order".into(),
                description: "The route handler.".into(),
                entry_point: "entry:http-route:post-orders".into(),
                steps: vec![s("s1", "function:flowapp/api.py:handle", "Receives")],
                transitions: Vec::new(),
            },
        ],
    }
}

/// `(severity, code, id)` of entry and flow issues.
fn flow_issues(report: &Report) -> Vec<(Severity, &str, &str)> {
    report
        .issues
        .iter()
        .filter(|i| i.code.starts_with("entry-") || i.code.starts_with("flow-"))
        .map(|i| (i.severity, i.code.as_str(), i.id.as_deref().unwrap_or("")))
        .collect()
}

fn flow<'a>(report: &'a Report, id: &str) -> &'a FlowStatus {
    report.flows.iter().find(|f| f.id == id).unwrap()
}

fn status(report: &Report, id: &str) -> Status {
    report.elements.iter().find(|e| e.id == id).unwrap().status
}

fn current(id: &str) -> FlowStatus {
    FlowStatus {
        id: id.into(),
        status: FlowState::Current,
        stale_steps: Vec::new(),
    }
}

#[test]
fn valid_flows_are_current_and_entries_documented_by_flows() {
    let s = Scenario::new();
    let report = s.validate();
    assert_eq!(report.issues, [], "{:?}", report.issues);
    assert_eq!(
        report.flows,
        [
            current("flow:cli-order"),
            current("flow:http-order"),
            current("flow:self-check")
        ]
    );
    for documented in [
        "entry:console-script:flow-shop",
        "entry:http-route:post-orders",
        "entry:main-guard:flowapp-backends-py",
    ] {
        assert_eq!(
            status(&report, documented),
            Status::Documented,
            "{documented}"
        );
    }
    assert_eq!(
        status(&report, "entry:package-main:flowapp"),
        Status::Undocumented
    );
    assert!(
        stale_ids(&report)
            .iter()
            .all(|id| !id.starts_with("entry:")),
        "entries without flows are not documentation work"
    );
    assert_eq!(
        report.summary.undocumented,
        u32::try_from(
            report
                .elements
                .iter()
                .filter(|e| e.status == Status::Undocumented && !e.id.starts_with("entry:"))
                .count()
        )
        .unwrap(),
        "summary counts exclude entry points"
    );
    assert_eq!(
        to_canonical_json(&report),
        to_canonical_json(&s.validate()),
        "deterministic"
    );
}

type Mutation = fn(&mut Annotations);

fn entry(a: &mut Annotations) -> &mut EntryPoint {
    &mut a.entry_points[0]
}

fn cli(a: &mut Annotations) -> &mut Flow {
    &mut a.flows[0]
}

fn event(a: &mut Annotations) -> &mut FlowTransition {
    &mut a.flows[0].transitions[3]
}

type Case = (Severity, &'static str, &'static str, Mutation);

fn entry_cases() -> Vec<Case> {
    use Severity::{Error, Warning};
    vec![
        (
            Error,
            codes::ENTRY_DANGLING_TARGET,
            "entry:http-route:post-orders",
            |a| {
                entry(a).target = Some("function:flowapp/api.py:missing".into());
            },
        ),
        (
            Error,
            codes::ENTRY_DANGLING_TARGET,
            "entry:http-route:post-orders",
            |a| {
                entry(a).calls = vec!["function:nowhere.py:f".into()];
            },
        ),
        (
            Error,
            codes::ENTRY_NO_EVIDENCE,
            "entry:http-route:post-orders",
            |a| {
                entry(a).evidence = None;
            },
        ),
        (
            Warning,
            codes::ENTRY_DUPLICATES_STATIC,
            "entry:console-script:shop",
            |a| {
                a.entry_points.push(EntryPoint {
                    id: "entry:console-script:shop".into(),
                    kind: EntryKind::ConsoleScript,
                    name: "flow-shop".into(),
                    target: Some("function:flowapp/cli.py:main".into()),
                    raw: None,
                    calls: Vec::new(),
                    evidence: Some(Evidence {
                        file: "pyproject.toml".into(),
                        line: 6,
                    }),
                    provenance: Provenance::Ai,
                });
            },
        ),
        (Error, codes::ENTRY_BAD_ID, "entry:job:post-orders", |a| {
            entry(a).id = "entry:job:post-orders".into();
            cli(a).entry_point = "entry:job:post-orders".into();
        }),
        (
            Error,
            codes::ENTRY_BAD_ID,
            "entry:console-script:flow-shop",
            |a| {
                let e = entry(a);
                e.id = "entry:console-script:flow-shop".into();
                e.kind = EntryKind::ConsoleScript;
            },
        ),
        (
            Error,
            codes::ENTRY_BAD_PROVENANCE,
            "entry:http-route:post-orders",
            |a| {
                entry(a).provenance = Provenance::Syntactic;
            },
        ),
        (
            Error,
            codes::ENTRY_EVIDENCE_OUT_OF_RANGE,
            "entry:http-route:post-orders",
            |a| {
                entry(a).evidence.as_mut().unwrap().line = 99;
            },
        ),
        (
            Error,
            codes::ENTRY_EVIDENCE_OUT_OF_RANGE,
            "entry:http-route:post-orders",
            |a| {
                entry(a).evidence.as_mut().unwrap().file = "../outside.py".into();
            },
        ),
        (
            Warning,
            codes::ENTRY_EVIDENCE_MISMATCH,
            "entry:http-route:post-orders",
            |a| {
                entry(a).evidence.as_mut().unwrap().line = 1;
            },
        ),
    ]
}

fn flow_cases() -> Vec<Case> {
    use Severity::Error;
    vec![
        (Error, codes::FLOW_BAD_ID, "flow:Bad", |a| {
            cli(a).id = "flow:Bad".into();
        }),
        (Error, codes::FLOW_BAD_ID, "flow:http-order", |a| {
            let copy = a.flows[2].clone();
            a.flows.push(copy);
        }),
        (Error, codes::FLOW_DANGLING_ENTRY, "flow:cli-order", |a| {
            cli(a).entry_point = "entry:job:none".into();
        }),
        (Error, codes::FLOW_DANGLING_STEP, "flow:cli-order", |a| {
            cli(a).steps[2].node = "function:flowapp/domain/rules.py:gone".into();
        }),
        (Error, codes::FLOW_DANGLING_STEP, "flow:cli-order", |a| {
            cli(a).steps[2].node = "project:root".into();
        }),
        (
            Error,
            codes::FLOW_DUPLICATE_STEP_ID,
            "flow:cli-order",
            |a| {
                cli(a).steps[3].id = "s3".into();
            },
        ),
        (
            Error,
            codes::FLOW_BAD_TRANSITION_REF,
            "flow:cli-order",
            |a| {
                cli(a).transitions[1].to = "s9".into();
            },
        ),
    ]
}

fn transition_cases() -> Vec<Case> {
    use Severity::{Error, Warning};
    vec![
        (Error, codes::FLOW_CALL_UNSUPPORTED, "flow:cli-order", |a| {
            cli(a).transitions[1].from = "s1".into(); // main does not call validate
        }),
        (Error, codes::FLOW_CALL_UNSUPPORTED, "flow:cli-order", |a| {
            let e = event(a); // a static event needs a call edge too
            e.provenance = Provenance::Syntactic;
            e.evidence = None;
        }),
        (
            Error,
            codes::FLOW_RETURN_UNSUPPORTED,
            "flow:cli-order",
            |a| {
                cli(a)
                    .transitions
                    .push(transition("s4", "s2", TransitionKind::Return));
            },
        ),
        (
            Error,
            codes::FLOW_TRANSITION_NO_EVIDENCE,
            "flow:cli-order",
            |a| {
                event(a).evidence = None;
            },
        ),
        (
            Error,
            codes::FLOW_EVIDENCE_OUT_OF_RANGE,
            "flow:cli-order",
            |a| {
                event(a).evidence.as_mut().unwrap().line = 2; // an import, outside `submit`
            },
        ),
        (
            Error,
            codes::FLOW_EVIDENCE_OUT_OF_RANGE,
            "flow:cli-order",
            |a| {
                event(a).evidence.as_mut().unwrap().file = "flowapp/storage/events.py".into();
            },
        ),
        (
            Warning,
            codes::FLOW_EVIDENCE_MISMATCH,
            "flow:cli-order",
            |a| {
                event(a).evidence.as_mut().unwrap().line = 6;
            },
        ),
        (
            Warning,
            codes::FLOW_TRANSITION_SHOULD_BE_STATIC,
            "flow:cli-order",
            |a| {
                let t = &mut cli(a).transitions[0];
                *t = ai(t.clone(), None, "flowapp/cli.py", 5);
            },
        ),
        (Error, codes::FLOW_BRANCH_NO_LABEL, "flow:self-check", |a| {
            a.flows[1].transitions[0].label = Some("  ".into());
        }),
        (
            Warning,
            codes::FLOW_UNREACHABLE_STEP,
            "flow:cli-order",
            |a| {
                cli(a).transitions.retain(|t| t.to != "s4");
            },
        ),
        (Warning, codes::FLOW_TOO_LONG, "flow:http-order", |a| {
            let first = a.flows[2].steps[0].clone();
            let flow = &mut a.flows[2];
            for i in 2..=26 {
                let mut extra = first.clone();
                extra.id = format!("s{i}");
                flow.steps.push(extra);
                let from = format!("s{}", i - 1);
                // handle → handle is not a call; keep the steps reachable through `ai`.
                flow.transitions.push(ai(
                    transition(&from, &format!("s{i}"), TransitionKind::Async),
                    None,
                    "flowapp/api.py",
                    5,
                ));
            }
        }),
        (Warning, codes::FLOW_LABEL_TOO_LONG, "flow:cli-order", |a| {
            cli(a).steps[0].label = "é".repeat(61);
        }),
    ]
}

#[test]
fn every_issue_code_is_detected() {
    let cases = entry_cases()
        .into_iter()
        .chain(flow_cases())
        .chain(transition_cases());
    let s = Scenario::new();
    for (severity, code, id, mutate) in cases {
        s.update(mutate);
        let report = s.validate();
        let issues = flow_issues(&report);
        assert!(
            issues.contains(&(severity, code, id)),
            "{code} on {id}: got {issues:?}"
        );
        if severity == Severity::Error && id.starts_with("flow:") {
            assert_eq!(flow(&report, id).status, FlowState::Broken, "{code}");
        }
    }
}

#[test]
fn sixty_character_labels_are_allowed() {
    let s = Scenario::new();
    s.update(|a| cli(a).steps[0].label = "é".repeat(60));
    assert_eq!(flow_issues(&s.validate()), []);
}

#[test]
fn editing_a_step_function_makes_only_its_flow_stale() {
    let s = Scenario::new();
    s.edit(
        "flowapp/service/orders.py",
        "    return value\n",
        "    return value or None\n",
    );
    s.reindex();
    let report = s.validate();
    assert_eq!(flow_issues(&report), []);
    assert_eq!(
        flow(&report, "flow:cli-order"),
        &FlowStatus {
            id: "flow:cli-order".into(),
            status: FlowState::Stale,
            stale_steps: vec!["s2".into()],
        }
    );
    assert_eq!(
        flow(&report, "flow:http-order"),
        &current("flow:http-order")
    );
    assert_eq!(
        flow(&report, "flow:self-check"),
        &current("flow:self-check")
    );
}

#[test]
fn deleting_a_step_function_breaks_its_flow() {
    let s = Scenario::new();
    s.edit(
        "flowapp/service/orders.py",
        "def submit(item):\n    value = validate(item)\n    handlers = {\"saved\": on_saved}\n    handlers[\"saved\"](value)\n    return value\n",
        "",
    );
    s.reindex();
    let report = s.validate();
    let issues = flow_issues(&report);
    assert!(
        issues.contains(&(Severity::Error, codes::FLOW_DANGLING_STEP, "flow:cli-order")),
        "{issues:?}"
    );
    assert_eq!(flow(&report, "flow:cli-order").status, FlowState::Broken);
    assert_eq!(
        flow(&report, "flow:http-order"),
        &current("flow:http-order")
    );
    assert_eq!(
        flow(&report, "flow:self-check"),
        &current("flow:self-check")
    );
}

#[test]
fn committed_flow_fixtures_validate_without_issues() {
    for fixture in ["py-flows", "ts-flows"] {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(fixture);
        let report = validate_repo(&root).unwrap();
        assert_eq!(report.issues, [], "{fixture}");
        assert_eq!(report.flows.len(), 3, "{fixture}");
        assert!(
            report.flows.iter().all(|f| f.status == FlowState::Current),
            "{fixture}"
        );
        // The committed report matches a fresh one except for `commitSha`, which names
        // whatever commit was checked out when `gitvur validate` last ran.
        let mut committed: Report =
            serde_json::from_str(&fs::read_to_string(root.join(".gitvur/report.json")).unwrap())
                .unwrap();
        committed.commit_sha.clone_from(&report.commit_sha);
        assert_eq!(
            to_canonical_json(&committed),
            to_canonical_json(&report),
            "{fixture} report.json"
        );
    }
}
