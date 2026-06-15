import { describe, it, expect } from "vitest";
import { windowCurrent } from "./current.js";
import type { SprintView } from "../domain/projection.js";

function view(): SprintView {
  return {
    goal: "g", worktree: "/w", branch: "main", dir: "/r", status: "active",
    created_at: "2026-06-14T00:00:00.000Z", closed_at: null, context_notes: [], timeline: [],
    graph: { nodes: [], edges: [{ from: "S01-002", to: "S01-001" }] },
    subsprints: [{
      id: "S01", description: "d", created_at: "2026-06-14T00:00:00.000Z", closed_at: null, goals: ["go"], gates: [], status: "open", spawned_from_item: null, notes: ["n"], dependencies: [],
      items: [
        { id: "S01-001", subsprint_id: "S01", description: "done one", created_at: "2026-06-14T00:00:00.000Z", resolved_at: "2026-06-14T00:01:00.000Z", code_locations: ["a"], gates: [], status: "completed", disposition: "completed", commit_id: "abc", gate_results: [], reason: null, spawned_subsprint: null, updates: [], notes: [], dependencies: [], changelog: { verb: "fixed", line: "Fixed one thing." } },
        { id: "S01-002", subsprint_id: "S01", description: "open one", created_at: "2026-06-14T00:02:00.000Z", resolved_at: null, code_locations: ["b"], gates: [], status: "open", disposition: null, commit_id: null, gate_results: [], reason: null, spawned_subsprint: null, updates: [], notes: [], dependencies: ["S01-001"], changelog: null },
      ],
    }],
  };
}

describe("windowCurrent", () => {
  it("returns last resolved + next open and scopes notes to current subsprint", () => {
    const w = windowCurrent(view(), 1, 3);
    expect(w.last_resolved.map((i) => i.id)).toEqual(["S01-001"]);
    expect(w.next.map((i) => i.id)).toEqual(["S01-002"]);
    expect(w.current_subsprint?.id).toBe("S01");
    expect(w.current_subsprint?.notes).toEqual(["n"]);
    expect(w.graph.edges).toEqual([{ from: "S01-002", to: "S01-001" }]);
  });
});
