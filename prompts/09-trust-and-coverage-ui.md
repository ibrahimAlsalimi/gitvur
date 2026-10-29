# Phase 09 — Trust and coverage UI

## Context

Gitvur exists to make AI-written code reviewable, so the UI must never present AI output with more confidence than it deserves. This phase makes the validator's verdict visible everywhere: what is documented, what is stale and why, what is undocumented, and what failed validation.

## Read first

- `CLAUDE.md`
- `crates/gitvur-validate/README.md` (issue codes, `selfChanged` / `childChanged`)
- `app/src/styles/tokens.css`

## Goal

At a glance the user sees how much of the map is trustworthy; on any node they see why its description is or isn't current; and they can go from any validation issue straight to the element it concerns.

## Scope

**Create / modify:** `app/src/canvas/**` (badges, lens), `app/src/inspector/**`, `app/src/panels/issues/**`, `app/src/topbar/**`, `app/e2e/**`.
**Do not touch:** Rust crates.

## Part A — Status marks on the map

Use the 16px slot reserved in Phase 07.

| Status | Mark on file cards and rows | Mark on module header |
| --- | --- | --- |
| documented | none (absence of a mark is the calm default) | — |
| stale, `selfChanged` | filled `--gv-status-stale` dot | — |
| stale, `childChanged` only | hollow `--gv-status-stale` ring | — |
| undocumented | none in Structure lens; see lens below | — |
| has validation error | small `--gv-status-error` triangle | error count chip |

Module header: a documented-% ring (already in Phase 07) whose arc is split into documented / stale / undocumented segments.

## Part B — Documentation lens

Add **Documentation** to the lens switch. In this lens:

- Node fills tint by status: documented = no tint, stale = `--gv-status-stale` at 14%, undocumented = dashed border + `--gv-status-undocumented` at 10%.
- A floating summary card (top-right of canvas): stacked bar of documented / stale / undocumented across the whole repo, with counts, and an error count.
- Clicking a segment of the bar filters the explorer tree to those elements.
- Lens choice persists per repository.

## Part C — Inspector trust section

Under the description, a one-line status with an explanation, worded exactly:

| Case | Text |
| --- | --- |
| documented | Description matches the current code. |
| stale, selfChanged | This code changed after the description was written. Treat the description as possibly outdated. |
| stale, childChanged only | Something inside this element changed; its own code did not. |
| undocumented | No description yet. |

- For `stale`, show the description at reduced emphasis (secondary text colour) with a small "possibly outdated" label — never hide it.
- **Provenance line** for every description: "AI-written · based on version a3f9c2". For AI edges in the relationships list: the `note` text and a link to its evidence.
- If the element has validation issues, list them here with their code and message.

## Part D — Issues panel

A bottom drawer (toggle from the status bar error/warning counts, or `Ctrl+Shift+M`):

- Grouped by issue code, errors first, each group collapsible with a count.
- Each row: severity icon, message, element ID (monospace, middle-truncated). Click selects and centres the element.
- Empty state: "No validation issues."

## Part E — Top bar trust summary and banners

- Top bar: compact text `214 documented · 12 stale · 30 undocumented`, plus error count if any, coloured dots before each count.
- **Banner** (below top bar, dismissible per session) when:
  - report is missing → "Not validated yet." [Validate]
  - `structure-out-of-date` → "The code changed since this map was generated." [Re-index]
  - report older than structure (compare `commitSha` and timestamps) → "Validation results are older than the map." [Validate]
- Banners use `--gv-status-stale` tint for warnings and `--gv-status-error` for errors, never the accent colour.

## Part F — Visual review

Screenshots (light and dark) using mock data with a hand-crafted report containing every status and at least one of each issue code:

1. Structure lens with stale marks visible
2. Documentation lens with summary card
3. Inspector for each of the four status cases
4. Issues panel open
5. Each banner

Checklist, answers in `PROGRESS.md`:

- Does the Structure lens still feel calm, with status marks noticeable but not dominant?
- In the Documentation lens, can you find the least-documented module in three seconds?
- Is "stale" visually distinct from "error" in both themes and in greyscale?
- Could a user mistake an AI description for verified fact anywhere? If yes, fix it.

## Acceptance criteria

- [ ] Status marks, documentation lens, summary card with filtering
- [ ] Inspector trust section with exact wording and provenance line
- [ ] Issues panel with navigation
- [ ] Trust summary and three banner conditions
- [ ] Screenshots reviewed

## Verify

```bash
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
pnpm tauri dev   # edit a function in a copy of fixtures/py-small, Validate, observe marks
```

## When done

Update `PROGRESS.md`. Stop.
