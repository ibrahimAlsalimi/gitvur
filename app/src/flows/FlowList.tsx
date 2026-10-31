import { copy } from "../copy";
import type { EntryPoint } from "../generated/contract";
import type { Model } from "../model/buildModel";
import { useAppStore } from "../store/useAppStore";
import { filterEntries } from "./filterEntries";
import { qualifiedName } from "./flowView";
import { EntryGlyph, FlowStatusMark } from "./glyphs";
import { useFlowsStore } from "./useFlowsStore";

function targetName(model: Model, entry: EntryPoint): string | undefined {
  if (entry.target === null) return entry.raw ?? undefined;
  const node = model.nodes.get(entry.target);
  return node ? qualifiedName(node) : entry.target;
}

export function FlowList({ model }: { model: Model }) {
  const selection = useAppStore((s) => s.flowSelection);
  const filter = useFlowsStore((s) => s.filter);
  const groups = filterEntries(model, filter);
  const select = (id: string, mode: "flow" | "trace") => {
    useFlowsStore.setState({ traceFrom: null });
    useAppStore.getState().selectFlow(id, mode);
  };
  return (
    <nav className="gv-flow-list" aria-label="Entry points and flows">
      <div className="gv-doc-list-head">
        <h2>{copy.flows.listTitle}</h2>
      </div>
      <label className="gv-doc-filter">
        <span className="visually-hidden">Filter flows</span>
        <input
          placeholder={copy.flows.filter}
          value={filter}
          onChange={(e) => {
            useFlowsStore.getState().setFilter(e.target.value);
          }}
        />
      </label>
      <div className="gv-doc-list-scroll">
        {model.flows.entryPoints.length === 0 && model.flows.flows.length === 0 && (
          <p className="gv-doc-note">{copy.flows.noEntries}</p>
        )}
        {groups.length === 0 && model.flows.entryPoints.length > 0 && (
          <p className="gv-doc-note">{copy.flows.noMatch}</p>
        )}
        <ul className="gv-flow-groups">
          {groups.map(({ entry, id, flows }) => {
            const outside = entry?.target === null;
            const target = entry ? targetName(model, entry) : undefined;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="gv-flow-entry"
                  aria-current={selection === id ? "true" : undefined}
                  data-outside={outside || undefined}
                  title={outside ? copy.flows.outsideTip : (entry?.id ?? id)}
                  onClick={() => {
                    select(id, flows.length > 0 ? "flow" : "trace");
                  }}
                >
                  {entry ? <EntryGlyph kind={entry.kind} /> : <span className="gv-glyph" />}
                  <span className="gv-flow-entry-name">{entry?.name ?? id}</span>
                  {target !== undefined && <span className="gv-flow-entry-target">{target}</span>}
                  {entry?.provenance === "ai" && <span className="gv-ai-pill">AI</span>}
                </button>
                {flows.length > 0 && (
                  <ul className="gv-flow-flows">
                    {flows.map((flow) => {
                      const status = model.flows.flowStatusById.get(flow.id)?.status ?? "current";
                      return (
                        <li key={flow.id}>
                          <button
                            type="button"
                            className="gv-flow-item"
                            aria-current={selection === flow.id ? "true" : undefined}
                            onClick={() => {
                              select(flow.id, "flow");
                            }}
                          >
                            <span className="gv-flow-item-name">{flow.name}</span>
                            <span className="gv-flow-item-count">{flow.steps.length}</span>
                            <FlowStatusMark status={status} />
                            {status !== "current" && (
                              <span className="visually-hidden">{copy.flows.status[status]}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
