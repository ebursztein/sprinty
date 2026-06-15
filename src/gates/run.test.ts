import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGate, isExecutable } from "./run.js";

describe("runGate", () => {
  it("knows which kinds are executable", () => {
    expect(isExecutable({ kind: "command", spec: "true" })).toBe(true);
    expect(isExecutable({ kind: "manual", spec: "looks right" })).toBe(false);
  });

  it("passes for a zero-exit command and captures evidence", () => {
    const r = runGate({ kind: "command", spec: "echo hello" }, process.cwd());
    expect(r.passed).toBe(true);
    expect(r.evidence).toContain("hello");
  });

  it("runs a gate from its declared cwd relative to the repo cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprinty-gate-"));
    mkdirSync(join(dir, "checks"));
    writeFileSync(join(dir, "checks", "marker.txt"), "ok");
    const r = runGate({ kind: "command", spec: "test -f marker.txt && pwd", cwd: "checks" }, dir);
    expect(r.passed).toBe(true);
    expect(r.cwd).toBe("checks");
    expect(r.evidence.trim()).toBe(realpathSync(join(dir, "checks")));
  });

  it("fails for a non-zero-exit command", () => {
    const r = runGate({ kind: "command", spec: "exit 3" }, process.cwd());
    expect(r.passed).toBe(false);
  });

  it("fails timed-out commands instead of hanging indefinitely", () => {
    const r = runGate({ kind: "command", spec: "node -e \"setTimeout(() => {}, 5000)\"" }, process.cwd(), 50);
    expect(r.passed).toBe(false);
    expect(r.evidence).toContain("timed out");
  });
});
