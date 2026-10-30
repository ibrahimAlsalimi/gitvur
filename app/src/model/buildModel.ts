import type {
  Annotations,
  Description,
  Edge,
  ElementStatus,
  Issue,
  RepoBundle,
  SourceRange,
  Status,
  UnresolvedCall,
} from "../generated/contract";

/** Synthetic module that holds files no logical module claims. */
export const UNASSIGNED_MODULE_ID = "module:__unassigned";
export const UNASSIGNED_MODULE_NAME = "Unassigned files";

export type NodeKind = "project" | "module" | "file" | "class" | "function";
export type DocStatus = Status;

export interface ModelNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** Parent in the merged tree: files sit under their module, modules under the project. */
  parentId: string | null;
  source?: SourceRange;
  contentHash?: string;
  description?: string;
  /** `basedOnHash` of the description shown (to tell which version it describes). */
  descriptionHash?: string;
  docStatus: DocStatus;
  /** Only set when `docStatus` is `stale`. */
  selfChanged?: boolean;
  childChanged?: boolean;
  /** True for the "Unassigned files" module, which no file on disk defines. */
  synthetic: boolean;
  /** Validation issues about this element (from report.json), errors first. */
  issues: Issue[];
  /** Set only on the Changes lens's union model (see `diffModel.ts`). */
  change?: ChangeInfo;
}

/** How an element changed between two revisions, for the Changes lens. */
export interface ChangeInfo {
  change: "added" | "removed" | "modified" | "moved" | "unchanged";
  /** A direct child changed (for `modified`: the element's own lines may not have). */
  childChanged: boolean;
  /** For `moved`: the element's ID in the older revision. */
  movedFrom?: string;
  /** Modules only: changed elements inside, by kind. */
  counts?: ChangeCounts;
}

export interface ChangeCounts {
  added: number;
  removed: number;
  modified: number;
  moved: number;
}

export interface ModelEdge extends Edge {
  /** Which file the edge came from. */
  origin: "structure" | "annotations";
  /** Changes lens only: the edge is new in B, or exists only in A. */
  change?: "added" | "removed";
}

export interface ModuleStats {
  files: number;
  classes: number;
  functions: number;
  /** Documented, stale and undocumented descendants (files, classes, functions). */
  documented: number;
  stale: number;
  undocumented: number;
  /** Error-severity issues on the module and its descendants. */
  errors: number;
  /** Rounded to an integer, 0 when the module is empty. */
  documentedPct: number;
}

export interface Totals {
  files: number;
  classes: number;
  functions: number;
  modules: number;
  /** All nodes in the merged tree, including the project and modules. */
  nodes: number;
  edges: number;
  unresolved: number;
  /** Elements that can carry a description (everything except the project and synthetic module). */
  documentable: number;
  documented: number;
  stale: number;
  undocumented: number;
  documentedPct: number;
  /** Issue counts from report.json (0 without a report). */
  errors: number;
  warnings: number;
}

export interface Model {
  rootId: string;
  projectName: string;
  nodes: Map<string, ModelNode>;
  childrenById: Map<string, string[]>;
  parentById: Map<string, string | null>;
  depthById: Map<string, number>;
  moduleStats: Map<string, ModuleStats>;
  edges: ModelEdge[];
  /** Indices into `edges`, by `from` / `to`. */
  outgoing: Map<string, number[]>;
  incoming: Map<string, number[]>;
  unresolvedByFrom: Map<string, UnresolvedCall[]>;
  /** All report issues: errors first, then by code, id and message. */
  issues: Issue[];
  totals: Totals;
}

const ROOT_ID = "project:root";
const KIND_ORDER: Record<NodeKind, number> = {
  project: 0,
  module: 1,
  file: 2,
  class: 3,
  function: 4,
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** Non-empty descriptions by id; the one matching `hash` wins, else the first. */
function pickDescription(candidates: Description[] | undefined, hash: string | undefined) {
  if (!candidates || candidates.length === 0) return undefined;
  return candidates.find((d) => d.basedOnHash === hash) ?? candidates[0];
}

/**
 * Status rules, mirroring the validator (crates/gitvur-validate/README.md):
 * no non-empty description → undocumented; one whose basedOnHash matches → documented;
 * otherwise stale. Used when report.json is missing or doesn't cover an element.
 */
function statusFromHashes(candidates: Description[] | undefined, hash: string | undefined): Status {
  if (!candidates || candidates.length === 0) return "undocumented";
  return candidates.some((d) => d.basedOnHash === hash) ? "documented" : "stale";
}

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Errors first, then by code, element id (issues without one last) and message. */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      cmp(a.code, b.code) ||
      (a.id === undefined ? 1 : 0) - (b.id === undefined ? 1 : 0) ||
      cmp(a.id ?? "", b.id ?? "") ||
      cmp(a.message, b.message),
  );
}

