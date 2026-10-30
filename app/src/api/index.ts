import type { Api } from "./types";

export { DEFAULT_SETTINGS, toAppError } from "./types";
export type { Api } from "./types";

let api: Promise<Api> | undefined;

/**
 * The backend for this build. `vite --mode mock` swaps in the browser mock; the mock and
 * its bundled fixtures are dead code in every other mode and are left out of the build.
 */
export function getApi(): Promise<Api> {
  api ??=
    import.meta.env.MODE === "mock"
      ? import("./mock").then((m) => m.mockApi)
      : import("./tauri").then((m) => m.tauriApi);
  return api;
}
