# Gitvur — Agent Guide

This file is read at the start of every session. Keep it short and accurate; update it when a decision changes.

## What Gitvur is

A local, open-source (MIT), **read-only** desktop app that renders a repository as an interactive hierarchical map: project → logical modules → files → classes → functions. Selecting a node shows its description, its source code, and its relationships.

The full plan is in `PROTOTYPE_V2_PLAN.md`. Phase prompts are in `prompts/`. **The plan is the source of truth for scope; the current phase prompt is the source of truth for the task.**

## Core principle

**Structure is extracted deterministically. Meaning is written by an AI agent. Everything the agent writes is validated.**

- `gitvur-index` (Rust + tree-sitter) produces nodes, ranges, hashes, imports, calls. No AI, no network.
- An AI agent, following `agent/codeDOC.md`, writes logical modules, descriptions, and hidden relationships with evidence.
- `gitvur-validate` checks both layers and detects staleness by comparing content hashes.
- The Tauri app merges both layers and renders them.

## Architecture

```text
Repository ──> gitvur index ──> structure.json ──┐
     │                               │            ├──> gitvur validate ──> report.json
     └────────> AI agent <───────────┘            │
                   └──────> annotations.json ─────┘
                                                  └──> Gitvur viewer (Tauri + React)
```

## Repository layout

```text
gitvur/
├── Cargo.toml                 # Rust workspace
├── crates/
│   ├── gitvur-schema/         # contract v0.3 types + JSON Schema
│   ├── gitvur-index/          # extractor
│   ├── gitvur-validate/       # validator + staleness
│   ├── gitvur-diff/           # structural diff
│   └── gitvur-cli/            # `gitvur` binary
├── app/
│   ├── src-tauri/             # Tauri 2 backend, depends on the crates
│   └── src/                   # React + TypeScript frontend
├── agent/
│   ├── codeDOC.md             # instructions for the documenting agent
│   └── annotations.schema.json
├── fixtures/                  # small test repositories (data, never executed)
├── prompts/                   # phase prompts
├── PROTOTYPE_V2_PLAN.md
└── PROGRESS.md                # session log, updated at the end of every session
```

## Data contract v0.3 (summary)

Files in `<repo>/.gitvur/`, one writer each:

| File | Writer |
| --- | --- |
| `manifest.json` | extractor |
| `structure.json` | extractor |
| `annotations.json` | documenting agent |
| `report.json` | validator |

Node ID format (exact rules in `crates/gitvur-schema/README.md` once Phase 01 lands):

```text
project:root
module:<slug>
file:<relpath>
class:<relpath>:<Qualified.Name>
function:<relpath>:<Qualified.Name>
```

Edge `provenance` is one of `syntactic | semantic | ai`. AI edges must carry `evidence` (file + line). Lines are 1-based inclusive; paths are relative to the repo root, using `/`.

## Commands

```bash
# Rust
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# CLI
cargo run -p gitvur-cli -- index    <repo>
cargo run -p gitvur-cli -- validate <repo>
cargo run -p gitvur-cli -- stale    <repo>
cargo run -p gitvur-cli -- packet   <repo> --mode initial|incremental
cargo run -p gitvur-cli -- diff     <repo> <commitA> <commitB>

# App (from app/)
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm tauri dev
```

A session is not done until `cargo fmt`, `clippy`, `cargo test`, and (for app work) `pnpm typecheck && pnpm lint && pnpm test` all pass.

## Hard rules

1. **Never execute code from analysed repositories.** Fixtures and target repos are data. No build scripts, no test runners, no package installs inside them.
2. **The extractor and validator are deterministic.** Same input → byte-identical output. Sort everything. No timestamps except `manifest.generatedAt`. No randomness, no network.
3. **Never guess a relationship.** If a call has more than one candidate target, record it as unresolved/ambiguous. If it has none inside the repo, drop it.
4. **Path safety.** Every path read from `.gitvur/` is resolved against the selected repo root, canonicalised, and rejected if it escapes the root (including via symlinks).
5. **Do not edit `fixtures/*/expected/` outside Phase 01** unless the current prompt explicitly says so. If extractor output disagrees with an expected file, stop and report the disagreement — do not "fix" the expected file to make tests pass.
6. **The viewer is read-only.** It never writes to the analysed repository, except `.gitvur/` when the user explicitly clicks "Index" or "Validate".
7. **Scope discipline.** Do only what the current phase prompt asks. Ideas for later go into the "Parking lot" section of `PROGRESS.md`.
8. **Dependencies.** Prefer the ones named in the phase prompt. Adding any other dependency needs a one-line justification in `PROGRESS.md`.
9. **Safe Docs rendering.** Raw HTML is never rendered. Markdown uses react-markdown, GFM, heading slugs and rehype-sanitize without rehype-raw. Local images go through bounded repository-safe commands; SVG is an image source only. Remote images require a per-document opt-in. External HTTP(S)/mailto links require confirmation and use the opener plugin; the webview never navigates away.

## Repository views

- **Map** and **Docs** are top-level tabs (`Ctrl/Cmd+1` and `Ctrl/Cmd+2`). The map stays mounted across tab switches, preserving its viewport, selection and lens. Tab, document path and reading position are saved with the per-repository view in the app data folder.
- `gitvur_index::discover_docs` reuses the source walker's ignore and skip rules and discovers `.md`/`.markdown` without changing extraction output.
- Read-only Tauri commands: `list_docs(path)`, `read_doc(path, docPath)` (2 MB), `read_doc_asset(path, docPath, href)` (5 MB; canonical path must stay inside the selected repository).
- `app/src/docs/` owns safe rendering, pure link resolution, exact unique code mentions, and the worker-built docs/backlink index (first 500 documents). `app/src/tabs/` owns the accessible tab bar. Document titles/headings are searchable in the palette; file/module inspectors show "Mentioned in docs".
- Mermaid is lazy-loaded in strict mode, rendered as an image, with embedded resources/config overrides refused. Unsupported diagrams fall back to their source. Markdown entity decoding uses the DOM-free package entry so the same parser runs inside the docs worker.

## Frontend conventions

- React + TypeScript, strict mode. No `any` without a comment explaining why.
- Graph: `@xyflow/react` with `@dagrejs/dagre`. State: `zustand`. Code highlighting: `shiki`.
- All colours, spacing, radii, and type sizes come from design tokens in `app/src/styles/tokens.css`. No hex values in components.
- Every interactive element is keyboard-reachable and has a visible focus ring.
- Light and dark themes are both first-class.

## Working style

- Read the phase prompt fully before writing code. If something is ambiguous, state your assumption in `PROGRESS.md` and continue; stop only for decisions that are hard to reverse.
- Write the test or expected output first, then the implementation.
- Prefer small, reviewable commits with clear messages: `phase-02: extract python classes and methods`.
- At the end of every session, append to `PROGRESS.md`: date, phase, what was done, acceptance criteria status, deviations from the prompt, open questions.

## Phase 14 checkpoint

Parts A–B introduce v0.3 entry/flow types and deterministic entry extraction. Readers
accept v0.2. See the schema/index READMEs for the contract. Parts C–F (trace, flow
validation, packet/agent workflow) wait for human review of both new fixture goldens.
Existing py-small/ts-small data stays frozen; app UI work remains Phase 15.
