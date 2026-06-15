import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ledger } from "./ledger.js";

export class SprintBook {
  readonly root: string;
  private readonly pointer: string;

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
    writeFileSync(this.pointer, id + "\n", "utf8");
  }

  ledger(id: string): Ledger {
    return new Ledger(join(this.root, `${id}.jsonl`));
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
