# Phase 12 — Evaluation on a real repository

## Context

This phase answers the prototype's core question: is the hybrid map accurate enough to trust, and does it make a repository faster to understand? **The agent prepares the material; a human does the rating.** The agent must not grade its own descriptions or edges.

## Read first

- `PROTOTYPE_V2_PLAN.md` section 8
- `agent/codeDOC.md`
- `PROGRESS.md` (all measurements so far)

## Before starting

Ask the human which repository to use if it is not recorded in `PROGRESS.md`. Criteria: open source, Python or TypeScript, medium size (roughly 100–600 source files), long Git history, not written by the human. Record the choice, URL, and commit SHA.

## Scope

**Create:**

```text
eval/
├── PROTOCOL.md
├── scripts/            # deterministic helpers, seeded randomness only
├── descriptions.csv    # sample to rate (human fills the rating column)
├── ai-edges.csv        # every AI edge to rate (human fills the rating column)
├── staleness.md        # results of the automated staleness test
├── comprehension.md    # questions + timing sheet (human fills)
├── metrics.md          # numbers collected automatically
└── RESULTS.md          # template, filled after the human ratings
```

**Do not touch:** product code, except to fix a bug found during evaluation — record any such fix separately in `PROGRESS.md`.

## Steps

1. **Prepare.** Clone the chosen repo into a temp working copy outside this repository. Never run its scripts or install its dependencies.
2. **Index.** Run `gitvur index`. Record in `metrics.md`: files, nodes, edges, unresolved calls, unresolved share, run time (median of 3 runs).
3. **Document.** In a fresh isolated copy, follow `agent/codeDOC.md` in initial mode, in a separate session or clearly separated documenter role. Record the time taken and, if available, tokens or cost. Run `gitvur validate` until zero errors; record remaining warnings by code.
4. **Description sample.** Script picks 30 elements with a fixed seed (`seed = 2026`), stratified: 5 modules, 5 files, 5 classes, 15 functions. `descriptions.csv` columns:

```text
id, type, file, lines, description, rating (correct|incomplete|wrong), misleading (y|n), comment
```

5. **AI edges.** Every edge with provenance `ai` into `ai-edges.csv`:

```text
from, to, type, evidence_file, evidence_line, evidence_text, note, rating (correct|wrong|unsure), comment
```

6. **Staleness test (automated).** In a copy, a script modifies the bodies of 5 functions chosen with the fixed seed (append a harmless statement inside the body), runs `gitvur validate`, and checks: exactly those 5 are `stale` with `selfChanged`, their containers are `stale` with `childChanged` only, nothing else changed status. Write the result and any discrepancy to `staleness.md`.
7. **Incremental documentation cost.** Using the same copy, run `gitvur packet --mode incremental`, document only those items, and record time/cost vs the initial run.
8. **Diff check.** Run `gitvur diff` across the last 10 commits of the real repo. Record the summary counts and spot-check 5 changes by reading the actual `git diff`. Note any misclassification.
9. **Viewer metrics.** Open the repo in the app on Linux with `?perf=1` equivalent overlay: load time, FPS while panning at fit view and at mid zoom, memory. Record in `metrics.md`.
10. **Comprehension protocol.** Write `comprehension.md` with 6 questions specific to this repo, of these kinds:
    - Where does the program start?
    - Who calls <a specific important function>?
    - If I change <a specific class>, what is affected?
    - Which module handles <a specific responsibility>?
    - What changed structurally between <commit A> and <commit B>?
    - Where is <a specific side effect, e.g. DB write> performed?

    Split them into two balanced sets (A and B). The human answers set A with Gitvur and set B with a normal editor (or the reverse), timing each answer and noting correctness. Provide a table to fill in.
11. **Stop and hand over** to the human for ratings and the comprehension test.
12. **After the human fills the sheets** (new session): compute results in `RESULTS.md` against the plan's targets:

| Test | Target | Result | Pass? |
| --- | --- | --- | --- |
| Description accuracy | ≥ 90% correct or incomplete, 0 misleading | | |
| AI edge accuracy | ≥ 90% correct | | |
| Staleness detection | 5/5 flagged, nothing else | | |
| Comprehension | Gitvur clearly faster | | |

Add the free metrics (run time, unresolved share, initial vs incremental cost, viewer smoothness), then three sections: **What worked**, **What failed and why**, **Recommended next step** (one paragraph, choosing between: improve extraction accuracy, add semantic indexers, improve agent instructions, improve viewer scalability, or move to the next roadmap phase).

## Acceptance criteria

- [ ] Repo choice recorded with commit SHA
- [ ] All files in `eval/` created; sampling is reproducible from the seed
- [ ] Staleness test automated and its result recorded
- [ ] Metrics recorded
- [ ] Handover note written in `PROGRESS.md`: "HUMAN RATING REQUIRED: eval/descriptions.csv, eval/ai-edges.csv, eval/comprehension.md"
- [ ] (Second session) `RESULTS.md` completed from human ratings

## When done

Update `PROGRESS.md`. Stop.
