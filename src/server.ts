import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { SprintStore } from "./store/store.js";
import { buildToolHandlers } from "./tools/register.js";
import { startDashboard, type Dashboard } from "./dashboard/server.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
export const SERVER_VERSION = packageJson.version;

const INSTRUCTIONS = `Sprinty enforces a disciplined sprint.
One sprint per explicit git/data binding. sprint_new requires git_dir and data_dir so Sprinty never guesses from the MCP process cwd.
Use a worktree-scoped, uncommitted data_dir, such as <git_dir>/.sprinty when it is gitignored; avoid shared temp dirs and committed sprint state.
The data_dir/current pointer keeps exactly one open sprint for that binding. After an MCP restart, call sprint_resume(git_dir, data_dir) to reattach to an existing sprint without creating a new one. Use sprint_list(data_dir) to inspect existing ledgers and sprint_detach() to clear the process binding.
Call overview() after binding for compact sprint shape, or next() for the active work window.
Build is item-driven: sprint_new(goal, git_dir, data_dir, context_notes?) -> dashboard() for the human -> subsprint_new(..., dependencies?)
-> item_add(title + description + code_locations + gates, dependencies?) -> item_done(commit + passing gates + changelog)
| item_split(promote to a subsprint) | item_deprecate(reason). Use item_update(id, dependencies[]) to add graph edges later.
Each subsprint should be one feature. Notes attach only to item ids: use note_add(id, text), note_list(id), note_get(id), and note_update(id, text).
Use artifact_add/list/get/update for durable file outputs attached to the sprint, optionally related to item ids.
next() returns a compact work window, blocked item ids/titles, scoped relations, artifacts, and recent activity. It deliberately omits the full dependency graph.
item_done() records a Git-backed file change map in the ledger; compact tool responses omit change maps. changelog() renders Markdown with semver sections, coverage, and change-map tables.
Subsprints close automatically when their items are completed, split, or deprecated. sprint_close re-runs executable gates;
it refuses to close if anything is open, uncommitted, missing changelog, missing coverage, or failing a gate. IDs are minted by the server.
Use search(pattern, context_size) to query the immutable record with bounded character context and focused tool_call hints. dashboard() returns a live URL.`;

