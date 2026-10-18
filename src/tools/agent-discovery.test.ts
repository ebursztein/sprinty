import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { SprintStore } from "../store/store.js";
import { buildToolHandlers } from "./register.js";
import { tokenHash } from "../domain/agents.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-native-")); dirs.push(dir);
  execFileSync("git", ["init", "-q", dir]);
  let now = Date.now();
  const store = new SprintStore(dir, join(dir, ".sprinty"), () => now);
  const dashboard = { open: async () => ({ running: false }), restart: async () => ({ running: false }), info: async () => ({ running: false }), close: async () => {} };
  const make = () => buildToolHandlers(() => store, dashboard);
  return { dir, store, make, advance: (ms: number) => { now += ms; } };
}
const caller = (agent: string) => ({ client_session_id: "claude-session", client_agent_id: agent });
describe("automatic native identity and discovery", () => {
  it.each<[string, number]>([["item_claim", 0], ["item_claim", 6 * 60000], ["item_takeover", 0]])("%s forces an interrupted claim at %d ms and fences a returning session", async (tool, delay) => {
    const { dir, make, store, advance } = fixture();
    const tools = make();
    const call = async (name: string, args = {}) => await tools[name]!.handler(args) as any;
    await call("sprint_new", { goal: "Interrupted agents", git_dir: dir, ...caller("parent") });
    await call("subsprint_new", { description: "Recovery", goals: ["Recover safely"], gates: [{ kind: "manual", spec: "Inspect" }], ...caller("parent") });
    await call("item_add", { subsprint: "S01", title: "Interrupted work", description: "Recover an interrupted owner's work.", code_locations: ["src"], gates: [{ kind: "manual", spec: "Inspect" }], ...caller("parent") });
    const owned = await call("item_claim", { id: "S01-001", ...caller("child") });
    const takeover = { id: "S01-001", ...caller("parent") };
    const force = "Child session terminated; continuing its work.";
    advance(delay);
    await expect(call("item_claim", takeover)).rejects.toThrow(/claimed by.*force/);
    await expect(call("item_takeover", { ...takeover, explanation: "Continue" })).rejects.toThrow(/ms.*3600000 ms.*0\/3.*force/);
    for (const invalid of [true, false, "", " ", "x".repeat(501)]) {
      await expect(call(tool, { ...takeover, force: invalid })).rejects.toThrow();
    }
    // Force also works immediately after termination, while activity still appears current.
    const recovered = await call(tool, { ...takeover, force: ` ${force} ` });
    expect(recovered.claim.generation).toBe(2);
    expect(store.read().subsprints[0]!.items[0]!.claim.history[1]!.explanation).toBe(force);
    // A resumed original caller keeps its identity but cannot mutate the new owner's work.
    const restarted = make();
    const resumed = await restarted.sprint_resume!.handler({ git_dir: dir, ...caller("child") }) as any;
    expect(resumed.agent.id).toBe(owned.agent.id);
    await expect(restarted.item_progress!.handler({ id: "S01-001", message: "Stale write", ...caller("child") })).rejects.toThrow(/Claim/);
    await call("item_progress", { id: "S01-001", message: "Recovered", ...caller("parent") });
    const repeated = await call(tool, { ...takeover, force });
    expect(repeated.claim.generation).toBe(2);
  });

  it("isolates shared-connection callers, recovers after restart, and scopes mine without tokens", async () => {
    const { dir, store, make, advance } = fixture();
    let tools = make();
    const call = async (name: string, args = {}) => await tools[name]!.handler(args) as any;
    await call("info", { git_dir: dir, ...caller("parent") });
    const first = await call("sprint_new", { goal: "Native identity test", git_dir: dir, ...caller("parent") });
    await call("subsprint_new", { description: "Automatic attribution", goals: ["Isolate owners"], gates: [{ kind: "manual", spec: "Inspect" }], ...caller("parent") });
    await call("item_add", { subsprint: "S01", title: "Owned item", description: "One item to verify automatic identity ownership.", code_locations: ["src"], gates: [{ kind: "manual", spec: "Inspect" }], ...caller("parent") });
    await call("item_claim", { id: "S01-001", ...caller("child-a") });
    const other = await call("agent_heartbeat", caller("child-b"));
    expect(other.agent.id).not.toBe(first.agent.id);
    expect((await call("items_claimed", { mine: true, ...caller("child-b") })).total).toBe(0);
    const mine = await call("items_claimed", { mine: true, ...caller("child-a") });
    expect(mine.total).toBe(1);
    await expect(call("item_update", { id: "S01-001", title: "Wrong owner", ...caller("child-b") })).rejects.toThrow(/Claim/);
    tools = make();
    const resumed = await call("sprint_resume", { git_dir: dir, ...caller("child-a") });
    expect(resumed.agent.id).toBe(mine.items[0].owner_id);
    await call("item_update", { id: "S01-001", title: "Recovered owner", ...caller("child-a") });
    const listed = await call("agent_list", { limit: 1, ...caller("child-a") });
    expect(listed.total).toBe(3); expect(listed.next_offset).toBe(1);
    expect(JSON.stringify(listed)).not.toContain('"token"');
    advance(5 * 60000 + 1);
    const statuses = await call("agent_list", caller("child-a"));
    expect(statuses.agents.find((a: any) => a.id === other.agent.id).status).toBe("inactive");
    const path = join(store.dataDir, ".agent-sessions", store.sprintId!, tokenHash(JSON.stringify(["claude-session", "child-a"])) + ".json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(store.dataDir, store.sprintId! + ".jsonl"), "utf8")).not.toContain(resumed.agent.token);
    await call("agent_detach", caller("child-a"));
    expect((await call("items_claimed", caller("child-b"))).total).toBe(0);
    expect((await call("agent_heartbeat", caller("child-a"))).agent.id).not.toBe(resumed.agent.id);
  });

  it("keeps separate native sessions independent and separates successor sprints", async () => {
    const { dir, make } = fixture(); const tools = make();
    const call = async (n: string, args = {}) => await tools[n]!.handler(args) as any;
    const first = await call("sprint_new", { goal: "First sprint", git_dir: dir, ...caller("parent") });
    const other = await call("agent_heartbeat", { client_session_id: "other-session", client_agent_id: "parent" });
    expect(other.agent.id).not.toBe(first.agent.id);
    await call("sprint_archive", { reason: "Successor sprint", ...caller("parent") });
    const next = await call("sprint_new", { goal: "Next sprint", git_dir: dir, ...caller("parent") });
    expect(next.agent.id).not.toBe(first.agent.id);
    expect((await call("agent_list", caller("parent"))).total).toBe(1);
  });

  it("injects Claude native caller IDs without retaining model-supplied tokens", () => {
    const hook = resolve("clients/claude/hooks/sprinty-identity.cjs");
    const run = (event: unknown) => execFileSync(process.execPath, [hook], { input: JSON.stringify(event), encoding: "utf8" });
    const result = JSON.parse(run({ tool_name: "mcp__sprinty__item_claim", session_id: "s1", agent_id: "a2", tool_input: { id: "S01-001", agent_token: "copied" } }));
    expect(result.hookSpecificOutput.updatedInput).toEqual({ id: "S01-001", client_session_id: "s1", client_agent_id: "a2" });
    expect(JSON.parse(run({ tool_name: "mcp__plugin_sprinty_sprinty__info", session_id: "s1", tool_input: {} })).hookSpecificOutput.updatedInput.client_agent_id).toBe("main");
    expect(run({ tool_name: "mcp__other__tool", session_id: "s1" })).toBe("");
  });
});
