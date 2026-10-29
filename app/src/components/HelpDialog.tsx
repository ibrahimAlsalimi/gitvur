import { useEffect, useRef } from "react";

import codeDoc from "../../../agent/codeDOC.md?raw";
import { useAppStore } from "../store/useAppStore";

/** "How to document": the agent instructions, bundled with the app so it works offline. */
export function HelpDialog() {
  const open = useAppStore((s) => s.helpOpen);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="help-title"
      onClose={() => {
        useAppStore.getState().setHelpOpen(false);
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-header">
          <h2 className="dialog-title" id="help-title">
            How to document a repository
          </h2>
          <button
            type="button"
            className="button"
            onClick={() => {
              useAppStore.getState().setHelpOpen(false);
            }}
          >
            Close
          </button>
        </div>
        <div className="dialog-body">
          <ol className="dialog-steps">
            <li>
              Give a coding agent (Claude Code, Codex) an isolated copy of the repository and the
              file <code>agent/codeDOC.md</code> below.
            </li>
            <li>
              It runs <code>gitvur packet</code>, writes <code>.gitvur/annotations.json</code>, and
              runs <code>gitvur validate</code> until there are no errors.
            </li>
            <li>Click Validate here to see the result.</li>
          </ol>
          <pre className="doc-source">{codeDoc}</pre>
        </div>
      </div>
    </dialog>
  );
}
