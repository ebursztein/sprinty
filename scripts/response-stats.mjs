#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { SprintStore } from "../dist/store/store.js";
import { buildToolHandlers } from "../dist/tools/register.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gitDir = process.env.SPRINTY_STATS_GIT_DIR ?? repoRoot;
const dataDir = process.env.SPRINTY_STATS_DATA_DIR ?? join(repoRoot, "tests/data/capsem-sprinty-baseline");
const commitId = process.env.SPRINTY_STATS_COMMIT ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: gitDir, encoding: "utf8" }).trim();

const item = "S03-008";
const subsprint = "S03";
const openSubsprint = "S03";
const miniGate = { kind: "command", spec: "true" };
const seedMiniSprint = [
  ["sprint_new", { goal: "Response stats sprint", git_dir: gitDir, data_dir: "$dataDir" }],
  ["subsprint_new", { description: "Response stats subsprint", goals: ["Measure response sizes"], gates: [miniGate] }],
  ["item_add", { subsprint: "S01", title: "Response stats item", description: "Measure one representative response size.", code_locations: ["scripts/response-stats.mjs"], gates: [miniGate] }],
];

const samples = [
  ["sprint_list", { mode: "readonly", args: { data_dir: dataDir } }],
  ["sprint_resume", { mode: "copy", args: { git_dir: gitDir, data_dir: "$dataDir" } }],
  ["sprint_detach", { mode: "copy", pre: [["sprint_resume", { git_dir: gitDir, data_dir: "$dataDir" }]], args: {} }],
  ["sprint_new", { mode: "fresh", args: { goal: "Response stats fresh sprint", git_dir: gitDir, data_dir: "$dataDir", context_notes: ["measuring response size"] } }],
  ["sprint_close", { mode: "fresh", pre: [...seedMiniSprint, ["item_done", { id: "S01-001", commit_id: commitId, gate_results: [{ ...miniGate, passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added response stats item." } }]], args: { coverage: { path: "$coveragePath", format: "lcov" } } }],
  ["sprint_archive", { mode: "copy", args: { reason: "response-size baseline only" } }],
  ["overview", { mode: "copy", pre: [
    ["note_add", { id: item, text: "Response stats note visible in overview." }],
    ["artifact_add", { title: "Response stats overview artifact", path: "memory://response-stats-overview", related_items: [item] }],
  ], args: {} }],
  ["next", { mode: "copy", args: { past: 1, future: 3 } }],
  ["subsprint_list", { mode: "copy", args: {} }],
  ["subsprint_get", { mode: "copy", args: { id: subsprint } }],
  ["subsprint_new", { mode: "copy", args: { description: "Response stats subsprint", goals: ["Measure response sizes"], gates: [{ kind: "command", spec: "true" }] } }],
  ["item_get", { mode: "copy", args: { id: item } }],
  ["item_add", { mode: "copy", args: { subsprint: openSubsprint, title: "Response stats item", description: "Measure one representative response size for item_add.", code_locations: ["scripts/response-stats.mjs"], gates: [miniGate] } }],
  ["item_update", { mode: "copy", args: { id: item, note: "Response stats update attached to the current Capsem item." } }],
  ["item_done", { mode: "fresh", pre: seedMiniSprint, args: { id: "S01-001", commit_id: commitId, gate_results: [{ ...miniGate, passed: true, evidence: "ok" }], changelog: { verb: "changed", line: "Changed response stats baseline item." } } }],
  ["item_split", { mode: "fresh", pre: seedMiniSprint, args: { id: "S01-001", description: "Response stats split subsprint", goals: ["Measure split response"], gates: [miniGate] } }],
  ["item_deprecate", { mode: "fresh", pre: seedMiniSprint, args: { id: "S01-001", reason: "Response stats baseline." } }],
  ["note_add", { mode: "copy", args: { id: item, text: "Response stats note attached to a concrete item." } }],
  ["note_get", { mode: "copy", pre: [["note_add", { id: item, text: "Response stats note attached to a concrete item." }]], args: { id: "$lastId" } }],
  ["note_list", { mode: "copy", pre: [["note_add", { id: item, text: "Response stats note attached to a concrete item." }]], args: { id: item } }],
  ["note_update", { mode: "copy", pre: [["note_add", { id: item, text: "Response stats note attached to a concrete item." }]], args: { id: "$lastId", text: "Response stats note updated." } }],
  ["artifact_add", { mode: "copy", args: { title: "Response stats", path: "memory://response-stats", description: "Response stats baseline artifact.", related_items: [item] } }],
  ["artifact_get", { mode: "copy", pre: [["artifact_add", { title: "Response stats", path: "memory://response-stats", related_items: [item] }]], args: { id: "$lastId" } }],
  ["artifact_list", { mode: "copy", pre: [["artifact_add", { title: "Response stats", path: "memory://response-stats", related_items: [item] }]], args: {} }],
  ["artifact_update", { mode: "copy", pre: [["artifact_add", { title: "Response stats", path: "memory://response-stats", related_items: [item] }]], args: { id: "$lastId", title: "Response stats amended" } }],
  ["search", { mode: "copy", args: { pattern: "S03-008|AGY", context_size: 512 } }],
  ["changelog", { mode: "copy", args: {} }],
  ["dashboard_info", { mode: "copy", args: {} }],
  ["dashboard_restart", { mode: "copy", args: {} }],
];

function cloneDataDir() {
  const root = mkdtempSync(join(tmpdir(), "sprinty-response-stats-"));
  const cloned = join(root, "data");
  cpSync(dataDir, cloned, { recursive: true });
  return { root, dataDir: cloned };
}

function freshDataDir() {
  const root = mkdtempSync(join(tmpdir(), "sprinty-response-stats-"));
  return { root, dataDir: join(root, "data") };
}

function writeCoverage(dir) {
  const coverageDir = join(dir, "coverage");
  mkdirSync(coverageDir, { recursive: true });
  const path = join(coverageDir, "lcov.info");
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

function makeTools(sampleDataDir) {
  let store;
  const bind = ({ git_dir, data_dir }) => {
    store = new SprintStore(git_dir, data_dir);
    return store;
  };
  store = sampleDataDir ? new SprintStore(gitDir, sampleDataDir) : undefined;
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
    bind,
    async () => { store = undefined; },
  );
}

function materialize(value, context) {
  if (Array.isArray(value)) return value.map((entry) => materialize(entry, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, materialize(entry, context)]));
  }
  if (value === "$dataDir") return context.dataDir;
  if (value === "$lastId") return context.lastId;
  if (value === "$coveragePath") return context.coveragePath;
  return value;
}

async function callTool(tools, name, args, context) {
  try {
    const start = performance.now();
    const result = await tools[name].handler(materialize(args, context));
    const ms = performance.now() - start;
    context.lastId = result?.note ?? result?.item ?? result?.subsprint ?? result?.artifact ?? result?.follow_up ?? context.lastId;
    return { ok: true, text: JSON.stringify(result, null, 2), ms };
  } catch (err) {
    const ms = 0;
    const blockers = err?.blockers ?? [];
    const message = err?.message ?? String(err);
    return { ok: false, text: blockers.length > 0 ? `${message}\n- ${blockers.join("\n- ")}` : message, ms };
  }
}

async function measure(name, config) {
  if (config.mode === "unsafe") {
    const text = `UNSAFE_SAMPLE_NOT_RUN: ${config.reason}`;
    return { tool: name, ok: false, chars: text.length, approx_tokens: Math.ceil(text.length / 4), preview: text };
  }
  const holder = config.mode === "fresh" ? freshDataDir() : config.mode === "copy" ? cloneDataDir() : { root: null, dataDir };
  const context = { dataDir: holder.dataDir, lastId: null, coveragePath: holder.root ? writeCoverage(holder.root) : null };
  const tools = makeTools(config.mode === "readonly" ? null : holder.dataDir);
  try {
    for (const [preName, preArgs] of config.pre ?? []) await callTool(tools, preName, preArgs, context);
    const response = await callTool(tools, name, config.args, context);
    const chars = response.text.length;
    return {
      tool: name,
      ok: response.ok,
      chars,
      ms: response.ms,
      approx_tokens: Math.ceil(chars / 4),
      preview: response.text.replace(/\s+/g, " ").slice(0, 120),
    };
  } finally {
    if (holder.root) rmSync(holder.root, { recursive: true, force: true });
  }
}

const rows = [];
for (const [name, config] of samples) rows.push(await measure(name, config));
rows.sort((a, b) => b.chars - a.chars || a.tool.localeCompare(b.tool));

const totalChars = rows.reduce((sum, row) => sum + row.chars, 0);
console.log(`# Sprinty Response Size Stats`);
console.log(`baseline_git_dir: ${gitDir}`);
console.log(`baseline_data_dir: ${dataDir}`);
console.log(`baseline_commit: ${commitId}`);
console.log(`tools_measured: ${rows.length}`);
console.log(`total_chars: ${totalChars}`);
console.log(`total_approx_tokens: ${Math.ceil(totalChars / 4)}`);
console.log("");
console.log("| tool | ok | chars | approx_tokens | ms | preview |");
console.log("|---|---:|---:|---:|---:|---|");
for (const row of rows) {
  console.log(`| ${row.tool} | ${row.ok ? "yes" : "no"} | ${row.chars} | ${row.approx_tokens} | ${row.ms.toFixed(3)} | ${row.preview.replaceAll("|", "\\|")} |`);
}
