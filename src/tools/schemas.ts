import { z } from "zod";
import { Gate, GateResult } from "../domain/gates.js";

export const SprintNewInput = z.object({ goal: z.string().min(1) });
export const SprintCloseInput = z.object({});
export const InfoInput = z.object({});
export const CurrentInput = z.object({
  past: z.number().int().nonnegative().default(1),
  future: z.number().int().nonnegative().default(3),
});
export const SubsprintNewInput = z.object({
  description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
});
export const AddInput = z.object({
  subsprint: z.string().min(1),
  description: z.string().min(1),
  code_locations: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
});
export const UpdateInput = z.object({ target: z.string().min(1), note: z.string().min(1) });
export const DoneInput = z.object({
  item: z.string().min(1),
  commit_id: z.string().min(7),
  gate_results: z.array(GateResult).min(1),
});
export const SplitInput = z.object({
  item: z.string().min(1),
  description: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  gates: z.array(Gate).min(1),
});
export const DeprecateInput = z.object({ item: z.string().min(1), reason: z.string().min(1) });
export const NoteInput = z.object({ element: z.string().min(1), text: z.string().min(1) });
export const SearchInput = z.object({
  pattern: z.string().min(1),
  context_lines: z.number().int().nonnegative().default(0),
});
export const DashboardInput = z.object({});
