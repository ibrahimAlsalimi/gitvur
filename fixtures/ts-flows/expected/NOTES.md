# ts-flows — hand-written expectations for contract v0.3

**HUMAN REVIEW REQUIRED before Phase 14 Part C.** These expectations were written by reading the source, before implementing entry extraction. A standalone helper computed only hashes from the explicitly declared source ranges; it did not parse TypeScript or run Gitvur. No package script or fixture code is executed.

Totals: 10 files, 2 classes, 13 functions and 1 project; 8 import edges, 8 function-call edges; 2 ambiguous sites; 10 deterministic entry points.

## Config entries

| Entry ID suffix | Evidence | Target |
| --- | --- | --- |
| `package-bin:flow-shop` | `package.json:3` | `file:src/cli.ts` |
| `package-main:flow-shop-main` | `package.json:4` | `null`: `dist/index.js` is not indexed. `raw` retains that path |
| `package-main:flow-shop-module` | `package.json:5` | `file:src/api.ts` |
| `package-main:flow-shop-exports` | `package.json:6` | `file:src/api.ts`, resolved relative to package.json |
| `npm-script:flow-shop-seed` | `package.json:8` | `file:src/tools/seed.ts`, extracted from `tsx src/tools/seed.ts` |

Bin map names use the bin key. Other package names combine the package name with the field/script name. `raw` keeps the original config value. Unmatched `lint` and `build` strings produce no entry; they are never executed. Config-target entries have empty `calls`: their target file's top-level-call entries describe the direct calls separately.

## Top-level statements

| Entry ID suffix | Evidence | Direct calls |
| --- | --- | --- |
| `top-level-call:src-cli-ts` | `src/cli.ts:7` | `function:src/cli.ts:main` |
| `top-level-call:src-cli-ts#2` | `src/cli.ts:8` | Same function from `void main()`; one entry per statement, suffixes in source order |
| `top-level-call:src-tools-seed-ts` | `src/tools/seed.ts:7` | `function:src/tools/seed.ts:seed` |
| `top-level-call:src-backends-ts` | `src/backends.ts:18` | `class:src/backends.ts:Cache`, a constructor call |
| `top-level-call:src-backends-ts#2` | `src/backends.ts:19` | Empty calls: `sink.save` has two in-repo candidates, recorded with this entry ID in `unresolvedCalls` |

Names for these entries are the file paths; slugs replace separators/dots with hyphens. The explicit entry at an ambiguous statement keeps uncertainty visible without choosing a target. Top-level calls never add invented function-to-function edges.

## Chain, recursion and agent-only relationships

- Six-deep static chain: `cli.main → service/orders.submit → domain/rules.validate → domain/text.normalize → storage/repository.store → storage/driver.commit`. API `handle` and tool `seed` join at `submit`.
- `src/backends.ts:15` is the recursive `countdown → countdown` edge.
- `persistUnknown` at line 10 has the same two `save` candidates as the top-level site at line 19. The receiver type annotation is not inferred.
- `src/api.ts:7` registers `handle` in a route map. A future agent can add a framework entry with evidence; the extractor does not guess one.
- `src/service/orders.ts:9` registers `onSaved` with an EventEmitter-style API. No static callback edge is invented. A future event transition can cite this line, within `submit`.
- External `node:events` contributes no import edge. The module-level `new EventEmitter()` has no in-repo target, so it creates no entry. No dependencies are installed in this fixture.

`package.json` is read as config/evidence and is not a source node. Flow annotations and `.gitvur/` are intentionally absent pending human review and Parts C–F. Existing v0.2 fixtures are unchanged.
