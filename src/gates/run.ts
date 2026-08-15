import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { Gate, GateResult } from "../domain/gates.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export { isExecutable } from "./policy.js";

export function runGate(gate: Gate, cwd: string, timeoutMs: number | null = DEFAULT_TIMEOUT_MS): GateResult {
  const gateCwd = gate.cwd ? resolve(cwd, gate.cwd) : cwd;
  try {
    const out = execSync(gate.spec, {
      cwd: gateCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...(timeoutMs === null ? {} : { timeout: timeoutMs }),
    });
    return { kind: gate.kind, spec: gate.spec, ...(gate.cwd ? { cwd: gate.cwd } : {}), passed: true, evidence: (out || "ok").slice(-2000) };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string; signal?: string };
    const timedOut = e.signal === "SIGTERM" && e.message?.includes("ETIMEDOUT");
    const raw = timedOut ? `Gate timed out after ${timeoutMs}ms.` : (e.stderr ?? e.stdout ?? e.message ?? "failed");
    const evidence = String(raw).slice(-2000) || "failed";
    return { kind: gate.kind, spec: gate.spec, ...(gate.cwd ? { cwd: gate.cwd } : {}), passed: false, evidence, ...(timedOut ? { timed_out: true } : {}) };
  }
}
