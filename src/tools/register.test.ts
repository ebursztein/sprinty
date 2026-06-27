import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SprintStore } from "../store/store.js";
import { buildToolHandlers, type DashboardController, type DashboardInfo, type ToolHandlers } from "./register.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-tools-"));
  const run = (a: string[]) => execFileSync("git", a, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  run(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "f.txt"), "x");
  run(["add", "f.txt"]);
  run(["commit", "-m", "init"]);
  return { dir, sha: run(["rev-parse", "HEAD"]) };
}

function writeCoverage(dir: string): string {
  mkdirSync(join(dir, "coverage"), { recursive: true });
  const path = join(dir, "coverage", "lcov.info");
  writeFileSync(path, "TN:\nSF:a.ts\nLF:1\nLH:1\nBRF:0\nBRH:0\nFNF:1\nFNH:1\nend_of_record\n");
  return path;
}

let dir: string;
let sha: string;
let tools: ToolHandlers;
let dashboardOpenCalls: number;
let dashboardRestartCalls: number;
let dashboardCloseCalls: number;

function sprintInput(goal: string, context_notes?: string[]) {
  return { goal, git_dir: dir, data_dir: join(dir, ".sprinty"), ...(context_notes ? { context_notes } : {}) };
}

function addInput(input: { subsprint?: string; title?: string; description?: string; code_locations?: string[]; gates?: Array<{ kind: string; spec: string }>; dependencies?: string[]; high_priority?: boolean } = {}) {
  return {
    subsprint: input.subsprint ?? "S01",
    title: input.title ?? "Atomic item",
    description: input.description ?? "Implement one independently verifiable Sprinty item.",
    code_locations: input.code_locations ?? ["a.ts"],
    gates: input.gates ?? [{ kind: "command", spec: "true" }],
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    ...(input.high_priority === undefined ? {} : { high_priority: input.high_priority }),
  };
}

function dashboardController(): DashboardController {
  let running = false;
  const info = (): DashboardInfo => running ? { running: true, url: "http://127.0.0.1:4321", port: 4321 } : { running: false };
  return {
    open: async () => {
      dashboardOpenCalls += 1;
      running = true;
      return info();
    },
    restart: async () => {
      dashboardRestartCalls += 1;
      running = true;
      return info();
    },
    info: async () => info(),
    close: async () => {
      dashboardCloseCalls += 1;
      running = false;
    },
  };
}

beforeEach(() => {
  ({ dir, sha } = initRepo());
  dashboardOpenCalls = 0;
  dashboardRestartCalls = 0;
  dashboardCloseCalls = 0;
  tools = buildToolHandlers(
    () => new SprintStore(dir),
    dashboardController(),
    (binding) => new SprintStore(binding.git_dir, binding.data_dir),
  );
});

