import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SprintStore, StoreError } from "./store.js";
import { Ledger } from "../ledger/ledger.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-store-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir }).toString().trim();
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
  const path = join(dir, "coverage", "lcov.info");
  mkdirSync(join(dir, "coverage"), { recursive: true });
  writeFileSync(path, [
    "TN:",
    "SF:src/a.ts",
    "LF:10",
    "LH:9",
    "BRF:4",
    "BRH:3",
    "FNF:2",
    "FNH:2",
    "end_of_record",
    "",
  ].join("\n"));
  return path;
}

let dir: string, sha: string, store: SprintStore;
beforeEach(() => { ({ dir, sha } = initRepo()); store = new SprintStore(dir); });

describe("SprintStore lifecycle", () => {
  it("creates a sprint, rejects a second while open, allows one after close", () => {
    const s = store.createSprint("ship sprinty");
    expect(s.goal).toBe("ship sprinty");
    expect(s.branch).toBe("main");
    expect(() => store.createSprint("again")).toThrow(StoreError);
    store.closeSprint();                       // empty sprint closes cleanly
    expect(store.createSprint("next").goal).toBe("next");
  });

  it("allows a new sprint after archive recovery", () => {
    store.createSprint("alpha");
    store.archiveSprint({ reason: "recovered broken alpha ledger" });
    expect(store.createSprint("next").goal).toBe("next");
  });

  it("mints subsprint and item ids", () => {
    store.createSprint("g");
    const sub = store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    expect(sub.id).toBe("S01");
    const item = store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(item.id).toBe("S01-001");
  });

  it("rejects adding an item to an unknown subsprint", () => {
    store.createSprint("g");
    expect(() => store.addItem({ subsprint: "S99", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] })).toThrow(StoreError);
  });

  it("rejects prose-like command gates before they enter the ledger", () => {
    store.createSprint("g");
    expect(() => store.createSubsprint({
      description: "d",
      goals: ["go"],
      gates: [{ kind: "command", spec: "bookshop owner accepts the dashboard direction" }],
    })).toThrow(/Command gate looks like prose/);
    expect(() => store.createSubsprint({
      description: "d",
      goals: ["go"],
      gates: [{ kind: "manual", spec: "bookshop owner accepts the dashboard direction" }],
    })).not.toThrow();
    expect(() => store.addItem({
      subsprint: "S01",
      description: "i",
      code_locations: ["a.ts"],
      gates: [{ kind: "command", spec: "docs reviewer signs off" }],
    })).toThrow(/Command gate looks like prose/);
  });

  it("done rejects a fake commit and accepts a real one", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.done({ item: "S01-001", commit_id: "0000000000000000000000000000000000000000", gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } })).toThrow(StoreError);
    const view = store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } });
    expect(view.subsprints[0]!.items[0]!.status).toBe("completed");
    expect(view.subsprints[0]!.items[0]!.changelog).toEqual({ verb: "added", line: "Added the thing." });
  });

  it("done requires a semver changelog line", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }] } as never)).toThrow();
  });

  it("done rejects a failed gate result", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: false, evidence: "boom" }], changelog: { verb: "fixed", line: "Fixed the thing." } })).toThrow(StoreError);
  });

  it("done requires passing evidence for every declared item gate and no unrelated extras", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({
      subsprint: "S01",
      description: "i",
      code_locations: ["a.ts"],
      gates: [
        { kind: "command", spec: "true" },
        { kind: "manual", spec: "reviewed timeline" },
      ],
    });
    expect(() => store.done({
      item: "S01-001",
      commit_id: sha,
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      changelog: { verb: "fixed", line: "Fixed missing gate coverage." },
    })).toThrow(/Missing gate evidence/);
    expect(() => store.done({
      item: "S01-001",
      commit_id: sha,
      gate_results: [
        { kind: "command", spec: "true", passed: true, evidence: "ok" },
        { kind: "manual", spec: "reviewed timeline", passed: true, evidence: "approved" },
        { kind: "command", spec: "unrelated", passed: true, evidence: "ok" },
      ],
      changelog: { verb: "fixed", line: "Fixed unexpected gate coverage." },
    })).toThrow(/Unexpected gate evidence/);
    const view = store.done({
      item: "S01-001",
      commit_id: sha,
      gate_results: [
        { kind: "command", spec: "true", passed: true, evidence: "ok" },
        { kind: "manual", spec: "reviewed timeline", passed: true, evidence: "approved" },
      ],
      changelog: { verb: "fixed", line: "Fixed gate evidence handling." },
    });
    expect(view.subsprints[0]!.items[0]!.gate_results).toHaveLength(2);
  });

  it("split resolves the item and creates a seeded subsprint atomically", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "too big", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const view = store.split({ item: "S01-001", description: "promoted", goals: ["finish it"], gates: [{ kind: "build", spec: "true" }] });
    expect(view.subsprints[0]!.items[0]!.status).toBe("split");
    expect(view.subsprints[0]!.items[0]!.spawned_subsprint).toBe("S02");
    expect(view.subsprints[1]!.id).toBe("S02");
    expect(view.subsprints[1]!.spawned_from_item).toBe("S01-001");
  });

  it("deprecate requires a reason", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.deprecate({ item: "S01-001", reason: "" })).toThrow(StoreError);
    const view = store.deprecate({ item: "S01-001", reason: "superseded" });
    expect(view.subsprints[0]!.items[0]!.status).toBe("deprecated");
  });

  it("records and rejects dependency graph edges", () => {
    store.createSprint("g", ["keep the graph visible"]);
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }], dependencies: [] });
    store.addItem({ subsprint: "S01", description: "base", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }], dependencies: [] });
    store.addItem({ subsprint: "S01", description: "dependent", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "true" }], dependencies: ["S01-001"] });
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S99-999"] })).toThrow(StoreError);
    const view = store.addDependencies({ target: "S01-002", dependencies: ["S01"] });
    expect(view.context_notes).toEqual(["keep the graph visible"]);
    expect(view.subsprints[0]!.items[1]!.dependencies).toEqual(["S01-001", "S01"]);
    expect(view.graph.edges).toContainEqual({ from: "S01-002", to: "S01-001" });
    expect(view.graph.edges).toContainEqual({ from: "S01-002", to: "S01" });
    expect(view.graph.topological_order.indexOf("S01-001")).toBeLessThan(view.graph.topological_order.indexOf("S01-002"));
    expect(view.graph.blocked_by["S01-002"]).toEqual(["S01-001", "S01"]);
    expect(() => store.addDependencies({ target: "S01-001", dependencies: ["S01-002"] })).toThrow(/cycle/i);
  });

  it("rejects invalid dependency edges before they enter the ledger", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "base", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "dependent", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "true" }], dependencies: ["S01-001"] });

    expect(() => store.addDependencies({ target: "S99-001", dependencies: ["S01-001"] })).toThrow(/Unknown dependency target/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S99-001"] })).toThrow(/Unknown dependency/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S01-002"] })).toThrow(/cannot depend on itself/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S01", "S01"] })).toThrow(/Duplicate dependencies/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S01-001"] })).toThrow(/already exists/);
  });

  it("update attaches intermediate info and rejects an unknown target", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const view = store.updateItem({ target: "S01-001", note: "halfway" });
    expect(view.subsprints[0]!.items[0]!.updates).toEqual(["halfway"]);
    expect(() => store.updateItem({ target: "S99-999", note: "x" })).toThrow(StoreError);
  });

  it("note attaches to an item or a subsprint and rejects an unknown element", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.addNote({ element: "S01-001", text: "item note" });
    store.addNote({ element: "S01", text: "subsprint note" });
    const view = store.read();
    expect(view.subsprints[0]!.items[0]!.notes).toEqual(["item note"]);
    expect(view.subsprints[0]!.notes).toEqual(["subsprint note"]);
    expect(() => store.addNote({ element: "nope", text: "x" })).toThrow(StoreError);
  });

  it("records artifact amendments, deprecations, and follow-ups", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const added = store.addArtifact({ target: "S01-001", kind: "spec", title: "Spec", uri: "docs/spec.md" });
    expect(added.id).toBe("A001");
    store.amendArtifact({ artifact: "A001", title: "Spec v2", description: "updated" });
    expect(store.listArtifacts({}).artifacts[0]).toMatchObject({ title: "Spec v2", status: "active" });
    expect(() => store.addFollowUp({ target: "S01-001", description: "missing bug id" })).toThrow(/bug_id/);
    const followUp = store.addFollowUp({ target: "S01-001", description: "file follow-up", bug_ids: ["BUG-1", "BUG-1"] });
    expect(followUp.id).toBe("F001");
    expect(followUp.view.follow_ups[0]!.bug_ids).toEqual(["BUG-1"]);
    store.deprecateArtifact({ artifact: "A001", reason: "superseded" });
    expect(store.listArtifacts({}).artifacts).toEqual([]);
    expect(store.listArtifacts({ include_deprecated: true }).artifacts[0]).toMatchObject({ status: "deprecated", deprecation_reason: "superseded" });
    expect(() => store.amendArtifact({ artifact: "A001", title: "Spec v3" })).toThrow(/deprecated/);
    expect(() => store.deprecateArtifact({ artifact: "A001", reason: "obsolete" })).toThrow(/already deprecated/);
    expect(store.listArtifacts({ include_deprecated: true }).artifacts[0]).toMatchObject({ deprecation_reason: "superseded" });
  });

  it("creates spike subsprints with normal items and a required conclusion", () => {
    store.createSprint("g");
    const spike = store.createSpike({ description: "try parser", goals: ["learn"], gates: [{ kind: "command", spec: "true" }] });
    expect(spike.id).toBe("S01");
    expect(spike.view.subsprints[0]!.kind).toBe("spike");
    store.addItem({ subsprint: "S01", description: "run experiment", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const afterItem = store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added spike-only finding." } });
    expect(afterItem.subsprints[0]!).toMatchObject({ kind: "spike", status: "open", changelog: [] });
    expect(afterItem.subsprints[0]!.items[0]!.status).toBe("completed");
    try { store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } }); throw new Error("should have thrown"); }
    catch (e) {
      expect(e).toBeInstanceOf(StoreError);
      expect((e as StoreError).blockers.join(" ")).toContain("spike_conclude");
    }
    const concluded = store.concludeSpike({ subsprint: "S01", conclusion: "Use the parser behind a small adapter." });
    expect(concluded.subsprints[0]!.spike_conclusion).toBe("Use the parser behind a small adapter.");
    expect(() => store.concludeSpike({ subsprint: "S01", conclusion: "Actually use something else." })).toThrow(/already concluded/);
    expect(() => store.deprecateSpike({ subsprint: "S01", reason: "changed our mind" })).toThrow(/already concluded/);
    const closed = store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } });
    expect(closed.status).toBe("closed");
    expect(store.changelog()).not.toContain("Added spike-only finding.");
  });

  it("deprecates spike subsprints with a reason", () => {
    store.createSprint("g");
    store.createSpike({ description: "try parser", goals: ["learn"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "run experiment", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    const view = store.deprecateSpike({ subsprint: "S01", reason: "not worth it" });
    expect(view.subsprints[0]!.status).toBe("deprecated");
    expect(view.subsprints[0]!.spike_deprecation_reason).toBe("not worth it");
    expect(view.subsprints[0]!.items[0]).toMatchObject({
      status: "deprecated",
      reason: "Spike S01 deprecated: not worth it",
    });
    expect(() => store.deprecateSpike({ subsprint: "S01", reason: "still not worth it" })).toThrow(/already deprecated/);
    expect(() => store.concludeSpike({ subsprint: "S01", conclusion: "Use it anyway." })).toThrow(/deprecated/);
    const closed = store.closeSprint({ coverage: { not_applicable: "spike was deprecated before code changed" } });
    expect(closed.status).toBe("closed");
  });
});

describe("sprint_close teeth", () => {
  it("refuses to close with an unresolved item and lists the blocker", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    try { store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } }); throw new Error("should have thrown"); }
    catch (e) { expect(e).toBeInstanceOf(StoreError); expect((e as StoreError).blockers.join(" ")).toContain("S01-001"); }
  });

  it("closes when every item is resolved and gates re-run green", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added close coverage." } });
    const view = store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov", command: "npm run test:coverage" } });
    expect(view.status).toBe("closed");
    expect(view.coverage?.lines).toEqual({ covered: 9, total: 10, percent: 90 });
  });

  it("requires coverage evidence by path to close", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added close coverage." } });
    try { store.closeSprint(); throw new Error("should have thrown"); }
    catch (e) {
      expect(e).toBeInstanceOf(StoreError);
      expect((e as StoreError).blockers.join(" ")).toContain("Coverage evidence is required");
    }
    try { store.closeSprint({ coverage: { path: "coverage/missing.info", format: "lcov" } }); throw new Error("should have thrown"); }
    catch (e) {
      expect(e).toBeInstanceOf(StoreError);
      expect((e as StoreError).blockers.join(" ")).toContain("Coverage report not found");
    }
  });

  it("allows coverage to be marked not applicable with a reason", () => {
    store.createSprint("docs");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "docs only", code_locations: ["README.md"], gates: [{ kind: "command", spec: "true" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "changed", line: "Changed docs-only sprint notes." } });
    const view = store.closeSprint({ coverage: { not_applicable: "docs-only sprint" } });
    expect(view.status).toBe("closed");
    expect(view.coverage).toBeNull();
  });

  it("archives a sprint with unresolved work when a recovery reason is provided", () => {
    store.createSprint("alpha recovery");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "stuck", code_locations: ["src/a.ts"], gates: [{ kind: "command", spec: "true" }] });
    expect(() => store.archiveSprint({ reason: "" })).toThrow(StoreError);
    const view = store.archiveSprint({ reason: "alpha recovery after bad ledger state" });
    expect(view.status).toBe("archived");
    expect(view.closed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns changelog markdown with file change-map and coverage tables", () => {
    store.createSprint("bookshop");
    store.createSubsprint({ description: "catalog", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    writeFileSync(join(dir, "catalog.ts"), "export const catalog = ['Dune'];\n");
    execFileSync("git", ["add", "catalog.ts"], { cwd: dir });
    execFileSync("git", ["commit", "-m", "catalog"], { cwd: dir });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
    store.addItem({ subsprint: "S01", description: "catalog", code_locations: ["catalog.ts"], gates: [{ kind: "command", spec: "true" }] });
    const view = store.done({ item: "S01-001", commit_id: commit, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added catalog data." } });
    expect(view.change_map.by_file).toContainEqual(expect.objectContaining({ file: "catalog.ts", additions: 1, deletions: 0, items: ["S01-001"] }));

    store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov", command: "npm run test:coverage" } });
    const md = store.changelog();
    expect(md).toContain("## Added");
    expect(md).toContain("| catalog.ts | TypeScript | . | S01-001 |");
    expect(md).toContain("## Coverage");
    expect(md).toContain("| Lines | 9/10 | 90% |");
  });

  it("refuses to close when a gate re-run fails", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "exit 1" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added close failure coverage." } });
    expect(() => store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } })).toThrow(StoreError);
  });

  it("re-verifies completed item commits when closing", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "true" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "true" }] });
    new Ledger(join(dir, ".sprinty", "001.jsonl")).append({
      type: "item_resolved",
      item_id: "S01-001",
      disposition: "completed",
      commit_id: "0000000000000000000000000000000000000000",
      gate_results: [{ kind: "command", spec: "true", passed: true, evidence: "ok" }],
      spawned_subsprint: null,
      reason: null,
    });
    try { store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } }); throw new Error("should have thrown"); }
    catch (e) {
      expect(e).toBeInstanceOf(StoreError);
      expect((e as StoreError).blockers.join(" ")).toContain("commit");
      expect((e as StoreError).blockers.join(" ")).toContain("S01-001");
    }
  });
});
