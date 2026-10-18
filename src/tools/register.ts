import { attachNativeAgent } from "../domain/native-identity.js";
import { ACTIVITY_WINDOW_MS } from "../domain/collaboration.js";
import { withDataLock, commitTransaction } from "../ledger/transaction.js";
import { dependencyResolver } from "../domain/work-order.js";
import { actors, newIdentity, type Actor } from "../domain/agents.js";
import { z } from "zod";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { project } from "../domain/projection.js";
import type { ItemView, SprintView } from "../domain/projection.js";
import type { SearchMatch } from "../domain/search.js";
import { SprintStore } from "../store/store.js";
import { windowCurrent } from "./current.js";
import { briefing, nextTools } from "./next-tools.js";
import * as S from "./schemas.js";

export interface ToolDef {
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (raw: unknown) => Promise<unknown>;
}

function makeDef(getStore: StoreProvider) {
  // next_tools is computed from state after the call, so every response points at ids that exist.
  return function def<Sc extends z.ZodObject<z.ZodRawShape>>(
    schema: Sc,
    description: string,
    run: (input: z.infer<Sc>) => unknown | Promise<unknown>,
    readNextState = true,
  ): ToolDef {
    return {
      description,
      schema,
      handler: async (raw) => {
        const input = schema.parse(raw);
        const result = await run(input);
        const focus = (input as Record<string, unknown>).id;
        const withNext = attachNextTools(result, readNextState ? await readViewOrNull(getStore) : null, typeof focus === "string" ? focus : undefined);
        return pruneEmptyResponseFields(stripResponseNoise(withNext)) ?? {};
      },
    };
  };
}

async function readViewOrNull(getStore: StoreProvider): Promise<SprintView | null> {
  try {
    return (await getStore()).read();
  } catch {
    return null;
  }
}

function attachNextTools(value: unknown, view: SprintView | null, id?: string | undefined): unknown {
  const suggestions = nextTools(view, { id });
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, next_tools: suggestions };
  if ("next_tools" in value) return value;
  return { ...(value as Record<string, unknown>), next_tools: suggestions };
}

export type ToolHandlers = Record<string, ToolDef>;
export type StoreProvider = () => SprintStore | Promise<SprintStore>;
export type StoreBinder = (binding: { git_dir: string; data_dir: string }) => SprintStore | Promise<SprintStore>;
export type StoreDetacher = () => void | Promise<void>;
export interface DashboardInfo {
  running: boolean;
  url?: string;
  port?: number;
}
export interface DashboardController {
  open(): Promise<DashboardInfo>;
  restart(): Promise<DashboardInfo>;
  info(): Promise<DashboardInfo>;
  close(): Promise<void> | void;
}

