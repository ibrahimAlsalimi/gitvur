import { computeLayout, createLayoutCache } from "./computeLayout";
import type { LayoutRequest, LayoutResult } from "./types";
import type { WorkerRequest, WorkerResponse } from "./layout.worker";

export interface TimedLayout {
  result: LayoutResult;
  /** Compute time inside the worker (or inline). */
  ms: number;
}

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, (r: TimedLayout) => void>();
const inlineCache = createLayoutCache();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      resolve?.({ result: event.data.result, ms: event.data.ms });
    };
  } catch {
    worker = null; // no Worker support (e.g. SSR or tests): lay out inline
  }
  return worker;
}

/** Lays out the map in the worker; resolves with the result and its compute time. */
export function runLayout(request: LayoutRequest): Promise<TimedLayout> {
  const w = getWorker();
  if (w === null) {
    const start = performance.now();
    const result = computeLayout(request, inlineCache);
    return Promise.resolve({ result, ms: performance.now() - start });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const message: WorkerRequest = { id, request };
    w.postMessage(message);
  });
}
