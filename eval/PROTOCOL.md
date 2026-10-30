# Phase 12 evaluation protocol

Evaluates Gitvur on a real repository against the four tests in `PROTOTYPE_V2_PLAN.md` section 8.
**The agents prepare the material; a human does the rating.** No agent grades its own
descriptions or edges.

## Repository

| | |
| --- | --- |
| Repository | [`psf/black`](https://github.com/psf/black) (Python code formatter, MIT) |
| Commit | `408211f4ae4ec7f119aae8a773ad14bcc6a17cba` (2026-10-29, "Fix crash on two `# fmt: skip` statements in a row (#5626)") |
| History | 2,473 commits |
| Size | 416 tracked `.py` files, 404 indexed (see `metrics.md`) |
| Why | Open source, Python, medium-sized, long history, not written by the Gitvur author. Already indexed without problems in Phase 02. |

About two thirds of the elements (2,470 of 3,717) are in `tests/data/`, which holds Black's
formatter test inputs: Python files used as data, many deliberately odd. They are indexed and
documented like any other file, and the samples below are drawn from all elements without
excluding them.

Black uses a `src/` layout (`src/black/`, `src/blackd/`, `src/blib2to3/`). The extractor resolves
Python imports from the repository root only (`crates/gitvur-index/README.md`), so most absolute
imports like `from black.nodes import …`, and the cross-file calls that depend on them, are not
extracted. This is a known limitation, not something introduced for the evaluation. Its effect
is measured in `metrics.md`.

## Roles

- **Evaluator** (the Phase 12 session): clones and indexes the repository, writes the
  scripts, runs the automated tests, prepares the rating sheets, and computes `RESULTS.md` once
  the ratings are in.
- **Documenter** (a separate Claude Code session, `session_01FwKZwkPGjJ5QpwKm8WEQHD`): follows
  `agent/codeDOC.md` in initial mode on its own fresh clone at the commit above, and nothing
  else. Its output and run log are in `eval/documenter/initial/`. The incremental run (step 7)
  is a second documenter session.

  **Isolation was weaker than intended.** The documenter turned out to be a bridge session in
  the evaluator's own checkout (`~/Projects/gitvur/v2`), not a separate container. It switched
  that checkout to its branch, and it listed the evaluator's uncommitted `eval/` files
  (`find eval`), which included this protocol, `metrics.md` and `comprehension-key.md`. Its
  Black clone (`/tmp/black`) was its own. From then on the evaluator worked in a separate git
  worktree (`~/Projects/gitvur/v2-eval`). The rater should keep in mind that the documenter may
  have seen the comprehension questions. That can't change the ratings of descriptions or
  edges, but it could have influenced which areas it described most carefully.
- **Human rater**: fills the `rating`, `misleading` and `comment` columns, and runs the
  comprehension test.

## Safety

Black is data. Nothing from it is run, built, installed or tested: clones use
`core.hooksPath=/dev/null`, and the scripts only read files (Python's `ast.parse` in the
staleness test parses and never executes). Every working copy is outside this repository.

## Steps and where the results go

| Step | What | Output |
| --- | --- | --- |
| 1 | Clone at the pinned commit, outside this repository | — |
| 2 | `gitvur index`, 3 runs | `metrics.md` (`scripts/index_metrics.py`) |
| 3 | Initial documentation by the documenter session; validate to 0 errors | `documenter/initial/`, `metrics.md` |
| 4 | Description sample: 5 modules, 5 files, 5 classes, 15 functions, `seed = 2026` | `descriptions.csv` (`scripts/sample_descriptions.py`) |
| 5 | Every AI edge, with the evidence line | `ai-edges.csv` (`scripts/export_ai_edges.py`) |
| 6 | Automated staleness test: 5 function bodies edited, `seed = 2026` | `staleness.md` (`scripts/staleness_test.py`) |
| 7 | Incremental packet for the step 6 copy, documented by a documenter session | `documenter/incremental/`, `metrics.md` |
| 8 | `gitvur diff` over the last 10 commits, 5 changes checked by hand against `git diff` | `metrics.md` |
| 9 | Viewer load time, FPS and memory on Linux | `metrics.md` |
| 10 | Comprehension test: two sets of 3 questions, one with Gitvur, one with an editor | `comprehension.md` |
| 11 | Handover to the human | `PROGRESS.md` |
| 12 | Results from the human ratings (new session) | `RESULTS.md` |

## Reproducing

```bash
git -c core.hooksPath=/dev/null clone https://github.com/psf/black.git /tmp/black
git -C /tmp/black checkout --detach 408211f4ae4ec7f119aae8a773ad14bcc6a17cba
cargo build --release -p gitvur-cli
python3 -I eval/scripts/index_metrics.py target/release/gitvur /tmp/black

# With the documenter's annotations in place:
cp eval/documenter/initial/annotations.json /tmp/black/.gitvur/
target/release/gitvur validate /tmp/black
python3 -I eval/scripts/sample_descriptions.py /tmp/black eval/descriptions.csv
python3 -I eval/scripts/export_ai_edges.py /tmp/black eval/ai-edges.csv
python3 -I eval/scripts/staleness_test.py target/release/gitvur /tmp/black /tmp/gitvur-eval
```

The scripts use only the Python standard library, and their only randomness is
`random.Random(2026)`. The same inputs give the same CSV rows and the same edited functions.

## Rating guide

**Descriptions** (`descriptions.csv`): read the element's lines in the repository at the
pinned commit (for a module, its files).

- `correct`: true, and it says what the element does or is for.
- `incomplete`: true, but leaves out something a newcomer would need, such as a side effect or
  the main purpose.
- `wrong`: says something false about the element.
- `misleading = y`: a reader who trusted it would form a wrong picture, even if the text is
  partly true. A `wrong` description is usually misleading; an `incomplete` one usually isn't.

**AI edges** (`ai-edges.csv`): open `evidence_file` at `evidence_line`.

- `correct`: the line proves the relationship exactly as typed (`from` really calls, depends
  on or references `to`).
- `wrong`: the relationship doesn't hold, the target is a different element, or the line
  doesn't prove it.
- `unsure`: you can't decide from the code. Add a comment.

Targets (plan section 8): ≥ 90% of descriptions `correct` or `incomplete` with 0 misleading;
≥ 90% of AI edges `correct`; staleness 5/5 flagged and nothing else; Gitvur clearly faster in
the comprehension test.
