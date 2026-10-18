import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { SprintStore } from "./store.js";
import { actors } from "../domain/agents.js";
import { buildToolHandlers } from "../tools/register.js";
const dirs: string[] = [];
function fixture() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "sprinty-concurrent-")));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "file"), "test");
    git("add", "file");
    git("commit", "-m", "init");
    const store = new SprintStore(dir);
    store.createSprint("Concurrency");
    store.createSubsprint({ description: "Feature", goals: ["Safe work"], gates: [{ kind: "manual", spec: "review" }] });
    const add = () => store.addItem({ subsprint: "S01", description: "One item", code_locations: ["file"], gates: [{ kind: "command", spec: 'node -e "setTimeout(()=>{},150)"' }] }).id;
    return { dir, store, add, sha: git("rev-parse", "HEAD") };
}
function child(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "", err = "";
        proc.stdout.on("data", chunk => out += chunk);
        proc.stderr.on("data", chunk => err += chunk);
        proc.on("error", reject);
        proc.on("exit", exit => exit === 0 ? resolve(out.trim()) : reject(new Error(err)));
    });
}
const storeModule = pathToFileURL(join(process.cwd(), "dist/store/store.js")).href;
const actorModule = pathToFileURL(join(process.cwd(), "dist/domain/agents.js")).href;
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe("concurrent writers and agents", () => {
    it("allocates unique item IDs and sequences across real processes", async () => {
        const { dir, store } = fixture();
        await Promise.all(Array.from({ length: 3 }, () => child(`
      import { SprintStore } from ${JSON.stringify(storeModule)};
      const store = new SprintStore(${JSON.stringify(dir)});
      for(let i=0;i<5;i++) store.addItem({subsprint:'S01',description:'Concurrent item',code_locations:['file'],gates:[{kind:'manual',spec:'review'}]});
    `)));
        expect(new Set(store.read().subsprints[0]!.items.map(i => i.id)).size).toBe(15);
        const events = readFileSync(join(dir, ".sprinty/001.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
        expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i));
    });
    it("creates only one successor sprint when processes start it together", async () => {
        const { dir, store } = fixture();
        store.archiveSprint({ reason: "Finished fixture setup" });
        const result = await Promise.all(Array.from({ length: 3 }, () => child(`
      import { SprintStore } from ${JSON.stringify(storeModule)};
      const store = new SprintStore(${JSON.stringify(dir)});
      try { store.createSprint('Successor'); process.stdout.write('won'); } catch { process.stdout.write('lost'); }
    `)));
        expect(result.filter(r => r === "won")).toHaveLength(1);
        expect(readFileSync(join(dir, ".sprinty/current"), "utf8").trim()).toBe("002");
    });
    it("recovers a journal and abandoned lock after its writer exits mid-transaction", async () => {
        const { dir, store, add } = fixture();
        const id = add();
        const transactionModule = pathToFileURL(join(process.cwd(), "dist/ledger/transaction.js")).href;
        await child(`
      import { withDataLock } from ${JSON.stringify(transactionModule)};
      import { readFileSync,writeFileSync,appendFileSync } from 'node:fs';
      import { join } from 'node:path';
      const root=${JSON.stringify(join(dir, ".sprinty"))};
      withDataLock(root,()=>{
        const path=join(root,'001.jsonl'), original=readFileSync(path,'utf8');
        const event={type:'note_added',element_id:${JSON.stringify(id)},text:'Recovered evidence',note_id:'N123456abcdef',seq:original.trim().split('\\n').length,ts:new Date().toISOString()};
        const contents=JSON.stringify(event)+'\\n';
        writeFileSync(join(root,'.transaction.json'),JSON.stringify([{name:'001.jsonl',offset:Buffer.byteLength(original),contents}]));
        appendFileSync(path,contents.slice(0,20));
        process.exit(0);
      });
    `);
        expect(store.read().subsprints[0]!.items[0]!.notes).toEqual(["Recovered evidence"]);
        expect(store.read().subsprints[0]!.items[0]!.notes).toEqual(["Recovered evidence"]);
    });
    it("grants exactly one claim across real processes", async () => {
        const { dir, store, add } = fixture();
        const id = add();
        const result = await Promise.all(Array.from({ length: 3 }, () => child(`
      import { SprintStore } from ${JSON.stringify(storeModule)};
      import { actors } from ${JSON.stringify(actorModule)};
      const store = new SprintStore(${JSON.stringify(dir)});
      const identity = store.attachAgent();
      actors.run(identity.actor,()=>{try {store.claimItem(${JSON.stringify(id)});process.stdout.write('won')} catch {process.stdout.write('lost')}});
    `)));
        expect(result.filter(r => r === "won")).toHaveLength(1);
        expect(store.read().subsprints[0]!.items[0]!.claim.history).toHaveLength(1);
    });
    it("fences stale owners, records handovers and releases only the detached agent", () => {
        const { dir, store, add } = fixture();
        const first = add(), second = add();
        let now = Date.now();
        const timed = new SprintStore(dir, join(dir, ".sprinty"), () => now);
        const a = timed.attachAgent(), b = timed.attachAgent();
        actors.run(a.actor, () => timed.claimItem(first));
        actors.run(b.actor, () => timed.claimItem(second));
        expect(() => actors.run(b.actor, () => timed.updateItem({ target: first, title: "wrong" }))).toThrow("Claim");
        now += 3600000;
        actors.run(b.actor, () => timed.claimItem(first, "Owner offline; taking over implementation."));
        expect(() => actors.run(a.actor, () => timed.progressItem(first, "stale"))).toThrow("Claim");
        actors.run(a.actor, () => timed.detachAgent());
        expect(timed.read().subsprints[0]!.items.every(i => i.claim.owner === b.actor.id)).toBe(true);
        expect(() => actors.run(b.actor, () => timed.claimItem(second, "x".repeat(501)))).toThrow();
    });
    it("grants exactly one recovery across processes and fences the interrupted owner", async () => {
        const { dir, store, add } = fixture();
        const id = add();
        const original = store.attachAgent();
        actors.run(original.actor, () => store.claimItem(id));
        const now = Date.now() + 6 * 60000;
        const result = await Promise.all(Array.from({ length: 3 }, () => child(`
      import { SprintStore } from ${JSON.stringify(storeModule)};
      import { actors } from ${JSON.stringify(actorModule)};
      const store = new SprintStore(${JSON.stringify(dir)}, ${JSON.stringify(join(dir, ".sprinty"))}, () => ${now});
      const identity = store.attachAgent();
      actors.run(identity.actor,()=>{try {store.claimItem(${JSON.stringify(id)},'Original session terminated.',true);process.stdout.write('won')} catch {process.stdout.write('lost')}});
    `)));
        expect(result.filter(r => r === "won")).toHaveLength(1);
        expect(store.read().subsprints[0]!.items[0]!.claim.generation).toBe(2);
        expect(() => actors.run(original.actor, () => store.progressItem(id, "Stale write"))).toThrow("Claim");
    });
    it("rejects ambiguity on a shared connection and scopes authenticated calls", async () => {
        const { store, add } = fixture();
        const id = add();
        const handlers = buildToolHandlers(() => store, { open: async () => ({ running: false }), restart: async () => ({ running: false }), info: async () => ({ running: false }), close: () => undefined });
        const a = await handlers.agent_attach!.handler({}) as any;
        const b = await handlers.agent_attach!.handler({}) as any;
        await expect(handlers.next!.handler({})).rejects.toThrow("Multiple agents");
        await handlers.item_claim!.handler({ id, agent_token: a.agent.token });
        await expect(handlers.item_update!.handler({ id, title: "Wrong owner", agent_token: b.agent.token })).rejects.toThrow("Claim");
        await handlers.agent_detach!.handler({ agent_token: b.agent.token });
        const next = await handlers.next!.handler({}) as any;
        expect(next.agent.id).toBe(a.agent.id);
        expect(next.item.id).toBe(id);
        expect(JSON.stringify(next)).not.toContain("token_hash");
    });
    it("retains both fences when one agent claims items concurrently", async () => {
        const { store, add } = fixture(); const first = add(), second = add();
        const handlers = buildToolHandlers(() => store, {open:async()=>({running:false}),restart:async()=>({running:false}),info:async()=>({running:false}),close:()=>undefined});
        await handlers.agent_attach!.handler({});
        await Promise.all([handlers.item_claim!.handler({id:first}),handlers.item_claim!.handler({id:second})]);
        await handlers.item_update!.handler({id:first,title:"First claimed item"});
        await handlers.item_update!.handler({id:second,title:"Second claimed item"});
        expect(store.read().subsprints[0]!.items.map(item=>item.title)).toEqual(["First claimed item","Second claimed item"]);
    });

    it("runs gates outside locks and rejects changed settings before committing", async () => {
        const { store, add, sha } = fixture();
        const id = add();
        const identity = store.attachAgent();
        await actors.run(identity.actor, async () => {
            store.claimItem(id);
            const result = store.doneAsync({ item: id, commit_id: sha, changelog: { verb: "added", line: "Implemented item" } });
            store.updateItem({ target: id, title: "Changed while gate runs" });
            await expect(result).rejects.toThrow("changed while gates ran");
            expect(store.read().subsprints[0]!.items[0]!.status).toBe("open");
        });
    });
    it("does not invalidate gate evidence merely because an agent heartbeats", async () => {
        const { dir, add, sha } = fixture();
        const id = add();
        let now = Date.now();
        const store = new SprintStore(dir, join(dir, ".sprinty"), () => now);
        const identity = store.attachAgent();
        await actors.run(identity.actor, async () => {
            store.claimItem(id);
            const done = store.doneAsync({ item: id, commit_id: sha, changelog: { verb: "added", line: "Implemented" } });
            now += 2000;
            store.activity();
            expect((await done).view.subsprints[0]!.items[0]!.status).toBe("completed");
        });
    });
    it("rolls back a split when its second event fails validation", () => {
        const { store, add } = fixture();
        const id = add();
        expect(() => store.split({ item: id, description: "Split", goals: [], gates: [{ kind: "manual", spec: "review" }] })).toThrow();
        const state = store.read();
        expect(state.subsprints).toHaveLength(1);
        expect(state.subsprints[0]!.items[0]!.status).toBe("open");
    });
    it("rejects close results if another writer changes the sprint during gates", async () => {
        const { store, add, sha } = fixture();
        const id = add();
        await store.doneAsync({ item: id, commit_id: sha, changelog: { verb: "added", line: "Implemented" } });
        const closing = store.closeAsync({ coverage: { not_applicable: "Fixture" } });
        store.createSubsprint({ description: "New work", goals: ["g"], gates: [{ kind: "manual", spec: "review" }] });
        await expect(closing).rejects.toThrow("changed while gates ran");
        expect(store.read().status).toBe("active");
    });
    it("keeps an existing store pinned after another store starts a new sprint", () => {
        const { dir, store } = fixture();
        store.archiveSprint({ reason: "Superseded" });
        const other = new SprintStore(dir);
        other.createSprint("New sprint");
        expect(store.read().goal).toBe("Concurrency");
        expect(() => store.createSubsprint({ description: "stale", goals: ["g"], gates: [{ kind: "manual", spec: "review" }] })).toThrow("archived");
        expect(other.read().goal).toBe("New sprint");
    });
});
