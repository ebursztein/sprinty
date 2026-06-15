import { describe, it, expect } from "vitest";
import { project } from "./projection.js";
import type { LedgerEvent } from "./events.js";

const t = "2026-06-14T00:00:00.000Z";
function ev(partial: Omit<LedgerEvent, "seq" | "ts">, seq: number): LedgerEvent {
  return { seq, ts: t, ...partial } as LedgerEvent;
}

describe("project", () => {
  it("returns null with no sprint_created event", () => {
    expect(project([])).toBeNull();
  });

  it("builds sprint -> subsprint -> item and derives statuses", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "subsprint_created", subsprint_id: "S01", description: "d", goals: ["go"], gates: [{ kind: "build", spec: "b" }], spawned_from_item: null }, 1),
      ev({ type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "i1", code_locations: ["a.ts"], gates: [{ kind: "test", spec: "x" }] }, 2),
    ];
    const s = project(events)!;
    expect(s.goal).toBe("g");
    expect(s.subsprints[0]!.status).toBe("open");
    expect(s.subsprints[0]!.items[0]!.status).toBe("open");
  });

  it("projects event timestamps into the sprint timeline", () => {
    const events: LedgerEvent[] = [
      { ...ev({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" }, 0), ts: "2026-06-14T00:00:00.000Z" },
      { ...ev({ type: "subsprint_created", subsprint_id: "S01", description: "d", goals: ["go"], gates: [{ kind: "build", spec: "b" }], spawned_from_item: null }, 1), ts: "2026-06-14T00:01:00.000Z" },
      { ...ev({ type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "i1", code_locations: ["a.ts"], gates: [{ kind: "test", spec: "x" }] }, 2), ts: "2026-06-14T00:02:00.000Z" },
      { ...ev({ type: "item_resolved", item_id: "S01-001", disposition: "completed", commit_id: "deadbeef", gate_results: [{ kind: "test", spec: "x", passed: true, evidence: "ok" }], spawned_subsprint: null, reason: null }, 3), ts: "2026-06-14T00:03:00.000Z" },
      { ...ev({ type: "sprint_closed", gate_results: [] }, 4), ts: "2026-06-14T00:04:00.000Z" },
    ];
    const s = project(events)!;
    expect(s.created_at).toBe("2026-06-14T00:00:00.000Z");
    expect(s.closed_at).toBe("2026-06-14T00:04:00.000Z");
    expect(s.subsprints[0]!.created_at).toBe("2026-06-14T00:01:00.000Z");
    expect(s.subsprints[0]!.items[0]!.created_at).toBe("2026-06-14T00:02:00.000Z");
    expect(s.subsprints[0]!.items[0]!.resolved_at).toBe("2026-06-14T00:03:00.000Z");
    expect(s.timeline.map((entry) => entry.type)).toEqual([
      "sprint_created",
      "subsprint_created",
      "item_added",
      "item_resolved",
      "sprint_closed",
    ]);
  });

  it("projects context notes, dependency graph, terminal item states, and changelog", () => {
    const events: LedgerEvent[] = [
      { ...ev({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r", context_notes: ["ship carefully"] } as never, 0), ts: "2026-06-14T00:00:00.000Z" },
      { ...ev({ type: "subsprint_created", subsprint_id: "S01", description: "foundation", goals: ["go"], gates: [{ kind: "build", spec: "b", category: "unit" }], spawned_from_item: null, dependencies: [] } as never, 1), ts: "2026-06-14T00:01:00.000Z" },
      { ...ev({ type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "first", code_locations: ["a.ts"], gates: [{ kind: "test", spec: "x", category: "functional" }], dependencies: [] } as never, 2), ts: "2026-06-14T00:02:00.000Z" },
      { ...ev({ type: "item_added", item_id: "S01-002", subsprint_id: "S01", description: "second", code_locations: ["b.ts"], gates: [{ kind: "test", spec: "y" }], dependencies: ["S01-001"] } as never, 3), ts: "2026-06-14T00:03:00.000Z" },
      { ...ev({ type: "dependencies_added", target_id: "S01-002", dependencies: ["S01"] } as never, 4), ts: "2026-06-14T00:04:00.000Z" },
      { ...ev({ type: "item_resolved", item_id: "S01-001", disposition: "completed", commit_id: "deadbeef", gate_results: [{ kind: "test", spec: "x", passed: true, evidence: "ok" }], spawned_subsprint: null, reason: null, changelog: { verb: "added", line: "Added the first bookshop catalog slice." } } as never, 5), ts: "2026-06-14T00:05:00.000Z" },
      { ...ev({ type: "item_resolved", item_id: "S01-002", disposition: "deprecated", commit_id: null, gate_results: [], spawned_subsprint: null, reason: "not needed", changelog: null } as never, 6), ts: "2026-06-14T00:06:00.000Z" },
    ];
    const s = project(events)!;
    expect(s.context_notes).toEqual(["ship carefully"]);
    expect(s.subsprints[0]!.items[0]!.status).toBe("completed");
    expect(s.subsprints[0]!.items[0]!.changelog).toEqual({ verb: "added", line: "Added the first bookshop catalog slice." });
    expect(s.subsprints[0]!.items[1]!.status).toBe("deprecated");
    expect(s.subsprints[0]!.items[1]!.changelog).toBeNull();
    expect(s.subsprints[0]!.items[1]!.dependencies).toEqual(["S01-001", "S01"]);
    expect(s.graph.edges).toEqual([
      { from: "S01-002", to: "S01-001" },
      { from: "S01-002", to: "S01" },
    ]);
  });

  it("marks subsprint closed when all items resolved; attaches evidence", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "subsprint_created", subsprint_id: "S01", description: "d", goals: ["go"], gates: [{ kind: "build", spec: "b" }], spawned_from_item: null }, 1),
      ev({ type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "i1", code_locations: ["a.ts"], gates: [{ kind: "test", spec: "x" }] }, 2),
      ev({ type: "item_resolved", item_id: "S01-001", disposition: "completed", commit_id: "deadbeef", gate_results: [{ kind: "test", spec: "x", passed: true, evidence: "ok" }], spawned_subsprint: null, reason: null }, 3),
    ];
    const s = project(events)!;
    expect(s.subsprints[0]!.status).toBe("closed");
    const item = s.subsprints[0]!.items[0]!;
    expect(item.status).toBe("completed");
    expect(item.disposition).toBe("completed");
    expect(item.commit_id).toBe("deadbeef");
  });

  it("attaches notes and updates to the right element", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "subsprint_created", subsprint_id: "S01", description: "d", goals: ["go"], gates: [{ kind: "build", spec: "b" }], spawned_from_item: null }, 1),
      ev({ type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "i1", code_locations: ["a.ts"], gates: [{ kind: "test", spec: "x" }] }, 2),
      ev({ type: "note_added", element_id: "S01-001", text: "discovery: shaped like Y" }, 3),
      ev({ type: "item_updated", target_id: "S01-001", note: "halfway" }, 4),
      ev({ type: "note_added", element_id: "S01", text: "subsprint-level note" }, 5),
    ];
    const s = project(events)!;
    expect(s.subsprints[0]!.items[0]!.notes).toEqual(["discovery: shaped like Y"]);
    expect(s.subsprints[0]!.items[0]!.updates).toEqual(["halfway"]);
    expect(s.subsprints[0]!.notes).toEqual(["subsprint-level note"]);
  });

  it("attaches artifacts to sprint, subsprint, and item views", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "subsprint_created", subsprint_id: "S01", description: "d", goals: ["go"], gates: [{ kind: "build", spec: "b" }], spawned_from_item: null }, 1),
      ev({ type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "i1", code_locations: ["a.ts"], gates: [{ kind: "test", spec: "x" }] }, 2),
      ev({ type: "artifact_added", artifact_id: "A001", target_id: "sprint", kind: "plan", title: "Sprint plan", uri: "docs/plan.md", description: "Top-level plan" }, 3),
      ev({ type: "artifact_added", artifact_id: "A002", target_id: "S01", kind: "report", title: "Discovery report", uri: "docs/report.md", description: null }, 4),
      ev({ type: "artifact_added", artifact_id: "A003", target_id: "S01-001", kind: "spec", title: "Item spec", uri: "docs/spec.md", description: "Item details" }, 5),
    ];
    const s = project(events)!;
    expect(s.artifacts.map((artifact) => artifact.id)).toEqual(["A001", "A002", "A003"]);
    expect(s.artifacts[0]).toEqual({
      id: "A001",
      target_id: "sprint",
      kind: "plan",
      title: "Sprint plan",
      uri: "docs/plan.md",
      description: "Top-level plan",
      created_at: t,
    });
    expect(s.subsprints[0]!.artifacts.map((artifact) => artifact.id)).toEqual(["A002"]);
    expect(s.subsprints[0]!.items[0]!.artifacts.map((artifact) => artifact.id)).toEqual(["A003"]);
    expect(s.timeline.map((entry) => entry.type)).toContain("artifact_added");
  });

  it("reports closed status once a sprint_closed event is present", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "only", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "sprint_closed", gate_results: [] }, 1),
    ];
    const s = project(events)!;
    expect(s.goal).toBe("only");
    expect(s.status).toBe("closed");
  });

  it("reports archived status once a sprint_archived event is present", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "only", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "sprint_archived", reason: "alpha recovery" }, 1),
    ];
    const s = project(events)!;
    expect(s.goal).toBe("only");
    expect(s.status).toBe("archived");
    expect(s.closed_at).toBe(t);
  });
});
