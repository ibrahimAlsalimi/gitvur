# Gitvur

Gitvur is a local, read-only desktop app that renders a repository as an interactive hierarchical map — project → logical modules → files → classes → functions. Structure is extracted deterministically with tree-sitter (`gitvur index`); descriptions and logical modules are written by an AI agent and checked by a validator (`gitvur validate`) that also detects when documentation has gone stale. MIT licensed. See `PROTOTYPE_V2_PLAN.md` for the plan and `PROGRESS.md` for status.

For a complete walkthrough, see [Use Gitvur with a repository](docs/USING_GITVUR.md):
setup, indexing, the desktop app, optional AI documentation, and ongoing updates.

## Build

Requirements: Rust (pinned in `rust-toolchain.toml`), Node.js 22+, pnpm, and the [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
# Rust workspace
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p gitvur-cli -- --help

# Desktop app
cd app
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm tauri dev
```

### Architecture diagram

Open **Diagram** (`Ctrl/Cmd+4`) for a ready-made system overview: major components,
responsibilities, entry points, subsystems and meaningful interactions. The Documentation Agent
saves this map in optional `.gitvur/architecture.json` during normal documentation. Opening the
tab reads validated saved data and never invokes AI. Select components or relationships for
source evidence and navigation to Map, Docs and related flows. Fit/reset, component search,
Mermaid copy and SVG/PNG save-dialog exports are available in both themes.

Without architecture documentation, Diagram explains how to generate it and offers **Raw
structure** as separate directory/dependency exploration. Malformed maps show a repair state;
stale sources and unresolved AI interactions are marked for review. Validation checks references
and traceability, not the correctness of every interpretation. Missing architecture leaves Map,
Docs and Flows usable. Legacy annotation architecture remains readable when the standalone
artifact is absent; no automatic migration or writes occur on open.

See [the Phase 16 contract and acceptance plan](PHASE_16_ARCHITECTURE_DIAGRAM.md) and
[documentation-agent instructions](agent/codeDOC.md). Everything remains local-first; analyzed
repository code is never executed.
