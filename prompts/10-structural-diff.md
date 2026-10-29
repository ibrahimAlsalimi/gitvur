# Phase 10 — Structural diff between two revisions

## Context

The original question behind Gitvur is "what did the AI change?". Because the structure is extracted deterministically, comparing two revisions needs no AI: index both, compare. This phase builds the diff engine and the **Changes** lens that paints the answer on the map.

## Read first

- `CLAUDE.md` (rules 1, 2, 6)
- `crates/gitvur-schema/README.md`
- `crates/gitvur-index/README.md`
- `app/src/styles/tokens.css` (diff tokens)

## Goal

The user picks two commits; the map shows the union of both structures, with every added, removed, modified, and moved element and every new or removed relationship marked, and a change list to step through them.

## Scope

**Create / modify:** `crates/gitvur-diff/**`, `crates/gitvur-schema/**` (add diff types only), `crates/gitvur-cli/**` (`diff` subcommand), `app/src-tauri/**` (new commands), `app/src/**`, `app/e2e/**`.
**Do not touch:** extractor and validator behaviour.

## Part A — Getting a revision without touching the working tree

- Use `gix` to read the tree of a commit and write its blobs into a fresh temp directory (respecting the same skip rules as the walker). **Never** check out, stash, or modify the user's working directory or index.
- Index that temp directory with `gitvur_index::index`. Cache the resulting structure in the app cache dir keyed by `(repo path hash, commit SHA, extractor version)`.
- Delete the temp directory afterwards, including on error.

## Part B — Diff engine

```rust
pub fn diff(a: &Structure, b: &Structure) -> StructureDiff;
```

Classification per element:

| Class | Rule |
| --- | --- |
| `added` | ID only in B, and no removed element in A has the same `contentHash` |
| `removed` | ID only in A, and not paired as moved |
| `modified` | ID in both, hashes differ |
| `moved` | ID only in A paired with an ID only in B with an identical `contentHash` (renamed or relocated). Pair deterministically: sort candidates by ID, match greedily |
| `unchanged` | ID in both, same hash |

- Containers: a class or file whose own hash is unchanged but which contains changed children gets `childChanged: true` (reuse the logic from the validator; move shared code into `gitvur-schema` or a small shared module rather than duplicating it).
- Edges keyed by `(from, to, type)`, with moved IDs mapped to their new IDs first: `added`, `removed`.
- Output type `StructureDiff` with `fromCommit`, `toCommit`, `elements`, `edges`, `summary` counts. Canonical and deterministic. Add it to `gitvur-schema` and regenerate schemas.
- **Description carry-over for moves:** `gitvur diff --carry-annotations` rewrites `annotations.json` IDs for moved elements (only when the hash matches, so the description is still valid). This is the only write, and only with the flag.

CLI:

```bash
gitvur diff <repo> <commitA> <commitB> [--json] [--carry-annotations]
```

Default output: a readable summary grouped by module/file with `+ − ~ →` markers.

### Tests

Create a temp git repo in the test from `fixtures/py-small`, commit, then make commits that: add a function, remove one, modify one body, rename a function without changing its body, move a function to another file, add an import. Assert every classification. Assert the original working directory files are byte-identical after the test.

## Part C — Tauri commands

```text
list_commits(path, limit = 50) -> Vec<CommitInfo { sha, short, subject, author, date }>
diff_revisions(path, from, to)  -> StructureDiff + both Structures
```

## Part D — The Changes lens

- Lens switch gains **Changes**. Selecting it opens a compact picker in the top bar: `from [commit ▾] → to [commit ▾]`, defaulting to `HEAD~1 → HEAD`, plus a "working tree" option for `to` (index the current files on disk, still read-only).
- The map renders the **union**: B's structure plus ghost nodes for removed elements, placed in their old module/file position.

Visual language (colour **and** glyph, so it works for colour-blind users and in greyscale):

| Class | Fill / border | Glyph | Text |
| --- | --- | --- | --- |
| added | `--gv-diff-added` 14% fill, solid border | `+` | normal |
| removed | no fill, dashed `--gv-diff-removed` border, 55% opacity | `−` | strikethrough |
| modified | `--gv-diff-modified` 14% fill | `~` | normal |
| moved | `--gv-diff-moved` border | `→` with tooltip "moved from …" | normal |
| unchanged | normal style at 40% opacity | none | normal |
| childChanged only | no fill, `--gv-diff-modified` hollow ring in the status slot | none | normal |

- Ancestors of any changed element auto-expand; everything else stays collapsed.
- Edge changes: when an element is selected in this lens, added edges draw in `--gv-diff-added`, removed edges dashed in `--gv-diff-removed`; unchanged edges in their normal provenance style at 50%.
- Module headers show a change summary chip, e.g. `+3 ~5 −1`.

## Part E — Change list and stepping

- A **Changes** panel replaces the explorer while the lens is active: summary bar (`+12 added · ~8 modified · −3 removed · →2 moved`), then changes grouped by module → file, each with its glyph.
- `N` / `Shift+N` step to the next/previous change: select it, centre the camera.
- Inspector for a modified element: **side-by-side** or **inline** source diff (toggle) of the old and new versions, line numbers from each revision, using the same shiki themes; added/removed lines tinted with the diff tokens at low opacity.
- For moved elements: show old and new location.

## Part F — Visual review

Screenshots (light and dark), using a mock diff built from the test scenarios:

1. Changes lens default view
2. Modified function selected with inline source diff
3. Same in side-by-side mode
4. Removed ghost node next to added nodes in the same file
5. Changes panel with stepping focus

Checklist, answers in `PROGRESS.md`:

- Can you count the changes in a module without opening it?
- Are removed elements clearly "not there any more" without being mistaken for errors?
- Does the unchanged 40% opacity keep enough context to orient?
- Greyscale check: are the four classes still distinguishable by glyph and border?

## Acceptance criteria

- [ ] Revisions read via `gix` into temp dirs; working tree untouched (tested)
- [ ] Diff classifications tested for every scenario; deterministic output
- [ ] `--carry-annotations` rewrites only moved IDs with matching hashes
- [ ] Changes lens, union rendering, auto-expand, edge diff, module chips
- [ ] Changes panel, stepping, inline and side-by-side source diff
- [ ] Screenshots reviewed

## Verify

```bash
cargo test --workspace
cargo run -p gitvur-cli -- diff <some-real-repo> HEAD~5 HEAD
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

## When done

Update `PROGRESS.md`. Stop.
