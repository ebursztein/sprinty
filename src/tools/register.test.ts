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

let dir: string, sha: string, tools: ToolHandlers, dashboardCloseCalls: number;
function sprintInput(goal: string, context_notes?: string[]) {
  return { goal, git_dir: dir, data_dir: join(dir, ".sprinty"), ...(context_notes ? { context_notes } : {}) };
}

function addInput(input: { subsprint?: string; title?: string; description?: string; code_locations?: string[]; gates?: Array<{ kind: string; spec: string }>; dependencies?: string[] } = {}) {
  return {
    subsprint: input.subsprint ?? "S01",
    title: input.title ?? "Atomic item",
    description: input.description ?? "Implement one independently verifiable Sprinty item.",
    code_locations: input.code_locations ?? ["a.ts"],
    gates: input.gates ?? [{ kind: "command", spec: "true" }],
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
  };
}

beforeEach(() => {
  ({ dir, sha } = initRepo());
  dashboardCloseCalls = 0;
  tools = buildToolHandlers(
    () => new SprintStore(dir),
    async () => "http://127.0.0.1:0",
    (binding) => new SprintStore(binding.git_dir, binding.data_dir),
    async () => { dashboardCloseCalls += 1; },
  );
});

describe("tool handlers", () => {
  it("sprint_new returns goal and rejects bad input", async () => {
    const res = (await tools.sprint_new!.handler(sprintInput("g", ["human can watch dashboard"]))) as { goal: string; context_notes: string[] };
    expect(res.goal).toBe("g");
    expect(res.context_notes).toEqual(["human can watch dashboard"]);
    expect((res as { orientation: { how: string } }).orientation.how).toContain("dashboard()");
    await expect(tools.sprint_new!.handler({ goal: "", git_dir: dir, data_dir: join(dir, ".sprinty") })).rejects.toThrow();
  });

  it("sprint_resume reattaches an unbound session to an existing sprint without creating one", async () => {
    const dataDir = join(dir, ".sprinty-existing");
    new SprintStore(dir, dataDir).createSprint("existing sprint");
    let bound: SprintStore | undefined;
    const unboundTools = buildToolHandlers(
      () => {
        if (!bound) throw new Error("not bound");
        return bound;
      },
      async () => "http://127.0.0.1:0",
      (binding) => {
        bound = new SprintStore(binding.git_dir, binding.data_dir);
        return bound;
      },
    );

    await expect(unboundTools.info!.handler({})).rejects.toThrow("not bound");
    const rebound = (await unboundTools.sprint_resume!.handler({ git_dir: dir, data_dir: dataDir })) as { goal: string; dir: string; data_dir: string };
    expect(rebound.goal).toBe("existing sprint");
    expect(rebound.dir).toBe(dir);
    expect(rebound.data_dir).toBe(dataDir);
    const info = (await unboundTools.info!.handler({})) as { goal: string };
    expect(info.goal).toBe("existing sprint");
  });

  it("sprint_list can inspect a data_dir while the session is unbound", async () => {
    const dataDir = join(dir, ".sprinty-existing");
    new SprintStore(dir, dataDir).createSprint("existing sprint");
    const unboundTools = buildToolHandlers(
      () => { throw new Error("not bound"); },
      async () => "http://127.0.0.1:0",
      (binding) => new SprintStore(binding.git_dir, binding.data_dir),
    );

    const listed = (await unboundTools.sprint_list!.handler({ data_dir: dataDir })) as { current: string | null; sprints: Array<{ id: string; goal: string; status: string }> };
    expect(listed.current).toBe("001");
    expect(listed.sprints).toEqual([
      expect.objectContaining({ id: "001", goal: "existing sprint", status: "active" }),
    ]);
  });

  it("sprint_list returns an unbound hint when no data_dir is supplied", async () => {
    const unboundTools = buildToolHandlers(
      () => { throw new Error("not bound"); },
      async () => "http://127.0.0.1:0",
      (binding) => new SprintStore(binding.git_dir, binding.data_dir),
    );

    const listed = (await unboundTools.sprint_list!.handler({})) as { current: string | null; sprints: unknown[]; hint: string };
    expect(listed.current).toBeNull();
    expect(listed.sprints).toEqual([]);
    expect(listed.hint).toContain("data_dir");
  });

  it("sprint_detach clears the current binding and closes the dashboard", async () => {
    let bound: SprintStore | undefined = new SprintStore(dir, join(dir, ".sprinty"));
    bound.createSprint("attached sprint");
    const detachableTools = buildToolHandlers(
      () => {
        if (!bound) throw new Error("not bound");
        return bound;
      },
      async () => "http://127.0.0.1:0",
      (binding) => {
        bound = new SprintStore(binding.git_dir, binding.data_dir);
        return bound;
      },
      async () => { dashboardCloseCalls += 1; },
      async () => { bound = undefined; },
    );

    const detached = (await detachableTools.sprint_detach!.handler({})) as { detached: boolean };
    expect(detached.detached).toBe(true);
    expect(dashboardCloseCalls).toBe(1);
    await expect(detachableTools.info!.handler({})).rejects.toThrow("not bound");
  });

  it("describes current as including artifacts and recent activity", () => {
    expect(tools.current!.description).toContain("relevant artifacts");
    expect(tools.current!.description).toContain("recent activity");
  });

  it("drives a full happy path through the handlers", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    const sub = (await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] })) as { id: string };
    expect(sub.id).toBe("S01");
    const item = (await tools.add!.handler(addInput())) as { id: string };
    expect(item.id).toBe("S01-001");
    await tools.done!.handler({
      item: "S01-001",
      commit_id: sha,
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      changelog: { verb: "added", line: "added the first tracked item" },
    });
    const closed = (await tools.sprint_close!.handler({ coverage: { path: writeCoverage(dir), format: "lcov" } })) as { status: string };
    expect(closed.status).toBe("closed");
    expect(dashboardCloseCalls).toBe(1);
  });

  it("passes explicit gate supersession through done", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler(addInput({
      gates: [{ kind: "test", spec: "npm test -- --story SPRINTY-123" }],
    }));
    const view = (await tools.done!.handler({
      item: "S01-001",
      commit_id: sha,
      gate_results: [{
        kind: "test",
        spec: "npm test -- src/store/store.test.ts",
        passed: true,
        evidence: "passed",
        supersedes: { kind: "test", spec: "npm test -- --story SPRINTY-123" },
        supersession_reason: "Placeholder story id was replaced by the final focused test.",
      }],
      changelog: { verb: "fixed", line: "fixed gate supersession evidence" },
    })) as { subsprints: Array<{ items: Array<{ gate_results: Array<{ supersession_reason?: string }> }> }> };
    expect(view.subsprints[0]!.items[0]!.gate_results[0]!.supersession_reason).toContain("Placeholder");
  });

  it("keeps the dashboard open when sprint_close fails", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler(addInput());

    await expect(tools.sprint_close!.handler({})).rejects.toThrow();

    expect(dashboardCloseCalls).toBe(0);
  });

  it("rejects add calls without atomic title and bounded description", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await expect(tools.add!.handler({
      subsprint: "S01",
      description: "Implement one independently verifiable Sprinty item.",
      code_locations: ["a.ts"],
      gates: [{ kind: "command", spec: "true" }],
    })).rejects.toThrow();
    await expect(tools.add!.handler(addInput({ title: "Everything", description: "too broad" }))).rejects.toThrow();
    await expect(tools.add!.handler(addInput({ title: "A".repeat(81) }))).rejects.toThrow(/create more than one item/);
    await expect(tools.add!.handler(addInput({ description: "x".repeat(501) }))).rejects.toThrow(/create more than one item/);
  });

  it("renders changelog markdown through the handler", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler(addInput());
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
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler(addInput({ title: "First item", description: "Implement the first dependency graph item." }));
    await tools.add!.handler(addInput({ title: "Second item", description: "Implement the second dependency graph item.", code_locations: ["b.ts"] }));
    const res = (await tools.dependencies!.handler({ target: "S01-002", dependencies: ["S01-001"] })) as { graph: { edges: Array<{ from: string; to: string }> } };
    expect(res.graph.edges).toContainEqual({ from: "S01-002", to: "S01-001" });
  });

  it("records artifacts through the artifact verb and exposes them through current", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler(addInput());
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
    await tools.artifact_amend!.handler({ artifact: "A001", title: "Dashboard design v2" });
    const listed = (await tools.artifact_list!.handler({ include_deprecated: true })) as { artifacts: Array<{ id: string; title: string; status: string }> };
    expect(listed.artifacts[0]).toMatchObject({ id: "A001", title: "Dashboard design v2", status: "active" });
    const current = (await tools.current!.handler({})) as { artifacts: Array<{ id: string; uri: string; status: string }> };
    expect(current.artifacts[0]).toMatchObject({ id: "A001", target_id: "S01-001", kind: "spec", title: "Dashboard design v2", uri: "docs/superpowers/specs/dashboard.md", description: "Approved dashboard design", status: "active" });
    await tools.artifact_deprecate!.handler({ artifact: "A001", reason: "superseded by the implementation" });
    const active = (await tools.artifact_list!.handler({})) as { artifacts: unknown[] };
    expect(active.artifacts).toEqual([]);
  });

  it("records follow-ups with required bug ids", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler(addInput());
    await expect(tools.follow_up!.handler({ target: "S01-001", description: "needs bug" })).rejects.toThrow();
    const followUp = (await tools.follow_up!.handler({ target: "S01-001", description: "file the dashboard polish bug", bug_id: "BUG-42" })) as { id: string; view: { follow_ups: Array<{ bug_ids: string[] }> } };
    expect(followUp.id).toBe("F001");
    expect(followUp.view.follow_ups[0]!.bug_ids).toEqual(["BUG-42"]);
  });

  it("creates spike subsprints and requires conclusions before sprint close", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    const spike = (await tools.spike!.handler({ description: "investigate parser", goals: ["choose"], gates: [{ kind: "command", spec: "true" }] })) as { id: string };
    expect(spike.id).toBe("S01");
    await tools.add!.handler(addInput({ title: "Try parser", description: "Run one parser experiment with recorded evidence." }));
    await tools.done!.handler({
      item: "S01-001",
      commit_id: sha,
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      changelog: { verb: "added", line: "added spike-only finding" },
    });
    await expect(tools.sprint_close!.handler({ coverage: { path: writeCoverage(dir), format: "lcov" } })).rejects.toMatchObject({ blockers: expect.arrayContaining([expect.stringContaining("conclusion")]) });
    const concluded = (await tools.spike_conclude!.handler({ subsprint: "S01", conclusion: "Use the native parser." })) as { subsprints: Array<{ kind: string; spike_conclusion: string | null }> };
    expect(concluded.subsprints[0]!.kind).toBe("spike");
    expect(concluded.subsprints[0]!.spike_conclusion).toBe("Use the native parser.");
  });

  it("deprecates spike subsprints with a reason", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.spike!.handler({ description: "investigate unused path", goals: ["choose"], gates: [{ kind: "command", spec: "true" }] });
    const deprecated = (await tools.spike_deprecate!.handler({ subsprint: "S01", reason: "not worth pursuing" })) as { subsprints: Array<{ status: string; spike_deprecation_reason: string | null }> };
    expect(deprecated.subsprints[0]!.status).toBe("deprecated");
    expect(deprecated.subsprints[0]!.spike_deprecation_reason).toBe("not worth pursuing");
  });

  it("archives a sprint through the archive verb", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.add!.handler(addInput());
    const archived = (await tools.sprint_archive!.handler({ reason: "alpha recovery after bad ledger state" })) as { status: string };
    expect(archived.status).toBe("archived");
    expect(dashboardCloseCalls).toBe(1);
  });

  it("search finds matching ledger entries", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "serializer work", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    const matches = (await tools.search!.handler({ pattern: "serializer", context_lines: 0 })) as unknown[];
    expect(matches.length).toBe(1);
  });
});
