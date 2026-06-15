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

interface RootLike { uri: string; name?: string | undefined; }

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
export const SERVER_VERSION = packageJson.version;

const INSTRUCTIONS = `Sprinty enforces a disciplined sprint.
One sprint per repo/session (the .sprinty/current pointer keeps exactly one open). Call info() to orient before acting.
Build is item-driven: sprint_new(goal, context_notes?) -> dashboard() for the human -> subsprint_new(..., dependencies?)
-> add(description + code_locations + gates, dependencies?) -> done(commit + passing gates + changelog)
| split(promote to a subsprint) | deprecate(reason). Use dependencies(target, dependencies[]) to add graph edges later.
Each subsprint should be one feature. Use spike() for feature investigations; spikes reuse subsprint mechanics and require spike_conclude() or spike_deprecate().
Use artifact_add/list/amend/deprecate for durable outputs, and follow_up() with bug ids for bugs found while moving fast.
current() returns the sprint window, relevant/recent artifacts, recent activity, and a dependency graph with blocked_by, unblocks, topological_order, and cycles.
done() records a Git-backed file change map. changelog() renders Markdown with semver sections, coverage, and change-map tables.
Subsprints close automatically when their items are completed, split, or deprecated. sprint_close re-runs executable gates;
it refuses to close if anything is open, uncommitted, missing changelog, missing coverage, or failing a gate. IDs are minted by the server.
Use search(pattern, context_lines) to query the immutable record. dashboard() returns a live URL.`;

export async function main(): Promise<void> {
  let dashboard: Dashboard | undefined;
  let storePromise: Promise<SprintStore> | undefined;
  const server = new McpServer({ name: "sprinty", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const getStore = (): Promise<SprintStore> => {
    storePromise ??= resolveRepoDirWithRoots(() => server.server.listRoots()).then((dir) => new SprintStore(dir));
    return storePromise;
  };
  const openDashboard = async (): Promise<string> => {
    const store = await getStore();
    if (!dashboard) {
      dashboard = await startDashboard(() => {
        try { return store.read(); } catch { return null; }
      });
    }
    return dashboard.url;
  };

  const handlers = buildToolHandlers(getStore, openDashboard);

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
  const explicit = explicitRepoDir(args, env);
  const candidate = resolve(cwd, explicit ?? ".");
  if (!existsSync(candidate)) throw new Error(`Sprinty repo directory does not exist: ${candidate}`);
  if (!statSync(candidate).isDirectory()) throw new Error(`Sprinty repo directory is not a directory: ${candidate}`);
  const real = realpathSync(candidate);
  assertGitWorktree(real, explicit !== undefined);
  return real;
}

export async function resolveRepoDirWithRoots(
  listRoots: () => Promise<{ roots: RootLike[] }>,
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<string> {
  if (explicitRepoDir(args, env)) return resolveRepoDir(args, env, cwd);

  try {
    const fromRoot = firstGitRoot((await listRoots()).roots);
    if (fromRoot) return fromRoot;
  } catch {
    // Roots are optional in MCP clients. Fall back to cwd and produce the normal actionable error.
  }

  return resolveRepoDir(args, env, cwd);
}

function cliRepoDir(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--repo-dir") return args[i + 1];
    if (arg.startsWith("--repo-dir=")) return arg.slice("--repo-dir=".length);
  }
  return undefined;
}

function explicitRepoDir(args: string[], env: NodeJS.ProcessEnv): string | undefined {
  return cliRepoDir(args) ?? env.SPRINTY_REPO_DIR ?? env.SPRINTY_WORKTREE;
}

function firstGitRoot(roots: RootLike[]): string | undefined {
  for (const root of roots) {
    if (!root.uri.startsWith("file:")) continue;
    const dir = realpathSync(fileURLToPath(root.uri));
    if (isGitWorktree(dir)) return dir;
  }
  return undefined;
}

function assertGitWorktree(dir: string, explicit: boolean): void {
  if (!isGitWorktree(dir)) {
    const hint = explicit
      ? "Choose a git worktree for --repo-dir/SPRINTY_REPO_DIR."
      : "Set SPRINTY_REPO_DIR=/absolute/path/to/repo or pass --repo-dir /absolute/path/to/repo.";
    throw new Error(`Sprinty repo directory must be a git worktree: ${dir}. ${hint}`);
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
