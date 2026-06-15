import { z } from "zod";
import { ArtifactKind, ChangelogEntry } from "../domain/events.js";
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
export const SprintCloseInput = z.object({ coverage: z.union([CoverageInput, CoverageNotApplicableInput]).optional() });
export const SprintArchiveInput = z.object({ reason: z.string().min(1) });
export const ChangelogInput = z.object({});
export const InfoInput = z.object({});
export const CurrentInput = z.object({
  past: z.number().int().nonnegative().default(1),
  future: z.number().int().nonnegative().default(3),
});
export const SubsprintNewInput = z.object({
  description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
});
export const SpikeInput = SubsprintNewInput;
export const SpikeConcludeInput = z.object({ subsprint: z.string().min(1), conclusion: z.string().min(1) });
export const SpikeDeprecateInput = z.object({ subsprint: z.string().min(1), reason: z.string().min(1) });

export const ITEM_TITLE_MIN = 3;
export const ITEM_TITLE_MAX = 80;
export const ITEM_DESCRIPTION_MIN = 20;
export const ITEM_DESCRIPTION_MAX = 500;

export const ItemTitleInput = z.string().trim().min(ITEM_TITLE_MIN).max(ITEM_TITLE_MAX, {
  message: `Item title is too large for one tree row; split the work with split() or add smaller atomic items.`,
}).refine((value) => !/[\r\n]/.test(value), {
  message: "Item title must fit on one line.",
});
export const ItemDescriptionInput = z.string().trim().min(ITEM_DESCRIPTION_MIN).max(ITEM_DESCRIPTION_MAX, {
  message: `Item description is too large for one Sprinty item; split the work with split() or add smaller atomic items.`,
});

export const AddInput = z.object({
  subsprint: z.string().min(1),
  title: ItemTitleInput,
  description: ItemDescriptionInput,
  code_locations: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
});
export const UpdateInput = z.object({ target: z.string().min(1), note: z.string().min(1) });
export const DoneInput = z.object({
  item: z.string().min(1),
  commit_id: z.string().min(7),
  gate_results: z.array(GateResult).min(1),
  changelog: ChangelogEntry,
});
export const SplitInput = z.object({
  item: z.string().min(1),
  description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
});
export const DeprecateInput = z.object({ item: z.string().min(1), reason: z.string().min(1) });
export const NoteInput = z.object({ element: z.string().min(1), text: z.string().min(1) });
export const ArtifactInput = z.object({
  target: z.string().min(1).default("sprint"),
  kind: ArtifactKind,
  title: z.string().min(1),
  uri: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
});
export const ArtifactListInput = z.object({
  target: z.string().min(1).optional(),
  include_deprecated: z.boolean().default(false),
});
export const ArtifactAmendInput = z.object({
  artifact: z.string().min(1),
  kind: ArtifactKind.optional(),
  title: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  description: z.string().min(1).nullable().optional(),
});
export const ArtifactDeprecateInput = z.object({ artifact: z.string().min(1), reason: z.string().min(1) });
export const FollowUpInput = z.object({
  target: z.string().min(1).default("sprint"),
  description: z.string().min(1),
  bug_id: z.string().min(1).optional(),
  bug_ids: z.array(z.string().min(1)).optional(),
});
export const DependenciesInput = z.object({
  target: z.string().min(1),
  dependencies: z.array(z.string().min(1)).min(1),
});
export const SearchInput = z.object({
  pattern: z.string().min(1),
  context_lines: z.number().int().nonnegative().default(0),
});
export const DashboardInput = z.object({});
