# gitvur-index — deterministic structure extractor

Turns a repository into `.gitvur/manifest.json` and `.gitvur/structure.json` with no AI, no
network, and no execution of repository code. The same input always gives byte-identical output
(except `manifest.generatedAt`, which the caller passes in).

The contract (ID format, hashing, ordering) is in `crates/gitvur-schema/README.md`. This file
documents how the extractor applies it. Supported: **Python** (`.py`) and **TypeScript** (`.ts`,
`.tsx`, `.mts`, `.cts`, `.d.ts`). Each language is a `LanguageBackend`; the core in
`resolve.rs` is shared.

```text
src/
├── lib.rs          index(repo, opts) -> IndexOutput
├── walk.rs         file discovery
├── lang/mod.rs     LanguageBackend trait + language-independent ParsedFile
├── lang/python.rs  Python backend
├── lang/typescript.rs  TypeScript / TSX backend
├── resolve.rs      IDs, duplicate suffixes, import edges, call resolution
├── git.rs          HEAD short SHA via gix
└── output.rs       atomic write of manifest.json + structure.json
queries/python.scm      tree-sitter captures, embedded with include_str!
queries/typescript.scm  (compiled once per grammar: typescript, tsx)
```

## Files

- Walks with `ignore::WalkBuilder`. Only `.gitignore` files **inside the repo root** are honoured,
  whether or not the directory is a Git checkout. The global gitignore, `.git/info/exclude` and
  `.ignore` files are not used, because they are machine-specific. Hidden files are not skipped
  for being hidden.
- Patterns apply to tracked files too. Git itself never ignores a tracked file, but the
  extractor reads only the patterns, so a tracked file matching a `.gitignore` pattern is skipped.
- Directories always skipped, at any depth: `.git`, `.gitvur`, `node_modules`, `venv`, `.venv`,
  `__pycache__`, `dist`, `build`, `target`.
- Symlinks are never followed and never indexed (neither symlinked files nor directories), so
  nothing outside the repository is read.
- Non-UTF-8 paths are skipped with a warning. Non-UTF-8 file contents are decoded lossily with
  a warning.
- Paths are `/`-separated, relative to the root, and sorted.
- Line endings are normalised (`\r\n`, `\r` → `\n`) **before parsing**, so tree-sitter rows match
  the contract's line numbers.
- A file with a syntax error (any tree-sitter `ERROR` or `MISSING` node) produces a warning
  and becomes a file node **without children**: no definitions, imports or calls are taken
  from it. The run does not fail.

## Definitions (Python)

- `class_definition` and `function_definition` (including `async def`) at any depth. Lambdas are
  not nodes.
- **Decorator range rule:** a decorated definition's range starts at its **first decorator**
  (the `decorated_definition` node) and ends at the last line of the body.
- The parent is the nearest enclosing class or function; otherwise the file.
- Qualified names join enclosing class/function names with `.`. A duplicate qualified name in
  one file gets `#2`, `#3`… in source order. Children of a suffixed definition are qualified
  under the suffixed name (`f#2.inner`).

## Imports (Python)

Each `import` / `from … import` statement binds local names and yields `imports` edges.

| Statement | Binds | Edge to |
| --- | --- | --- |
| `import a.b` | `a.b` → module | `a/b.py`, else `a/b/__init__.py` |
| `import a.b as x` | `x` → module | same |
| `from a.b import c` where `a/b/c.py` or `a/b/c/__init__.py` exists | `c` → that module | the submodule file |
| `from a.b import c` otherwise | `c` → name `c` in `a/b.py` / `a/b/__init__.py` | that file |
| `from a.b import c as d` | `d` → as above | as above |
| `from a.b import *` | nothing | `a/b.py` / `a/b/__init__.py` |
| `from . import x`, `from ..m import y` | as above | resolved against the importing file's package; one extra dot per level up. Going above the root resolves to nothing |

- The module search root is the repository root.
- Only files that are indexed count. External packages (`json`, `requests`) produce no edge, but
  their bindings are remembered so that `json.dump()` is known to be external.
- **One edge per (importing file, imported file)**; evidence = the first import line. No
  self-edges. Parent packages get no edge (`import a.b` does not link `a/__init__.py`).
