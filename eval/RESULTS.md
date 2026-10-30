# Phase 12 results

**Template.** It gets filled in a new session after the human ratings are in
(`descriptions.csv`, `ai-edges.csv`, `comprehension.md`). Until then, every result below is
empty.

Repository: `psf/black` at `408211f4ae4ec7f119aae8a773ad14bcc6a17cba`. Protocol:
`PROTOCOL.md`.

## Targets

| Test | Target | Result | Pass? |
| --- | --- | --- | --- |
| Description accuracy | ≥ 90% correct or incomplete, 0 misleading | | |
| AI edge accuracy | ≥ 90% correct | | |
| Staleness detection | 5/5 flagged, nothing else | | |
| Comprehension | Gitvur clearly faster | | |

How each result is computed:

- **Descriptions**: (`correct` + `incomplete`) / 30, and the count of `misleading = y`. Also
  broken down by type (module, file, class, function).
- **AI edges**: `correct` / all rows. `unsure` counts as not correct, and its count is
  reported separately. If there are fewer than 10 AI edges, say so: the percentage means
  little.
- **Staleness**: from `staleness.md`.
- **Comprehension**: total time and correctness for each tool, from `comprehension.md`.
  "Clearly faster" means less total time with at least as many correct answers.

## Free metrics

| Metric | Value |
| --- | --- |
| Extractor run time (median of 3) | |
| Nodes / edges | |
| Unresolved call share | |
| Initial documentation: time, tokens / cost | |
| Incremental documentation: time, tokens / cost | |
| Viewer: load time, FPS at fit and mid zoom, memory | |

## What worked

## What failed and why

## Recommended next step

One paragraph. Choose one: improve extraction accuracy, add semantic indexers, improve agent
instructions, improve viewer scalability, or move to the next roadmap phase.