export async function main(): Promise<void> {
  let dashboard: Dashboard | undefined;
  let store: SprintStore | undefined;
  const server = new McpServer({ name: "sprinty", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const getStore = (): SprintStore => {
    store ??= storeFromStartupBinding(process.argv.slice(2), process.env, process.cwd());
    if (!store) {
      throw new Error("Sprinty is not bound. Call sprint_new with explicit git_dir and data_dir, or start the MCP server with SPRINTY_GIT_DIR and SPRINTY_DATA_DIR.");
    }
    return store;
  };
  const bindStore = (binding: { git_dir: string; data_dir: string }): SprintStore => {
    const next = storeFromBinding(binding.git_dir, binding.data_dir, process.cwd());
    if (store && (store.dir !== next.dir || store.dataDir !== next.dataDir)) {
      throw new Error(`Sprinty MCP server is already bound to git_dir=${store.dir} data_dir=${store.dataDir}. Start a fresh MCP session for git_dir=${next.dir} data_dir=${next.dataDir}.`);
    }
    store = next;
    return store;
  };
  const detachStore = (): void => {
    store = undefined;
  };
  const openDashboard = async (): Promise<string> => {
    const store = getStore();
    if (!dashboard) {
      dashboard = await startDashboard(() => {
        try { return store.read(); } catch { return null; }
      });
    }
    return dashboard.url;
  };
  const closeDashboard = async (): Promise<void> => {
    if (!dashboard) return;
    const running = dashboard;
    dashboard = undefined;
    await running.stop();
  };

  const handlers = buildToolHandlers(getStore, openDashboard, bindStore, closeDashboard, detachStore);

  for (const [name, d] of Object.entries(handlers)) {
    server.registerTool(
      name,
      { description: d.description, inputSchema: d.schema.shape },
      async (args: unknown) => {
        try {
          const result = await d.handler(args);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          const blockers = (err as { blockers?: string[] }).blockers ?? [];
          const message = (err as Error).message;
          const text = blockers.length > 0 ? `${message}\n- ${blockers.join("\n- ")}` : message;
          return { isError: true, content: [{ type: "text" as const, text }] };
        }
      },
    );
  }

  // Skills surfaced as resources for any MCP client.
  const here = dirname(fileURLToPath(import.meta.url));
  for (const skill of ["how-to-run-a-sprint", "using-sprinty"]) {
    const uri = `sprinty://skills/${skill}`;
    server.registerResource(skill, uri, { mimeType: "text/markdown" }, async () => ({
      contents: [{ uri, text: readFileSync(join(here, "..", "skills", skill, "SKILL.md"), "utf8") }],
    }));
  }

  await server.connect(new StdioServerTransport());
}

export function resolveRepoDir(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const explicit = explicitGitDir(args, env);
  if (!explicit) throw new Error("Sprinty git_dir is required. Pass git_dir to sprint_new, or set SPRINTY_GIT_DIR/--git-dir.");
  const candidate = resolve(cwd, explicit);
  if (!existsSync(candidate)) throw new Error(`Sprinty repo directory does not exist: ${candidate}`);
  if (!statSync(candidate).isDirectory()) throw new Error(`Sprinty repo directory is not a directory: ${candidate}`);
  const real = realpathSync(candidate);
  assertGitWorktree(real);
  return real;
}

export function resolveBinding(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): { gitDir: string; dataDir: string } | null {
  const git = explicitGitDir(args, env);
  const data = explicitDataDir(args, env);
  if (!git && !data) return null;
  if (!git || !data) throw new Error("Sprinty requires both git_dir and data_dir. Set SPRINTY_GIT_DIR and SPRINTY_DATA_DIR, or pass both --git-dir and --data-dir.");
  return { gitDir: resolveGitDir(git, cwd), dataDir: resolveDataDir(data, cwd) };
}

function cliValue(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === name) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function explicitGitDir(args: string[], env: NodeJS.ProcessEnv): string | undefined {
  return cliValue(args, "--git-dir") ?? cliValue(args, "--repo-dir") ?? env.SPRINTY_GIT_DIR ?? env.SPRINTY_REPO_DIR ?? env.SPRINTY_WORKTREE;
}

function explicitDataDir(args: string[], env: NodeJS.ProcessEnv): string | undefined {
  return cliValue(args, "--data-dir") ?? env.SPRINTY_DATA_DIR;
}

function storeFromStartupBinding(args: string[], env: NodeJS.ProcessEnv, cwd: string): SprintStore | undefined {
  const binding = resolveBinding(args, env, cwd);
  return binding ? new SprintStore(binding.gitDir, binding.dataDir) : undefined;
}

function storeFromBinding(gitDir: string, dataDir: string, cwd: string): SprintStore {
  return new SprintStore(resolveGitDir(gitDir, cwd), resolveDataDir(dataDir, cwd));
}

function resolveGitDir(input: string, cwd: string): string {
  const candidate = resolve(cwd, input);
  if (!existsSync(candidate)) throw new Error(`Sprinty git_dir does not exist: ${candidate}`);
  if (!statSync(candidate).isDirectory()) throw new Error(`Sprinty git_dir is not a directory: ${candidate}`);
  const real = realpathSync(candidate);
  assertGitWorktree(real);
  return real;
}

function resolveDataDir(input: string, cwd: string): string {
  const candidate = resolve(cwd, input);
  if (existsSync(candidate) && !statSync(candidate).isDirectory()) throw new Error(`Sprinty data_dir is not a directory: ${candidate}`);
  return existsSync(candidate) ? realpathSync(candidate) : candidate;
}

function assertGitWorktree(dir: string): void {
  if (!isGitWorktree(dir)) {
    throw new Error(`Sprinty git_dir must be a git worktree: ${dir}. Pass the real repository/worktree path explicitly as git_dir.`);
  }
}

function isGitWorktree(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
