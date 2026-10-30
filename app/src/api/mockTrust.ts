import type { ElementStatus, Issue, RepoBundle, Status } from "../generated/contract";

/**
 * Hand-crafted validation results for py-small (`?state=trust`), for the Phase 09 screens:
 * every status (stale with `selfChanged` and with `childChanged` only) and one issue of
 * every validator code. Undocumented elements also lose their descriptions, as they would
 * on disk. Issue messages follow the validator's wording; some ids point at elements that
 * don't exist (as a dangling reference does).
 */
const STALE_SELF = [
  "function:shop/orders.py:OrderService.receipt",
  "function:shop/utils.py:slugify",
];
const UNDOCUMENTED = [
  "file:shop/__init__.py",
  "function:shop/cache.py:Cache.lookup",
  "function:shop/models.py:Toy.label",
  "function:shop/utils.py:to_amount",
  "function:shop/utils.py:to_amount#2",
];

const ISSUES: Issue[] = [
  {
    severity: "error",
    code: "schema-invalid",
    message: "annotations.json: unknown field `confidence` at line 212 column 7",
  },
  {
    severity: "error",
    code: "dangling-ref",
    message:
      "Description refers to `function:shop/orders.py:OrderService.cancel`, which is not in the structure",
    id: "function:shop/orders.py:OrderService.cancel",
  },
  {
    severity: "error",
    code: "module-not-module",
    message: "Module id `module:Payments` is not `module:<slug>` with slug [a-z0-9-]+",
    id: "module:Payments",
  },
  {
    severity: "warning",
    code: "file-unassigned",
    message: "`file:shop/__init__.py` belongs to no module",
    id: "file:shop/__init__.py",
  },
  {
    severity: "error",
    code: "file-multi-assigned",
    message: "`file:shop/store.py` is listed in modules `module:storage` and `module:orders`",
    id: "file:shop/store.py",
  },
  {
    severity: "error",
    code: "ai-edge-no-evidence",
    message: "AI edge `function:app.py:main` → `class:shop/models.py:Book` has no evidence",
    id: "function:app.py:main",
  },
  {
    severity: "error",
    code: "ai-edge-evidence-out-of-range",
    message: "Evidence shop/orders.py:48 is past the end of the file (26 lines)",
    id: "function:shop/orders.py:OrderService.remember",
  },
  {
    severity: "warning",
    code: "ai-edge-evidence-mismatch",
    message: "Evidence line shop/orders.py:21 does not mention `save`'s target `Store.save`",
    id: "function:shop/orders.py:OrderService.remember",
  },
  {
    severity: "warning",
    code: "ai-edge-duplicates-static",
    message:
      "AI edge `function:app.py:main` → `class:shop/orders.py:OrderService` (calls) duplicates an extractor edge",
    id: "function:app.py:main",
  },
  {
    severity: "error",
    code: "ai-edge-bad-provenance",
    message: "Edge in annotations.json has provenance `syntactic`; only `ai` is allowed",
    id: "function:shop/cache.py:Cache.create",
  },
  {
    severity: "warning",
    code: "structure-out-of-date",
    message: ".gitvur/structure.json differs from a fresh index; run `gitvur index`",
  },
  {
    severity: "warning",
    code: "description-empty",
    message: "Description of `function:shop/utils.py:to_amount#2` is empty",
    id: "function:shop/utils.py:to_amount#2",
  },
];

export function trustBundle(bundle: RepoBundle): RepoBundle {
  const { structure, annotations, report } = bundle;
  if (!report || !annotations) return bundle;
  const parent = new Map(structure.nodes.map((n) => [n.id, n.parentId ?? null] as const));
  const status = new Map<string, Status>(report.elements.map((e) => [e.id, e.status] as const));
  for (const id of UNDOCUMENTED) status.set(id, "undocumented");
  const childChanged = new Set<string>();
  for (const id of STALE_SELF) {
    status.set(id, "stale");
    // Ancestors up to the file go stale with their child.
    for (
      let p = parent.get(id) ?? null;
      p !== null && p !== "project:root";
      p = parent.get(p) ?? null
    ) {
      status.set(p, "stale");
      childChanged.add(p);
    }
  }
  const elements: ElementStatus[] = report.elements.map((e) => {
    const s = status.get(e.id) ?? e.status;
    if (s !== "stale") return { id: e.id, status: s };
    const child = childChanged.has(e.id);
    return { id: e.id, status: s, childChanged: child, selfChanged: !child };
  });
  const count = (s: Status) => elements.filter((e) => e.status === s).length;
  const undocumented = new Set(UNDOCUMENTED);
  return {
    ...bundle,
    annotations: {
      ...annotations,
      descriptions: annotations.descriptions.filter((d) => !undocumented.has(d.id)),
    },
    report: {
      ...report,
      elements,
      issues: ISSUES,
      summary: {
        documented: count("documented"),
        stale: count("stale"),
        undocumented: count("undocumented"),
        errors: ISSUES.filter((i) => i.severity === "error").length,
        warnings: ISSUES.filter((i) => i.severity === "warning").length,
      },
    },
  };
}
