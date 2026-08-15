import { describe, expect, it } from "vitest";
import {
  ITEM_GATE_TIMEOUT_MS,
  gateKey,
  isExecutable,
  looksLikeProse,
  slowGateWarning,
  specIsNoOp,
  validateGateEvidence,
} from "./policy.js";
import type { Gate, GateResult } from "../domain/gates.js";

const gate = (spec: string, kind: Gate["kind"] = "command"): Gate => ({ kind, spec });
const result = (spec: string, passed = true, kind: Gate["kind"] = "command"): GateResult =>
  ({ kind, spec, passed, evidence: "ok" });

describe("gate policy: no-op specs", () => {
  it("rejects specs that pass without proving anything", () => {
    for (const spec of ["true", ":", "exit 0", "echo ok", "  true  ", "/bin/true"]) {
      expect(specIsNoOp(spec), spec).toBe(true);
    }
  });

  it("accepts specs that actually run something", () => {
    for (const spec of ["npm test", "just bench", "uv run pytest tests/ -q", "./bootstrap.sh", "echo ok && npm test"]) {
      expect(specIsNoOp(spec), spec).toBe(false);
    }
  });
});

describe("gate policy: prose detection", () => {
  it("flags prose a human would have to perform", () => {
    for (const spec of ["bookshop owner accepts the dashboard direction", "docs reviewer signs off"]) {
      expect(looksLikeProse(spec), spec).toBe(true);
    }
  });

  it("does not flag real commands, including the slow ones from real sprints", () => {
    for (const spec of [
      "npm test",
      "just bench",
      "uv run pytest tests/ironbank -q -s --tb=short",
      "pnpm --dir frontend test -- --run",
      "./bootstrap.sh",
      "capsem doctor",
      "git status --short",
    ]) {
      expect(looksLikeProse(spec), spec).toBe(false);
    }
  });
});

describe("gate policy: evidence", () => {
  it("requires evidence for every declared gate and rejects extras", () => {
    expect(() => validateGateEvidence([gate("npm test")], [])).toThrow(/Missing gate evidence/);
    expect(() => validateGateEvidence([gate("npm test")], [result("npm test"), result("npm run lint")]))
      .toThrow(/Unexpected gate evidence/);
    expect(() => validateGateEvidence([gate("npm test")], [result("npm test"), result("npm test")]))
      .toThrow(/Duplicate gate evidence/);
    expect(() => validateGateEvidence([gate("npm test")], [result("npm test")])).not.toThrow();
  });

  it("keys gates by kind, spec, and cwd so the same spec in two dirs stays distinct", () => {
    expect(gateKey({ kind: "test", spec: "npm test" })).not.toBe(gateKey({ kind: "test", spec: "npm test", cwd: "web" }));
    expect(gateKey({ kind: "test", spec: "npm test" })).toBe(gateKey({ kind: "test", spec: "npm test" }));
  });
});

describe("gate policy: item budget", () => {
  it("caps inline gate execution at five seconds", () => {
    expect(ITEM_GATE_TIMEOUT_MS).toBe(5_000);
  });

  it("classifies manual gates as not executable", () => {
    expect(isExecutable(gate("npm test", "test"))).toBe(true);
    expect(isExecutable(gate("a human checks the layout", "manual"))).toBe(false);
  });

  it("warns sternly and names a replacement path when a gate blows the budget", () => {
    const warning = slowGateWarning([{ kind: "test", spec: "just bench", passed: false, evidence: "…", timed_out: true }], 250);
    expect(warning).toContain("just bench");
    expect(warning).toContain("250ms");
    // The agent must be told the item still completed, and what to do instead.
    expect(warning).toMatch(/replace/i);
    expect(warning).toMatch(/subsprint/i);
  });

  it("says nothing when no gate timed out", () => {
    expect(slowGateWarning([result("npm test")])).toBeNull();
  });
});
