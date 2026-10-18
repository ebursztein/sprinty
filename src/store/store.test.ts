import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

  it("keeps sprint data in the configured data directory while using git_dir for repo operations", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sprinty-data-"));
    const scoped = new SprintStore(dir, dataDir);
    const s = scoped.createSprint("separate data");
    expect(s.dir).toBe(dir);
    expect(s.data_dir).toBe(realpathSync(dataDir));
    expect(existsSync(join(dataDir, "current"))).toBe(true);
    expect(existsSync(join(dataDir, "001.jsonl"))).toBe(true);
    expect(existsSync(join(dir, ".sprinty", "current"))).toBe(false);
  });

  it("mints subsprint and item ids", () => {
    store.createSprint("g");
    const sub = store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    expect(sub.id).toBe("S01");
    const item = store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    expect(item.id).toBe("S01-001");
    expect(item.view.subsprints[0]!.items[0]!.high_priority).toBe(false);
  });

  it("persists and mutates item high_priority as a boolean", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    const added = store.addItem({ subsprint: "S01", description: "important", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }], high_priority: true });
    expect(added.view.subsprints[0]!.items[0]!.high_priority).toBe(true);

    const lowered = store.updateItem({ target: "S01-001", high_priority: false });
    expect(lowered.subsprints[0]!.items[0]!.high_priority).toBe(false);

    const raised = store.updateItem({ target: "S01-001", note: "raise again", high_priority: true });
    expect(raised.subsprints[0]!.items[0]!.updates).toEqual(["raise again"]);
    expect(raised.subsprints[0]!.items[0]!.high_priority).toBe(true);
    expect(() => store.updateItem({ target: "S01", high_priority: true })).toThrow(/metadata/);
  });

  it("replaces an open item's gates and timeout by id", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    const added = store.addItem({ subsprint: "S01", description: "mutable", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }], gate_timeout_ms: 250 });
    expect(added.view.subsprints[0]!.items[0]!.gate_timeout_ms).toBe(250);

    const updated = store.updateItem({
      target: "S01-001",
      gates: [{ kind: "command", spec: "git status --short" }],
      gate_timeout_ms: null,
    });
    expect(updated.subsprints[0]!.items[0]).toMatchObject({
      code_locations: ["a.ts"],
      gates: [{ kind: "command", spec: "git status --short" }],
      gate_timeout_ms: null,
    });
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "changed", line: "Changed gate settings." } });
    const completed = store.updateItem({
      target: "S01-001",
      gates: [{ kind: "command", spec: "git rev-parse --is-inside-work-tree" }],
      gate_timeout_ms: 500,
    });
    expect(completed.subsprints[0]!.items[0]).toMatchObject({
      status: "completed",
      gates: [{ kind: "command", spec: "git rev-parse --is-inside-work-tree" }],
      gate_timeout_ms: 500,
    });
    expect(() => store.updateItem({
      target: "S01-001",
      gates: [{ kind: "manual", spec: "reviewer approves the revised result" }],
    })).toThrow(/manual evidence cannot be added after completion/);
  });

  it("corrects a completed item's verified commit and recomputes its change map", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "commit correction", code_locations: ["f.txt"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    expect(() => store.updateItem({ target: "S01-001", commit_id: sha })).toThrow(/complete it first/);
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "changed", line: "Changed commit evidence." } });
    expect(() => store.updateItem({ target: "S01-001", commit_id: "deadbeef" })).toThrow(/not found/);

    writeFileSync(join(dir, "f.txt"), "updated\n");
    execFileSync("git", ["add", "f.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-m", "replacement"], { cwd: dir });
    const replacement = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
    const updated = store.updateItem({ target: "S01-001", commit_id: replacement });
    const item = updated.subsprints[0]!.items[0]!;
    expect(item.commit_id).toBe(replacement);
    expect(item.actual_code_locations).toEqual(["f.txt"]);
    expect(item.change_map.by_file[0]!.commits).toEqual([replacement]);
    store.closeSprint({ coverage: { not_applicable: "commit correction test" } });
    const changelog = readFileSync(join(dir, ".sprinty", "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(replacement);
    expect(changelog).not.toContain(sha);
  });

  it("rejects adding an item to an unknown subsprint", () => {
    store.createSprint("g");
    expect(() => store.addItem({ subsprint: "S99", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] })).toThrow(StoreError);
  });

  it("rejects adding an item to a closed or deprecated subsprint", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "done", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "fixed", line: "Fixed closed work." } });
    expect(() => store.addItem({ subsprint: "S01", description: "reopen", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] })).toThrow(/closed subsprint/);

    store.createSubsprint({ description: "dropped later", goals: ["learn"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.deprecate({ target: "S02", reason: "not worth it" });
    expect(() => store.addItem({ subsprint: "S02", description: "late experiment", code_locations: ["c.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] })).toThrow(/deprecated subsprint/);
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
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    expect(() => store.done({ item: "S01-001", commit_id: "0000000000000000000000000000000000000000", gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } })).toThrow(StoreError);
    const { view } = store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } });
    expect(view.subsprints[0]!.items[0]!.status).toBe("completed");
    expect(view.subsprints[0]!.items[0]!.changelog).toEqual({ verb: "added", line: "Added the thing." });
  });

  it("done requires a semver changelog line", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    expect(() => store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }] } as never)).toThrow();
  });

  it("requires manual gate evidence, and rejects extras that were never declared", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({
      subsprint: "S01",
      description: "has one executable gate and one human check",
      code_locations: ["a.ts"],
      gates: [
        { kind: "command", spec: "git rev-parse HEAD" },
        { kind: "manual", spec: "reviewed timeline" },
      ],
    });
    // The executable gate is Sprinty's job; the manual one still needs a human's word.
    expect(() => store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "fixed", line: "Fixed it." } }))
      .toThrow(/Missing gate evidence/);
    expect(() => store.done({
      item: "S01-001", commit_id: sha, changelog: { verb: "fixed", line: "Fixed it." },
      gate_results: [
        { kind: "manual", spec: "reviewed timeline", passed: true, evidence: "approved" },
        { kind: "manual", spec: "never declared", passed: true, evidence: "ok" },
      ],
    })).toThrow(/Unexpected gate evidence/);
    const { view } = store.done({
      item: "S01-001", commit_id: sha, changelog: { verb: "fixed", line: "Fixed gate evidence handling." },
      gate_results: [{ kind: "manual", spec: "reviewed timeline", passed: true, evidence: "approved" }],
    });
    // One executed result plus one attested manual result.
    expect(view.subsprints[0]!.items[0]!.gate_results).toHaveLength(2);
  });

  it("allows supersession only for manual gates, since executable ones now run as declared", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({
      subsprint: "S01",
      description: "placeholder human check replaced by the real one",
      code_locations: ["a.ts"],
      gates: [{ kind: "manual", spec: "reviewer signs off on SPRINTY-123" }],
    });
    expect(() => store.done({
      item: "S01-001", commit_id: sha, changelog: { verb: "fixed", line: "Fixed supersession." },
      gate_results: [{
        kind: "manual", spec: "staff reviewer signed off", passed: true, evidence: "approved",
        supersedes: { kind: "manual", spec: "reviewer signs off on SPRINTY-123" },
      }],
    })).toThrow(/reason/);
    const { view } = store.done({
      item: "S01-001", commit_id: sha, changelog: { verb: "fixed", line: "Fixed supersession." },
      gate_results: [{
        kind: "manual", spec: "staff reviewer signed off", passed: true, evidence: "approved",
        supersedes: { kind: "manual", spec: "reviewer signs off on SPRINTY-123" },
        supersession_reason: "Placeholder story id was replaced by the named reviewer.",
      }],
    });
    expect(view.subsprints[0]!.items[0]!.gate_results[0]).toMatchObject({ spec: "staff reviewer signed off" });
  });

  it("runs a gate in its declared cwd and records that cwd in the result", () => {
    store.createSprint("g");
    mkdirSync(join(dir, "checks"));
    writeFileSync(join(dir, "checks", "marker.txt"), "ok");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "test -f marker.txt", cwd: "checks" }] });
    store.addItem({
      subsprint: "S01",
      description: "gate that only passes inside checks/",
      code_locations: ["checks/marker.txt"],
      gates: [{ kind: "command", spec: "test -f marker.txt", cwd: "checks" }],
    });
    const { view } = store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "fixed", line: "Fixed cwd gate." } });
    expect(view.subsprints[0]!.items[0]!.gate_results[0]).toMatchObject({ cwd: "checks", passed: true });
    expect(store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } }).status).toBe("closed");
  });

  it("split resolves the item and creates a seeded subsprint atomically", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "too big", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    const view = store.split({ item: "S01-001", description: "promoted", goals: ["finish it"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    expect(view.subsprints[0]!.items[0]!.status).toBe("split");
    expect(view.subsprints[0]!.items[0]!.spawned_subsprint).toBe("S02");
    expect(view.subsprints[1]!.id).toBe("S02");
    expect(view.subsprints[1]!.spawned_from_item).toBe("S01-001");
  });

  it("deprecate requires a reason", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    expect(() => store.deprecate({ target: "S01-001", reason: "" })).toThrow(StoreError);
    const view = store.deprecate({ target: "S01-001", reason: "superseded" });
    expect(view.subsprints[0]!.items[0]!.status).toBe("deprecated");
  });

  it("records and rejects dependency graph edges", () => {
    store.createSprint("g", ["keep the graph visible"]);
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }], dependencies: [] });
    store.addItem({ subsprint: "S01", description: "base", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }], dependencies: [] });
    store.addItem({ subsprint: "S01", description: "dependent", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }], dependencies: ["S01-001"] });
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

  it("replaces dependency sets through item update so wrong edges can be removed", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "base", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "debug capture", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }], dependencies: ["S01-001"] });
    store.addItem({ subsprint: "S01", description: "alternate blocker", code_locations: ["c.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });

    const replaced = store.updateItem({ target: "S01-002", dependencies: ["S01-003"] });
    expect(replaced.subsprints[0]!.items[1]!.dependencies).toEqual(["S01-003"]);
    expect(replaced.graph.edges).not.toContainEqual({ from: "S01-002", to: "S01-001" });
    expect(replaced.graph.edges).toContainEqual({ from: "S01-002", to: "S01-003" });

    const removed = store.updateItem({ target: "S01-002", dependencies: [] });
    expect(removed.subsprints[0]!.items[1]!.dependencies).toEqual([]);
    expect(removed.graph.blocked_by["S01-002"]).toEqual([]);
  });

  it("validates replacement dependency sets before they enter the ledger", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "base", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "dependent", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });

    expect(() => store.updateItem({ target: "S01-002", dependencies: ["S99-001"] })).toThrow(/Unknown dependency/);
    expect(() => store.updateItem({ target: "S01-002", dependencies: ["S01-001", "S01-001"] })).toThrow(/Duplicate dependencies/);
    expect(() => store.updateItem({ target: "S01-002", dependencies: ["S01-002"] })).toThrow(/cannot depend on itself/);
    store.updateItem({ target: "S01-001", dependencies: ["S01-002"] });
    expect(() => store.updateItem({ target: "S01-002", dependencies: ["S01-001"] })).toThrow(/cycle/i);
  });

  it("rejects invalid dependency edges before they enter the ledger", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "base", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "dependent", code_locations: ["b.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }], dependencies: ["S01-001"] });

    expect(() => store.addDependencies({ target: "S99-001", dependencies: ["S01-001"] })).toThrow(/Unknown dependency target/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S99-001"] })).toThrow(/Unknown dependency/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S01-002"] })).toThrow(/cannot depend on itself/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S01", "S01"] })).toThrow(/Duplicate dependencies/);
    expect(() => store.addDependencies({ target: "S01-002", dependencies: ["S01-001"] })).toThrow(/already exists/);
  });

  it("update attaches intermediate info and rejects an unknown target", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    const view = store.updateItem({ target: "S01-001", note: "halfway" });
    expect(view.subsprints[0]!.items[0]!.updates).toEqual(["halfway"]);
    expect(() => store.updateItem({ target: "S99-999", note: "x" })).toThrow(StoreError);
  });

  it("note attaches only to an item and rejects subsprint or unknown targets", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addNote({ element: "S01-001", text: "item note" });
    const view = store.read();
    expect(view.subsprints[0]!.items[0]!.notes).toEqual(["item note"]);
    expect(() => store.addNote({ element: "S01", text: "subsprint note" })).toThrow(/specific item/);
    expect(() => store.addNote({ element: "nope", text: "x" })).toThrow(StoreError);
  });

  it("records artifact amendments, deprecations, and follow-ups", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "build", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
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


});

