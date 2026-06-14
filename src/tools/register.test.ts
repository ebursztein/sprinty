import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SprintStore } from "../store/store.js";
import { buildToolHandlers, type ToolHandlers } from "./register.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-tools-"));
  const run = (a: string[]) => execFileSync("git", a, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]); run(["config", "user.email", "t@t.dev"]); run(["config", "user.name", "t"]);
  writeFileSync(join(dir, "f.txt"), "x"); run(["add", "f.txt"]); run(["commit", "-m", "init"]);
  return { dir, sha: run(["rev-parse", "HEAD"]) };
}

let dir: string, sha: string, tools: ToolHandlers;
beforeEach(() => {
  ({ dir, sha } = initRepo());
  tools = buildToolHandlers(new SprintStore(dir), async () => "http://127.0.0.1:0");
});

describe("tool handlers", () => {
  it("sprint_new returns goal and rejects bad input", async () => {
    const res = (await tools.sprint_new!.handler({ goal: "g" })) as { goal: string };
    expect(res.goal).toBe("g");
    await expect(tools.sprint_new!.handler({ goal: "" })).rejects.toThrow();
  });

  it("drives a full happy path through the handlers", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    const sub = (await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] })) as { id: string };
    expect(sub.id).toBe("S01");
    const item = (await tools.add!.handler({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] })) as { id: string };
    expect(item.id).toBe("S01-001");
    await tools.done!.handler({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }] });
    const closed = (await tools.sprint_close!.handler({})) as { status: string };
    expect(closed.status).toBe("closed");
  });

  it("search finds matching ledger entries", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    await tools.subsprint_new!.handler({ description: "serializer work", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    const matches = (await tools.search!.handler({ pattern: "serializer", context_lines: 0 })) as unknown[];
    expect(matches.length).toBe(1);
  });
});
