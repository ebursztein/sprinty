import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveRepoDir, resolveRepoDirWithRoots } from "./server.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-e2e-"));
  const run = (a: string[]) => execFileSync("git", a, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]); run(["config", "user.email", "t@t.dev"]); run(["config", "user.name", "t"]); run(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "f.txt"), "x"); run(["add", "f.txt"]); run(["commit", "-m", "init"]);
  return { dir, sha: run(["rev-parse", "HEAD"]) };
}

function writeCoverage(dir: string): string {
  mkdirSync(join(dir, "coverage"), { recursive: true });
  const path = join(dir, "coverage", "lcov.info");
  writeFileSync(path, [
    "TN:",
    "SF:src/server.ts",
    "LF:20",
    "LH:18",
    "BRF:8",
    "BRH:6",
    "FNF:5",
    "FNH:5",
    "end_of_record",
    "",
  ].join("\n"));
  return path;
}

const entry = join(process.cwd(), "dist/index.js");

function connect(dir: string, options: { cwd?: string; env?: Record<string, string> } = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [entry],
    cwd: options.cwd ?? dir,
    env: { ...process.env, ...options.env },
  });
  const client = new Client({ name: "test", version: "0" });
  return client.connect(transport).then(() => client);
}

function connectWithRoot(dir: string, rootDir: string, options: { cwd?: string; env?: Record<string, string> } = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [entry],
    cwd: options.cwd ?? dir,
    env: { ...process.env, ...options.env },
  });
  const client = new Client({ name: "test", version: "0" }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(rootDir).href, name: "test repo" }],
  }));
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
  it("lists all 25 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add", "artifact", "artifact_add", "artifact_amend", "artifact_deprecate", "artifact_list",
        "changelog", "current", "dashboard", "dependencies", "deprecate", "done", "follow_up",
        "info", "note", "search", "spike", "spike_conclude", "spike_deprecate", "split",
        "sprint_archive", "sprint_close", "sprint_new", "subsprint_new", "update",
      ],
    );
  });

  it("runs a full sprint and closes it", async () => {
    await call(client, "sprint_new", { goal: "ship it" });
    await call(client, "subsprint_new", { description: "core", goals: ["build core"], gates: [{ kind: "command", spec: "true" }] });
    await call(client, "add", { subsprint: "S01", description: "do thing", code_locations: ["src/x.ts"], gates: [{ kind: "command", spec: "true" }] });
    await call(client, "done", { item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } });
    const closed = await call(client, "sprint_close", { coverage: { path: writeCoverage(dir), format: "lcov", command: "npm run test:coverage" } });
    expect(closed.json.status).toBe("closed");
  });

  it("uses SPRINTY_REPO_DIR instead of the server launch cwd", async () => {
    const fresh = initRepo();
    const repoDir = realpathSync(fresh.dir);
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    const c = await connect(fresh.dir, { cwd: launchDir, env: { SPRINTY_REPO_DIR: fresh.dir } });
    try {
      const created = await call(c, "sprint_new", { goal: "bind to the real repo" });
      expect(created.json.dir).toBe(repoDir);
      expect(created.json.worktree).toBe(repoDir);
      expect(created.json.branch).toBe("main");
      await call(c, "subsprint_new", { description: "core", goals: ["build core"], gates: [{ kind: "command", spec: "true" }] });
      await call(c, "add", { subsprint: "S01", description: "do thing", code_locations: ["src/x.ts"], gates: [{ kind: "command", spec: "true" }] });
      const done = await call(c, "done", {
        item: "S01-001",
        commit_id: fresh.sha,
        gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
        changelog: { verb: "fixed", line: "Fixed repo directory binding." },
      });
      expect(done.isError).toBe(false);
      expect(done.json.subsprints[0].items[0].commit_id).toBe(fresh.sha);
    } finally {
      await c.close();
    }
  });

  it("uses MCP roots when launched outside the workspace without explicit repo env", async () => {
    const fresh = initRepo();
    const repoDir = realpathSync(fresh.dir);
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    const c = await connectWithRoot(fresh.dir, fresh.dir, { cwd: launchDir });
    try {
      const created = await call(c, "sprint_new", { goal: "bind through roots" });
      expect(created.json.dir).toBe(repoDir);
      expect(created.json.worktree).toBe(repoDir);
      expect(created.json.branch).toBe("main");
      await call(c, "subsprint_new", { description: "core", goals: ["build core"], gates: [{ kind: "command", spec: "true" }] });
      await call(c, "add", { subsprint: "S01", description: "do thing", code_locations: ["src/x.ts"], gates: [{ kind: "command", spec: "true" }] });
      const done = await call(c, "done", {
        item: "S01-001",
        commit_id: fresh.sha,
        gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
        changelog: { verb: "fixed", line: "Fixed roots directory binding." },
      });
      expect(done.json.subsprints[0].items[0].commit_id).toBe(fresh.sha);
    } finally {
      await c.close();
    }
  });

  it("resolves repository directories from MCP roots before falling back to cwd", async () => {
    const fresh = initRepo();
    const repoDir = realpathSync(fresh.dir);
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    await expect(resolveRepoDirWithRoots(async () => ({ roots: [{ uri: pathToFileURL(fresh.dir).href }] }), [], {}, launchDir)).resolves.toBe(repoDir);
  });

  it("rejects a non-git launch cwd instead of silently binding to a temp directory", () => {
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    expect(() => resolveRepoDir([], {}, launchDir)).toThrow(/Set SPRINTY_REPO_DIR=.*--repo-dir/);
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

  it("rejects invalid dependency edges and cycles over MCP", async () => {
    const fresh = initRepo();
    const c = await connect(fresh.dir);
    try {
      await call(c, "sprint_new", { goal: "dependency teeth" });
      await call(c, "subsprint_new", { description: "graph", goals: ["track graph"], gates: [{ kind: "command", spec: "true" }] });
      await call(c, "add", { subsprint: "S01", description: "base", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
      await call(c, "add", { subsprint: "S01", description: "dependent", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "true" }], dependencies: ["S01-001"] });

      const unknownTarget = await call(c, "dependencies", { target: "S99-001", dependencies: ["S01-001"] });
      expect(unknownTarget.isError).toBe(true);
      expect(unknownTarget.text).toContain("Unknown dependency target");

      const unknownDependency = await call(c, "dependencies", { target: "S01-002", dependencies: ["S99-001"] });
      expect(unknownDependency.isError).toBe(true);
      expect(unknownDependency.text).toContain("Unknown dependency");

      const selfEdge = await call(c, "dependencies", { target: "S01-002", dependencies: ["S01-002"] });
      expect(selfEdge.isError).toBe(true);
      expect(selfEdge.text).toContain("cannot depend on itself");

      const duplicateEdge = await call(c, "dependencies", { target: "S01-002", dependencies: ["S01-001"] });
      expect(duplicateEdge.isError).toBe(true);
      expect(duplicateEdge.text).toContain("already exists");

      const cycle = await call(c, "dependencies", { target: "S01-001", dependencies: ["S01-002"] });
      expect(cycle.isError).toBe(true);
      expect(cycle.text).toMatch(/cycle/i);

      const current = await call(c, "current", {});
      expect(current.json.graph.edges).toEqual([{ from: "S01-002", to: "S01-001" }]);
      expect(current.json.graph.cycles).toEqual([]);
      expect(current.json.graph.topological_order.indexOf("S01-001")).toBeLessThan(current.json.graph.topological_order.indexOf("S01-002"));
    } finally {
      await c.close();
    }
  });

  it("runs a bookshop sprint across notes, updates, splits, search, dashboard, and close", async () => {
    const fresh = initRepo();
    const c = await connect(fresh.dir);
    try {
      const created = await call(c, "sprint_new", { goal: "Build a neighborhood bookshop catalog", context_notes: ["Owner wants a cozy neighborhood workflow."] });
      expect(created.json.goal).toBe("Build a neighborhood bookshop catalog");
      expect(created.json.context_notes).toEqual(["Owner wants a cozy neighborhood workflow."]);
      expect(created.json.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const sub = await call(c, "subsprint_new", {
        description: "Catalog discovery",
        goals: ["Let shoppers find books by title and author"],
        gates: [{ kind: "command", spec: "true" }],
        dependencies: [],
      });
      expect(sub.json.id).toBe("S01");

      const added = await call(c, "add", {
        subsprint: "S01",
        description: "Shape the first catalog slice for staff-curated inventory",
        code_locations: ["src/bookshop/catalog.ts"],
        gates: [
          { kind: "command", spec: "true" },
          { kind: "manual", spec: "bookshop owner accepts catalog direction" },
        ],
        dependencies: [],
      });
      expect(added.json.id).toBe("S01-001");

      const updated = await call(c, "update", { target: "S01-001", note: "Needs title, author, and shelf availability." });
      expect(updated.json.subsprints[0].items[0].updates).toContain("Needs title, author, and shelf availability.");

      const noted = await call(c, "note", { element: "S01", text: "Owner wants cozy neighborhood language, not marketplace language." });
      expect(noted.json.subsprints[0].notes).toContain("Owner wants cozy neighborhood language, not marketplace language.");

      const split = await call(c, "split", {
        item: "S01-001",
        description: "Bookshop catalog workflow",
        goals: ["Search books", "Track shelf availability", "Drop preorder scope"],
        gates: [{ kind: "command", spec: "true" }],
        dependencies: ["S01"],
      });
      expect(split.json.subsprints[0].items[0].disposition).toBe("split");
      expect(split.json.subsprints[0].items[0].spawned_subsprint).toBe("S02");
      expect(split.json.subsprints[1].spawned_from_item).toBe("S01-001");

      await call(c, "note", { element: "S02", text: "Second pass owns the concrete catalog workflow." });

      const searchItem = await call(c, "add", {
        subsprint: "S02",
        description: "Add searchable book listing for staff-curated inventory",
        code_locations: ["src/bookshop/catalog.ts", "src/bookshop/search.ts"],
        gates: [
          { kind: "command", spec: "true" },
          { kind: "manual", spec: "bookshop owner accepts catalog workflow" },
        ],
        dependencies: ["S01-001"],
      });
      expect(searchItem.json.id).toBe("S02-001");

      const preorderItem = await call(c, "add", {
        subsprint: "S02",
        description: "Sketch preorder notifications for out-of-stock paperbacks",
        code_locations: ["src/bookshop/preorders.ts"],
        gates: [{ kind: "manual", spec: "owner confirms preorder scope" }],
        dependencies: ["S02-001"],
      });
      expect(preorderItem.json.id).toBe("S02-002");

      const current = await call(c, "current", { past: 1, future: 3 });
      expect(current.json.next.map((i: { id: string }) => i.id)).toEqual(["S02-001", "S02-002"]);
      expect(current.json.graph.edges).toContainEqual({ from: "S02-001", to: "S01-001" });
      expect(current.json.graph.edges).toContainEqual({ from: "S02-002", to: "S02-001" });
      expect(current.json.graph.topological_order.indexOf("S02-001")).toBeLessThan(current.json.graph.topological_order.indexOf("S02-002"));
      expect(current.json.graph.cycles).toEqual([]);

      await call(c, "dependencies", { target: "S02-002", dependencies: ["S02"] });

      const done = await call(c, "done", {
        item: "S02-001",
        commit_id: fresh.sha,
        gate_results: [
          { kind: "command", spec: "true", passed: true, evidence: "catalog tests passed" },
          { kind: "manual", spec: "bookshop owner accepts catalog workflow", passed: true, evidence: "owner reviewed search flow" },
        ],
        changelog: { verb: "added", line: "Added searchable book listing for staff-curated inventory." },
      });
      const item = done.json.subsprints[1].items[0];
      expect(item.commit_id).toBe(fresh.sha);
      expect(item.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(item.gate_results).toHaveLength(2);
      expect(item.changelog).toEqual({ verb: "added", line: "Added searchable book listing for staff-curated inventory." });
      expect(item.change_map.by_file.length).toBeGreaterThan(0);

      const deprecated = await call(c, "deprecate", {
        item: "S02-002",
        reason: "Preorders are outside the first bookshop catalog sprint.",
      });
      expect(deprecated.json.subsprints[1].items[1].disposition).toBe("deprecated");
      expect(deprecated.json.subsprints[1].items[1].reason).toContain("outside the first bookshop catalog sprint");

      const matches = await call(c, "search", { pattern: "bookshop|preorder", context_lines: 1 });
      expect(matches.json.length).toBeGreaterThanOrEqual(2);

      const dashboard = await call(c, "dashboard", {});
      expect(dashboard.json.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const state = await (await fetch(`${dashboard.json.url}/state`)).json();
      expect(state.goal).toBe("Build a neighborhood bookshop catalog");
      expect(state.subsprints.map((s: { id: string }) => s.id)).toEqual(["S01", "S02"]);
      expect(state.graph.edges).toContainEqual({ from: "S02-002", to: "S02" });
      expect(state.timeline.map((e: { type: string }) => e.type)).toContain("item_resolved");
      expect(state.timeline.map((e: { type: string }) => e.type)).toContain("note_added");
      expect(state.subsprints[1].items[0].commit_id).toBe(fresh.sha);
      expect(state.subsprints[1].items[1].disposition).toBe("deprecated");

      const changelog = await call(c, "changelog", {});
      expect(changelog.json.markdown).toContain("# Changelog: Build a neighborhood bookshop catalog");
      expect(changelog.json.markdown).toContain("| File | Language | Directory | Items | Commits | + | - | Net | Churn |");
      expect(changelog.json.markdown).toContain("## Added");

      const closedMissingCoverage = await call(c, "sprint_close", {});
      expect(closedMissingCoverage.isError).toBe(true);
      expect(closedMissingCoverage.text).toContain("Coverage evidence is required");

      const closed = await call(c, "sprint_close", { coverage: { path: writeCoverage(fresh.dir), format: "lcov", command: "npm run test:coverage" } });
      expect(closed.json.status).toBe("closed");
      expect(closed.json.coverage.lines.percent).toBe(90);
      expect(closed.json.closed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await c.close();
    }
  });
});
