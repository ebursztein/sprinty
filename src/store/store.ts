import { Ledger } from "../ledger/ledger.js";
import { SprintBook } from "../ledger/book.js";
import { project, type SprintView } from "../domain/projection.js";
import { mintSubsprintId, mintItemId } from "../domain/ids.js";
import { commitNumstat, gitContext, verifyCommit } from "../git/git.js";
import { isExecutable, runGate } from "../gates/run.js";
import { searchLedger, type SearchMatch } from "../domain/search.js";
import { GraphCycleError, buildDependencyGraph } from "../domain/graph.js";
import { buildItemChangeMap, emptyChangeMap } from "../domain/change-map.js";
import { parseCoverageReport, type CoverageInput, type CoverageSummary } from "../domain/coverage.js";
import { renderChangelogMarkdown } from "../domain/changelog.js";
import type { ArtifactKind, ChangelogEntry, LedgerEvent } from "../domain/events.js";
import type { Gate, GateResult } from "../domain/gates.js";

export class StoreError extends Error {
  constructor(message: string, readonly blockers: string[] = []) {
    super(message);
    this.name = "StoreError";
  }
}

export class SprintStore {
  private readonly book: SprintBook;
  constructor(private readonly dir: string) { this.book = new SprintBook(dir); }

  // Resolves the current sprint's ledger via `.sprinty/current`. Throws if no sprint.
  private get ledger(): Ledger {
    const id = this.book.currentId();
    if (!id) throw new StoreError("No sprint. Call sprint_new first.");
    return this.book.ledger(id);
  }

  private state(): SprintView | null {
    const id = this.book.currentId();
    return id ? project(this.book.ledger(id).read()) : null;
  }
  private requireState(): SprintView {
    const s = this.state();
    if (!s) throw new StoreError("No sprint. Call sprint_new first.");
    return s;
  }

  read(): SprintView { return this.requireState(); }

  createSprint(goal: string, contextNotes: string[] = []): SprintView {
    const existing = this.state();
    if (existing && existing.status !== "closed") throw new StoreError("The current sprint is still open. Close it before starting a new one.");
    if (!goal.trim()) throw new StoreError("Sprint goal is required.");
    const id = this.book.allocateId();   // new ledger file id (001, 002, …)
    this.book.setCurrent(id);            // `.sprinty/current` -> id : enforces unicity
    const { branch, worktree } = gitContext(this.dir);
    this.book.ledger(id).append({ type: "sprint_created", goal, worktree, branch, dir: this.dir, context_notes: contextNotes });
    return this.requireState();
  }

  createSubsprint(input: { description: string; goals: string[]; gates: Gate[]; dependencies?: string[] }): { id: string; view: SprintView } {
    const s = this.requireState();
    const id = mintSubsprintId(s.subsprints.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, id, dependencies, { allowNewTarget: true, newTarget: { id, kind: "subsprint", label: input.description, status: "open" } });
    this.ledger.append({ type: "subsprint_created", subsprint_id: id, description: input.description, goals: input.goals, gates: input.gates, spawned_from_item: null, dependencies });
    return { id, view: this.requireState() };
  }

  addItem(input: { subsprint: string; description: string; code_locations: string[]; gates: Gate[]; dependencies?: string[] }): { id: string; view: SprintView } {
    const s = this.requireState();
    const sub = s.subsprints.find((x) => x.id === input.subsprint);
    if (!sub) throw new StoreError(`Unknown subsprint ${input.subsprint}.`);
    const id = mintItemId(sub.id, sub.items.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, id, dependencies, { allowNewTarget: true, newTarget: { id, kind: "item", label: input.description, status: "open" } });
    this.ledger.append({ type: "item_added", item_id: id, subsprint_id: sub.id, description: input.description, code_locations: input.code_locations, gates: input.gates, dependencies });
    return { id, view: this.requireState() };
  }

  private findOpenItem(s: SprintView, itemId: string) {
    const item = s.subsprints.flatMap((x) => x.items).find((i) => i.id === itemId);
    if (!item) throw new StoreError(`Unknown item ${itemId}.`);
    if (item.status !== "open") throw new StoreError(`Item ${itemId} is already ${item.status}.`);
    return item;
  }

  updateItem(input: { target: string; note: string }): SprintView {
    const s = this.requireState();
    const exists = s.subsprints.some((x) => x.id === input.target) || s.subsprints.flatMap((x) => x.items).some((i) => i.id === input.target);
    if (!exists) throw new StoreError(`Unknown target ${input.target}.`);
    this.ledger.append({ type: "item_updated", target_id: input.target, note: input.note });
    return this.requireState();
  }