export function buildToolHandlers(
  getStore: StoreProvider,
  dashboard: DashboardController,
  bindStore: StoreBinder = async () => getStore(),
  detachStore: StoreDetacher = () => undefined,
): ToolHandlers {
  let boundStore: SprintStore | undefined;
  const originalProvider = getStore;
  const originalBinder = bindStore;
  getStore = () => boundStore ?? originalProvider();
  bindStore = async binding => {
    const next = await originalBinder(binding);
    if (boundStore && (boundStore.dir !== next.dir || boundStore.dataDir !== next.dataDir)) throw new Error("Detach before binding a different sprint.");
    boundStore ??= next;
    return boundStore;
  };
  const originalDetach = detachStore;
  detachStore = async () => { boundStore = undefined; await originalDetach(); };
  const def = makeDef(getStore);
  const handlers: ToolHandlers = {
    info: def(S.InfoInput, "Startup orientation and compact sprint discovery before binding to one sprint.",
      async (i) => infoPayload(i, getStore, dashboard), false),
    sprint_new: def(S.SprintNewInput, "Start a sprint with explicit git_dir and a worktree-scoped, uncommitted data_dir; returns orientation.",
      async (i) => {
        const store = await bindStore({ git_dir: i.git_dir, data_dir: defaultDataDir(i) });
        const view = store.createSprint(i.goal, i.context_notes);
        return { ...view, orientation: orientation(), briefing: briefing(view, store.listAllNotes()), dashboard: await dashboard.open() };
      }),
    sprint_resume: def(S.SprintResumeInput, "Resume an existing sprint by binding this MCP session to an existing git_dir and data_dir without creating a sprint.",
      async (i) => {
        const store = await bindStore({ git_dir: i.git_dir, data_dir: defaultDataDir(i) });
        const view = store.read();
        // Resuming is the context-loss path: return the state instead of making the agent re-derive it.
        return ack("sprint_resume", view, {
          briefing: briefing(view, store.listAllNotes()),
          skills: orientation().skills,
          dashboard: await dashboard.open(),
        });
      }),
    sprint_detach: def(S.SprintDetachInput, "Detach this MCP session from its current Sprinty binding and stop the dashboard.",
      async () => {
        await dashboard.close();
        await detachStore();
        return { detached: true };
      }),
    sprint_close: def(S.SprintCloseInput, "Re-check all gates, write the canonical SemVer changelog, and close the sprint; force bypasses only executable gate failures.",
      async (i) => {
        const view = await (await getStore()).closeAsync(i);
        await dashboard.close();
        return ack("sprint_close", view, { status: view.status, forced: i.force });
      }),
    sprint_archive: def(S.SprintArchiveInput, "Archive the sprint with a recovery reason, bypassing normal close gates.",
      async (i) => {
        const view = (await getStore()).archiveSprint(i);
        await dashboard.close();
        return ack("sprint_archive", view, { status: view.status });
      }),
    overview: def(S.OverviewInput, "Compact sprint overview: title, details, notes, artifacts, and subsprint counts.",
      async () => {
        const store = await getStore();
        return overview(store.read(), store);
      }),
    next: def(S.NextInput, "Compact work window for choosing the next item.",
      async (i) => {
        const state = (await getStore()).read();
        const view = windowCurrent(state, i.past, i.future ?? i.future_per_subsprint, {
          include_high_priority: i.include_high_priority,
          ...(actors.getStore() ? { actor_id: actors.getStore()!.id } : {}),
          ...(i.future === undefined ? {} : { future_total: i.future }),
        });
        const claimed = state.subsprints.flatMap(s => s.items).filter(item => item.claim.owner);
        const proposed = new Set(view.next.map(item => item.id));
        return { ...renameCurrentWindow(view), eta: state.eta, claim_count: claimed.length,
          claims: claimed.filter(item => !proposed.has(item.id)).sort((a,b) => b.claim.stall_reasons.length - a.claim.stall_reasons.length).slice(0, 3).map(item => ({ id: item.id, ...compactClaim(item.claim) })) };
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
    item_add: def(S.ItemAddInput, "Add an atomic item (bounded title, bounded description, code locations, gates — all required; gate_timeout_ms defaults to 5000 and null disables it).",
      async (i) => {
        const result = (await getStore()).addItem(i);
        return ack("item_add", result.view, { item: result.id });
      }),
    item_get: def(S.ItemGetInput, "Read one item with full untruncated detail.",
      async (i) => itemGet((await getStore()).read(), i.id)),
    item_update: def(S.ItemUpdateInput, "Update an item by id: metadata, open-item gates/timeout, completed-item commit_id, and/or dependency ids.",
      async (i) => {
        const store = await getStore();
        const view = store.updateItem({
          target: i.id,
          note: i.note,
          title: i.title,
          description: i.description,
          high_priority: i.high_priority,
          gates: i.gates,
          gate_timeout_ms: i.gate_timeout_ms,
          commit_id: i.commit_id,
          dependencies: i.dependencies,
        });
        return ack("item_update", view, { id: i.id });
      }),
    item_done: def(S.ItemDoneInput, "Resolve an item as completed with a commit id and a semver changelog verb (added/fixed/changed/removed/deprecated/security). Sprinty runs the item's executable gates itself; only manual gates take agent-supplied gate_results.",
      async (i) => {
        const id = requiredId(i, "id", "item");
        const { view, warning } = await (await getStore()).doneAsync({ ...i, item: id });
        return ack("item_done", view, {
          item: id,
          commit_id: i.commit_id,
          status: "completed",
          ...(warning ? { warning } : {}),
        });
      }),
    item_split: def(S.ItemSplitInput, "Resolve an item as split, creating a seeded subsprint atomically.",
      async (i) => {
        const id = requiredId(i, "id", "item");
        const view = (await getStore()).split({ ...i, item: id });
        const item = findItem(view, id);
        return ack("item_split", view, { item: id, subsprint: item?.spawned_subsprint ?? null });
      }),
    item_deprecate: def(S.ItemDeprecateInput, "Resolve an item as deprecated with a reason, or drop a whole subsprint by passing its id (its open items are deprecated too).",
      async (i) => {
        const id = requiredId(i, "id", "item");
        return ack("item_deprecate", (await getStore()).deprecate({ target: id, reason: i.reason }), { id, status: "deprecated" });
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
    artifact_list: def(S.ArtifactListInput, "Page through active sprint artifacts as compact newest-first rows.",
      async (i) => artifactList((await getStore()).read(), i.offset, i.limit)),
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
        const matches = selectSearchMatches(allMatches, 10);
        return {
          info: "Compact search results. Use the tool_call on a row for full untruncated detail. If truncated is true, refine pattern.",
          matches,
          ...(allMatches.length > matches.length ? { truncated: true, total_matches: allMatches.length } : {}),
        };
      }),
    changelog: def(S.ChangelogInput, "Preview or export the current SemVer Markdown changelog and return only its path; sprint_close writes the canonical changelog automatically.",
      async (i) => {
        const store = await getStore();
        const path = i.path ?? join(store.dataDir, "CHANGELOG.md");
        withDataLock(store.dataDir, () => {
          const contents = store.changelog();
          if (path === join(store.dataDir, "CHANGELOG.md")) commitTransaction(store.dataDir, [{ name: "CHANGELOG.md", contents }]);
          else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); }
        });
        return { path };
      }),
    dashboard_info: def(S.DashboardInfoInput, "Return the current dashboard URL and port without starting or restarting it.",
      async () => dashboard.info()),
    dashboard_restart: def(S.DashboardRestartInput, "Restart the follow-along dashboard and return its URL and port.",
      async () => dashboard.restart()),
  };
  const identities = new Map<string, Actor>();
  const processIdentity = newIdentity([]);
  const nativeTokens = new Map<string, string>();
  const identityView = (actor: Actor, token?: string) => ({ id: actor.id, name: actor.name, ...(token ? { token } : {}) });
  const resolveActor = async (token?: string): Promise<{ actor: Actor; token: string }> => {
    if (token) {
      const local = identities.get(token);
      if (local) return { actor: local, token };
      const recovered = (await getStore()).attachAgent(token);
      identities.set(token, recovered.actor);
      return recovered;
    }
    if (!identities.size) {
      const identity = (await getStore()).attachAgent(undefined, processIdentity);
      identities.set(identity.token, identity.actor);
    }
    if (identities.size !== 1) throw new Error("Multiple agents attached; pass agent_token explicitly.");
    const [entry] = identities;
    return { token: entry![0], actor: entry![1] };
  };
  const pageInput = z.object({ offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(50).default(20) });
  handlers.agent_list = def(pageInput, "List named agents, activity state and claim counts; paginated and token-free.", async i => {
    const state = (await getStore()).read();
    const items = state.subsprints.flatMap(s => s.items);
    const now = Date.parse(state.eta.estimated_at);
    const rows = state.agents.map(a => ({ id: a.id, name: a.name, status: !a.attached ? "detached" : now - Date.parse(a.last_activity_at) <= ACTIVITY_WINDOW_MS ? "active" : "inactive", last_activity_at: a.last_activity_at, claimed_items: items.filter(item => item.claim.owner === a.id).length }));
    return { agents: rows.slice(i.offset, i.offset + i.limit), total: rows.length, offset: i.offset, ...(i.offset + i.limit < rows.length ? { next_offset: i.offset + i.limit } : {}) };
  });
  handlers.items_claimed = def(pageInput.extend({ mine: z.boolean().default(false) }), "List current item claims, optionally only yours; includes timing, progress and stall reasons.", async i => {
    const state = (await getStore()).read();
    const caller = actors.getStore()!;
    const rows = state.subsprints.flatMap(s => s.items).filter(item => item.claim.owner && (!i.mine || item.claim.owner === caller.id)).sort((a,b) => a.id.localeCompare(b.id));
    return { items: rows.slice(i.offset, i.offset + i.limit).map(item => ({ id: item.id, title: truncate(item.title, 80), ...compactClaim(item.claim), owner_id: item.claim.owner, last_progress_at: item.claim.last_progress_at, total_claimed_ms: item.claim.total_claimed_ms, active_work_ms: item.claim.active_work_ms })), total: rows.length, offset: i.offset, ...(i.offset + i.limit < rows.length ? { next_offset: i.offset + i.limit } : {}) };
  });
  handlers.agent_attach = def(z.object({}), "Attach an independent named agent; retain its returned token for shared connections.", () => ({}));
  handlers.agent_detach = def(z.object({}), "Detach only this agent and release its claims.", async () => { (await getStore()).detachAgent(); return { detached: true }; });
  handlers.agent_heartbeat = def(z.object({}), "Report activity during long tasks; does not reset item progress or stall completion counts.", () => ({ active: true }));
  const claimInput = z.object({ id: z.string().min(1) });
  handlers.item_claim = def(claimInput, "Exclusively claim an open item before editing it.", async i => {
    const view = (await getStore()).claimItem(i.id);
    return { id: i.id, claim: compactClaim(findItem(view, i.id)!.claim) };
  });
  handlers.item_release = def(claimInput, "Release your claim for another agent.", async i => { (await getStore()).releaseItem(i.id); return { released: i.id }; });
  handlers.item_takeover = def(claimInput.extend({ explanation: z.string().trim().min(1).max(500), recover_inactive: z.boolean().default(false) }), "Take over a potentially stalled claim with a 1–500 character explanation. For an interrupted owner inactive over five minutes, explicitly set recover_inactive:true; active owners cannot be recovered.", async i => {
    const view = (await getStore()).claimItem(i.id, i.explanation, i.recover_inactive);
    return { id: i.id, claim: compactClaim(findItem(view, i.id)!.claim) };
  });
  handlers.item_progress = def(claimInput.extend({ message: z.string().trim().min(1).max(500) }), "Record meaningful progress on your claimed item.", async i => { (await getStore()).progressItem(i.id, i.message); return { progressed: i.id }; });
  for (const [name, definition] of Object.entries(handlers)) {
    const original = definition.handler;
    definition.schema = definition.schema.extend({ agent_token: z.string().min(1).optional(), claim_generation: z.number().int().positive().optional(), client_session_id: z.string().trim().min(1).max(200).optional(), client_agent_id: z.string().trim().min(1).max(200).optional() });
    definition.handler = async raw => {
      const parsed = definition.schema.parse(raw);
      const { agent_token, claim_generation, client_session_id, client_agent_id, ...input } = parsed;
      if (client_agent_id && !client_session_id) throw new Error("client_agent_id requires client_session_id.");
      const nativeKey = client_session_id ? JSON.stringify([client_session_id, client_agent_id ?? "main"]) : undefined;
      const automatic = async () => {
        if (!nativeKey) return resolveActor(agent_token as string | undefined);
        const existing = nativeTokens.get(nativeKey);
        if (existing && identities.has(existing)) return resolveActor(existing);
        const identity = attachNativeAgent(await getStore(), client_session_id as string, client_agent_id as string | undefined);
        identities.set(identity.token, identity.actor);
        nativeTokens.set(nativeKey, identity.token);
        return identity;
      };
      if (name === "agent_attach") {
        const identity = nativeKey ? await automatic() : (await getStore()).attachAgent(agent_token as string | undefined);
        identities.set(identity.token, identity.actor);
        return { agent: identityView(identity.actor, identity.token), next_tools: [nativeKey ? "item_claim({ id })" : "item_claim({ id, agent_token })"] };
      }
      if (name === "sprint_new" || name === "sprint_resume") {
        const continuing = name === "sprint_new" && agent_token ? await resolveActor(agent_token as string) : undefined;
        const result = await original(input) as Record<string, unknown>;
        if (name === "sprint_new") { identities.clear(); nativeTokens.clear(); }
        if (!nativeKey && (!identities.size || agent_token)) {
          const identity = (await getStore()).attachAgent(name === "sprint_new" ? undefined : agent_token as string | undefined, name === "sprint_new" ? continuing ?? processIdentity : !agent_token ? processIdentity : undefined);
          identities.set(identity.token, identity.actor);
        }
        const identity = await automatic();
        const store = await getStore();
        const state = store.read();
        return actors.run(identity.actor, () => ({ ...result, briefing: briefing(state, store.listAllNotes()), next_tools: nextTools(state), agent: identityView(identity.actor, identity.token) }));
      }
      if (name === "info") {
        const result = await original(input) as Record<string, unknown>;
        if (!identities.size && !agent_token && !nativeKey) return { ...result, agent: identityView(processIdentity.actor) };
        if (nativeKey && !await readViewOrNull(getStore)) return { ...result, agent: identityView(processIdentity.actor) };
        const identity = await automatic();
        const store = await getStore();
        actors.run(identity.actor, () => store.activity());
        return { ...result, agent: identityView(identity.actor) };
      }
      if (!identities.size && ["dashboard_info", "dashboard_restart", "sprint_detach"].includes(name)) return original(input);
      const identity = await automatic();
      // Capture generations per call; an overlapping handoff must not change an in-flight operation's fence.
      const actor: Actor = { ...identity.actor, generations: new Map(identity.actor.generations) };
      if (claim_generation !== undefined && typeof input.id === "string") actor.generations.set(input.id, claim_generation as number);
      return actors.run(actor, async () => {
        if (name === "sprint_detach") {
          if (identities.size > 1) throw new Error("Use agent_detach while other agents share this connection.");
          (await getStore()).detachAgent();
        } else (await getStore()).activity();
        const result = await original(input) as Record<string, unknown>;
        if ((name === "item_claim" || name === "item_takeover") && typeof input.id === "string") {
          const generation = actor.generations.get(input.id)!;
          identity.actor.generations.set(input.id, Math.max(identity.actor.generations.get(input.id) ?? 0, generation));
        }
        if (name === "agent_detach" || name === "sprint_detach") { identities.delete(identity.token); if (nativeKey) nativeTokens.delete(nativeKey); }
        return { ...result, agent: identityView(actor) };
      });
    };
  }
  return handlers;
}

