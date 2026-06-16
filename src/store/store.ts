import { Ledger } from "../ledger/ledger.js";
import { SprintBook } from "../ledger/book.js";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { project, type SprintView } from "../domain/projection.js";
import { mintSubsprintId, mintItemId } from "../domain/ids.js";
import { commitNumstat, gitContext, verifyCommit } from "../git/git.js";
import { isExecutable, runGate } from "../gates/run.js";
import { searchLedger, type SearchMatch } from "../domain/search.js";
import { GraphCycleError, buildDependencyGraph } from "../domain/graph.js";
import { buildItemChangeMap, emptyChangeMap } from "../domain/change-map.js";
import { parseCoverageReport, type CoverageInput, type CoverageState, type CoverageSummary } from "../domain/coverage.js";
import { renderChangelogMarkdown } from "../domain/changelog.js";
import type { ArtifactKind, ChangelogEntry, LedgerEvent } from "../domain/events.js";
import type { Gate, GateResult } from "../domain/gates.js";

export interface CoverageNotApplicableInput {
  not_applicable: string;
}

export class StoreError extends Error {
  constructor(message: string, readonly blockers: string[] = []) {
    super(message);
    this.name = "StoreError";
  }
}

function gateKey(gate: Gate): string {
  return JSON.stringify({ kind: gate.kind, spec: gate.spec, cwd: gate.cwd ?? "" });
}

export class SprintStore {
  private readonly book: SprintBook;
  private cachedId: string | null = null;
  private cachedSignature: string | null = null;
  private cachedEvents: LedgerEvent[] | null = null;
  private cachedView: SprintView | null | undefined;
  readonly dataDir: string;

  constructor(readonly dir: string, dataDir: string = join(dir, ".sprinty")) {
    this.dataDir = dataDir;
    this.book = new SprintBook(dataDir);
  }

  // Resolves the current sprint's ledger via `.sprinty/current`. Throws if no sprint.
  private get ledger(): Ledger {
    const id = this.book.currentId();
    if (!id) throw new StoreError("No sprint. Call sprint_new first.");
    return this.book.ledger(id);
  }

  private invalidate(): void {
    this.cachedId = null;
    this.cachedSignature = null;
    this.cachedEvents = null;
    this.cachedView = undefined;
  }

  private append(event: Parameters<Ledger["append"]>[0]): LedgerEvent {
    const appended = this.ledger.append(event);
    this.invalidate();
    return appended;
  }

  private currentEvents(): LedgerEvent[] {
    const id = this.book.currentId();
    if (!id) return [];
    const signature = this.ledgerSignature(id);
    if (this.cachedId === id && this.cachedSignature === signature && this.cachedEvents) return this.cachedEvents;
    const events = this.book.ledger(id).read();
    this.cachedId = id;
    this.cachedSignature = signature;
    this.cachedEvents = events;
    this.cachedView = undefined;
    return events;
  }

  private ledgerSignature(id: string): string {
    const file = join(this.book.root, `${id}.jsonl`);
    if (!existsSync(file)) return "missing";
    const stat = statSync(file);
    return `${stat.size}:${stat.mtimeMs}`;
  }

  private state(): SprintView | null {
    const id = this.book.currentId();
    if (!id) return null;
    const signature = this.ledgerSignature(id);
    if (this.cachedId === id && this.cachedSignature === signature && this.cachedView !== undefined) return this.cachedView;
    const events = this.currentEvents();
    const view = project(events);
    this.cachedView = view;
    return view;
  }
  private requireState(): SprintView {
    const s = this.state();
    if (!s) throw new StoreError("No sprint. Call sprint_new first.");
    return s;
  }
  private requireActiveState(): SprintView {
    const s = this.requireState();
    if (s.status !== "active") throw new StoreError(`Sprint is ${s.status}. Start a new sprint before mutating it.`);
    return s;
  }

  read(): SprintView { return this.requireState(); }

