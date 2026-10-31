/**
 * Playback: following a flow like a debugger cursor. Pure; the UI keeps a stack of states
 * for Previous.
 *
 * From the active step, Next takes the first untaken non-branch transition (by target
 * reading order). At a dead end it resumes from the most recent visited step that still has
 * one, so a call chain "returns" before an event fires. When only untaken branches remain,
 * Next pauses with them as options; declining ("otherwise") marks them skipped. Playback ends
 * when nothing is left.
 */
import type { Flow } from "../generated/contract";

export interface PathEntry {
  step: string;
  /** Index of the transition that led here; null for the first step or a jump. */
  via: number | null;
}

export interface PlaybackState {
  /** Active step; null when at rest (before Play/Next). */
  current: string | null;
  path: PathEntry[];
  /** Transition indexes already followed. */
  taken: number[];
  /** Branch transitions declined. */
  skipped: number[];
  /** Branch transitions to choose from; null when no choice is pending. */
  options: number[] | null;
  done: boolean;
}

export const REST: PlaybackState = {
  current: null,
  path: [],
  taken: [],
  skipped: [],
  options: null,
  done: false,
};

function stepOrder(flow: Flow): Map<string, number> {
  const order = new Map<string, number>();
  flow.steps.forEach((s, i) => {
    if (!order.has(s.id)) order.set(s.id, i);
  });
  return order;
}

function untaken(flow: Flow, state: PlaybackState, from: string): number[] {
  const order = stepOrder(flow);
  const done = new Set([...state.taken, ...state.skipped]);
  return flow.transitions
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => t.from === from && !done.has(i) && order.has(t.to))
    .sort((a, b) => (order.get(a.t.to) ?? 0) - (order.get(b.t.to) ?? 0) || a.i - b.i)
    .map(({ i }) => i);
}

function go(flow: Flow, state: PlaybackState, index: number): PlaybackState {
  const t = flow.transitions[index];
  if (!t) return state;
  return {
    ...state,
    current: t.to,
    path: [...state.path, { step: t.to, via: index }],
    taken: [...state.taken, index],
    options: null,
  };
}

/** Advances one step (or opens a branch choice, or ends). */
export function next(flow: Flow, state: PlaybackState): PlaybackState {
  if (state.done || state.options) return state;
  const first = flow.steps[0];
  if (state.current === null) {
    if (!first) return { ...state, done: true };
    return { ...state, current: first.id, path: [{ step: first.id, via: null }] };
  }
  // The active step first, then earlier steps on the path, most recent first.
  const candidates = [state.current, ...state.path.map((p) => p.step).reverse()];
  for (const from of candidates) {
    const open = untaken(flow, state, from);
    const plain = open.filter((i) => flow.transitions[i]?.kind !== "branch");
    if (plain[0] !== undefined) return go(flow, state, plain[0]);
    if (open.length > 0) {
      // Pause where the decision is: move the cursor back to the branching step.
      const path = from === state.current ? state.path : [...state.path, { step: from, via: null }];
      return { ...state, current: from, path, options: open };
    }
  }
  return { ...state, done: true };
}

/** Resolves a pending branch: follow `index`, or decline every option with `null`. */
export function choose(flow: Flow, state: PlaybackState, index: number | null): PlaybackState {
  if (!state.options) return state;
  const others = state.options.filter((i) => i !== index);
  const declined = { ...state, skipped: [...state.skipped, ...others], options: null };
  return index === null || !state.options.includes(index)
    ? next(flow, declined)
    : go(flow, declined, index);
}

/** Steps reached so far (full opacity, with a check). */
export function visited(state: PlaybackState): Set<string> {
  return new Set(state.path.map((p) => p.step));
}

/** Steps only reachable through declined branches, and not visited: drawn dimmed. */
export function declined(flow: Flow, state: PlaybackState): Set<string> {
  const seen = visited(state);
  const out = new Set<string>();
  for (const i of state.skipped) {
    const to = flow.transitions[i]?.to;
    if (to !== undefined && !seen.has(to)) out.add(to);
  }
  return out;
}

/** Replays from rest until `stepId` is active, taking the first option at branches. */
export function jumpTo(flow: Flow, stepId: string): PlaybackState {
  let state = REST;
  for (let guard = 0; guard <= flow.transitions.length + flow.steps.length + 1; guard++) {
    if (state.current === stepId && !state.options) return state;
    const pending = state.options;
    if (pending) {
      const toward = pending.find((i) => flow.transitions[i]?.to === stepId);
      state = choose(flow, state, toward ?? pending[0] ?? null);
    } else {
      const after = next(flow, state);
      if (after === state || after.done) break;
      state = after;
    }
  }
  // Not on any path (unreachable step): show it active after everything before it.
  const index = flow.steps.findIndex((s) => s.id === stepId);
  if (index < 0) return state;
  return {
    ...REST,
    current: stepId,
    path: flow.steps.slice(0, index + 1).map((s) => ({ step: s.id, via: null })),
  };
}