- A later import of the same local name replaces the earlier binding.

## Calls (syntactic, conservative)

Only calls inside a function definition are considered. A call is attributed to the innermost
enclosing **function**. Lambdas and comprehensions are not nodes, so their calls belong to the
enclosing function. Calls at module level, in class bodies, or in decorators of a top-level
definition are dropped.

The callee is resolved by its shape. **Exactly one candidate → `calls` edge, two or more →
`unresolvedCalls`, none → dropped**, except where noted in rule 5.

1. **`name()`** — look up `name`, in order:
   1. definitions nested directly in the caller, then in each enclosing *function* (a class
      scope is not visible to its methods, so the walk stops at a class);
   2. module-level functions and classes of the same file;
   3. a name bound by `from m import name [as alias]`: the module-level definition `name` in `m`,
      following re-exports (if `m` does not define it but itself imports it from another in-repo
      module, follow that binding; cycles stop).

   A module binding (`import x; x()`) or anything else → dropped (builtins such as `print`,
   `open`, `float`). Several matches at the first level that has any (e.g. `f` and `f#2`) →
   unresolved.
2. **`alias()`** — covered by 1.3: the alias is followed to the original name.
3. **`mod.func()` / `pkg.mod.func()`** — when the receiver's dotted text is exactly a local name
   bound to a module: that module's module-level `func` (following re-exports). External module
   or no such name → dropped, with no fallback to name matching.
4. **`self.m()` / `cls.m()`** — receiver is exactly the identifier `self` or `cls`: methods
   named `m` defined directly in the nearest enclosing class. No inheritance resolution: if the
   class has no `m`, fall through to rule 5.
5. **Anything else** (`obj.m()`, `self.attr.m()`, `f().m()`, `"x".join()`): collect every
   in-repo method (a function whose parent is a class) named `m`. **One candidate → no edge**,
   because the receiver's type is unknown; two or more → `unresolvedCalls`; zero → dropped.
   Module-level functions are never candidates.
6. **`Class()`** — any rule above that lands on a class yields an edge to the **class node**
   (never to `__init__`).

Deduplication: one `calls` edge per (caller, target), evidence = the first call line. The
evidence line is the line of the called name (the attribute name for `a.b()`). Unresolved calls
are kept per call site.

## Definitions (TypeScript)

- Grammars: `tsx` for `.tsx`; `typescript` for `.ts`, `.mts`, `.cts` and declaration files.
- `class_declaration` and `abstract_class_declaration`, exported or not → class node.
- `method_definition` **directly in a class body** → function node `Class.method`, including
  `constructor`. Object-literal methods are not nodes. Abstract methods and method signatures
  (no body) are not nodes. Getters and setters use the plain property name (`size`, not
  `get size`), so a `get`/`set` pair becomes `C.size` and `C.size#2` under the duplicate rule.
- `function_declaration` and `generator_function_declaration` at any depth → function node.
  Overload signatures are separate `function_signature` nodes and are ignored, so overloads
  collapse into the implementation, and its range is the implementation only.
- Module-level `const x = () => …` / `const x = function () …` (also exported) → function node
  `x`. `let`/`var`, non-module-level `const`, inline callbacks, and class fields holding arrow
  functions are **not** nodes; calls inside them belong to the enclosing function node.
- Ranges include `export` / `export default` (the `export_statement`). For `const`, the range is
  the whole statement. **Decorators are included**: class decorators are inside the class or
  export node; method decorators precede the method in the class body, and the range starts at
  the first of them.
- **Declaration files** (`.d.ts`, `.d.mts`, `.d.cts`): file node only. No class or function nodes
  (not even for `declare class` / `declare function`) and no calls, but their imports still
  produce `imports` edges.

## Imports (TypeScript)

| Statement | Binds |
| --- | --- |
| `import D from "./m"` | `D` → the default export of `m` |
| `import { a } from "./m"` / `import { a as b } from "./m"` | `a` / `b` → name `a` in `m` |
| `import * as ns from "./m"` | `ns` → module `m` |
| `import x = require("./m")` | `x` → module `m` |
| `import type …`, `import { type a } …` | as above; still an `imports` edge |
| `import "./m"` | nothing; still an `imports` edge |
| `export { a as b } from "./m"` | `b` → name `a` in `m` (a re-export: followed by call resolution) |
| `export { default as X } from "./m"` | `X` → the default export of `m` |
| `export * as ns from "./m"` | `ns` → module `m` |
| `export * from "./m"` | nothing; still an `imports` edge |

