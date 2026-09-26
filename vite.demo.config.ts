import { defineConfig, mergeConfig } from "vite";
import { resolve } from "node:path";
import baseConfig from "./vite.config";

/**
 * Browser-demo build for the website (hosted under /demo/ on GitHub Pages).
 * Uses the dev mock harness as the entry with a relative base so the app
 * (HashRouter + fixtures) runs from any subdirectory without a backend.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    base: "./",
    build: {
      outDir: "dist-demo",
      emptyOutDir: true,
      rollupOptions: {
        input: { mock: resolve(__dirname, "mock.html") },
      },
    },
  }),
);
