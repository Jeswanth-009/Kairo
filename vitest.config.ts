import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Pure-logic suites run faster in node; component suites opt into jsdom
    // with a `// @vitest-environment jsdom` comment or live under components/.
    environmentMatchGlobs: [
      ["src/components/**/*.test.tsx", "jsdom"],
      ["src/**/*.test.ts", "node"],
    ],
  },
});
