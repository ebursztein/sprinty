import type { Ledger } from "../ledger/ledger.js";
import { SprintBook } from "../ledger/book.js";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { actors, newIdentity, tokenHash, type Actor } from "../domain/agents.js";
import { ACTIVITY_WINDOW_MS, INACTIVE_STALL_MS } from "../domain/collaboration.js";
import { withDataLock, canonicalDirectory, type FileWrite } from "../ledger/transaction.js";
import { LedgerEvent as EventSchema } from "../domain/events.js";
import { runGateAsync } from "../gates/run.js";
import { join } from "node:path";
import { project, refreshTiming, type SprintView } from "../domain/projection.js";
import { mintSubsprintId, mintItemId, mintNoteId, legacyNoteId } from "../domain/ids.js";
import { commitNumstat, gitContext, verifyCommit } from "../git/git.js";
import { DEFAULT_GATE_TIMEOUT_MS, runGate } from "../gates/run.js";
import { GateEvidenceError, ITEM_GATE_TIMEOUT_MS, gateKey, isExecutable, looksLikeProse, slowGateWarning, specIsNoOp, validateGateEvidence } from "../gates/policy.js";
import { searchLedger, type SearchMatch } from "../domain/search.js";
import { GraphCycleError, buildDependencyGraph } from "../domain/graph.js";
import { buildItemChangeMap, emptyChangeMap } from "../domain/change-map.js";
import { parseCoverageReport, type CoverageInput, type CoverageState, type CoverageSummary } from "../domain/coverage.js";
import { renderChangelogMarkdown } from "../domain/changelog.js";
import { NOTE_PER_ITEM_MAX, OPEN_ITEMS_WITH_NOTES_MAX, notePressure, validateNoteText } from "../domain/note-policy.js";
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

export class SprintStore {
  private readonly book: SprintBook;
  private cachedId: string | null = null;
  private cachedSignature: string | null = null;
  private cachedEvents: LedgerEvent[] | null = null;
  private cachedView: SprintView | null | undefined;
  readonly dataDir: string;
  private pinnedId: string | null = null;
  private transactionEvents: LedgerEvent[] | null = null;
  private transactionWrites: FileWrite[] = [];
  private executedGates: Map<string, GateResult> | null = null;
  private clock: () => number;
  private cachedNow: number | null = null;


  constructor(readonly dir: string, dataDir: string = join(dir, ".sprinty"), clock: () => number = Date.now) {
    this.clock = clock;
    this.dataDir = canonicalDirectory(dataDir);
    this.book = new SprintBook(this.dataDir);
    this.pinnedId = withDataLock(this.dataDir, () => this.book.currentId());
    const mutations = ["createSprint", "createSubsprint", "addItem", "updateItem", "done", "split", "deprecate", "addDependencies", "addNote", "addArtifact", "amendArtifact", "deprecateArtifact", "addFollowUp", "updateNote", "closeSprint", "archiveSprint", "attachAgent", "detachAgent", "claimItem", "releaseItem", "progressItem"] as const;
    for (const name of mutations) {
      const method = this[name];
      Reflect.set(this, name, (...args: unknown[]) => this.mutate(() => Reflect.apply(method, this, args)));
    }
  }

  get sprintId(): string | null { return this.pinnedId; }

  private invalidate(): void {
    this.cachedId = null;
    this.cachedSignature = null;
    this.cachedEvents = null;
    this.cachedView = undefined;
  }

  private append(event: Parameters<Ledger["append"]>[0]): LedgerEvent {
    if (!this.transactionEvents) throw new StoreError("Mutation requires a transaction.");
    const actor = actors.getStore();
    const appended = EventSchema.parse({ ...event, ...(actor ? { agent_id: actor.id } : {}), seq: this.transactionEvents.length, ts: new Date(this.clock()).toISOString() });
    this.transactionEvents.push(appended);
    this.invalidate();
    return appended;
  }

