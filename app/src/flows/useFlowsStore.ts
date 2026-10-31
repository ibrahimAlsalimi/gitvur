/** Flows tab state that is not saved with the view: filter, playback, trace data. */
import { create } from "zustand";

import { getApi } from "../api";
import { copy } from "../copy";
import type { Flow, Trace } from "../generated/contract";
import { useAppStore } from "../store/useAppStore";
import { type PlaybackState, REST, choose, jumpTo, next } from "./playback";
import { graftTrace, initialExpanded } from "./traceView";

export const TRACE_DEPTH = 6;
export const TRACE_MAX_NODES = 300;
/** Play advances this often (ms), stopping at branches and at the end. */
export const PLAY_INTERVAL_MS = 1600;

export interface TraceState {
  start: string;
  status: "loading" | "ready" | "error";
  trace: Trace | null;
  expanded: Set<string>;
  ambiguous: Set<string>;
  /** Occurrences whose deeper trace is being fetched. */
  fetching: Set<string>;
  error?: string;
}

interface FlowsState {
  filter: string;
  /** Flow the playback state belongs to. */
  playbackFlow: string | null;
  playback: PlaybackState;
  /** Earlier states, for Previous. */
  stack: PlaybackState[];
  playing: boolean;
  /** Trace of a node chosen with "Trace from here" (otherwise the selection's entry). */
  traceFrom: string | null;
  trace: TraceState | null;
  listView: boolean;
  /** Legend card expanded (collapsed by default so it never covers a small diagram). */
  legendOpen: boolean;
  /** Step last clicked (its context shows in the inspector when playback is at rest). */
  inspected: string | null;
  /** Ask the canvas to centre an element; `seq` changes on every request. */
  focus: { id: string; seq: number } | null;

  setFilter: (filter: string) => void;
  setListView: (on: boolean) => void;
  /** Resets playback when a different flow is shown. */
  usePlaybackOf: (flowId: string) => void;
  stepNext: (flow: Flow) => void;
  stepPrev: () => void;
  restart: () => void;
  choose: (flow: Flow, transition: number | null) => void;
  jump: (flow: Flow, stepId: string) => void;
  setPlaying: (playing: boolean) => void;
  requestFocus: (id: string) => void;
  traceFromHere: (nodeId: string) => void;
  loadTrace: (start: string) => Promise<void>;
  toggleExpand: (occurrence: string) => Promise<void>;
  toggleAmbiguous: (occurrence: string) => void;
}

const advance = (s: FlowsState, nextState: PlaybackState): Partial<FlowsState> =>
  nextState === s.playback
    ? {}
    : {
        playback: nextState,
        stack: [...s.stack, s.playback],
        playing: s.playing && !nextState.done && !nextState.options,
        ...(nextState.current
          ? { focus: { id: nextState.current, seq: (s.focus?.seq ?? 0) + 1 } }
          : {}),
      };

