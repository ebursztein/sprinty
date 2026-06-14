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
    expect(item.status).toBe("resolved");
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

  it("reports closed status once a sprint_closed event is present", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "only", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "sprint_closed", gate_results: [] }, 1),
    ];
    const s = project(events)!;
    expect(s.goal).toBe("only");
    expect(s.status).toBe("closed");
  });
});
