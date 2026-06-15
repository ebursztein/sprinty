import { z } from "zod";
import { GateKind } from "./enums.js";

export const Gate = z.object({
  kind: GateKind,
  spec: z.string().min(1),
  category: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
});
export type Gate = z.infer<typeof Gate>;

export const GateResult = z.object({
  kind: GateKind,
  spec: z.string().min(1),
  cwd: z.string().min(1).optional(),
  passed: z.boolean(),
  evidence: z.string().min(1),
  supersedes: Gate.optional(),
  supersession_reason: z.string().min(1).optional(),
}).superRefine((result, ctx) => {
  if (result.supersedes && !result.supersession_reason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supersession_reason"],
      message: "Gate supersession requires a reason.",
    });
  }
});
export type GateResult = z.infer<typeof GateResult>;