  createSprint(goal: string, contextNotes: string[] = []): SprintView {
    const existing = this.state();
    if (existing && existing.status === "active") throw new StoreError("The current sprint is still open. Close it before starting a new one.");
    if (!goal.trim()) throw new StoreError("Sprint goal is required.");
    const id = this.book.allocateId();   // new ledger file id (001, 002, …)
    this.book.setCurrent(id);            // `.sprinty/current` -> id : enforces unicity
    this.invalidate();
    const { branch, worktree } = gitContext(this.dir);
    this.book.ledger(id).append({ type: "sprint_created", goal, worktree, branch, dir: this.dir, data_dir: this.dataDir, context_notes: contextNotes });
    this.invalidate();
    return this.requireState();
  }

  createSubsprint(input: { description: string; goals: string[]; gates: Gate[]; dependencies?: string[] }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    this.validateGates(input.gates);
    const id = mintSubsprintId(s.subsprints.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, id, dependencies, { allowNewTarget: true, newTarget: { id, kind: "subsprint", label: input.description, status: "open" } });
    this.append({ type: "subsprint_created", subsprint_id: id, description: input.description, goals: input.goals, gates: input.gates, spawned_from_item: null, dependencies, kind: "feature" });
    return { id, view: this.requireState() };
  }

  createSpike(input: { description: string; goals: string[]; gates: Gate[]; dependencies?: string[] }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    this.validateGates(input.gates);
    const id = mintSubsprintId(s.subsprints.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, id, dependencies, { allowNewTarget: true, newTarget: { id, kind: "subsprint", label: input.description, status: "open" } });
    this.append({ type: "subsprint_created", subsprint_id: id, description: input.description, goals: input.goals, gates: input.gates, spawned_from_item: null, dependencies, kind: "spike" });
    return { id, view: this.requireState() };
  }

  addItem(input: { subsprint: string; title?: string; description: string; code_locations: string[]; gates: Gate[]; dependencies?: string[] }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    const sub = s.subsprints.find((x) => x.id === input.subsprint);
    if (!sub) throw new StoreError(`Unknown subsprint ${input.subsprint}.`);
    if (sub.status !== "open") throw new StoreError(`Cannot add an item to ${sub.status} subsprint ${input.subsprint}.`);
    const title = normalizeOptionalTitle(input.title, input.description);
    this.validateGates(input.gates);
    const id = mintItemId(sub.id, sub.items.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, id, dependencies, { allowNewTarget: true, newTarget: { id, kind: "item", label: title, status: "open" } });
    this.append({ type: "item_added", item_id: id, subsprint_id: sub.id, title, description: input.description, code_locations: input.code_locations, gates: input.gates, dependencies });
    return { id, view: this.requireState() };
  }

  private findOpenItem(s: SprintView, itemId: string) {
    const item = s.subsprints.flatMap((x) => x.items).find((i) => i.id === itemId);
    if (!item) throw new StoreError(`Unknown item ${itemId}.`);
    if (item.status !== "open") throw new StoreError(`Item ${itemId} is already ${item.status}.`);
    return item;
  }

  updateItem(input: { target: string; note: string }): SprintView {
    const s = this.requireActiveState();
    const exists = s.subsprints.some((x) => x.id === input.target) || s.subsprints.flatMap((x) => x.items).some((i) => i.id === input.target);
    if (!exists) throw new StoreError(`Unknown target ${input.target}.`);
    this.append({ type: "item_updated", target_id: input.target, note: input.note });
    return this.requireState();
  }

  done(input: { item: string; commit_id: string; gate_results: GateResult[]; changelog: ChangelogEntry }): SprintView {
    const s = this.requireActiveState();
    const item = this.findOpenItem(s, input.item);
    if (!verifyCommit(this.dir, input.commit_id)) throw new StoreError(`Commit ${input.commit_id} not found in repo.`);
    if (!input.changelog?.line.trim()) throw new StoreError("Changelog line is required.");
    this.validateGateEvidence(item.gates, input.gate_results);
    const failed = input.gate_results.filter((g) => !g.passed);
    if (failed.length > 0) throw new StoreError(`Cannot complete ${input.item}: failing gates: ${failed.map((g) => g.spec).join(", ")}`);
    const changeMap = buildItemChangeMap(input.item, input.commit_id, commitNumstat(this.dir, input.commit_id));
    this.append({ type: "item_resolved", item_id: input.item, disposition: "completed", commit_id: input.commit_id, gate_results: input.gate_results, spawned_subsprint: null, reason: null, changelog: input.changelog, change_map: changeMap });
    return this.requireState();
  }

