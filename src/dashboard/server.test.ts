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
  completion: {
    total_items: 0, finished_items: 0, percent_complete: 0, intervals_ms: [],
    fastest_ms: null, median_ms: null, slowest_ms: null, eta_ms: null, eta_at: null,
  },
};
let dash: Dashboard | undefined;
afterEach(async () => { await dash?.stop(); dash = undefined; });

describe("dashboard", () => {
  it("serves /state as the current projection and / as HTML", async () => {
    dash = await startDashboard(() => view);
    const state = await (await fetch(`${dash.url}/state`)).json();
    expect(state.goal).toBe("g");
    expect(state.completion.percent_complete).toBe(0);
    const html = await (await fetch(`${dash.url}/`)).text();
    expect(html).toContain("<!doctype html>");
  });

  it("serves every /state poll from the latest projection without browser caching", async () => {
    let current = view;
    dash = await startDashboard(() => current);

    const first = await fetch(`${dash.url}/state`);
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect((await first.json()).completion.finished_items).toBe(0);

    current = {
      ...view,
      completion: { ...view.completion, total_items: 1, finished_items: 1, percent_complete: 100 },
    };
    const second = await fetch(`${dash.url}/state`);
    expect((await second.json()).completion.finished_items).toBe(1);
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

  it("refuses to serve files outside the static root via encoded traversal", async () => {
    const previousCwd = process.cwd();
    const temp = await mkdtemp(join(tmpdir(), "sprinty-dashboard-"));
    try {
      const root = join(temp, "dist", "dashboard-ui");
      await mkdir(join(root, "assets"), { recursive: true });
      await writeFile(join(root, "index.html"), '<!doctype html><div id="app"></div>');
      await writeFile(join(root, "assets", "app.js"), 'console.log("legit");');
      // A sibling that merely shares the static root's name prefix must stay unreachable.
      await mkdir(join(temp, "dist", "dashboard-ui-secrets"), { recursive: true });
      await writeFile(join(temp, "dist", "dashboard-ui-secrets", "creds.js"), "SECRET_TOKEN");
      process.chdir(temp);

      dash = await startDashboard(() => view);
      expect((await fetch(`${dash.url}/assets/app.js`)).status).toBe(200);
      // %2f survives URL path normalization and becomes a separator only after decoding.
      const escaped = await fetch(`${dash.url}/assets/..%2f..%2fdashboard-ui-secrets/creds.js`);
      expect(escaped.status).toBe(404);
      expect(await escaped.text()).not.toContain("SECRET_TOKEN");
    } finally {
      process.chdir(previousCwd);
      await rm(temp, { recursive: true, force: true });
    }
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
