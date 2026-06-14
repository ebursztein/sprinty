import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SprintStore, StoreError } from "./store.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-store-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  writeFileSync(join(dir, "f.txt"), "x");
  run(["add", "f.txt"]);
  run(["commit", "-m", "init"]);
  return { dir, sha: run(["rev-parse", "HEAD"]) };
}

let dir: string, sha: string, store: SprintStore;
beforeEach(() => { ({ dir, sha } = initRepo()); store = new SprintStore(dir); });

describe("SprintStore lifecycle", () => {
  it("creates a sprint, rejects a second while open, allows one after close", () => {
    const s = store.createSprint("ship sprinty");
    expect(s.goal).toBe("ship sprinty");
    expect(s.branch).toBe("main");
    expect(() => store.createSprint("again")).toThrow(StoreError);
    store.closeSprint();                       // empty sprint closes cleanly
    expect(store.createSprint("next").goal).toBe("next");
  });

  it("mints subsprint and item ids", () => {
    store.createSprint("g");
    const sub = store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    expect(sub.id).toBe("S01");
    const item = store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(item.id).toBe("S01-001");
  });

  it("rejects adding an item to an unknown subsprint", () => {
    store.createSprint("g");
    expect(() => store.addItem({ subsprint: "S99", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] })).toThrow(StoreError);
  });

  it("done rejects a fake commit and accepts a real one", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.done({ item: "S01-001", commit_id: "0000000000000000000000000000000000000000", gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }] })).toThrow(StoreError);
    const view = store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }] });
    expect(view.subsprints[0]!.items[0]!.status).toBe("resolved");
  });

  it("done rejects a failed gate result", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: false, evidence: "boom" }] })).toThrow(StoreError);
  });

  it("split resolves the item and creates a seeded subsprint atomically", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "too big", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const view = store.split({ item: "S01-001", description: "promoted", goals: ["finish it"], gates: [{ kind: "build", spec: "true" }] });
    expect(view.subsprints[0]!.items[0]!.disposition).toBe("split");
    expect(view.subsprints[0]!.items[0]!.spawned_subsprint).toBe("S02");
    expect(view.subsprints[1]!.id).toBe("S02");
    expect(view.subsprints[1]!.spawned_from_item).toBe("S01-001");
  });

  it("deprecate requires a reason", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.deprecate({ item: "S01-001", reason: "" })).toThrow(StoreError);
    const view = store.deprecate({ item: "S01-001", reason: "superseded" });
    expect(view.subsprints[0]!.items[0]!.disposition).toBe("deprecated");
  });

  it("update attaches intermediate info and rejects an unknown target", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const view = store.updateItem({ target: "S01-001", note: "halfway" });
    expect(view.subsprints[0]!.items[0]!.updates).toEqual(["halfway"]);
    expect(() => store.updateItem({ target: "S99-999", note: "x" })).toThrow(StoreError);
  });

  it("note attaches to an item or a subsprint and rejects an unknown element", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.addNote({ element: "S01-001", text: "item note" });
    store.addNote({ element: "S01", text: "subsprint note" });
    const view = store.read();
    expect(view.subsprints[0]!.items[0]!.notes).toEqual(["item note"]);
    expect(view.subsprints[0]!.notes).toEqual(["subsprint note"]);
    expect(() => store.addNote({ element: "nope", text: "x" })).toThrow(StoreError);
  });
});

describe("sprint_close teeth", () => {
  it("refuses to close with an unresolved item and lists the blocker", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    try { store.closeSprint(); throw new Error("should have thrown"); }
    catch (e) { expect(e).toBeInstanceOf(StoreError); expect((e as StoreError).blockers.join(" ")).toContain("S01-001"); }
  });

  it("closes when every item is resolved and gates re-run green", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }] });
    const view = store.closeSprint();
    expect(view.status).toBe("closed");
  });

  it("refuses to close when a gate re-run fails", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "exit 1" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }] });
    expect(() => store.closeSprint()).toThrow(StoreError);
  });
});
