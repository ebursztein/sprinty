import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { LedgerEvent } from "../domain/events.js";

// Distributive omit: keep each union variant's own fields (a plain Omit over a
// discriminated union collapses to only the common keys).
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewEvent = DistributiveOmit<LedgerEvent, "seq" | "ts">;

export class Ledger {
  constructor(private readonly file: string) {}

  read(): LedgerEvent[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim().length > 0);
    return lines.map((line) => LedgerEvent.parse(JSON.parse(line)));
  }

  append(event: NewEvent): LedgerEvent {
    const seq = this.read().length;
    const full = LedgerEvent.parse({ ...event, seq, ts: new Date().toISOString() });
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(full) + "\n", "utf8");
    return full;
  }
}
