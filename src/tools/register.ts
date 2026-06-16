import { z } from "zod";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { project } from "../domain/projection.js";
import type { ItemView, SprintView } from "../domain/projection.js";
import { SprintStore } from "../store/store.js";
import { windowCurrent } from "./current.js";
import * as S from "./schemas.js";

export interface ToolDef {
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (raw: unknown) => Promise<unknown>;
}

function def<Sc extends z.ZodObject<z.ZodRawShape>>(
  schema: Sc,
  description: string,
  run: (input: z.infer<Sc>) => unknown | Promise<unknown>,
): ToolDef {
  return {
    description,
    schema,
    handler: async (raw) => {
      const input = schema.parse(raw);
      return pruneEmptyResponseFields(stripResponseNoise(ensureHelp(await run(input), helpTarget(input as Record<string, unknown>)))) ?? {};
    },
  };
}

export type ToolHandlers = Record<string, ToolDef>;
export type StoreProvider = () => SprintStore | Promise<SprintStore>;
export type StoreBinder = (binding: { git_dir: string; data_dir: string }) => SprintStore | Promise<SprintStore>;
export type StoreDetacher = () => void | Promise<void>;

export function buildToolHandlers(
  getStore: StoreProvider,
  openDashboard: () => Promise<string>,
  bindStore: StoreBinder = async () => getStore(),
  closeDashboard: () => Promise<void> | void = () => undefined,
  detachStore: StoreDetacher = () => undefined,
): ToolHandlers {
  return {
    sprint_new: def(S.SprintNewInput, "Start a sprint with explicit git_dir and a worktree-scoped, uncommitted data_dir; returns orientation.",
      async (i) => ({ ...(await bindStore({ git_dir: i.git_dir, data_dir: i.data_dir })).createSprint(i.goal, i.context_notes), orientation: orientation() })),
    sprint_resume: def(S.SprintResumeInput, "Resume an existing sprint by binding this MCP session to an existing git_dir and data_dir without creating a sprint.",
      async (i) => ack("sprint_resume", (await bindStore({ git_dir: i.git_dir, data_dir: i.data_dir })).read())),
    sprint_detach: def(S.SprintDetachInput, "Detach this MCP session from its current Sprinty binding and stop the dashboard.",
      async () => {
        await closeDashboard();
        await detachStore();
        return { detached: true };
      }),
    sprint_list: def(S.SprintListInput, "List existing sprint ledgers in a data_dir, or the current binding when already attached.",
      async (i) => {
        if (i.data_dir) return listSprints(i.data_dir);
        try {
          return listSprints((await getStore()).dataDir);
        } catch {
          return { current: null, sprints: [], hint: "Pass data_dir to inspect existing Sprinty ledgers while this MCP session is unbound." };
        }
      }),
    sprint_close: def(S.SprintCloseInput, "Close the sprint after a programmatic re-check of all gates.",
      async (i) => {
        const view = (await getStore()).closeSprint(i);
        await closeDashboard();
        return ack("sprint_close", view, { status: view.status });
      }),
    sprint_archive: def(S.SprintArchiveInput, "Archive the sprint with a recovery reason, bypassing normal close gates.",
      async (i) => {
        const view = (await getStore()).archiveSprint(i);
        await closeDashboard();
        return ack("sprint_archive", view, { status: view.status });
      }),
    overview: def(S.OverviewInput, "Compact sprint overview: title, details, notes, artifacts, and subsprint counts.",
      async () => {
        const store = await getStore();
        return overview(store.read(), store);
      }),
    next: def(S.NextInput, "Compact work window for choosing the next item.",
      async (i) => {
        const view = windowCurrent((await getStore()).read(), i.past, i.future);
        return withHelp(renameCurrentWindow(view), view.current?.id ?? "sprint");
      }),
    subsprint_new: def(S.SubsprintNewInput, "Create a subsprint (description, goals, gates).",
      async (i) => {
        const result = (await getStore()).createSubsprint(i);
        return ack("subsprint_new", result.view, { subsprint: result.id });
      }),
    subsprint_get: def(S.SubsprintGetInput, "Read one subsprint with compact item rows.",
      async (i) => subsprintGet((await getStore()).read(), i.id)),
    subsprint_list: def(S.SubsprintListInput, "List subsprints with compact rows.",
      async () => subsprintList((await getStore()).read())),
    item_add: def(S.ItemAddInput, "Add an atomic item (bounded title, bounded description, code locations, gates — all required).",
      async (i) => {
        const result = (await getStore()).addItem(i);
        return ack("item_add", result.view, { item: result.id });
      }),
    item_get: def(S.ItemGetInput, "Read one item with full untruncated detail.",
      async (i) => itemGet((await getStore()).read(), i.id)),
    item_update: def(S.ItemUpdateInput, "Update item metadata: note and/or dependency ids.",
      async (i) => {
        const store = await getStore();
        let view = store.read();
        if (i.dependencies?.length) view = store.addDependencies({ target: i.id, dependencies: i.dependencies });
        if (i.note) view = store.updateItem({ target: i.id, note: i.note });
        return ack("item_update", view, { id: i.id });
      }),
    item_done: def(S.ItemDoneInput, "Resolve an item as completed with commit id + gate results.",
      async (i) => {
        const id = requiredId(i, "id", "item");
        return ack("item_done", (await getStore()).done({ ...i, item: id }), { item: id, commit_id: i.commit_id, status: "completed" });
      }),
    item_split: def(S.ItemSplitInput, "Resolve an item as split, creating a seeded subsprint atomically.",
      async (i) => {
        const id = requiredId(i, "id", "item");
        const view = (await getStore()).split({ ...i, item: id });
        const item = findItem(view, id);
        return ack("item_split", view, { item: id, subsprint: item?.spawned_subsprint ?? null });
      }),
    item_deprecate: def(S.ItemDeprecateInput, "Resolve an item as deprecated with a reason.",
      async (i) => {
        const id = requiredId(i, "id", "item");
        return ack("item_deprecate", (await getStore()).deprecate({ item: id, reason: i.reason }), { item: id, status: "deprecated" });
      }),
    note_add: def(S.NoteInput, "Add a note to a specific item id. Notes are not substitutes for item_add(); create items for trackable work.",
      async (i) => {
        const id = requiredId(i, "id");
        const result = (await getStore()).addNote({ element: id, text: i.text });
        return ack("note_add", result.view, { note: result.id, item: id });
      }),
    note_get: def(S.NoteGetInput, "Read notes attached to an item id.",
      async (i) => (await getStore()).getNote(i.id)),
    note_list: def(S.NoteListInput, "List notes for an item as compact rows.",
      async (i) => noteList(await getStore(), i.id)),
    note_update: def(S.NoteUpdateInput, "Update a note by note id.",
      async (i) => ({ note: (await getStore()).updateNote(i) })),
    artifact_add: def(S.ArtifactAddInput, "Attach a file path to the sprint, optionally related to item ids.",
      async (i) => {
        const result = (await getStore()).addArtifact({ target: "sprint", kind: "other", title: i.title, uri: i.path, description: i.description, related_items: i.related_items });
        return ack("artifact_add", result.view, { artifact: result.id });
      }),
    artifact_get: def(S.ArtifactGetInput, "Read one artifact by id.",
      async (i) => artifactGet((await getStore()).read(), i.id, true)),
    artifact_list: def(S.ArtifactListInput, "List active sprint artifacts as compact rows.",
      async () => artifactList((await getStore()).read())),
    artifact_update: def(S.ArtifactUpdateInput, "Update an artifact by id.",
      async (i) => {
        const patch: { artifact: string; title?: string; uri?: string; description?: string; related_items?: string[] } = { artifact: i.id };
        if (i.title) patch.title = i.title;
        if (i.path) patch.uri = i.path;
        if (i.description) patch.description = i.description;
        if (i.related_items) patch.related_items = i.related_items;
        const view = (await getStore()).amendArtifact(patch);
        return ack("artifact_update", view, { artifact: i.id });
      }),
    search: def(S.SearchInput, "Regex search over sprint text with character context around each match.",
      async (i) => {
        const allMatches = (await getStore()).search(i.pattern, i.context_size);
        const matches = allMatches.slice(0, 20);
        return {
          info: "Compact search results. Use the tool_call on a row for full untruncated detail. If truncated is true, refine pattern.",
          matches,
          ...(allMatches.length > matches.length ? { truncated: true, total_matches: allMatches.length } : {}),
          help: helpLine(i.pattern),
        };
      }),
    changelog: def(S.ChangelogInput, "Render the sprint changelog as Markdown with change-map and coverage tables.",
      async () => ({ markdown: (await getStore()).changelog() })),
    dashboard: def(S.DashboardInput, "Start (once) and return the follow-along dashboard URL.",
      async () => ({ url: await openDashboard() })),
  };
}

