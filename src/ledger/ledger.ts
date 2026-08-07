import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { LedgerEvent } from "../domain/events.js";

// Distributive omit: keep each union variant's own fields (a plain Omit over a
// discriminated union collapses to only the common keys).
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewEvent = DistributiveOmit<LedgerEvent, "seq" | "ts">;

export class Ledger {
  // Byte size of the file as of the last seq we computed, so an append can reuse
  // that seq instead of re-reading the whole ledger. A size mismatch means someone
  // else wrote to the file and the count has to be recomputed.
  private seqAtSize: { size: number; seq: number } | null = null;

  constructor(private readonly file: string) {}

  read(): LedgerEvent[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim().length > 0);
    return lines.map((line) => LedgerEvent.parse(JSON.parse(line)));
  }

  append(event: NewEvent): LedgerEvent {
    const size = this.size();
    const seq = this.seqAtSize?.size === size ? this.seqAtSize.seq : this.countEvents();
    const full = LedgerEvent.parse({ ...event, seq, ts: new Date().toISOString() });
    mkdirSync(dirname(this.file), { recursive: true });
    const line = JSON.stringify(full) + "\n";
    appendFileSync(this.file, line, "utf8");
    this.seqAtSize = { size: size + Buffer.byteLength(line, "utf8"), seq: seq + 1 };
    return full;
  }

  private size(): number {
    return existsSync(this.file) ? statSync(this.file).size : 0;
  }

  private countEvents(): number {
    if (!existsSync(this.file)) return 0;
    return readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim().length > 0).length;
  }
}
