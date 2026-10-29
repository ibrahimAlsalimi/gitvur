import { type CSSProperties, useEffect, useState } from "react";
import type { ThemedToken } from "shiki/core";

import { toAppError } from "../api";
import type { AppError, SourceSlice } from "../generated/contract";
import { useAppStore } from "../store/useAppStore";
import { tokenize } from "./highlighter";
import { CONTEXT_LINES, loadSource } from "./sourceCache";

interface CodeViewerProps {
  file: string;
  start: number;
  end: number;
  /** Cache key: the element's contentHash, or the evidence line. */
  cacheKey: string;
  /** Line to highlight with the accent (evidence mode). */
  highlightLine?: number;
  context?: number;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; error: AppError }
  | { kind: "ready"; slice: SourceSlice; tokens: ThemedToken[][] };

/**
 * Read-only source with the element's real line numbers. Context lines are muted; the
 * element's own range has the normal background. Never shows stale text silently: a
 * missing file or an out-of-range slice shows a warning with a Re-index action.
 */
export function CodeViewer({
  file,
  start,
  end,
  cacheKey,
  highlightLine,
  context = CONTEXT_LINES,
}: CodeViewerProps) {
  const repo = useAppStore((s) => s.path);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (repo === null) return;
    // The parent remounts the viewer (React `key`) for each element, so no reset here.
    let cancelled = false;
    loadSource(repo, file, start, end, cacheKey, context)
      .then(async (slice) => {
        const tokens = await tokenize(slice.lines, slice.language);
        if (!cancelled) setState({ kind: "ready", slice, tokens });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", error: toAppError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, file, start, end, cacheKey, context]);

  const where = `${file}:${String(start)}${end !== start ? `–${String(end)}` : ""}`;
  if (state.kind === "loading") {
    return (
      <div className="gv-code gv-code-loading" aria-busy="true">
        Loading source…
      </div>
    );
  }
  const outOfRange =
    state.kind === "ready" &&
    (state.slice.lines.length === 0 ||
      state.slice.startLine > start ||
      state.slice.startLine + state.slice.lines.length - 1 < end);
  if (state.kind === "error" || outOfRange) {
    return (
      <div className="gv-source-warning" role="alert">
        <p>
          Source not found at <span className="inline-code">{where}</span> — the repository may have
          changed since it was indexed.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => void useAppStore.getState().index()}
        >
          Re-index
        </button>
      </div>
    );
  }

  const { slice, tokens } = state;
  const long = end - start + 1 > 30;
  return (
    <div className="gv-code-wrap">
      <div
        className="gv-code"
        data-capped={long && !full}
        role="region"
        aria-label={`Source of ${where}`}
      >
        <table className="gv-code-table">
          <tbody>
            {tokens.map((line, i) => {
              const n = slice.startLine + i;
              const inRange = n >= start && n <= end;
              return (
                <tr
                  key={n}
                  className="gv-code-line"
                  data-context={!inRange}
                  data-highlight={n === highlightLine}
                >
                  <td className="gv-code-number" aria-hidden="true">
                    {n}
                  </td>
                  <td className="gv-code-text">
                    {line.length === 0
                      ? " "
                      : line.map((t, j) => (
                          <span key={j} style={t.htmlStyle as CSSProperties | undefined}>
                            {t.content}
                          </span>
                        ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {long && (
        <button
          type="button"
          className="gv-link"
          onClick={() => {
            setFull(!full);
          }}
        >
          {full ? "Collapse" : "Open full"}
        </button>
      )}
    </div>
  );
}