export const useFlowsStore = create<FlowsState>((set, get) => ({
  filter: "",
  playbackFlow: null,
  playback: REST,
  stack: [],
  playing: false,
  traceFrom: null,
  trace: null,
  listView: false,
  legendOpen: false,
  inspected: null,
  focus: null,

  setFilter(filter) {
    set({ filter });
  },
  setListView(listView) {
    set({ listView });
  },
  usePlaybackOf(flowId) {
    if (get().playbackFlow !== flowId) {
      set({ playbackFlow: flowId, playback: REST, stack: [], playing: false, inspected: null });
    }
  },
  stepNext(flow) {
    const s = get();
    set(advance(s, next(flow, s.playback)));
  },
  stepPrev() {
    const { stack } = get();
    const previous = stack.at(-1);
    if (previous) set({ playback: previous, stack: stack.slice(0, -1), playing: false });
  },
  restart() {
    set({ playback: REST, stack: [], playing: false });
  },
  choose(flow, transition) {
    const s = get();
    set(advance(s, choose(flow, s.playback, transition)));
  },
  jump(flow, stepId) {
    const s = get();
    set({ ...advance(s, jumpTo(flow, stepId)), playing: false });
  },
  setPlaying(playing) {
    set({ playing });
  },
  requestFocus(id) {
    set({ focus: { id, seq: (get().focus?.seq ?? 0) + 1 } });
  },
  traceFromHere(nodeId) {
    set({ traceFrom: nodeId });
    const app = useAppStore.getState();
    app.setFlowMode("trace");
    app.setActiveTab("flows");
  },

  async loadTrace(start) {
    const path = useAppStore.getState().path;
    if (path === null) return;
    if (get().trace?.start === start && get().trace?.status !== "error") return;
    set({
      trace: {
        start,
        status: "loading",
        trace: null,
        expanded: new Set(),
        ambiguous: new Set(),
        fetching: new Set(),
      },
    });
    try {
      const api = await getApi();
      const trace = await api.getTrace(path, start, TRACE_DEPTH, TRACE_MAX_NODES);
      if (get().trace?.start !== start) return;
      set({
        trace: {
          start,
          status: trace.error ? "error" : "ready",
          trace,
          expanded: initialExpanded(trace),
          ambiguous: new Set(),
          fetching: new Set(),
          ...(trace.error ? { error: trace.error } : {}),
        },
      });
    } catch {
      if (get().trace?.start === start) {
        set({
          trace: {
            start,
            status: "error",
            trace: null,
            expanded: new Set(),
            ambiguous: new Set(),
            fetching: new Set(),
            error: copy.flows.traceFailed,
          },
        });
      }
    }
  },

  async toggleExpand(occurrence) {
    const state = get().trace;
    if (!state?.trace) return;
    const occ = state.trace.nodes.find((n) => n.id === occurrence);
    if (!occ) return;
    const expanded = new Set(state.expanded);
    if (expanded.has(occurrence)) {
      expanded.delete(occurrence);
      set({ trace: { ...state, expanded } });
      return;
    }
    expanded.add(occurrence);
    // Show the next level at once; children the trace omitted come from the backend.
    for (const child of occ.children) {
      const c = state.trace.nodes.find((n) => n.id === child);
      if (c?.kind === "node" && c.children.length === 0 && !c.truncated) expanded.add(child);
    }
    set({ trace: { ...state, expanded } });
    const path = useAppStore.getState().path;
    if (!occ.truncated || !occ.node || path === null) return;
    set({ trace: { ...state, expanded, fetching: new Set([...state.fetching, occurrence]) } });
    try {
      const api = await getApi();
      const sub = await api.getTrace(path, occ.node, TRACE_DEPTH, TRACE_MAX_NODES);
      const now = get().trace;
      if (!now?.trace || now.start !== state.start || sub.error) return;
      const fetching = new Set(now.fetching);
      fetching.delete(occurrence);
      set({ trace: { ...now, trace: graftTrace(now.trace, occurrence, sub), fetching } });
    } catch {
      const now = get().trace;
      if (now) {
        const fetching = new Set(now.fetching);
        fetching.delete(occurrence);
        set({ trace: { ...now, fetching } });
      }
    }
  },

  toggleAmbiguous(occurrence) {
    const state = get().trace;
    if (!state) return;
    const ambiguous = new Set(state.ambiguous);
    if (ambiguous.has(occurrence)) ambiguous.delete(occurrence);
    else ambiguous.add(occurrence);
    set({ trace: { ...state, ambiguous } });
  },
}));

/** Clears per-repository state when another repository opens. */
useAppStore.subscribe((s, prev) => {
  if (s.bundle?.root !== prev.bundle?.root) {
    useFlowsStore.setState({
      filter: "",
      playbackFlow: null,
      playback: REST,
      stack: [],
      playing: false,
      traceFrom: null,
      trace: null,
      inspected: null,
      focus: null,
    });
  } else if (s.bundle !== prev.bundle) {
    useFlowsStore.setState({ trace: null }); // re-indexed: the call tree may differ
  }
});
