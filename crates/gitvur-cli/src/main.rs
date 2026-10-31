//! The `gitvur` command-line tool.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use gitvur_index::{IndexOptions, index, write_output};

mod diff;
mod execution;
mod packet;

#[derive(Debug, Parser)]
#[command(
    name = "gitvur",
    version,
    about = "Map a repository's structure and documentation."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Extract the repository structure into `.gitvur/structure.json`.
    Index {
        /// Path to the repository root.
        repo: PathBuf,
        /// Output directory. Defaults to `<repo>/.gitvur`.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Check structure and annotations and write `.gitvur/report.json`.
    Validate {
        /// Path to the repository root.
        repo: PathBuf,
    },
    /// Print the IDs of stale and undocumented elements, one per line, sorted.
    Stale {
        /// Path to the repository root.
        repo: PathBuf,
        /// Print a JSON array instead of one ID per line.
        #[arg(long)]
        json: bool,
    },
    /// Write the documenting agent's work packet (JSON).
    Packet {
        /// Path to the repository root.
        repo: PathBuf,
        /// `initial`: every node; `incremental`: only stale and undocumented elements.
        #[arg(long, value_enum, default_value = "incremental")]
        mode: packet::Mode,
        /// Write to this file instead of standard output.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Print a bounded deterministic call tree without modifying the repository.
    Trace {
        repo: PathBuf,
        /// Entry point ID or source node ID.
        start: String,
        #[arg(long, default_value_t = 6)]
        depth: u32,
        #[arg(long, default_value_t = 300)]
        max_nodes: u32,
        #[arg(long)]
        include_semantic: bool,
        #[arg(long)]
        json: bool,
    },
    /// List entry points and curated flows with their validation status (writes nothing).
    Flows { repo: PathBuf },
    /// Compare the structure of two revisions (read via Git; the working tree is untouched).
    Diff {
        /// Path to the repository root.
        repo: PathBuf,
        /// Base revision (`HEAD~1`, a branch, a SHA).
        commit_a: String,
        /// Revision to compare against the base; `worktree` means the files on disk.
        commit_b: String,
        /// Print the diff as canonical JSON.
        #[arg(long)]
        json: bool,
        /// Rewrite moved element IDs in `.gitvur/annotations.json` (descriptions only when
        /// their hash still matches). The only option that writes anything.
        #[arg(long)]
        carry_annotations: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Index { repo, out } => match run_index(&repo, out.as_deref()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("error: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Validate { repo } => match run_validate(&repo) {
            Ok(true) => ExitCode::SUCCESS,
            Ok(false) => ExitCode::FAILURE,
            Err(err) => {
                eprintln!("error: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Stale { repo, json } => match run_stale(&repo, json) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("error: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Packet { repo, mode, out } => match run_packet(&repo, mode, out.as_deref()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("error: {err:#}");
                ExitCode::FAILURE
            }
        },
        Command::Trace {
            repo,
            start,
            depth,
            max_nodes,
            include_semantic,
            json,
        } => execution_result(execution::run_trace(
            &repo,
            &start,
            &gitvur_flow::TraceOptions {
                max_depth: depth,
                max_nodes,
                include_semantic,
            },
            json,
        )),
        Command::Flows { repo } => execution_result(execution::list(&repo)),
        Command::Diff {
            repo,
            commit_a,
            commit_b,
            json,
            carry_annotations,
        } => match diff::run(&repo, &commit_a, &commit_b, json, carry_annotations) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("error: {err:#}");
                ExitCode::FAILURE
            }
        },
    }
}

fn execution_result(result: anyhow::Result<()>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run_index(repo: &Path, out: Option<&Path>) -> anyhow::Result<()> {
    let started = Instant::now();
    let opts = IndexOptions {
        generated_at: rfc3339_utc(SystemTime::now()),
    };
    let output = index(repo, &opts).with_context(|| format!("indexing {}", repo.display()))?;
    let out_dir = match out {
        Some(out) => out.to_path_buf(),
        None => gitvur_validate::gitvur_dir(repo)?,
    };
    write_output(&out_dir, &output).with_context(|| format!("writing {}", out_dir.display()))?;
    for warning in &output.warnings {
        eprintln!("warning: {warning}");
    }
    let s = &output.structure;
    let files = s
        .nodes
        .iter()
        .filter(|n| n.node_type == gitvur_schema::NodeType::File)
        .count();
    println!(
        "indexed {}: {files} files, {} nodes, {} edges, {} unresolved, {} ms",
        repo.display(),
        s.nodes.len(),
        s.edges.len(),
        s.unresolved_calls.len(),
        started.elapsed().as_millis()
    );
    Ok(())
}

/// Writes `.gitvur/report.json`. Returns `false` if the report has errors.
fn run_validate(repo: &Path) -> anyhow::Result<bool> {
    let report = gitvur_validate::validate_repo(repo)
        .with_context(|| format!("validating {}", repo.display()))?;
    let out_dir = gitvur_validate::gitvur_dir(repo)?;
    gitvur_validate::write_report(&out_dir, &report)
        .with_context(|| format!("writing {}", out_dir.join("report.json").display()))?;
    for issue in &report.issues {
        let severity = match issue.severity {
            gitvur_schema::Severity::Error => "error",
            gitvur_schema::Severity::Warning => "warning",
        };
        eprintln!("{severity}[{}]: {}", issue.code, issue.message);
    }
    let s = &report.summary;
    println!(
        "validated {}: {} documented, {} stale, {} undocumented; {} errors, {} warnings",
        repo.display(),
        s.documented,
        s.stale,
        s.undocumented,
        s.errors,
        s.warnings
    );
    Ok(s.errors == 0)
}

fn run_stale(repo: &Path, json: bool) -> anyhow::Result<()> {
    let report = gitvur_validate::validate_repo(repo)
        .with_context(|| format!("validating {}", repo.display()))?;
    for issue in report
        .issues
        .iter()
        .filter(|i| i.code.starts_with("architecture-"))
    {
        let severity = match issue.severity {
            gitvur_schema::Severity::Error => "error",
            gitvur_schema::Severity::Warning => "warning",
        };
        eprintln!("{severity}[{}]: {}", issue.code, issue.message);
    }
    let ids = gitvur_validate::stale_ids(&report);
    if json {
        print!("{}", gitvur_schema::to_canonical_json(&ids));
    } else {
        for id in ids {
            println!("{id}");
        }
    }
    Ok(())
}

fn run_packet(repo: &Path, mode: packet::Mode, out: Option<&Path>) -> anyhow::Result<()> {
    let (packet, problems) = packet::for_repo(repo, mode)?;
    for problem in problems {
        eprintln!("warning: annotations.json: {problem}; run `gitvur validate`");
    }
    let json = gitvur_schema::to_canonical_json(&packet);
    match out {
        Some(path) => {
            std::fs::write(path, json).with_context(|| format!("writing {}", path.display()))?;
        }
        None => print!("{json}"),
    }
    eprintln!(
        "packet ({mode:?}): {} todo, {} unassigned files",
        packet.todo.len(),
        packet.unassigned_files.len()
    );
    Ok(())
}

/// Formats `time` as `YYYY-MM-DDTHH:MM:SSZ`.
fn rfc3339_utc(time: SystemTime) -> String {
    let secs = time.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Gregorian date for a day count since 1970-01-01 (Howard Hinnant's algorithm).
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use clap::CommandFactory;

    use super::*;

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn timestamps() {
        let at = |secs| rfc3339_utc(UNIX_EPOCH + Duration::from_secs(secs));
        assert_eq!(at(0), "1970-01-01T00:00:00Z");
        assert_eq!(at(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(at(1_793_286_000), "2026-10-29T15:00:00Z"); // checked with `date -u -d @1793286000`
    }
}
