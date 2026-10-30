import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("parses inline code, bold, emphasis and links", () => {
    expect(parseInline("Run `gitvur validate` **now**, *then* see [docs](x.md).")).toEqual([
      { kind: "text", text: "Run " },
      { kind: "code", text: "gitvur validate" },
      { kind: "text", text: " " },
      { kind: "strong", children: [{ kind: "text", text: "now" }] },
      { kind: "text", text: ", " },
      { kind: "em", children: [{ kind: "text", text: "then" }] },
      { kind: "text", text: " see " },
      { kind: "link", text: "docs", href: "x.md" },
      { kind: "text", text: "." },
    ]);
  });

  it("parses headings, lists with nesting, tables, fences and paragraphs", () => {
    const blocks = parseMarkdown(
      "# Title\n\nSome text\ncontinues.\n\n- one\n  - nested\n- two\n\n1. a\n2. b\n\n| A | B |\n| - | - |\n| 1 | `2` |\n\n```json\n{}\n```\n\n---\n",
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "table",
      "code",
      "rule",
    ]);
    const list = blocks[2];
    expect(list?.kind === "list" && list.items.length).toBe(2);
    expect(list?.kind === "list" && list.items[0]?.children?.kind).toBe("list");
    const table = blocks[4];
    expect(table?.kind === "table" && table.rows[0]?.[1]).toEqual([{ kind: "code", text: "2" }]);
  });

  it("parses the bundled codeDOC.md without raw markers left in text", () => {
    const source = readFileSync(new URL("../../../agent/codeDOC.md", import.meta.url), "utf8");
    const text = JSON.stringify(parseMarkdown(source));
    expect(text).not.toContain('"text":"**');
    expect(text).not.toContain('"text":"# ');
  });
});
