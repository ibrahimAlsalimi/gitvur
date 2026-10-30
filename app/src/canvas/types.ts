import type { Edge, Node } from "@xyflow/react";

import type { ModelNode, ModuleStats, Totals } from "../model/buildModel";

export interface ProjectData extends Record<string, unknown> {
  name: string;
  commitSha: string;
  languages: string[];
  totals: Totals;
}

export interface ModuleData extends Record<string, unknown> {
  node: ModelNode;
  stats: ModuleStats | undefined;
  /** CSS custom property holding the module's identity colour. */
  color: string;
  synthetic: boolean;
  fileIds: string[];
}

export interface FileData extends Record<string, unknown> {
  node: ModelNode;
  directory: string;
  language: "py" | "ts" | "file";
  /** Classes and functions inside the file. */
  childCount: number;
  expanded: boolean;
}

export interface RowData extends Record<string, unknown> {
  node: ModelNode;
  depth: number;
  /** Method count for classes; line count for functions. */
  count: number;
  method: boolean;
  /** Classes: its rows are folded on the map. */
  collapsed: boolean;
}

export type ProjectNode = Node<ProjectData, "project">;
export type ModuleNode = Node<ModuleData, "module">;
export type FileNode = Node<FileData, "file">;
export type RowNode = Node<RowData, "row">;
export type MapNode = ProjectNode | ModuleNode | FileNode | RowNode;
export type MapEdge = Edge<Record<string, never>, "connector">;