  private currentEvents(): LedgerEvent[] {
    if (this.transactionEvents) return this.transactionEvents;
    const id = this.pinnedId;
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
    const events = this.currentEvents();
    const now = this.clock();
    if (this.cachedView === undefined) { this.cachedView = project(events, now); this.cachedNow = now; }
    else if (this.cachedView && now !== this.cachedNow) { refreshTiming(this.cachedView, events, now); this.cachedNow = now; }
    return this.cachedView;
  }
  private mutate<T>(run: () => T): T {
    if (this.transactionEvents) return run();
    return withDataLock(this.dataDir, () => {
      const previousId = this.pinnedId;
      this.invalidate();
      const base = previousId ? this.book.ledger(previousId).read() : [];
      this.transactionEvents = [...base];
      this.transactionWrites = [];
      try {
        const result = run();
        if (!this.pinnedId) throw new StoreError("No sprint is attached.");
        const start = this.pinnedId === previousId ? base.length : 0;
        this.book.ledger(this.pinnedId).commit(this.transactionEvents.slice(start), this.transactionWrites);
        return result;
      } catch (error) { this.pinnedId = previousId; throw error; }
      finally { this.transactionEvents = null; this.transactionWrites = []; this.invalidate(); }
    });
  }
  private requireState(): SprintView {
    const s = this.state();
    if (!s) throw new StoreError("No sprint. Call sprint_new first.");
    const binding = this.currentEvents().find(e => e.type === "agent_attached" && e.git_dir);
    if (binding?.type === "agent_attached" && binding.git_dir !== canonicalDirectory(this.dir)) throw new StoreError("This sprint belongs to a different canonical worktree.");
    return s;
  }
  private requireActiveState(): SprintView {
    const s = this.requireState();
    if (s.status !== "active") throw new StoreError(`Sprint is ${s.status}. Start a new sprint before mutating it.`);
    return s;
  }

  read(): SprintView { return withDataLock(this.dataDir, () => this.requireState()); }

  createSprint(goal: string, contextNotes: string[] = []): SprintView {
    const current = this.book.currentId();
    const existing = current ? project(this.book.ledger(current).read()) : null;
    if (existing && existing.status === "active") throw new StoreError("The current sprint is still open. Close it before starting a new one.");
    if (!goal.trim()) throw new StoreError("Sprint goal is required.");
    const id = this.book.allocateId();   // new ledger file id (001, 002, …)
    this.pinnedId = id;
    this.transactionEvents = [];
    this.transactionWrites.push({ name: "current", contents: id + "\n" });
    this.invalidate();
    const { branch, worktree } = gitContext(this.dir);
    this.append({ type: "sprint_created", goal, worktree, branch, dir: this.dir, data_dir: this.dataDir, context_notes: contextNotes });
    this.invalidate();
    return this.requireState();
  }

  createSubsprint(input: { description: string; goals: string[]; gates: Gate[]; dependencies?: string[] }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    this.validateGates(input.gates);
    const id = mintSubsprintId(s.subsprints.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, id, dependencies, { allowNewTarget: true, newTarget: { id, kind: "subsprint", label: input.description, status: "open" } });
    this.append({ type: "subsprint_created", subsprint_id: id, description: input.description, goals: input.goals, gates: input.gates, spawned_from_item: null, dependencies });
    return { id, view: this.requireState() };
  }

  addItem(input: { subsprint: string; title?: string; description: string; high_priority?: boolean; code_locations: string[]; gates: Gate[]; gate_timeout_ms?: number | null | undefined; dependencies?: string[] }): { id: string; view: SprintView } {
    const s = this.requireActiveState();
    const sub = s.subsprints.find((x) => x.id === input.subsprint);
    if (!sub) throw new StoreError(`Unknown subsprint ${input.subsprint}.`);
    if (sub.status !== "open") throw new StoreError(`Cannot add an item to ${sub.status} subsprint ${input.subsprint}.`);
    const title = normalizeOptionalTitle(input.title, input.description);
    this.validateGates(input.gates);
    const id = mintItemId(sub.id, sub.items.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, id, dependencies, { allowNewTarget: true, newTarget: { id, kind: "item", label: title, status: "open" } });
    const gateTimeoutMs = input.gate_timeout_ms === undefined ? ITEM_GATE_TIMEOUT_MS : input.gate_timeout_ms;
    this.append({ type: "item_added", item_id: id, subsprint_id: sub.id, title, description: input.description, high_priority: input.high_priority ?? false, code_locations: input.code_locations, gates: input.gates, gate_timeout_ms: gateTimeoutMs, dependencies });
    return { id, view: this.requireState() };
  }

