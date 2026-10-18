import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { Gate, GateResult } from "../domain/gates.js";

export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60 * 1000;

export { isExecutable } from "./policy.js";

export function runGate(gate: Gate, cwd: string, timeoutMs: number | null = DEFAULT_GATE_TIMEOUT_MS): GateResult {
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

/** Keep the transport responsive and terminate the gate's process group on timeout. */
export async function runGateAsync(gate: Gate, cwd: string, timeoutMs: number | null = DEFAULT_GATE_TIMEOUT_MS): Promise<GateResult> {
  const { spawn } = await import("node:child_process");
  return new Promise(resolveResult => {
    const grouped = process.platform !== "win32";
    const child = spawn(gate.spec, {
      shell: true, detached: grouped, cwd: gate.cwd ? resolve(cwd, gate.cwd) : cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* exited before cancellation */ }
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", data => { stdout = (stdout + data).slice(-2000); });
    child.stderr.on("data", data => { stderr = (stderr + data).slice(-2000); });
    const finish = (passed: boolean, error?: string) => {
      clearTimeout(timeout); clearTimeout(forceKill);
      const evidence = timedOut ? `Gate timed out after ${timeoutMs}ms.` : passed ? stdout || "ok" : stderr || stdout || error || "failed";
      resolveResult({ kind: gate.kind, spec: gate.spec, ...(gate.cwd ? { cwd: gate.cwd } : {}), passed: passed && !timedOut, evidence: evidence.slice(-2000), ...(timedOut ? { timed_out: true } : {}) });
    };
    child.on("error", error => finish(false, error.message));
    child.on("close", code => finish(code === 0));
    if (timeoutMs !== null) timeout = setTimeout(() => {
      timedOut = true; stop("SIGTERM");
      forceKill = setTimeout(() => stop("SIGKILL"), 1000);
    }, timeoutMs);
  });
}
