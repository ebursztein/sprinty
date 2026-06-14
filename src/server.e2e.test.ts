import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-e2e-"));
  const run = (a: string[]) => execFileSync("git", a, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]); run(["config", "user.email", "t@t.dev"]); run(["config", "user.name", "t"]);
  writeFileSync(join(dir, "f.txt"), "x"); run(["add", "f.txt"]); run(["commit", "-m", "init"]);
  return { dir, sha: run(["rev-parse", "HEAD"]) };
}

const entry = join(process.cwd(), "dist/index.js");

function connect(dir: string): Promise<Client> {
  const transport = new StdioClientTransport({ command: "node", args: [entry], cwd: dir });
  const client = new Client({ name: "test", version: "0" });
  return client.connect(transport).then(() => client);
}

let client: Client, dir: string, sha: string;

beforeAll(async () => {
  ({ dir, sha } = initRepo());
  client = await connect(dir);
});
afterAll(async () => { await client.close(); });

async function call(c: Client, name: string, args: Record<string, unknown>) {
  const res = await c.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  const text = content.find((x) => x.type === "text")!.text;
  return { isError: res.isError === true, json: res.isError ? null : JSON.parse(text), text };
}

describe("sprinty e2e over MCP", () => {
  it("lists all 13 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["add", "current", "dashboard", "deprecate", "done", "info", "note", "search", "split", "sprint_close", "sprint_new", "subsprint_new", "update"],
    );
  });

  it("runs a full sprint and closes it", async () => {
    await call(client, "sprint_new", { goal: "ship it" });
    await call(client, "subsprint_new", { description: "core", goals: ["build core"], gates: [{ kind: "command", spec: "true" }] });
    await call(client, "add", { subsprint: "S01", description: "do thing", code_locations: ["src/x.ts"], gates: [{ kind: "command", spec: "true" }] });
    await call(client, "done", { item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }] });
    const closed = await call(client, "sprint_close", {});
    expect(closed.json.status).toBe("closed");
  });

  it("rejects close when an item is unresolved (teeth)", async () => {
    const fresh = initRepo();
    const c = await connect(fresh.dir);
    await call(c, "sprint_new", { goal: "g" });
    await call(c, "subsprint_new", { description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await call(c, "add", { subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const res = await call(c, "sprint_close", {});
    expect(res.isError).toBe(true);
    expect(res.text).toContain("S01-001");
    await c.close();
  });
});
