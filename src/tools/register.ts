import { z } from "zod";
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

export function buildToolHandlers(getStore: StoreProvider, openDashboard: () => Promise<string>): ToolHandlers {
  return {
    sprint_new: def(S.SprintNewInput, "Start a sprint; returns orientation (skills + how this works).",
      async (i) => ({ ...(await getStore()).createSprint(i.goal, i.context_notes), orientation: orientation() })),
    sprint_close: def(S.SprintCloseInput, "Close the sprint after a programmatic re-check of all gates.",
      async (i) => (await getStore()).closeSprint(i)),
    sprint_archive: def(S.SprintArchiveInput, "Archive the sprint with a recovery reason, bypassing normal close gates.",
      async (i) => (await getStore()).archiveSprint(i)),
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
    add: def(S.AddInput, "Add an item (description, code locations, gates — all required).",
      async (i) => (await getStore()).addItem(i)),
    update: def(S.UpdateInput, "Attach intermediate info to an item or subsprint.",
      async (i) => (await getStore()).updateItem(i)),
    done: def(S.DoneInput, "Resolve an item as completed with commit id + gate results.",
      async (i) => (await getStore()).done(i)),
    split: def(S.SplitInput, "Resolve an item as split, creating a seeded subsprint atomically.",
      async (i) => (await getStore()).split(i)),
    deprecate: def(S.DeprecateInput, "Resolve an item as deprecated with a reason.",
      async (i) => (await getStore()).deprecate(i)),
    note: def(S.NoteInput, "Add a note to an item or subsprint.",
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
      "Items need description + code_locations + gates. Each subsprint should represent one feature. " +
      "After sprint_new, call dashboard() and show the localhost URL to the human. Resolve every item, then sprint_close re-runs gates.",
  };
}
