import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PAGE } from "./page.js";
import type { SprintView } from "../domain/projection.js";

export interface Dashboard { url: string; stop(): Promise<void>; }

export function startDashboard(getState: () => SprintView | null): Promise<Dashboard> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(getState() ?? { goal: "(no sprint)", status: "active", branch: "", subsprints: [] }));
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
