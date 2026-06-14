import { describe, it, expect } from "vitest";
import { GateKind, Disposition, ItemStatus, SubsprintStatus, SprintStatus, EventType } from "./enums.js";

describe("enums", () => {
  it("GateKind accepts known kinds and rejects others", () => {
    expect(GateKind.parse("test")).toBe("test");
    expect(() => GateKind.parse("smuggled")).toThrow();
  });
  it("Disposition is exactly the three honest exits", () => {
    expect(Disposition.options).toEqual(["completed", "split", "deprecated"]);
  });
  it("ItemStatus / SubsprintStatus / SprintStatus are closed sets", () => {
    expect(ItemStatus.options).toEqual(["open", "resolved"]);
    expect(SubsprintStatus.options).toEqual(["open", "closed"]);
    expect(SprintStatus.options).toEqual(["active", "closed"]);
  });
  it("EventType enumerates every ledger event", () => {
    expect(EventType.options).toEqual([
      "sprint_created", "subsprint_created", "item_added",
      "item_updated", "item_resolved", "note_added", "sprint_closed",
    ]);
  });
});
