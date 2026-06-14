import { z } from "zod";

export const GateKind = z.enum(["test", "typecheck", "build", "command", "manual"]);
export type GateKind = z.infer<typeof GateKind>;

export const Disposition = z.enum(["completed", "split", "deprecated"]);
export type Disposition = z.infer<typeof Disposition>;

export const ItemStatus = z.enum(["open", "resolved"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const SubsprintStatus = z.enum(["open", "closed"]);
export type SubsprintStatus = z.infer<typeof SubsprintStatus>;

export const SprintStatus = z.enum(["active", "closed"]);
export type SprintStatus = z.infer<typeof SprintStatus>;

export const EventType = z.enum([
  "sprint_created", "subsprint_created", "item_added",
  "item_updated", "item_resolved", "note_added", "sprint_closed",
]);
export type EventType = z.infer<typeof EventType>;