function orientation(): { skills: string[]; how: string } {
  return {
    skills: ["how-to-run-a-sprint", "using-sprinty"],
    how:
      "One sprint per session. Build item-driven: subsprint_new -> item_add -> item_done/item_split/item_deprecate. " +
      "Start with explicit git_dir and a worktree-scoped, uncommitted data_dir, such as <git_dir>/.sprinty when it is gitignored, so Sprinty cannot bind to a temp MCP cwd or shared state. " +
      "Items need a short title, bounded description, code_locations, and gates; keep them atomic. Each subsprint should represent one feature. " +
      "After sprint_new, call dashboard() and show the localhost URL to the human. Resolve every item, then sprint_close re-runs gates.",
  };
}

function ack(action: string, view: SprintView, extra: Record<string, unknown> = {}) {
  void view;
  assertNoDuplicateIdentifierAliases(extra);
  return {
    ok: true,
    action,
    ...extra,
    help: helpLine(helpTarget(extra)),
  };
}

function helpTarget(extra: Record<string, unknown>): string {
  return String(extra.id ?? extra.item ?? extra.subsprint ?? extra.artifact ?? extra.note ?? "sprint");
}

function helpLine(target: string) {
  const item = itemTarget(target);
  const subsprint = subsprintTarget(target);
  const overviewCall = target === "sprint" ? "overview()" : `item_get({ id: "${item}" })`;
  return `Help: use next({}) for the active work window; ${overviewCall} for focused detail; subsprint_get({ id: "${subsprint}" }) for a subsprint's item list; note_list({ id: "${item}" }) for item notes; search({ pattern: "${target}", context_size: 512 }) for text matches; item_add({ subsprint: "${subsprint}", ... }) or subsprint_new({ ... }) for new tracked work; item_split({ id: "${item}", ... }) if the item is too large; item_done({ id: "${item}", commit_id, gate_results, changelog }) when complete; read skills using-sprinty and how-to-run-a-sprint for the full command workflow.`;
}

