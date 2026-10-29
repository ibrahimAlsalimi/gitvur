# Phase 11 — UX polish: search, keyboard, states, accessibility

## Context

All features exist. This phase makes the app pleasant and dependable for daily use: finding things fast, working without a mouse, remembering where the user was, explaining itself the first time, and meeting accessibility standards. **No new features** beyond what is listed here.

## Read first

- `CLAUDE.md`
- Everything under `app/src/` (skim), `app/src/styles/tokens.css`
- All screenshot review notes in `PROGRESS.md` from Phases 06–10 — fix any that are still open first

## Scope

**Create / modify:** `app/src/**`, `app/e2e/**`.
**Do not touch:** Rust crates (except trivial fixes in `app/src-tauri` for persistence).

## Part A — Search and command palette

- `Ctrl+K` / `Cmd+K` opens a palette centred near the top, 640px wide, with shadow `--gv-shadow-float`.
- Fuzzy search over names, qualified names, file paths, and description text. Results grouped by kind, each row: glyph, name, path (tertiary), status mark. Matched characters highlighted.
- `Enter` selects and centres the result; `Ctrl+Enter` selects without moving the camera.
- Commands in the same palette, prefixed with `>`: Open repository, Index, Validate, switch lens, Expand all, Collapse all, Toggle theme, Show issues.
- Search must return in under 30 ms for the synthetic 5,000-function repo (precompute an index when the model loads).

## Part B — Keyboard map

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Search / palette |
| `Ctrl/Cmd+O` | Open repository |
| `Arrow keys` on canvas | Move focus: ↑ parent, ↓ first child, ← → siblings |
| `Enter` | Expand / collapse focused file or class |
| `Space` | Select focused node |
| `Esc` | Clear selection, close palette or drawer |
| `F` | Fit view · `0` reset zoom · `+` `-` zoom |
| `1` `2` `3` | Structure / Documentation / Changes lens |
| `Alt+← / →` | Selection history |
| `N` / `Shift+N` | Next / previous change (Changes lens) |
| `?` | Keyboard shortcuts sheet |

- The shortcuts sheet is a modal listing exactly this table.
- Canvas keyboard focus is visible (focus ring token) and scrolls the viewport to keep the focused node in view.

## Part C — Persistence

Per repository (keyed by canonical path hash), in the app data dir — never in the repo:

- expanded IDs, selected ID, viewport, lens, last diff range, pane widths.

Restore on open. If restored IDs no longer exist, drop them silently. "Reset view" in the `⋯` menu clears it.

## Part D — Every state, designed

Review every state and give it a deliberate design (title, one sentence, one action):

- Loading and indexing with progress (file count; indeterminate bar only when no count is known)
- Empty search results: "No matches for "foo"." + hint to search descriptions too
- Repository with zero supported files: "No Python or TypeScript files found."
- Very large repository (> 20,000 nodes): banner suggesting the Changes lens or module focus, never a freeze
- Rust command errors: map each `AppError.code` to a human message; show `detail` behind a "Details" disclosure
- Lost repository (folder moved or deleted): message + remove from recents

Write all user-facing strings in `app/src/copy.ts` so wording is reviewable in one place. Tone: plain, specific, no exclamation marks, no blame ("couldn't read" not "you did …").

## Part E — First-run guide

On the very first launch only (and from `⋯ → Show guide`), a three-step coach mark sequence:

1. Explorer: "Every module, file, class and function in the repository."
2. Canvas: "Click anything to see what it does and what it connects to."
3. Lens switch: "Switch lens to see documentation coverage or what changed."

Dismissible at any step; never blocks interaction.

## Part F — Themes and accessibility

- Theme setting: System / Light / Dark, in the `⋯` menu, persisted globally.
- WCAG 2.1 AA: run `@axe-core/playwright` on each main view in both themes; zero serious or critical violations.
- Explorer: `role="tree"`, `treeitem`, `aria-level`, `aria-selected`, `aria-expanded`. Canvas nodes: `aria-label` with kind, name, and status, e.g. "function login, stale". Inspector sections use headings.
- All hit targets ≥ 24×24 px; toolbar buttons have tooltips with their shortcut.
- `prefers-reduced-motion`: no camera animation, no layout animation, no coach-mark transitions.
- Window title: `Gitvur — <project name>`.
- About dialog: version, commit of Gitvur itself, MIT license text, link to the repo.

## Part G — Final visual pass

Capture the full screenshot set from Phases 06–10 again, plus: palette open, shortcuts sheet, first-run step 2, an error with details expanded, both themes.

Review against these, answers in `PROGRESS.md`:

- Is there exactly one accent colour in use for interaction, everywhere?
- Are type sizes limited to the token scale, with no stray sizes?
- Is spacing on the 4px grid everywhere?
- Does the app look like one product, or like five phases glued together? List the inconsistencies and fix them.

## Acceptance criteria

- [ ] Palette with search and commands, under 30 ms on synthetic
- [ ] Full keyboard map implemented; shortcuts sheet matches it
- [ ] Per-repo persistence with safe restore
- [ ] Every state in Part D designed; copy centralised
- [ ] First-run guide
- [ ] axe: zero serious/critical violations in both themes
- [ ] Final visual pass recorded and inconsistencies fixed

## Verify

```bash
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
pnpm tauri dev   # do a full session using only the keyboard
```

## When done

Update `PROGRESS.md`. Stop.