function orientation(): { skills: string[]; how: string } {
  return {
    skills: ["how-to-run-a-sprint", "using-sprinty"],
    how:
      "One sprint per binding. Your MCP connection identifies you automatically. Claim items before editing. Build item-driven: subsprint_new -> item_add -> item_done/item_split/item_deprecate. " +
      "Start with explicit git_dir and a worktree-scoped, uncommitted data_dir, such as <git_dir>/.sprinty when it is gitignored, so Sprinty cannot bind to a temp MCP cwd or unrelated state. " +
      "Items need a short title, bounded description, code_locations, and gates; keep them atomic. Each subsprint should represent one feature. " +
      "sprint_new and sprint_resume return a dashboard URL for the human; use dashboard_info to inspect it or dashboard_restart to refresh it. Resolve every item, generate the SemVer Markdown with changelog({path?}), then sprint_close re-runs gates.",
  };
}

function ack(action: string, view: SprintView, extra: Record<string, unknown> = {}) {
  void view;
  assertNoDuplicateIdentifierAliases(extra);
  return { ok: true, action, ...extra };
}

async function infoPayload(
  input: z.infer<typeof S.InfoInput>,
  getStore: StoreProvider,
  dashboard: DashboardController,
) {
  return {
    info: "Startup orientation and compact sprint discovery.",
    startup: [
      "Call info({ data_dir }) to inspect one Sprinty data directory without binding.",
      "Call info({ workspace_dirs: [...] }) to inspect multiple Sprinty data directories as one workspace.",
      "Call sprint_resume({ git_dir, data_dir }) with a listed row's data_dir to reattach without creating a new sprint.",
      "Call sprint_new({ goal, git_dir, data_dir, context_notes }) only when no suitable active sprint exists.",
      "After binding, call overview() for sprint shape or next() for the active work window.",
    ],
    tools: [
      "info",
      "sprint_resume",
      "agent_attach", "agent_detach", "agent_heartbeat", "agent_list", "items_claimed",
      "item_claim", "item_release", "item_takeover", "item_progress",
      "sprint_new",
      "sprint_detach",
      "overview",
      "next",
      "subsprint_new",
      "item_add",
      "item_done",
      "changelog",
      "sprint_close",
    ],
    help: {
      resume: "Choose a row from sprints, then call sprint_resume({ git_dir, data_dir }) using the row's data_dir and the repository git_dir.",
      create: "If no existing row matches the work, call sprint_new({ goal, git_dir, data_dir, context_notes }) with a worktree-local gitignored data_dir such as <git_dir>/.sprinty.",
    },
    dashboard: await dashboard.info(),
    ...(await infoSprintListing(input, getStore)),
  };
}

