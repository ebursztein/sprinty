import { describe, expect, it } from "vitest";
import { windowCurrent } from "../tools/current.js";
import type { ItemView, SprintView } from "../domain/projection.js";

function item(id: string, notes: string[] = [], status: ItemView["status"] = "open"): ItemView {
  return {
    id,
    subsprint_id: "S01",
    title: `Item ${id}`,
    description: `Implement ${id}.`,
    high_priority: false,
    created_at: "2026-06-27T00:00:00.000Z",
    resolved_at: status === "open" ? null : "2026-06-27T00:10:00.000Z",
    code_locations: ["src/store/store.ts"],
    gates: [{ kind: "command", spec: "true" }],
    status,
    disposition: status === "open" ? null : status,
    dependencies: [],
    commit_id: status === "completed" ? "abc1234" : null,
    gate_results: [],
    reason: null,
    spawned_subsprint: null,
    changelog: null,
    change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
    updates: [],
    notes,
    artifacts: [],
    follow_ups: [],
  };
}

function view(items: ItemView[]): SprintView {
  return {
    goal: "g",
    worktree: "/w",
    branch: "main",
    dir: "/r",
    data_dir: "/r/.sprinty",
    context_notes: [],
    created_at: "2026-06-27T00:00:00.000Z",
    closed_at: null,
    status: "active",
    timeline: [],
    graph: {
      nodes: items.map((i) => ({ id: i.id, kind: "item", label: i.title, status: i.status })),
      edges: [],
      blocked_by: Object.fromEntries(items.map((i) => [i.id, []])),
      unblocks: Object.fromEntries(items.map((i) => [i.id, []])),
      topological_order: items.map((i) => i.id),
      cycles: [],
    },
    artifacts: [],
    follow_ups: [],
    changelog: [],
    change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
    coverage: null,
    coverage_state: { status: "not_configured" },
    subsprints: [{
      id: "S01",
      kind: "feature",
      description: "d",
      created_at: "2026-06-27T00:00:00.000Z",
      closed_at: null,
      goals: ["go"],
      gates: [{ kind: "command", spec: "true" }],
      status: "open",
      spawned_from_item: null,
      dependencies: [],
      notes: [],
      artifacts: [],
      follow_ups: [],
      spike_conclusion: null,
      spike_deprecation_reason: null,
      changelog: [],
      change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
      items,
    }],
  };
}

describe("next note pressure contract", () => {
  it("lists open items with notes and reports close pressure at the budget", () => {
    const items = [
      item("S01-001", ["one"]),
      item("S01-002", ["one", "two", "three"]),
      item("S01-003", ["one"]),
      item("S01-004", ["one"]),
      item("S01-005", ["one"]),
      item("S01-006"),
      item("S01-007", ["closed note"], "completed"),
    ];

    const current = windowCurrent(view(items), 1, 2);

    expect(current.items_with_notes.open_count).toBe(5);
    expect(current.items_with_notes.open_budget).toBe(5);
    expect(current.items_with_notes.pressure).toContain("Close or split");
    expect(current.items_with_notes.items.map((row) => row.id)).toEqual(["S01-001", "S01-002", "S01-003", "S01-004", "S01-005"]);
    expect(current.items_with_notes.items[1]).toMatchObject({ id: "S01-002", note_count: 3, over_item_note_budget: true });
  });
});
