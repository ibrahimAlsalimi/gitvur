# Phase 16 — Timeline tab: the repository's Git history, structurally

## Context

Gitvur already compares two revisions (Phase 10, Changes lens). This phase adds a **Timeline** tab that shows the whole history at once: when the code changed, **which modules and elements** changed in each commit (not just which files), how branches and merges flow, and which commits say they were written with an AI tool. From any point on the timeline the user can jump to the map in the Changes lens.

Like everything in Gitvur, the timeline is **read-only** and **deterministic**: no checkout, no AI, nothing written to the analysed repository.

## Read first

- `CLAUDE.md`, `PROGRESS.md` (follow the real code; record deviations)
- `crates/gitvur-diff/` and how Phase 10 reads revisions with `gix`
- `crates/gitvur-index/` (language backends)
- `app/src/tabs/`, `app/src/styles/tokens.css`, the Changes lens code

## Goal

The user opens **Timeline** and sees: an activity chart over time, a module × time heatmap, and a commit list with a branch graph. Selecting a commit shows its structural changes grouped by module; brushing a time range or picking two commits opens the map in the Changes lens for exactly that range. Any element's inspector gains a **History** section.

## Scope

**Create / modify:**

```text
crates/gitvur-history/**      # new crate: commit walk, per-commit structural deltas, cache
crates/gitvur-index/**        # expose per-file extraction (no change to structure.json)
crates/gitvur-cli/**          # `gitvur log` subcommand
app/src-tauri/**              # timeline commands + background job
app/src/timeline/**
app/src/inspector/**          # History section
app/src/tabs/**, app/src/styles/tokens.css, app/e2e/**
CLAUDE.md, prompts/README.md
```

**Do not touch:** the data contract files in `.gitvur/`, extractor output for full indexing, validator.

## Part A — Why per-file deltas

Indexing the full repository at every commit is too slow for long histories. Element-level changes (added, removed, modified) only need the **nodes and hashes of the files a commit touched**, which per-file extraction gives without cross-file resolution. Edges and the full structural diff are computed only when the user opens a specific range in the Changes lens (Phase 10 path).

Record this decision in `crates/gitvur-history/README.md`.

## Part B — Rust: `gitvur-history`

### Per-file extraction

Expose from `gitvur-index`:

```rust
pub fn extract_file_nodes(rel_path: &str, bytes: &[u8]) -> Option<Vec<FileNode>>; // None for unsupported languages
```

Same qualified-name, ID, range, and hash rules as the full extractor; a test asserts that for every file in both fixtures the result equals the nodes of that file in the full `structure.json`.

### Commit walk

```rust
pub fn list_commits(repo: &Path, opts: &LogOptions) -> Result<Vec<CommitInfo>>;
pub fn commit_delta(repo: &Path, sha: &str, cache: &Cache) -> Result<CommitDelta>;
```