  private validateGateEvidence(gates: Gate[], results: GateResult[]): void {
    const key = (g: Gate | GateResult) => `${g.kind}\u0000${g.spec}\u0000${g.cwd ?? ""}`;
    const expected = new Map(gates.map((g) => [key(g), g]));
    const seen = new Set<string>();
    const unexpected: GateResult[] = [];

    for (const result of results) {
      if (result.supersedes && !result.supersession_reason?.trim()) {
        throw new StoreError("Gate supersession requires a reason.");
      }
      const resultKey = result.supersedes ? key(result.supersedes) : key(result);
      if (!expected.has(resultKey)) {
        unexpected.push(result);
        continue;
      }
      if (seen.has(resultKey)) throw new StoreError(`Duplicate gate evidence: ${result.kind}:${result.spec}`);
      seen.add(resultKey);
    }

    const missing = gates.filter((g) => !seen.has(key(g)));
    if (missing.length > 0) {
      throw new StoreError(`Missing gate evidence: ${missing.map((g) => `${g.kind}:${g.spec}`).join(", ")}`);
    }
    if (unexpected.length > 0) {
      throw new StoreError(`Unexpected gate evidence: ${unexpected.map((g) => `${g.kind}:${g.spec}`).join(", ")}`);
    }
  }

  split(input: { item: string; description: string; goals: string[]; gates: Gate[]; dependencies?: string[] }): SprintView {
    const s = this.requireActiveState();
    this.findOpenItem(s, input.item);
    this.validateGates(input.gates);
    const newId = mintSubsprintId(s.subsprints.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, newId, dependencies, { allowNewTarget: true, newTarget: { id: newId, kind: "subsprint", label: input.description, status: "open" } });
    this.append({ type: "item_resolved", item_id: input.item, disposition: "split", commit_id: null, gate_results: [], spawned_subsprint: newId, reason: null, changelog: null, change_map: emptyChangeMap() });
    this.append({ type: "subsprint_created", subsprint_id: newId, description: input.description, goals: input.goals, gates: input.gates, spawned_from_item: input.item, dependencies, kind: "feature" });
    return this.requireState();
  }

  deprecate(input: { item: string; reason: string }): SprintView {
    const s = this.requireActiveState();
    this.findOpenItem(s, input.item);
    if (!input.reason.trim()) throw new StoreError("Deprecation requires a reason.");
    this.append({ type: "item_resolved", item_id: input.item, disposition: "deprecated", commit_id: null, gate_results: [], spawned_subsprint: null, reason: input.reason, changelog: null, change_map: emptyChangeMap() });
    return this.requireState();
  }

  addDependencies(input: { target: string; dependencies: string[] }): SprintView {
    const s = this.requireActiveState();
    this.validateDependencyAddition(s, input.target, input.dependencies);
    this.append({ type: "dependencies_added", target_id: input.target, dependencies: input.dependencies });
    return this.requireState();
  }

  addNote(input: { element: string; text: string }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    const item = s.subsprints.flatMap((x) => x.items).find((i) => i.id === input.element);
    if (!item) {
      const subsprint = s.subsprints.find((x) => x.id === input.element);
      if (subsprint) throw new StoreError(`Notes must attach to a specific item, not subsprint ${input.element}. Add one or more atomic items with item_add() for trackable work, then attach notes to the relevant item id.`);
      throw new StoreError(`Unknown item ${input.element}. Notes must attach to a specific item id.`);
    }
    const event = this.append({ type: "note_added", element_id: input.element, text: input.text });
    return { id: noteId(event.seq), view: this.requireState() };
  }

  addArtifact(input: { target?: string | undefined; kind: ArtifactKind; title: string; uri: string; description?: string | null | undefined; related_items?: string[] | undefined }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    const target = input.target ?? "sprint";
    this.assertKnownTarget(s, target, "artifact target");
    const id = `A${String(s.artifacts.length + 1).padStart(3, "0")}`;
    this.append({
      type: "artifact_added",
      artifact_id: id,
      target_id: target,
      kind: input.kind,
      title: input.title,
      uri: input.uri,
      description: input.description ?? null,
      related_items: input.related_items ?? [],
    });
    return { id, view: this.requireState() };
  }

