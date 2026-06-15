import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE } from "./page.js";
import type { SprintView } from "../domain/projection.js";

export interface Dashboard { url: string; stop(): Promise<void>; }

export function startDashboard(getState: () => SprintView | null): Promise<Dashboard> {
  const staticRoot = dashboardStaticRoot();
  const server: Server = createServer((req, res) => {
    if (req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(getState() ?? {
        goal: "(no sprint)",
        worktree: "",
        branch: "",
        dir: "",
        data_dir: "",
        created_at: new Date().toISOString(),
        closed_at: null,
        status: "active",
        subsprints: [],
        timeline: [],
        context_notes: [],
        graph: { nodes: [], edges: [], blocked_by: {}, unblocks: {}, topological_order: [], cycles: [] },
        artifacts: [],
        changelog: [],
        change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
        coverage: null,
        coverage_state: { status: "not_configured" },
      }));
      return;
    }
    if (req.url?.startsWith("/assets/")) {
      const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      const asset = normalize(join(staticRoot, pathname));
      if (!asset.startsWith(staticRoot) || !existsSync(asset)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": contentType(asset) });
      res.end(readFileSync(asset));
      return;
    }
    const html = join(staticRoot, "index.html");
    if (existsSync(html)) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(readFileSync(html, "utf8"));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        stop: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function dashboardStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "dashboard-ui"),
    join(process.cwd(), "dist", "dashboard-ui"),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "index.html"))) ?? candidates[0]!;
}
