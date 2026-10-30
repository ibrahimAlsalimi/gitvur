import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  CommitInfo,
  DiffBundle,
  RecentRepo,
  RepoBundle,
  Settings,
  SourceSlice,
  ViewState,
} from "../generated/contract";
import type { Api } from "./types";

/** The real backend: Tauri commands in app/src-tauri/src/commands.rs. */
export const tauriApi: Api = {
  async pickFolder() {
    const picked = await open({ directory: true, multiple: false, title: "Open repository" });
    return typeof picked === "string" ? picked : null;
  },
  openRepository: (path) => invoke<RepoBundle>("open_repository", { path }),
  indexRepository: (path) => invoke<RepoBundle>("index_repository", { path }),
  validateRepository: (path) => invoke<RepoBundle>("validate_repository", { path }),
  readSource: (path, file, start, end, context) =>
    invoke<SourceSlice>("read_source", { path, file, start, end, context }),
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
