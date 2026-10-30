import type { Model, ModelNode, NodeKind } from "../model/buildModel";

export interface SearchEntry {
  node: ModelNode;
  /** `Store.save` for `function:shop/store.py:Store.save`; the path for files. */
  qualified: string;
  path: string;
  nameL: string;
  qualifiedL: string;
  pathL: string;
  descriptionL: string;
}

export interface SearchIndex {
  entries: SearchEntry[];
}

export type MatchField = "name" | "qualified" | "path" | "description";

export interface SearchHit {
  entry: SearchEntry;
  score: number;
  field: MatchField;
  /** Matched character positions in `node.name` (only when `field` is `name`). */
  positions: number[];
}

const cache = new WeakMap<Model, SearchIndex>();

function entryOf(node: ModelNode): SearchEntry {
  const rest = node.id.slice(node.id.indexOf(":") + 1);
  const path = node.source?.file ?? (node.kind === "file" ? rest : "");
  const qualified =
    node.kind === "file" || node.kind === "module" ? node.name : rest.slice(rest.indexOf(":") + 1);
  return {
    node,
    qualified,
    path,
    nameL: node.name.toLowerCase(),
    qualifiedL: qualified.toLowerCase(),
    pathL: path.toLowerCase(),
    descriptionL: (node.description ?? "").toLowerCase(),
  };
}

/** The search index for a model, built once per model (call it when a model loads). */
export function searchIndex(model: Model): SearchIndex {
  let index = cache.get(model);
  if (!index) {
    const entries: SearchEntry[] = [];
    for (const node of model.nodes.values()) {
      if (node.kind === "project" || node.synthetic) continue;
      entries.push(entryOf(node));
    }
    index = { entries };
    cache.set(model, index);
  }
  return index;
}

const isBoundary = (text: string, i: number) => {
  if (i === 0) return true;
  const prev = text[i - 1] ?? "";
  const ch = text[i] ?? "";
  return "/._:- #".includes(prev) || (prev === prev.toLowerCase() && ch !== ch.toLowerCase());
};

/**
 * Fuzzy subsequence match of `query` (lower case) in `textL`, using `text` for word
 * boundaries. Scores consecutive runs and word starts; `null` when not a subsequence.
 */
export function fuzzy(
  query: string,
  textL: string,
  text = textL,
): { score: number; positions: number[] } | null {
  if (query.length === 0 || query.length > textL.length) return null;
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of query) {
    let at = textL.indexOf(ch, from);
    if (at < 0) return null;
    // Prefer a later word-start match if it is close.
    const next = textL.indexOf(ch, at + 1);
    if (
      !isBoundary(text, at) &&
      at !== last + 1 &&
      next >= 0 &&
      next - at < 8 &&
      isBoundary(text, next)
    )
      at = next;
    score += 1;
    if (at === last + 1) score += 5;
    if (isBoundary(text, at)) score += 8;
    score -= Math.min(3, (at - last - 1) * 0.1);
    positions.push(at);
    last = at;
    from = at + 1;
  }
  if (textL === query) score += 40;
  else if (textL.startsWith(query)) score += 20;
  return { score, positions };
}

const KIND_ORDER: Record<NodeKind, number> = {
  module: 0,
  file: 1,
  class: 2,
  function: 3,
  project: 4,
};

/**
 * Best matches for `query`: fuzzy on names (weighted most), qualified names and paths;
 * every word of the query as a substring of the description (weighted least).
 */
export function search(index: SearchIndex, query: string, limit = 60): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const compact = q.replace(/\s+/g, "");
  const words = q.split(/\s+/);
  const hits: SearchHit[] = [];
  for (const entry of index.entries) {
    let best: SearchHit | null = null;
    const name = fuzzy(compact, entry.nameL, entry.node.name);
    if (name) best = { entry, score: name.score * 3, field: "name", positions: name.positions };
    if (!best || best.score < 60) {
      const qual = fuzzy(compact, entry.qualifiedL, entry.qualified);
      if (qual && (!best || qual.score * 2 > best.score))
        best = { entry, score: qual.score * 2, field: "qualified", positions: [] };
      const path = entry.pathL === "" ? null : fuzzy(compact, entry.pathL, entry.path);
      if (path && (!best || path.score * 1.5 > best.score))
        best = { entry, score: path.score * 1.5, field: "path", positions: [] };
    }
    if (!best && entry.descriptionL !== "" && words.every((w) => entry.descriptionL.includes(w)))
      best = { entry, score: 2 * words.length, field: "description", positions: [] };
    if (best) hits.push(best);
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER[a.entry.node.kind] - KIND_ORDER[b.entry.node.kind] ||
      (a.entry.node.id < b.entry.node.id ? -1 : 1),
  );
  return hits.slice(0, limit);
}
