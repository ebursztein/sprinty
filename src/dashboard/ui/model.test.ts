import { describe, expect, it } from "vitest";
import { deriveDashboardModel } from "./model.js";
import type { SprintView } from "../../domain/projection.js";

const baseTime = "2026-06-14T00:00:00.000Z";

function sprintView(): SprintView {
  return {
    goal: "Upgrade dashboard",
    worktree: "/repo",
    branch: "main",
    dir: "/repo", data_dir: "/repo/.sprinty",
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
            title: "Done work",
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
            title: "Current work",
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
            title: "Next work",
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
    expect(model.progress.statuses).toEqual({ total: 3, completed: 1, open: 2, split: 0, deprecated: 0 });
    expect(model.progress.gates).toEqual({ total: 4, passed: 2, failed: 0, pending: 2 });
    expect(model.progress.code).toEqual({ files: 0, additions: 0, deletions: 0, net: 0, churn: 0, hotspots: 0 });
    expect(model.artifacts.active).toEqual([]);
    expect(model.tree[0]!.tone).toBe("done");
    expect(model.tree[0]!.defaultOpen).toBe(false);
    expect(model.tree[1]!.tone).toBe("active");
    expect(model.tree[1]!.defaultOpen).toBe(true);
    expect(model.tree[1]!.items.map((item) => item.tone)).toEqual(["current", "next"]);
    expect(model.timeline[0]!.id).toBe("S02-001");
    expect(model.ledger[0]!.seq).toBe(0);
  });

  it("selects current and next items using dependency graph order", () => {
    const sprint = sprintView();
    const active = sprint.subsprints[1]!;
    active.items = [
      { ...active.items[0]!, id: "S02-002", description: "Dependent work", dependencies: ["S02-001"] },
      { ...active.items[1]!, id: "S02-001", description: "Prerequisite work", dependencies: [] },
    ];
    sprint.graph = {
      nodes: [
        { id: "S02-002", kind: "item", label: "Dependent work", status: "open" },
        { id: "S02-001", kind: "item", label: "Prerequisite work", status: "open" },
      ],
      edges: [{ from: "S02-002", to: "S02-001" }],
      blocked_by: { "S02-002": ["S02-001"], "S02-001": [] },
      unblocks: { "S02-002": [], "S02-001": ["S02-002"] },
      topological_order: ["S02-001", "S02-002"],
      cycles: [],
    };

    const model = deriveDashboardModel(sprint);

    expect(model.currentItem?.id).toBe("S02-001");
    expect(model.nextItem).toBeNull();
    expect(model.blockedItems.map((item) => item.id)).toEqual(["S02-002"]);
    expect(model.tree[1]!.items.map((item) => item.tone)).toEqual(["blocked", "current"]);
  });

  it("does not highlight blocked open dependents as current or next", () => {
    const sprint = sprintView();
    const active = sprint.subsprints[1]!;
    active.items = [
      { ...active.items[0]!, id: "S02-002", title: "Blocked docs", description: "Blocked docs", dependencies: ["S02-003"] },
      { ...active.items[1]!, id: "S02-003", title: "Ready tool", description: "Ready tool", dependencies: [] },
      { ...active.items[1]!, id: "S02-004", title: "Also ready", description: "Also ready", dependencies: [] },
    ];
    sprint.graph = {
      nodes: [
        { id: "S02-002", kind: "item", label: "Blocked docs", status: "open" },
        { id: "S02-003", kind: "item", label: "Ready tool", status: "open" },
        { id: "S02-004", kind: "item", label: "Also ready", status: "open" },
      ],
      edges: [{ from: "S02-002", to: "S02-003" }],
      blocked_by: { "S02-002": ["S02-003"], "S02-003": [], "S02-004": [] },
      unblocks: { "S02-002": [], "S02-003": ["S02-002"], "S02-004": [] },
      topological_order: ["S02-003", "S02-002", "S02-004"],
      cycles: [],
    };

    const model = deriveDashboardModel(sprint);

    expect(model.currentItem?.id).toBe("S02-003");
    expect(model.nextItem?.id).toBe("S02-004");
    expect(model.blockedItems.map((item) => item.id)).toEqual(["S02-002"]);
    expect(model.tree[1]!.items.map((item) => item.tone)).toEqual(["blocked", "current", "next"]);
  });
});
