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

export const SprintCreated = z.object({
  ...base, type: z.literal("sprint_created"),
  goal: z.string().min(1), worktree: z.string(), branch: z.string(), dir: z.string(),
  context_notes: z.array(z.string().min(1)).default([]),
});

export const SubsprintCreated = z.object({
  ...base, type: z.literal("subsprint_created"),
  subsprint_id: z.string(), description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  spawned_from_item: z.string().nullable(),
  dependencies: z.array(z.string().min(1)).default([]),
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

export const SprintClosed = z.object({
  ...base, type: z.literal("sprint_closed"),
  gate_results: z.array(GateResult),
  coverage: CoverageSummary.nullable().default(null),
});

export const LedgerEvent = z.discriminatedUnion("type", [
  SprintCreated, SubsprintCreated, ItemAdded, ItemUpdated, ItemResolved, NoteAdded, DependenciesAdded, SprintClosed,
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;
