# Phase 15 — Flows tab: visualising how the code runs

## Context

Phase 14 produced the data: deterministic entry points and traces, agent-written entry points and flows, and validator verdicts for each. This phase builds the **Flows** tab — the visual answer to "where does this program start, and what happens next?". It should feel as immediate as a GitDiagram diagram, but every box is a real element of the code, every arrow says whether it came from the parser or the AI, and every step can be followed into the source.

This is a graphics-heavy phase. The quality bar is a diagram a senior engineer would put in an onboarding doc without editing it.

## Read first

- `CLAUDE.md`, `PROGRESS.md`
- `crates/gitvur-schema/README.md` (contract v0.3: entry points, flows, trace)
- `app/src/styles/tokens.css`, `app/src/canvas/` (node and edge visual language), `app/src/layout/`, `app/src/inspector/`, `app/src/tabs/`

## Goal

The user opens **Flows**, picks an entry point or a named flow, and sees a top-to-bottom diagram with one lane per module, numbered steps, and typed transitions. They can step through it like a debugger cursor, see each step's code in the inspector, pin the flow onto the map, switch to a deterministic **Trace** of the real call tree, and export the diagram.

## Scope

**Create / modify:** `app/src/flows/**`, `app/src/tabs/**`, `app/src/canvas/**` (map overlay only), `app/src/inspector/**` (step context), `app/src-tauri/**` (commands), `app/src/styles/tokens.css`, `app/e2e/**`, `CLAUDE.md`, `prompts/README.md`.
**Do not touch:** Rust crates other than exposing `gitvur-flow::trace` through Tauri; the contract.

### Dependencies

```text
html-to-image   # PNG/SVG export of the canvas (or justify an alternative)
```

No new graph library: use `@xyflow/react` with custom layout, like the map.

## Part A — Tauri commands

```text
get_trace(path, start, depth, maxNodes) -> Trace          # wraps gitvur_flow::trace
```

Entry points, flows, and flow status already arrive in `RepoBundle`; extend `buildModel` to index them: `entryPointsById`, `flowsByEntry`, `flowStatusById`, and for every node `flowsThroughNode`.

## Part B — Tab layout

Add **Flows** as the third tab (`Ctrl/Cmd+3`).

```text
┌────────────────┬──────────────────────────────────────────┬────────────────┐
│ Flow list      │ Flow canvas                              │ Inspector      │
│ 280px          │ mode switch: [Flow | Trace]   toolbar    │ (reused)       │
│ filter         │                                          │ + step context │
│ entry points   │ lanes · steps · transitions              │                │
│  └ flows       │                                          │                │
│                │ playback rail ●──●──◉──○──○              │                │
└────────────────┴──────────────────────────────────────────┴────────────────┘
```

### Flow list

- Grouped by entry point. Each entry row: kind glyph, name, `target` short name (tertiary), provenance mark (AI entries get the same small "AI" pill used for AI edges).
- Kind glyphs (inline SVG in `app/src/flows/glyphs.tsx`): `console-script` / `cli-command` / `package-bin` → terminal prompt; `http-route` → globe; `main-guard` / `package-main` / `top-level-call` → play triangle; `job` → clock; `event-handler` → lightning; `npm-script` → package; `test` → flask; `other` → dot.
- Flows nested under their entry: name, step count, status mark (`current` none, `stale` stale dot, `broken` error triangle).
- Entries with `target: null` are listed greyed with the `raw` value and the tooltip "Points outside the indexed code".
- Filter matches entry names, flow names, and step labels. Selection persists per repository.

## Part C — Flow mode: the curated diagram

### Layout: swimlanes by module

Write a custom layout in `app/src/flows/layoutFlow.ts` (pure, unit-tested, run in the existing layout worker):

- **Lanes:** one vertical lane per module touched by the flow, ordered by first appearance. Lane width 260px, gap 24px. Lane header pinned at the top of the viewport while scrolling: module identity colour band (4px, top), module name (semibold), file count of steps in that lane. Alternate lane backgrounds use a new token `--gv-flow-lane-alt` (very subtle); no hard lane borders.
- **Ranks (vertical position):** longest-path layering over transitions from the first step (ignore back-edges for ranking; draw them as loop-backs). Rank gap 88px.
- **Within a lane and rank:** if two steps share both, place them side by side within the lane (lane grows to fit).
- **Transitions** routed as smooth orthogonal paths with rounded corners (radius 8): down within a lane, across lanes horizontally at the midpoint between ranks. Back-edges route around the right side of the lane they start in.
- If a flow touches only one module, draw one lane centred, no header band.

### Step node visual language

