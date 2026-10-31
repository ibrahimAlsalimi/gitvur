# Gitvur Prototype v2 — Phase Prompts

One file per phase. Run them **in order**, one phase per Claude Code session (split a phase across sessions if it grows large). Each prompt is self-contained: it tells the agent what to read, what to build, what not to touch, and how to prove it is done.

## How to use

1. Put `CLAUDE.md`, `PROTOTYPE_V2_PLAN.md`, and this `prompts/` folder at the root of the new repository.
2. Start a fresh Claude Code session for each phase.
3. Paste this line as the first message, replacing the file name:

```text
Read CLAUDE.md, PROTOTYPE_V2_PLAN.md and prompts/02-extractor-python.md, then carry out the phase. Stop when every acceptance criterion passes and PROGRESS.md is updated.
```

4. Review the diff and the `PROGRESS.md` entry yourself before moving on. Do not start the next phase until the current gate passes.

## Order

| # | File | Layer | Gate |
| --- | --- | --- | --- |
| 00 | `00-bootstrap.md` | Infrastructure | Workspace builds, CI green |
| 01 | `01-schema-and-fixtures.md` | Infrastructure | Contract types + fixtures with expected output, **human review** |
| 02 | `02-extractor-python.md` | Extraction | Python fixture matches exactly, deterministic |
| 03 | `03-extractor-typescript.md` | Extraction | TS fixture matches exactly, deterministic |
| 04 | `04-validator-and-staleness.md` | Validation | Staleness detected per element |
| 05 | `05-agent-documentation.md` | Documentation | Agent output passes validator on fixtures |
| 06 | `06-app-shell-and-data.md` | Viewer | App opens a repo and loads merged model |
| 07 | `07-graph-rendering.md` | **Graphics** | Visual language, layout, collapse, performance |
| 08 | `08-inspector-and-relationships.md` | **Graphics / UX** | Inspector, highlighting, provenance styles |
| 09 | `09-trust-and-coverage-ui.md` | **Graphics / UX** | Stale badges, coverage overlay, warnings |
| 10 | `10-structural-diff.md` | Diff + **Graphics** | Diff crate + diff view on the map |
| 11 | `11-ux-polish.md` | **UX** | Search, keyboard, states, themes, accessibility |
| 12 | `12-evaluation.md` | Evaluation | Results recorded against the four tests |
| 13 | `13-docs-tab.md` | Feature: Docs tab | Tabs + safe Markdown reader linked to the map |
| 14 | `14-entry-points-and-flows-data.md` | Feature: Flows (data) | Contract v0.3, entry points, trace, flow validation, **human review** of new fixtures |
| 15 | `15-flows-tab.md` | Feature: Flows (**graphics**) | Swimlane flow diagrams, playback, trace, export |
| 16 | `16-Architecture-Diagram.md` | Planned revised architecture | Agent artifact, validation, interactive Diagram; see dedicated plan |
| 17 | `17-git-timeline.md` | Feature: Timeline (**graphics**) | History chart, module heatmap, branch graph, element history |

Phase 13 is independent of 14–15 and can run first or in parallel. Phase 15 needs Phase 14. Phase 17 needs Phase 10 and the tab bar from Phase 13. Phase 16 reuses Phase 13 tabs, Phase 14 packets and Phase 15 visualization/export infrastructure.

Phase 14 (data layer) and Phase 15 (Flows tab) are implemented; see `PROGRESS.md` for decisions, the visual review and known limits.

Phase 13 adds the Map/Docs tab foundation, safe Markdown reader and map backlinks. Its implementation and verification notes are recorded in `PROGRESS.md`; Phase 12 evaluation remains unfinished independently of these features.

Phase 06 may start once Phase 02 passes (it can use fixture data), but it is simpler to go in order.

## Mapping to the plan

The plan's Phase 5 (Viewer) is split here into Phases 06–09 and 11 to give the graphics and UX enough room. The plan's Phase 6 (diff) is Phase 10; the plan's Phase 7 (evaluation) is Phase 12.

## Note on fixtures

In Phase 01 the agent writes both the fixture repositories and their expected `structure.json`, **before any extractor exists**, by reading the source by hand. This keeps the expected output independent from the extractor's code. Review those expected files yourself before Phase 02 — they are the source of truth for everything that follows.

## Phase 16 — revised workflow (planned)

[Implementation plan](../PHASE_16_ARCHITECTURE_DIAGRAM.md) is the source of truth for the
revised design. The documentation agent will produce proposed `.gitvur/architecture.json`
during its existing workflow: Indexer → Documentation Agent → Architecture Artifact →
Validator → Diagram UI. The indexer supplies facts; the agent owns architecture interpretation.
The UI reads saved validated data without invoking AI. Missing data has an optional empty state;
Map, Docs and Flows remain independent and usable.

The existing directory-based Diagram and optional annotation extension predate this decision.
Their historical implementation does not complete the revised plan. `agent/codeDOC.md`
section 13 stays inactive until schema, packet and validator support land; current documentation
runs retain their existing contract. This documentation-only session must not implement Phase 16.
