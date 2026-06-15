import type { ArtifactKind, ChangelogEntry, LedgerEvent } from "./events.js";
import type { Gate, GateResult } from "./gates.js";
import type { Disposition, ItemStatus, SubsprintStatus, SprintStatus } from "./enums.js";
import type { CoverageSummary } from "./coverage.js";
import { aggregateChangeMaps, emptyChangeMap, type ChangeMap } from "./change-map.js";
import { buildDependencyGraph, type DependencyGraph } from "./graph.js";

export interface ItemView {
  id: string;
  subsprint_id: string;
  description: string;
  created_at: string;
  resolved_at: string | null;
  code_locations: string[];
  gates: Gate[];
  status: ItemStatus;
  disposition: Disposition | null;
  dependencies: string[];
  commit_id: string | null;
  gate_results: GateResult[];
  reason: string | null;
  spawned_subsprint: string | null;
  changelog: ChangelogEntry | null;
  change_map: ChangeMap;
  updates: string[];
  notes: string[];
  artifacts: ArtifactView[];
}

export interface ArtifactView {
  id: string;
  target_id: string;
  kind: ArtifactKind;
  title: string;
  uri: string;
  description: string | null;
  created_at: string;
}

export interface ChangelogLine {
  item: string;
  subsprint: string;
  verb: ChangelogEntry["verb"];
  line: string;
}

export interface SubsprintView {
  id: string;
  description: string;
  created_at: string;
  closed_at: string | null;
  goals: string[];
  gates: Gate[];
  status: SubsprintStatus;
  spawned_from_item: string | null;
  dependencies: string[];
  notes: string[];
  artifacts: ArtifactView[];
  changelog: Array<Omit<ChangelogLine, "subsprint">>;
  change_map: ChangeMap;
  items: ItemView[];
}

export interface SprintView {
  goal: string;
  worktree: string;
  branch: string;
  dir: string;
  context_notes: string[];
  created_at: string;
  closed_at: string | null;
  status: SprintStatus;
  subsprints: SubsprintView[];
  timeline: TimelineEntry[];
  graph: DependencyGraph;
  artifacts: ArtifactView[];
  changelog: ChangelogLine[];
  change_map: ChangeMap;
  coverage: CoverageSummary | null;
}

export interface TimelineEntry {
  seq: number;
  ts: string;
  type: LedgerEvent["type"];
  id: string;
  text: string;
}

