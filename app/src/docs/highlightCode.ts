import type { ThemedToken } from "shiki/core";
import { getHighlighter } from "../inspector/highlighter";

/** Load fenced-code grammars on demand, sharing the inspector's engine and two themes. */
export async function highlightCode(code: string, language: string): Promise<ThemedToken[][]> {
  const { bundledLanguages } = await import("shiki/langs");
  if (!Object.hasOwn(bundledLanguages, language)) {
    return code.split("\n").map((content) => [{ content, offset: 0 }]);
  }
  const loader = bundledLanguages[language as keyof typeof bundledLanguages];
  const highlighter = await getHighlighter();
  await highlighter.loadLanguage(loader);
  return highlighter.codeToTokens(code, {
    lang: language,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  }).tokens;
}
