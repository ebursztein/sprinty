import { describe, it, expect } from "vitest";
import { LedgerEvent } from "./events.js";

const base = { seq: 0, ts: "2026-06-14T00:00:00.000Z" };

describe("LedgerEvent", () => {
  it("parses a sprint_created event", () => {
    const e = LedgerEvent.parse({
      ...base, type: "sprint_created", goal: "ship sprinty", worktree: "/w", branch: "main", dir: "/r",
      context_notes: ["keep a real dependency graph"],
    });
    expect(e.type).toBe("sprint_created");
    expect(e.context_notes).toEqual(["keep a real dependency graph"]);
  });

  it("requires subsprint_created to have >=1 goal and >=1 gate", () => {
    const ok = {
      ...base, type: "subsprint_created", subsprint_id: "S01", description: "d",
      goals: ["g"], gates: [{ kind: "build", spec: "npm run build" }],
      spawned_from_item: null, dependencies: ["S00"],
    };
    expect(() => LedgerEvent.parse(ok)).not.toThrow();
    expect(() => LedgerEvent.parse({ ...ok, goals: [] })).toThrow();
    expect(() => LedgerEvent.parse({ ...ok, gates: [] })).toThrow();
  });

  it("requires item_added to have description, >=1 code_location and >=1 gate", () => {
    const ok = {
      ...base, type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "d",
      code_locations: ["src/x.ts"], gates: [{ kind: "test", spec: "x" }], dependencies: ["S01"],
    };
    expect(() => LedgerEvent.parse(ok)).not.toThrow();
    expect(() => LedgerEvent.parse({ ...ok, code_locations: [] })).toThrow();
    expect(() => LedgerEvent.parse({ ...ok, gates: [] })).toThrow();
  });

  it("item_resolved discriminates on disposition payloads", () => {
    const completed = {
      ...base, type: "item_resolved", item_id: "S01-001", disposition: "completed",
      commit_id: "abc123", gate_results: [{ kind: "test", spec: "x", passed: true, evidence: "ok" }],
      spawned_subsprint: null, reason: null, changelog: { verb: "fixed", line: "fixed checkout totals" },
    };
    const deprecated = {
      ...base, type: "item_resolved", item_id: "S01-001", disposition: "deprecated",
      commit_id: null, gate_results: [], spawned_subsprint: null, reason: "superseded by S02", changelog: null,
    };
    expect(() => LedgerEvent.parse(completed)).not.toThrow();
    expect(() => LedgerEvent.parse(deprecated)).not.toThrow();
  });

  it("parses dependency additions", () => {
    const e = LedgerEvent.parse({
      ...base, type: "dependencies_added", target_id: "S01-002", dependencies: ["S01-001"],
    });
    expect(e.type).toBe("dependencies_added");
    expect(e.dependencies).toEqual(["S01-001"]);
  });

  it("parses artifact additions", () => {
    const e = LedgerEvent.parse({
      ...base,
      type: "artifact_added",
      artifact_id: "A001",
      target_id: "S01-001",
      kind: "spec",
      title: "Dashboard UI spec",
      uri: "docs/superpowers/specs/dashboard.md",
      description: "Approved design artifact",
    });
    expect(e.type).toBe("artifact_added");
    expect(e.kind).toBe("spec");
    expect(e.target_id).toBe("S01-001");
  });

  it("parses artifact amendment and deprecation events", () => {
    expect(LedgerEvent.parse({
      ...base,
      type: "artifact_amended",
      artifact_id: "A001",
      title: "Updated spec",
    }).type).toBe("artifact_amended");
    const deprecated = LedgerEvent.parse({
      ...base,
      type: "artifact_deprecated",
      artifact_id: "A001",
      reason: "superseded",
    });
    expect(deprecated.type).toBe("artifact_deprecated");
  });

  it("parses follow-up and spike events", () => {
    expect(LedgerEvent.parse({
      ...base,
      type: "follow_up_added",
      follow_up_id: "F001",
      target_id: "S01-001",
      description: "Fix flaky dashboard load",
      bug_ids: ["BUG-123"],
    }).type).toBe("follow_up_added");
    expect(LedgerEvent.parse({
      ...base,
      type: "spike_concluded",
      subsprint_id: "S02",
      conclusion: "Use the existing subsprint projection with a spike flag.",
    }).type).toBe("spike_concluded");
    expect(LedgerEvent.parse({
      ...base,
      type: "spike_deprecated",
      subsprint_id: "S02",
      reason: "not needed",
    }).type).toBe("spike_deprecated");
  });

  it("parses sprint archive events", () => {
    const e = LedgerEvent.parse({
      ...base,
      type: "sprint_archived",
      reason: "alpha recovery",
    });
    expect(e.type).toBe("sprint_archived");
    expect(e.reason).toBe("alpha recovery");
  });

  it("rejects an unknown event type", () => {
    expect(() => LedgerEvent.parse({ ...base, type: "smuggled" })).toThrow();
  });
});
