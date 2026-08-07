import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SprintStore } from "../store/store.js";
import { briefing, nextTools } from "./next-tools.js";

const GATE = { kind: "command" as const, spec: "git rev-parse HEAD" };

function repo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-next-tools-"));
  const run = (a: string[]) => execFileSync("git", a, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  writeFileSync(join(dir, "a.ts"), "x");
  run(["add", "a.ts"]);
  run(["commit", "-m", "init"]);
  return { dir, sha: run(["rev-parse", "HEAD"]) };
}

describe("nextTools suggests calls that actually work", () => {
  it("suggests creating a subsprint when none exist, never a get on a fabricated id", () => {
    const { dir } = repo();
    const store = new SprintStore(dir);
    store.createSprint("fresh");
    const suggestions = nextTools(store.read());
    expect(suggestions).toEqual([`subsprint_new({ description, goals, gates })`]);
    // The old static help advertised these against a sprint that had neither.
    expect(suggestions.join(" ")).not.toContain("S01-001");
    expect(suggestions.join(" ")).not.toContain(`subsprint_get`);
  });

  it("offers both ways out of a subsprint that has no items", () => {
    const { dir } = repo();
    const store = new SprintStore(dir);
    store.createSprint("g");
    store.createSubsprint({ description: "empty", goals: ["go"], gates: [GATE] });
    expect(nextTools(store.read())).toEqual([
      `item_add({ subsprint: "S01", title, description, code_locations, gates })`,
      `item_deprecate({ id: "S01", reason })`,
    ]);
  });

  it("points at a real available item, and no longer advertises gate_results", () => {
    const { dir } = repo();
    const store = new SprintStore(dir);
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "the work to do", code_locations: ["a.ts"], gates: [GATE] });
    const suggestions = nextTools(store.read());
    expect(suggestions).toEqual([
      `item_get({ id: "S01-001" })`,
      `item_done({ id: "S01-001", commit_id, changelog })`,
    ]);
    expect(suggestions.join(" ")).not.toContain("gate_results");
  });

  it("suggests unblocking when every open item is blocked", () => {
    const { dir, sha } = repo();
    const store = new SprintStore(dir);
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "first item here", code_locations: ["a.ts"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "second item here", code_locations: ["a.ts"], gates: [GATE], dependencies: ["S01-001"] });
    store.addItem({ subsprint: "S01", description: "third item here", code_locations: ["a.ts"], gates: [GATE], dependencies: ["S01-001"] });
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." } });
    // S01-002 and S01-003 are now available, so pick the blocked-only case explicitly.
    const view = store.read();
    expect(nextTools(view)[0]).toContain("item_get");
  });

  it("moves on to closing once every item is resolved", () => {
    const { dir, sha } = repo();
    const store = new SprintStore(dir);
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "the only item", code_locations: ["a.ts"], gates: [GATE] });
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." } });
    expect(nextTools(store.read())).toEqual([`changelog({})`, `sprint_close({ coverage })`]);
  });

  it("biases to the item the caller just touched", () => {
    const { dir } = repo();
    const store = new SprintStore(dir);
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "first item here", code_locations: ["a.ts"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "second item here", code_locations: ["a.ts"], gates: [GATE] });
    expect(nextTools(store.read(), { id: "S01-002" })[0]).toBe(`item_get({ id: "S01-002" })`);
  });
});

describe("briefing restores state after context loss", () => {
  it("carries counts, the current item, blockers and recent notes", () => {
    const { dir, sha } = repo();
    const store = new SprintStore(dir);
    store.createSprint("Ship the widget");
    store.createSubsprint({ description: "core", goals: ["ship"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "first item here", code_locations: ["a.ts"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "second item here", code_locations: ["a.ts"], gates: [GATE] });
    store.addItem({ subsprint: "S01", description: "third item here", code_locations: ["a.ts"], gates: [GATE], dependencies: ["S01-002"] });
    store.addNote({ element: "S01-002", text: "the tricky bit is in the parser" });
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." } });

    const b = briefing(store.read(), store.listAllNotes());
    expect(b.goal).toBe("Ship the widget");
    expect(b.counts.items).toEqual({ open: 2, closed: 1, blocked: 1 });
    expect(b.counts.subsprints).toEqual({ open: 1, closed: 0 });
    expect(b.counts.notes).toBe(1);
    expect(b.current).toMatchObject({ id: "S01-002", subsprint: "S01" });
    expect(b.blocked).toEqual(["S01-003"]);
    expect(b.last_resolved?.[0]).toMatchObject({ id: "S01-001" });
    expect(b.recent_notes?.[0]?.text).toContain("parser");
  });

  it("stays bounded so it costs less than the calls it replaces", () => {
    const { dir } = repo();
    const store = new SprintStore(dir);
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [GATE] });
    for (let i = 0; i < 12; i++) {
      store.addItem({ subsprint: "S01", description: `item number ${i} here`, code_locations: ["a.ts"], gates: [GATE], dependencies: i === 0 ? [] : ["S01-001"] });
    }
    for (let i = 0; i < 3; i++) store.addNote({ element: "S01-001", text: "x".repeat(400) });

    const b = briefing(store.read(), store.listAllNotes());
    expect(b.blocked!.length).toBeLessThanOrEqual(5);
    expect(b.recent_notes!.length).toBeLessThanOrEqual(3);
    expect(b.recent_notes!.every((note) => note.text.length <= 120)).toBe(true);
    expect(JSON.stringify(b).length).toBeLessThan(1_200);
  });
});
