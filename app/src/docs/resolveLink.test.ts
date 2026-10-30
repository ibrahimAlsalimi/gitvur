import { describe, expect, it } from "vitest";
import type { ModelNode } from "../model/buildModel";
import { externalUrl, localPath, mentionIndex, resolveLink } from "./resolveLink";
import { indexDocs } from "./indexDocs";

const file: ModelNode = {
  id: "file:src/a.py",
  kind: "file",
  name: "a.py",
  parentId: "module:core",
  source: { file: "src/a.py", startLine: 1, endLine: 50 },
  docStatus: "documented",
  synthetic: false,
  issues: [],
};
const fn: ModelNode = {
  ...file,
  id: "function:src/a.py:Thing.run",
  name: "run",
  kind: "function",
  parentId: file.id,
  source: { file: "src/a.py", startLine: 10, endLine: 20 },
};
const nested: ModelNode = {
  ...fn,
  id: "function:src/a.py:Thing.run.inner",
  name: "inner",
  source: { file: "src/a.py", startLine: 12, endLine: 14 },
};
const nodes = [file, fn, nested];

describe("documentation links", () => {
  it("confines decoded local paths and external schemes", () => {
    expect(localPath("docs/a.md", "../README.md")).toBe("README.md");
    for (const value of [
      "../../secret",
      "%2e%2e/%2e%2e/secret",
      "//evil/x",
      "file:/etc/passwd",
      "x\\y",
      "%00",
    ])
      expect(localPath("docs/a.md", value)).toBeNull();
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///x",
      "vbscript:x",
      "https:\n//evil",
    ])
      expect(externalUrl(value)).toBeNull();
  });
  it("handles every supported link and selects the innermost source range", () => {
    const resolve = (href: string) =>
      resolveLink("docs/a.md", href, ["README.md", "docs/a.md"], nodes);
    expect(resolve("#intro")).toEqual({ kind: "anchor", anchor: "intro" });
    expect(resolve("../README.md#intro")).toEqual({
      kind: "doc",
      path: "README.md",
      anchor: "intro",
    });
    expect(resolve("../src/a.py#L13-L14")).toEqual({ kind: "source", id: nested.id });
    expect(resolve("/src/a.py#L19")).toEqual({ kind: "source", id: fn.id });
    expect(resolve("../src/a.py")).toEqual({ kind: "source", id: file.id });
    expect(resolve("../src/")).toEqual({ kind: "folder", path: "src/" });
    expect(resolve("https://example.com")).toEqual({
      kind: "external",
      url: "https://example.com/",
    });
    expect(resolve("mailto:a@example.com").kind).toBe("external");
    for (const href of [
      "javascript:alert(1)",
      "../absent.txt",
      "../../README.md",
      "%zz",
      "//evil/image",
      "data:text/html,x",
    ])
      expect(resolve(href).kind).toBe("unsupported");
  });
  it("links only exact and unique code mentions", () => {
    const names = mentionIndex(nodes);
    expect(names.get("Thing.run")?.id).toBe(fn.id);
    expect(names.get("src/a.py")?.id).toBe(file.id);
    expect(names.get("run")?.id).toBe(fn.id);
    expect(names.has("Thing")).toBe(false);
    expect(mentionIndex([...nodes, { ...fn, id: "function:b.py:Other.run" }]).has("run")).toBe(
      false,
    );
  });
  it("indexes real Markdown mentions and headings, excluding code fences and raw HTML", () => {
    const index = indexDocs(
      [
        {
          path: "README.md",
          title: "Read me",
          text: "# Hello\n## A section\n`Thing.run`\n[Source][impl]\n\n[impl]: src/a.py#L13\n\n## A section\n```\n`run`\n```\n<div>`inner`</div>",
        },
      ],
      nodes,
    );
    expect(index.docs[0]?.headings.map((h) => h.id)).toEqual([
      "user-content-a-section",
      "user-content-a-section-1",
    ]);
    expect(index.mentions["module:core"]?.[0]?.anchor).toBe("user-content-a-section");
    expect(index.mentions[fn.id]).toHaveLength(1);
    expect(index.mentions[nested.id]).toHaveLength(1);
  });
});
