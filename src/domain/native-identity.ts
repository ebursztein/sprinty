import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tokenHash } from "./agents.js";
import { withDataLock } from "../ledger/transaction.js";
import type { SprintStore } from "../store/store.js";

/** Local native-client identities. Credentials stay in private files, never model context or ledger plaintext. */
export function attachNativeAgent(store: SprintStore, session: string, agent = "main") {
  return withDataLock(store.dataDir, () => {
    const state = store.read();
    const dir = join(store.dataDir, ".agent-sessions", store.sprintId!);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, tokenHash(JSON.stringify([session, agent])) + ".json");
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as { id: string; token: string };
      if (state.agents.some(a => a.id === saved.id && a.attached)) return store.attachAgent(saved.token);
    }
    const identity = store.attachAgent();
    const temp = file + "." + randomUUID();
    writeFileSync(temp, JSON.stringify({ id: identity.actor.id, token: identity.token }), { mode: 0o600 });
    renameSync(temp, file);
    return identity;
  });
}
