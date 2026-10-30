/**
 * A small Markdown parser for the bundled help (`agent/codeDOC.md`): headings, paragraphs,
 * lists (one nesting level), fenced code, tables, rules; inline code, bold, emphasis and
 * links. It produces data, rendered by `Markdown.tsx` as React elements — never HTML
 * strings, so nothing in the file can inject markup.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "link"; text: string; href: string };

export interface ListItem {
  content: Inline[];
  children?: Block;
}

export type Block =
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+(?:\*(?!\*)[^*]*)*\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\s][^*]*\*)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (m.index > 0) out.push({ kind: "text", text: rest.slice(0, m.index) });
    const token = m[0];
    if (m[1]) out.push({ kind: "code", text: token.slice(1, -1) });
    else if (m[2]) out.push({ kind: "strong", children: parseInline(token.slice(2, -2)) });
    else if (m[3]) {
      const close = token.indexOf("](");
      out.push({ kind: "link", text: token.slice(1, close), href: token.slice(close + 2, -1) });
    } else out.push({ kind: "em", children: parseInline(token.slice(1, -1)) });
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

const LIST_ITEM = /^(\s*)(?:([-*])|(\d+)\.)\s+(.*)$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = /^```(\S*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ kind: "code", language: fence[1] ?? "", text: body.join("\n") });
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        content: parseInline(heading[2] ?? ""),
      });
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(lines[i] ?? "");
        i += 1;
      }
      const [head = "", , ...body] = rows;
      blocks.push({ kind: "table", header: cells(head), rows: body.map(cells) });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[3] !== undefined;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i] ?? "");
        const continuation = /^\s{2,}\S/.test(lines[i] ?? "") && !m;
        if (m && (m[1] ?? "").length >= 2 && items.length > 0) {
          // Nested item: collect the indented run as a sub-list.
          const nested: string[] = [];
          while (i < lines.length && /^\s{2,}\S/.test(lines[i] ?? "")) {
            nested.push((lines[i] ?? "").replace(/^\s{2,4}/, ""));
            i += 1;
          }
          const sub = parseMarkdown(nested.join("\n"))[0];
          const last = items[items.length - 1];
          if (sub && last) last.children = sub;
        } else if (
          m &&
          (items.length === 0 || (m[1] ?? "").length < 2) &&
          (m[3] !== undefined) === ordered
        ) {
          items.push({ content: parseInline(m[4] ?? "") });
          i += 1;
        } else if (continuation && items.length > 0) {
          const last = items[items.length - 1];
          if (last)
            last.content.push({ kind: "text", text: " " }, ...parseInline((lines[i] ?? "").trim()));
          i += 1;
        } else {
          break;
        }
      }
      if (items.length === 0)
        i += 1; // unreachable in practice; never loop
      else blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(```|#{1,6}\s|\s*\||\s*(?:[-*]|\d+\.)\s)/.test(lines[i] ?? "")
    ) {
      para.push((lines[i] ?? "").trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", content: parseInline(para.join(" ")) });
  }
  return blocks;
}
