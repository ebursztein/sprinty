import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { SprintStore } from "../store/store.js";
import { buildToolHandlers, type ToolHandlers } from "./register.js";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixtureDir = join(root, "tests/data/capsem-sprinty-baseline");
const gitDir = root;
const item = "S03-008";
const subsprint = "S03";
const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();

const publicTools = [
  "artifact_add", "artifact_get", "artifact_list", "artifact_update",
  "changelog", "dashboard_info", "dashboard_restart",
  "item_add", "item_deprecate", "item_done", "item_get", "item_split", "item_update",
  "next", "note_add", "note_get", "note_list", "note_update",
  "overview", "search",
  "sprint_archive", "sprint_close", "sprint_detach", "sprint_list", "sprint_new", "sprint_resume",
  "subsprint_get", "subsprint_list", "subsprint_new",
].sort();

function cloneFixture(): { root: string; dataDir: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), "sprinty-response-size-"));
  const dataDir = join(tempRoot, "data");
  cpSync(fixtureDir, dataDir, { recursive: true });
  return { root: tempRoot, dataDir };
}

function makeTools(dataDir: string): ToolHandlers {
  let store: SprintStore | undefined = new SprintStore(gitDir, dataDir);
  return buildToolHandlers(
    () => {
      if (!store) throw new Error("not bound");
      return store;
    },
    {
      open: async () => ({ running: true, url: "http://127.0.0.1:0", port: 0 }),
      restart: async () => ({ running: true, url: "http://127.0.0.1:0", port: 0 }),
      info: async () => ({ running: false }),
      close: async () => undefined,
    },
    ({ git_dir, data_dir }) => {
      store = new SprintStore(git_dir, data_dir);
      return store;
    },
    async () => { store = undefined; },
  );
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

async function withFixture<T>(run: (tools: ToolHandlers, dataDir: string) => Promise<T>): Promise<T> {
  const fixture = cloneFixture();
  try {
    return await run(makeTools(fixture.dataDir), fixture.dataDir);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function makeEmptyTools(rootDir: string): { tools: ToolHandlers; dataDir: string } {
  const dataDir = join(rootDir, "data");
  mkdirSync(dataDir, { recursive: true });
  return { tools: makeTools(dataDir), dataDir };
}

async function seedMiniSprint(tools: ToolHandlers, dataDir: string): Promise<void> {
  await tools.sprint_new!.handler({ goal: "Response stats sprint", git_dir: gitDir, data_dir: dataDir });
  await tools.subsprint_new!.handler({ description: "Response stats subsprint", goals: ["Measure response sizes"], gates: [{ kind: "command", spec: "true" }] });
  await tools.item_add!.handler({
    subsprint: "S01",
    title: "Response stats item",
    description: "Measure one representative response size.",
    code_locations: ["src/tools/register.ts"],
    gates: [{ kind: "command", spec: "true" }],
  });
}

function chars(value: unknown): number {
  return JSON.stringify(value, null, 2).length;
}

function collectEmptyFields(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectEmptyFields(entry, [...path, String(index)]));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = [...path, key];
    const empty = child === null || child === "" || (Array.isArray(child) && child.length === 0) ||
      (typeof child === "object" && child !== null && !Array.isArray(child) && Object.keys(child).length === 0);
    return [...(empty ? [childPath.join(".")] : []), ...collectEmptyFields(child, childPath)];
  });
}

function collectTimestampKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectTimestampKeys(entry, [...path, String(index)]));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = [...path, key];
    return [...(key === "ts" || key.endsWith("_at") ? [childPath.join(".")] : []), ...collectTimestampKeys(child, childPath)];
  });
}

function percentile(sorted: number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

async function measureP95(run: () => Promise<void>): Promise<{ avg: number; p95: number; max: number }> {
  const samples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    avg: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p95: percentile(samples, 0.95),
    max: samples[samples.length - 1]!,
  };
}

