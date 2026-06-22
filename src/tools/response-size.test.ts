import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { SprintStore } from "../store/store.js";
import { buildToolHandlers, type ToolHandlers } from "./register.js";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixtureDir = join(root, "tests/data/capsem-sprinty-baseline");
const gitDir = root;
const item = "S02-003";
const subsprint = "S02";

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

async function withFixture<T>(run: (tools: ToolHandlers, dataDir: string) => Promise<T>): Promise<T> {
  const fixture = cloneFixture();
  try {
    return await run(makeTools(fixture.dataDir), fixture.dataDir);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
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

  it("keeps representative read responses compact, pruned, timestamp-free, and fast", async () => {
    const cases: Array<[string, Record<string, unknown>, number]> = [
      ["overview", {}, 8_000],
      ["next", {}, 12_000],
      ["subsprint_list", {}, 6_000],
      ["subsprint_get", { id: subsprint }, 20_000],
      ["item_get", { id: item }, 8_000],
      ["note_list", { id: item }, 2_000],
      ["search", { pattern: "Finish|Provider|S02-003|AGY searchable|AGY artifact", context_size: 512 }, 12_000],
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

  it("keeps steady-state read handlers under the 2ms p95 speed gate", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["overview", {}],
      ["next", {}],
      ["subsprint_list", {}],
      ["subsprint_get", { id: subsprint }],
      ["item_get", { id: item }],
      ["note_list", { id: item }],
      ["search", { pattern: "Finish|Provider|S02-003|AGY searchable|AGY artifact", context_size: 512 }],
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
      const result = await tools.search!.handler({ pattern: "Finish|Provider|S02-003|AGY searchable|AGY artifact", context_size: 512 }) as { matches: Array<{ id: string; type: string; text: string; tool_call: string }> };
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
