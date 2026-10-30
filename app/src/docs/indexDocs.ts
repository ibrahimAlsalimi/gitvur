import GithubSlugger from "github-slugger";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { ModelNode } from "../model/buildModel";
import { mentionIndex, resolveLink } from "./resolveLink";

export interface Heading {
  id: string;
  text: string;
  depth: number;
}
export interface IndexedDoc {
  path: string;
  title: string;
  headings: Heading[];
}
export interface Mention {
  path: string;
  title: string;
  anchor: string;
  nodeId: string;
}
export interface DocsIndex {
  docs: IndexedDoc[];
  mentions: Record<string, Mention[]>;
}
interface SyntaxNode {
  type: string;
  value?: string;
  url?: string;
  depth?: number;
  identifier?: string;
  children?: SyntaxNode[];
}
const parser = unified().use(remarkParse).use(remarkGfm);
function text(node: SyntaxNode): string {
  return node.value ?? node.children?.map(text).join("") ?? "";
}

/** AST indexing excludes fenced code, raw HTML and ambiguous names. Runs in a worker. */
export function indexDocs(
  docs: { path: string; title: string; text: string }[],
  nodes: ModelNode[],
): DocsIndex {
  const result: DocsIndex = { docs: [], mentions: {} };
  const names = mentionIndex(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const doc of docs.slice(0, 500)) {
    const headings: Heading[] = [];
    const slugger = new GithubSlugger();
    let anchor = "";
    const seen = new Set<string>();
    function add(id: string) {
      const node = byId.get(id);
      const file = node?.source
        ? nodes.find((n) => n.kind === "file" && n.source?.file === node.source?.file)
        : undefined;
      const targets = [id, file?.id, file?.parentId];
      for (const target of targets) {
        if (!target || seen.has(target)) continue;
        seen.add(target);
        (result.mentions[target] ??= []).push({
          path: doc.path,
          title: doc.title,
          anchor,
          nodeId: id,
        });
      }
    }
    const tree = parser.parse(doc.text.slice(0, 2 * 1024 * 1024));
    const definitions = new Map<string, string>();
    function collect(node: SyntaxNode) {
      if (node.type === "definition" && node.identifier && node.url)
        definitions.set(node.identifier.toLowerCase(), node.url);
      node.children?.forEach(collect);
    }
    collect(tree);
    function visit(node: SyntaxNode, inLink = false) {
      if (node.type === "heading") {
        anchor = `user-content-${slugger.slug(text(node))}`;
        if (node.depth === 2 || node.depth === 3)
          headings.push({ id: anchor, text: text(node), depth: node.depth });
      }
      if (node.type === "inlineCode" && !inLink) {
        const match = names.get(node.value ?? "");
        if (match) add(match.id);
      }
      const url =
        node.type === "link"
          ? node.url
          : node.type === "linkReference"
            ? definitions.get(node.identifier?.toLowerCase() ?? "")
            : undefined;
      if (url) {
        const link = resolveLink(
          doc.path,
          url,
          docs.map((d) => d.path),
          nodes,
        );
        if (link.kind === "source") add(link.id);
      }
      node.children?.forEach((child) => {
        visit(child, inLink || node.type === "link" || node.type === "linkReference");
      });
    }
    visit(tree);
    result.docs.push({ path: doc.path, title: doc.title, headings });
  }
  return result;
}
