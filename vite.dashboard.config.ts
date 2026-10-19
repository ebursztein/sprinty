import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    ...((mode === "demo" || mode === "marketing-demo")
      ? [
          {
            name: "sprinty-demo",
            configureServer(server: import("vite").ViteDevServer) {
              server.middlewares.use("/state", async (_req, res) => {
                try {
                  const demo = mode === "marketing-demo"
                    ? (await server.ssrLoadModule("/src/marketing-fixture.ts")).marketingSprint
                    : (await server.ssrLoadModule("/src/fixtures.ts")).demoSprint;
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("Cache-Control", "no-store");
                  res.end(JSON.stringify(demo()));
                } catch (err) {
                  res.statusCode = 500;
                  res.end(String(err));
                }
              });
            },
          },
        ]
      : []),
  ],
  server: {
    host: "127.0.0.1",
    ...(process.env.SPRINTY_DASHBOARD_URL
      ? { proxy: { "/state": process.env.SPRINTY_DASHBOARD_URL } }
      : {}),
  },
  root: "src/dashboard/ui",
  build: { outDir: "../../../dist/dashboard-ui", emptyOutDir: true },
}));
