# Comprehension test: answer key

**Rater: don't open this before you've answered all six questions in `comprehension.md`.**
Use it afterwards to mark each answer correct or not.

Facts are taken from `psf/black` at `408211f`. Line numbers refer to that commit.

## A1. Where does the program start?

- The `black` console script is `black:patched_main` (`pyproject.toml`, `[project.scripts]`).
  `patched_main` is in `src/black/__init__.py` (line 1943) and runs the Click command `main`
  (line 563).
- `python -m black` goes through `src/black/__main__.py`, which calls `patched_main()`.
- Correct if the answer names `patched_main` or `main` in `src/black/__init__.py`. Naming
  `__main__.py` alone is partly correct.

## A2. Who calls `format_file_contents` (`src/black/__init__.py`, line 1256)?

Callers outside the tests:

- `format_file_in_place` (`src/black/__init__.py`, line 1082)
- `format_stdin_to_stdout` (`src/black/__init__.py`, line 1158)
- the blackd request handler, which passes it to an executor with
  `partial(black.format_file_contents, …)` (`src/blackd/__init__.py`, line 232)

Tests also call it (`tests/test_black.py`, `tests/test_ipynb.py`). Correct if the answer names
the two `__init__.py` callers. Finding blackd is a bonus; note in the comment whether it was
found.

## A3. Where does Black write a reformatted file back to disk?

- `format_file_in_place` (`src/black/__init__.py`, lines 1100–1101): `open(src, "w", …)` then
  `f.write(dst_contents)`, only when `write_back` is `WriteBack.YES`.
- Related: the cache of formatted files is written by `Cache.write` (`src/black/cache.py`),
  called from `reformat_one` (`src/black/__init__.py`, line 1047) and from
  `src/black/concurrency.py` (line 279).
- Correct if the answer names `format_file_in_place`.

## B1. Which module handles caching of already-formatted files?

- `src/black/cache.py` ("Caching of formatted files with feature-based invalidation"): class
  `Cache`, with `read` and `write`.
- In Gitvur, the answer is whichever logical module holds `cache.py`. Note its name in the
  comment.
- Correct if the answer names `cache.py` or `Cache`.

## B2. If you change the class `Mode` (`src/black/mode.py`, line 303), what is affected?

- `Mode` is the formatting configuration passed through nearly the whole formatter. Files
  under `src/` that use it: `__init__.py`, `linegen.py`, `lines.py`, `comments.py`,
  `trans.py`, `strings.py`, `nodes.py`, `handle_ipynb_magics.py`, `cache.py` (the cache key
  depends on the mode), `concurrency.py`, and `src/blackd/__init__.py`.
- Correct if the answer says it is used across most of the formatter and names at least the
  cache, the line generator (`linegen.py`) and the entry point (`__init__.py`).

## B3. What changed structurally between `6f8e43f` and `408211f`?

From `gitvur diff . 6f8e43f 408211f` (10 commits), confirmed against `git diff`:

- 37 elements added, 27 modified, none removed or moved; 7 call edges added.
- New functions in `src/`: `comments.py:_get_endmarker_and_dedents`,
  `files.py:is_filesystem_root`, `handle_ipynb_magics.py:_stripped_lines`,
  `linegen.py:_starts_statement`, `ranges.py:_is_body_on_clause_line`.
- Modified in `src/`: `__init__.py:main`, `comments.py:_handle_regular_fmt_block`,
  `handle_ipynb_magics.py:mask_cell`, `linegen.py:_continues_fmt_skip_line` and
  `_prefer_split_rhs_oop_over_rhs`, `ranges.py:_TopLevelStatementsVisitor.visit_simple_stmt`
  and `_convert_unchanged_line_by_line`, `trans.py:BaseStringSplitter._iter_nameescape_slices`.
- New test-data files: `fmtskip_class_header_base.py`, `fmtskip_consecutive_statements.py`,
  `line_ranges_one_line_clauses.py`, `overlong_commented_rhs.py`; 6 new tests in
  `test_black.py`.
- Correct if the answer names at least 3 of the 5 new `src/` functions and says nothing was
  removed.
