import { describe, it, expect } from "vitest";
import { GateKind, Disposition, ItemStatus, ChangelogVerb, SubsprintStatus, SprintStatus, EventType } from "./enums.js";

describe("enums", () => {
  it("GateKind accepts known kinds and rejects others", () => {
    expect(GateKind.parse("test")).toBe("test");
    expect(() => GateKind.parse("smuggled")).toThrow();
  });
  it("Disposition is exactly the three honest exits", () => {
    expect(Disposition.options).toEqual(["completed", "split", "deprecated"]);
  });
  it("ItemStatus / SubsprintStatus / SprintStatus are closed sets", () => {
    expect(ItemStatus.options).toEqual(["open", "completed", "split", "deprecated"]);
    expect(SubsprintStatus.options).toEqual(["open", "closed", "deprecated"]);
    expect(SprintStatus.options).toEqual(["active", "closed", "archived"]);
  });
  it("ChangelogVerb is the semver-facing verb set", () => {
    expect(ChangelogVerb.options).toEqual(["added", "fixed", "changed", "removed", "deprecated", "security"]);
  });
  it("EventType enumerates every ledger event", () => {
    expect(EventType.options).toEqual([
      "sprint_created", "subsprint_created", "item_added",
      "item_updated", "item_resolved", "note_added", "dependencies_added", "dependencies_replaced",
      "artifact_added", "artifact_amended", "artifact_deprecated",
      "follow_up_added", "spike_concluded", "spike_deprecated",
      "sprint_closed", "sprint_archived",
    ]);
  });
});