| Element | Design |
| --- | --- |
| Card | 220px wide, radius-md, raised surface, hairline border; height grows with a 2-line label |
| Number badge | 22px circle at top-left, overlapping the border; step number in xs semibold |
| Label | The agent's step label, 13px semibold, max 2 lines, ellipsis |
| Code line | Kind glyph + qualified name in code font, 11.5px, tertiary, middle-truncated |
| Location | `file.py:12` in 11px tertiary, right-aligned on the code line |
| Status slot | top-right 16px: stale dot if the step is in `staleSteps` |
| Entry step | Pill shape (radius = height/2), 2px accent border, a tag above it: kind glyph + entry name, e.g. `▶ gitvur` |
| Terminal step | Steps with no outgoing transitions get a small flat bar under the card (like a stop mark) |
| Broken step | Ghost card: dashed `--gv-status-error` border, label kept, code line replaced by "Element no longer exists" |

States: default, hover, selected, focused, **active** (playback cursor: 2px accent border, accent-soft fill, slight elevation `--gv-shadow-float`), **visited** and **upcoming** (playback only, defined in Part D).

### Transition visual language

Line pattern always means **provenance** (same as the map). Marker and glyph mean **kind**.

| Kind | Marker | Label |
| --- | --- | --- |
| `call` | filled arrow | none, unless hovering (shows "calls") |
| `return` | open arrow, line at 60% opacity, thinner (1px) | "returns" on hover |
| `event` | filled arrow | ⚡ + event name, always visible |
| `async` | double chevron | ⏵⏵ + label if any |
| `branch` | filled arrow, starting from a small diamond on the source card's bottom edge | condition text, always visible |

| Provenance | Stroke |
| --- | --- |
| `syntactic` | solid, `--gv-prov-syntactic`, 1.5px |
| `semantic` | solid, `--gv-prov-semantic`, 2.5px |
| `ai` | dashed `6 4`, `--gv-prov-ai`, 1.5px, with the small "AI" pill at the midpoint |

Labels sit beside the line with a 6px gap on a surface-coloured background chip, never on top of the line or a card. Collision check: if a label would overlap a card, move it to the other side; record any remaining overlaps in the review.

Header above the canvas: flow name (xl), description (secondary), and a provenance summary chip: `9 steps · 7 from code · 2 AI` plus the status. For `stale` flows, a banner: "Some steps changed since this flow was written: steps 2, 5." For `broken`, a banner listing the validator issues with links to the issues panel.

A legend card (bottom-left, collapsible, shared design with the map legend) shows the three provenance strokes and the five kind markers rendered for real.

## Part D — Playback: following the execution line

- **Step through** controls in the toolbar and on the playback rail: Previous, Play/Pause, Next, Restart. Shortcuts: `J` next, `K` previous, `Space` play/pause, `Home` restart.
- The rail at the bottom of the canvas: one dot per step in reading order, past steps filled, current step ringed in accent, future steps hollow; branches show as a fork in the rail; clicking a dot jumps there.
- On each step: the step becomes **active**; already-visited steps stay at full opacity with a small check; not-yet-visited steps go to 0.45 opacity; the incoming transition animates a short travelling dash from source to target over 600ms (`--gv-ease-out`); the camera eases to keep the active step in the middle third of the viewport. With `prefers-reduced-motion`, no dash animation and no camera easing — just state changes.
- At a branch, Next pauses and shows the outgoing options as buttons ("if the password matches" / "otherwise"); the chosen path is followed, the other dimmed.
- Play advances every 1.6s and stops at branches and at the end.
- **Inspector during playback:** the reused inspector shows the step's node (header, description, source) plus a **Step context** section at the top: step number and label, "Called from step 3 · `AuthService.verify` line 42", and the code viewer scrolls to and highlights the **evidence line of the incoming transition** (for static calls: the call-site line from the structure edge's evidence; for AI transitions: the AI evidence line, labelled "AI evidence").

## Part E — Trace mode: the deterministic call tree

- Mode switch `[Flow | Trace]` (`T` toggles). For an entry point without flows, open in Trace mode automatically. A badge in the header: "Derived from code · no AI" for Trace, "AI-curated · validated" for Flow.
- Trace of the selected entry point, or of any function via a **Trace from here** action added to the map inspector and the step context menu.
- Layout: top-to-bottom tree with the same swimlanes-by-module layout (reuse `layoutFlow` with tree input), cards in a compact variant (no label line; qualified name as the title, 180px wide).
- Initially expanded to depth 2; each card with children shows a `+n` expander at the bottom; expanding calls `get_trace` from that node when the current trace was truncated there.
- Stubs: `ref` → small pill "↻ shown above" that scrolls to the first occurrence on click; `cycle` → pill "⟲ recursion back to `name`" with a dashed loop edge; `ambiguous` → dashed grey card "? `save` · 2 possible targets", expandable to show the candidates side by side in grey with a note "The extractor can't tell which one is called".
- Edges in Trace are all `call` kind with their real provenance.
- **Promote to flow** is out of scope (the app stays read-only); instead a **Copy trace as text** action produces the indented text format from `gitvur trace` for pasting into a prompt for the agent.

