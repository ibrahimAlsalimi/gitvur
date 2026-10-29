# Phase 06 — App shell and data loading

## Context

The deterministic pipeline (index → annotate → validate) works from the CLI. This phase connects it to the desktop app: open a repository, load the four `.gitvur/` files through Rust, merge them into one in-memory model, and lay out the application frame. The graph itself is drawn in Phase 07; here the centre pane can show a placeholder.

This phase also sets up a **browser mock mode** and **screenshot tests**, so every later UI phase can be checked visually without a desktop session.

## Read first

- `CLAUDE.md` (frontend conventions, rule 6)
- `crates/gitvur-schema/README.md`
- `crates/gitvur-validate/README.md`

## Goal

The user clicks **Open repository**, picks a folder, and sees: the project name and commit in the top bar, a file-level explorer tree on the left populated from the merged model, counts in the status bar, and a clear message for every failure case.

## Scope

**Create / modify:** `app/src-tauri/**`, `app/src/**`, `app/e2e/**`, `app/package.json`.
**Do not touch:** crate logic (call it, don't change it), `fixtures/`.

### Dependencies

```text
# Rust
tauri-plugin-dialog
# Frontend
@tauri-apps/plugin-dialog
@playwright/test          # dev
@fontsource/inter         # bundled locally, works offline
@fontsource/jetbrains-mono
```

## Part A — Rust commands

All commands are `async`, return `Result<T, AppError>`, and `AppError` serialises as `{ code, message, detail? }`. Use these codes: `not-a-directory`, `no-gitvur`, `schema-invalid`, `path-escape`, `io`, `index-failed`.

```text
open_repository(path)            -> RepoBundle
index_repository(path)           -> RepoBundle      # runs gitvur_index, writes .gitvur/, then reloads
validate_repository(path)        -> RepoBundle      # runs gitvur_validate, writes report.json, then reloads
read_source(path, file, start, end, context) -> SourceSlice
recent_repositories()            -> Vec<RecentRepo> # stored in the app config dir, never in the repo
```

```ts
type RepoBundle = {
  root: string;
  manifest: Manifest;
  structure: Structure;
  annotations: Annotations | null;
  report: Report | null;
  warnings: AppWarning[];   // e.g. annotations missing, report missing, report older than structure
};
type SourceSlice = { file: string; startLine: number; lines: string[]; language: "python" | "typescript" | "text" };
```

Rules:

- Every path is resolved against the canonicalised repo root; reject `..`, absolute paths, and symlink escapes with `path-escape`.
- `read_source` caps at 2,000 lines and returns `context` extra lines on each side, clamped to the file.
- No command executes anything from the repository.
- Generate TypeScript types from the Rust schema (`ts-rs` or `specta`; justify the choice) into `app/src/generated/` — never hand-write the contract types twice.

## Part B — The merged model

Write `app/src/model/buildModel.ts` as a **pure function** with unit tests:

```ts
buildModel(bundle: RepoBundle): Model
```

- Nodes from `structure` plus `module` nodes from `annotations`.
- Re-parent each file under its module. Files without a module go under a synthetic module `module:__unassigned` named **Unassigned files**.
- Attach `description`, `docStatus` (`documented | stale | undocumented`), `selfChanged`, `childChanged` from the report (if the report is missing, compute status from hashes in the frontend using the same rules).
- Edges from both files, each tagged with provenance; `unresolvedCalls` kept separately, indexed by `from`.
- Precompute: `childrenById`, `parentById`, `depthById`, per-module counts (files, classes, functions, documented %), incoming/outgoing edge indexes.
- Must handle 10,000 nodes in under 100 ms in a Vitest benchmark (generate a synthetic model).

## Part C — Application frame

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Top bar: logo · project name · commit chip · [Index] [Validate] · ⋯  │
├──────────────┬──────────────────────────────────────┬────────────────┤
│ Explorer     │ Canvas (placeholder in this phase)    │ Inspector      │
│ 280px        │ flexible                              │ 380px          │
│ resizable    │                                       │ resizable,     │
│              │                                       │ collapsible    │
├──────────────┴──────────────────────────────────────┴────────────────┤
│ Status bar: files · nodes · edges · documented % · last indexed      │
└──────────────────────────────────────────────────────────────────────┘
```

- Panes resizable by drag handles (keyboard-resizable too, 16px steps with arrows when the handle is focused). Widths persisted in app config.
- Explorer tree shows modules → files → classes → functions, collapsible, `role="tree"` with proper `aria-expanded`.
- Selection state lives in a `zustand` store shared by explorer, canvas, and inspector: `selectedId`, `expandedIds`, `lens`, `theme`.
- Use placeholder tokens from `tokens.css` (Phase 07 defines the real palette); use `@fontsource/inter` for UI and `@fontsource/jetbrains-mono` for code.

## Part D — States

Design each state as a centred panel in the canvas area, with a short title, one sentence, and one primary action:

| State | Title | Action |
| --- | --- | --- |
| No repository open | Open a repository to map it | Open repository |
| Folder has no `.gitvur/` | This repository hasn't been indexed yet | Index now |
| Structure only, no annotations | Structure loaded — no descriptions yet | Show how to document (opens `codeDOC.md` instructions) |
| Schema invalid | `.gitvur/` files don't match the expected format | Re-index |
| Loading / indexing | Indexing… (with file count when known) | — |

## Part E — Mock mode and screenshot tests

- `pnpm dev:mock` runs Vite in a normal browser with `?fixture=py-small` or `?fixture=ts-small`, loading the fixture's `.gitvur/` files bundled at build time instead of calling Tauri. Abstract all Tauri calls behind `app/src/api/` so the mock swaps cleanly.
- Playwright config with two projects: `light` and `dark` (via `colorScheme`), viewport 1440×900.
- `pnpm e2e` takes screenshots of each state above into `app/e2e/__screenshots__/`.
- **After each run, open the screenshots and look at them yourself.** Note anything misaligned, clipped, low-contrast, or unbalanced in `PROGRESS.md`, and fix it before finishing.

## Acceptance criteria

- [ ] All five commands implemented; path-escape tests pass (`../`, absolute path, symlink to outside)
- [ ] TS contract types generated, not hand-written
- [ ] `buildModel` unit tests: re-parenting, unassigned group, status without report, 10k-node benchmark under 100 ms
- [ ] Frame layout works from 1280×720 to 2560×1440 with no horizontal scroll
- [ ] Every state in Part D reachable and screenshotted in light and dark
- [ ] Opening `fixtures/py-small` in the real app shows the explorer tree and correct counts
- [ ] Screenshots reviewed; findings recorded

## Verify

```bash
cargo test --workspace
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
pnpm tauri dev   # manual: open fixtures/py-small
```

## When done

Update `PROGRESS.md` with the screenshot review notes. Stop.
