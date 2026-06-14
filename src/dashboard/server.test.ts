import { describe, it, expect, afterEach } from "vitest";
import { startDashboard, type Dashboard } from "./server.js";
import type { SprintView } from "../domain/projection.js";

const view: SprintView = { goal: "g", worktree: "/w", branch: "main", dir: "/r", status: "active", subsprints: [] };
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
});
