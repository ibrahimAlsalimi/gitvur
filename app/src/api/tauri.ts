import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";

import type {
  AssetData,
  CommitInfo,
  DiffBundle,
  DocContent,
  DocEntry,
  RecentRepo,
  RepoBundle,
  Settings,
  SourceSlice,
  Trace,
  ViewState,
} from "../generated/contract";
import type { Api } from "./types";

/** The real backend: Tauri commands in app/src-tauri/src/commands.rs. */
export const tauriApi: Api = {
  listDocs: (path) => invoke<DocEntry[]>("list_docs", { path }),
  readDoc: (path, docPath) => invoke<DocContent>("read_doc", { path, docPath }),
  readDocAsset: (path, docPath, href) =>
    invoke<AssetData>("read_doc_asset", { path, docPath, href }),
  openExternal: async (url) => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  },
  async pickFolder() {
    const picked = await open({ directory: true, multiple: false, title: "Open repository" });
    return typeof picked === "string" ? picked : null;
  },
  openRepository: (path) => invoke<RepoBundle>("open_repository", { path }),
  indexRepository: (path) => invoke<RepoBundle>("index_repository", { path }),
  validateRepository: (path) => invoke<RepoBundle>("validate_repository", { path }),
  readSource: (path, file, start, end, context) =>
    invoke<SourceSlice>("read_source", { path, file, start, end, context }),
  async saveExport(repo, name, kind, data) {
    const target = await save({
      title: "Export diagram",
      defaultPath: name,
      filters: [{ name: kind === "png" ? "PNG image" : "SVG image", extensions: [kind] }],
    });
    if (typeof target !== "string") return false;
    await invoke<undefined>("write_export", { repo, target, data });
    return true;
  },
  getTrace: (path, start, depth, maxNodes) =>
    invoke<Trace>("get_trace", { path, start, depth, maxNodes }),
  recentRepositories: () => invoke<RecentRepo[]>("recent_repositories"),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings) => invoke<undefined>("set_settings", { settings }),
  listCommits: (path, limit) => invoke<CommitInfo[]>("list_commits", { path, limit }),
  diffRevisions: (path, from, to) => invoke<DiffBundle>("diff_revisions", { path, from, to }),
  readRevisionSource: (path, rev, file, start, end, context) =>
    invoke<SourceSlice>("read_revision_source", { path, rev, file, start, end, context }),
  forgetRecent: (path) => invoke<undefined>("forget_recent", { path }),
  getViewState: (root) => invoke<ViewState | null>("get_view_state", { root }),
  setViewState: (root, state) => invoke<undefined>("set_view_state", { root, state }),
  clearViewState: (root) => invoke<undefined>("clear_view_state", { root }),
  setTitle: (title) => getCurrentWindow().setTitle(title),
  initialPath: () => null,
};