  private findOpenItem(s: SprintView, itemId: string) {
    const item = s.subsprints.flatMap((x) => x.items).find((i) => i.id === itemId);
    if (!item) throw new StoreError(`Unknown item ${itemId}.`);
    if (item.status !== "open") throw new StoreError(`Item ${itemId} is already ${item.status}.`);
    return item;
  }

  updateItem(input: { target: string; note?: string | undefined; title?: string | undefined; description?: string | undefined; high_priority?: boolean | undefined; gates?: Gate[] | undefined; gate_timeout_ms?: number | null | undefined; commit_id?: string | undefined; dependencies?: string[] | undefined }): SprintView {
    const s = this.requireActiveState();
    const updatesExecution = input.gates !== undefined || input.gate_timeout_ms !== undefined;
    const updatesCommit = input.commit_id !== undefined;
    if (!input.note?.trim() && !input.title?.trim() && !input.description?.trim() && input.high_priority === undefined && !updatesExecution && !updatesCommit && input.dependencies === undefined) {
      throw new StoreError("Item update requires a note, title, description, high_priority, gates, gate_timeout_ms, commit_id, or dependencies.");
    }
    const item = s.subsprints.flatMap((x) => x.items).find((i) => i.id === input.target);
    if (!item) {
      const sub = s.subsprints.find((x) => x.id === input.target);
      if (sub) throw new StoreError(`Item metadata can only be set on items, not subsprint ${input.target}.`);
      if (input.dependencies !== undefined && !input.note?.trim() && !input.title?.trim() && !input.description?.trim() && input.high_priority === undefined && !updatesExecution && !updatesCommit) {
        throw new StoreError(`Unknown dependency target ${input.target}.`);
      }
      throw new StoreError(`Unknown item ${input.target}.`);
    }
    this.requireOwner(input.target);
    if (updatesExecution && item.status !== "open" && item.status !== "completed") {
      throw new StoreError(`Cannot change gates or gate timeout on ${item.status} item ${input.target}.`);
    }
    if (item.status === "completed" && input.gates?.some((gate) => !isExecutable(gate))) {
      throw new StoreError(`Completed item ${input.target} can only replace gates with executable gates; manual evidence cannot be added after completion.`);
    }
    if (updatesCommit && item.status !== "completed") throw new StoreError(`Cannot change commit_id on ${item.status} item ${input.target}; complete it first.`);
    if (input.commit_id && !verifyCommit(this.dir, input.commit_id)) throw new StoreError(`Commit ${input.commit_id} not found in repo.`);
    const replacementChangeMap = input.commit_id
      ? buildItemChangeMap(input.target, input.commit_id, commitNumstat(this.dir, input.commit_id))
      : undefined;
    if (input.gates !== undefined) this.validateGates(input.gates);
    if (input.dependencies !== undefined) this.validateDependencyReplacement(s, input.target, input.dependencies);
    if (input.note?.trim() || input.title?.trim() || input.description?.trim() || input.high_priority !== undefined || updatesExecution || updatesCommit) {
      this.append({
        type: "item_updated",
        target_id: input.target,
        ...(input.note?.trim() ? { note: input.note } : {}),
        ...(input.title?.trim() ? { title: input.title } : {}),
        ...(input.description?.trim() ? { description: input.description } : {}),
        ...(input.high_priority === undefined ? {} : { high_priority: input.high_priority }),
        ...(input.gates === undefined ? {} : { gates: input.gates }),
        ...(input.gate_timeout_ms === undefined ? {} : { gate_timeout_ms: input.gate_timeout_ms }),
        ...(input.commit_id === undefined ? {} : { commit_id: input.commit_id, change_map: replacementChangeMap! }),
      });
    }
    if (input.dependencies !== undefined) {
      this.append({ type: "dependencies_replaced", target_id: input.target, dependencies: input.dependencies });
    }
    return this.requireState();
  }

