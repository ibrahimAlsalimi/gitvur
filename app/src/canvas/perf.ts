import { create } from "zustand";

/** Layout timings, for the `?perf=1` overlay and for Playwright measurements. */
interface PerfState {
  /** Compute time of the first layout of the current repository, inside the worker. */
  firstLayoutMs: number | null;
  /** Compute time of the most recent layout, inside the worker. */
  lastLayoutMs: number | null;
  /** From the state change (open, expand, collapse) to new positions applied, end to end. */
  lastSettleMs: number | null;
  layouts: number;
  record: (layoutMs: number, settleMs: number, first: boolean) => void;
}

export const usePerf = create<PerfState>()((set) => ({
  firstLayoutMs: null,
  lastLayoutMs: null,
  lastSettleMs: null,
  layouts: 0,
  record: (layoutMs, settleMs, first) => {
    set((s) => ({
      firstLayoutMs: first ? layoutMs : s.firstLayoutMs,
      lastLayoutMs: layoutMs,
      lastSettleMs: settleMs,
      layouts: s.layouts + 1,
    }));
  },
}));

declare global {
  interface Window {
    /** Dev-only viewport control for screenshots and measurements (`import.meta.env.DEV`). */
    __gitvurMap?: {
      setViewport: (viewport: { x: number; y: number; zoom: number }) => Promise<boolean>;
      focusNodes: (ids: string[], zoom?: number) => Promise<boolean>;
      getZoom: () => number;
    };
    /** Read by the e2e performance measurements. */
    __gitvurPerf?: () => Pick<
      PerfState,
      "firstLayoutMs" | "lastLayoutMs" | "lastSettleMs" | "layouts"
    >;
  }
}

if (typeof window !== "undefined") {
  window.__gitvurPerf = () => {
    const { firstLayoutMs, lastLayoutMs, lastSettleMs, layouts } = usePerf.getState();
    return { firstLayoutMs, lastLayoutMs, lastSettleMs, layouts };
  };
}