function descriptionsById(annotations: Annotations | null): Map<string, Description[]> {
  const byId = new Map<string, Description[]>();
  for (const d of annotations?.descriptions ?? []) {
    if (d.text.trim() !== "") push(byId, d.id, d);
  }
  return byId;
}

/** Merges structure, annotations and report into one tree. Pure. */
export function buildModel(bundle: RepoBundle): Model {
  const { structure, annotations, report } = bundle;
  const descriptions = descriptionsById(annotations);
  const reported = new Map<string, ElementStatus>(
    (report?.elements ?? []).map((e) => [e.id, e] as const),
  );
  const issues = sortIssues(report?.issues ?? []);
  const issuesById = new Map<string, Issue[]>();
  for (const issue of issues) if (issue.id !== undefined) push(issuesById, issue.id, issue);
  const nodes = new Map<string, ModelNode>();
  const structuralParent = new Map<string, string>();

  for (const n of structure.nodes) {
    const kind: NodeKind = n.type;
    const chosen = pickDescription(descriptions.get(n.id), n.contentHash);
    const node: ModelNode = {
      id: n.id,
      kind,
      name: n.name,
      parentId: n.parentId ?? null,
      docStatus:
        kind === "project"
          ? "documented"
          : (reported.get(n.id)?.status ?? statusFromHashes(descriptions.get(n.id), n.contentHash)),
      synthetic: false,
      issues: issuesById.get(n.id) ?? [],
    };
    if (n.source) node.source = n.source;
    if (n.contentHash) node.contentHash = n.contentHash;
    if (chosen) {
      node.description = chosen.text;
      node.descriptionHash = chosen.basedOnHash;
    }
    nodes.set(n.id, node);
    if (n.parentId) structuralParent.set(n.id, n.parentId);
  }
  const rootId = nodes.has(ROOT_ID) ? ROOT_ID : (structure.nodes[0]?.id ?? ROOT_ID);

  // Modules from annotations (valid ids only; the validator flags the rest).
  const fileModule = new Map<string, string>();
  const modules = [...(annotations?.modules ?? [])]
    .filter((m) => /^module:[a-z0-9-]+$/.test(m.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of modules) {
    if (nodes.has(m.id)) continue; // duplicate module id: first wins
    const node: ModelNode = {
      id: m.id,
      kind: "module",
      name: m.name,
      parentId: rootId,
      docStatus:
        reported.get(m.id)?.status ?? (m.description.trim() === "" ? "undocumented" : "documented"),
      synthetic: false,
      issues: issuesById.get(m.id) ?? [],
    };
    if (m.description.trim() !== "") node.description = m.description;
    nodes.set(m.id, node);
    for (const f of m.files) {
      if (nodes.get(f)?.kind === "file" && !fileModule.has(f)) fileModule.set(f, m.id);
    }
  }

  // Re-parent files under their module; the rest under "Unassigned files".
  for (const node of nodes.values()) {
    if (node.kind !== "file") continue;
    let moduleId = fileModule.get(node.id);
    if (moduleId === undefined) {
      if (!nodes.has(UNASSIGNED_MODULE_ID)) {
        nodes.set(UNASSIGNED_MODULE_ID, {
          id: UNASSIGNED_MODULE_ID,
          kind: "module",
          name: UNASSIGNED_MODULE_NAME,
          parentId: rootId,
          docStatus: "undocumented",
          synthetic: true,
          issues: [],
        });
      }
      moduleId = UNASSIGNED_MODULE_ID;
    }
    node.parentId = moduleId;
  }

  // Tree indexes.
  const childrenById = new Map<string, string[]>();
  const parentById = new Map<string, string | null>();
  for (const node of nodes.values()) {
    parentById.set(node.id, node.parentId);
    if (node.parentId !== null && node.id !== rootId) push(childrenById, node.parentId, node.id);
  }
  const sortKey = (id: string) => nodes.get(id) as ModelNode;
  for (const children of childrenById.values()) {
    children.sort((a, b) => {
      const x = sortKey(a);
      const y = sortKey(b);
      if (x.kind !== y.kind) return KIND_ORDER[x.kind] - KIND_ORDER[y.kind];
      if (x.kind === "module") {
        if (x.synthetic !== y.synthetic) return x.synthetic ? 1 : -1;
        return x.name.localeCompare(y.name) || (x.id < y.id ? -1 : 1);
      }
      if (x.kind === "file") return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
      const line = (x.source?.startLine ?? 0) - (y.source?.startLine ?? 0);
      return line || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    });
  }

  // Stale flags: from the report when present, otherwise the validator's rule
  // (childChanged = a direct structural child is stale; selfChanged = !childChanged).
  const structuralChildren = new Map<string, string[]>();
  for (const [child, parent] of structuralParent) push(structuralChildren, parent, child);
  for (const node of nodes.values()) {
    if (node.docStatus !== "stale") continue;
    const fromReport = reported.get(node.id);
    if (fromReport?.status === "stale" && fromReport.childChanged !== undefined) {
      node.childChanged = fromReport.childChanged;
      node.selfChanged = fromReport.selfChanged ?? !fromReport.childChanged;
    } else {
      const child = (structuralChildren.get(node.id) ?? []).some(
        (c) => nodes.get(c)?.docStatus === "stale",
      );
      node.childChanged = child;
      node.selfChanged = !child;
    }
  }

  // Depth, iteratively from the root.
  const depthById = new Map<string, number>([[rootId, 0]]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const depth = depthById.get(id) as number;
    for (const child of childrenById.get(id) ?? []) {
      depthById.set(child, depth + 1);
      stack.push(child);
    }
  }

  // Per-module counts over each module's subtree.
  const moduleStats = new Map<string, ModuleStats>();
  for (const node of nodes.values()) {
    if (node.kind !== "module") continue;
    const stats: ModuleStats = {
      files: 0,
      classes: 0,
      functions: 0,
      documented: 0,
      stale: 0,
      undocumented: 0,
      errors: node.issues.filter((i) => i.severity === "error").length,
      documentedPct: 0,
    };
    const todo = [...(childrenById.get(node.id) ?? [])];
    while (todo.length > 0) {
      const d = nodes.get(todo.pop() as string) as ModelNode;
      if (d.kind === "file") stats.files += 1;
      else if (d.kind === "class") stats.classes += 1;
      else if (d.kind === "function") stats.functions += 1;
      stats[d.docStatus] += 1;
      stats.errors += d.issues.filter((i) => i.severity === "error").length;
      todo.push(...(childrenById.get(d.id) ?? []));
    }
    stats.documentedPct = pct(stats.documented, stats.files + stats.classes + stats.functions);
    moduleStats.set(node.id, stats);
  }

  // Edges from both layers, with indexes.
  const edges: ModelEdge[] = [
    ...structure.edges.map((e) => ({ ...e, origin: "structure" as const })),
    ...(annotations?.edges ?? []).map((e) => ({ ...e, origin: "annotations" as const })),
  ];
  const outgoing = new Map<string, number[]>();
  const incoming = new Map<string, number[]>();
  edges.forEach((e, i) => {
    push(outgoing, e.from, i);
    push(incoming, e.to, i);
  });
  const unresolvedByFrom = new Map<string, UnresolvedCall[]>();
  for (const u of structure.unresolvedCalls) push(unresolvedByFrom, u.from, u);

  const totals: Totals = {
    files: 0,
    classes: 0,
    functions: 0,
    modules: 0,
    nodes: nodes.size,
    edges: edges.length,
    unresolved: structure.unresolvedCalls.length,
    documentable: 0,
    documented: 0,
    stale: 0,
    undocumented: 0,
    documentedPct: 0,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
  for (const node of nodes.values()) {
    if (node.kind === "file") totals.files += 1;
    else if (node.kind === "class") totals.classes += 1;
    else if (node.kind === "function") totals.functions += 1;
    else if (node.kind === "module" && !node.synthetic) totals.modules += 1;
    if (node.kind === "project" || node.synthetic) continue;
    totals.documentable += 1;
    totals[node.docStatus] += 1;
  }
  totals.documentedPct = pct(totals.documented, totals.documentable);

  return {
    rootId,
    projectName: bundle.manifest.projectName,
    nodes,
    childrenById,
    parentById,
    depthById,
    moduleStats,
    edges,
    outgoing,
    incoming,
    unresolvedByFrom,
    issues,
    totals,
  };
}
