import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { withDataLock, commitTransaction } from "./transaction.js";
import { dirname, basename } from "node:path";
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
    return withDataLock(dirname(this.file), () => this.readUnlocked());
  }

  private readUnlocked(): LedgerEvent[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim().length > 0);
    return lines.map((line) => LedgerEvent.parse(JSON.parse(line)));
  }

  append(event: NewEvent): LedgerEvent {
    return withDataLock(dirname(this.file), () => {
      const size = this.size();
      const seq = this.seqAtSize?.size === size ? this.seqAtSize.seq : this.countEvents();
      const full = LedgerEvent.parse({ ...event, seq, ts: new Date().toISOString() });
      // A single low-level append is one locked write. Store mutations use commit()
      // for journaled, fsynced transactions (including their pointer/output writes).
      const line = JSON.stringify(full) + "\n";
      appendFileSync(this.file, line, "utf8");
      this.seqAtSize = { size: size + Buffer.byteLength(line), seq: seq + 1 };
      return full;
    });
  }

  commit(events: LedgerEvent[], extra: import("./transaction.js").FileWrite[] = []): void {
    withDataLock(dirname(this.file), () => {
      const size = this.size();
      const contents = events.map((event) => JSON.stringify(LedgerEvent.parse(event)) + "\n").join("");
      commitTransaction(dirname(this.file), [
        ...(contents ? [{ name: basename(this.file), offset: size, contents }] : []), ...extra,
      ]);
      this.seqAtSize = events.length ? { size: size + Buffer.byteLength(contents), seq: events.at(-1)!.seq + 1 } : null;
    });
  }

  private size(): number {
    return existsSync(this.file) ? statSync(this.file).size : 0;
  }

  private countEvents(): number {
    if (!existsSync(this.file)) return 0;
    return readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim().length > 0).length;
  }
}
