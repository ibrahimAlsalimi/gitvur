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

Open **Diagram** (`Ctrl/Cmd+4`) for a high-level view of indexed source directories and their
verified dependencies. Select components or arrows to inspect responsibilities, source references
and evidence, then navigate to Map or related Docs. Large source trees expose nested groups.
Filter components, zoom, fit or reset the layout; copy grouped Mermaid or export SVG/PNG through
the save dialog. Exports are refused inside the analyzed repository.

The diagram works without AI. The existing documentation agent can optionally enrich it using
version-1 `architecture` annotations (`agent/codeDOC.md`, section 12). Invalid or outdated
annotations revert to structural groups. Evidence establishes traceability; semantic descriptions
still need review. Existing repositories require no migration.
