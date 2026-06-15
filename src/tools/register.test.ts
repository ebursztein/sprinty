import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SprintStore } from "../store/store.js";
import { buildToolHandlers, type ToolHandlers } from "./register.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-tools-"));
  const run = (a: string[]) => execFileSync("git", a, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]); run(["config", "user.email", "t@t.dev"]); run(["config", "user.name", "t"]); run(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "f.txt"), "x"); run(["add", "f.txt"]); run(["commit", "-m", "init"]);
  return { dir, sha: run(["rev-parse", "HEAD"]) };
}

function writeCoverage(dir: string): string {
  mkdirSync(join(dir, "coverage"), { recursive: true });
  const path = join(dir, "coverage", "lcov.info");
  writeFileSync(path, "TN:\nSF:a.ts\nLF:1\nLH:1\nBRF:0\nBRH:0\nFNF:1\nFNH:1\nend_of_record\n");
  return path;
}

let dir: string, sha: string, tools: ToolHandlers;
beforeEach(() => {
  ({ dir, sha } = initRepo());
  tools = buildToolHandlers(new SprintStore(dir), async () => "http://127.0.0.1:0");
});

describe("tool handlers", () => {
  it("sprint_new returns goal and rejects bad input", async () => {
    const res = (await tools.sprint_new!.handler({ goal: "g", context_notes: ["human can watch dashboard"] })) as { goal: string; context_notes: string[] };
    expect(res.goal).toBe("g");
    expect(res.context_notes).toEqual(["human can watch dashboard"]);
    await expect(tools.sprint_new!.handler({ goal: "" })).rejects.toThrow();
  });

  it("drives a full happy path through the handlers", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    const sub = (await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] })) as { id: string };
    expect(sub.id).toBe("S01");
    const item = (await tools.add!.handler({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] })) as { id: string };
    expect(item.id).toBe("S01-001");
    await tools.done!.handler({
      item: "S01-001",
      commit_id: sha,
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      changelog: { verb: "added", line: "added the first tracked item" },
    });
    const closed = (await tools.sprint_close!.handler({ coverage: { path: writeCoverage(dir), format: "lcov" } })) as { status: string };
    expect(closed.status).toBe("closed");
  });

  it("renders changelog markdown through the handler", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    await tools.done!.handler({
      item: "S01-001",
      commit_id: sha,
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      changelog: { verb: "fixed", line: "fixed initial file" },
    });
    const md = (await tools.changelog!.handler({})) as { markdown: string };
    expect(md.markdown).toContain("# Changelog: g");
    expect(md.markdown).toContain("## Fixed");
    expect(md.markdown).toContain("| f.txt | Text | . | S01-001 |");
  });

  it("records dependency edges through the dependencies verb", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler({ subsprint: "S01", description: "first", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler({ subsprint: "S01", description: "second", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "true" }] });
    const res = (await tools.dependencies!.handler({ target: "S01-002", dependencies: ["S01-001"] })) as { graph: { edges: Array<{ from: string; to: string }> } };
    expect(res.graph.edges).toContainEqual({ from: "S01-002", to: "S01-001" });
  });

  it("records artifacts through the artifact verb and exposes them through current", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const artifact = (await tools.artifact!.handler({
      target: "S01-001",
      kind: "spec",
      title: "Dashboard design",
      uri: "docs/superpowers/specs/dashboard.md",
      description: "Approved dashboard design",
    })) as { id: string; view: { artifacts: Array<{ id: string; title: string }>; subsprints: Array<{ items: Array<{ artifacts: Array<{ id: string }> }> }> } };
    expect(artifact.id).toBe("A001");
    expect(artifact.view.artifacts[0]!.title).toBe("Dashboard design");
    expect(artifact.view.subsprints[0]!.items[0]!.artifacts.map((a) => a.id)).toEqual(["A001"]);
    const current = (await tools.current!.handler({})) as { artifacts: Array<{ id: string; uri: string }> };
    expect(current.artifacts).toEqual([{ id: "A001", target_id: "S01-001", kind: "spec", title: "Dashboard design", uri: "docs/superpowers/specs/dashboard.md", description: "Approved dashboard design", created_at: expect.any(String) }]);
  });

  it("archives a sprint through the archive verb", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const archived = (await tools.sprint_archive!.handler({ reason: "alpha recovery after bad ledger state" })) as { status: string };
    expect(archived.status).toBe("archived");
  });

  it("search finds matching ledger entries", async () => {
    await tools.sprint_new!.handler({ goal: "g" });
    await tools.subsprint_new!.handler({ description: "serializer work", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    const matches = (await tools.search!.handler({ pattern: "serializer", context_lines: 0 })) as unknown[];
    expect(matches.length).toBe(1);
  });
});