describe("sprint_close teeth", () => {
  it("refuses to close with an unresolved item and lists the blocker", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    try { store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" }, force: true }); throw new Error("should have thrown"); }
    catch (e) { expect(e).toBeInstanceOf(StoreError); expect((e as StoreError).blockers.join(" ")).toContain("S01-001"); }
  });

  it("closes when every item is resolved and gates re-run green", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added close coverage." } });
    const view = store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov", command: "npm run test:coverage" } });
    expect(view.status).toBe("closed");
    expect(view.coverage?.lines).toEqual({ covered: 9, total: 10, percent: 90 });
    expect(view.coverage_state).toMatchObject({
      status: "reported",
      summary: { lines: { covered: 9, total: 10, percent: 90 } },
    });
    const changelog = readFileSync(join(dir, ".sprinty", "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("Added close coverage.");
    expect(changelog).toContain("90%");
  });

  it("deduplicates identical executable gates at close time", () => {
    store.createSprint("g");
    const gate = { kind: "command" as const, spec: "node -e \"require('fs').appendFileSync('gate.log','x')\"" };
    store.createSubsprint({ description: "d", goals: ["go"], gates: [gate] });
    store.addItem({ subsprint: "S01", description: "i one", code_locations: ["a.ts"], gates: [gate] });
    store.addItem({ subsprint: "S01", description: "i two", code_locations: ["b.ts"], gates: [gate] });
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added first close gate." } });
    store.done({ item: "S01-002", commit_id: sha, changelog: { verb: "added", line: "Added second close gate." } });

    const view = store.closeSprint({ coverage: { not_applicable: "close gate dedupe test" } });
    const closeEvent = new Ledger(join(dir, ".sprinty", "001.jsonl")).read().findLast((event) => event.type === "sprint_closed");

    expect(view.status).toBe("closed");
    // Sprinty now executes gates per item, so a side-effecting gate runs once per item_done
    // (two here) plus once more at close, where identical specs are still collapsed to one run.
    expect(readFileSync(join(dir, "gate.log"), "utf8")).toBe("xxx");
    expect(closeEvent?.gate_results.filter((result) => result.spec === gate.spec)).toHaveLength(1);
  });

  it("rejects post-close mutations and duplicate close attempts", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "fixed", line: "Fixed close lifecycle." } });
    store.closeSprint({ coverage: { not_applicable: "post-close guard test" } });

    expect(() => store.createSubsprint({ description: "late", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] })).toThrow(/closed/);
    expect(() => store.addNote({ element: "S01", text: "late note" })).toThrow(/closed/);
    expect(() => store.archiveSprint({ reason: "late archive" })).toThrow(/closed/);
    expect(() => store.closeSprint({ coverage: { not_applicable: "again" } })).toThrow(/already closed/);

    expect(store.createSprint("next").status).toBe("active");
  });

  it("requires coverage evidence by path to close", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added close coverage." } });
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
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "docs only", code_locations: ["README.md"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "changed", line: "Changed docs-only sprint notes." } });
    const view = store.closeSprint({ coverage: { not_applicable: "docs-only sprint" } });
    expect(view.status).toBe("closed");
    expect(view.coverage).toBeNull();
    expect(view.coverage_state).toEqual({ status: "not_applicable", reason: "docs-only sprint" });
  });

  it("archives a sprint with unresolved work when a recovery reason is provided", () => {
    store.createSprint("alpha recovery");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "stuck", code_locations: ["src/a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    expect(() => store.archiveSprint({ reason: "" })).toThrow(StoreError);
    const view = store.archiveSprint({ reason: "alpha recovery after bad ledger state" });
    expect(view.status).toBe("archived");
    expect(view.closed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns changelog markdown with file change-map and coverage tables", () => {
    store.createSprint("bookshop");
    store.createSubsprint({ description: "catalog", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    writeFileSync(join(dir, "catalog.ts"), "export const catalog = ['Dune'];\n");
    execFileSync("git", ["add", "catalog.ts"], { cwd: dir });
    execFileSync("git", ["commit", "-m", "catalog"], { cwd: dir });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
    store.addItem({ subsprint: "S01", description: "catalog", code_locations: ["catalog.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    const { view } = store.done({ item: "S01-001", commit_id: commit, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added catalog data." } });
    expect(view.change_map.by_file).toContainEqual(expect.objectContaining({ file: "catalog.ts", additions: 1, deletions: 0, items: ["S01-001"] }));

    store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov", command: "npm run test:coverage" } });
    const md = store.changelog();
    expect(md).toContain("## Added");
    expect(md).toContain("| catalog.ts | TypeScript | . | S01-001 |");
    expect(md).toContain("## Coverage");
    expect(md).toContain("| Lines | 9/10 | 90% |");
  });

  it("explains coverage not-applicable in changelog markdown", () => {
    store.createSprint("docs");
    store.createSubsprint({ description: "docs", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "docs", code_locations: ["README.md"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "changed", line: "Changed docs." } });
    store.closeSprint({ coverage: { not_applicable: "docs-only sprint" } });

    const md = store.changelog();

    expect(md).toContain("## Coverage");
    expect(md).toContain("Not applicable: docs-only sprint");
  });

  it("refuses to close when a gate re-run fails", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "exit 1" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added close failure coverage." } });
    expect(() => store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } })).toThrow(StoreError);
  });

  it("uses a completed item's revised gate and timeout during close", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "changed", line: "Changed recoverable gate settings." } });
    const slowGate = { kind: "command" as const, spec: "node -e \"setTimeout(() => {}, 80)\"" };
    store.updateItem({ target: "S01-001", gates: [slowGate], gate_timeout_ms: 10 });

    try { store.closeSprint({ coverage: { not_applicable: "timeout recovery test" } }); throw new Error("should have thrown"); }
    catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      expect((error as StoreError).blockers.join(" ")).toContain("Gate failed");
    }

    store.updateItem({ target: "S01-001", gate_timeout_ms: 500 });
    expect(store.closeSprint({ coverage: { not_applicable: "timeout recovery test" } }).status).toBe("closed");
  });

  it("force closes past gate failures but records the override", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "node -e \"process.exit(1)\"" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "changed", line: "Changed forced close handling." } });

    const view = store.closeSprint({ coverage: { not_applicable: "forced close test" }, force: true });
    const closeEvent = new Ledger(join(dir, ".sprinty", "001.jsonl")).read().findLast((event) => event.type === "sprint_closed");

    expect(view.status).toBe("closed");
    expect(closeEvent).toMatchObject({ forced: true });
    expect(closeEvent?.gate_results).toContainEqual(expect.objectContaining({ passed: false }));
  });

  it("re-verifies completed item commits when closing", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "i", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    new Ledger(join(dir, ".sprinty", "001.jsonl")).append({
      type: "item_resolved",
      item_id: "S01-001",
      disposition: "completed",
      commit_id: "0000000000000000000000000000000000000000",
      gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }],
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

  it("refuses to close while a feature subsprint has no items", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "real work", goals: ["ship"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "the only real item", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } });
    store.createSubsprint({ description: "declared but never decomposed", goals: ["someday"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });

    try { store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } }); throw new Error("should have thrown"); }
    catch (e) {
      expect(e).toBeInstanceOf(StoreError);
      expect((e as StoreError).blockers.join(" ")).toContain("S02");
    }
  });
});