- Only relative specifiers resolve: `.`, `..`, `./…`, `../…`. Bare specifiers (packages) are
  external and ignored. **`tsconfig.json` `paths` / `baseUrl` aliases are out of scope.**
- Resolution order, relative to the importing file's directory: the exact path, then `+.ts`,
  `+.tsx`, `+.d.ts`, `+/index.ts`, `+/index.tsx`, `+/index.d.ts`. Only indexed files count.
  Going above the root resolves to nothing.
- Default exports: `export default class C` / `export default function f` → that definition;
  `export default name;` → whatever `name` resolves to in that file. Anonymous default exports
  (`export default () => …`, `export default class {}`) have no node and resolve to nothing.

## Calls (TypeScript)

The rules in "Calls" above apply unchanged, with these shapes:

- `f()` → rule 1. `alias()` → rule 2. Named imports follow re-exports through barrel files, so
  `import { login } from "./auth"` + `login()` links to the definition in `auth/login.ts`, while
  the `imports` edge points at `auth/index.ts`.
- `ns.f()` with `import * as ns` (or `import ns = require`) → rule 3.
- `this.m()` → rule 4 (receiver exactly `this`, nearest enclosing class; works inside arrow
  callbacks, which are not nodes). `super.m()` and `this.x.m()` → rule 5.
- `new C()` / `new ns.C()` → resolved like `C()` / `ns.C()` but **only classes** are kept, and
  never by method-name matching (`new Map()`, `new Error()` → dropped).
- `obj.m()` → rule 5 (unknown receiver; two or more in-repo methods named `m` → unresolved).
- Dynamic `import()`, calls on call results (`f()()`) and subscript calls are ignored. Calls in
  class field initialisers and at module level are dropped.

## Known limitations

- **`.js`, `.jsx`, `.mjs`, `.cjs` are not indexed** in this prototype.
- `.js` specifiers that point at `.ts` sources (`import "./x.js"` for `x.ts`, the
  NodeNext/ESM convention) are not mapped and resolve to nothing.
- `tsconfig.json` path aliases, `baseUrl` and project references are ignored.
- `export *` barrels are import edges only; names are not followed through them for calls.
- `export { a as b }` without `from` (a local rename) is not followed; `b` resolves to nothing.
- Namespaces (`namespace X { … }`) and `declare module` blocks don't qualify names; functions
  inside them are qualified as if at their enclosing level.
- No type information: `const r: Repo = …; r.find()` is an unknown-receiver call.
- **Grammar gaps:** a file the grammar can't parse becomes a childless file node with a
  warning. With tree-sitter-typescript 0.23.2 (the latest release), this hits `export type * from`
  and some multi-line call or overload signatures inside type literals. On Hono, 8 of 450 files;
  on SWR, 3 of 197.
- Python: the module search root is the repository root only (`src/` layouts don't resolve).

## Manifest

`projectName` = the repo directory name. `commitSha` = 7-character `HEAD` SHA of the repository
containing the indexed directory (found with `gix::discover`, so a subdirectory of a checkout
reports that checkout's `HEAD`), or `"uncommitted"`. `generatedAt` comes from the caller.
`languages` = the sorted set of languages with at least one indexed file.

## Output

`write_output(dir, &output)` creates `dir` and writes each file to a temporary file
(`.<name>.tmp`) that is then renamed into place.

## Dependencies

- `tree-sitter`, `tree-sitter-python`, `tree-sitter-typescript` (`typescript` + `tsx` grammars):
  parsing.
- `ignore`: `.gitignore`-aware walking.
- `gix` (`default-features = false`, `sha1`): reads `HEAD` without spawning `git`. Chosen over
  `git2` because it is pure Rust (no libgit2 / C toolchain or OpenSSL for CI and the Tauri build),
  and only `discover` + `head_id` are needed.
- `thiserror`: the library error type.
- Dev: `similar` (readable golden-test diffs), `tempfile`.
