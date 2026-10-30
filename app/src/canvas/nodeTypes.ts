import { FileNodeView, ModuleNodeView, ProjectNodeView, RowNodeView } from "./nodes";

/** Stable object (defined once), as React Flow requires. */
export const nodeTypes = {
  project: ProjectNodeView,
  module: ModuleNodeView,
  file: FileNodeView,
  row: RowNodeView,
};
