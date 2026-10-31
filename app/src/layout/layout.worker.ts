/// <reference lib="webworker" />
/**
 * Runs layouts off the UI thread: the map's containment layout (keeping the per-module grid
 * cache between requests, so expanding one file only recomputes that module's grid and the
 * module level) and the Flows tab's swimlane layout.
 */
import { type FlowLayout, type FlowLayoutInput, layoutFlow } from "../flows/layoutFlow";
import { layoutDiagram, type DiagramPositions } from "../diagram/layout";
import type { Diagram } from "../diagram/model";
import { computeLayout, createLayoutCache } from "./computeLayout";
import type { LayoutRequest, LayoutResult } from "./types";

export type WorkerRequest =
  | { id: number; request: LayoutRequest }
  | { id: number; flow: FlowLayoutInput }
  | { id: number; diagram: Diagram };

export interface WorkerResponse {
  id: number;
  result: LayoutResult | FlowLayout | DiagramPositions;
  /** Time spent computing, inside the worker. */
  ms: number;
}

const cache = createLayoutCache();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const start = performance.now();
  const data = event.data;
  const result =
    "diagram" in data
      ? layoutDiagram(data.diagram)
      : "flow" in data
        ? layoutFlow(data.flow)
        : computeLayout(data.request, cache);
  const response: WorkerResponse = { id: data.id, result, ms: performance.now() - start };
  self.postMessage(response);
};