export function project(events: LedgerEvent[]): SprintView | null {
  // One ledger file = one sprint. Replay its events into a SprintView.
  let sprint: SprintView | null = null;
  const subsprints = new Map<string, SubsprintView>();
  const items = new Map<string, ItemView>();
  const timeline: TimelineEntry[] = [];

  for (const e of events) {
    switch (e.type) {
      case "sprint_created":
        sprint = {
          goal: e.goal, worktree: e.worktree, branch: e.branch, dir: e.dir,
          context_notes: e.context_notes ?? [], created_at: e.ts, closed_at: null, status: "active",
          subsprints: [], timeline, graph: buildDependencyGraph([], []), artifacts: [],
          changelog: [], change_map: emptyChangeMap(), coverage: null,
        };
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: "sprint", text: e.goal });
        break;
      case "subsprint_created": {
        const sub: SubsprintView = {
          id: e.subsprint_id, description: e.description, created_at: e.ts, closed_at: null,
          goals: e.goals, gates: e.gates,
          status: "open", spawned_from_item: e.spawned_from_item, dependencies: e.dependencies ?? [],
          notes: [], artifacts: [], changelog: [], change_map: emptyChangeMap(), items: [],
        };
        subsprints.set(sub.id, sub);
        sprint?.subsprints.push(sub);
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: e.subsprint_id, text: e.description });
        break;
      }
      case "item_added": {
        const item: ItemView = {
          id: e.item_id, subsprint_id: e.subsprint_id, description: e.description,
          created_at: e.ts, resolved_at: null,
          code_locations: e.code_locations, gates: e.gates, status: "open",
          disposition: null, dependencies: e.dependencies ?? [], commit_id: null, gate_results: [], reason: null,
          spawned_subsprint: null, changelog: null, change_map: emptyChangeMap(), updates: [], notes: [],
          artifacts: [],
        };
        items.set(item.id, item);
        subsprints.get(e.subsprint_id)?.items.push(item);
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: e.item_id, text: e.description });
        break;
      }
      case "item_updated":
        items.get(e.target_id)?.updates.push(e.note);
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: e.target_id, text: e.note });
        break;
      case "item_resolved": {
        const item = items.get(e.item_id);
        if (item) {
          item.status = e.disposition;
          item.resolved_at = e.ts;
          item.disposition = e.disposition;
          item.commit_id = e.commit_id;
          item.gate_results = e.gate_results;
          item.reason = e.reason;
          item.spawned_subsprint = e.spawned_subsprint;
          item.changelog = e.changelog ?? null;
          item.change_map = e.change_map ?? emptyChangeMap();
        }
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: e.item_id, text: e.disposition });
        break;
      }
      case "note_added": {
        const item = items.get(e.element_id);
        if (item) { item.notes.push(e.text); }
        else { subsprints.get(e.element_id)?.notes.push(e.text); }
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: e.element_id, text: e.text });
        break;
      }
      case "dependencies_added": {
        const item = items.get(e.target_id);
        const sub = subsprints.get(e.target_id);
        const target = item ?? sub;
        if (target) target.dependencies = unique([...target.dependencies, ...e.dependencies]);
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: e.target_id, text: e.dependencies.join(", ") });
        break;
      }
      case "artifact_added": {
        const artifact: ArtifactView = {
          id: e.artifact_id,
          target_id: e.target_id,
          kind: e.kind,
          title: e.title,
          uri: e.uri,
          description: e.description,
          created_at: e.ts,
        };
        sprint?.artifacts.push(artifact);
        if (e.target_id !== "sprint") {
          const item = items.get(e.target_id);
          if (item) item.artifacts.push(artifact);
          else subsprints.get(e.target_id)?.artifacts.push(artifact);
        }
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: e.artifact_id, text: `${e.title}: ${e.uri}` });
        break;
      }
      case "sprint_closed":
        if (sprint) {
          sprint.status = "closed";
          sprint.closed_at = e.ts;
          sprint.coverage = e.coverage ?? null;
        }
        timeline.push({ seq: e.seq, ts: e.ts, type: e.type, id: "sprint", text: "closed" });
        break;
    }
  }

  for (const sub of subsprints.values()) {
    sub.status = sub.items.length > 0 && sub.items.every((i) => i.status !== "open") ? "closed" : "open";
    if (sub.status === "closed") {
      sub.closed_at = sub.items.reduce<string | null>((latest, item) => {
        if (!item.resolved_at) return latest;
        return latest && latest > item.resolved_at ? latest : item.resolved_at;
      }, null);
    }
    sub.changelog = sub.items
      .filter((item) => item.changelog)
      .map((item) => ({ item: item.id, verb: item.changelog!.verb, line: item.changelog!.line }));
    sub.change_map = aggregateChangeMaps(sub.items.map((item) => item.change_map));
  }
  if (sprint) {
    const nodes = [
      ...sprint.subsprints.map((sub) => ({ id: sub.id, kind: "subsprint" as const, label: sub.description, status: sub.status })),
      ...sprint.subsprints.flatMap((sub) => sub.items.map((item) => ({ id: item.id, kind: "item" as const, label: item.description, status: item.status }))),
    ];
    const edges = [
      ...sprint.subsprints.flatMap((sub) => (sub.dependencies ?? []).map((dep) => ({ from: sub.id, to: dep }))),
      ...sprint.subsprints.flatMap((sub) => sub.items.flatMap((item) => (item.dependencies ?? []).map((dep) => ({ from: item.id, to: dep })))),
    ];
    sprint.graph = buildDependencyGraph(nodes, edges);
    sprint.changelog = sprint.subsprints.flatMap((sub) => sub.changelog.map((entry) => ({ ...entry, subsprint: sub.id })));
    sprint.change_map = aggregateChangeMaps(sprint.subsprints.map((sub) => sub.change_map));
  }
  return sprint;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
