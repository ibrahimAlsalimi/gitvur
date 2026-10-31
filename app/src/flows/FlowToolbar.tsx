import { useEffect, useRef, useState } from "react";

import { copy } from "../copy";
import { type FlowMode, useAppStore } from "../store/useAppStore";
import { useFlowsStore } from "./useFlowsStore";

function Copied({ done, label }: { done: boolean; label: string }) {
  return <>{done ? copy.flows.copied : label}</>;
}

export interface ToolbarActions {
  mode: FlowMode;
  /** Flow mode is available (a flow is selected). */
  hasFlow: boolean;
  canTrace: boolean;
  onNext: () => void;
  onPlay: () => void;
  onCopyMermaid: (() => Promise<void>) | undefined;
  onCopyTrace: (() => Promise<void>) | undefined;
  onExport: (kind: "png" | "svg") => Promise<void>;
  onPin: (() => void) | undefined;
}

/** Mode switch, playback controls, list view, pin and export. Left out of exported images. */
export function FlowToolbar(a: ToolbarActions) {
  const playing = useFlowsStore((s) => s.playing);
  const canPrev = useFlowsStore((s) => s.stack.length > 0);
  const done = useFlowsStore((s) => s.playback.done);
  const listView = useFlowsStore((s) => s.listView);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => {
      setCopied(null);
    }, 1200);
    return () => {
      clearTimeout(t);
    };
  }, [copied]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("mousedown", close);
    };
  }, [menu]);
  const store = useFlowsStore.getState();
  const flowMode = a.mode === "flow" && a.hasFlow;
  return (
    <div className="gv-flow-toolbar" data-export="skip" role="toolbar" aria-label="Flow tools">
      <div className="gv-segmented" role="group" aria-label="Mode">
        {(["flow", "trace"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="gv-segment"
            aria-pressed={a.mode === m}
            disabled={m === "flow" ? !a.hasFlow : !a.canTrace}
            title={`${m === "flow" ? "Flow" : "Trace"} (T)`}
            onClick={() => {
              useAppStore.getState().setFlowMode(m);
            }}
          >
            {m === "flow" ? "Flow" : "Trace"}
          </button>
        ))}
      </div>
      {flowMode && (
        <div className="gv-flow-playback" role="group" aria-label="Playback">
          <button
            type="button"
            className="button button-ghost"
            aria-label="Previous step (K)"
            title="Previous step (K)"
            disabled={!canPrev}
            onClick={() => {
              store.stepPrev();
            }}
          >
            ◀
          </button>
          <button
            type="button"
            className="button button-ghost"
            aria-label={playing ? "Pause (Space)" : "Play (Space)"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            aria-pressed={playing}
            onClick={a.onPlay}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            className="button button-ghost"
            aria-label="Next step (J)"
            title="Next step (J)"
            disabled={done}
            onClick={a.onNext}
          >
            ▶▏
          </button>
          <button
            type="button"
            className="button button-ghost"
            aria-label="Restart (Home)"
            title="Restart (Home)"
            disabled={!canPrev}
            onClick={() => {
              store.restart();
            }}
          >
            ↺
          </button>
        </div>
      )}
      <span className="gv-flow-toolbar-spacer" />
      {flowMode && (
        <button
          type="button"
          className="button button-ghost"
          aria-pressed={listView}
          onClick={() => {
            store.setListView(!listView);
          }}
        >
          {listView ? copy.flows.diagramView : copy.flows.listView}
        </button>
      )}
      {flowMode && a.onPin && (
        <button type="button" className="button button-ghost" onClick={a.onPin}>
          {copy.flows.pin}
        </button>
      )}
      {a.onCopyTrace && (
        <button
          type="button"
          className="button button-ghost"
          onClick={() => {
            void a.onCopyTrace?.().then(() => {
              setCopied("trace");
            });
          }}
        >
          <Copied done={copied === "trace"} label={copy.flows.copyTrace} />
        </button>
      )}
      <div className="gv-flow-menu" ref={menuRef}>
        <button
          type="button"
          className="button button-ghost"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
          }}
        >
          {copied === "mermaid" ? copy.flows.copied : copy.flows.exportMenu} ▾
        </button>
        {menu && (
          <div className="gv-flow-menu-list" role="menu">
            {a.onCopyMermaid && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  void a.onCopyMermaid?.().then(() => {
                    setCopied("mermaid");
                  });
                }}
              >
                {copy.flows.copyMermaid}
              </button>
            )}
            {(["svg", "png"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  void a.onExport(kind);
                }}
              >
                {kind === "svg" ? copy.flows.exportSvg : copy.flows.exportPng}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