  listArtifacts(input: { target?: string | undefined; include_deprecated?: boolean | undefined } = {}): { artifacts: SprintView["artifacts"] } {
    const s = this.requireState();
    if (input.target) this.assertKnownTarget(s, input.target, "artifact target");
    const artifacts = s.artifacts.filter((artifact) =>
      (!input.target || artifact.target_id === input.target) &&
      (input.include_deprecated || artifact.status === "active"));
    return { artifacts };
  }

  amendArtifact(input: { artifact: string; kind?: ArtifactKind | undefined; title?: string | undefined; uri?: string | undefined; description?: string | null | undefined; related_items?: string[] | undefined }): SprintView {
    const s = this.requireActiveState();
    const artifact = s.artifacts.find((a) => a.id === input.artifact);
    if (!artifact) throw new StoreError(`Unknown artifact ${input.artifact}.`);
    if (artifact.status === "deprecated") throw new StoreError(`Artifact ${input.artifact} is deprecated.`);
    if (!input.kind && !input.title && !input.uri && !("description" in input) && !input.related_items) throw new StoreError("Artifact amendment requires at least one changed field.");
    const event: { type: "artifact_amended"; artifact_id: string; kind?: ArtifactKind; title?: string; uri?: string; description?: string | null; related_items?: string[] } = {
      type: "artifact_amended",
      artifact_id: input.artifact,
    };
    if (input.kind) event.kind = input.kind;
    if (input.title) event.title = input.title;
    if (input.uri) event.uri = input.uri;
    if ("description" in input) event.description = input.description ?? null;
    if (input.related_items) event.related_items = input.related_items;
    this.append(event);
    return this.requireState();
  }

  deprecateArtifact(input: { artifact: string; reason: string }): SprintView {
    const s = this.requireActiveState();
    const artifact = s.artifacts.find((a) => a.id === input.artifact);
    if (!artifact) throw new StoreError(`Unknown artifact ${input.artifact}.`);
    if (artifact.status === "deprecated") throw new StoreError(`Artifact ${input.artifact} is already deprecated.`);
    if (!input.reason.trim()) throw new StoreError("Artifact deprecation requires a reason.");
    this.append({ type: "artifact_deprecated", artifact_id: input.artifact, reason: input.reason });
    return this.requireState();
  }

  addFollowUp(input: { target?: string | undefined; description: string; bug_id?: string | undefined; bug_ids?: string[] | undefined }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    const target = input.target ?? "sprint";
    this.assertKnownTarget(s, target, "follow-up target");
    const bugIds = [...new Set([...(input.bug_ids ?? []), ...(input.bug_id ? [input.bug_id] : [])].map((bug) => bug.trim()).filter(Boolean))];
    if (bugIds.length === 0) throw new StoreError("Follow-up requires bug_id or bug_ids.");
    const id = `F${String(s.follow_ups.length + 1).padStart(3, "0")}`;
    this.append({ type: "follow_up_added", follow_up_id: id, target_id: target, description: input.description, bug_ids: bugIds });
    return { id, view: this.requireState() };
  }

  concludeSpike(input: { subsprint: string; conclusion: string }): SprintView {
    const s = this.requireActiveState();
    const sub = s.subsprints.find((x) => x.id === input.subsprint);
    if (!sub) throw new StoreError(`Unknown subsprint ${input.subsprint}.`);
    if (sub.kind !== "spike") throw new StoreError(`Subsprint ${input.subsprint} is not a spike.`);
    if (sub.status === "deprecated") throw new StoreError(`Spike ${input.subsprint} is deprecated.`);
    if (sub.status === "closed") throw new StoreError(`Spike ${input.subsprint} is already concluded.`);
    if (sub.items.some((item) => item.status === "open")) throw new StoreError(`Spike ${input.subsprint} still has open items.`);
    if (!input.conclusion.trim()) throw new StoreError("Spike conclusion is required.");
    this.append({ type: "spike_concluded", subsprint_id: input.subsprint, conclusion: input.conclusion });
    return this.requireState();
  }

