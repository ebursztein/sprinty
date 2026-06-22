import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveBinding, resolveRepoDir, SERVER_VERSION } from "./server.js";

const publicTools = [
  "artifact_add", "artifact_get", "artifact_list", "artifact_update",
  "changelog", "dashboard_info", "dashboard_restart",
  "item_add", "item_deprecate", "item_done", "item_get", "item_split", "item_update",
  "next", "note_add", "note_get", "note_list", "note_update",
  "overview", "search",
  "sprint_archive", "sprint_close", "sprint_detach", "sprint_list", "sprint_new", "sprint_resume",
  "subsprint_get", "subsprint_list", "subsprint_new",
].sort();

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-e2e-"));
  const run = (a: string[]) => execFileSync("git", a, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  run(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "f.txt"), "x");
  run(["add", "f.txt"]);
  run(["commit", "-m", "init"]);
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

function sprintInput(repoDir: string, input: { goal: string; context_notes?: string[] }, dataDir = join(repoDir, ".sprinty")) {
  return { ...input, git_dir: repoDir, data_dir: dataDir };
}

function addInput(input: { subsprint?: string; title?: string; description?: string; code_locations?: string[]; gates?: Array<{ kind: string; spec: string }>; dependencies?: string[] } = {}) {
  return {
    subsprint: input.subsprint ?? "S01",
    title: input.title ?? "Do thing",
    description: input.description ?? "Implement one small independently verifiable thing.",
    code_locations: input.code_locations ?? ["src/x.ts"],
    gates: input.gates ?? [{ kind: "command", spec: "true" }],
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
  };
}

