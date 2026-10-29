//! The `gitvur` command-line tool.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

/// Exit code for commands that exist in the CLI but are not implemented yet.
const EXIT_NOT_IMPLEMENTED: u8 = 2;

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
    },
    /// Check structure and annotations and write `.gitvur/report.json`.
    Validate {
        /// Path to the repository root.
        repo: PathBuf,
    },
    /// List elements whose descriptions are stale.
    Stale {
        /// Path to the repository root.
        repo: PathBuf,
    },
    /// Compare the structure of two revisions.
    Diff {
        /// Path to the repository root.
        repo: PathBuf,
        /// Base revision.
        commit_a: String,
        /// Revision to compare against the base.
        commit_b: String,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Index { .. }
        | Command::Validate { .. }
        | Command::Stale { .. }
        | Command::Diff { .. } => {
            eprintln!("not implemented yet");
            ExitCode::from(EXIT_NOT_IMPLEMENTED)
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    use super::*;

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }
}
