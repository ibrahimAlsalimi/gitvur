/** Input and output of the containment layout. Plain data, so it can cross into the worker. */

export interface LayoutRow {
  id: string;
  kind: "class" | "function";
  /** 0 for top-level classes and functions; +1 per enclosing class or function. */
  depth: number;
}

export interface LayoutFile {
  id: string;
  expanded: boolean;
  /** Rows shown when expanded, in source order (methods directly after their class). */
  rows: LayoutRow[];
}

export interface LayoutModule {
  id: string;
  /** Files in path order; laid out row-major. */
  files: LayoutFile[];
}

export interface LayoutRequest {
  modules: LayoutModule[];
  /** Module → module dependencies (importer/caller → imported/callee), deduplicated. */
  moduleEdges: [string, string][];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  /** Full-width header bar at the top. */
  project: Box;
  /** Absolute positions. */
  modules: Record<string, Box>;
  /** Relative to the file's module. */
  files: Record<string, Box>;
  /** Relative to the row's file. */
  rows: Record<string, Box>;
  /** Dagre rank of each module (0 = top). */
  ranks: Record<string, number>;
  width: number;
  height: number;
  /** Modules whose grid was recomputed (the rest came from the cache). */
  recomputed: string[];
}
