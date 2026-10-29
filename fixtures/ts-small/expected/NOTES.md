# ts-small — decisions behind `expected/structure.json`

Written by reading the source by hand. Rule numbers refer to `crates/gitvur-schema/README.md`.
The only tool used was the `fill_expected_hashes` test helper, which fills `contentHash` from
the hand-written ranges.

Totals: 9 file nodes, 4 classes, 16 functions, 1 project node; 11 import edges, 12 call edges,
1 unresolved call.

## Files included and excluded

| Path | Decision | Rule |
| --- | --- | --- |
| `src/**/*.ts` (8 files, plus `src/types.d.ts` below) | File nodes | 7.1 |
| `src/types.d.ts` | File node only | 7.1 |
| `node_modules/left-pad/index.ts` | **Excluded** — `node_modules/` is always skipped. It defines a top-level function `render`; if it leaked in, its file and function nodes would appear (not as a `render` method candidate, because it is not a method) | 7.1 |
| `expected/*` | Ignored — not a supported extension | 7.1 |

## Required cases

| # | Case | Location | Decision | Rule |
| --- | --- | --- | --- | --- |
| 1 | `export class` with methods; two classes in one file sharing a method name | `src/views.ts`: `JsonView.render` (2–4), `TextView.render` (8–10) | Separate nodes, disambiguated by class | 1, 7.2 |
| 2 | Overload signatures plus implementation | `src/views.ts:13–17` `format` | **One** node `function:src/views.ts:format`, range 15–17 (the implementation only; signature lines 13–14 excluded). No `#2` | 1 |
| 3 | Arrow functions assigned to module-level `const` | `src/handlers.ts`: `handler` (4–7, exported), `pickView` (9–10, not exported, two-line body), `openSession` (12) | Function nodes named after the variable; range = the whole statement, including `export` and the trailing `;` | 7.2 |
| 4a | Named import with alias `import { a as b }` | `src/main.ts:3` `handler as handle`, call `:10` `handle(…)`; `src/auth/login.ts:2` `capitalize as cap`, call `:13` `cap(name)` | Import edges; call edges to the original names `handlers.ts:handler` and `util.ts:capitalize` | 3, 7.4 (1) |
| 4b | Default import | `src/main.ts:1`, `src/auth/login.ts:1` `import Repo from "…/db/repo"`; `src/main.ts:7` `new Repo(…)` | Import edges to `src/db/repo.ts`; call edge `main → class:src/db/repo.ts:Repo` (the default export) | 3, 7.4 (5) |
| 4c | Namespace import `import * as ns` | `src/handlers.ts:1` `import * as views`; `:10` `new views.TextView()`, `new views.JsonView()` | Import edge to `src/views.ts`; two call edges `pickView → TextView` / `JsonView`, both line 10. `views.JsonView` in the return type is a type reference, not a call | 3, 7.4 (2, 5) |
| 5 | Import of a directory index | `src/main.ts:2`, `src/handlers.ts:2` `from "./auth"` | Resolve to `src/auth/index.ts` (no `src/auth.ts` exists). Import edges point at the **barrel**; call edges follow the named re-exports to the real definition: `main → login.ts:login` (line 8), `openSession → class:session.ts:Session` (line 12) | 7.3, 7.4 (1) |
| 6 | `this.method()` | `src/db/repo.ts:7` `this.save(user)` inside an inline arrow callback in the constructor | Edge `Repo.constructor → Repo.save`. The arrow is not a node, so the call belongs to `constructor`; `this` resolves to the enclosing class | 7.4 (3) |
| 7 | `new Repo()` | `src/main.ts:7` | Edge to `class:src/db/repo.ts:Repo`, not to `Repo.constructor` | 3 |
| 8 | Ambiguous call (same name, two candidates) | `src/handlers.ts:6` `view.render(data)` | **Unresolved**: candidates `JsonView.render`, `TextView.render`. The type of `view` is not inferred | 4, 7.4 (4) |
| 9 | `node_modules/` directory | `node_modules/left-pad/index.ts` | Absent from the output | 7.1 |
| 10 | `.d.ts` file | `src/types.d.ts` | File node only. `interface User`, `declare function hashPassword` and `declare class AuditLog { record(): void }` produce no nodes. `src/db/repo.ts:1` `import type { User } from "../types"` resolves to it (`.ts`, `.tsx` missing, then `.d.ts`) → import edge | 7.1, 7.3 |

## Other decisions worth reviewing

| Location | Decision | Rule |
| --- | --- | --- |
| `src/auth/index.ts:1–2` `export { … } from "./…"` | Re-exports with a specifier are import edges (`index.ts → login.ts`, `index.ts → session.ts`) | 7.3 |
| `src/auth/session.ts:2` `constructor(readonly userId: string) {}` | Node `Session.constructor`, single line 2–2 | 7.2 |
| `src/db/repo.ts:4` `private readonly users = new Map<…>()` | Class field, not a node; `new Map` is outside any function node → dropped | 7.2, 7.4 |
| `src/db/repo.ts:3–17` `export default class Repo` | Class node `class:src/db/repo.ts:Repo`, range starts at the `export default` line | 7.2 |
| `src/auth/login.ts:5` `repo.findById(id)` | Receiver unknown (type annotation ignored) → exactly one method `findById` (`Repo.findById`) → **dropped**: one candidate is not enough while the receiver type is unknown | 7.4 (4) |
| `src/auth/login.ts:9` `greet(…)` | Same-file, non-exported function declared later in the file → edge `login → greet` | 7.4 (1) |
| `src/auth/login.ts:7` `new Error(…)` | Global class → dropped | 7.4 (5) |
| `src/views.ts:9` `format(String(data))` | `format` → edge to the collapsed overload node; `String` is a global → dropped | 7.4 (1) |
| `src/main.ts:9–10` `console.log(…)`; `src/views.ts:3` `JSON.stringify`; `src/util.ts:2,6` `charAt`, `toUpperCase`, `slice`, `padStart`; `src/db/repo.ts:7,11,15` `forEach`, `this.users.get`, `this.users.set`; `src/views.ts:16` `toFixed`, `trim` | All dropped: no in-repo method with those names. `this.users.get` has receiver `this.users`, not `this` | 7.4 (3, 4) |
| `src/main.ts:13` `main();` | Module-level call → dropped | 7.4 |
| `project:root` | `name: "ts-small"`; no `source` or `contentHash` | 1 |
