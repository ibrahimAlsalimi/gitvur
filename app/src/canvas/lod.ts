import type { ReactFlowState } from "@xyflow/react";

/** Semantic zoom: 0 = overview, 1 = names only, 2 = full detail. */
export type Lod = 0 | 1 | 2;

export const LOD_LOW = 0.35;
export const LOD_HIGH = 0.8;

export function lodForZoom(zoom: number): Lod {
  if (zoom < LOD_LOW) return 0;
  if (zoom <= LOD_HIGH) return 1;
  return 2;
}

/** For `useStore`: changes only when the level changes, so nodes re-render only then. */
export const lodSelector = (s: ReactFlowState): Lod => lodForZoom(s.transform[2]);
