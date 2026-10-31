import { copy } from "../copy";
import type { Flow } from "../generated/contract";
import type { FlowView } from "./flowView";
import { declined, visited } from "./playback";
import { useFlowsStore } from "./useFlowsStore";

/**
 * One dot per step in reading order: past filled, current ringed, future hollow. Steps
 * reached by a branch sit on a raised fork. Clicking a dot jumps there. When a branch is
 * pending, its options appear above the rail.
 */
export function PlaybackRail({ flow, view }: { flow: Flow; view: FlowView }) {
  const playback = useFlowsStore((s) => s.playback);
  const seen = visited(playback);
  const dimmed = declined(flow, playback);
  const forks = new Set(flow.transitions.filter((t) => t.kind === "branch").map((t) => t.to));
  const store = useFlowsStore.getState();
  const options = playback.options;
  return (
    <div className="gv-rail-wrap" data-export="skip">
      {options && (
        <div className="gv-branch-choice" role="group" aria-label={copy.flows.choose}>
          <span className="gv-branch-choice-title">{copy.flows.choose}</span>
          {options.map((i) => {
            const t = flow.transitions[i];
            return (
              <button
                key={i}
                type="button"
                className="button"
                onClick={() => {
                  store.choose(flow, i);
                }}
              >
                {t?.label ?? copy.flows.otherwise}
              </button>
            );
          })}
          {options.length === 1 && (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                store.choose(flow, null);
              }}
            >
              {copy.flows.otherwise}
            </button>
          )}
        </div>
      )}
      <ol className="gv-rail" aria-label="Steps">
        {view.steps.map((s) => {
          const state =
            playback.current === s.id
              ? "current"
              : dimmed.has(s.id)
                ? "dimmed"
                : seen.has(s.id)
                  ? "past"
                  : "future";
          return (
            <li key={s.id} className="gv-rail-item" data-fork={forks.has(s.id) || undefined}>
              <button
                type="button"
                className="gv-rail-dot"
                data-state={state}
                aria-current={state === "current" ? "step" : undefined}
                aria-label={`Step ${String(s.index + 1)}: ${s.step.label}`}
                title={`${String(s.index + 1)}. ${s.step.label}`}
                onClick={() => {
                  store.jump(flow, s.id);
                }}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