  /**
   * Sprinty runs the item's executable gates itself; the agent no longer supplies their results.
   * Manual gates cannot be executed, so those still arrive as agent evidence. A gate that blows
   * the inline budget is recorded unverified and does not block completion - sprint_close runs it
   * for real under the full timeout. Returns the warning the caller should surface, if any.
   */
  done(input: { item: string; commit_id: string; gate_results?: GateResult[] | undefined; changelog: ChangelogEntry }): { view: SprintView; warning: string | null } {
    const s = this.requireActiveState();
    const item = this.findOpenItem(s, input.item);
    this.requireOwner(input.item);
    if (!verifyCommit(this.dir, input.commit_id)) throw new StoreError(`Commit ${input.commit_id} not found in repo.`);
    if (!input.changelog?.line.trim()) throw new StoreError("Changelog line is required.");

    const executed = item.gates.filter(isExecutable).map((gate) => this.executeGate(gate, item.gate_timeout_ms));
    const manualGates = item.gates.filter((gate) => !isExecutable(gate));
    const manualResults = (input.gate_results ?? []).filter((result) => !isExecutable(result));
    this.validateGateEvidence(manualGates, manualResults);

    const results = [...executed, ...manualResults];
    // A timeout proves nothing either way, so it must not be treated as a failure.
    const failed = results.filter((result) => !result.passed && !result.timed_out);
    if (failed.length > 0) throw new StoreError(`Cannot complete ${input.item}: failing gates: ${failed.map((g) => g.spec).join(", ")}`);

    const changeMap = buildItemChangeMap(input.item, input.commit_id, commitNumstat(this.dir, input.commit_id));
    this.append({ type: "item_resolved", item_id: input.item, disposition: "completed", commit_id: input.commit_id, gate_results: results, spawned_subsprint: null, reason: null, changelog: input.changelog, change_map: changeMap });
    return { view: this.requireState(), warning: slowGateWarning(results, item.gate_timeout_ms) };
  }

  private validateGateEvidence(gates: Gate[], results: GateResult[]): void {
    try {
      validateGateEvidence(gates, results);
    } catch (err) {
      if (err instanceof GateEvidenceError) throw new StoreError(err.message);
      throw err;
    }
  }

  split(input: { item: string; description: string; goals: string[]; gates: Gate[]; dependencies?: string[] }): SprintView {
    const s = this.requireActiveState();
    this.findOpenItem(s, input.item);
    this.requireOwner(input.item);
    this.validateGates(input.gates);
    const newId = mintSubsprintId(s.subsprints.length);
    const dependencies = input.dependencies ?? [];
    this.validateDependencyAddition(s, newId, dependencies, { allowNewTarget: true, newTarget: { id: newId, kind: "subsprint", label: input.description, status: "open" } });
    this.append({ type: "item_resolved", item_id: input.item, disposition: "split", commit_id: null, gate_results: [], spawned_subsprint: newId, reason: null, changelog: null, change_map: emptyChangeMap() });
    this.append({ type: "subsprint_created", subsprint_id: newId, description: input.description, goals: input.goals, gates: input.gates, spawned_from_item: input.item, dependencies });
    return this.requireState();
  }

  // `target` is an item id or a subsprint id; deprecating a subsprint cascades to its open items.
  deprecate(input: { target: string; reason: string }): SprintView {
    const s = this.requireActiveState();
    const sub = s.subsprints.find((x) => x.id === input.target);
    if (sub) return this.deprecateSubsprint(sub, input.reason);
    this.findOpenItem(s, input.target);
    this.requireOwner(input.target);
    if (!input.reason.trim()) throw new StoreError("Deprecation requires a reason.");
    this.append({ type: "item_resolved", item_id: input.target, disposition: "deprecated", commit_id: null, gate_results: [], spawned_subsprint: null, reason: input.reason, changelog: null, change_map: emptyChangeMap() });
    return this.requireState();
  }

