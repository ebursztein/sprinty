import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SprintStore } from "./store/store.js";
import { buildToolHandlers } from "./tools/register.js";
import { startDashboard, type Dashboard } from "./dashboard/server.js";

const INSTRUCTIONS = `Sprinty enforces a disciplined sprint.
One sprint per repo/session (the .sprinty/current pointer keeps exactly one open). Call info() to orient before acting.
Build is item-driven: subsprint_new -> add (description + code_locations + gates, all required)
-> done (commit + passing gates) | split (promote to a subsprint) | deprecate (with reason).
Subsprints close automatically when their items resolve. sprint_close re-runs every gate; it refuses
to close if anything is unresolved, uncommitted, or a gate fails. IDs are minted by the server.
Use search(pattern, context_lines) to query the immutable record. dashboard() returns a live URL.`;

export async function main(): Promise<void> {
  const store = new SprintStore(process.cwd());
  let dashboard: Dashboard | undefined;
  const openDashboard = async (): Promise<string> => {
    if (!dashboard) {
      dashboard = await startDashboard(() => {
        try { return store.read(); } catch { return null; }
      });
    }
    return dashboard.url;
  };

  const server = new McpServer({ name: "sprinty", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const handlers = buildToolHandlers(store, openDashboard);

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