## Part F — Map integration

- **Pin flow to map:** a toolbar action. Switches to the Map tab with an overlay: every step's node gets a numbered badge (same badge design as the flow), the path is drawn in accent along the step nodes (aggregated to visible ancestors like other edges), unrelated nodes dimmed. A floating chip "Flow: User signs in ✕" removes the overlay. Playback controls work on the map too.
- **Map inspector:** a **Flows through here** section listing flows containing the node, with the step number; click opens that flow at that step.
- Docs tab (Phase 13) code mentions are unaffected.

## Part G — Export

Toolbar menu **Export**:

- **Copy as Mermaid:** `flowchart TD` with one `subgraph` per lane (module name), nodes `sN["N. label"]`, edges with labels for `event`, `async`, `branch`, dashed (`-.->`) for AI provenance, and a comment header with repo name, commit SHA, and flow status. Unit-test the generator; the output must parse with the bundled mermaid parser.
- **Export SVG / PNG** of the current canvas (both modes) at 2× scale, with the flow header and legend included, in the current theme. Saved only through a save dialog, never into the analysed repository.

## Part H — States

Strings in `app/src/copy.ts`:

| State | Message | Action |
| --- | --- | --- |
| No entry points | No entry points were found in this repository. | Trace from a function (opens map) |
| Entry points but no flows | No flows written yet. Explore the call tree, or run the documentation agent to add flows. | Open Trace |
| Entry with `target: null` | This entry point points outside the indexed code (`dist/index.js`). | — |
| Flow broken | This flow refers to code that no longer exists. | Show issues |
| Trace truncated at limit | Showing the first 300 calls. | Expand from a node |

## Part I — Tokens, accessibility, performance

- New tokens (both themes, add to `pnpm check:contrast`): `--gv-flow-lane-alt`, `--gv-flow-step-active`, `--gv-flow-visited`, `--gv-flow-rail`.
- Steps are focusable in reading order; arrow keys move along transitions (↓ next, ↑ previous, ← → between branch targets). Each step has `aria-label` "Step 3 of 9: Checks the password, AuthService.verify, in module Authentication".
- A text alternative: **List view** toggle that shows the flow as a numbered, indented list (branches as nested lists) — also the fallback for screen readers.
- Budgets: flow ≤ 25 steps lays out in < 30 ms; trace with 300 visible nodes lays out in < 150 ms in the worker and pans at ≥ 50 fps on Linux. Record measurements.

## Part J — Tests

- Unit: `layoutFlow` (lanes order, ranks, back-edges, same-rank siblings), Mermaid generator, playback state machine (linear, branch, end, restart), trace expansion merge.
- Playwright on `py-flows` and `ts-flows` mock data: open each flow, step through to the end, take a branch, toggle Trace, expand an ambiguous stub, pin to map, copy Mermaid.

## Part K — Visual review

Screenshots, light and dark, 1440×900:

1. `py-flows` flow with three lanes, at rest
2. Same flow mid-playback (active step, visited, upcoming), inspector showing step context
3. A branch decision during playback
4. A flow with an AI `event` transition and a stale step
5. Trace mode with a ref stub, a cycle, and an expanded ambiguous stub
6. Flow pinned on the map
7. Exported PNG
8. List view

Review as a designer and as a new team member; record answers in `PROGRESS.md`:

- Reading the flow at rest for 30 seconds, can you explain what happens, in order, and which modules are involved?
- Is the step label the first thing the eye reads, before the function name?
- Can you tell code-derived from AI transitions without the legend, and in greyscale?
- Does playback feel like following one cursor, or does the camera jump around?
- Do lanes help, or add noise for flows that stay in one or two modules?
- Does the exported image look finished enough to paste into a README?

Fix what the review finds before finishing.

## Acceptance criteria

- [ ] Flows tab with list, Flow and Trace modes, inspector step context
- [ ] Swimlane layout, step and transition visual language, legend, banners
- [ ] Playback with rail, branches, evidence-line highlighting, reduced-motion behaviour
- [ ] Trace with refs, cycles, ambiguous stubs, on-demand expansion, copy as text
- [ ] Pin to map, "Flows through here", "Trace from here"
- [ ] Mermaid, SVG, PNG export
- [ ] States, tokens with contrast check, keyboard and list view, budgets measured
- [ ] Tests pass; screenshots reviewed and fixes applied
- [ ] `CLAUDE.md` and `prompts/README.md` updated

## Verify

```bash
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm check:contrast && pnpm e2e
pnpm tauri dev   # open fixtures/py-flows and fixtures/ts-flows, play every flow
```

## When done

Update `PROGRESS.md`. Stop.