let client: Client;
let dir: string;
let sha: string;

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
  it("advertises the package version from package metadata", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it("lists only the canonical subject_verb tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(publicTools);
  });

  it("runs a full sprint and closes it with canonical handlers", async () => {
    await call(client, "sprint_new", sprintInput(dir, { goal: "ship it" }));
    await call(client, "subsprint_new", { description: "core", goals: ["build core"], gates: [{ kind: "command", spec: "true" }] });
    await call(client, "item_add", addInput());
    await call(client, "item_done", { id: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } });
    const closed = await call(client, "sprint_close", { coverage: { path: writeCoverage(dir), format: "lcov", command: "npm run test:coverage" } });
    expect(closed.json.status).toBe("closed");
  });

  it("uses explicit sprint_new git_dir and data_dir instead of the server launch cwd", async () => {
    const fresh = initRepo();
    const repoDir = realpathSync(fresh.dir);
    const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "sprinty-data-")));
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    const c = await connect(fresh.dir, { cwd: launchDir });
    try {
      const created = await call(c, "sprint_new", sprintInput(fresh.dir, { goal: "bind to the real repo" }, dataDir));
      expect(created.json.dir).toBe(repoDir);
      expect(created.json.worktree).toBe(repoDir);
      expect(created.json.data_dir).toBe(dataDir);
      expect(created.json.branch).toBe("main");
      expect(created.json.dashboard.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await call(c, "subsprint_new", { description: "core", goals: ["build core"], gates: [{ kind: "command", spec: "true" }] });
      await call(c, "item_add", addInput());
      const done = await call(c, "item_done", {
        id: "S01-001",
        commit_id: fresh.sha,
        gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
        changelog: { verb: "fixed", line: "Fixed repo directory binding." },
      });
      expect(done.isError).toBe(false);
      const item = await call(c, "item_get", { id: "S01-001" });
      expect(item.json.commit_id).toBe(fresh.sha);
    } finally {
      await c.close();
    }
  });

  it("uses startup env binding and sprint_resume for existing ledgers", async () => {
    const fresh = initRepo();
    const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "sprinty-data-")));
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    const seeded = await connect(fresh.dir, { cwd: launchDir });
    await call(seeded, "sprint_new", sprintInput(fresh.dir, { goal: "bind through env" }, dataDir));
    await seeded.close();

    const envBound = await connect(fresh.dir, { cwd: launchDir, env: { SPRINTY_GIT_DIR: fresh.dir, SPRINTY_DATA_DIR: dataDir } });
    try {
      const overview = await call(envBound, "overview", {});
      expect(overview.json.title).toBe("bind through env");
    } finally {
      await envBound.close();
    }

    const unbound = await connect(fresh.dir, { cwd: launchDir });
    try {
      const before = await call(unbound, "overview", {});
      expect(before.isError).toBe(true);
      expect(before.text).toContain("Sprinty is not bound");
      const listed = await call(unbound, "sprint_list", { data_dir: dataDir });
      expect(listed.json.sprints).toEqual([
        expect.objectContaining({ id: "001", title: "bind through env", status: "active" }),
      ]);
      const resumed = await call(unbound, "sprint_resume", { git_dir: fresh.dir, data_dir: dataDir });
      expect(resumed.json).toMatchObject({ ok: true, action: "sprint_resume", dashboard: { running: true } });
      expect(resumed.json.dashboard.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const after = await call(unbound, "overview", {});
      expect(after.json.title).toBe("bind through env");
    } finally {
      await unbound.close();
    }
  });

  it("uses sprint_detach to clear a binding before resuming another sprint", async () => {
    const first = initRepo();
    const second = initRepo();
    const firstData = realpathSync(mkdtempSync(join(tmpdir(), "sprinty-data-")));
    const secondData = realpathSync(mkdtempSync(join(tmpdir(), "sprinty-data-")));
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    const c = await connect(first.dir, { cwd: launchDir });
    try {
      await call(c, "sprint_new", sprintInput(first.dir, { goal: "first sprint" }, firstData));
      const detached = await call(c, "sprint_detach", {});
      expect(detached.json.detached).toBe(true);
      const unbound = await call(c, "overview", {});
      expect(unbound.isError).toBe(true);

      const seeded = await connect(second.dir, { cwd: launchDir });
      await call(seeded, "sprint_new", sprintInput(second.dir, { goal: "second sprint" }, secondData));
      await seeded.close();

      await call(c, "sprint_resume", { git_dir: second.dir, data_dir: secondData });
      const overview = await call(c, "overview", {});
      expect(overview.json.title).toBe("second sprint");
    } finally {
      await c.close();
    }
  });

  it("requires complete explicit startup binding when startup paths are provided", () => {
    const fresh = initRepo();
    const repoDir = realpathSync(fresh.dir);
    const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "sprinty-data-")));
    expect(resolveBinding([], { SPRINTY_GIT_DIR: fresh.dir, SPRINTY_DATA_DIR: dataDir }, "/")).toEqual({ gitDir: repoDir, dataDir });
    expect(() => resolveBinding([], { SPRINTY_GIT_DIR: fresh.dir }, "/")).toThrow(/both git_dir and data_dir/);
  });

  it("rejects missing or non-git explicit git_dir instead of silently binding to a temp directory", () => {
    const launchDir = mkdtempSync(join(tmpdir(), "sprinty-launch-"));
    expect(() => resolveRepoDir([], {}, launchDir)).toThrow(/git_dir is required/);
    expect(() => resolveRepoDir([], { SPRINTY_GIT_DIR: launchDir }, "/")).toThrow(/must be a git worktree/);
  });

  it("rejects invalid dependency edges and cycles over MCP", async () => {
    const fresh = initRepo();
    const c = await connect(fresh.dir);
    try {
      await call(c, "sprint_new", sprintInput(fresh.dir, { goal: "dependency teeth" }));
      await call(c, "subsprint_new", { description: "graph", goals: ["track graph"], gates: [{ kind: "command", spec: "true" }] });
      await call(c, "item_add", addInput({ title: "Base item", description: "Implement the base dependency graph item.", code_locations: ["a.ts"] }));
      await call(c, "item_add", addInput({ title: "Dependent item", description: "Implement the dependent dependency graph item.", code_locations: ["b.ts"], dependencies: ["S01-001"] }));

      const unknownTarget = await call(c, "item_update", { id: "S99-001", dependencies: ["S01-001"] });
      expect(unknownTarget.isError).toBe(true);
      expect(unknownTarget.text).toContain("Unknown dependency target");

      const unknownDependency = await call(c, "item_update", { id: "S01-002", dependencies: ["S99-001"] });
      expect(unknownDependency.isError).toBe(true);
      expect(unknownDependency.text).toContain("Unknown dependency");

      const selfEdge = await call(c, "item_update", { id: "S01-002", dependencies: ["S01-002"] });
      expect(selfEdge.isError).toBe(true);
      expect(selfEdge.text).toContain("cannot depend on itself");

      const duplicateEdge = await call(c, "item_update", { id: "S01-002", dependencies: ["S01-001", "S01-001"] });
      expect(duplicateEdge.isError).toBe(true);
      expect(duplicateEdge.text).toContain("Duplicate dependencies");

      const cycle = await call(c, "item_update", { id: "S01-001", dependencies: ["S01-002"] });
      expect(cycle.isError).toBe(true);
      expect(cycle.text).toMatch(/cycle/i);

      const item = await call(c, "item_get", { id: "S01-002" });
      expect(item.json.dependencies).toEqual(["S01-001"]);
    } finally {
      await c.close();
    }
  });

  it("runs a bookshop sprint across notes, artifacts, splits, search, dashboard, and close", async () => {
    const fresh = initRepo();
    const c = await connect(fresh.dir);
    try {
      const created = await call(c, "sprint_new", sprintInput(fresh.dir, { goal: "Build a neighborhood bookshop catalog", context_notes: ["Owner wants a cozy neighborhood workflow."] }));
      expect(created.json.goal).toBe("Build a neighborhood bookshop catalog");
      expect(created.json.dashboard.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(created.json.dashboard.port).toBeGreaterThan(0);
      const dashboardUrl = created.json.dashboard.url as string;

      await call(c, "subsprint_new", {
        description: "Catalog discovery",
        goals: ["Let shoppers find books by title and author"],
        gates: [{ kind: "command", spec: "true" }],
      });

      const added = await call(c, "item_add", {
        subsprint: "S01",
        title: "Shape catalog slice",
        description: "Shape the first catalog slice for staff-curated inventory",
        code_locations: ["src/bookshop/catalog.ts"],
        gates: [
          { kind: "command", spec: "true" },
          { kind: "manual", spec: "bookshop owner accepts catalog direction" },
        ],
      });
      expect(added.json.item).toBe("S01-001");

      await call(c, "item_update", { id: "S01-001", note: "Needs title, author, and shelf availability." });
      const note = await call(c, "note_add", { id: "S01-001", text: "Owner wants cozy neighborhood language, not marketplace language." });
      expect(note.json.note).toMatch(/^N\d{3}$/);

      const split = await call(c, "item_split", {
        id: "S01-001",
        description: "Bookshop catalog workflow",
        goals: ["Search books", "Track shelf availability", "Drop preorder scope"],
        gates: [{ kind: "command", spec: "true" }],
        dependencies: ["S01"],
      });
      expect(split.json.subsprint).toBe("S02");

      await call(c, "item_add", {
        subsprint: "S02",
        title: "Search book listing",
        description: "Add searchable book listing for staff-curated inventory",
        code_locations: ["src/bookshop/catalog.ts", "src/bookshop/search.ts"],
        gates: [
          { kind: "command", spec: "true" },
          { kind: "manual", spec: "bookshop owner accepts catalog workflow" },
        ],
        dependencies: ["S01-001"],
      });
      await call(c, "item_add", {
        subsprint: "S02",
        title: "Sketch preorders",
        description: "Sketch preorder notifications for out-of-stock paperbacks",
        code_locations: ["src/bookshop/preorders.ts"],
        gates: [{ kind: "manual", spec: "owner confirms preorder scope" }],
        dependencies: ["S02-001"],
      });

      const next = await call(c, "next", { past: 1, future: 3 });
      expect(next.json.item.id).toBe("S02-001");
      expect(next.json.next.map((i: { id: string }) => i.id)).toEqual(["S02-001"]);
      expect(next.json.blocked.items).toEqual([{ id: "S02-002", title: "Sketch preorders" }]);
      expect(next.json.graph).toBeUndefined();

      await call(c, "artifact_add", {
        title: "Bookshop catalog fixture",
        path: "reports/bookshop-catalog.json",
        description: "Fixture generated while testing bookshop search.",
        related_items: ["S02-001"],
      });
      const artifacts = await call(c, "artifact_list", {});
      expect(artifacts.json.artifacts[0]).toEqual({ id: "A001", title: "Bookshop catalog fixture", path: "reports/bookshop-catalog.json", related_items: ["S02-001"] });
      const artifact = await call(c, "artifact_get", { id: "A001" });
      expect(artifact.json.artifact.description).toContain("Fixture generated");

      const done = await call(c, "item_done", {
        id: "S02-001",
        commit_id: fresh.sha,
        gate_results: [
          { kind: "command", spec: "true", passed: true, evidence: "catalog tests passed" },
          { kind: "manual", spec: "bookshop owner accepts catalog workflow", passed: true, evidence: "owner reviewed search flow" },
        ],
        changelog: { verb: "added", line: "Added searchable book listing for staff-curated inventory." },
      });
      expect(done.json.status).toBe("completed");

      await call(c, "item_deprecate", {
        id: "S02-002",
        reason: "Preorders are outside the first bookshop catalog sprint.",
      });

      const matches = await call(c, "search", { pattern: "bookshop|preorder", context_size: 512 });
      expect(matches.json.matches.length).toBeGreaterThanOrEqual(2);
      expect(matches.json.matches[0]).toHaveProperty("tool_call");

      const dashboard = await call(c, "dashboard_info", {});
      expect(dashboard.json).toMatchObject({ running: true, url: dashboardUrl });
      const state = await (await fetch(`${dashboardUrl}/state`)).json();
      expect(state.goal).toBe("Build a neighborhood bookshop catalog");
      expect(state.subsprints.map((s: { id: string }) => s.id)).toEqual(["S01", "S02"]);
      expect(state.timeline.map((e: { type: string }) => e.type)).toContain("note_added");

      const changelog = await call(c, "changelog", {});
      expect(changelog.json.markdown).toContain("# Changelog: Build a neighborhood bookshop catalog");
      expect(changelog.json.markdown).toContain("## Added");

      const closedMissingCoverage = await call(c, "sprint_close", {});
      expect(closedMissingCoverage.isError).toBe(true);
      expect(closedMissingCoverage.text).toContain("Coverage evidence is required");
      const stillRunning = await (await fetch(`${dashboardUrl}/state`)).json();
      expect(stillRunning.goal).toBe("Build a neighborhood bookshop catalog");

      const closed = await call(c, "sprint_close", { coverage: { path: writeCoverage(fresh.dir), format: "lcov", command: "npm run test:coverage" } });
      expect(closed.json.status).toBe("closed");
      await expect(fetch(`${dashboardUrl}/state`)).rejects.toThrow();
    } finally {
      await c.close();
    }
  });
});
