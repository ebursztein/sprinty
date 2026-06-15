import { describe, expect, it } from "vitest";
import { deriveDashboardModel } from "./model.js";
import type { SprintView } from "../../domain/projection.js";

const baseTime = "2026-06-14T00:00:00.000Z";

function sprintView(): SprintView {
  return {
    goal: "Upgrade dashboard",
    worktree: "/repo",
    branch: "main",
    dir: "/repo",
    context_notes: ["keep it local"],
    created_at: baseTime,
    closed_at: null,
    status: "active",
    artifacts: [],
    changelog: [],
    change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
    coverage: null,
    graph: { nodes: [], edges: [], blocked_by: {}, unblocks: {}, topological_order: [], cycles: [] },
    timeline: [
      { seq: 0, ts: baseTime, type: "sprint_created", id: "sprint", text: "Upgrade dashboard" },
      { seq: 1, ts: baseTime, type: "item_added", id: "S02-001", text: "Current work" },
    ],
    subsprints: [
      {
        id: "S01",
        description: "Done section",
        created_at: baseTime,
        closed_at: baseTime,
        goals: ["archive old view"],
        gates: [{ kind: "command", spec: "true" }],
        status: "closed",
        spawned_from_item: null,
        dependencies: [],
        notes: [],
        artifacts: [],
        changelog: [],
        change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
        items: [
          {
            id: "S01-001",
            subsprint_id: "S01",
            description: "Done work",
            created_at: baseTime,
            resolved_at: baseTime,
            code_locations: ["src/done.ts"],
            gates: [{ kind: "command", spec: "true" }],
            status: "completed",
            disposition: "completed",
            dependencies: [],
            commit_id: "abcdef1",
            gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
            reason: null,
            spawned_subsprint: null,
            changelog: { verb: "fixed", line: "Fixed old view." },
            change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
            updates: [],
            notes: [],
            artifacts: [],
          },
        ],
      },
      {
        id: "S02",
        description: "Active section",
        created_at: baseTime,
        closed_at: null,
        goals: ["tree", "timeline"],
        gates: [{ kind: "command", spec: "true" }],
        status: "open",
        spawned_from_item: null,
        dependencies: [],
        notes: ["watch the tree"],
        artifacts: [],
        changelog: [],
        change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
        items: [
          {
            id: "S02-001",
            subsprint_id: "S02",
            description: "Current work",
            created_at: baseTime,
            resolved_at: null,
            code_locations: ["src/current.ts"],
            gates: [{ kind: "command", spec: "true" }, { kind: "manual", spec: "browser review" }],
            status: "open",
            disposition: null,
            dependencies: [],
            commit_id: null,
            gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
            reason: null,
            spawned_subsprint: null,
            changelog: null,
            change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
            updates: ["halfway"],
            notes: ["selected"],
            artifacts: [],
          },
          {
            id: "S02-002",
            subsprint_id: "S02",
            description: "Next work",
            created_at: baseTime,
            resolved_at: null,
            code_locations: ["src/next.ts"],
            gates: [{ kind: "command", spec: "true" }],
            status: "open",
            disposition: null,
            dependencies: ["S02-001"],
            commit_id: null,
            gate_results: [],
            reason: null,
            spawned_subsprint: null,
            changelog: null,
            change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
            updates: [],
            notes: [],
            artifacts: [],
          },
        ],
      },
    ],
  };
}

describe("deriveDashboardModel", () => {
  it("derives progress, active tree state, timeline rows, and ledger rows", () => {
    const model = deriveDashboardModel(sprintView());
    expect(model.activeSubsprint?.id).toBe("S02");
    expect(model.currentItem?.id).toBe("S02-001");
    expect(model.nextItem?.id).toBe("S02-002");
    expect(model.progress.items).toEqual({ total: 3, done: 1, open: 2, percent: 33 });
    expect(model.progress.gates).toEqual({ total: 4, passed: 2, failed: 0, pending: 2 });
    expect(model.tree[0]!.tone).toBe("done");
    expect(model.tree[0]!.defaultOpen).toBe(false);
    expect(model.tree[1]!.tone).toBe("active");
    expect(model.tree[1]!.defaultOpen).toBe(true);
    expect(model.tree[1]!.items.map((item) => item.tone)).toEqual(["current", "next"]);
    expect(model.timeline[0]!.id).toBe("S02-001");
    expect(model.ledger[0]!.seq).toBe(0);
  });
});
