/// <reference lib="webworker" />
/**
 * Runs the containment layout off the UI thread. Keeps the per-module grid cache between
 * requests, so expanding one file only recomputes that module's grid and the module level.
 */
import { computeLayout, createLayoutCache } from "./computeLayout";
import type { LayoutRequest, LayoutResult } from "./types";

export interface WorkerRequest {
  id: number;
  request: LayoutRequest;
}

export interface WorkerResponse {
  id: number;
  result: LayoutResult;
  /** Time spent computing, inside the worker. */
  ms: number;
}

const cache = createLayoutCache();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const start = performance.now();
  const result = computeLayout(event.data.request, cache);
  const response: WorkerResponse = { id: event.data.id, result, ms: performance.now() - start };
  self.postMessage(response);
};
