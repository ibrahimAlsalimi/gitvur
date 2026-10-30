import { type CSSProperties, useEffect, useState } from "react";
import type { ThemedToken } from "shiki/core";

import { toAppError } from "../api";
import type { AppError, SourceRange } from "../generated/contract";
import { useAppStore } from "../store/useAppStore";
import { tokenize } from "./highlighter";
import { type DiffOp, diffLines, sideBySide } from "./lineDiff";
import { loadSource } from "./sourceCache";

interface Side {
  range: SourceRange;
  rev: string;
}

interface Loaded {
  old: { start: number; lines: string[]; tokens: ThemedToken[][] };
  new: { start: number; lines: string[]; tokens: ThemedToken[][] };
  ops: DiffOp[];
}

async function load(repo: string, side: Side) {
  const { file, startLine, endLine } = side.range;
  const slice = await loadSource(repo, file, startLine, endLine, side.rev, 0, side.rev);
  return {
    start: slice.startLine,
    lines: slice.lines,
    tokens: await tokenize(slice.lines, slice.language),
  };
}

function Code({ tokens }: { tokens: ThemedToken[] | undefined }) {
  if (!tokens || tokens.length === 0) return <> </>;
  return (
    <>
      {tokens.map((t, j) => (
        <span key={j} style={t.htmlStyle as CSSProperties | undefined}>
          {t.content}
        </span>
      ))}
    </>
  );
}

/**
 * Old and new source of a modified element, inline or side by side, with line numbers from
 * each revision and added/removed lines tinted with the diff tokens.
 */
export function SourceDiff({ before, after }: { before: Side; after: Side }) {
  const repo = useAppStore((s) => s.path);
  const mode = useAppStore((s) => s.diffMode);
  const [state, setState] = useState<Loaded | AppError | null>(null);

  useEffect(() => {
    if (repo === null) return;
    let cancelled = false;
    Promise.all([load(repo, before), load(repo, after)])
      .then(([o, n]) => {
        if (!cancelled) setState({ old: o, new: n, ops: diffLines(o.lines, n.lines) });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState(toAppError(err));
      });
    return () => {
      cancelled = true;
    };
    // The parent remounts this component per element (React `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const toggle = (
    <div className="gv-segmented gv-diff-toggle" role="group" aria-label="Diff layout">
      {(["inline", "split"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className="gv-tool"
          aria-pressed={mode === m}
          onClick={() => {
            useAppStore.getState().setDiffMode(m);
          }}
        >
          {m === "inline" ? "Inline" : "Side by side"}
        </button>
      ))}
    </div>
  );
  if (state === null) {
    return (
      <div className="gv-code gv-code-loading" aria-busy="true">
        Loading both versions…
      </div>
    );
  }
  if ("code" in state) {
    return (
      <div className="gv-source-warning" role="alert">
        <p>Cannot read both versions: {state.message}</p>
      </div>
    );
  }
  const { old: o, new: n, ops } = state;
  const added = ops.filter((op) => op.kind === "add").length;
  const removed = ops.filter((op) => op.kind === "del").length;
  return (
    <div className="gv-code-wrap">
      <div className="gv-diff-bar">
        {toggle}
        <span className="gv-diff-stat">
          <span data-kind="add">+{added}</span> <span data-kind="del">−{removed}</span>
        </span>
      </div>
      <div className="gv-code gv-diff" data-mode={mode} role="region" aria-label="Source diff">
        {mode === "inline" ? (
          <table className="gv-code-table">
            <tbody>
              {ops.map((op, i) => {
                const a = op.kind === "add" ? undefined : op.a;
                const b = op.kind === "del" ? undefined : op.b;
                return (
                  <tr key={i} className="gv-code-line" data-kind={op.kind}>
                    <td className="gv-code-number">{a === undefined ? "" : o.start + a}</td>
                    <td className="gv-code-number">{b === undefined ? "" : n.start + b}</td>
                    <td className="gv-diff-sign" aria-hidden="true">
                      {op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}
                    </td>
                    <td className="gv-code-text">
                      <Code tokens={b === undefined ? o.tokens[a ?? 0] : n.tokens[b]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="gv-code-table gv-diff-split">
            <tbody>
              {sideBySide(ops).map((row, i) => {
                const same =
                  row.left !== undefined &&
                  row.right !== undefined &&
                  o.lines[row.left] === n.lines[row.right];
                return (
                  <tr key={i} className="gv-code-line">
                    <td
                      className="gv-code-number"
                      data-kind={same ? "same" : row.left === undefined ? "empty" : "del"}
                    >
                      {row.left === undefined ? "" : o.start + row.left}
                    </td>
                    <td
                      className="gv-code-text"
                      data-kind={same ? "same" : row.left === undefined ? "empty" : "del"}
                    >
                      {row.left !== undefined && <Code tokens={o.tokens[row.left]} />}
                    </td>
                    <td
                      className="gv-code-number"
                      data-kind={same ? "same" : row.right === undefined ? "empty" : "add"}
                    >
                      {row.right === undefined ? "" : n.start + row.right}
                    </td>
                    <td
                      className="gv-code-text"
                      data-kind={same ? "same" : row.right === undefined ? "empty" : "add"}
                    >
                      {row.right !== undefined && <Code tokens={n.tokens[row.right]} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
