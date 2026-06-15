import { describe, it, expect } from "vitest";
import { Gate, GateResult } from "./gates.js";

describe("Gate", () => {
  it("requires a kind and a non-empty spec", () => {
    expect(Gate.parse({ kind: "test", spec: "src/foo.test.ts::handles empty", cwd: "packages/api" })).toEqual({
      kind: "test", spec: "src/foo.test.ts::handles empty", cwd: "packages/api",
    });
    expect(() => Gate.parse({ kind: "test", spec: "" })).toThrow();
    expect(() => Gate.parse({ kind: "test", spec: "true", cwd: "" })).toThrow();
    expect(() => Gate.parse({ kind: "nope", spec: "x" })).toThrow();
  });
});

describe("GateResult", () => {
  it("carries pass/fail and non-empty evidence", () => {
    const r = GateResult.parse({ kind: "command", spec: "npm test", cwd: "packages/api", passed: true, evidence: "42 passing" });
    expect(r.passed).toBe(true);
    expect(r.cwd).toBe("packages/api");
    expect(r.supersedes).toBeUndefined();
    expect(r.supersession_reason).toBeUndefined();
    expect(() => GateResult.parse({ kind: "command", spec: "npm test", passed: true, evidence: "" })).toThrow();
    expect(() => GateResult.parse({ kind: "command", spec: "npm test", cwd: "", passed: true, evidence: "ok" })).toThrow();
  });

  it("requires a reason for explicit gate supersession", () => {
    const r = GateResult.parse({
      kind: "test",
      spec: "npm test -- src/store/store.test.ts",
      passed: true,
      evidence: "passed",
      supersedes: { kind: "test", spec: "npm test -- --story SPRINTY-123" },
      supersession_reason: "Replaced placeholder story id with the final focused test.",
    });
    expect(r.supersedes?.spec).toBe("npm test -- --story SPRINTY-123");
    expect(() => GateResult.parse({
      kind: "test",
      spec: "npm test -- src/store/store.test.ts",
      passed: true,
      evidence: "passed",
      supersedes: { kind: "test", spec: "npm test -- --story SPRINTY-123" },
    })).toThrow(/reason/);
  });
});