describe("public Sprinty tool responses", () => {
  it("exposes only the canonical subject_verb tool list", async () => {
    await withFixture(async (tools) => {
      expect(Object.keys(tools).sort()).toEqual(publicTools);
    });
  });

  it("gates every public tool with an explicit response size and time budget", async () => {
    type ToolCase = {
      tool: string;
      seed: "fixture" | "empty";
      maxChars: number;
      maxMs: number;
      args: (ctx: { tools: ToolHandlers; dataDir: string; rootDir: string }) => Promise<Record<string, unknown>> | Record<string, unknown>;
    };

    const cases: ToolCase[] = [
      { tool: "artifact_add", seed: "fixture", maxChars: 900, maxMs: 100, args: () => ({ title: "Response stats", path: "reports/response-stats.json", related_items: [item] }) },
      { tool: "artifact_get", seed: "fixture", maxChars: 1_000, maxMs: 25, args: async ({ tools }) => ({ id: ((await tools.artifact_add!.handler({ title: "Response stats", path: "reports/response-stats.json", related_items: [item] })) as { artifact: string }).artifact }) },
      { tool: "artifact_list", seed: "fixture", maxChars: 1_200, maxMs: 25, args: async ({ tools }) => { await tools.artifact_add!.handler({ title: "Response stats", path: "reports/response-stats.json", related_items: [item] }); return {}; } },
      { tool: "artifact_update", seed: "fixture", maxChars: 900, maxMs: 100, args: async ({ tools }) => ({ id: ((await tools.artifact_add!.handler({ title: "Response stats", path: "reports/response-stats.json", related_items: [item] })) as { artifact: string }).artifact, title: "Response stats v2" }) },
      { tool: "changelog", seed: "fixture", maxChars: 900, maxMs: 75, args: () => ({}) },
      { tool: "dashboard_info", seed: "fixture", maxChars: 900, maxMs: 25, args: () => ({}) },
      { tool: "dashboard_restart", seed: "fixture", maxChars: 900, maxMs: 25, args: () => ({}) },
      { tool: "item_add", seed: "fixture", maxChars: 900, maxMs: 100, args: () => ({ subsprint, title: "Response stats item", description: "Measure one representative response size.", code_locations: ["src/tools/register.ts"], gates: [{ kind: "command", spec: "true" }] }) },
      { tool: "item_deprecate", seed: "fixture", maxChars: 900, maxMs: 100, args: () => ({ id: item, reason: "Response stats baseline." }) },
      { tool: "item_done", seed: "empty", maxChars: 1_000, maxMs: 300, args: async ({ tools, dataDir }) => { await seedMiniSprint(tools, dataDir); return { id: "S01-001", commit_id: headCommit, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added response stats item." } }; } },
      { tool: "item_get", seed: "fixture", maxChars: 8_000, maxMs: 25, args: () => ({ id: item }) },
      { tool: "item_split", seed: "empty", maxChars: 900, maxMs: 100, args: async ({ tools, dataDir }) => { await seedMiniSprint(tools, dataDir); return { id: "S01-001", description: "Split response stats work", goals: ["Measure split response"], gates: [{ kind: "command", spec: "true" }] }; } },
      { tool: "item_update", seed: "fixture", maxChars: 900, maxMs: 100, args: () => ({ id: item, note: "Response stats update." }) },
      { tool: "next", seed: "fixture", maxChars: 5_000, maxMs: 25, args: () => ({}) },
      { tool: "note_add", seed: "fixture", maxChars: 900, maxMs: 100, args: () => ({ id: item, text: "Response stats note." }) },
      { tool: "note_get", seed: "fixture", maxChars: 900, maxMs: 25, args: async ({ tools }) => ({ id: ((await tools.note_add!.handler({ id: item, text: "Response stats note." })) as { note: string }).note }) },
      { tool: "note_list", seed: "fixture", maxChars: 2_000, maxMs: 25, args: () => ({ id: item }) },
      { tool: "note_update", seed: "fixture", maxChars: 900, maxMs: 100, args: async ({ tools }) => ({ id: ((await tools.note_add!.handler({ id: item, text: "Response stats note." })) as { note: string }).note, text: "Updated response stats note." }) },
      { tool: "overview", seed: "fixture", maxChars: 8_000, maxMs: 25, args: () => ({}) },
      { tool: "search", seed: "fixture", maxChars: 6_000, maxMs: 25, args: () => ({ pattern: "Finish|Provider|S03-008|AGY searchable|AGY artifact", context_size: 512 }) },
      { tool: "sprint_archive", seed: "fixture", maxChars: 900, maxMs: 100, args: () => ({ reason: "Response stats archive." }) },
      { tool: "sprint_close", seed: "empty", maxChars: 1_000, maxMs: 500, args: async ({ tools, dataDir, rootDir }) => { await seedMiniSprint(tools, dataDir); await tools.item_done!.handler({ id: "S01-001", commit_id: headCommit, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added response stats item." } }); return { coverage: { path: writeCoverage(rootDir), format: "lcov" } }; } },
      { tool: "sprint_detach", seed: "fixture", maxChars: 900, maxMs: 25, args: () => ({}) },
      { tool: "sprint_list", seed: "fixture", maxChars: 2_000, maxMs: 25, args: ({ dataDir }) => ({ data_dir: dataDir }) },
      { tool: "sprint_new", seed: "empty", maxChars: 2_500, maxMs: 300, args: ({ dataDir }) => ({ goal: "Response stats sprint", git_dir: gitDir, data_dir: dataDir }) },
      { tool: "sprint_resume", seed: "fixture", maxChars: 1_000, maxMs: 25, args: ({ dataDir }) => ({ git_dir: gitDir, data_dir: dataDir }) },
      { tool: "subsprint_get", seed: "fixture", maxChars: 7_500, maxMs: 25, args: () => ({ id: subsprint }) },
      { tool: "subsprint_list", seed: "fixture", maxChars: 6_000, maxMs: 25, args: () => ({}) },
      { tool: "subsprint_new", seed: "fixture", maxChars: 900, maxMs: 100, args: () => ({ description: "Response stats subsprint", goals: ["Measure response sizes"], gates: [{ kind: "command", spec: "true" }] }) },
    ];

    expect(cases.map((entry) => entry.tool).sort()).toEqual(publicTools);

    for (const entry of cases) {
      const tempRoot = mkdtempSync(join(tmpdir(), "sprinty-tool-gate-"));
      try {
        const { tools, dataDir } = entry.seed === "fixture"
          ? (() => {
              const dataDir = join(tempRoot, "data");
              cpSync(fixtureDir, dataDir, { recursive: true });
              return { tools: makeTools(dataDir), dataDir };
            })()
          : makeEmptyTools(tempRoot);
        const args = await entry.args({ tools, dataDir, rootDir: tempRoot });
        const start = performance.now();
        const result = await tools[entry.tool]!.handler(args);
        const elapsed = performance.now() - start;

        expect(chars(result), `${entry.tool} response too large`).toBeLessThanOrEqual(entry.maxChars);
        expect(elapsed, `${entry.tool} took ${elapsed.toFixed(2)}ms`).toBeLessThan(entry.maxMs);
        expect(result, `${entry.tool} missing help`).toHaveProperty("help");
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("keeps representative read responses compact, pruned, timestamp-free, and fast", async () => {
    const cases: Array<[string, Record<string, unknown>, number]> = [
      ["overview", {}, 8_000],
      ["next", {}, 5_000],
      ["subsprint_list", {}, 6_000],
      ["subsprint_get", { id: subsprint }, 7_500],
      ["item_get", { id: item }, 8_000],
      ["note_list", { id: item }, 2_000],
      ["search", { pattern: "Finish|Provider|S03-008|AGY searchable|AGY artifact", context_size: 512 }, 6_000],
      ["sprint_list", { data_dir: "$dataDir" }, 2_000],
    ];
    for (const [tool, rawArgs, maxChars] of cases) {
      await withFixture(async (tools, dataDir) => {
        const args = JSON.parse(JSON.stringify(rawArgs).replaceAll("$dataDir", dataDir));
        await tools[tool]!.handler(args);
        const start = performance.now();
        const result = await tools[tool]!.handler(args);
        const elapsed = performance.now() - start;
        expect(chars(result), `${tool} response too large`).toBeLessThanOrEqual(maxChars);
        expect(elapsed, `${tool} took ${elapsed.toFixed(2)}ms`).toBeLessThan(5);
        expect(collectTimestampKeys(result), `${tool} returned timestamp fields`).toEqual([]);
        expect(collectEmptyFields(result), `${tool} returned empty fields`).toEqual([]);
        expect(result, `${tool} missing help`).toHaveProperty("help");
      });
    }
  });

  it("keeps subsprint_get item rows compact and defers item detail to item_get", async () => {
    await withFixture(async (tools) => {
      const result = await tools.subsprint_get!.handler({ id: subsprint }) as {
        items: Array<{ id: string; description?: string; dependencies?: string[]; dependency_count?: number }>;
      };

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((item) => "description" in item)).toBe(false);
      expect(result.items.some((item) => "dependencies" in item)).toBe(false);
      expect(result.items.every((item) => typeof item.dependency_count === "number")).toBe(true);
    });
  });

  it("keeps next as a compact proposed task list without echoing detail surfaces", async () => {
    await withFixture(async (tools) => {
      const result = await tools.next!.handler({}) as {
        item?: { id: string };
        next?: Array<{ id: string; description?: string }>;
        current_subsprint?: { gates?: unknown[]; goals?: string[]; notes?: string[] };
        recent?: Array<{ id: string }>;
      };

      expect(result.next?.at(0)?.id).toBe(result.item?.id);
      expect(result.next?.some((row) => "description" in row)).toBe(false);
      expect(result.recent?.map((row) => row.id) ?? []).not.toContain(result.item?.id);
      expect(result.current_subsprint).not.toHaveProperty("gates");
      expect(result.current_subsprint).not.toHaveProperty("goals");
      expect(result.current_subsprint).not.toHaveProperty("notes");
    });
  });

  it("keeps steady-state read handlers under the 2ms p95 speed gate", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["overview", {}],
      ["next", {}],
      ["subsprint_list", {}],
      ["subsprint_get", { id: subsprint }],
      ["item_get", { id: item }],
      ["note_list", { id: item }],
      ["search", { pattern: "Finish|Provider|S03-008|AGY searchable|AGY artifact", context_size: 512 }],
      ["sprint_list", { data_dir: "$dataDir" }],
    ];
    await withFixture(async (tools, dataDir) => {
      for (const [tool, rawArgs] of cases) {
        const args = JSON.parse(JSON.stringify(rawArgs).replaceAll("$dataDir", dataDir));
        await tools[tool]!.handler(args);
        const batches = [
          await measureP95(async () => { await tools[tool]!.handler(args); }),
          await measureP95(async () => { await tools[tool]!.handler(args); }),
          await measureP95(async () => { await tools[tool]!.handler(args); }),
        ];
        const best = batches.reduce((fastest, batch) => batch.p95 < fastest.p95 ? batch : fastest);
        const detail = batches.map((batch, index) =>
          `batch${index + 1}: p95=${batch.p95.toFixed(3)}ms avg=${batch.avg.toFixed(3)}ms max=${batch.max.toFixed(3)}ms`
        ).join("; ");
        expect(best.p95, `${tool} speed gate needs one clean 50-sample batch under 2ms p95; ${detail}`).toBeLessThan(2);
      }
    });
  });

  it("keeps mutating acknowledgements compact and non-duplicative", async () => {
    const cases: Array<[string, Record<string, unknown>, number]> = [
      ["item_add", { subsprint, title: "Response stats item", description: "Measure one representative response size.", code_locations: ["src/tools/register.ts"], gates: [{ kind: "command", spec: "true" }] }, 900],
      ["item_update", { id: item, note: "Response stats update." }, 700],
      ["note_add", { id: item, text: "Response stats note." }, 800],
      ["item_deprecate", { id: item, reason: "Response stats baseline." }, 800],
      ["artifact_add", { title: "Response stats", path: "reports/response-stats.json", related_items: [item] }, 900],
      ["subsprint_new", { description: "Response stats subsprint", goals: ["Measure response sizes"], gates: [{ kind: "command", spec: "true" }] }, 900],
    ];
    for (const [tool, rawArgs, maxChars] of cases) {
      await withFixture(async (tools) => {
        const result = await tools[tool]!.handler(rawArgs);
        expect(chars(result), `${tool} response too large`).toBeLessThanOrEqual(maxChars);
        expect(JSON.stringify(result)).not.toContain('"sprint"');
        expect(result).toHaveProperty("help");
      });
    }
  });

  it("search returns sprint, subsprint, item, note, and artifact hits from the real fixture", async () => {
    await withFixture(async (tools) => {
      await tools.artifact_add!.handler({ title: "AGY artifact fixture", path: "reports/agy.json", related_items: [item] });
      const note = await tools.note_add!.handler({ id: item, text: "AGY searchable note fixture" }) as { note: string };
      const result = await tools.search!.handler({ pattern: "Finish|Provider|S03-008|AGY searchable|AGY artifact", context_size: 512 }) as { matches: Array<{ id: string; type: string; text: string; tool_call: string }> };
      const types = new Set(result.matches.map((match) => match.type));
      expect(types.has("sprint")).toBe(true);
      expect(types.has("subsprint")).toBe(true);
      expect(types.has("item")).toBe(true);
      expect(types.has("note")).toBe(true);
      expect(types.has("artifact")).toBe(true);
      expect(result.matches.every((match) => match.text.length <= 520)).toBe(true);
      expect(result.matches.find((match) => match.id === note.note)?.tool_call).toBe(`note_get({ id: "${note.note}" })`);
    });
  });

  it("search accepts regex patterns", async () => {
    await withFixture(async (tools) => {
      await tools.note_add!.handler({ id: item, text: "Regex power note: AGY and Gemini both appear here." });
      const result = await tools.search!.handler({ pattern: "AGY|Gemini", context_size: 256 }) as { matches: Array<{ text: string; tool_call: string }> };
      expect(result.matches.length).toBeGreaterThan(1);
      expect(result.matches.some((match) => /AGY|Gemini/.test(match.text))).toBe(true);
      expect(result.matches.every((match) => match.tool_call.includes("_get") || match.tool_call === "overview()")).toBe(true);
    });
  });

  it("lists are compact and tell agents which get tool returns full detail", async () => {
    await withFixture(async (tools) => {
      await tools.artifact_add!.handler({ title: "Response stats", path: "reports/response-stats.json", related_items: [item] });
      const notes = await tools.note_list!.handler({ id: item }) as { info: string };
      const artifacts = await tools.artifact_list!.handler({}) as { info: string };
      const subsprints = await tools.subsprint_list!.handler({}) as { info: string };
      expect(notes.info).toContain("note_get");
      expect(artifacts.info).toContain("artifact_get");
      expect(subsprints.info).toContain("subsprint_get");
    });
  });

  it("overview summarizes subsprints without embedding item rows and keeps compact notes/artifacts", async () => {
    await withFixture(async (tools) => {
      await tools.note_add!.handler({ id: item, text: "Overview should expose compact note rows." });
      await tools.artifact_add!.handler({ title: "Overview artifact", path: "reports/overview.json", related_items: [item] });
      const overview = await tools.overview!.handler({}) as {
        info: string;
        subsprints: Array<{ id: string; items?: unknown; item_counts: { open: number; closed: number; blocked: number } }>;
        notes: Array<{ id: string; item: string; text: string }>;
        artifacts: Array<{ id: string; title: string; path: string; related_items?: string[] }>;
      };
      expect(overview.info).toContain("subsprint_get");
      expect(overview.info).toContain("note_get");
      expect(overview.info).toContain("artifact_get");
      expect(overview.subsprints.every((sub) => sub.items === undefined)).toBe(true);
      expect(overview.subsprints.every((sub) => typeof sub.item_counts.open === "number")).toBe(true);
      expect(overview.notes.some((note) => note.item === item && note.text.includes("compact note"))).toBe(true);
      expect(overview.artifacts.some((artifact) => artifact.title === "Overview artifact")).toBe(true);
    });
  });
});
