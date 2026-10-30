import type { HighlighterCore, ThemedToken } from "shiki/core";

/**
 * Shiki with only the languages and themes Gitvur needs, and the JavaScript regex engine
 * (no WebAssembly, so the app's CSP needs no `wasm-unsafe-eval`). Created on first use.
 */
let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      langs: [import("shiki/langs/python.mjs"), import("shiki/langs/typescript.mjs")],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

export type CodeLanguage = "python" | "typescript" | "text";

/**
 * Tokens per line. Each token's `htmlStyle` holds `--shiki-light` / `--shiki-dark`; CSS
 * picks one by theme, so switching theme needs no re-highlighting.
 */
export async function tokenize(lines: string[], language: CodeLanguage): Promise<ThemedToken[][]> {
  if (language === "text") return lines.map((content) => [{ content, offset: 0 }]);
  const h = await getHighlighter();
  return h.codeToTokens(lines.join("\n"), {
    lang: language,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  }).tokens;
}
