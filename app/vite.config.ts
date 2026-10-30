import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Gitvur's own commit, for the About dialog ("dev" outside a Git checkout). */
function buildCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: repoRoot })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Tauri expects a fixed port and fails if it is taken.
export default defineConfig({
  plugins: [react()],
  define: {
    __GITVUR_VERSION__: JSON.stringify(pkg.version),
    __GITVUR_COMMIT__: JSON.stringify(buildCommit()),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // The help dialog bundles agent/codeDOC.md; mock mode bundles fixtures/*/.gitvur.
    fs: { allow: [repoRoot] },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