function withHelp(value: unknown, target: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, help: helpLine(target) };
  return { ...(value as Record<string, unknown>), help: helpLine(target) };
}

function ensureHelp(value: unknown, target: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, help: helpLine(target) };
  if ("help" in value) return value;
  return { ...(value as Record<string, unknown>), help: helpLine(target) };
}

function assertNoDuplicateIdentifierAliases(extra: Record<string, unknown>) {
  const aliases = ["id", "item", "target", "subsprint", "artifact", "follow_up"];
  const seen = new Map<string, string>();
  for (const key of aliases) {
    const value = extra[key];
    if (typeof value !== "string") continue;
    const existing = seen.get(value);
    if (existing) throw new Error(`Duplicate identifier aliases in ack: ${existing} and ${key} both equal ${value}`);
    seen.set(value, key);
  }
}

function requiredId(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of ["id", ...keys]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  throw new Error(`Missing id. Pass id instead of ${keys.join("/")}.`);
}

function overview(view: SprintView, store: SprintStore) {
  return {
    info: "Compact overview. Use subsprint_get({ id }) for item rows, item_get({ id }), note_get({ id }), or artifact_get({ id }) for full untruncated detail.",
    title: view.goal,
    details: view.context_notes.map((note) => truncate(note, 240)),
    notes: overviewNotes(view, store),
    artifacts: artifactRows(view),
    subsprints: view.subsprints.map((sub) => ({
      id: sub.id,
      title: truncate(sub.description, 160),
      status: sub.status,
      dependencies: sub.dependencies,
      item_counts: itemCounts(view, sub.items),
    })),
  };
}

