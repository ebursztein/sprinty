import { describe, it, expect } from "vitest";
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
