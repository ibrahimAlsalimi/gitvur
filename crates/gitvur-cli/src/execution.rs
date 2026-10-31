//! Read-only execution inspection, always using a fresh index.
use anyhow::Context as _;
use gitvur_schema::{
    Annotations, FlowState, Severity, Structure, Trace, TraceKind, to_canonical_json,
};
use std::{collections::BTreeMap, fs, path::Path};

fn load(repo: &Path) -> anyhow::Result<(Structure, Option<Annotations>)> {
    let root = repo
        .canonicalize()
        .with_context(|| format!("opening {}", repo.display()))?;
    let output = gitvur_index::index(
        &root,
        &gitvur_index::IndexOptions {
            generated_at: "1970-01-01T00:00:00Z".into(),
        },
    )?;
    for warning in output.warnings {
        eprintln!("warning: {warning}");
    }
    let path = root.join(".gitvur/annotations.json");
    if let Err(error) = fs::symlink_metadata(&path) {
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok((output.structure, None));
        }
        return Err(error).context("cannot inspect annotations.json");
    }
    let safe = gitvur_validate::resolve_in_repo(&root, ".gitvur/annotations.json")
        .context("annotations.json must be a readable file inside the repository")?;
    let annotations: Annotations = serde_json::from_str(&fs::read_to_string(safe)?)
        .context("invalid annotations.json; run gitvur validate")?;
    let mut structure = output.structure;
    for entry in &annotations.entry_points {
        anyhow::ensure!(
            !structure.entry_points.iter().any(|e| e.id == entry.id),
            "duplicate entry ID: {}",
            entry.id
        );
        structure.entry_points.push(entry.clone());
    }
    structure.canonicalize();
    Ok((structure, Some(annotations)))
}

pub fn run_trace(
    repo: &Path,
    start: &str,
    opts: &gitvur_flow::TraceOptions,
    json: bool,
) -> anyhow::Result<()> {
    let (structure, _) = load(repo)?;
    let result = gitvur_flow::trace(&structure, start, opts);
    if json {
        print!("{}", to_canonical_json(&result));
    }
    if let Some(error) = &result.error {
        anyhow::bail!("{error}");
    }
    if !json {
        print!("{}", text(&result));
    }
    Ok(())
}

fn text(trace: &Trace) -> String {
    use std::fmt::Write as _;
    let by_id: BTreeMap<_, _> = trace.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut output = format!("{}\n", trace.start);
    let mut pending: Vec<_> = trace.roots.iter().rev().map(String::as_str).collect();
    while let Some(id) = pending.pop() {
        let node = by_id[id];
        let indent = "  ".repeat(node.depth as usize + 1);
        let marker = match node.kind {
            TraceKind::Node => "",
            TraceKind::Ref => "↻ ",
            TraceKind::Cycle => "⟲ ",
            TraceKind::Ambiguous => "? ",
        };
        let label = node.node.as_deref().unwrap_or(&node.name);
        let _ = write!(output, "{indent}{marker}{label}");
        if node.kind == TraceKind::Node {
            let _ = write!(output, " [{}]", node.id);
        }
        if let Some(reference) = &node.reference {
            let _ = write!(output, " → {reference}");
        }
        if node.kind == TraceKind::Ambiguous {
            let _ = write!(output, " [{}]", node.candidates.join(", "));
        }
        if node.truncated {
            let _ = write!(output, " … ({} hidden children)", node.hidden_children);
        }
        output.push('\n');
        pending.extend(node.children.iter().rev().map(String::as_str));
    }
    if trace.hidden_roots > 0 {
        let _ = writeln!(output, "  … ({} hidden roots)", trace.hidden_roots);
    }
    if trace.roots.is_empty() && !trace.truncated {
        output.push_str("  (no resolved execution roots)\n");
    }
    output
}

/// Lists entry points and flows. Flow status comes from a fresh validation; nothing is
/// written.
pub fn list(repo: &Path) -> anyhow::Result<()> {
    let (structure, annotations) = load(repo)?;
    let report = gitvur_validate::validate_repo(repo)?;
    let statuses: BTreeMap<_, _> = report.flows.iter().map(|f| (f.id.as_str(), f)).collect();
    println!("Entry points:");
    for entry in &structure.entry_points {
        println!(
            "  {}  {} → {}",
            entry.id,
            entry.name,
            entry.target.as_deref().unwrap_or("unresolved")
        );
    }
    if structure.entry_points.is_empty() {
        println!("  (none)");
    }
    println!("Flows:");
    let mut flows = annotations.map(|a| a.flows).unwrap_or_default();
    flows.sort_by(|a, b| a.id.cmp(&b.id));
    for flow in &flows {
        let status = statuses.get(flow.id.as_str());
        let state = status.map_or("unknown", |s| match s.status {
            FlowState::Current => "current",
            FlowState::Stale => "stale",
            FlowState::Broken => "broken",
        });
        println!(
            "  {}  {} [{state}] → {}",
            flow.id, flow.name, flow.entry_point
        );
        if let Some(status) = status.filter(|s| !s.stale_steps.is_empty()) {
            println!("      stale steps: {}", status.stale_steps.join(", "));
        }
        for issue in report
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Error && i.id.as_deref() == Some(flow.id.as_str()))
        {
            println!("      {}: {}", issue.code, issue.message);
        }
    }
    if flows.is_empty() {
        println!("  (none)");
    }
    Ok(())
}
