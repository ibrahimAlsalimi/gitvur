/** Keeps the start and end of a path, e.g. `src/very/…/deep/dir`. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/** The language mark a file card shows, from its path. */
export function languageOf(path: string): "c" | "go" | "py" | "ts" | "file" {
  if (path.endsWith(".py")) return "py";
  if (/\.(?:ts|tsx|mts|cts)$/.test(path)) return "ts";
  if (/\.[ch]$/.test(path)) return "c";
  if (path.endsWith(".go")) return "go";
  return "file";
}
