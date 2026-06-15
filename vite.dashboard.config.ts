import { defineConfig } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess() })],
  root: "src/dashboard/ui",
  build: {
    outDir: "../../../dist/dashboard-ui",
    emptyOutDir: true,
  },
});
