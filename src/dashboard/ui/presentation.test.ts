import { describe, expect, it } from "vitest";
import type { DashboardModel } from "./model.js";
import type { ItemView } from "../../domain/projection.js";
import {
  buildProgressMetricRows,
  completionStatsLine,
  dedupePreserveOrder,
  fmt,
  formatDuration,
  gateStateLabel,
  itemDisplayStatus,
  itemDotStatus,
  itemRowClass,
  itemTitle,
  ledgerEntryCountLabel,
  titleCase,
  treeRowClass,
} from "./presentation.js";

// These were previously "tested" by grepping App.svelte for substrings, which passed whether or
// not the component rendered and broke on reformatting. Now they are called.

function item(overrides: Partial<ItemView> = {}): ItemView {
  return {
    id: "S01-001", subsprint_id: "S01", title: "Do the thing", description: "d",
    high_priority: false, created_at: "", resolved_at: null, code_locations: [],
    actual_code_locations: [], undeclared_code_locations: [], gates: [], status: "open",
    disposition: null, dependencies: [], commit_id: null, gate_results: [], reason: null,
    spawned_subsprint: null, changelog: null,
    change_map: { by_file: [], by_directory: [], by_language: [], hotspots: [] },
    updates: [], notes: [], artifacts: [], follow_ups: [],
    ...overrides,
  };
}

const modelWith = (blocked: ItemView[], current: ItemView | null): DashboardModel =>
  ({ blockedItems: blocked, currentItem: current } as DashboardModel);

describe("item status presentation", () => {
  it("shows a blocked item as blocked rather than open", () => {
    const target = item();
    expect(itemDisplayStatus(target, modelWith([target], null))).toBe("blocked");
    expect(itemDisplayStatus(target, modelWith([], null))).toBe("open");
  });

  it("marks the current item active, and blocked wins over active", () => {
    const target = item();
    expect(itemDotStatus(target, modelWith([], target))).toBe("active");
    expect(itemDotStatus(target, modelWith([target], target))).toBe("blocked");
  });

  it("flags blocked rows on the item row class", () => {
    const target = item();
    expect(itemRowClass(target, modelWith([target], null))).toContain("blocked");
    expect(itemRowClass(target, modelWith([], null))).not.toContain("todo-blocked");
  });

  it("marks only the selected subsprint row as selected", () => {
    const sub = { id: "S01", tone: "normal" } as Parameters<typeof treeRowClass>[0];
    expect(treeRowClass(sub, "S01")).toContain("tree-row-selected");
    expect(treeRowClass(sub, "S02")).not.toContain("tree-row-selected");
  });
});

describe("gate state labels", () => {
  it("renders a timed-out gate as too slow, distinct from failed", () => {
    expect(gateStateLabel("unverified")).toBe("too slow");
    expect(gateStateLabel("failed")).toBe("failed");
    expect(gateStateLabel("passed")).toBe("passed");
  });
});

describe("formatting", () => {
  it("returns an empty string for a missing timestamp and passes through unparseable ones", () => {
    expect(fmt(null)).toBe("");
    expect(fmt(undefined)).toBe("");
    expect(fmt("not a date")).toBe("not a date");
  });

  it("formats durations and handles the unknown case", () => {
    expect(formatDuration(null)).toBe("--");
    expect(formatDuration(1_000)).toMatch(/1/);
    expect(formatDuration(3_600_000)).toMatch(/1/);
  });

  it("keeps first occurrence order when deduping", () => {
    expect(dedupePreserveOrder(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("titlecases snake and kebab words", () => {
    expect(titleCase("high_priority")).toBe("High Priority");
    expect(titleCase("added")).toBe("Added");
  });

  it("falls back to the description when an item has no title", () => {
    expect(itemTitle(item({ title: "" as unknown as string, description: "fall back to this text" }))).toContain("fall back");
    expect(itemTitle(item({ title: "Real title" }))).toBe("Real title");
  });

  it("labels ledger counts, saying when the view is filtered", () => {
    expect(ledgerEntryCountLabel(10, 10)).toContain("10");
    expect(ledgerEntryCountLabel(3, 10)).toContain("3");
  });

  it("renders placeholders in the completion line when there is no summary", () => {
    expect(completionStatsLine(null)).toContain("--");
  });
});

describe("progress metric rows", () => {
  it("counts closed subsprints against the total, which the substring test could only guess at", () => {
    const model = {
      sprint: { subsprints: [{ status: "closed" }, { status: "closed" }, { status: "open" }] },
      progress: {
        items: { total: 9, done: 4, open: 5, percent: 44 },
        statuses: { total: 9, completed: 4, open: 5, split: 0, deprecated: 0 },
        gates: { total: 0, passed: 0, failed: 0, unverified: 0, pending: 0 },
      },
    } as unknown as DashboardModel;
    const rows = buildProgressMetricRows(model);
    const subsprints = rows.find((row) => row.label.toLowerCase().includes("subsprint"));
    expect(subsprints).toMatchObject({ done: 2, total: 3 });
  });
});
