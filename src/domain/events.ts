import { z } from "zod";
import { Disposition } from "./enums.js";
import { Gate, GateResult } from "./gates.js";

const base = {
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
};

export const SprintCreated = z.object({
  ...base, type: z.literal("sprint_created"),
  goal: z.string().min(1), worktree: z.string(), branch: z.string(), dir: z.string(),
});

export const SubsprintCreated = z.object({
  ...base, type: z.literal("subsprint_created"),
  subsprint_id: z.string(), description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  spawned_from_item: z.string().nullable(),
});

export const ItemAdded = z.object({
  ...base, type: z.literal("item_added"),
  item_id: z.string(), subsprint_id: z.string(), description: z.string().min(1),
  code_locations: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
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
});

export const NoteAdded = z.object({
  ...base, type: z.literal("note_added"),
  element_id: z.string(), text: z.string().min(1),
});

export const SprintClosed = z.object({
  ...base, type: z.literal("sprint_closed"),
  gate_results: z.array(GateResult),
});

export const LedgerEvent = z.discriminatedUnion("type", [
  SprintCreated, SubsprintCreated, ItemAdded, ItemUpdated, ItemResolved, NoteAdded, SprintClosed,
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;
