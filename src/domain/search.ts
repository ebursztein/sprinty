import type { LedgerEvent } from "./events.js";

export interface SearchMatch { line: number; text: string; context: string[]; }

export function renderEvent(e: LedgerEvent): string {
  switch (e.type) {
    case "sprint_created": return `[sprint] goal: ${e.goal}`;
    case "subsprint_created": return `[${e.subsprint_id}] subsprint: ${e.description} | goals: ${e.goals.join("; ")} | gates: ${e.gates.map((g) => `${g.kind}:${g.spec}`).join(", ")}${e.spawned_from_item ? ` | from ${e.spawned_from_item}` : ""}`;
    case "item_added": return `[${e.item_id}] item: ${e.description} @ ${e.code_locations.join(", ")} | gates: ${e.gates.map((g) => `${g.kind}:${g.spec}`).join(", ")}`;
    case "item_updated": return `[${e.target_id}] update: ${e.note}`;
    case "item_resolved": return `[${e.item_id}] resolved: ${e.disposition}${e.commit_id ? ` @${e.commit_id}` : ""}${e.reason ? ` reason: ${e.reason}` : ""}${e.spawned_subsprint ? ` -> ${e.spawned_subsprint}` : ""}`;
    case "note_added": return `[${e.element_id}] note: ${e.text}`;
    case "dependencies_added": return `[${e.target_id}] dependencies: ${e.dependencies.join(", ")}`;
    case "artifact_added": return `[${e.target_id}] artifact ${e.artifact_id}: ${e.kind} ${e.title} @ ${e.uri}${e.description ? ` | ${e.description}` : ""}`;
    case "sprint_closed": return `[sprint] closed`;
  }
}

export function searchLedger(events: LedgerEvent[], pattern: string, contextLines: number): SearchMatch[] {
  const re = new RegExp(pattern);
  const lines = events.map(renderEvent);
  const out: SearchMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i]!)) continue;
    const from = Math.max(0, i - contextLines);
    const to = Math.min(lines.length - 1, i + contextLines);
    out.push({ line: i, text: lines[i]!, context: lines.slice(from, to + 1) });
  }
  return out;
}
