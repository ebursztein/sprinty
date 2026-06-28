import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SprintStore, StoreError } from "../store/store.js";

function initStore(): SprintStore {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-note-guard-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  run(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "f.txt"), "x");
  run(["add", "f.txt"]);
  run(["commit", "-m", "init"]);
  const store = new SprintStore(dir);
  store.createSprint("Guard note pressure");
  store.createSubsprint({ description: "Bound notes to keep closure pressure visible.", goals: ["Keep notes short"], gates: [{ kind: "command", spec: "true" }] });
  return store;
}

function addItem(store: SprintStore, title: string): string {
  return store.addItem({
    subsprint: "S01",
    title,
    description: `Implement ${title.toLowerCase()} with focused closure evidence.`,
    code_locations: ["src/store/store.ts"],
    gates: [{ kind: "command", spec: "true" }],
  }).id;
}

describe("note guardrails", () => {
  it("rejects long notes and plan-shaped notes", () => {
    const store = initStore();
    const id = addItem(store, "First item");

    expect(() => store.addNote({ element: id, text: "x".repeat(501) })).toThrow(/500 characters/);
    expect(() => store.addNote({ element: id, text: "- do this\n- then that" })).toThrow(/more items/);
    expect(() => store.addNote({ element: id, text: "1. investigate\n2. implement" })).toThrow(/more items/);
    expect(() => store.addNote({ element: id, text: "## Plan\nInvestigate the thing." })).toThrow(/more items/);
  });

  it("limits each item to three notes", () => {
    const store = initStore();
    const id = addItem(store, "First item");

    store.addNote({ element: id, text: "First compact finding." });
    store.addNote({ element: id, text: "Second compact finding." });
    store.addNote({ element: id, text: "Third compact finding." });

    expect(() => store.addNote({ element: id, text: "Fourth compact finding." })).toThrow(/3 notes/);
  });

  it("rejects notes on a sixth open item and lists the open items with notes", () => {
    const store = initStore();
    const ids = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"].map((label) => addItem(store, `${label} item`));
    for (const id of ids.slice(0, 5)) store.addNote({ element: id, text: `Compact finding for ${id}.` });

    let err: unknown;
    try {
      store.addNote({ element: ids[5]!, text: "This would create another open note island." });
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(StoreError);
    expect((err as Error).message).toContain("5 open items already have notes");
    expect((err as StoreError).blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("S01-001"),
      expect.stringContaining("S01-005"),
    ]));
  });
});
