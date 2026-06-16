import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { project } from "../domain/projection.js";
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
  return { description, schema, handler: async (raw) => run(schema.parse(raw)) };
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
      async (i) => ({ ...(await bindStore({ git_dir: i.git_dir, data_dir: i.data_dir })).read(), orientation: orientation() })),
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
        return view;
      }),
    sprint_archive: def(S.SprintArchiveInput, "Archive the sprint with a recovery reason, bypassing normal close gates.",
      async (i) => {
        const view = (await getStore()).archiveSprint(i);
        await closeDashboard();
        return view;
      }),
    info: def(S.InfoInput, "The one status read: sprint, subsprints, statuses.",
      async () => (await getStore()).read()),
    current: def(S.CurrentInput, "Focus window: last closed item + next N, current subsprint notes, relevant artifacts, recent artifacts, recent activity, and dependency graph.",
      async (i) => windowCurrent((await getStore()).read(), i.past, i.future)),
    subsprint_new: def(S.SubsprintNewInput, "Create a subsprint (description, goals, gates).",
      async (i) => (await getStore()).createSubsprint(i)),
    spike: def(S.SpikeInput, "Create a spike subsprint for an idea or feature investigation.",
      async (i) => (await getStore()).createSpike(i)),
    spike_conclude: def(S.SpikeConcludeInput, "Close a spike with a required written conclusion once its items are resolved.",
      async (i) => (await getStore()).concludeSpike(i)),
    spike_deprecate: def(S.SpikeDeprecateInput, "Deprecate a spike with a reason; spikes are never deleted.",
      async (i) => (await getStore()).deprecateSpike(i)),
    add: def(S.AddInput, "Add an atomic item (bounded title, bounded description, code locations, gates — all required).",
      async (i) => (await getStore()).addItem(i)),
    update: def(S.UpdateInput, "Attach intermediate info to an item or subsprint.",
      async (i) => (await getStore()).updateItem(i)),
    done: def(S.DoneInput, "Resolve an item as completed with commit id + gate results.",
      async (i) => (await getStore()).done(i)),
    split: def(S.SplitInput, "Resolve an item as split, creating a seeded subsprint atomically.",
      async (i) => (await getStore()).split(i)),
    deprecate: def(S.DeprecateInput, "Resolve an item as deprecated with a reason.",
      async (i) => (await getStore()).deprecate(i)),
    note: def(S.NoteInput, "Add a note to a specific item id. Notes are not substitutes for add(); create items for trackable work.",
      async (i) => (await getStore()).addNote(i)),
    artifact: def(S.ArtifactInput, "Record a durable sprint artifact such as a spec, plan, report, dashboard, or log.",
      async (i) => (await getStore()).addArtifact(i)),
    artifact_add: def(S.ArtifactInput, "Record a durable sprint artifact such as a spec, plan, report, dashboard, or log.",
      async (i) => (await getStore()).addArtifact(i)),
    artifact_list: def(S.ArtifactListInput, "List active artifacts, optionally scoped to a target or including deprecated artifacts.",
      async (i) => (await getStore()).listArtifacts(i)),
    artifact_amend: def(S.ArtifactAmendInput, "Amend an active artifact by recording an immutable amendment event.",
      async (i) => (await getStore()).amendArtifact(i)),
    artifact_deprecate: def(S.ArtifactDeprecateInput, "Deprecate an artifact with a reason instead of deleting it.",
      async (i) => (await getStore()).deprecateArtifact(i)),
    follow_up: def(S.FollowUpInput, "Record a follow-up that must reference one or more bug ids.",
      async (i) => (await getStore()).addFollowUp(i)),
    dependencies: def(S.DependenciesInput, "Add dependency edges from a target item/subsprint to existing ids.",
      async (i) => (await getStore()).addDependencies(i)),
    search: def(S.SearchInput, "Regex search over the current sprint's immutable ledger, with context lines.",
      async (i) => (await getStore()).search(i.pattern, i.context_lines)),
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
      "One sprint per session. Build item-driven: subsprint_new -> add -> done/split/deprecate. " +
      "Start with explicit git_dir and a worktree-scoped, uncommitted data_dir, such as <git_dir>/.sprinty when it is gitignored, so Sprinty cannot bind to a temp MCP cwd or shared state. " +
      "Items need a short title, bounded description, code_locations, and gates; keep them atomic. Each subsprint should represent one feature. " +
      "After sprint_new, call dashboard() and show the localhost URL to the human. Resolve every item, then sprint_close re-runs gates.",
  };
}

function listSprints(dataDir: string): { data_dir: string; current: string | null; sprints: Array<{ id: string; goal: string; status: string; created_at: string; closed_at: string | null; worktree: string; branch: string; dir: string; data_dir: string }> } {
  const current = readCurrent(dataDir);
  if (!existsSync(dataDir)) return { data_dir: dataDir, current, sprints: [] };
  const sprints = readdirSync(dataDir)
    .map((file) => /^(\d+)\.jsonl$/.exec(file)?.[1])
    .filter((id): id is string => Boolean(id))
    .sort()
    .map((id) => {
      const events = readFileSync(join(dataDir, `${id}.jsonl`), "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
      const view = project(events);
      if (!view) throw new Error(`Sprint ledger ${id} in ${dataDir} is empty or unreadable.`);
      return {
        id,
        goal: view.goal,
        status: view.status,
        created_at: view.created_at,
        closed_at: view.closed_at,
        worktree: view.worktree,
        branch: view.branch,
        dir: view.dir,
        data_dir: view.data_dir,
      };
    });
  return { data_dir: dataDir, current, sprints };
}

function readCurrent(dataDir: string): string | null {
  const pointer = join(dataDir, "current");
  if (!existsSync(pointer)) return null;
  const id = readFileSync(pointer, "utf8").trim();
  return id.length > 0 ? id : null;
}