describe("item_done executes gates instead of trusting claims", () => {
  it("runs the declared gate and records the real result, ignoring any claim", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git status --short" }] });
    store.addItem({ subsprint: "S01", description: "real work here", code_locations: ["f.txt"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    const { view } = store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added the thing." } });
    const results = view.subsprints[0]!.items[0]!.gate_results;
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
    // Evidence is captured output, not an agent-supplied string.
    expect(results[0]!.evidence.trim()).toBe(sha);
  });

  it("refuses to complete an item whose gate actually fails", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git status --short" }] });
    store.addItem({ subsprint: "S01", description: "work that does not pass", code_locations: ["f.txt"], gates: [{ kind: "command", spec: "exit 3" }] });
    expect(() => store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." } }))
      .toThrow(/failing gates/);
    expect(store.read().subsprints[0]!.items[0]!.status).toBe("open");
  });

  it("uses the item's configured timeout and records overruns as unverified", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git status --short" }] });
    store.addItem({ subsprint: "S01", description: "guarded by a slow gate", code_locations: ["f.txt"], gates: [{ kind: "command", spec: "node -e \"setTimeout(() => {}, 200)\"" }], gate_timeout_ms: 25 });
    const { view, warning } = store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." } });
    const item = view.subsprints[0]!.items[0]!;
    expect(item.status).toBe("completed");
    expect(item.gate_results[0]!.timed_out).toBe(true);
    expect(item.gate_results[0]!.passed).toBe(false);
    expect(warning).toContain("25ms");
  });

  it("runs an item gate without a timeout when explicitly disabled", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git status --short" }] });
    store.addItem({ subsprint: "S01", description: "unbounded gate", code_locations: ["f.txt"], gates: [{ kind: "command", spec: "node -e \"setTimeout(() => {}, 30)\"" }], gate_timeout_ms: null });
    const { view, warning } = store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." } });
    expect(view.subsprints[0]!.items[0]!.gate_results[0]!.passed).toBe(true);
    expect(warning).toBeNull();
  });

  it("still takes agent evidence for manual gates, which cannot be executed", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git status --short" }] });
    store.addItem({ subsprint: "S01", description: "needs a human eye", code_locations: ["f.txt"], gates: [{ kind: "manual", spec: "designer confirms the spacing" }] });
    expect(() => store.done({ item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." } }))
      .toThrow(/Missing gate evidence/);
    const { view } = store.done({
      item: "S01-001", commit_id: sha, changelog: { verb: "added", line: "Added." },
      gate_results: [{ kind: "manual", spec: "designer confirms the spacing", passed: true, evidence: "confirmed in review" }],
    });
    expect(view.subsprints[0]!.items[0]!.status).toBe("completed");
  });
});

describe("subsprint deprecation", () => {
  it("deprecates a feature subsprint through deprecate() and then closes", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "real work", goals: ["ship"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "the only real item", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.done({ item: "S01-001", commit_id: sha, gate_results: [{ kind: "command", spec: "git rev-parse HEAD", passed: true, evidence: "ok" }], changelog: { verb: "added", line: "Added the thing." } });
    store.createSubsprint({ description: "declared but never decomposed", goals: ["someday"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });

    const view = store.deprecate({ target: "S02", reason: "descoped after the spike" });
    expect(view.subsprints[1]!).toMatchObject({ status: "deprecated", deprecation_reason: "descoped after the spike" });

    expect(store.closeSprint({ coverage: { path: writeCoverage(dir), format: "lcov" } }).status).toBe("closed");
  });

  it("cascades subsprint deprecation to its open items", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "abandoned", goals: ["nope"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "never going to happen", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });

    const view = store.deprecate({ target: "S01", reason: "requirements changed" });
    expect(view.subsprints[0]!.items[0]).toMatchObject({
      status: "deprecated",
      reason: "Subsprint S01 deprecated: requirements changed",
    });
    expect(() => store.deprecate({ target: "S01", reason: "again" })).toThrow(/already deprecated/);
  });

  it("still requires a reason and still rejects unknown targets", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    expect(() => store.deprecate({ target: "S01", reason: "  " })).toThrow(StoreError);
    expect(() => store.deprecate({ target: "S99", reason: "nope" })).toThrow(/Unknown/);
  });
});