  done(input: { item: string; commit_id: string; gate_results: GateResult[]; changelog: ChangelogEntry }): SprintView {
    const s = this.requireState();
    const item = this.findOpenItem(s, input.item);
    if (!verifyCommit(this.dir, input.commit_id)) throw new StoreError(`Commit ${input.commit_id} not found in repo.`);
    if (!input.changelog?.line.trim()) throw new StoreError("Changelog line is required.");
    this.validateGateEvidence(item.gates, input.gate_results);
    const failed = input.gate_results.filter((g) => !g.passed);
    if (failed.length > 0) throw new StoreError(`Cannot complete ${input.item}: failing gates: ${failed.map((g) => g.spec).join(", ")}`);
    const changeMap = buildItemChangeMap(input.item, input.commit_id, commitNumstat(this.dir, input.commit_id));
    this.ledger.append({ type: "item_resolved", item_id: input.item, disposition: "completed", commit_id: input.commit_id, gate_results: input.gate_results, spawned_subsprint: null, reason: null, changelog: input.changelog, change_map: changeMap });
    return this.requireState();
  }

  private validateGateEvidence(gates: Gate[], results: GateResult[]): void {
    const key = (g: Gate | GateResult) => `${g.kind}\u0000${g.spec}`;
    const expected = new Map(gates.map((g) => [key(g), g]));
    const seen = new Set<string>();

    for (const result of results) {
      const resultKey = key(result);
      if (!expected.has(resultKey)) throw new StoreError(`Unexpected gate evidence: ${result.kind}:${result.spec}`);
      if (seen.has(resultKey)) throw new StoreError(`Duplicate gate evidence: ${result.kind}:${result.spec}`);
      seen.add(resultKey);
    }

    const missing = gates.filter((g) => !seen.has(key(g)));
    if (missing.length > 0) {
      throw new StoreError(`Missing gate evidence: ${missing.map((g) => `${g.kind}:${g.spec}`).join(", ")}`);
    }
  }

  split(input: { item: string; description: string; goals: string[]; gates: Gate[]; dependencies?: string[] }): SprintView {
    const s = this.requireState();
    this.findOpenItem(s, input.item);
    const newId = mintSubsprintId(s.subsprints.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, newId, dependencies, { allowNewTarget: true, newTarget: { id: newId, kind: "subsprint", label: input.description, status: "open" } });
    this.ledger.append({ type: "item_resolved", item_id: input.item, disposition: "split", commit_id: null, gate_results: [], spawned_subsprint: newId, reason: null, changelog: null, change_map: emptyChangeMap() });
    this.ledger.append({ type: "subsprint_created", subsprint_id: newId, description: input.description, goals: input.goals, gates: input.gates, spawned_from_item: input.item, dependencies });
    return this.requireState();
  }

  deprecate(input: { item: string; reason: string }): SprintView {
    const s = this.requireState();
    this.findOpenItem(s, input.item);
    if (!input.reason.trim()) throw new StoreError("Deprecation requires a reason.");
    this.ledger.append({ type: "item_resolved", item_id: input.item, disposition: "deprecated", commit_id: null, gate_results: [], spawned_subsprint: null, reason: input.reason, changelog: null, change_map: emptyChangeMap() });
    return this.requireState();
  }

  addDependencies(input: { target: string; dependencies: string[] }): SprintView {
    const s = this.requireState();
    this.validateDependencyAddition(s, input.target, input.dependencies);
    this.ledger.append({ type: "dependencies_added", target_id: input.target, dependencies: input.dependencies });
    return this.requireState();
  }

  addNote(input: { element: string; text: string }): SprintView {
    const s = this.requireState();
    const exists = s.subsprints.some((x) => x.id === input.element) || s.subsprints.flatMap((x) => x.items).some((i) => i.id === input.element);
    if (!exists) throw new StoreError(`Unknown element ${input.element}.`);
    this.ledger.append({ type: "note_added", element_id: input.element, text: input.text });
    return this.requireState();
  }

