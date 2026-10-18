import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environmentMatchGlobs: [["src/dashboard/ui/src/**/*.test.tsx", "jsdom"]],
    environment: "node",
    // item_done executes the item's gates for real and the e2e suite drives a live MCP server
    // subprocess, so a whole test now takes seconds of genuine work. The 5s default trips on
    // honest runs under parallel load rather than on anything being wrong.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/index.ts",
        "src/dashboard/ui/src/components/untitled/**",
      ],
    },
  },
});
