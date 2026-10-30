import { defaultSchema } from "rehype-sanitize";
import { externalUrl } from "./resolveLink";

export const DOC_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-[\w-]+$/]],
    input: [
      ["type", "checkbox"],
      ["disabled", true],
      ["checked", true],
    ],
  },
};

/** Mermaid can render shapes with image URLs; refuse resource-bearing syntax before parsing. */
export function safeDiagram(code: string): boolean {
  return (
    code.length <= 50_000 &&
    !/(?:https?:|javascript:|data:|file:|\/\/|<\w|%%\{|^---|@\s*\{|!\[|url\s*\(|\b(?:img|image|icon|href|src)\s*[:=])/im.test(
      code,
    )
  );
}

/** URLs remain inert until the app classifies and handles them. No browser navigation. */
export function safeMarkdownUrl(url: string): string {
  if (url.startsWith("#") || externalUrl(url)) return url;
  try {
    const decoded = decodeURIComponent(url);
    return !decoded.includes("\\") &&
      !decoded.includes(":") &&
      !Array.from(decoded).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
      !decoded.startsWith("//")
      ? url
      : "";
  } catch {
    return "";
  }
}
