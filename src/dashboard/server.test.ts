import { describe, it, expect, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard, type Dashboard } from "./server.js";
import type { SprintView } from "../domain/projection.js";

const view: SprintView = {
  goal: "g",
  worktree: "/w",
  branch: "main",
  dir: "/r", data_dir: "/r/.sprinty",
  created_at: "2026-06-14T00:00:00.000Z",
  closed_at: null,
  status: "active",
  subsprints: [],
  timeline: [],
};
let dash: Dashboard | undefined;
afterEach(async () => { await dash?.stop(); dash = undefined; });

describe("dashboard", () => {
  it("serves /state as the current projection and / as HTML", async () => {
    dash = await startDashboard(() => view);
    const state = await (await fetch(`${dash.url}/state`)).json();
    expect(state.goal).toBe("g");
    const html = await (await fetch(`${dash.url}/`)).text();
    expect(html).toContain("<!doctype html>");
  });

  it("serves the compiled dashboard shell and static assets", async () => {
    dash = await startDashboard(() => ({
      ...view,
      goal: "<script>alert('x')</script>",
      timeline: [{ seq: 0, ts: view.created_at, type: "sprint_created", id: "sprint", text: "<img src=x onerror=alert(1)>" }],
    }));
    const html = await (await fetch(`${dash.url}/`)).text();
    expect(html).toContain('<div id="app">');
    const script = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(script).toBeTruthy();
    const asset = await fetch(`${dash.url}${script}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
  });

  it("prefers the current worktree dashboard build over the packaged fallback", async () => {
    const previousCwd = process.cwd();
    const temp = await mkdtemp(join(tmpdir(), "sprinty-dashboard-"));
    try {
      const root = join(temp, "dist", "dashboard-ui");
      await mkdir(join(root, "assets"), { recursive: true });
      await writeFile(join(root, "index.html"), '<!doctype html><div id="app">local-worktree-dashboard</div><script type="module" src="/assets/local.js"></script>');
      await writeFile(join(root, "assets", "local.js"), 'console.log("local-worktree-dashboard");');
      process.chdir(temp);

      dash = await startDashboard(() => view);
      const html = await (await fetch(`${dash.url}/`)).text();
      expect(html).toContain("local-worktree-dashboard");
      const asset = await (await fetch(`${dash.url}/assets/local.js`)).text();
      expect(asset).toContain("local-worktree-dashboard");
    } finally {
      process.chdir(previousCwd);
      await rm(temp, { recursive: true, force: true });
    }
  });
});
