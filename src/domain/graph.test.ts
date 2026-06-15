import { describe, it, expect } from "vitest";
import { buildDependencyGraph, GraphCycleError } from "./graph.js";

describe("buildDependencyGraph", () => {
  it("builds adjacency indexes and topologically sorts dependencies before dependents", () => {
    const graph = buildDependencyGraph(
      [
        { id: "S01", kind: "subsprint", label: "foundation", status: "open" },
        { id: "S01-001", kind: "item", label: "base", status: "completed" },
        { id: "S01-002", kind: "item", label: "dependent", status: "open" },
      ],
      [
        { from: "S01-001", to: "S01" },
        { from: "S01-002", to: "S01-001" },
      ],
    );

    expect(graph.topological_order).toEqual(["S01", "S01-001", "S01-002"]);
    expect(graph.blocked_by["S01-002"]).toEqual(["S01-001"]);
    expect(graph.unblocks["S01-001"]).toEqual(["S01-002"]);
    expect(graph.cycles).toEqual([]);
  });

  it("detects cycles instead of returning a fake topological order", () => {
    const graph = buildDependencyGraph(
      [
        { id: "A", kind: "item", label: "A", status: "open" },
        { id: "B", kind: "item", label: "B", status: "open" },
      ],
      [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
      ],
    );

    expect(graph.topological_order).toEqual([]);
    expect(graph.cycles).toEqual([["A", "B", "A"]]);
  });

  it("can throw on cycles for write-time validation", () => {
    expect(() => buildDependencyGraph(
      [
        { id: "A", kind: "item", label: "A", status: "open" },
        { id: "B", kind: "item", label: "B", status: "open" },
      ],
      [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
      ],
      { throwOnCycle: true },
    )).toThrow(GraphCycleError);
  });
});