async function infoSprintListing(input: z.infer<typeof S.InfoInput>, getStore: StoreProvider) {
  if (input.workspace_dirs?.length) return listWorkspaceSprints(input.workspace_dirs);
  if (input.data_dir || input.git_dir) return listSprints(defaultDataDir(input));
  try {
    const store = await getStore();
    return listSprints(store.dataDir);
  } catch {
    return { hint: "Pass data_dir or workspace_dirs to inspect existing Sprinty ledgers while this MCP session is unbound." };
  }
}

function defaultDataDir(input: { git_dir?: string | undefined; data_dir?: string | undefined }): string {
  if (input.data_dir) return input.data_dir;
  if (input.git_dir) return join(input.git_dir, ".sprinty");
  throw new Error("Missing data_dir. Pass data_dir, or pass git_dir to use <git_dir>/.sprinty.");
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

const OVERVIEW_DETAILS_MAX = 3;
const OVERVIEW_NOTES_MAX = 5;
const OVERVIEW_ARTIFACTS_MAX = 5;
const OVERVIEW_SUBSPRINTS_MAX = 10;
const RESPONSE_ARTIFACTS_MAX = 3;

function overview(view: SprintView, store: SprintStore) {
  const notes = overviewNotes(view, store);
  const artifacts = artifactRows(view).reverse();
  const subsprints = view.subsprints.slice(-OVERVIEW_SUBSPRINTS_MAX);
  return {
    info: "Bounded recent rows. Use subsprint_get, item_get, note_get, or artifact_get for full detail; subsprint_list and artifact_list expose the rest.",
    title: truncate(view.goal, 200),
    details: view.context_notes.slice(0, OVERVIEW_DETAILS_MAX).map((note) => truncate(note, 160)),
    total_notes: notes.length,
    total_artifacts: artifacts.length,
    total_subsprints: view.subsprints.length,
    truncated: notes.length > OVERVIEW_NOTES_MAX || artifacts.length > OVERVIEW_ARTIFACTS_MAX || view.subsprints.length > OVERVIEW_SUBSPRINTS_MAX,
    notes: notes.slice(0, OVERVIEW_NOTES_MAX),
    artifacts: artifacts.slice(0, OVERVIEW_ARTIFACTS_MAX),
    subsprints: subsprints.map((sub) => ({
      id: sub.id,
      title: truncate(sub.description, 100),
      status: sub.status,
      dependency_count: sub.dependencies.length,
      item_counts: itemCounts(view, sub.items),
    })),
  };
}

function overviewNotes(view: SprintView, store: SprintStore) {
  const itemIds = new Set(view.subsprints.flatMap((sub) => sub.items.map((item) => item.id)));
  return store.listAllNotes()
    .filter((note) => itemIds.has(note.item))
    .reverse()
    .map((note) => ({
      id: note.id,
      item: note.item,
      text: truncate(note.text, 120),
    }));
}

function renameCurrentWindow(view: ReturnType<typeof windowCurrent>) {
  const proposed = view.next.map(compactNextQueueRow);
  const proposedIds = new Set(proposed.map((item) => item.id));
  const artifacts = view.artifacts.slice(-RESPONSE_ARTIFACTS_MAX).reverse().map(compactArtifactRow);
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const recentArtifacts = view.recent_artifacts
    .filter((artifact) => !artifactIds.has(artifact.id))
    .slice(-1)
    .reverse()
    .map(compactArtifactRow);
  return {
    info: "Compact work window. Use item_get, subsprint_get, note_get, or artifact_get for full detail.",
    last_resolved: view.last_resolved,
    item: view.current ? compactNextQueueRow(view.current) : null,
    next: proposed,
    blocked: view.blocked_open,
    current_subsprint: view.current_subsprint ? compactNextSubsprintRow(view.current_subsprint) : null,
    relations: view.relations,
    artifacts,
    recent_artifacts: recentArtifacts,
    items_with_notes: compactNotePressure(view.items_with_notes),
    recent: view.recent_activity.filter((entry) => !proposedIds.has(entry.id)).slice(-3),
  };
}

function compactNotePressure(pressure: ReturnType<typeof windowCurrent>["items_with_notes"]) {
  return {
    open_count: pressure.open_count,
    budget: pressure.open_budget,
    ...(pressure.pressure ? { pressure: "Close or split noted items before adding notes elsewhere." } : {}),
    ...(pressure.truncated ? { truncated: true } : {}),
    items: pressure.items.map((item) => ({
      id: item.id,
      notes: item.note_count,
      ...(item.over_item_note_budget ? { over_budget: true } : {}),
    })),
  };
}

function selectSearchMatches(matches: SearchMatch[], limit: number): SearchMatch[] {
  const selected: SearchMatch[] = [];
  const seen = new Set<string>();
  const add = (match: SearchMatch) => {
    const key = `${match.type}:${match.id}:${match.tool_call}:${match.text}`;
    if (selected.length >= limit || seen.has(key)) return;
    selected.push(match);
    seen.add(key);
  };

  for (const type of ["sprint", "subsprint", "item", "note", "artifact", "update", "dependency", "follow_up"]) {
    const source = type === "note" || type === "artifact" || type === "update" ? [...matches].reverse() : matches;
    const match = source.find((candidate) => candidate.type === type);
    if (match) add(match);
  }
  for (const match of matches) add(match);
  return selected;
}

function compactNextQueueRow(item: ReturnType<typeof windowCurrent>["next"][number]) {
  return {
    id: item.id,
    subsprint_id: item.subsprint_id,
    title: item.title,
    high_priority: item.high_priority,
    status: item.status,
    dependencies: item.dependencies,
    ...(item.claim ? { claim: { owner: item.claim.owner_name, generation: item.claim.generation, claim_duration_ms: item.claim.claim_duration_ms, stall_reasons: item.claim.stall_reasons } } : {}),
  };
}

function compactNextSubsprintRow(sub: NonNullable<ReturnType<typeof windowCurrent>["current_subsprint"]>) {
  return {
    id: sub.id,
    description: truncate(sub.description, 100),
    status: sub.status,
    dependencies: sub.dependencies,
    goal_count: sub.goals.length,
    gate_count: sub.gates.length,
    note_count: sub.notes.length,
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
  const dependencies = dependencyResolver(view);
  return {
    open: items.filter((item) => item.status === "open").length,
    closed: items.filter((item) => item.status !== "open").length,
    blocked: items.filter((item) => item.status === "open" && dependencies(item).length > 0).length,
  };
}

function subsprintGet(view: SprintView, id: string) {
  const sub = view.subsprints.find((candidate) => candidate.id === id);
  if (!sub) throw new Error(`Unknown subsprint ${id}.`);
  return {
    info: "Full subsprint detail with compact item rows. Use item_get({ id }) for full untruncated item detail.",
    id: sub.id,
    title: sub.description,
    status: sub.status,
    goals: sub.goals,
    gates: sub.gates,
    dependencies: sub.dependencies,
    items: sub.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      dependency_count: item.dependencies.length,
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
    high_priority: item.high_priority,
    status: item.status,
    dependencies: item.dependencies,
    code_locations: item.code_locations,
    ...(item.actual_code_locations.length ? { actual_code_locations: item.actual_code_locations } : {}),
    ...(item.undeclared_code_locations.length ? { undeclared_code_locations: item.undeclared_code_locations } : {}),
    gates: item.gates,
    gate_timeout_ms: item.gate_timeout_ms,
    updates: compactStrings(item.updates, 5, 160),
    notes: compactStrings(item.notes, 5, 160),
    note_count: item.notes.length,
    update_count: item.updates.length,
    commit_id: item.commit_id,
    gate_results: item.gate_results,
    reason: item.reason,
    changelog: item.changelog,
    artifacts: item.artifacts.map(artifactRow),
    claim: item.claim,
  };
}

function compactClaim(claim: ItemView["claim"]) {
  return { owner: claim.owner_name, generation: claim.generation, claimed_at: claim.claimed_at, claim_duration_ms: claim.claim_duration_ms, owner_inactive_ms: claim.owner_inactive_ms, other_completions: claim.other_completions, stall_reasons: claim.stall_reasons };
}

function compactStrings(values: string[], maxRows: number, maxChars: number): string[] {
  return values.slice(-maxRows).reverse().map((value) => truncate(value, maxChars));
}

function noteList(store: SprintStore, id: string) {
  const notes = store.listNotes(id);
  return {
    info: "Compact view. Use note_get({ id }) for full untruncated detail.",
    total_notes: notes.length,
    notes: notes.slice(-5).reverse().map((note) => ({ id: note.id, text: truncate(note.text, 120) })),
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

function compactArtifactRow(artifact: SprintView["artifacts"][number]) {
  const relatedItems = artifact.related_items.slice(0, 3);
  return {
    id: artifact.id,
    title: truncate(artifact.title, 56),
    path: truncate(artifact.uri, 80),
    related_items: relatedItems,
    ...(relatedItems.length < artifact.related_items.length ? { related_item_count: artifact.related_items.length } : {}),
  };
}

function artifactRows(view: SprintView) {
  return allArtifacts(view).filter((artifact) => artifact.status === "active").map(compactArtifactRow);
}

function artifactList(view: SprintView, offset: number, limit: number) {
  const artifacts = artifactRows(view).reverse();
  const page = artifacts.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    info: "Newest active artifacts. Use artifact_get({ id }) for full detail and pass next_offset as offset to continue.",
    total_artifacts: artifacts.length,
    offset,
    artifacts: page,
    ...(nextOffset < artifacts.length ? { next_offset: nextOffset } : {}),
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
      .filter(([key]) => key !== "ts" && (!key.endsWith("_at") || ["claimed_at", "ended_at", "last_progress_at", "last_activity_at", "estimated_at", "finish_at", "finish_range_at"].includes(key)))
      .map(([key, child]) => [key, stripResponseNoise(child)]),
  );
}

function pruneEmptyResponseFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => pruneEmptyResponseFields(entry)).filter((entry) => entry !== undefined);
    return entries.length > 0 ? entries : undefined;
  }
  if (!value || typeof value !== "object") {
    if (value === null || value === undefined || value === "") return undefined;
    return value;
  }
  const source = value as Record<string, unknown>;
  const entries = Object.entries(source)
    .map(([key, child]) => {
      const pruned = key === "gate_timeout_ms" && child === null ? null : pruneEmptyResponseFields(child);
      return [key, pruned] as const;
    })
    .filter(([, child]) => child !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

interface SprintListResult {
  data_dir: string;
  current: string | null;
  sprints: Array<{ id: string; title: string; created: string; status: string; items: { open: number; closed: number; blocked: number } }>;
}

interface WorkspaceSprintListResult {
  workspace_dirs: string[];
  data_dirs: Array<{ data_dir: string; current: string | null; sprint_count: number }>;
  sprints: Array<{ data_dir: string; id: string; title: string; created: string; status: string; items: { open: number; closed: number; blocked: number } }>;
}

const sprintListCache = new Map<string, { signature: string; result: SprintListResult }>();

function listSprints(dataDir: string): SprintListResult {
  if (!existsSync(dataDir)) return { data_dir: dataDir, current: null, sprints: [] };
  return withDataLock(dataDir, () => listSprintsUnlocked(dataDir));
}

function listSprintsUnlocked(dataDir: string): SprintListResult {
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

function listWorkspaceSprints(dataDirs: string[]): WorkspaceSprintListResult {
  const seen = new Set<string>();
  const uniqueDataDirs = dataDirs.filter((dataDir) => {
    if (seen.has(dataDir)) return false;
    seen.add(dataDir);
    return true;
  });
  const listed = uniqueDataDirs.map(listSprints);
  return {
    workspace_dirs: uniqueDataDirs,
    data_dirs: listed.map((entry) => ({
      data_dir: entry.data_dir,
      current: entry.current,
      sprint_count: entry.sprints.length,
    })),
    sprints: listed.flatMap((entry) => entry.sprints.map((sprint) => ({ data_dir: entry.data_dir, ...sprint }))),
  };
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

function sprintListRow(id: string, view: SprintView): { id: string; title: string; created: string; status: string; items: { open: number; closed: number; blocked: number } } {
  const items = view.subsprints.flatMap((sub) => sub.items);
  const dependencies = dependencyResolver(view);
  const blocked = items.filter(item => item.status === "open" && dependencies(item).length > 0).length;
  return {
    id,
    title: truncate(view.goal, 120),
    created: view.created_at,
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