  private deprecateSubsprint(sub: SprintView["subsprints"][number], reason: string): SprintView {
    if (sub.status === "deprecated") throw new StoreError(`Subsprint ${sub.id} is already deprecated.`);
    if (sub.status === "closed") throw new StoreError(`Subsprint ${sub.id} is already closed.`);
    if (!reason.trim()) throw new StoreError("Subsprint deprecation requires a reason.");
    for (const item of sub.items.filter((child) => child.status === "open")) this.requireOwner(item.id);
    for (const item of sub.items.filter((child) => child.status === "open")) {
      this.append({
        type: "item_resolved",
        item_id: item.id,
        disposition: "deprecated",
        commit_id: null,
        gate_results: [],
        spawned_subsprint: null,
        reason: `Subsprint ${sub.id} deprecated: ${reason}`,
        changelog: null,
        change_map: emptyChangeMap(),
      });
    }
    this.append({ type: "subsprint_deprecated", subsprint_id: sub.id, reason });
    return this.requireState();
  }

  addDependencies(input: { target: string; dependencies: string[] }): SprintView {
    const s = this.requireActiveState();
    this.requireOwner(input.target);
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
    this.validateNoteAdd(s, item, input.text);
    const id = mintNoteId();
    this.append({ type: "note_added", element_id: input.element, text: input.text, note_id: id });
    return { id, view: this.requireState() };
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
    const textError = validateNoteText(input.text);
    if (textError) throw new StoreError(textError);
    this.append({ type: "note_updated", note_id: input.id, text: input.text });
    return this.getNote(input.id);
  }

  changelog(): string {
    return renderChangelogMarkdown(this.requireState());
  }

