# Phase 07 — Graph rendering and visual language

## Context

This is the phase the product is judged by. The map must read at a glance on a 30-file repo **and** on a 1,500-function repo, stay smooth on Linux (WebKitGTK), and look like a precise instrument rather than a generic node editor. This phase defines the design tokens, the node visual language, the layout, collapse/expand, level of detail, and performance. Relationship edges and the inspector come in Phase 08; here only hierarchy is drawn.

## Read first

- `CLAUDE.md` (frontend conventions)
- `app/src/model/buildModel.ts`
- `PROTOTYPE_V2_PLAN.md` section 9 (viewer performance risk)

## Goal

Opening a repository shows the whole project as a **nested map**: modules as containers arranged by dependency direction, files as cards inside them, and — when a file is expanded — its classes and functions as rows inside the file card. Default view: everything collapsed at file level, fitted to the window.

## Scope

**Create / modify:** `app/src/styles/**`, `app/src/canvas/**`, `app/src/layout/**`, `app/e2e/**`, `app/scripts/gen-synthetic.ts`.
**Do not touch:** Rust crates, `buildModel` semantics (extend, don't change).

## Part A — Layout decision: containment, not a strip

A pure top-to-bottom tree turns into a strip kilometres wide once a module has 40 files. Use **nested containment**:

```text
Level 1  project header bar (full width, top)
Level 2  module containers, placed by Dagre (TB) using module→module
         dependency edges aggregated from file imports/calls
Level 3  file cards packed in a grid inside each module container
Level 4  inside an expanded file: classes and functions as stacked rows,
         methods indented under their class
```

- Hierarchy is shown by **containment**, so no hierarchy edges are drawn below Level 2. Draw thin connectors only from the project header to top-rank modules.
- Module placement by dependency direction means "things that depend on others sit above them", which gives the map a meaningful vertical reading order. Cycles are allowed; Dagre breaks them.
- File grid inside a module: columns = `clamp(1, ceil(sqrt(n * 1.6)), 6)`, files sorted by path, row-major. Card height varies when expanded; rows take the tallest card in the row.
- Module size is computed from its grid; then Dagre lays out modules with those sizes. Dagre settings to start from: `rankdir: TB`, `ranksep: 96`, `nodesep: 64`, `marginx: 48`, `marginy: 48`.
- Expanding or collapsing a file re-runs the layout for **that module's grid and Level 2 only**, never the whole graph from scratch.
- Run the layout in a **Web Worker** (`app/src/layout/layout.worker.ts`) so the UI thread never blocks. The worker receives the visible model and returns positions + sizes.
- React Flow: modules and files are nodes with `parentId` (sub-flows); class/function rows are child nodes of the file with `extent: "parent"`, so each row is individually selectable and can be an edge endpoint in Phase 08.

Record this decision and its reasoning in `app/src/layout/README.md`.

## Part B — Design tokens

Fill `app/src/styles/tokens.css`. Hex values live **only** in this file. Both themes are first-class; dark is selected by `[data-theme="dark"]` or `prefers-color-scheme: dark` unless the user forced light.

Aesthetic direction: **a calm technical instrument.** Neutral, cool surfaces; one accent for selection and focus; colour carries meaning only (kind, status, provenance, change). Flat surfaces, hairline borders, no gradients, shadows only for elevation of floating panels.

Required token groups (names are binding, values are a starting point you may tune for contrast):

```text
--gv-bg-canvas        --gv-bg-surface        --gv-bg-surface-raised   --gv-bg-sunken
--gv-border-subtle    --gv-border-default    --gv-border-strong
--gv-text-primary     --gv-text-secondary    --gv-text-tertiary       --gv-text-on-accent
--gv-accent           --gv-accent-soft       --gv-focus-ring

--gv-kind-project     --gv-kind-module       --gv-kind-file
--gv-kind-class       --gv-kind-function

--gv-module-1 … --gv-module-8      # categorical, for module identity bands

--gv-status-documented   --gv-status-stale   --gv-status-undocumented   --gv-status-error
--gv-prov-syntactic      --gv-prov-semantic  --gv-prov-ai
--gv-diff-added  --gv-diff-removed  --gv-diff-modified  --gv-diff-moved

--gv-font-ui  --gv-font-code
--gv-text-xs 11px  --gv-text-sm 12px  --gv-text-md 13px  --gv-text-lg 15px  --gv-text-xl 18px
--gv-space-1 4px … --gv-space-8 32px
--gv-radius-sm 4px  --gv-radius-md 8px  --gv-radius-lg 12px
--gv-motion-fast 120ms  --gv-motion-base 180ms  --gv-ease-out cubic-bezier(.2,.8,.2,1)
--gv-shadow-float
```

Contrast requirements (check with a script, `pnpm check:contrast`, that parses `tokens.css`): text tokens ≥ 4.5:1 on their surfaces; kind, status, provenance, and diff colours ≥ 3:1 against `--gv-bg-surface` in both themes. The eight module colours must be distinguishable from each other in both themes and must not reuse the status or diff hues.

## Part C — Node visual language

Every kind has a distinct **shape signature**, not only a colour, so the map still reads in greyscale.

| Kind | Shape | Content | Size (collapsed) |
| --- | --- | --- | --- |
| Project | Full-width header bar, no border, large text | Project name, commit chip, language chips, totals | fixed height 56 |
| Module | Container, radius-lg, subtle surface, 4px identity band on the left in its module colour | Name (lg, semibold), one-line description (truncated), counts `12 files · 84 functions`, documented % as a small ring | computed from grid |
| File | Card, radius-md, raised surface, hairline border | Language glyph, file name (md, semibold), directory path (xs, tertiary, middle-truncated), child count chip, chevron | 240 × 64 |
| Class | Row, radius-sm, kind-class tint at 10% | `C` glyph in a square, name, method count | full card width × 28 |
| Function | Row, no fill, hover tint | `ƒ` glyph in a circle (methods: indented 16px, glyph outline only), name, line count in tertiary | full card width × 24 |

- Module colour is assigned deterministically: sort module IDs, assign `--gv-module-((index % 8) + 1)`. `module:__unassigned` uses neutral grey and a dashed border.
- Names never wrap: truncate with ellipsis and show the full name in a native tooltip after 500 ms.
- States for every node: default, hover (border-strong), selected (2px accent border + accent-soft fill), focused (focus ring, offset 2px), dimmed (opacity 0.28, used in Phase 08). Status badges come in Phase 09; reserve a 16px slot in the top-right of file cards and at the end of rows.
- Icons: draw the few glyphs as inline SVG components in `app/src/canvas/glyphs.tsx`; no icon font.

## Part D — Collapse, expand, level of detail

- Default: modules open, files collapsed.
- Click the chevron or press `Enter` on a focused file to expand it; `Shift+click` on a module's header toggles all its files.
- Toolbar (top-left of canvas, floating): Fit, Zoom in, Zoom out, Expand all, Collapse all, Lens switch (only "Structure" for now).
- **Semantic zoom** — three levels driven by the viewport zoom, read through a selector that only re-renders when the level changes:

| Zoom | Modules | Files | Rows |
| --- | --- | --- | --- |
| < 0.35 | Name at 2× size + counts, nothing else | Plain tiles, no text | Hidden |
| 0.35 – 0.8 | Full header | Name only | Hidden (expanded files show a compact "n items" stub) |
| > 0.8 | Full | Full | Full |

- Expand/collapse animates node positions and sizes over `--gv-motion-base` with `--gv-ease-out`. With `prefers-reduced-motion`, no animation.
- Minimap (bottom-right): modules drawn in their identity colours, files as grey blocks, viewport as an accent rectangle.
- Initial view: fit the whole map with 48px padding; if that makes zoom < 0.2, instead fit the top two ranks of modules.

## Part E — Performance

- `onlyRenderVisibleElements`, memoised node components, stable callbacks, no inline object props on nodes.
- `pnpm gen:synthetic --modules 20 --files 400 --functions 5000` writes a synthetic `RepoBundle` usable in mock mode (`?fixture=synthetic`).
- Dev-only perf overlay (`?perf=1`): FPS, visible node count, last layout ms.
- Budgets (measure and record in `PROGRESS.md`; if one is missed, record by how much and the likely cause):

| Metric | Budget |
| --- | --- |
| First layout, synthetic 5,000 functions collapsed | < 400 ms in worker |
| Expand one file with 40 children | < 50 ms to settled positions |
| Pan/zoom on synthetic, Linux `pnpm tauri dev` | ≥ 50 fps sustained |
| Memory after load, synthetic | < 400 MB |

## Part F — Visual review

Add Playwright screenshots (light and dark, 1440×900):

1. `py-small` default view
2. `py-small` with two files expanded
3. `ts-small` default view
4. `synthetic` at fit view (low LOD)
5. `synthetic` zoomed to 0.6 on one module (mid LOD)
6. Hover and selected states on a file and a function row

Then **review the screenshots as a designer would**, against this checklist, and fix issues before finishing:

- Can you tell modules, files, classes, and functions apart in under a second, in greyscale?
- Is there one clear focal point (the selection or the top module), or is everything shouting?
- Are gaps consistent (multiples of 4px), and are module containers aligned to a grid?
- Does any text clip, overlap, or touch a border?
- Do the module identity colours look like one family, and do they stay calm next to status colours?
- Does the dark theme have the same hierarchy as the light one, not just inverted colours?

Write the answers in `PROGRESS.md`.

## Acceptance criteria

- [ ] Containment layout implemented and documented; layout runs in a worker
- [ ] Tokens complete for both themes; `pnpm check:contrast` passes
- [ ] All five node kinds match the visual language table, including greyscale distinguishability
- [ ] Collapse/expand, toolbar, minimap, three LOD levels, reduced-motion behaviour
- [ ] Performance budgets measured and recorded
- [ ] Six screenshot sets captured and reviewed; review answers recorded

## Verify

```bash
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm check:contrast && pnpm e2e
pnpm dev:mock   # then open ?fixture=synthetic&perf=1
pnpm tauri dev  # Linux performance check
```

## When done

Update `PROGRESS.md` with measurements and the design review. Stop.
