/** Geometry of the map, in canvas pixels. Multiples of 4 (the token spacing grid). */
export const PROJECT_HEIGHT = 56;
export const PROJECT_GAP = 48;

export const MODULE_PADDING = 16;
export const MODULE_HEADER = 72;

export const FILE_WIDTH = 240;
export const FILE_HEIGHT = 64;
export const FILE_GAP = 16;
/** Inner padding of an expanded file card around its rows. */
export const FILE_ROW_INSET = 8;

export const CLASS_ROW_HEIGHT = 28;
export const FUNCTION_ROW_HEIGHT = 24;
export const ROW_INDENT = 16;

export const DAGRE = { rankdir: "TB", ranksep: 96, nodesep: 64, marginx: 48, marginy: 48 } as const;

/** Grid columns for `n` files: clamp(1, ceil(sqrt(n * 1.6)), 6). */
export function gridColumns(n: number): number {
  return Math.min(6, Math.max(1, Math.ceil(Math.sqrt(n * 1.6))));
}
