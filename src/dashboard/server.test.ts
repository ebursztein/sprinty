import { describe, it, expect, afterEach } from "vitest";
import { startDashboard, type Dashboard } from "./server.js";
import type { SprintView } from "../domain/projection.js";

const view: SprintView = {
  goal: "g",
  worktree: "/w",
  branch: "main",
  dir: "/r",
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
});
