//! Checks on agent-written entry points and flows against a fresh structure. No I/O:
//! evidence files are read through [`EvidenceSource`], which the caller makes path-safe.
use crate::codes::{
    ENTRY_BAD_ID, ENTRY_BAD_PROVENANCE, ENTRY_DANGLING_TARGET, ENTRY_DUPLICATES_STATIC,
    ENTRY_EVIDENCE_MISMATCH, ENTRY_EVIDENCE_OUT_OF_RANGE, ENTRY_NO_EVIDENCE, FLOW_BAD_ID,
    FLOW_BAD_TRANSITION_REF, FLOW_BRANCH_NO_LABEL, FLOW_CALL_UNSUPPORTED, FLOW_DANGLING_ENTRY,
    FLOW_DANGLING_STEP, FLOW_DUPLICATE_STEP_ID, FLOW_EVIDENCE_MISMATCH, FLOW_EVIDENCE_OUT_OF_RANGE,
    FLOW_LABEL_TOO_LONG, FLOW_RETURN_UNSUPPORTED, FLOW_TOO_LONG, FLOW_TRANSITION_NO_EVIDENCE,
    FLOW_TRANSITION_SHOULD_BE_STATIC, FLOW_UNREACHABLE_STEP, MAX_FLOW_STEPS, MAX_STEP_LABEL_CHARS,
};
use gitvur_schema::{
    Annotations, EdgeType, EntryKind, EntryPoint, Evidence, Flow, FlowState, FlowStatus,
    FlowTransition, Issue, Node, NodeType, Provenance, Severity, Structure, TransitionKind,
    extract_lines,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// Repository files that evidence refers to.
pub trait EvidenceSource {
    /// The text of the repo-relative `file`, or `None` when it is missing or unsafe.
    fn text(&mut self, file: &str) -> Option<&str>;
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FlowCheck {
    pub issues: Vec<Issue>,
    /// One status per distinct flow ID, sorted by ID.
    pub flows: Vec<FlowStatus>,
}

/// Validates `annotations`' entry points and flows. `structure` must be a fresh index
/// whose `entryPoints` are the extractor's (not merged with AI entries).
pub fn check_flows(
    structure: &Structure,
    annotations: &Annotations,
    files: &mut dyn EvidenceSource,
) -> FlowCheck {
    let ctx = Context::new(structure, annotations);
    let mut issues = Vec::new();
    for entry in &annotations.entry_points {
        check_entry(&ctx, entry, files, &mut issues);
    }
    let mut seen = BTreeSet::new();
    let mut stale: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    for flow in &annotations.flows {
        if !is_flow_id(&flow.id) || !seen.insert(flow.id.as_str()) {
            issues.push(issue(
                Severity::Error,
                FLOW_BAD_ID,
                &flow.id,
                format!(
                    "flow ID `{}` is not a unique `flow:<slug>` with slug [a-z0-9-]+",
                    flow.id
                ),
            ));
        }
        stale
            .entry(flow.id.as_str())
            .or_default()
            .extend(check_flow(&ctx, flow, files, &mut issues));
    }
    let broken: BTreeSet<&str> = issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .filter_map(|i| i.id.as_deref())
        .collect();
    let flows = stale
        .into_iter()
        .map(|(id, mut steps)| {
            steps.sort();
            steps.dedup();
            let status = if broken.contains(id) {
                FlowState::Broken
            } else if steps.is_empty() {
                FlowState::Current
            } else {
                FlowState::Stale
            };
            FlowStatus {
                id: id.to_owned(),
                status,
                stale_steps: steps,
            }
        })
        .collect();
    FlowCheck { issues, flows }
}

struct Context<'a> {
    nodes: BTreeMap<&'a str, &'a Node>,
    /// `(from, to)` pairs that justify a static transition: `calls` edges of any
    /// provenance in the structure, plus static entries' top-level calls from their target.
    static_calls: BTreeSet<(&'a str, &'a str)>,
    /// `(kind, target)` of extractor entry points.
    static_entries: BTreeSet<(EntryKind, &'a str)>,
    static_ids: BTreeSet<&'a str>,
    entry_ids: BTreeSet<&'a str>,
}

impl<'a> Context<'a> {
    fn new(structure: &'a Structure, annotations: &'a Annotations) -> Self {
        let mut static_calls: BTreeSet<_> = structure
            .edges
            .iter()
            .filter(|e| e.edge_type == EdgeType::Calls)
            .map(|e| (e.from.as_str(), e.to.as_str()))
            .collect();
        for entry in &structure.entry_points {
            if let Some(target) = entry.target.as_deref() {
                static_calls.extend(entry.calls.iter().map(|c| (target, c.as_str())));
            }
        }
        let static_ids: BTreeSet<_> = structure
            .entry_points
            .iter()
            .map(|e| e.id.as_str())
            .collect();
        let mut entry_ids = static_ids.clone();
        entry_ids.extend(annotations.entry_points.iter().map(|e| e.id.as_str()));
        Self {
            nodes: structure.nodes.iter().map(|n| (n.id.as_str(), n)).collect(),
            static_calls,
            static_entries: structure
                .entry_points
                .iter()
                .filter_map(|e| Some((e.kind, e.target.as_deref()?)))
                .collect(),
            static_ids,
            entry_ids,
        }
    }
}

fn issue(severity: Severity, code: &str, id: &str, message: String) -> Issue {
    Issue {
        severity,
        code: code.into(),
        message,
        id: Some(id.into()),
    }
}

fn is_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_flow_id(id: &str) -> bool {
    id.strip_prefix("flow:").is_some_and(is_slug)
}

fn check_entry(
    ctx: &Context<'_>,
    entry: &EntryPoint,
    files: &mut dyn EvidenceSource,
    issues: &mut Vec<Issue>,
) {
    let id = entry.id.as_str();
    let mut push = |severity, code, message| issues.push(issue(severity, code, id, message));
    if entry.provenance != Provenance::Ai {
        push(
            Severity::Error,
            ENTRY_BAD_PROVENANCE,
            format!(
                "entry point `{id}` in annotations.json has provenance `{}`; only `ai` is allowed",
                provenance_name(entry.provenance)
            ),
        );
    }
    let well_formed = id
        .strip_prefix("entry:")
        .and_then(|rest| rest.strip_prefix(entry.kind.as_str()))
        .and_then(|rest| rest.strip_prefix(':'))
        .is_some_and(is_slug);
    if !well_formed {
        push(
            Severity::Error,
            ENTRY_BAD_ID,
            format!(
                "entry point ID `{id}` is not `entry:{}:<slug>` with slug [a-z0-9-]+",
                entry.kind.as_str()
            ),
        );
    }
    if ctx.static_ids.contains(id) {
        push(
            Severity::Error,
            ENTRY_BAD_ID,
            format!("entry point ID `{id}` is already used by an extractor entry point"),
        );
    }
    match entry.target.as_deref() {
        None => push(
            Severity::Error,
            ENTRY_DANGLING_TARGET,
            format!("entry point `{id}` has no target"),
        ),
        Some(target) if !ctx.nodes.contains_key(target) => push(
            Severity::Error,
            ENTRY_DANGLING_TARGET,
            format!("entry point `{id}` targets `{target}`, which is not in the structure"),
        ),
        Some(target) if ctx.static_entries.contains(&(entry.kind, target)) => push(
            Severity::Warning,
            ENTRY_DUPLICATES_STATIC,
            format!(
                "entry point `{id}` duplicates an extractor `{}` entry for `{target}`",
                entry.kind.as_str()
            ),
        ),
        Some(_) => {}
    }
    for call in entry
        .calls
        .iter()
        .filter(|c| !ctx.nodes.contains_key(c.as_str()))
    {
        push(
            Severity::Error,
            ENTRY_DANGLING_TARGET,
            format!("entry point `{id}` calls `{call}`, which is not in the structure"),
        );
    }
    check_entry_evidence(ctx, entry, files, issues);
}

fn check_entry_evidence(
    ctx: &Context<'_>,
    entry: &EntryPoint,
    files: &mut dyn EvidenceSource,
    issues: &mut Vec<Issue>,
) {
    let id = entry.id.as_str();
    let mut push = |severity, code, message| issues.push(issue(severity, code, id, message));
    let Some(evidence) = &entry.evidence else {
        push(
            Severity::Error,
            ENTRY_NO_EVIDENCE,
            format!("entry point `{id}` has no evidence"),
        );
        return;
    };
    let Some(line) = files
        .text(&evidence.file)
        .and_then(|text| extract_lines(text, evidence.line, evidence.line))
    else {
        push(
            Severity::Error,
            ENTRY_EVIDENCE_OUT_OF_RANGE,
            format!(
                "entry point `{id}`: evidence {}:{} does not exist or is outside the repository",
                evidence.file, evidence.line
            ),
        );
        return;
    };
    let mut names = entry
        .target
        .as_deref()
        .map(|t| short_names(ctx, t))
        .unwrap_or_default();
    names.push(entry.name.clone());
    if !mentions(&line, &names) {
        push(
            Severity::Warning,
            ENTRY_EVIDENCE_MISMATCH,
            format!(
                "entry point `{id}`: evidence line {}:{} mentions neither the target nor the entry name ({})",
                evidence.file,
                evidence.line,
                quoted(&names)
            ),
        );
    }
}

/// Step ID → node, for the first step with each ID. `None` when the node is unusable.
type Steps<'a> = BTreeMap<&'a str, Option<&'a Node>>;

/// Returns the IDs of steps whose `basedOnHash` no longer matches their node.
fn check_flow(
    ctx: &Context<'_>,
    flow: &Flow,
    files: &mut dyn EvidenceSource,
    issues: &mut Vec<Issue>,
) -> Vec<String> {
    let id = flow.id.as_str();
    if !ctx.entry_ids.contains(flow.entry_point.as_str()) {
        issues.push(issue(
            Severity::Error,
            FLOW_DANGLING_ENTRY,
            id,
            format!(
                "flow `{id}` starts from `{}`, which is not a known entry point",
                flow.entry_point
            ),
        ));
    }
    if flow.steps.len() > MAX_FLOW_STEPS {
        issues.push(issue(
            Severity::Warning,
            FLOW_TOO_LONG,
            id,
            format!(
                "flow `{id}` has {} steps (more than {MAX_FLOW_STEPS})",
                flow.steps.len()
            ),
        ));
    }
    let (steps, stale) = check_steps(ctx, flow, issues);
    let mut next: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for transition in &flow.transitions {
        if check_transition(ctx, id, transition, &steps, files, issues) {
            next.entry(transition.from.as_str())
                .or_default()
                .push(transition.to.as_str());
        }
    }
    check_reachable(flow, &steps, &next, issues);
    stale
}

fn check_steps<'a>(
    ctx: &Context<'a>,
    flow: &'a Flow,
    issues: &mut Vec<Issue>,
) -> (Steps<'a>, Vec<String>) {
    let id = flow.id.as_str();
    let mut push = |severity, code, message| issues.push(issue(severity, code, id, message));
    let mut steps = Steps::new();
    let mut stale = Vec::new();
    for step in &flow.steps {
        let node = ctx
            .nodes
            .get(step.node.as_str())
            .copied()
            .filter(|n| n.node_type != NodeType::Project && n.content_hash.is_some());
        if node.is_none() {
            push(
                Severity::Error,
                FLOW_DANGLING_STEP,
                format!(
                    "flow `{id}` step `{}` refers to `{}`, which is not a file, class or function in the structure",
                    step.id, step.node
                ),
            );
        }
        if steps.contains_key(step.id.as_str()) {
            push(
                Severity::Error,
                FLOW_DUPLICATE_STEP_ID,
                format!("flow `{id}` has more than one step `{}`", step.id),
            );
        } else {
            steps.insert(step.id.as_str(), node);
        }
        if node.is_some_and(|n| n.content_hash.as_deref() != Some(step.based_on_hash.as_str())) {
            stale.push(step.id.clone());
        }
        let chars = step.label.chars().count();
        if chars > MAX_STEP_LABEL_CHARS {
            push(
                Severity::Warning,
                FLOW_LABEL_TOO_LONG,
                format!(
                    "flow `{id}` step `{}` label has {chars} characters (more than {MAX_STEP_LABEL_CHARS})",
                    step.id
                ),
            );
        }
    }
    (steps, stale)
}

/// Checks one transition. Returns whether both ends are steps of the flow.
fn check_transition(
    ctx: &Context<'_>,
    id: &str,
    transition: &FlowTransition,
    steps: &Steps<'_>,
    files: &mut dyn EvidenceSource,
    issues: &mut Vec<Issue>,
) -> bool {
    let mut push = |severity, code, message| issues.push(issue(severity, code, id, message));
    let name = format!(
        "flow `{id}` transition {} -> {} ({})",
        transition.from,
        transition.to,
        kind_name(transition.kind)
    );
    let (Some(&from), Some(&to)) = (
        steps.get(transition.from.as_str()),
        steps.get(transition.to.as_str()),
    ) else {
        for end in [&transition.from, &transition.to] {
            if !steps.contains_key(end.as_str()) {
                push(
                    Severity::Error,
                    FLOW_BAD_TRANSITION_REF,
                    format!("{name} refers to step `{end}`, which is not in the flow"),
                );
            }
        }
        return false;
    };
    if transition.kind == TransitionKind::Branch
        && transition
            .label
            .as_deref()
            .is_none_or(|l| l.trim().is_empty())
    {
        push(
            Severity::Error,
            FLOW_BRANCH_NO_LABEL,
            format!("{name} is a branch without a label"),
        );
    }
    // Dangling step nodes are already reported; their edges cannot be checked.
    let (Some(from), Some(to)) = (from, to) else {
        return true;
    };
    let supported = supported(ctx, transition.kind, from, to);
    if transition.provenance != Provenance::Ai {
        if !supported {
            let (code, expected) = if transition.kind == TransitionKind::Return {
                (FLOW_RETURN_UNSUPPORTED, format!("{} -> {}", to.id, from.id))
            } else {
                (FLOW_CALL_UNSUPPORTED, format!("{} -> {}", from.id, to.id))
            };
            push(
                Severity::Error,
                code,
                format!(
                    "{name} is {} but the structure has no call {expected}",
                    provenance_name(transition.provenance)
                ),
            );
        }
        return true;
    }
    if supported {
        push(
            Severity::Warning,
            FLOW_TRANSITION_SHOULD_BE_STATIC,
            format!("{name} is `ai` but matches a structure call; use `syntactic`"),
        );
    }
    let Some(evidence) = &transition.evidence else {
        push(
            Severity::Error,
            FLOW_TRANSITION_NO_EVIDENCE,
            format!("{name} is `ai` and has no evidence"),
        );
        return true;
    };
    if let Some((severity, code, message)) =
        check_evidence(ctx, transition, evidence, from, to, files)
    {
        push(severity, code, format!("{name}: {message}"));
    }
    true
}

fn check_reachable(
    flow: &Flow,
    steps: &Steps<'_>,
    next: &BTreeMap<&str, Vec<&str>>,
    issues: &mut Vec<Issue>,
) {
    let Some(first) = flow.steps.first() else {
        return;
    };
    let mut reached = BTreeSet::from([first.id.as_str()]);
    let mut queue = VecDeque::from([first.id.as_str()]);
    while let Some(step) = queue.pop_front() {
        for &to in next.get(step).into_iter().flatten() {
            if reached.insert(to) {
                queue.push_back(to);
            }
        }
    }
    for step in steps.keys().filter(|s| !reached.contains(*s)) {
        issues.push(issue(
            Severity::Warning,
            FLOW_UNREACHABLE_STEP,
            &flow.id,
            format!(
                "flow `{}` step `{step}` is not reachable from the first step `{}`",
                flow.id, first.id
            ),
        ));
    }
}

/// Whether a structure call justifies the transition: the reverse call for `return`.
fn supported(ctx: &Context<'_>, kind: TransitionKind, from: &Node, to: &Node) -> bool {
    let pair = if kind == TransitionKind::Return {
        (to.id.as_str(), from.id.as_str())
    } else {
        (from.id.as_str(), to.id.as_str())
    };
    ctx.static_calls.contains(&pair)
}

fn check_evidence(
    ctx: &Context<'_>,
    transition: &FlowTransition,
    evidence: &Evidence,
    from: &Node,
    to: &Node,
    files: &mut dyn EvidenceSource,
) -> Option<(Severity, &'static str, String)> {
    let source = from.source.as_ref()?;
    let in_range = evidence.file == source.file
        && (source.start_line..=source.end_line).contains(&evidence.line);
    let line = files
        .text(&evidence.file)
        .and_then(|text| extract_lines(text, evidence.line, evidence.line));
    let (true, Some(line)) = (in_range, line) else {
        return Some((
            Severity::Error,
            FLOW_EVIDENCE_OUT_OF_RANGE,
            format!(
                "evidence {}:{} is not inside the from-step's node `{}` ({}:{}-{})",
                evidence.file,
                evidence.line,
                from.id,
                source.file,
                source.start_line,
                source.end_line
            ),
        ));
    };
    let mut names = short_names(ctx, &to.id);
    names.extend(
        transition
            .label
            .iter()
            .filter(|l| !l.trim().is_empty())
            .cloned(),
    );
    (!mentions(&line, &names)).then(|| {
        (
            Severity::Warning,
            FLOW_EVIDENCE_MISMATCH,
            format!(
                "evidence line {}:{} contains neither the to-step's name nor the label ({})",
                evidence.file,
                evidence.line,
                quoted(&names)
            ),
        )
    })
}

/// A node's `name`, plus the stem for files (`login.ts` → `login`).
fn short_names(ctx: &Context<'_>, id: &str) -> Vec<String> {
    let Some(node) = ctx.nodes.get(id) else {
        return Vec::new();
    };
    let mut names = vec![node.name.clone()];
    if node.node_type == NodeType::File
        && let Some((stem, _)) = node.name.split_once('.')
        && !stem.is_empty()
    {
        names.push(stem.to_owned());
    }
    names
}

fn mentions(line: &str, names: &[String]) -> bool {
    names
        .iter()
        .any(|n| !n.is_empty() && line.contains(n.as_str()))
}

fn quoted(names: &[String]) -> String {
    names
        .iter()
        .map(|n| format!("`{n}`"))
        .collect::<Vec<_>>()
        .join(" or ")
}

fn kind_name(kind: TransitionKind) -> &'static str {
    match kind {
        TransitionKind::Async => "async",
        TransitionKind::Branch => "branch",
        TransitionKind::Call => "call",
        TransitionKind::Event => "event",
        TransitionKind::Return => "return",
    }
}

fn provenance_name(provenance: Provenance) -> &'static str {
    match provenance {
        Provenance::Syntactic => "syntactic",
        Provenance::Semantic => "semantic",
        Provenance::Ai => "ai",
    }
}
