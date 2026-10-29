# Phase 08 — Inspector and relationships

## Context

The map shows *what exists*. This phase shows *how it connects* and *what it is*: selecting any node opens the inspector with its description and real source code, and the canvas draws only the relationships that touch the selection, styled by provenance so the user always knows whether a line came from the parser or from the AI.

## Read first

- `CLAUDE.md`
- `app/src/styles/tokens.css`, `app/src/canvas/`, `app/src/layout/README.md`

## Goal

Click `login()` → the inspector shows its breadcrumb, description, source, callers and callees; the canvas dims everything unrelated and draws its edges; clicking any listed relationship flies the camera to the target and selects it.

## Scope

**Create / modify:** `app/src/inspector/**`, `app/src/canvas/edges/**`, `app/src/canvas/**` (selection and dimming), `app/src/model/**` (edge aggregation), `app/e2e/**`.
**Do not touch:** Rust crates, layout algorithm.

## Part A — Edge visual language

Default canvas shows **no relationship edges**. Edges appear for the selected node (1-hop), or for the hovered node as a lighter preview.

| Provenance | Stroke | Width | Dash | Marker |
| --- | --- | --- | --- | --- |
| `syntactic` | `--gv-prov-syntactic` | 1.5 | solid | filled arrow |
| `semantic` | `--gv-prov-semantic` | 2.5 | solid | filled arrow |
| `ai` | `--gv-prov-ai` | 1.5 | `6 4` | open arrow + small "AI" pill at the midpoint |
| ambiguous candidate | `--gv-text-tertiary` | 1 | `2 3` | none; shown only when the user expands "Possible targets" |

- Direction always caller → callee, importer → imported. Outgoing and incoming edges use the same style; the inspector separates them.
- Edge type (`calls`, `imports`, `depends_on`, `references`) is shown on hover as a small label beside the line, never on top of it.
- Curves: bezier, with endpoints on the side of the node facing the other node. Parallel edges between the same two nodes are offset, not stacked.
- **Aggregation to visible ancestors.** If an endpoint is inside a collapsed file (or a module at low LOD), draw the edge to the nearest visible ancestor and show a count badge on the line: `3 calls`. Hovering the badge lists the underlying pairs. Implement aggregation as a pure function with unit tests in `app/src/model/aggregateEdges.ts`.
- Selection depth: toolbar toggle **1-hop / 2-hop**. Second-hop edges at 50% opacity.
- **Dimming:** while something is selected, every node not in the selection's neighbourhood (itself, its ancestors, its edge endpoints) is dimmed to opacity 0.28. `Esc` clears.
- Legend: a small collapsible card at the bottom-left of the canvas listing the three provenance styles and the ambiguous style, using the real stroke rendering, not text descriptions.

## Part B — Inspector layout

The right pane, scrollable, sections separated by hairline dividers, 16px padding:

```text
Breadcrumb      Project › Authentication › login.ts › login
Header          [ƒ] login                         [status slot]
                function · src/auth/login.ts · lines 5–18   [copy path]
Description     "Checks user credentials and starts a session."
                AI-written · based on version a3f9c2        (tertiary, xs)
Source          code viewer (below)
Relationships   Calls (3) · Called by (2) · Imports · Imported by · References
                grouped lists, each item: glyph · name · file · provenance mark
Ambiguous       Possible targets for `save` (2)  [collapsed by default]
```

- **No description:** show "No description yet" in tertiary text and the one-line hint "Run the documentation agent to add one." — never an empty gap.
- **Module selected:** header, description, counts, documented %, list of files; no source section.
- **File selected:** header, description, outline of its classes and functions (clickable), imports in/out.
- **Breadcrumb** segments are clickable and select that ancestor.

## Part C — Code viewer

- `shiki`, read-only, theme following the app theme (pick one light and one dark shiki theme whose backgrounds you override with `--gv-bg-sunken`).
- Line numbers start at the node's real `startLine`. Show 3 context lines above and below, visually muted, with the node's own range on normal background.
- Loading the source goes through `read_source`; cache by `(file, contentHash)`.
- If the file is missing or the range is out of bounds: an inline warning box "Source not found at src/auth/login.ts:5–18 — the repository may have changed since it was indexed." with a **Re-index** button. Never crash, never show stale text silently.
- Long functions: cap the viewer height at 60% of the pane with internal scroll and an **Open full** toggle.
- **Evidence mode:** when the user clicks an edge (on the canvas or in the list), the code viewer switches to the evidence file and line, highlights that line with `--gv-accent-soft`, and shows a header "Evidence for: login → findById (calls, syntactic)" with a **Back** link.

## Part D — Navigation

- Clicking a relationship item: expand the ancestors needed, select the target, animate the viewport to centre it over `--gv-motion-base` (instant with reduced motion), keep zoom unless the target would be smaller than 0.6 LOD, then zoom to 0.9.
- Back/forward history of selections: `Alt+←` / `Alt+→`, and two small buttons in the inspector header.
- Explorer tree, canvas, and inspector always agree on the selection.

## Part E — Visual review

Screenshots (light and dark):

1. Function selected in `py-small` with its 1-hop edges and dimming
2. Same selection with 2-hop
3. Edge aggregated onto a collapsed file with a count badge
4. AI edge selected, inspector in evidence mode
5. Ambiguous candidates expanded
6. Missing-source warning (simulate by pointing mock data at a missing file)

Review checklist, answers in `PROGRESS.md`:

- Can you tell the three provenance styles apart without the legend? In greyscale?
- Does the selected node stay the visual focal point when 15 edges are shown?
- Do edges cross node text anywhere? If so, adjust handles or offsets.
- Is the inspector scannable top-to-bottom in five seconds: what is it, what does it do, who calls it?

## Acceptance criteria

- [ ] Edge styles, hover labels, legend, 1-hop/2-hop, dimming, aggregation with tests
- [ ] Inspector sections for function, class, file, module; empty-description state
- [ ] Code viewer with real line numbers, context, caching, evidence mode, missing-source warning
- [ ] Navigation from lists and breadcrumbs, with history
- [ ] Six screenshot sets reviewed

## Verify

```bash
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
pnpm tauri dev   # select functions in fixtures/py-small and fixtures/ts-small
```

## When done

Update `PROGRESS.md`. Stop.
