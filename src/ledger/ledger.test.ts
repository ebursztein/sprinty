import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "./ledger.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sprinty-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function ledger(): Ledger { return new Ledger(join(dir, "001.jsonl")); }

describe("Ledger", () => {
  it("starts empty", () => {
    expect(ledger().read()).toEqual([]);
  });

  it("appends events with increasing seq and persists across instances", () => {
    const l = ledger();
    l.append({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" });
    l.append({ type: "subsprint_created", subsprint_id: "S01", description: "d", goals: ["go"], gates: [{ kind: "build", spec: "b" }], spawned_from_item: null });
    const reopened = new Ledger(join(dir, "001.jsonl")).read();
    expect(reopened.map((e) => e.seq)).toEqual([0, 1]);
    expect(reopened[0]!.type).toBe("sprint_created");
  });

  it("rejects an event that fails schema validation", () => {
    // @ts-expect-error intentionally invalid
    expect(() => ledger().append({ type: "subsprint_created", subsprint_id: "S01", description: "d", goals: [], gates: [], spawned_from_item: null })).toThrow();
  });
});
