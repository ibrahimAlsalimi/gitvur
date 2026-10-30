import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownReader } from "./MarkdownReader";
import { safeDiagram, safeMarkdownUrl } from "./security";

describe("safe document rendering", () => {
  it("keeps code inside explicit source links from becoming nested buttons", () => {
    const html = renderToStaticMarkup(
      <MarkdownReader
        text="[`a.py`](a.py)"
        root="/repo"
        path="README.md"
        docs={[]}
        nodes={[
          {
            id: "file:a.py",
            kind: "file",
            name: "a.py",
            parentId: "project:root",
            source: { file: "a.py", startLine: 1, endLine: 2 },
            docStatus: "undocumented",
            synthetic: false,
            issues: [],
          },
        ]}
        dark={false}
        allowRemote={false}
        onAction={() => undefined}
      />,
    );
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toContain("gv-doc-mention");
    expect(html).toContain("gv-doc-link");
  });
  it("refuses Mermaid resources and config before invoking the renderer", () => {
    expect(safeDiagram("flowchart TD\n A[Start] --> B[Done]")).toBe(true);
    for (const source of [
      'flowchart TD\n A@{ img: "tracker.png" }',
      "flowchart TD\n A[![image](relative.png)]",
      "flowchart TD\n style A fill:url(\\68ttps://tracker.invalid/x)",
      '%%{init: { securityLevel: "loose" }}%%\nflowchart TD',
      "---\nconfig: true\n---\nflowchart TD",
    ])
      expect(safeDiagram(source)).toBe(false);
  });
  it("never emits raw HTML, dangerous URLs, or unsolicited remote images", () => {
    const text = readFileSync(new URL("../../e2e/fixtures/unsafe.md", import.meta.url), "utf8");
    const html = renderToStaticMarkup(
      <MarkdownReader
        text={text}
        root="/repo"
        path="unsafe.md"
        docs={[]}
        nodes={[]}
        dark={false}
        allowRemote={false}
        onAction={() => undefined}
      />,
    );
    expect(html).not.toMatch(
      /<script|<iframe|onerror=|src="https?:|href="javascript:|href="data:/i,
    );
    expect(html).toContain("Remote images are blocked.");
    expect(html).toContain("Image outside the repository was not loaded.");
  });
  it("keeps safe relative URLs and sanitized GFM features", () => {
    expect(safeMarkdownUrl("../README.md#intro")).toBe("../README.md#intro");
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil/x",
      "java%73cript:alert(1)",
    ])
      expect(safeMarkdownUrl(value)).toBe("");
    const html = renderToStaticMarkup(
      <MarkdownReader
        text={"## Section\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
        root="/repo"
        path="README.md"
        docs={[]}
        nodes={[]}
        dark={false}
        allowRemote={false}
        onAction={() => undefined}
      />,
    );
    expect(html).toContain('id="user-content-section"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("<table>");
  });
});
