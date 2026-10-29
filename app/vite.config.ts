import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Tauri expects a fixed port and fails if it is taken.
export default defineConfig({
  plugins: [react()],
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
