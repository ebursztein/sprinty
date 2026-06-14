import { execSync } from "node:child_process";
import { GateKind } from "../domain/enums.js";
import type { Gate, GateResult } from "../domain/gates.js";

const EXECUTABLE: ReadonlySet<GateKind> = new Set(GateKind.options.filter((k) => k !== "manual"));

export function isExecutable(gate: Gate): boolean {
  return EXECUTABLE.has(gate.kind);
}

export function runGate(gate: Gate, cwd: string): GateResult {
  try {
    const out = execSync(gate.spec, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { kind: gate.kind, spec: gate.spec, passed: true, evidence: (out || "ok").slice(-2000) };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const evidence = String(e.stderr ?? e.stdout ?? e.message ?? "failed").slice(-2000) || "failed";
    return { kind: gate.kind, spec: gate.spec, passed: false, evidence };
  }
}
