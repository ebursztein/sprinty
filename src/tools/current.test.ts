import { describe, it, expect } from "vitest";
import { windowCurrent } from "./current.js";
import type { SprintView } from "../domain/projection.js";

function view(): SprintView {
  return {
    goal: "g", worktree: "/w", branch: "main", dir: "/r", data_dir: "/r/.sprinty", status: "active",
    created_at: "2026-06-14T00:00:00.000Z", closed_at: null, context_notes: [], timeline: [
      { seq: 0, ts: "2026-06-14T00:00:00.000Z", type: "sprint_created", id: "sprint", text: "g" },
      { seq: 1, ts: "2026-06-14T00:01:00.000Z", type: "follow_up_added", id: "F001", text: "BUG-1: fix it" },
    ],
    graph: { nodes: [], edges: [{ from: "S01-002", to: "S01-001" }] },
    artifacts: [
      { id: "A001", target_id: "sprint", kind: "plan", title: "Sprint plan", uri: "docs/plan.md", description: null, created_at: "2026-06-14T00:00:00.000Z", updated_at: null, deprecated_at: null, deprecation_reason: null, status: "active" },
      { id: "A004", target_id: "S99", kind: "log", title: "Old log", uri: "docs/old.md", description: null, created_at: "2026-06-14T00:00:00.000Z", updated_at: null, deprecated_at: "2026-06-14T00:00:00.000Z", deprecation_reason: "old", status: "deprecated" },
    ],
    follow_ups: [{ id: "F001", target_id: "S01-002", description: "fix it", bug_ids: ["BUG-1"], created_at: "2026-06-14T00:01:00.000Z" }],
    subsprints: [{
      id: "S01", kind: "feature", description: "d", created_at: "2026-06-14T00:00:00.000Z", closed_at: null, goals: ["go"], gates: [], status: "open", spawned_from_item: null, notes: ["n"], dependencies: [],
      artifacts: [{ id: "A002", target_id: "S01", kind: "report", title: "Report", uri: "docs/report.md", description: null, created_at: "2026-06-14T00:00:00.000Z", updated_at: null, deprecated_at: null, deprecation_reason: null, status: "active" }],
      follow_ups: [],
      spike_conclusion: null,
      spike_deprecation_reason: null,
      changelog: [],
      change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
      items: [
        { id: "S01-001", subsprint_id: "S01", description: "done one", created_at: "2026-06-14T00:00:00.000Z", resolved_at: "2026-06-14T00:01:00.000Z", code_locations: ["a"], gates: [], status: "completed", disposition: "completed", commit_id: "abc", gate_results: [], reason: null, spawned_subsprint: null, updates: [], notes: [], dependencies: [], changelog: { verb: "fixed", line: "Fixed one thing." }, change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] }, artifacts: [], follow_ups: [] },
        { id: "S01-002", subsprint_id: "S01", description: "open one", created_at: "2026-06-14T00:02:00.000Z", resolved_at: null, code_locations: ["b"], gates: [], status: "open", disposition: null, commit_id: null, gate_results: [], reason: null, spawned_subsprint: null, updates: [], notes: [], dependencies: ["S01-001"], changelog: null, change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] }, artifacts: [{ id: "A003", target_id: "S01-002", kind: "spec", title: "Item spec", uri: "docs/spec.md", description: null, created_at: "2026-06-14T00:00:00.000Z", updated_at: null, deprecated_at: null, deprecation_reason: null, status: "active" }], follow_ups: [{ id: "F001", target_id: "S01-002", description: "fix it", bug_ids: ["BUG-1"], created_at: "2026-06-14T00:01:00.000Z" }] },
      ],
    }],
    changelog: [],
    change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
    coverage: null,
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
    expect(w.artifacts.map((artifact) => artifact.id)).toEqual(["A001", "A002", "A003"]);
    expect(w.recent_artifacts.map((artifact) => artifact.id)).toEqual(["A001", "A002", "A003"]);
    expect(w.recent_activity.map((entry) => entry.type)).toContain("follow_up_added");
  });

  it("orders next open items by dependency graph topological order", () => {
    const v = view();
    const sub = v.subsprints[0]!;
    sub.items = [
      { ...sub.items[1]!, id: "S01-002", description: "dependent", dependencies: ["S01-003"] },
      { ...sub.items[1]!, id: "S01-003", description: "prerequisite", dependencies: [] },
    ];
    v.graph = {
      nodes: [
        { id: "S01-002", kind: "item", label: "dependent", status: "open" },
        { id: "S01-003", kind: "item", label: "prerequisite", status: "open" },
      ],
      edges: [{ from: "S01-002", to: "S01-003" }],
      blocked_by: { "S01-002": ["S01-003"], "S01-003": [] },
      unblocks: { "S01-002": [], "S01-003": ["S01-002"] },
      topological_order: ["S01-003", "S01-002"],
      cycles: [],
    };

    const w = windowCurrent(v, 1, 2);

    expect(w.next.map((item) => item.id)).toEqual(["S01-003", "S01-002"]);
    expect(w.current_subsprint?.id).toBe("S01");
  });
});