  deprecateSpike(input: { subsprint: string; reason: string }): SprintView {
    const s = this.requireActiveState();
    const sub = s.subsprints.find((x) => x.id === input.subsprint);
    if (!sub) throw new StoreError(`Unknown subsprint ${input.subsprint}.`);
    if (sub.kind !== "spike") throw new StoreError(`Subsprint ${input.subsprint} is not a spike.`);
    if (sub.status === "deprecated") throw new StoreError(`Spike ${input.subsprint} is already deprecated.`);
    if (sub.status === "closed") throw new StoreError(`Spike ${input.subsprint} is already concluded.`);
    if (!input.reason.trim()) throw new StoreError("Spike deprecation requires a reason.");
    for (const item of sub.items.filter((child) => child.status === "open")) {
      this.append({
        type: "item_resolved",
        item_id: item.id,
        disposition: "deprecated",
        commit_id: null,
        gate_results: [],
        spawned_subsprint: null,
        reason: `Spike ${input.subsprint} deprecated: ${input.reason}`,
        changelog: null,
        change_map: emptyChangeMap(),
      });
    }
    this.append({ type: "spike_deprecated", subsprint_id: input.subsprint, reason: input.reason });
    return this.requireState();
  }

  search(pattern: string, contextSize: number): SearchMatch[] {
    return searchLedger(this.currentEvents(), pattern, contextSize);
  }

  listNotes(itemId: string): Array<{ id: string; item: string; text: string }> {
    return this.listAllNotes().filter((note) => note.item === itemId);
  }

  listAllNotes(): Array<{ id: string; item: string; text: string }> {
    return noteRecords(this.currentEvents());
  }

  getNote(id: string): { id: string; item: string; text: string } {
    const note = noteRecords(this.currentEvents()).find((candidate) => candidate.id === id);
    if (!note) throw new StoreError(`Unknown note ${id}.`);
    return note;
  }

  updateNote(input: { id: string; text: string }): { id: string; item: string; text: string } {
    this.requireActiveState();
    this.getNote(input.id);
    this.append({ type: "note_updated", note_id: input.id, text: input.text });
    return this.getNote(input.id);
  }

  changelog(): string {
    return renderChangelogMarkdown(this.requireState());
  }

  closeSprint(input: { coverage?: CoverageInput | CoverageNotApplicableInput | undefined } = {}): SprintView {
    const s = this.requireState();
    if (s.status !== "active") throw new StoreError(`Sprint is already ${s.status}.`);
    const blockers: string[] = [];
    const allItems = s.subsprints.flatMap((x) => x.items);
    let coverage: CoverageSummary | null = null;
    let coverageState: CoverageState = { status: "not_configured" };
    const hasCompletedItems = allItems.some((item) => item.status === "completed");

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
    for (const sub of s.subsprints) {
      if (sub.kind === "spike" && sub.status === "open") blockers.push(`Spike ${sub.id} is unresolved and requires a conclusion; use spike_conclude or deprecate it with spike_deprecate.`);
      if (sub.kind === "spike" && sub.status === "closed" && !sub.spike_conclusion) blockers.push(`Spike ${sub.id} closed without a conclusion.`);
    }

    if (hasCompletedItems) {
      if (!input.coverage) blockers.push("Coverage evidence is required to close a sprint with completed code items.");
      else if ("not_applicable" in input.coverage) {
        if (!input.coverage.not_applicable.trim()) blockers.push("Coverage not-applicable reason is required.");
        else coverageState = { status: "not_applicable", reason: input.coverage.not_applicable };
      } else {
        try {
          coverage = parseCoverageReport(this.dir, input.coverage);
          coverageState = { status: "reported", summary: coverage };
        }
        catch (err) { blockers.push((err as Error).message); }
      }
    } else if (input.coverage) {
      if ("not_applicable" in input.coverage) {
        if (!input.coverage.not_applicable.trim()) blockers.push("Coverage not-applicable reason is required.");
        else coverageState = { status: "not_applicable", reason: input.coverage.not_applicable };
      } else {
        try {
          coverage = parseCoverageReport(this.dir, input.coverage);
          coverageState = { status: "reported", summary: coverage };
        }
        catch (err) { blockers.push((err as Error).message); }
      }
    } else {
      coverageState = { status: "not_applicable", reason: "No completed code items required coverage evidence." };
    }

    // Re-run executable gates: every completed item's gates + every subsprint's gates.
    const toRun = new Map<string, { owners: string[]; gate: Gate }>();
    const queueGate = (owner: string, gate: Gate): void => {
      if (!isExecutable(gate)) return;
      const key = gateKey(gate);
      const existing = toRun.get(key);
      if (existing) existing.owners.push(owner);
      else toRun.set(key, { owners: [owner], gate });
    };
    for (const item of allItems) if (item.status === "completed") for (const g of item.gates) queueGate(item.id, g);
    for (const sub of s.subsprints) for (const g of sub.gates) queueGate(sub.id, g);

    const results: GateResult[] = [];
    for (const { owners, gate } of toRun.values()) {
      const r = runGate(gate, this.dir);
      results.push(r);
      if (!r.passed) blockers.push(`Gate failed for ${owners.join(", ")}: ${gate.spec}`);
    }

    if (blockers.length > 0) throw new StoreError("Sprint cannot close.", blockers);
    this.append({ type: "sprint_closed", gate_results: results, coverage, coverage_state: coverageState });
    return this.requireState();
  }

