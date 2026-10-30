# py-small — decisions behind `expected/structure.json`

Written by reading the source by hand. Rule numbers refer to `crates/gitvur-schema/README.md`.
The only tool used was the `fill_expected_hashes` test helper, which fills `contentHash` from
the hand-written ranges.

Totals: 7 file nodes, 5 classes, 22 functions, 1 project node; 5 import edges, 13 call edges,
1 unresolved call.

## Files included and excluded

| Path | Decision | Rule |
| --- | --- | --- |
| `app.py`, `shop/*.py` (7 files) | File nodes | 7.1 |
| `shop/__init__.py` | File node (1 line, docstring only); no other nodes | 7.1, 2 |
| `build/generated.py` | **Excluded** — `build/` is in `.gitignore` and also on the always-skipped list | 7.1 |
| `scratch/notes.py` | **Excluded** — `scratch/` is in `.gitignore` (not on the skip list, so this is the case that exercises `.gitignore` alone) | 7.1 |
| `venv/lib/python3.12/site-packages/vendored.py` | **Excluded** — `venv/` is always skipped. It defines `save()`; if it leaked in it would not change the `save` candidates (it is not a method) but its file node would appear | 7.1 |
| `.gitignore`, `expected/*` | Ignored — not a supported extension | 7.1 |

## Required cases

| # | Case | Location | Decision | Rule |
| --- | --- | --- | --- | --- |
| 1 | Two classes in different files, each with `save` → ambiguous call | `shop/orders.py:21` `backend.save(item)` | **Unresolved**: candidates `Cache.save`, `Store.save`. Receiver `backend` is unknown | 4, 7.4 (4) |
| 2 | Same method names in two classes in the same file | `shop/models.py`: `Book.describe` (9–10) and `Toy.describe` (21–23); also `Book.__init__` / `Toy.__init__` | Separate nodes, disambiguated by the class in the qualified name | 1 |
| 3a | Nested function inside a function | `shop/utils.py:7–9` `with_symbol` in `format_price` | Node `format_price.with_symbol`, parent `function:…:format_price`. Call at line 11 → edge `format_price → format_price.with_symbol` | 1, 7.4 (1) |
| 3b | Nested function inside a method | `shop/store.py:12–13` `encode` in `Store.save` | Node `Store.save.encode`, parent `function:…:Store.save`. Call at line 16 (inside a list comprehension) is attributed to `Store.save` → edge to `Store.save.encode` | 1, 7.4 |
| 4 | `from pkg.mod import thing as alias`, then `alias()` | `shop/orders.py:5` `from shop.utils import format_price as fmt`; call `shop/orders.py:25` `fmt(item.price)` | Contributes to the single import edge `orders.py → utils.py`, whose evidence is line 3 (the first import of that file, see case 5). Call edge `OrderService.receipt → format_price` (line 25) | 3, 7.3, 7.4 (1) |
| 5 | `import pkg.mod` and `pkg.mod.func()` | `shop/orders.py:3` `import shop.utils`; call `shop/orders.py:24` `shop.utils.slugify(item.name)` | Import edge `orders.py → utils.py` (line 3); no edge to `shop/__init__.py`. Call edge `OrderService.receipt → slugify` (line 24) | 7.3, 7.4 (2) |
| 6 | `self.method()` inside a class | `shop/orders.py:16` `self.remember(item)`, `:17` `self.receipt(item)`; `shop/models.py:22` `self.label()` | Edges to `OrderService.remember`, `OrderService.receipt`, `Toy.label` — the enclosing class's method, not name matching (so `Book` is never considered) | 7.4 (3) |
| 7 | Constructor call `Store()` | `shop/orders.py:12` `Store(path)` (relative import), `:13` `Cache()`; `app.py:11–12` `OrderService(…)`, `Book(…)`, `Toy(…)`; `shop/cache.py:10` `Cache()` | Edges **to the class node**, never to `__init__` | 3, 7.4 (1) |
| 8 | Call to a stdlib/external function (dropped) | `app.py:13` `print`; `shop/store.py:17` `open`, `:18` `json.dump`; `shop/utils.py:19,24` `float`, `round`; `shop/store.py:15` `self.items.append` | **Dropped**. Builtins don't resolve as bare names; `json` is an external module (no name-matching fallback); `append` has no in-repo method | 4, 7.4 (1, 2, 4) |
| 9 | `__init__.py` in a package | `shop/__init__.py` | File node `file:shop/__init__.py`, name `__init__.py`. `import shop.utils` does **not** add an edge to it | 7.3 |
| 10 | `.gitignore` excluding `build/` | `build/generated.py`; also `scratch/notes.py` (`scratch/` is gitignored but not on the skip list) | Both absent from the output | 7.1 |
| 11 | `venv/` directory | `venv/…/vendored.py` | Absent from the output | 7.1 |

## Other decisions worth reviewing

| Location | Decision | Rule |
| --- | --- | --- |
| `shop/utils.py:18–19` and `:23–24`, two `def to_amount` | IDs `to_amount` and `to_amount#2` (source order); both `name: "to_amount"`. The comment on line 22 is not part of either range | 1, 7.2 |
| `shop/cache.py:8–10` `@staticmethod def create()` | Range starts at the decorator (line 8), not the `def` (line 9) | 7.2 |
| `app.py:13` `service.place(item)` | Receiver unknown → name matching finds exactly one method `place` (`OrderService.place`) → **dropped**: one candidate is not enough while the receiver type is unknown | 4, 7.4 (4) |
| `app.py:17` `main()` under `if __name__ == "__main__":` | **Dropped**: module-level call, no enclosing function node | 7.4 |
| `app.py:12` two constructor calls on one line | Two edges (different targets), same evidence line | 3 |
| `shop/orders.py:3` and `:5` both import `shop/utils.py` | **One** import edge per file pair, evidence = first import line (3) | 3 |
| `shop/orders.py:7` `from .store import Store` | Relative import resolved against package `shop/` → `shop/store.py` | 7.3 |
| `app.py:3` `import sys`, `shop/store.py:3` `import json` | External → no import edge | 3 |
| `shop/models.py:19` `self.name.upper()` | Receiver is `self.name`, not `self` → name matching for `upper` → no candidate → dropped | 7.4 (3, 4) |
| `shop/utils.py:8` `SYMBOLS.get(…)`; `shop/cache.py:16` `self.entries.get(…)` | `SYMBOLS` is a variable, not a module → name matching for `get` → no in-repo method `get` → dropped. (The cache method is named `lookup` so that a single-candidate match can't even arise here) | 7.4 (4) |
| `shop/utils.py:15` `"-".join(text.lower().split())` | All three attribute calls dropped (no in-repo methods with those names) | 7.4 (4) |
| Class ranges, e.g. `Toy` 13–23 | From the `class` line to the last line of the last method; blank lines between classes excluded | 7.2 |
| `project:root` | `name: "py-small"` (the repo directory name); no `source` or `contentHash` | 1 |
