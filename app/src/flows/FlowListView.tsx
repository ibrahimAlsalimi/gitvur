import type { Flow } from "../generated/contract";
import type { FlowView, StepView } from "./flowView";
import { useAppStore } from "../store/useAppStore";

/**
 * The flow as a numbered list, for reading and for screen readers: each step with where it
 * goes next; branches as nested lists under their condition.
 */
export function FlowListView({ flow, view }: { flow: Flow; view: FlowView }) {
  const name = (id: string) => {
    const s = view.stepsById.get(id);
    return s ? `step ${String(s.index + 1)}` : id;
  };
  const describe = (s: StepView) =>
    `${s.step.label} — ${s.qualified}${s.node ? `, in ${s.laneName}` : ""}`;
  return (
    <ol className="gv-flow-listview" aria-label={`${flow.name}, as a list`}>
      {view.steps.map((s) => {
        const out = view.transitions.filter((t) => t.transition.from === s.id);
        const branches = out.filter((t) => t.transition.kind === "branch");
        const plain = out.filter((t) => t.transition.kind !== "branch");
        return (
          <li key={s.id} value={s.index + 1}>
            <button
              type="button"
              className="gv-link"
              onClick={() => {
                if (s.node) useAppStore.getState().select(s.node.id);
              }}
            >
              {describe(s)}
            </button>
            {s.stale && <span className="gv-flow-listview-note"> (changed since written)</span>}
            {plain.length > 0 && (
              <ul>
                {plain.map((t) => (
                  <li key={t.id}>
                    {t.transition.kind === "return"
                      ? "returns to"
                      : t.transition.kind === "event"
                        ? `on event “${t.transition.label ?? ""}”, runs`
                        : t.transition.kind === "async"
                          ? "starts, asynchronously,"
                          : "calls"}{" "}
                    {name(t.transition.to)}
                    {t.transition.provenance === "ai" ? " (AI)" : ""}
                  </li>
                ))}
              </ul>
            )}
            {branches.length > 0 && (
              <ul>
                {branches.map((t) => (
                  <li key={t.id}>
                    {t.transition.label ?? "if"}: {name(t.transition.to)}
                    {t.transition.provenance === "ai" ? " (AI)" : ""}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