  addArtifact(input: { target?: string; kind: ArtifactKind; title: string; uri: string; description?: string | null | undefined }): { id: string; view: SprintView } {
    const s = this.requireState();
    const target = input.target ?? "sprint";
    const exists = target === "sprint" || s.subsprints.some((x) => x.id === target) || s.subsprints.flatMap((x) => x.items).some((i) => i.id === target);
    if (!exists) throw new StoreError(`Unknown artifact target ${target}.`);
    const id = `A${String(s.artifacts.length + 1).padStart(3, "0")}`;
    this.ledger.append({
      type: "artifact_added",
      artifact_id: id,
      target_id: target,
      kind: input.kind,
      title: input.title,
      uri: input.uri,
      description: input.description ?? null,
    });
    return { id, view: this.requireState() };
  }

  private currentSprintEvents(): LedgerEvent[] {
    const id = this.book.currentId();
    return id ? this.book.ledger(id).read() : [];
  }

  search(pattern: string, contextLines: number): SearchMatch[] {
    return searchLedger(this.currentSprintEvents(), pattern, contextLines);
  }

  changelog(): string {
    return renderChangelogMarkdown(this.requireState());
  }

  closeSprint(input: { coverage?: CoverageInput | undefined } = {}): SprintView {
    const s = this.requireState();
    const blockers: string[] = [];
    const allItems = s.subsprints.flatMap((x) => x.items);
    let coverage: CoverageSummary | null = null;

    for (const item of allItems) {
      if (item.status === "open") { blockers.push(`Item ${item.id} is unresolved.`); continue; }
      if (item.status === "completed") {
        if (!item.commit_id) blockers.push(`Item ${item.id} completed without a commit.`);
        else if (!verifyCommit(this.dir, item.commit_id)) blockers.push(`Item ${item.id} completed with a commit that no longer resolves: ${item.commit_id}.`);
        if (!item.changelog) blockers.push(`Item ${item.id} completed without a changelog line.`);
        try { this.validateGateEvidence(item.gates, item.gate_results); }
        catch (err) { blockers.push(`Item ${item.id}: ${(err as Error).message}`); }
      }
    }

    if (allItems.some((item) => item.status === "completed")) {
      if (!input.coverage) blockers.push("Coverage evidence is required to close a sprint with completed code items.");
      else {
        try { coverage = parseCoverageReport(this.dir, input.coverage); }
        catch (err) { blockers.push((err as Error).message); }
      }
    }

    // Re-run executable gates: every completed item's gates + every subsprint's gates.
    const toRun: Array<{ owner: string; gate: Gate }> = [];
    for (const item of allItems) if (item.status === "completed") for (const g of item.gates) toRun.push({ owner: item.id, gate: g });
    for (const sub of s.subsprints) for (const g of sub.gates) toRun.push({ owner: sub.id, gate: g });

    const results: GateResult[] = [];
    for (const { owner, gate } of toRun) {
      if (!isExecutable(gate)) continue;
      const r = runGate(gate, this.dir);
      results.push(r);
      if (!r.passed) blockers.push(`Gate failed for ${owner}: ${gate.spec}`);
    }

    if (blockers.length > 0) throw new StoreError("Sprint cannot close.", blockers);
    this.ledger.append({ type: "sprint_closed", gate_results: results, coverage });
    return this.requireState();
  }

  private validateDependencyAddition(
    s: SprintView,
    target: string,
    dependencies: string[],
    options: { allowNewTarget?: boolean; newTarget?: { id: string; kind: "subsprint" | "item"; label: string; status: string } } = {},
  ): void {
    const uniqueDeps = [...new Set(dependencies)];
    if (uniqueDeps.length !== dependencies.length) throw new StoreError("Duplicate dependencies are not allowed.");

    const nodes = [
      ...s.graph.nodes,
      ...(options.newTarget ? [options.newTarget] : []),
    ];
    const known = new Set(nodes.map((n) => n.id));
    if (!known.has(target) && !options.allowNewTarget) throw new StoreError(`Unknown dependency target ${target}.`);
    for (const dep of uniqueDeps) {
      if (!known.has(dep)) throw new StoreError(`Unknown dependency ${dep}.`);
      if (dep === target) throw new StoreError(`Dependency cycle: ${target} cannot depend on itself.`);
    }

    const existingEdges = new Set(s.graph.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
    for (const dep of uniqueDeps) {
      if (existingEdges.has(`${target}\u0000${dep}`)) throw new StoreError(`Dependency ${target} -> ${dep} already exists.`);
    }

    try {
      buildDependencyGraph(nodes, [...s.graph.edges, ...uniqueDeps.map((dep) => ({ from: target, to: dep }))], { throwOnCycle: true });
    } catch (err) {
      if (err instanceof GraphCycleError) throw new StoreError(err.message);
      throw err;
    }
  }
}
