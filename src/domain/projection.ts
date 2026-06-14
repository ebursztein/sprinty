import type { LedgerEvent } from "./events.js";
import type { Gate, GateResult } from "./gates.js";
import type { Disposition, ItemStatus, SubsprintStatus, SprintStatus } from "./enums.js";

export interface ItemView {
  id: string;
  subsprint_id: string;
  description: string;
  code_locations: string[];
  gates: Gate[];
  status: ItemStatus;
  disposition: Disposition | null;
  commit_id: string | null;
  gate_results: GateResult[];
  reason: string | null;
  spawned_subsprint: string | null;
  updates: string[];
  notes: string[];
}

export interface SubsprintView {
  id: string;
  description: string;
  goals: string[];
  gates: Gate[];
  status: SubsprintStatus;
  spawned_from_item: string | null;
  notes: string[];
  items: ItemView[];
}

export interface SprintView {
  goal: string;
  worktree: string;
  branch: string;
  dir: string;
  status: SprintStatus;
  subsprints: SubsprintView[];
}

export function project(events: LedgerEvent[]): SprintView | null {
  // One ledger file = one sprint. Replay its events into a SprintView.
  let sprint: SprintView | null = null;
  const subsprints = new Map<string, SubsprintView>();
  const items = new Map<string, ItemView>();

  for (const e of events) {
    switch (e.type) {
      case "sprint_created":
        sprint = { goal: e.goal, worktree: e.worktree, branch: e.branch, dir: e.dir, status: "active", subsprints: [] };
        break;
      case "subsprint_created": {
        const sub: SubsprintView = {
          id: e.subsprint_id, description: e.description, goals: e.goals, gates: e.gates,
          status: "open", spawned_from_item: e.spawned_from_item, notes: [], items: [],
        };
        subsprints.set(sub.id, sub);
        sprint?.subsprints.push(sub);
        break;
      }
      case "item_added": {
        const item: ItemView = {
          id: e.item_id, subsprint_id: e.subsprint_id, description: e.description,
          code_locations: e.code_locations, gates: e.gates, status: "open",
          disposition: null, commit_id: null, gate_results: [], reason: null,
          spawned_subsprint: null, updates: [], notes: [],
        };
        items.set(item.id, item);
        subsprints.get(e.subsprint_id)?.items.push(item);
        break;
      }
      case "item_updated":
        items.get(e.target_id)?.updates.push(e.note);
        break;
      case "item_resolved": {
        const item = items.get(e.item_id);
        if (item) {
          item.status = "resolved";
          item.disposition = e.disposition;
          item.commit_id = e.commit_id;
          item.gate_results = e.gate_results;
          item.reason = e.reason;
          item.spawned_subsprint = e.spawned_subsprint;
        }
        break;
      }
      case "note_added": {
        const item = items.get(e.element_id);
        if (item) { item.notes.push(e.text); break; }
        subsprints.get(e.element_id)?.notes.push(e.text);
        break;
      }
      case "sprint_closed":
        if (sprint) sprint.status = "closed";
        break;
    }
  }

  for (const sub of subsprints.values()) {
    sub.status = sub.items.length > 0 && sub.items.every((i) => i.status === "resolved") ? "closed" : "open";
  }
  return sprint;
}
