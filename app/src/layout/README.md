# Map layout

## Decision: nested containment, not a tree strip

A top-to-bottom node-link tree of the hierarchy (project → modules → files → classes →
functions) gets very wide: one module with 40 files becomes a row 40 cards long, and
the whole map turns into a thin strip that is unreadable at any zoom that fits it.

So the map shows the hierarchy by **containment** and uses node-link layout only where
it carries information, between modules:

```text
Level 1  project header bar          full width, top
Level 2  module containers           placed by Dagre (TB) along module→module dependencies
Level 3  file cards                  packed in a grid inside each module
Level 4  class / function rows       stacked inside an expanded file; methods indented
```

- **No hierarchy edges below Level 2.** Containment already says "this file is in that
  module". The only hierarchy lines are thin connectors from the project header to the
  top-rank modules.
- **Module placement has meaning.** Module edges come from the extractor's file-level
  `imports` and `calls`, aggregated to modules and deduplicated (`fromModel.ts`). The
  importer or caller depends on its target and is ranked above it, so the map reads top to
  bottom from entry points to foundations. Cycles are allowed; Dagre breaks them.
- **File grid:** `columns = clamp(1, ceil(sqrt(n × 1.6)), 6)`, files sorted by path,
  row-major. A grid row is as tall as its tallest card. The 1.6 factor makes modules
  slightly wider than tall, which suits landscape screens.
- **Sizes flow bottom-up.** Rows → file card height → module grid size → Dagre with those
  sizes (`rankdir TB, ranksep 96, nodesep 64, marginx 48, marginy 48`). Positions are snapped
  to the 4px grid so containers align.
- **Incremental.** `computeLayout` keeps a per-module grid cache keyed by a signature
  (file ids, expanded flags, row kinds and depths). Expanding or collapsing a file
  recomputes that module's grid plus the Dagre pass over modules, never the other grids.
  The worker keeps the cache between requests; `LayoutResult.recomputed` reports what was
  rebuilt.
- **Off the UI thread.** `layout.worker.ts` runs `computeLayout`; `runLayout.ts` posts the
  visible model and resolves with positions, sizes and the compute time. Where `Worker`
  doesn't exist (SSR, unit tests), it runs inline.
- **React Flow mapping.** Modules are top-level nodes; files are children (`parentId` =
  module); rows are children of their file with `extent: "parent"`. Every row is its own
  node, so Phase 08 can select it and use it as an edge endpoint. File and row positions in
  `LayoutResult` are relative to their parent, matching React Flow's sub-flows.

## Files

| File               | Role                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| `types.ts`         | `LayoutRequest` / `LayoutResult` (plain data; crosses the worker boundary)      |
| `constants.ts`     | Geometry: card sizes, paddings, row heights, Dagre settings, `gridColumns`      |
| `computeLayout.ts` | Pure layout: `computeModuleGrid`, `computeLayout(request, cache)`               |
| `fromModel.ts`     | `buildLayoutRequest(model, expandedIds)`, `moduleEdges`, `fileRows`, `moduleOf` |
| `layout.worker.ts` | Worker entry, owns the grid cache                                               |
| `runLayout.ts`     | Promise API over the worker, with inline fallback                               |
