import { z } from "zod";

export const GateKind = z.enum(["test", "typecheck", "build", "command", "manual"]);
export type GateKind = z.infer<typeof GateKind>;

export const Disposition = z.enum(["completed", "split", "deprecated"]);
export type Disposition = z.infer<typeof Disposition>;

export const ItemStatus = z.enum(["open", "completed", "split", "deprecated"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const ChangelogVerb = z.enum(["added", "fixed", "changed", "removed", "deprecated", "security"]);
export type ChangelogVerb = z.infer<typeof ChangelogVerb>;

export const SubsprintStatus = z.enum(["open", "closed", "deprecated"]);
export type SubsprintStatus = z.infer<typeof SubsprintStatus>;

export const SprintStatus = z.enum(["active", "closed", "archived"]);
export type SprintStatus = z.infer<typeof SprintStatus>;

export const EventType = z.enum([
  "sprint_created", "subsprint_created", "item_added",
  "item_updated", "item_resolved", "note_added", "dependencies_added",
  "artifact_added", "artifact_amended", "artifact_deprecated",
  "follow_up_added", "spike_concluded", "spike_deprecated",
  "sprint_closed", "sprint_archived",
]);
export type EventType = z.infer<typeof EventType>;