describe("tool handlers", () => {
  it("sprint_new returns orientation for the canonical item workflow", async () => {
    const res = await tools.sprint_new!.handler(sprintInput("g", ["human can watch dashboard"])) as { goal: string; context_notes: string[]; orientation: { how: string }; dashboard: DashboardInfo };
    expect(res.goal).toBe("g");
    expect(res.context_notes).toEqual(["human can watch dashboard"]);
    expect(res.orientation.how).toContain("item_add");
    expect(res.orientation.how).toContain("dashboard_info");
    expect(res.dashboard).toEqual({ running: true, url: "http://127.0.0.1:4321", port: 4321 });
    expect(dashboardOpenCalls).toBe(1);
    await expect(tools.sprint_new!.handler({ goal: "", git_dir: dir, data_dir: join(dir, ".sprinty") })).rejects.toThrow();
  });

  it("sprint_resume reattaches an unbound session without creating a sprint", async () => {
    const dataDir = join(dir, ".sprinty-existing");
    new SprintStore(dir, dataDir).createSprint("existing sprint");
    let bound: SprintStore | undefined;
    const dashboard = dashboardController();
    const unboundTools = buildToolHandlers(
      () => {
        if (!bound) throw new Error("not bound");
        return bound;
      },
      dashboard,
      (binding) => {
        bound = new SprintStore(binding.git_dir, binding.data_dir);
        return bound;
      },
    );

    await expect(unboundTools.overview!.handler({})).rejects.toThrow("not bound");
    const rebound = await unboundTools.sprint_resume!.handler({ git_dir: dir, data_dir: dataDir }) as { ok: boolean; action: string; dashboard: DashboardInfo };
    expect(rebound).toMatchObject({ ok: true, action: "sprint_resume", dashboard: { running: true, url: "http://127.0.0.1:4321", port: 4321 } });
    const overview = await unboundTools.overview!.handler({}) as { title: string };
    expect(overview.title).toBe("existing sprint");
  });

  it("sprint_list summarizes existing ledgers and item states", async () => {
    const dataDir = join(dir, ".sprinty-existing");
    new SprintStore(dir, dataDir).createSprint("existing sprint");
    const unboundTools = buildToolHandlers(
      () => { throw new Error("not bound"); },
      dashboardController(),
      (binding) => new SprintStore(binding.git_dir, binding.data_dir),
    );

    const listed = await unboundTools.sprint_list!.handler({ data_dir: dataDir }) as { current: string | null; sprints: Array<{ id: string; title: string; status: string; items: { open: number; closed: number; blocked: number } }> };
    expect(listed.current).toBe("001");
    expect(listed.sprints).toEqual([
      expect.objectContaining({ id: "001", title: "existing sprint", status: "active", items: { open: 0, closed: 0, blocked: 0 } }),
    ]);
  });

  it("sprint_detach clears the current binding and closes the dashboard", async () => {
    let bound: SprintStore | undefined = new SprintStore(dir, join(dir, ".sprinty"));
    bound.createSprint("attached sprint");
    const dashboard = dashboardController();
    await dashboard.open();
    const detachableTools = buildToolHandlers(
      () => {
        if (!bound) throw new Error("not bound");
        return bound;
      },
      dashboard,
      (binding) => {
        bound = new SprintStore(binding.git_dir, binding.data_dir);
        return bound;
      },
      async () => { bound = undefined; },
    );

    const detached = await detachableTools.sprint_detach!.handler({}) as { detached: boolean };
    expect(detached.detached).toBe(true);
    expect(dashboardCloseCalls).toBe(1);
    await expect(detachableTools.overview!.handler({})).rejects.toThrow("not bound");
  });

  it("reports and restarts the dashboard explicitly after automatic open", async () => {
    expect(await tools.dashboard_info!.handler({})).toMatchObject({ running: false });
    await tools.sprint_new!.handler(sprintInput("g"));
    expect(await tools.dashboard_info!.handler({})).toMatchObject({ running: true, url: "http://127.0.0.1:4321", port: 4321 });
    expect(await tools.dashboard_restart!.handler({})).toMatchObject({ running: true, url: "http://127.0.0.1:4321", port: 4321 });
    expect(dashboardRestartCalls).toBe(1);
  });

  it("drives a full happy path through canonical item handlers", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    const sub = await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] }) as { subsprint: string };
    expect(sub.subsprint).toBe("S01");
    const item = await tools.item_add!.handler(addInput()) as { item: string };
    expect(item.item).toBe("S01-001");
    await tools.item_done!.handler({
      id: "S01-001",
      commit_id: sha,
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      changelog: { verb: "added", line: "added the first tracked item" },
    });
    const closed = await tools.sprint_close!.handler({ coverage: { path: writeCoverage(dir), format: "lcov" } }) as { status: string };
    expect(closed.status).toBe("closed");
    expect(dashboardCloseCalls).toBe(1);
  });

  it("keeps gate supersession visible through item_get", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput({ gates: [{ kind: "test", spec: "npm test -- --story SPRINTY-123" }] }));
    await tools.item_done!.handler({
      id: "S01-001",
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
    });
    const item = await tools.item_get!.handler({ id: "S01-001" }) as { gate_results: Array<{ supersession_reason?: string }> };
    expect(item.gate_results[0]!.supersession_reason).toContain("Placeholder");
  });

  it("rejects oversized items with a nudge to create more items", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await expect(tools.item_add!.handler({
      subsprint: "S01",
      description: "Implement one independently verifiable Sprinty item.",
      code_locations: ["a.ts"],
      gates: [{ kind: "command", spec: "true" }],
    })).rejects.toThrow();
    await expect(tools.item_add!.handler(addInput({ title: "Everything", description: "too broad" }))).rejects.toThrow();
    await expect(tools.item_add!.handler(addInput({ title: "A".repeat(81) }))).rejects.toThrow(/create more than one item/);
    await expect(tools.item_add!.handler(addInput({ description: "x".repeat(801) }))).rejects.toThrow(/add more items|artifact/);
  });

  it("rejects plan-dump item and subsprint payloads at the MCP boundary", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    const dump = [
      "Phase 1 implementation plan",
      "- Build the first broad path",
      "- Build the second broad path",
      "- Build the third broad path",
      "- Build the fourth broad path",
    ].join("\n");

    await expect(tools.item_add!.handler(addInput({ description: dump }))).rejects.toThrow(/multiple items|more items/);
    await expect(tools.subsprint_new!.handler({ description: dump, goals: ["go"], gates: [{ kind: "command", spec: "true" }] })).rejects.toThrow(/multiple items|more items/);
    await expect(tools.subsprint_new!.handler({
      description: "Bounded subsprint",
      goals: ["one", "two", "three", "four", "five", "six"],
      gates: [{ kind: "command", spec: "true" }],
    })).rejects.toThrow(/at most 5|5/);
    await expect(tools.item_add!.handler(addInput({
      gates: [
        { kind: "command", spec: "true" },
        { kind: "command", spec: "true" },
        { kind: "command", spec: "true" },
        { kind: "command", spec: "true" },
      ],
    }))).rejects.toThrow(/at most 3|3/);
    await expect(tools.item_add!.handler(addInput({
      gates: [{ kind: "command", spec: "verify the whole product behaves correctly" }],
    }))).rejects.toThrow(/manual|executable/);
  });

  it("writes changelog markdown and returns only its path", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput());
    await tools.item_done!.handler({
      id: "S01-001",
      commit_id: sha,
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      changelog: { verb: "changed", line: "Changed compact changelog response." },
    });

    const generated = await tools.changelog!.handler({}) as { path: string; entries?: unknown[]; markdown?: string };
    expect(generated.path).toBe(join(dir, ".sprinty", "CHANGELOG.md"));
    expect(generated.markdown).toBeUndefined();
    expect(generated.entries).toBeUndefined();
    expect(readFileSync(generated.path, "utf8")).toContain("## Changed");

    const path = join(dir, "CHANGELOG.md");
    const written = await tools.changelog!.handler({ path }) as { path: string; stats?: unknown; entries?: unknown[]; markdown?: string };
    expect(written).toEqual(expect.objectContaining({ path }));
    expect(written.stats).toBeUndefined();
    expect(written.entries).toBeUndefined();
    expect(written.markdown).toBeUndefined();
    const markdown = readFileSync(path, "utf8");
    expect(markdown).toContain("- `S01-001` **Atomic item**: Changed compact changelog response.");
    expect(markdown).toContain("  - Commit:");
  });

  it("records dependency edges through item_update and exposes them on focused reads", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput({ title: "First item", description: "Implement the first dependency graph item." }));
    await tools.item_add!.handler(addInput({ title: "Second item", description: "Implement the second dependency graph item.", code_locations: ["b.ts"] }));
    await tools.item_add!.handler(addInput({ title: "Third item", description: "Implement the third dependency graph item.", code_locations: ["c.ts"] }));
    await tools.item_update!.handler({ id: "S01-002", dependencies: ["S01-001"] });
    const item = await tools.item_get!.handler({ id: "S01-002" }) as { dependencies: string[] };
    expect(item.dependencies).toEqual(["S01-001"]);
    await tools.item_update!.handler({ id: "S01-002", dependencies: ["S01-003"] });
    const replaced = await tools.item_get!.handler({ id: "S01-002" }) as { dependencies: string[] };
    expect(replaced.dependencies).toEqual(["S01-003"]);
    await tools.item_update!.handler({ id: "S01-002", dependencies: [] });
    const removed = await tools.item_get!.handler({ id: "S01-002" }) as { dependencies: string[] };
    expect(removed.dependencies).toEqual([]);
  });

  it("passes high_priority through item_add and item_update", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput({ high_priority: true }));
    const added = await tools.item_get!.handler({ id: "S01-001" }) as { high_priority: boolean };
    expect(added.high_priority).toBe(true);
    await tools.item_update!.handler({ id: "S01-001", high_priority: false });
    const lowered = await tools.item_get!.handler({ id: "S01-001" }) as { high_priority: boolean };
    expect(lowered.high_priority).toBe(false);
  });

  it("records notes with note ids, supports note updates, and requires item scope", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput());
    await expect(tools.note_add!.handler({ id: "S01", text: "wrong scope" })).rejects.toThrow(/specific item/);
    const note = await tools.note_add!.handler({ id: "S01-001", text: "Original note text." }) as { note: string };
    expect(note.note).toMatch(/^N\d{3}$/);
    const listed = await tools.note_list!.handler({ id: "S01-001" }) as { notes: Array<{ id: string; text: string }> };
    expect(listed.notes).toEqual([{ id: note.note, text: "Original note text." }]);
    const updated = await tools.note_update!.handler({ id: note.note, text: "Updated note text." }) as { note: { text: string } };
    expect(updated.note.text).toBe("Updated note text.");
    const full = await tools.note_get!.handler({ id: note.note }) as { text: string };
    expect(full.text).toBe("Updated note text.");
  });

  it("records artifacts as compact sprint attachments and full get detail", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput());
    const artifact = await tools.artifact_add!.handler({
      title: "Dashboard design",
      path: "docs/superpowers/specs/dashboard.md",
      description: "Approved dashboard design",
      related_items: ["S01-001"],
    }) as { artifact: string };
    expect(artifact.artifact).toBe("A001");
    await tools.artifact_update!.handler({ id: "A001", title: "Dashboard design v2" });
    const listed = await tools.artifact_list!.handler({}) as { artifacts: Array<{ id: string; title: string; path: string; related_items: string[] }> };
    expect(listed.artifacts[0]).toEqual({ id: "A001", title: "Dashboard design v2", path: "docs/superpowers/specs/dashboard.md", related_items: ["S01-001"] });
    const detail = await tools.artifact_get!.handler({ id: "A001" }) as { artifact: { description: string } };
    expect(detail.artifact.description).toBe("Approved dashboard design");
  });

  it("next returns a compact active work window without the dependency graph", async () => {
    await tools.sprint_new!.handler(sprintInput("g"));
    await tools.subsprint_new!.handler({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput({ title: "First item", description: "Implement the first active window item." }));
    await tools.item_add!.handler(addInput({ title: "Second item", description: "Implement the second active window item.", code_locations: ["b.ts"], dependencies: ["S01-001"] }));
    const next = await tools.next!.handler({}) as { item: { id: string }; blocked: { items: Array<{ id: string; title: string }> }; graph?: unknown };
    expect(next.item.id).toBe("S01-001");
    expect(next.blocked.items).toEqual([{ id: "S01-002", title: "Second item" }]);
    expect(next.graph).toBeUndefined();
  });

  it("search returns ids, surrounding text, and focused get tool calls", async () => {
    await tools.sprint_new!.handler(sprintInput("serializer sprint"));
    await tools.subsprint_new!.handler({ description: "serializer work", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    await tools.item_add!.handler(addInput({ title: "Serializer item", description: "Implement one serializer item with evidence." }));
    const result = await tools.search!.handler({ pattern: "serializer", context_size: 512 }) as { matches: Array<{ id: string; type: string; tool_call: string; text: string }> };
    expect(result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sprint", type: "sprint", tool_call: "overview()" }),
      expect.objectContaining({ id: "S01", type: "subsprint", tool_call: 'subsprint_get({ id: "S01" })' }),
      expect.objectContaining({ id: "S01-001", type: "item", tool_call: 'item_get({ id: "S01-001" })' }),
    ]));
    expect(result.matches.every((match) => match.text.includes("serializer"))).toBe(true);
  });
});
