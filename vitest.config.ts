import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // item_done executes the item's gates for real and the e2e suite drives a live MCP server
    // subprocess, so a whole test now takes seconds of genuine work. The 5s default trips on
    // honest runs under parallel load rather than on anything being wrong.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
  },
});