function overviewNotes(view: SprintView, store: SprintStore) {
  const itemIds = new Set(view.subsprints.flatMap((sub) => sub.items.map((item) => item.id)));
  return store.listAllNotes()
    .filter((note) => itemIds.has(note.item))
    .map((note) => ({
      id: note.id,
      item: note.item,
      text: truncate(note.text, 160),
    }))
    .slice(0, 20);
}

function renameCurrentWindow(view: ReturnType<typeof windowCurrent>) {
  return {
    info: "Compact work window. Use item_get({ id }), subsprint_get({ id }), note_get({ id }), or artifact_get({ id }) for full untruncated detail.",
    last_resolved: view.last_resolved,
    item: view.current,
    next: view.next,
    blocked: view.blocked_open,
    current_subsprint: view.current_subsprint,
    relations: view.relations,
    artifacts: view.artifacts,
    recent_artifacts: view.recent_artifacts,
    recent: view.recent_activity,
  };
}

function subsprintList(view: SprintView) {
  return {
    info: "Compact view. Use subsprint_get({ id }) for full untruncated detail.",
    subsprints: view.subsprints.map((sub) => ({
      id: sub.id,
      title: sub.description,
      status: sub.status,
      items: itemCounts(view, sub.items),
    })),
  };
}

function itemCounts(view: SprintView, items: ItemView[]) {
  const statusById = new Map(view.graph.nodes.map((node) => [node.id, node.status]));
  return {
    open: items.filter((item) => item.status === "open").length,
    closed: items.filter((item) => item.status !== "open").length,
    blocked: items.filter((item) => item.status === "open" && item.dependencies.some((dep) => statusById.get(dep) === "open")).length,
  };
}

function subsprintGet(view: SprintView, id: string) {
  const sub = view.subsprints.find((candidate) => candidate.id === id);
  if (!sub) throw new Error(`Unknown subsprint ${id}.`);
  return {
    info: "Full subsprint detail. Use item_get({ id }) for full untruncated item detail.",
    id: sub.id,
    title: sub.description,
    status: sub.status,
    goals: sub.goals,
    gates: sub.gates,
    dependencies: sub.dependencies,
    items: sub.items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status,
      dependencies: item.dependencies,
    })),
  };
}

function itemGet(view: SprintView, id: string) {
  const item = findItem(view, id);
  if (!item) throw new Error(`Unknown item ${id}.`);
  return {
    id: item.id,
    subsprint: item.subsprint_id,
    title: item.title,
    description: item.description,
    status: item.status,
    dependencies: item.dependencies,
    code_locations: item.code_locations,
    gates: item.gates,
    updates: item.updates,
    notes: item.notes,
    commit_id: item.commit_id,
    gate_results: item.gate_results,
    reason: item.reason,
    changelog: item.changelog,
    artifacts: item.artifacts.map(artifactRow),
  };
}

function noteList(store: SprintStore, id: string) {
  return {
    info: "Compact view. Use note_get({ id }) for full untruncated detail.",
    notes: store.listNotes(id).map((note) => ({ id: note.id, text: truncate(note.text, 160) })),
  };
}

function allArtifacts(view: SprintView) {
  const artifacts = [
    ...view.artifacts,
    ...view.subsprints.flatMap((sub) => [
      ...sub.artifacts,
      ...sub.items.flatMap((item) => item.artifacts),
    ]),
  ];
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.id)) return false;
    seen.add(artifact.id);
    return true;
  });
}

function artifactRow(artifact: SprintView["artifacts"][number]) {
  return {
    id: artifact.id,
    title: artifact.title,
    path: artifact.uri,
    related_items: artifact.related_items,
  };
}

function artifactRows(view: SprintView) {
  return allArtifacts(view).filter((artifact) => artifact.status === "active").map(artifactRow);
}

function artifactList(view: SprintView) {
  return {
    info: "Compact view. Use artifact_get({ id }) for full untruncated detail.",
    artifacts: artifactRows(view),
  };
}

