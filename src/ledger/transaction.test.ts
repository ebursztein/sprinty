import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withDataLock } from "./transaction.js";
const dirs: string[] = [];
function dir() { const d = mkdtempSync(join(tmpdir(), "sprinty-transaction-")); dirs.push(d); return d; }
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
describe("transaction recovery", () => {
    it("replays an interrupted append and pointer update idempotently", () => {
        const root = dir();
        writeFileSync(join(root, "001.jsonl"), "old\npartial");
        writeFileSync(join(root, ".transaction.json"), JSON.stringify([{ name: "001.jsonl", offset: 4, contents: "new\n" }, { name: "current", contents: "001\n" }]));
        withDataLock(root, () => expect(readFileSync(join(root, "001.jsonl"), "utf8")).toBe("old\nnew\n"));
        withDataLock(root, () => expect(readFileSync(join(root, "current"), "utf8")).toBe("001\n"));
        expect(existsSync(join(root, ".transaction.json"))).toBe(false);
    });
    it("recovers a dead process lock but never steals a live one", () => {
        const root = dir();
        mkdirSync(join(root, ".write-lock"));
        writeFileSync(join(root, ".write-lock", "2147483647-dead"), "2147483647");
        expect(withDataLock(root, () => 42)).toBe(42);
        mkdirSync(join(root, ".write-lock"));
        writeFileSync(join(root, ".write-lock", `${process.pid}-live`), String(process.pid));
        expect(() => withDataLock(root, () => 0, 10)).toThrow("busy");
    });
});