  archiveSprint(input: { reason: string }): SprintView {
    this.requireActiveState();
    if (!input.reason.trim()) throw new StoreError("Archive requires a reason.");
    this.append({ type: "sprint_archived", reason: input.reason });
    return this.requireState();
  }

  private validateGates(gates: Gate[]): void {
    for (const gate of gates) {
      if (gate.kind === "command" && looksLikeProse(gate.spec)) {
        throw new StoreError(`Command gate looks like prose. Use a manual gate or provide a shell command: ${gate.spec}`);
      }
    }
  }

  private assertKnownTarget(s: SprintView, target: string, label: string): void {
    const exists = target === "sprint" || s.subsprints.some((x) => x.id === target) || s.subsprints.flatMap((x) => x.items).some((i) => i.id === target);
    if (!exists) throw new StoreError(`Unknown ${label} ${target}.`);
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

function looksLikeProse(spec: string): boolean {
  const trimmed = spec.trim();
  if (!trimmed) return false;
  if (/[;&|<>()$`*?\[\]{}]/.test(trimmed) || trimmed.includes("./") || trimmed.includes("../") || trimmed.startsWith("/")) return false;
  const first = trimmed.split(/\s+/)[0]!;
  const commandWords = new Set([
    "awk", "bash", "bun", "cargo", "cat", "cd", "cp", "curl", "deno", "echo", "false", "find", "git", "go",
    "ls", "make", "mkdir", "mv", "node", "npm", "npx", "pnpm", "python", "python3", "pytest", "rg", "rm",
    "sed", "sh", "true", "tsc", "uv", "vitest", "yarn",
  ]);
  if (commandWords.has(first)) return false;
  const words = trimmed.split(/\s+/);
  return words.length >= 3 && words.every((word) => /^[A-Za-z][A-Za-z'-]*[.,:]?$/.test(word));
}

function normalizeOptionalTitle(title: string | undefined, description: string): string {
  const candidate = title?.trim() || description.trim().split(/\r?\n/, 1)[0] || "Untitled item";
  return candidate.length > 80 ? `${candidate.slice(0, 77).trimEnd()}...` : candidate;
}

function noteId(seq: number): string {
  return `N${String(seq).padStart(3, "0")}`;
}

function noteRecords(events: LedgerEvent[]): Array<{ id: string; item: string; text: string }> {
  const records = new Map<string, { id: string; item: string; text: string }>();
  for (const event of events) {
    if (event.type === "note_added") {
      const id = noteId(event.seq);
      records.set(id, { id, item: event.element_id, text: event.text });
    }
    if (event.type === "note_updated") {
      const existing = records.get(event.note_id);
      if (existing) records.set(event.note_id, { ...existing, text: event.text });
    }
  }
  return [...records.values()];
}