- `CommitInfo`: `sha`, `short`, `parents`, `authorName`, `authorEmail`, `authorTime`, `committerTime`, `subject`, `body`, `refs` (branch and tag names pointing at it), `aiTrailer` (below).
- Walk from `HEAD` by default (option: all local branches), newest first, topological order, default limit **500** commits (option in the UI: 500 / 2,000 / all).
- `CommitDelta` against the **first parent** (root commit: against empty tree): changed files (added / deleted / modified / renamed via `gix` rename detection), and for supported languages the element changes per file: `added`, `removed`, `modified` (same ID, different hash), `moved` (removed + added with identical hash, same pairing rule as Phase 10). Merge commits: delta against first parent, plus a `merge: true` flag.
- **Cache:** extraction results keyed by **blob SHA** (a file's content determines its nodes), stored in the app cache dir, never in the repo. Deltas keyed by commit SHA + extractor version.
- Nothing is checked out; blobs are read from the object database.

### AI trailer detection

A deterministic, labelled heuristic based **only on commit message text and author**:

- trailers `Co-Authored-By:` whose name or email matches a configurable list (default: `claude`, `anthropic`, `copilot`, `codex`, `openai`, `cursor`, `aider`, `devin`, `gemini`), case-insensitive;
- lines like `Generated with`, `🤖 Generated` followed by a tool name from the list;
- author or committer names ending in `[bot]`.

`aiTrailer`: `{ "matched": true, "rule": "co-authored-by", "text": "Co-Authored-By: Claude …" }` or `null`. The UI always calls this **"Commit message mentions an AI tool"** — never "AI-written", because it is a claim in the message, not a verified fact. The list is editable in settings.

### Module mapping over time

Map each changed file to a module using `annotations.json` at **HEAD**. Files that do not exist at HEAD (deleted or renamed away) map by rename chain when available, otherwise to a synthetic **Removed or moved files** group. Document this; the UI shows a small note on that group.

### CLI

```bash
gitvur log <repo> [--limit 50] [--json]
```

Prints one line per commit: short SHA, date, `+a ~m −r →v` element counts, AI mark, subject.

### Tests

Build a temp git repo in the test (from `fixtures/py-small`) with: linear commits, a branch and a merge, a rename, a deleted file, a commit with a `Co-Authored-By: Claude` trailer, a commit touching only a Markdown file. Assert commit order, deltas, merge handling, rename → `moved`, AI detection, cache hits on the second run, and that the working tree is byte-identical after the test.

## Part C — Tauri commands and background job

```text
timeline_commits(path, limit, allBranches) -> Vec<CommitInfo>
timeline_start_deltas(path, shas)          -> JobId     # computes deltas in a background thread
timeline_job_status(jobId)                 -> { done, total, failed }
timeline_deltas(path, shas)                -> Vec<CommitDelta>   # cached ones only
cancel_job(jobId)
element_history(path, nodeId, limit)       -> Vec<{ sha, change: "added|modified|moved|removed" }>
```

- Commits load first (fast); the UI renders immediately and fills structural data as deltas arrive, newest first. Progress shown in the status bar: "Analysing history… 140 / 500".
- Switching repository or tab away cancels nothing that is cached, but stops computing.
- `element_history` walks commit deltas for the element's file (following renames) and returns the commits where its ID or hash changed.

## Part D — Layout and visual design

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header: range picker (Last 30 days · 90 days · 1 year · All) · branch filter │
│         · "Only commits mentioning AI" toggle · search commits                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Activity chart — full width, 120px                                           │
│ stacked bars per bucket: added · modified · removed elements; brush to select│
├──────────────────────────────────────────────────────────────────────────────┤
│ Module heatmap — rows = modules, columns = same buckets as the chart         │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ Commit list with branch graph                 │ Commit detail                │
│ graph lanes · subject · refs · counts · date  │ (or range summary)           │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

The chart, heatmap, and commit list share **one time axis and one selection**: hovering a bucket highlights its commits; selecting a commit marks its bucket; brushing a range filters the list.

### Activity chart

- Bucket size chosen from the visible range: day (≤ 60 days), week (≤ 2 years), month (beyond). Labels say which.
- Stacked bars in this order from the baseline: modified (`--gv-diff-modified`), added (`--gv-diff-added`), removed (`--gv-diff-removed`), all at 85% opacity, 1px gap between bars, no outlines. Buckets with only non-code commits show a thin neutral tick so activity is never invisible.
- Y axis: element changes, 3–4 gridlines (`--gv-border-subtle`), labels in xs tertiary. X axis: dates in the user's locale.
- Commits mentioning AI: a small marker row under the axis (one 4px dot per bucket containing such commits, `--gv-prov-ai`).
- **Brush:** drag across the chart to select a range; the selection shows as an accent-soft band with handles and a floating chip "Mar 3 → Apr 12 · 38 commits · Compare on map". `Esc` clears.
- Tooltip per bucket: date range, commits, `+a ~m −r`, top 3 modules.

### Module heatmap

- One row per module, ordered like the map (by dependency rank), with the module identity colour band at the left of the row label.
- Cell colour: the module's identity colour at an opacity scaled by change count (log scale, 5 steps from 0 to 90%); zero = empty cell with a faint grid. A legend shows the 5 steps.
- Hovering a cell: "Authentication · week of Mar 10 · 14 element changes in 3 commits"; clicking filters the commit list to those commits and that module.
- Rows collapse to the top 12 modules by total activity with "Show all modules (20)".

### Commit list with branch graph

- Virtualised list (handles 10,000 rows smoothly), row height 36px.
- **Graph column:** standard lane assignment (`git log --graph` style) computed in a pure, unit-tested TS function `layoutCommitGraph`: each commit a 8px dot in its lane, lines to parents, merges as curves; first-parent lane stays leftmost. Lane colours cycle through 6 calm tokens `--gv-graph-1…6` (new, distinct from module colours). Max 8 visible lanes; extra lanes collapse into a "+n" edge marker.
- Row content: subject (truncated), ref pills (branch: outlined, tag: filled neutral, `HEAD`: accent outline), AI mark when `aiTrailer` (small "AI" pill with tooltip showing the matched text and "Commit message mentions an AI tool"), element counts `+3 ~5 −1` in diff colours (or "no code changes" in tertiary), author name, relative date (absolute on hover).
- Merge commits: dot drawn as a ring.

### Commit detail (right pane)

- Header: subject (lg), short SHA with copy button, author, absolute date, parents (clickable), refs.
- Full message body in a code-font block if present; AI trailer line highlighted when detected.
- **Structural changes** grouped by module → file → elements, each with its `+ ~ − →` glyph and kind glyph; clicking an element opens the map in the Changes lens for `parent → commit` and selects it.
- **Other files** (unsupported languages, Markdown, config) listed separately with status letters.
- Actions: **Show on map** (Changes lens, parent → this commit), **Compare with…** (pick another commit), **Copy SHA**.

### Range summary

When a range is brushed or two commits are selected (`Shift+click`): totals, commits, authors, AI-mentioning commits count, top modules by change, and **Compare on map**, which opens the Changes lens with `older → newer` (full Phase 10 diff, including edges).

## Part E — Element history in the inspector

In the Map tab inspector, a **History** section for files, classes, and functions:

- A compact sparkline (last 12 months, bucketed like the chart) of commits that changed the element.
- List of those commits (subject, date, change type, AI mark), newest first, first 10 with "Show all".
- Clicking a commit opens the Changes lens for `parent → commit` with the element selected.
- Loaded lazily when the section is expanded; "Analysing history…" until the needed deltas exist.

## Part F — Tabs, keyboard, states

- **Timeline** becomes the fourth tab (`Ctrl/Cmd+4`). If Phase 15 is not built yet, it is the third (`Ctrl/Cmd+3`); keep shortcut assignment in one place.
- Keyboard: `↑ ↓` move in the commit list, `Enter` opens detail, `Shift+↑/↓` extends a range selection, `M` shows the selected commit or range on the map, `/` focuses commit search.
- Search commits by subject, body, author, SHA prefix.
- States (`app/src/copy.ts`):

| State | Message | Action |
| --- | --- | --- |
| Not a Git repository | This folder isn't a Git repository, so there's no history to show. | — |
| Single commit | Only one commit so far. | Show on map |
| Shallow clone | History is incomplete (shallow clone); showing what's available. | — |
| Still analysing | Structural changes appear as history is analysed. | — |
| No commits in range | No commits in this range. | Reset range |

- Persist per repository: range, branch filter, AI-only toggle, selected commit.

## Part G — Tokens, accessibility, performance

- New tokens in both themes, added to `pnpm check:contrast`: `--gv-graph-1…6`, `--gv-heat-empty`, `--gv-brush`.
- Chart and heatmap have text alternatives: a visually hidden table per view, and every bar/cell is reachable by keyboard with an `aria-label` carrying its numbers.
- Budgets (record in `PROGRESS.md`): 500 commits listed in < 300 ms; deltas for 500 commits of a medium repo, cold cache, in the background without UI jank; warm cache < 1 s; commit list scrolls at 60 fps with 10,000 rows; chart + heatmap re-render on brush in < 16 ms.

## Part H — Tests

- Rust: Part B tests, plus per-file extraction equality with the full extractor.
- Unit (TS): `layoutCommitGraph` (linear, branch, merge, octopus merge, > 8 lanes), bucketing, heatmap scale, AI filter.
- Playwright on a mock history generated from the Part B scenario repo plus a synthetic 2,000-commit history: brush a range, compare on map, open a commit's element on the map, element history from the inspector, AI-only filter.

## Part I — Visual review

Screenshots, light and dark, 1440×900:

1. Timeline default (last 90 days) with chart, heatmap, and list
2. Brushed range with the summary pane
3. Commit detail with structural changes and an AI trailer
4. Branch graph with a merge
5. Heatmap with all modules expanded
6. Inspector History section with sparkline
7. Still-analysing state with partial data

Review and record in `PROGRESS.md`:

- Can you tell in five seconds which module changed most last month?
- Do the chart, heatmap, and list read as one linked view, aligned on the same time axis?
- Are diff colours, module colours, and graph lane colours clearly different families?
- Is the AI mark honest (a claim from the message) and not louder than the code changes?
- Does the page stay calm with 2,000 commits, or does it become noise?

Fix what the review finds before finishing.

## Acceptance criteria

- [ ] `gitvur-history` with per-file extraction, commit walk, deltas, rename/move handling, cache, AI trailer detection; working tree untouched (tested)
- [ ] `gitvur log` CLI
- [ ] Background delta job with progress and cancellation
- [ ] Activity chart with brush, module heatmap, virtualised commit list with branch graph, commit detail, range summary — all linked
- [ ] Jump to Changes lens from commit, element, and range
- [ ] Inspector History section
- [ ] Tab, keyboard, search, states, persistence
- [ ] Tokens with contrast check, accessibility alternatives, budgets measured
- [ ] Tests pass; screenshots reviewed and fixes applied
- [ ] `CLAUDE.md` (new crate, `log` command, AI-trailer wording rule) and `prompts/README.md` updated

## Verify

```bash
cargo test --workspace
cargo run -p gitvur-cli -- log <some-real-repo> --limit 30
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm check:contrast && pnpm e2e
pnpm tauri dev   # open a real repo with a few hundred commits
```

## When done

Update `PROGRESS.md`. Stop.
