import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withDataLock, commitTransaction } from "./transaction.js";
import { Ledger } from "./ledger.js";

export class SprintBook {
  readonly root: string;
  private readonly pointer: string;
  // Callers re-resolve ledger(id) on every append; handing back the same instance is what
  // lets a Ledger keep its append cursor instead of rescanning the file each time.
  private readonly ledgers = new Map<string, Ledger>();

  constructor(dataDir: string) {
    this.root = dataDir;
    this.pointer = join(this.root, "current");
  }

  currentId(): string | null {
    if (!existsSync(this.pointer)) return null;
    const id = readFileSync(this.pointer, "utf8").trim();
    return id.length > 0 ? id : null;
  }

  setCurrent(id: string): void {
    mkdirSync(this.root, { recursive: true });
    withDataLock(this.root, () => commitTransaction(this.root, [{ name: "current", contents: id + "\n" }]));
  }

  ledger(id: string): Ledger {
    let ledger = this.ledgers.get(id);
    if (!ledger) {
      ledger = new Ledger(join(this.root, `${id}.jsonl`));
      this.ledgers.set(id, ledger);
    }
    return ledger;
  }

  allocateId(): string {
    let max = 0;
    if (existsSync(this.root)) {
      for (const f of readdirSync(this.root)) {
        const m = /^(\d+)\.jsonl$/.exec(f);
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return String(max + 1).padStart(3, "0");
  }
}
