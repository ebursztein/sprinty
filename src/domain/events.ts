import { z } from "zod";
import { ChangelogVerb, Disposition } from "./enums.js";
import { ChangeMap } from "./change-map.js";
import { CoverageSummary } from "./coverage.js";
import { Gate, GateResult } from "./gates.js";

const base = {
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
};

export const ChangelogEntry = z.object({
  verb: ChangelogVerb,
  line: z.string().min(1),
});
export type ChangelogEntry = z.infer<typeof ChangelogEntry>;

export const ArtifactKind = z.enum(["spec", "plan", "report", "dashboard", "log", "other"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const SprintCreated = z.object({
  ...base, type: z.literal("sprint_created"),
  goal: z.string().min(1), worktree: z.string(), branch: z.string(), dir: z.string(),
  data_dir: z.string().default(""),
  context_notes: z.array(z.string().min(1)).default([]),
});

export const SubsprintCreated = z.object({
  ...base, type: z.literal("subsprint_created"),
  subsprint_id: z.string(), description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  spawned_from_item: z.string().nullable(),
  dependencies: z.array(z.string().min(1)).default([]),
  kind: z.enum(["feature", "spike"]).default("feature"),
});

export const ItemAdded = z.object({
  ...base, type: z.literal("item_added"),
  item_id: z.string(), subsprint_id: z.string(), description: z.string().min(1),
  code_locations: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
});

export const ItemUpdated = z.object({
  ...base, type: z.literal("item_updated"),
  target_id: z.string(), note: z.string().min(1),
});

export const ItemResolved = z.object({
  ...base, type: z.literal("item_resolved"),
  item_id: z.string(),
  disposition: Disposition,
  commit_id: z.string().nullable(),
  gate_results: z.array(GateResult),
  spawned_subsprint: z.string().nullable(),
  reason: z.string().nullable(),
  changelog: ChangelogEntry.nullable().default(null),
  change_map: ChangeMap.default({ by_file: [], by_directory: [], by_language: [], hotspots: [] }),
});

export const NoteAdded = z.object({
  ...base, type: z.literal("note_added"),
  element_id: z.string(), text: z.string().min(1),
});

export const DependenciesAdded = z.object({
  ...base, type: z.literal("dependencies_added"),
  target_id: z.string().min(1),
  dependencies: z.array(z.string().min(1)).min(1),
});

export const ArtifactAdded = z.object({
  ...base, type: z.literal("artifact_added"),
  artifact_id: z.string().min(1),
  target_id: z.string().min(1),
  kind: ArtifactKind,
  title: z.string().min(1),
  uri: z.string().min(1),
  description: z.string().min(1).nullable().default(null),
});

export const ArtifactAmended = z.object({
  ...base, type: z.literal("artifact_amended"),
  artifact_id: z.string().min(1),
  kind: ArtifactKind.optional(),
  title: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  description: z.string().min(1).nullable().optional(),
});

export const ArtifactDeprecated = z.object({
  ...base, type: z.literal("artifact_deprecated"),
  artifact_id: z.string().min(1),
  reason: z.string().min(1),
});

export const FollowUpAdded = z.object({
  ...base, type: z.literal("follow_up_added"),
  follow_up_id: z.string().min(1),
  target_id: z.string().min(1),
  description: z.string().min(1),
  bug_ids: z.array(z.string().min(1)).min(1),
});

export const SpikeConcluded = z.object({
  ...base, type: z.literal("spike_concluded"),
  subsprint_id: z.string().min(1),
  conclusion: z.string().min(1),
});

export const SpikeDeprecated = z.object({
  ...base, type: z.literal("spike_deprecated"),
  subsprint_id: z.string().min(1),
  reason: z.string().min(1),
});

export const SprintClosed = z.object({
  ...base, type: z.literal("sprint_closed"),
  gate_results: z.array(GateResult),
  coverage: CoverageSummary.nullable().default(null),
});

export const SprintArchived = z.object({
  ...base,
  type: z.literal("sprint_archived"),
  reason: z.string().min(1),
});

export const LedgerEvent = z.discriminatedUnion("type", [
  SprintCreated, SubsprintCreated, ItemAdded, ItemUpdated, ItemResolved, NoteAdded, DependenciesAdded,
  ArtifactAdded, ArtifactAmended, ArtifactDeprecated, FollowUpAdded, SpikeConcluded, SpikeDeprecated,
  SprintClosed, SprintArchived,
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;
