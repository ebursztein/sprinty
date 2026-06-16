#!/usr/bin/env node
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SprintStore } from "../dist/store/store.js";
import { buildToolHandlers } from "../dist/tools/register.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gitDir = process.env.SPRINTY_STATS_GIT_DIR ?? repoRoot;
const dataDir = process.env.SPRINTY_STATS_DATA_DIR ?? join(repoRoot, "tests/data/capsem-sprinty-baseline");
const commitId = process.env.SPRINTY_STATS_COMMIT ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: gitDir, encoding: "utf8" }).trim();

const item = "S02-003";
const subsprint = "S02";
const itemGateResults = [
  {
    kind: "test",
    spec: "uv run pytest tests/test_mock_server_launcher.py::test_mock_server_replays_recorded_agy_code_assist_experiments tests/test_mock_server_launcher.py::test_mock_server_replays_recorded_agy_available_models tests/test_mock_server_launcher.py::test_mock_server_replays_recorded_agy_code_assist_setup tests/test_mock_server_launcher.py::test_mock_server_replays_agy_playlog_empty_ack -q",
    cwd: "/Users/elie/.codex/worktrees/5ce6/capsem",
    passed: true,
    evidence: "response-size baseline only; gate text mirrors the fixture item and is not executed",
  },
  {
    kind: "test",
    spec: "uv run pytest tests/ironbank/test_model_client_ledger_contract.py -q -m 'not live_provider' -k 'gemini or agy or unknown_provider' -s --tb=short",
    cwd: "/Users/elie/.codex/worktrees/5ce6/capsem",
    passed: true,
    evidence: "response-size baseline only; gate text mirrors the fixture item and is not executed",
  },
];

const samples = [
  ["sprint_list", { mode: "readonly", args: { data_dir: dataDir } }],
  ["sprint_resume", { mode: "copy", args: { git_dir: gitDir, data_dir: "$dataDir" } }],
  ["sprint_detach", { mode: "copy", pre: [["sprint_resume", { git_dir: gitDir, data_dir: "$dataDir" }]], args: {} }],
  ["sprint_new", { mode: "fresh", args: { goal: "Response stats fresh sprint", git_dir: gitDir, data_dir: "$dataDir", context_notes: ["measuring response size"] } }],
  ["sprint_close", { mode: "fresh", pre: [["sprint_new", { goal: "Response stats close sprint", git_dir: gitDir, data_dir: "$dataDir" }]], args: {} }],
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
  ["item_add", { mode: "copy", args: { subsprint, title: "Response stats item", description: "Measure one representative response size for item_add.", code_locations: ["scripts/response-stats.mjs"], gates: [{ kind: "command", spec: "true" }] } }],
  ["item_update", { mode: "copy", args: { id: item, note: "Response stats update attached to the current Capsem item." } }],
  ["item_done", { mode: "copy", args: { id: item, commit_id: commitId, gate_results: itemGateResults, changelog: { verb: "changed", line: "Changed response stats baseline item." } } }],
  ["item_split", { mode: "copy", args: { id: item, description: "Response stats split subsprint", goals: ["Measure split response"], gates: [{ kind: "command", spec: "true" }] } }],
  ["item_deprecate", { mode: "copy", args: { id: item, reason: "Response stats baseline." } }],
  ["note_add", { mode: "copy", args: { id: item, text: "Response stats note attached to a concrete item." } }],
  ["note_get", { mode: "copy", pre: [["note_add", { id: item, text: "Response stats note attached to a concrete item." }]], args: { id: "$lastId" } }],
  ["note_list", { mode: "copy", pre: [["note_add", { id: item, text: "Response stats note attached to a concrete item." }]], args: { id: item } }],
  ["note_update", { mode: "copy", pre: [["note_add", { id: item, text: "Response stats note attached to a concrete item." }]], args: { id: "$lastId", text: "Response stats note updated." } }],
  ["artifact_add", { mode: "copy", args: { title: "Response stats", path: "memory://response-stats", description: "Response stats baseline artifact.", related_items: [item] } }],
  ["artifact_get", { mode: "copy", pre: [["artifact_add", { title: "Response stats", path: "memory://response-stats", related_items: [item] }]], args: { id: "$lastId" } }],
  ["artifact_list", { mode: "copy", pre: [["artifact_add", { title: "Response stats", path: "memory://response-stats", related_items: [item] }]], args: {} }],
  ["artifact_update", { mode: "copy", pre: [["artifact_add", { title: "Response stats", path: "memory://response-stats", related_items: [item] }]], args: { id: "$lastId", title: "Response stats amended" } }],
  ["search", { mode: "copy", args: { pattern: "S02-003|AGY", context_size: 512 } }],
  ["changelog", { mode: "copy", args: {} }],
  ["dashboard", { mode: "copy", args: {} }],
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
    async () => "http://127.0.0.1:0",
    bind,
    async () => undefined,
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
  return value;
}

async function callTool(tools, name, args, context) {
  try {
    const result = await tools[name].handler(materialize(args, context));
    context.lastId = result?.note ?? result?.item ?? result?.subsprint ?? result?.artifact ?? result?.follow_up ?? context.lastId;
    return { ok: true, text: JSON.stringify(result, null, 2) };
  } catch (err) {
    const blockers = err?.blockers ?? [];
    const message = err?.message ?? String(err);
    return { ok: false, text: blockers.length > 0 ? `${message}\n- ${blockers.join("\n- ")}` : message };
  }
}

async function measure(name, config) {
  if (config.mode === "unsafe") {
    const text = `UNSAFE_SAMPLE_NOT_RUN: ${config.reason}`;
    return { tool: name, ok: false, chars: text.length, approx_tokens: Math.ceil(text.length / 4), preview: text };
  }
  const holder = config.mode === "fresh" ? freshDataDir() : config.mode === "copy" ? cloneDataDir() : { root: null, dataDir };
  const context = { dataDir: holder.dataDir, lastId: null };
  const tools = makeTools(config.mode === "readonly" ? null : holder.dataDir);
  try {
    for (const [preName, preArgs] of config.pre ?? []) await callTool(tools, preName, preArgs, context);
    const response = await callTool(tools, name, config.args, context);
    const chars = response.text.length;
    return {
      tool: name,
      ok: response.ok,
      chars,
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
console.log("| tool | ok | chars | approx_tokens | preview |");
console.log("|---|---:|---:|---:|---|");
for (const row of rows) {
  console.log(`| ${row.tool} | ${row.ok ? "yes" : "no"} | ${row.chars} | ${row.approx_tokens} | ${row.preview.replaceAll("|", "\\|")} |`);
}
