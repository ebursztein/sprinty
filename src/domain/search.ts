import type { LedgerEvent } from "./events.js";

export interface SearchMatch {
  id: string;
  type: "sprint" | "subsprint" | "item" | "note" | "artifact" | "update" | "dependency" | "follow_up";
  text: string;
  tool_call: string;
}

export function renderEvent(e: LedgerEvent): string {
  switch (e.type) {
    case "sprint_created": return `[sprint] goal: ${e.goal}`;
    case "subsprint_created": return `[${e.subsprint_id}] subsprint: ${e.description} | goals: ${e.goals.join("; ")} | gates: ${e.gates.map((g) => `${g.kind}:${g.spec}`).join(", ")}${e.spawned_from_item ? ` | from ${e.spawned_from_item}` : ""}`;
    case "item_added": return `[${e.item_id}] item: ${e.description} @ ${e.code_locations.join(", ")} | gates: ${e.gates.map((g) => `${g.kind}:${g.spec}`).join(", ")}`;
    case "item_updated": return `[${e.target_id}] update: ${e.note}`;
    case "item_resolved": return `[${e.item_id}] resolved: ${e.disposition}${e.commit_id ? ` @${e.commit_id}` : ""}${e.reason ? ` reason: ${e.reason}` : ""}${e.spawned_subsprint ? ` -> ${e.spawned_subsprint}` : ""}`;
    case "note_added": return `[${e.element_id}] note: ${e.text}`;
    case "note_updated": return `[${e.note_id}] note updated: ${e.text}`;
    case "dependencies_added": return `[${e.target_id}] dependencies: ${e.dependencies.join(", ")}`;
    case "artifact_added": return `[${e.target_id}] artifact ${e.artifact_id}: ${e.kind} ${e.title} @ ${e.uri}${e.description ? ` | ${e.description}` : ""}`;
    case "artifact_amended": return `[${e.artifact_id}] artifact amended${e.title ? ` title: ${e.title}` : ""}${e.uri ? ` uri: ${e.uri}` : ""}`;
    case "artifact_deprecated": return `[${e.artifact_id}] artifact deprecated: ${e.reason}`;
    case "follow_up_added": return `[${e.target_id}] follow-up ${e.follow_up_id}: ${e.bug_ids.join(", ")} ${e.description}`;
    case "spike_concluded": return `[${e.subsprint_id}] spike concluded: ${e.conclusion}`;
    case "spike_deprecated": return `[${e.subsprint_id}] spike deprecated: ${e.reason}`;
    case "sprint_closed": return `[sprint] closed`;
    case "sprint_archived": return `[sprint] archived: ${e.reason}`;
  }
}

export function searchLedger(events: LedgerEvent[], pattern: string, contextSize: number): SearchMatch[] {
  const re = new RegExp(pattern);
  const lines = events.map(renderEvent);
  const out: SearchMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = re.exec(line);
    if (!match) continue;
    const event = events[i]!;
    out.push({
      id: searchId(event),
      type: searchType(event),
      text: excerpt(line, match.index, match[0]?.length ?? 0, contextSize),
      tool_call: toolCall(event),
    });
  }
  return out;
}

function excerpt(text: string, index: number, matchLength: number, contextSize: number): string {
  const contextAroundMatch = Math.max(0, contextSize - matchLength);
  const eachSide = Math.floor(contextAroundMatch / 2);
  const start = Math.max(0, index - eachSide);
  const end = Math.min(text.length, index + matchLength + eachSide);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function searchId(e: LedgerEvent): string {
  switch (e.type) {
    case "sprint_created":
    case "sprint_closed":
    case "sprint_archived":
      return "sprint";
    case "subsprint_created":
    case "spike_concluded":
    case "spike_deprecated":
      return e.subsprint_id;
    case "item_added":
    case "item_resolved":
      return e.item_id;
    case "item_updated":
    case "dependencies_added":
    case "follow_up_added":
      return e.target_id;
    case "note_added":
      return noteId(e.seq);
    case "note_updated":
      return e.note_id;
    case "artifact_added":
    case "artifact_amended":
    case "artifact_deprecated":
      return e.artifact_id;
  }
}

function noteId(seq: number): string {
  return `N${String(seq).padStart(3, "0")}`;
}

function searchType(e: LedgerEvent): SearchMatch["type"] {
  switch (e.type) {
    case "sprint_created":
    case "sprint_closed":
    case "sprint_archived":
      return "sprint";
    case "subsprint_created":
    case "spike_concluded":
    case "spike_deprecated":
      return "subsprint";
    case "item_added":
    case "item_resolved":
      return "item";
    case "note_added":
    case "note_updated":
      return "note";
    case "artifact_added":
    case "artifact_amended":
    case "artifact_deprecated":
      return "artifact";
    case "item_updated":
      return "update";
    case "dependencies_added":
      return "dependency";
    case "follow_up_added":
      return "follow_up";
  }
}

function toolCall(e: LedgerEvent): string {
  switch (e.type) {
    case "sprint_created":
    case "sprint_closed":
    case "sprint_archived":
      return "overview()";
    case "artifact_added":
      return `artifact_get({ id: "${e.artifact_id}" })`;
    case "artifact_amended":
    case "artifact_deprecated":
      return `artifact_get({ id: "${e.artifact_id}" })`;
    case "note_added":
      return `note_get({ id: "${noteId(e.seq)}" })`;
    case "note_updated":
      return `note_get({ id: "${e.note_id}" })`;
    case "subsprint_created":
    case "spike_concluded":
    case "spike_deprecated":
      return `subsprint_get({ id: "${e.subsprint_id}" })`;
    default:
      return `item_get({ id: "${searchId(e)}" })`;
  }
}
