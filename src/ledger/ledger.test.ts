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

  it("keeps seq correct when another writer appended to the same file in between", () => {
    const a = ledger();
    const b = ledger();
    a.append({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" });
    b.append({ type: "note_added", element_id: "S01-001", text: "from the other writer" });
    // `a` must notice b's write rather than trusting a stale in-memory counter.
    expect(a.append({ type: "note_added", element_id: "S01-001", text: "from the first writer" }).seq).toBe(2);
    expect(a.read().map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("appends without re-reading and re-parsing the whole ledger each time", () => {
    const l = ledger();
    l.append({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" });
    const started = performance.now();
    for (let i = 0; i < 2000; i++) l.append({ type: "note_added", element_id: "S01-001", text: "breadcrumb" });
    const elapsed = performance.now() - started;
    // Whole-file re-read per append is quadratic and takes ~3s here; the incremental path is ~10x under this bound.
    expect(elapsed, `2000 appends took ${elapsed.toFixed(0)}ms`).toBeLessThan(1000);
    expect(l.read()).toHaveLength(2001);
  });
});
