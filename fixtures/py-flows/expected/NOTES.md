# py-flows — hand-written expectations for contract v0.3

**HUMAN REVIEW REQUIRED before Phase 14 Part C.** These expectations were written by reading the source, before implementing entry extraction. A standalone helper computed only hashes from the explicitly declared source ranges; it did not parse Python or run Gitvur. Nothing in this fixture is executed.

Totals: 14 files, 2 classes, 12 functions and 1 project; 8 import edges, 7 function-call edges; 2 ambiguous sites; 6 deterministic entry points.

## Entry points

| Entry ID suffix | Evidence | Target / direct calls |
| --- | --- | --- |
| `console-script:flow-shop` | `pyproject.toml:6` | `flowapp.cli:main` resolves to `function:flowapp/cli.py:main` |
| `console-script:flow-window` | `pyproject.toml:9` | `[project.gui-scripts]` resolves to `function:flowapp/api.py:handle` |
| `console-script:flow-legacy` | `pyproject.toml:12` | `[tool.poetry.scripts]` resolves to the same CLI main function |
| `main-guard:flowapp-cli-py` | `flowapp/cli.py:8` | File target; direct call to `main` on line 9 |
| `main-guard:flowapp-backends-py` | `flowapp/backends.py:22` | File target; `sink.save` on line 23 is ambiguous, so `calls` is empty and the ambiguity is attributed to the entry ID |
| `package-main:flowapp` | `flowapp/__main__.py:1` | File target; direct call to imported `main` on line 3 |

Code entry names use repository-relative file paths; Python package-main uses its dotted package name. IDs slug those names. Config names are the script keys. Config evidence points to the value's source line, while main-guard evidence points to the `if` and package-main evidence starts at line 1. Top-level calls appear in entry metadata, never as new function-call edges.

## Chain, recursion and ambiguity

The static chain is six functions deep: `cli.main → service.orders.submit → domain.rules.validate → domain.text.normalize → storage.repository.store → storage.driver.commit`. It crosses the `service`, `domain` and `storage` packages. `api.handle` joins at `submit`.

- `countdown` calls itself on `flowapp/backends.py:18`: a real recursive edge.
- `persist_unknown` calls an unknown receiver's `save` on line 12. Both `Cache.save` and `Disk.save` are candidates, with no guessed edge.
- `sink = Cache()` on line 21 is outside both a function and a main guard. It is not an entry of its own in Python. The guarded receiver on line 23 remains ambiguous: assigning a constructor does not introduce type inference into the extractor.
- All class/method ranges, source-order parentage, hashes and existing conservative resolution rules are the same as v0.2.

## Agent-only wiring, reserved for Parts C–F

- `flowapp/api.py:8` registers `handle` in a route dictionary. It is not a deterministic entry point of a known kind.
- `flowapp/service/orders.py:7–8` registers `on_saved` in a dictionary and calls through a subscript lookup. No static call edge is invented. A future documented event transition can cite line 7, inside `submit`, where the handler name is visible.
- Flow annotations and `.gitvur/` output are deliberately absent until the fixture review and the remaining Phase 14 implementation.

The goldens list every file even when it only contains a package docstring. `pyproject.toml` is config data and evidence, not a source node. `expected/` contains JSON and Markdown only and contributes no source nodes.