function artifactGet(view: SprintView, id: string, full = false) {
  const artifacts = allArtifacts(view);
  const artifact = artifacts.find((candidate) => candidate.id === id);
  if (!artifact) throw new Error(`Unknown artifact ${id}.`);
  return {
    artifact: {
      ...artifactRow(artifact),
      ...(full ? { description: artifact.description } : {}),
    },
  };
}

function itemTarget(target: string): string {
  return /^S\d{2}-\d{3}$/.test(target) ? target : "S01-001";
}

function subsprintTarget(target: string): string {
  const itemMatch = /^(S\d{2})-\d{3}$/.exec(target);
  if (itemMatch) return itemMatch[1]!;
  return /^S\d{2}$/.test(target) ? target : "S01";
}

function findItem(view: SprintView, itemId: string): ItemView | undefined {
  return view.subsprints.flatMap((sub) => sub.items).find((item) => item.id === itemId);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function stripResponseNoise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripResponseNoise);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "ts" && !key.endsWith("_at"))
      .map(([key, child]) => [key, stripResponseNoise(child)]),
  );
}

function pruneEmptyResponseFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    const entries = value.map(pruneEmptyResponseFields).filter((entry) => entry !== undefined);
    return entries.length > 0 ? entries : undefined;
  }
  if (!value || typeof value !== "object") {
    if (value === null || value === undefined || value === "") return undefined;
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => [key, pruneEmptyResponseFields(child)] as const)
    .filter(([, child]) => child !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

interface SprintListResult {
  data_dir: string;
  current: string | null;
  sprints: Array<{ id: string; title: string; status: string; items: { open: number; closed: number; blocked: number } }>;
}

const sprintListCache = new Map<string, { signature: string; result: SprintListResult }>();

function listSprints(dataDir: string): SprintListResult {
  const current = readCurrent(dataDir);
  if (!existsSync(dataDir)) return { data_dir: dataDir, current, sprints: [] };
  const ledgerIds = readdirSync(dataDir)
    .map((file) => /^(\d+)\.jsonl$/.exec(file)?.[1])
    .filter((id): id is string => Boolean(id))
    .sort();
  const signature = sprintListSignature(dataDir, current, ledgerIds);
  const cached = sprintListCache.get(dataDir);
  if (cached?.signature === signature) return cached.result;
  const sprints = ledgerIds.map((id) => {
      const events = readFileSync(join(dataDir, `${id}.jsonl`), "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
      const view = project(events);
      if (!view) throw new Error(`Sprint ledger ${id} in ${dataDir} is empty or unreadable.`);
      return sprintListRow(id, view);
    });
  const result = { data_dir: dataDir, current, sprints };
  sprintListCache.set(dataDir, { signature, result });
  return result;
}

function sprintListSignature(dataDir: string, current: string | null, ledgerIds: string[]): string {
  return [
    current ?? "",
    ...ledgerIds.map((id) => {
      const stat = statSync(join(dataDir, `${id}.jsonl`));
      return `${id}:${stat.size}:${stat.mtimeMs}`;
    }),
  ].join("|");
}

function sprintListRow(id: string, view: SprintView): { id: string; title: string; status: string; items: { open: number; closed: number; blocked: number } } {
  const items = view.subsprints.flatMap((sub) => sub.items);
  const statusById = new Map(view.graph.nodes.map((node) => [node.id, node.status]));
  const blocked = items.filter((item) => {
    if (item.status !== "open") return false;
    const blockers = view.graph.blocked_by?.[item.id] ?? item.dependencies;
    return blockers.some((dep) => statusById.get(dep) === "open");
  }).length;
  return {
    id,
    title: truncate(view.goal, 120),
    status: view.status,
    items: {
      open: items.filter((item) => item.status === "open").length,
      closed: items.filter((item) => item.status !== "open").length,
      blocked,
    },
  };
}

function readCurrent(dataDir: string): string | null {
  const pointer = join(dataDir, "current");
  if (!existsSync(pointer)) return null;
  const id = readFileSync(pointer, "utf8").trim();
  return id.length > 0 ? id : null;
}
