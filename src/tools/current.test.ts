import { describe, it, expect } from "vitest";
import { windowCurrent } from "./current.js";
import type { SprintView } from "../domain/projection.js";

function view(): SprintView {
  return {
    goal: "g", worktree: "/w", branch: "main", dir: "/r", status: "active",
    subsprints: [{
      id: "S01", description: "d", goals: ["go"], gates: [], status: "open", spawned_from_item: null, notes: ["n"],
      items: [
        { id: "S01-001", subsprint_id: "S01", description: "done one", code_locations: ["a"], gates: [], status: "resolved", disposition: "completed", commit_id: "abc", gate_results: [], reason: null, spawned_subsprint: null, updates: [], notes: [] },
        { id: "S01-002", subsprint_id: "S01", description: "open one", code_locations: ["b"], gates: [], status: "open", disposition: null, commit_id: null, gate_results: [], reason: null, spawned_subsprint: null, updates: [], notes: [] },
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
  });
});
