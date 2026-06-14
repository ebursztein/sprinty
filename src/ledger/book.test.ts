import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SprintBook } from "./book.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sprinty-book-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SprintBook", () => {
  it("has no current sprint initially", () => {
    expect(new SprintBook(dir).currentId()).toBeNull();
  });

  it("allocates sequential ids and tracks the current pointer", () => {
    const book = new SprintBook(dir);
    const a = book.allocateId();
    expect(a).toBe("001");
    book.setCurrent(a);
    expect(book.currentId()).toBe("001");
    expect(existsSync(join(dir, ".sprinty", "current"))).toBe(true);
    book.ledger(a).append({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" });
    expect(book.allocateId()).toBe("002"); // reflects the existing 001.jsonl
  });

  it("ledger(id) reads/writes .sprinty/<id>.jsonl", () => {
    const book = new SprintBook(dir);
    book.ledger("001").append({ type: "sprint_created", goal: "g", worktree: "/w", branch: "main", dir: "/r" });
    expect(existsSync(join(dir, ".sprinty", "001.jsonl"))).toBe(true);
  });
});
