import { describe, it, expect } from "vitest";
import { searchLedger } from "./search.js";
import type { LedgerEvent } from "./events.js";

const t = "2026-06-14T00:00:00.000Z";
function ev(partial: Omit<LedgerEvent, "seq" | "ts">, seq: number): LedgerEvent {
  return { seq, ts: t, ...partial } as LedgerEvent;
}

describe("searchLedger", () => {
  it("matches by regex and returns surrounding context", () => {
    const events: LedgerEvent[] = [
      ev({ type: "sprint_created", goal: "ship", worktree: "/w", branch: "main", dir: "/r" }, 0),
      ev({ type: "subsprint_created", subsprint_id: "S01", description: "serializer work", goals: ["g"], gates: [{ kind: "build", spec: "b" }], spawned_from_item: null }, 1),
      ev({ type: "item_added", item_id: "S01-001", subsprint_id: "S01", description: "roundtrip", code_locations: ["a.ts"], gates: [{ kind: "test", spec: "x" }] }, 2),
    ];
    const m = searchLedger(events, "serializer", 512);
    expect(m).toHaveLength(1);
    expect(m[0]!.id).toBe("S01");
    expect(m[0]!.text).toContain("serializer");
    expect(m[0]!.tool_call).toBe('subsprint_get({ id: "S01" })');
  });

  it("returns valid read calls for notes and artifacts", () => {
    const events: LedgerEvent[] = [
      ev({ type: "note_added", element_id: "S01-001", text: "remember serializer edge case" }, 0),
      ev({ type: "artifact_added", artifact_id: "A001", target_id: "S01-001", kind: "other", title: "Serializer notes", uri: "docs/serializer.md", description: null }, 1),
    ];
    const notes = searchLedger(events, "remember", 512);
    expect(notes[0]).toMatchObject({ id: "N000", tool_call: 'note_get({ id: "N000" })' });
    const artifacts = searchLedger(events, "Serializer", 512);
    expect(artifacts[0]).toMatchObject({ id: "A001", tool_call: 'artifact_get({ id: "A001" })' });
  });

  it("returns empty when nothing matches", () => {
    expect(searchLedger([], "anything", 0)).toEqual([]);
  });
});