  closeSprint(input: { coverage?: CoverageInput | CoverageNotApplicableInput | undefined; force?: boolean | undefined } = {}): SprintView {
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
        const manualGates = item.gates.filter((gate) => !isExecutable(gate));
        const manualKeys = new Set(manualGates.map(gateKey));
        const manualResults = item.gate_results.filter((result) => manualKeys.has(gateKey(result.supersedes ?? result)));
        try { this.validateGateEvidence(manualGates, manualResults); }
        catch (err) { blockers.push(`Item ${item.id}: ${(err as Error).message}`); }
      }
    }
    for (const sub of s.subsprints) {
      // A subsprint that never got items stays open forever; its items cannot report it as a blocker.
      if (sub.status === "open" && sub.items.length === 0) {
        blockers.push(`Subsprint ${sub.id} has no items and is unresolved. Add items with item_add(), or drop it with item_deprecate({ id: "${sub.id}", reason }).`);
      }
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
    const toRun = new Map<string, { owners: string[]; gate: Gate; timeoutMs: number | null }>();
    const queueGate = (owner: string, gate: Gate, timeoutMs: number | null): void => {
      if (!isExecutable(gate)) return;
      const key = gateKey(gate);
      const existing = toRun.get(key);
      if (existing) {
        existing.owners.push(owner);
        existing.timeoutMs = existing.timeoutMs === null || timeoutMs === null
          ? null
          : Math.max(existing.timeoutMs, timeoutMs);
      } else toRun.set(key, { owners: [owner], gate, timeoutMs });
    };
    for (const item of allItems) if (item.status === "completed") for (const g of item.gates) queueGate(item.id, g, item.gate_timeout_ms);
    for (const sub of s.subsprints) for (const g of sub.gates) queueGate(sub.id, g, DEFAULT_GATE_TIMEOUT_MS);

    const results: GateResult[] = [];
    for (const { owners, gate, timeoutMs } of toRun.values()) {
      const r = this.executeGate(gate, timeoutMs);
      results.push(r);
      if (!r.passed && !input.force) blockers.push(`Gate failed for ${owners.join(", ")}: ${gate.spec}`);
    }

    if (blockers.length > 0) throw new StoreError("Sprint cannot close.", blockers);
    mkdirSync(this.dataDir, { recursive: true });
    this.transactionWrites.push({ name: "CHANGELOG.md", contents: renderChangelogMarkdown({
      ...s,
      status: "closed",
      coverage,
      coverage_state: coverageState,
    }) });
    this.append({ type: "sprint_closed", gate_results: results, forced: input.force ?? false, coverage, coverage_state: coverageState });
    return this.requireState();
  }

  archiveSprint(input: { reason: string }): SprintView {
    this.requireActiveState();
    if (!input.reason.trim()) throw new StoreError("Archive requires a reason.");
    this.append({ type: "sprint_archived", reason: input.reason });
    return this.requireState();
  }

  attachAgent(token?: string, preferred?: { actor: Actor; token: string }): { actor: Actor; token: string } {
    this.requireState();
    if (token) {
      const event = this.currentEvents().find(e => e.type === "agent_attached" && e.token_hash === tokenHash(token));
      if (!event || event.type !== "agent_attached" || !this.read().agents.find(a => a.id === event.id)?.attached) throw new StoreError("Unknown or detached agent token.");
      this.append({ type: "agent_activity", id: event.id, agent_id: event.id });
      return { actor: { id: event.id, name: event.name, generations: new Map(this.read().subsprints.flatMap(s => s.items).filter(i => (i.claim.owner ?? i.claim.history.at(-1)?.owner) === event.id).map(i => [i.id, i.claim.generation])) }, token };
    }
    const names = this.read().agents.map(a => a.name);
    const identity = preferred && !names.includes(preferred.actor.name) ? { token: preferred.token, actor: { ...preferred.actor, generations: new Map<string, number>() } } : newIdentity(names);
    this.append({ type: "agent_attached", id: identity.actor.id, name: identity.actor.name, token_hash: tokenHash(identity.token), git_dir: canonicalDirectory(this.dir) });
    return identity;
  }

  private requireActor(): Actor {
    const actor = actors.getStore();
    if (!actor || !this.requireState().agents.find(a => a.id === actor.id)?.attached) throw new StoreError("Attach an agent first.");
    return actor;
  }
  private requireOwner(id: string): void {
    const actor = actors.getStore();
    const s = this.requireState();
    // Direct, unattributed legacy store callers remain supported until sessions exist.
    if (!actor && !s.agents.length) return;
    this.requireActor();
    const item = s.subsprints.flatMap(sub => sub.items).find(i => i.id === id);
    if (!item) throw new StoreError(`Unknown item ${id}.`);
    const owner = item.status === "open" ? item.claim.owner : item.claim.history.at(-1)?.owner;
    if (owner !== actor!.id || actor!.generations.get(id) !== item.claim.generation) throw new StoreError(`Claim ${id} with item_claim first; current owner: ${item.claim.owner_name ?? "unclaimed"}.`);
  }
  activity(): void {
    const actor = actors.getStore();
    if (!actor) throw new StoreError("Attach an agent first.");
    const needsHeartbeat = () => {
      const events = this.currentEvents();
      const attached = events.find(e => e.type === "agent_attached" && e.id === actor.id);
      if (!attached || events.some(e => e.type === "agent_detached" && e.id === actor.id)) throw new StoreError("Attach an agent first.");
      const last = [...events].reverse().find(e => e.agent_id === actor.id || (e.type === "agent_attached" && e.id === actor.id));
      return !last || this.clock() - Date.parse(last.ts) >= 1000;
    };
    if (!needsHeartbeat()) return;
    this.mutate(() => { if (needsHeartbeat()) this.append({ type: "agent_activity", id: actor.id }); });
  }

  detachAgent(): SprintView {
    const actor = this.requireActor();
    this.append({ type: "agent_detached", id: actor.id });
    return this.read();
  }
  claimItem(id: string, explanation?: string, recoverInactive = false): SprintView {
    const actor = this.requireActor();
    const state = this.requireActiveState();
    const item = this.findOpenItem(state, id);
    if (explanation !== undefined && (!explanation.trim() || explanation.trim().length > 500)) throw new StoreError("Handover explanation must contain 1–500 characters.");
    if (item.claim.owner === actor.id) { actor.generations.set(id, item.claim.generation); return this.read(); }
    if (item.claim.owner) {
      if (!explanation?.trim()) throw new StoreError(`Item ${id} is claimed by ${item.claim.owner_name}; use item_takeover with a nonempty explanation (1–500 characters).`);
      if (recoverInactive) {
        if (item.claim.owner_inactive_ms <= ACTIVITY_WINDOW_MS) throw new StoreError(`Cannot recover ${id}: owner ${item.claim.owner_name} inactivity is ${item.claim.owner_inactive_ms} ms; it must exceed ${ACTIVITY_WINDOW_MS} ms. Recovery does not override an active owner.`);
      } else if (!item.claim.stall_reasons.length) {
        throw new StoreError(`Cannot take over ${id}: owner ${item.claim.owner_name} inactivity is ${item.claim.owner_inactive_ms} ms (requires ${INACTIVE_STALL_MS} ms); other completions since item progress: ${item.claim.other_completions}/3. Neither potential-stall condition is met. For an interrupted owner inactive longer than ${ACTIVITY_WINDOW_MS} ms, use item_takeover with recover_inactive:true and an explanation.`);
      }
    }
    const generation = item.claim.generation + 1;
    this.append({ type: "item_claimed", item_id: id, owner: actor.id, generation, ...(explanation ? { explanation: explanation.trim() } : {}) });
    actor.generations.set(id, generation);
    return this.read();
  }
  releaseItem(id: string): SprintView {
    this.requireActiveState(); this.requireOwner(id);
    const item = this.read().subsprints.flatMap(s => s.items).find(i => i.id === id)!;
    this.append({ type: "item_released", item_id: id, generation: item.claim.generation });
    return this.read();
  }
  progressItem(id: string, message: string): SprintView {
    this.requireActiveState(); this.requireOwner(id);
    this.append({ type: "item_progress", item_id: id, message });
    return this.read();
  }
  private executeGate(gate: Gate, timeout: number | null): GateResult {
    if (this.executedGates) {
      const result = this.executedGates.get(gateKey(gate));
      if (!result) throw new StoreError("Gate settings changed; retry verification.");
      return result;
    }
    return runGate(gate, this.dir, timeout);
  }
  async doneAsync(input: Parameters<SprintStore["done"]>[0]): Promise<ReturnType<SprintStore["done"]>> {
    const prepared = withDataLock(this.dataDir, () => {
      const snapshot = this.read(); this.requireOwner(input.item);
      const item = this.findOpenItem(snapshot, input.item);
      return { revision: this.revision(), gates: item.gates.filter(isExecutable).map(gate => ({ gate, timeout: item.gate_timeout_ms })) };
    });
    return this.verifyOutsideLock(prepared.gates, () => this.done(input), prepared.revision);
  }
  async closeAsync(input: Parameters<SprintStore["closeSprint"]>[0] = {}): Promise<SprintView> {
    const prepared = withDataLock(this.dataDir, () => {
    const snapshot = this.read();
    const gates = new Map<string, { gate: Gate; timeout: number | null }>();
    const add = (gate: Gate, timeout: number | null) => {
      if (!isExecutable(gate)) return;
      const previous = gates.get(gateKey(gate));
      gates.set(gateKey(gate), { gate, timeout: previous ? (previous.timeout === null || timeout === null ? null : Math.max(previous.timeout, timeout)) : timeout });
    };
    for (const sub of snapshot.subsprints) {
      for (const gate of sub.gates) add(gate, DEFAULT_GATE_TIMEOUT_MS);
      for (const item of sub.items) if (item.status === "completed") for (const gate of item.gates) add(gate, item.gate_timeout_ms);
    }
    return { revision: this.revision(), gates: [...gates.values()] };
    });
    return this.verifyOutsideLock(prepared.gates, () => this.closeSprint(input), prepared.revision);
  }
  private revision(): number {
    return this.currentEvents().filter(event => event.type !== "agent_activity").length;
  }
  private async verifyOutsideLock<T>(gates: { gate: Gate; timeout: number | null }[], commit: () => T, revision: number): Promise<T> {
    const results = new Map<string, GateResult>();
    for (const { gate, timeout } of gates) results.set(gateKey(gate), await runGateAsync(gate, this.dir, timeout));
    return this.mutate(() => {
      if (this.revision() !== revision) throw new StoreError("Sprint changed while gates ran; retry verification.");
      this.executedGates = results;
      try { return commit(); } finally { this.executedGates = null; }
    });
  }

  private validateGates(gates: Gate[]): void {
    for (const gate of gates) {
      if (gate.kind === "command" && looksLikeProse(gate.spec)) {
        throw new StoreError(`Command gate looks like prose. Use a manual gate or provide a shell command: ${gate.spec}`);
      }
      if (isExecutable(gate) && specIsNoOp(gate.spec)) {
        throw new StoreError(`Gate "${gate.spec}" cannot fail, so it proves nothing. Give a spec that actually exercises this item's change, or use a manual gate.`);
      }
    }
  }

  private validateNoteAdd(s: SprintView, item: SprintView["subsprints"][number]["items"][number], text: string): void {
    const textError = validateNoteText(text);
    if (textError) throw new StoreError(textError);

    const itemNotes = item.notes.length;
    if (itemNotes >= NOTE_PER_ITEM_MAX) {
      throw new StoreError(`Item ${item.id} already has ${NOTE_PER_ITEM_MAX} notes. Close it with item_done, split it, or attach long context as an artifact.`);
    }

    if (item.status === "open" && itemNotes === 0) {
      const pressure = notePressure(s);
      if (pressure.open_count >= OPEN_ITEMS_WITH_NOTES_MAX) {
        throw new StoreError(
          pressure.pressure ?? `${OPEN_ITEMS_WITH_NOTES_MAX} open items already have notes.`,
          pressure.items.map((noted) => `${noted.id}: ${noted.title} (${noted.note_count} note${noted.note_count === 1 ? "" : "s"})`),
        );
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

  private validateDependencyReplacement(s: SprintView, target: string, dependencies: string[]): void {
    const uniqueDeps = [...new Set(dependencies)];
    if (uniqueDeps.length !== dependencies.length) throw new StoreError("Duplicate dependencies are not allowed.");

    const known = new Set(s.graph.nodes.map((n) => n.id));
    if (!known.has(target)) throw new StoreError(`Unknown dependency target ${target}.`);
    for (const dep of uniqueDeps) {
      if (!known.has(dep)) throw new StoreError(`Unknown dependency ${dep}.`);
      if (dep === target) throw new StoreError(`Dependency cycle: ${target} cannot depend on itself.`);
    }

    const retainedEdges = s.graph.edges.filter((edge) => edge.from !== target);
    try {
      buildDependencyGraph(s.graph.nodes, [...retainedEdges, ...uniqueDeps.map((dep) => ({ from: target, to: dep }))], { throwOnCycle: true });
    } catch (err) {
      if (err instanceof GraphCycleError) throw new StoreError(err.message);
      throw err;
    }
  }
}

function normalizeOptionalTitle(title: string | undefined, description: string): string {
  const candidate = title?.trim() || description.trim().split(/\r?\n/, 1)[0] || "Untitled item";
  return candidate.length > 80 ? `${candidate.slice(0, 77).trimEnd()}...` : candidate;
}

function noteRecords(events: LedgerEvent[]): Array<{ id: string; item: string; text: string }> {
  const records = new Map<string, { id: string; item: string; text: string }>();
  for (const event of events) {
    if (event.type === "note_added") {
      const id = event.note_id ?? legacyNoteId(event.seq);
      records.set(id, { id, item: event.element_id, text: event.text });
    }
    if (event.type === "note_updated") {
      const existing = records.get(event.note_id);
      if (existing) records.set(event.note_id, { ...existing, text: event.text });
    }
  }
  return [...records.values()];
}
