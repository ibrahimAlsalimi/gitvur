import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { RecentRepo, RepoBundle, Settings, SourceSlice } from "../generated/contract";
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
  initialPath: () => null,
};
