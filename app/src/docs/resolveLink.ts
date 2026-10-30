import type { ModelNode } from "../model/buildModel";

export type DocLink =
  | { kind: "anchor"; anchor: string }
  | { kind: "doc"; path: string; anchor: string }
  | { kind: "source"; id: string }
  | { kind: "folder"; path: string }
  | { kind: "external"; url: string }
  | { kind: "unsupported" };

/** Decode before normalising: encoded slashes and dot segments get the same boundary check. */
export function localPath(doc: string, href: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    return null;
  }
  if (
    decoded.includes("\\") ||
    decoded.includes(":") ||
    Array.from(decoded).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    decoded.startsWith("//")
  )
    return null;
  const parts = decoded.startsWith("/") ? [] : doc.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** Only these external schemes can ever reach the opener. Never navigate the webview. */
export function externalUrl(value: string): string | null {
  if (Array.from(value).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function resolveLink(
  doc: string,
  href: string,
  docs: readonly string[],
  nodes: readonly ModelNode[],
): DocLink {
  const external = externalUrl(href);
  if (external) return { kind: "external", url: external };
  if (href.startsWith("#")) {
    try {
      return { kind: "anchor", anchor: decodeURIComponent(href.slice(1)) };
    } catch {
      return { kind: "unsupported" };
    }
  }
  const hash = href.indexOf("#");
  const rawPath = hash < 0 ? href : href.slice(0, hash);
  let anchor: string;
  try {
    anchor = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
  } catch {
    return { kind: "unsupported" };
  }
  if (!rawPath || rawPath.includes("?")) return { kind: "unsupported" };
  const path = localPath(doc, rawPath);
  if (path === null) return { kind: "unsupported" };
  if (docs.includes(path)) return { kind: "doc", path, anchor };
  const file = nodes.find((n) => n.kind === "file" && n.source?.file === path);
  if (file) {
    const range = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(anchor);
    const line = range ? Number(range[1]) : undefined;
    const inner =
      line === undefined
        ? undefined
        : nodes
            .filter(
              (n) =>
                n.source?.file === path &&
                (n.kind === "function" || n.kind === "class") &&
                n.source.startLine <= line &&
                n.source.endLine >= line,
            )
            .sort(
              (a, b) =>
                (a.source ? a.source.endLine - a.source.startLine : Infinity) -
                  (b.source ? b.source.endLine - b.source.startLine : Infinity) ||
                a.id.localeCompare(b.id),
            )[0];
    return { kind: "source", id: inner?.id ?? file.id };
  }
  const prefix = path ? `${path}/` : "";
  if (
    docs.some((p) => p.startsWith(prefix)) ||
    nodes.some((n) => n.source?.file.startsWith(prefix))
  )
    return { kind: "folder", path: prefix };
  return { kind: "unsupported" };
}

export function qualifiedName(node: ModelNode): string {
  return node.kind === "function" || node.kind === "class"
    ? node.id.slice(node.id.lastIndexOf(":") + 1)
    : node.name;
}

export function mentionIndex(nodes: readonly ModelNode[]): Map<string, ModelNode> {
  const candidates = new Map<string, Map<string, ModelNode>>();
  for (const node of nodes) {
    if (!node.source) continue;
    const names = new Set([node.name, qualifiedName(node)]);
    if (node.kind === "file") names.add(node.source.file);
    for (const name of names) {
      const entries = candidates.get(name) ?? new Map<string, ModelNode>();
      entries.set(node.id, node);
      candidates.set(name, entries);
    }
  }
  const unique = new Map<string, ModelNode>();
  for (const [name, matches] of candidates) {
    const node = matches.values().next().value;
    if (matches.size === 1 && node) unique.set(name, node);
  }
  return unique;
}
