import { z } from "zod";
import { GateKind } from "./enums.js";

export const Gate = z.object({
  kind: GateKind,
  spec: z.string().min(1),
});
export type Gate = z.infer<typeof Gate>;

export const GateResult = z.object({
  kind: GateKind,
  spec: z.string().min(1),
  passed: z.boolean(),
  evidence: z.string().min(1),
});
export type GateResult = z.infer<typeof GateResult>;
