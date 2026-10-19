import { describe, expect, it } from "vitest";
import { marketingSprint } from "./marketing-fixture";
import { demoSprint } from "./fixtures";

describe("marketing screenshot project", () => {
  it("shows one coherent project with grouped, dependency-aware work", () => {
    const sprint = marketingSprint();
    expect(sprint.goal).toBe("Launch a product website");
    expect(sprint.subsprints.map(s => s.description)).toEqual([
      "Research & direction", "Design & content", "Build & launch",
    ]);
    const items = sprint.subsprints.flatMap(s => s.items);
    expect(items).toHaveLength(9);
    expect(items.find(i => i.id === "S02-003")?.dependencies).toEqual(["S02-001", "S02-002"]);
    expect(items.find(i => i.id === "S03-003")?.status).toBe("open");
    expect(demoSprint().goal).toBe("Ship the next release. Keep every agent in sync.");
  });
  it("attributes different tasks to three agents and records recovery context", () => {
    const sprint = marketingSprint();
    const claimed = sprint.subsprints.flatMap(s => s.items).filter(i => i.claim?.owner);
    expect(claimed).toHaveLength(3);
    expect(new Set(claimed.map(i => i.claim?.owner)).size).toBe(3);
    expect(sprint.timeline.some(e => e.text.includes("Resume here"))).toBe(true);
    expect(sprint.timeline.some(e => e.text.includes("Approved direction"))).toBe(true);
  });
  it("keeps a completed deliverable with recorded evidence and artifact", () => {
    const item = marketingSprint().subsprints.flatMap(s => s.items).find(i => i.id === "S03-001")!;
    expect(item.status).toBe("completed");
    expect(item.commit_id).toBeTruthy();
    expect(item.gate_results).toHaveLength(2);
    expect(item.gate_results.every(g => g.passed && g.evidence.length > 10)).toBe(true);
    expect(item.artifacts.some(a => a.uri === "website/index.html")).toBe(true);
  });
});
