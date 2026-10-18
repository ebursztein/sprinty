import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGate, runGateAsync, isExecutable } from "./run.js";

describe("runGate", () => {
  it("knows which kinds are executable", () => {
    expect(isExecutable({ kind: "command", spec: "git rev-parse HEAD" })).toBe(true);
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

  it("marks a timeout distinctly from a plain failure", () => {
    const slow = runGate({ kind: "command", spec: "node -e \"setTimeout(() => {}, 5000)\"" }, process.cwd(), 50);
    expect(slow.timed_out).toBe(true);
    // A gate that ran and genuinely failed is a different signal and must not be conflated.
    const failed = runGate({ kind: "command", spec: "exit 3" }, process.cwd());
    expect(failed.passed).toBe(false);
    expect(failed.timed_out).toBeUndefined();
  });

  it("allows the timeout to be disabled", () => {
    const result = runGate({ kind: "command", spec: "node -e \"setTimeout(() => {}, 30)\"" }, process.cwd(), null);
    expect(result.passed).toBe(true);
    expect(result.timed_out).toBeUndefined();
  });
});

describe("async gate execution", () => {
  it("keeps the event loop responsive and bounds captured output", async () => {
    let ticked = false;
    const result = runGateAsync({ kind: "command", spec: 'node -e "setTimeout(()=>console.log(\'x\'.repeat(5000)),50)"' }, process.cwd());
    await new Promise(resolve => setTimeout(() => { ticked = true; resolve(undefined); }, 1));
    expect(ticked).toBe(true);
    const gate = await result;
    expect(gate.passed).toBe(true); expect(gate.evidence.length).toBeLessThanOrEqual(2000);
  });
  it("reports timeouts and permits disabling them", async () => {
    const slow = await runGateAsync({ kind: "command", spec: 'node -e "setTimeout(()=>{},5000)"' }, process.cwd(), 50);
    expect(slow.timed_out).toBe(true); expect(slow.passed).toBe(false);
    expect((await runGateAsync({ kind: "command", spec: "exit 0" }, process.cwd(), null)).passed).toBe(true);
    expect((await runGateAsync({ kind: "command", spec: "exit 3" }, process.cwd())).passed).toBe(false);
  });
});
