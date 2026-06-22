import { z } from "zod";
import { ChangelogEntry } from "../domain/events.js";
import { Gate, GateResult } from "../domain/gates.js";

export const CoverageInput = z.object({
  path: z.string().min(1),
  format: z.literal("lcov"),
  command: z.string().min(1).optional(),
});
export const CoverageNotApplicableInput = z.object({
  not_applicable: z.string().min(1),
});

export const SprintNewInput = z.object({
  goal: z.string().min(1),
  git_dir: z.string().min(1),
  data_dir: z.string().min(1),
  context_notes: z.array(z.string().min(1)).default([]),
});
export const SprintResumeInput = z.object({
  git_dir: z.string().min(1),
  data_dir: z.string().min(1),
});
export const SprintDetachInput = z.object({});
export const SprintListInput = z.object({
  data_dir: z.string().min(1).optional(),
});
export const SprintCloseInput = z.object({ coverage: z.union([CoverageInput, CoverageNotApplicableInput]).optional() });
export const SprintArchiveInput = z.object({ reason: z.string().min(1) });
export const ChangelogInput = z.object({});
export const OverviewInput = z.object({});
export const NextInput = z.object({
  past: z.number().int().nonnegative().default(1),
  future: z.number().int().nonnegative().optional(),
  future_per_subsprint: z.number().int().nonnegative().default(1),
  include_high_priority: z.boolean().default(true),
});
export const SubsprintNewInput = z.object({
  description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
});
export const SubsprintGetInput = z.object({ id: z.string().min(1) });
export const SubsprintListInput = z.object({});

export const ITEM_TITLE_MIN = 3;
export const ITEM_TITLE_MAX = 80;
export const ITEM_DESCRIPTION_MIN = 20;
export const ITEM_DESCRIPTION_MAX = 500;

export const ItemTitleInput = z.string().trim().min(ITEM_TITLE_MIN).max(ITEM_TITLE_MAX, {
  message: `Item title is too large for one tree row; create more than one item with item_add() or split the work into smaller atomic items.`,
}).refine((value) => !/[\r\n]/.test(value), {
  message: "Item title must fit on one line.",
});
export const ItemDescriptionInput = z.string().trim().min(ITEM_DESCRIPTION_MIN).max(ITEM_DESCRIPTION_MAX, {
  message: `Item description is too large for one Sprinty item; create more than one item with item_add() instead of using notes or one oversized item.`,
});

export const AddInput = z.object({
  subsprint: z.string().min(1),
  title: ItemTitleInput,
  description: ItemDescriptionInput,
  high_priority: z.boolean().default(false),
  code_locations: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
});
export const ItemAddInput = AddInput;
export const ItemGetInput = z.object({ id: z.string().min(1) });
export const ItemUpdateInput = z.object({
  id: z.string().min(1),
  title: ItemTitleInput.optional(),
  description: ItemDescriptionInput.optional(),
  high_priority: z.boolean().optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  note: z.string().min(1).optional(),
});
export const DoneInput = z.object({
  id: z.string().min(1),
  commit_id: z.string().min(7),
  gate_results: z.array(GateResult).min(1),
  changelog: ChangelogEntry,
});
export const ItemDoneInput = DoneInput;
export const SplitInput = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
});
export const ItemSplitInput = SplitInput;
export const DeprecateInput = z.object({ id: z.string().min(1), reason: z.string().min(1) });
export const ItemDeprecateInput = DeprecateInput;
export const NoteInput = z.object({ id: z.string().min(1), text: z.string().min(1) });
export const NoteGetInput = z.object({ id: z.string().min(1) });
export const NoteListInput = z.object({ id: z.string().min(1) });
export const NoteUpdateInput = z.object({ id: z.string().min(1), text: z.string().min(1) });
export const ArtifactAddInput = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  path: z.string().min(1),
  description: z.string().min(1).optional(),
  related_items: z.array(z.string().min(1)).default([]),
});
export const ArtifactGetInput = z.object({ id: z.string().min(1) });
export const ArtifactListInput = z.object({});
export const ArtifactUpdateInput = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  related_items: z.array(z.string().min(1)).optional(),
});
export const SearchInput = z.object({
  pattern: z.string().min(1),
  context_size: z.number().int().positive().max(4096).default(512),
});
export const DashboardInfoInput = z.object({});
export const DashboardRestartInput = z.object({});