describe("code locations: declared intent vs what the commit actually touched", () => {
  function commitTouching(files: string[]): string {
    for (const file of files) writeFileSync(join(dir, file), `${file} content\n`);
    execFileSync("git", ["add", ...files], { cwd: dir });
    execFileSync("git", ["commit", "-m", `touch ${files.join(",")}`], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  }

  it("records the files the commit really changed, not only the declared ones", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "said one file, touched three", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    const commit = commitTouching(["a.ts", "b.ts", "c.ts"]);

    const { view } = store.done({ item: "S01-001", commit_id: commit, changelog: { verb: "added", line: "Added." } });
    const item = view.subsprints[0]!.items[0]!;
    expect(item.code_locations).toEqual(["a.ts"]);
    expect(item.actual_code_locations.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("reports scope drift so a human can see undeclared files", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "declared narrowly", code_locations: ["a.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    const commit = commitTouching(["a.ts", "surprise.ts"]);

    const { view } = store.done({ item: "S01-001", commit_id: commit, changelog: { verb: "added", line: "Added." } });
    expect(view.subsprints[0]!.items[0]!.undeclared_code_locations).toEqual(["surprise.ts"]);
  });

  it("reports no drift when the commit stays inside what was declared", () => {
    store.createSprint("g");
    store.createSubsprint({ description: "d", goals: ["go"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    store.addItem({ subsprint: "S01", description: "declared exactly", code_locations: ["a.ts", "b.ts"], gates: [{ kind: "command", spec: "git rev-parse HEAD" }] });
    const commit = commitTouching(["a.ts"]);

    const { view } = store.done({ item: "S01-001", commit_id: commit, changelog: { verb: "added", line: "Added." } });
    expect(view.subsprints[0]!.items[0]!.undeclared_code_locations).toEqual([]);
  });
});
