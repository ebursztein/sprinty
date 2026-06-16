import type { ArtifactView, SprintView, ItemView, SubsprintView, TimelineEntry } from "../domain/projection.js";

export interface CurrentWindow {
  goal: string;
  last_resolved: LastResolvedRow[];
  current: WorkItemRow | null;
  next: WorkItemRow[];
  blocked_open: BlockedOpenSummary;
  current_subsprint: CurrentSubsprintRow | null;
  relations: RelationRow[];
  artifacts: ArtifactView[];
  recent_artifacts: ArtifactView[];
  recent_activity: RecentActivityRow[];
}

export interface BlockedOpenRow {
  id: string;
  title: string;
}

export interface BlockedOpenSummary {
  count: number;
  items: BlockedOpenRow[];
  truncated: boolean;
}

export interface LastResolvedRow {
  id: string;
  title: string;
  commit_id: string | null;
}

export interface WorkItemRow {
  id: string;
  subsprint_id: string;
  title: string;
  description: string;
  code_locations: string[];
  gates: ItemView["gates"];
  status: ItemView["status"];
  dependencies: string[];
  updates: string[];
  notes: string[];
}

export interface CurrentSubsprintRow {
  id: string;
  kind: SubsprintView["kind"];
  description: string;
  status: SubsprintView["status"];
  goals: string[];
  gates: SubsprintView["gates"];
  dependencies: string[];
  notes: string[];
}

export interface RecentActivityRow {
  id: string;
  type: TimelineEntry["type"];
  text: string;
}

export interface RelationRow {
  from: string;
  to: string;
}

export function windowCurrent(view: SprintView, past: number, future: number): CurrentWindow {
  const items = view.subsprints.flatMap((s) => s.items);
  const resolved = items.filter((i) => i.status !== "open");
  const { available, blocked } = orderOpenItems(view, items);
  const lastResolved = resolved.slice(-past);
  const next = available.slice(0, future);
  const currentItem = available[0] ?? null;
  const current = currentItem
    ? view.subsprints.find((sub) => sub.id === currentItem.subsprint_id) ?? null
    : view.subsprints.find((s) => s.status === "open") ?? null;
  return {
    goal: view.goal,
    last_resolved: lastResolved.map(compactLastResolved),
    current: currentItem ? compactWorkItem(currentItem) : null,
    next: next.map(compactWorkItem),
    blocked_open: compactBlockedOpen(blocked, future),
    current_subsprint: current ? compactCurrentSubsprint(current) : null,
    relations: collectRelations(view, [...lastResolved, ...next].map((item) => item.id)),
    artifacts: collectRelevantArtifacts(view, current, lastResolved, next),
    recent_artifacts: collectArtifacts(view).filter((artifact) => artifact.status === "active").slice(-future),
    recent_activity: view.timeline.slice(-Math.max(5, past + future)).map(compactActivity),
  };
}

function compactBlockedOpen(items: ItemView[], limit: number): BlockedOpenSummary {
  const bounded = items.slice(0, Math.max(0, limit));
  return {
    count: items.length,
    items: bounded.map((item) => ({ id: item.id, title: item.title })),
    truncated: bounded.length < items.length,
  };
}

function compactLastResolved(item: ItemView): LastResolvedRow {
  return {
    id: item.id,
    title: item.title,
    commit_id: item.commit_id,
  };
}

function compactWorkItem(item: ItemView): WorkItemRow {
  return {
    id: item.id,
    subsprint_id: item.subsprint_id,
    title: item.title,
    description: item.description,
    code_locations: item.code_locations,
    gates: item.gates,
    status: item.status,
    dependencies: item.dependencies,
    updates: item.updates,
    notes: item.notes,
  };
}

function compactCurrentSubsprint(sub: SubsprintView): CurrentSubsprintRow {
  return {
    id: sub.id,
    kind: sub.kind,
    description: sub.description,
    status: sub.status,
    goals: sub.goals,
    gates: sub.gates,
    dependencies: sub.dependencies,
    notes: sub.notes,
  };
}

function compactActivity(entry: TimelineEntry): RecentActivityRow {
  return {
    id: entry.id,
    type: entry.type,
    text: truncate(entry.text, 256),
  };
}

function orderOpenItems(view: SprintView, items: ItemView[]): { available: ItemView[]; blocked: ItemView[] } {
  const openById = new Map(items.filter((item) => item.status === "open").map((item) => [item.id, item]));
  const statusById = new Map(view.graph.nodes.map((node) => [node.id, node.status]));
  const ordered = (view.graph.topological_order ?? [])
    .map((id) => openById.get(id))
    .filter((item): item is ItemView => Boolean(item));
  const seen = new Set(ordered.map((item) => item.id));
  const allOpen = [...ordered, ...items.filter((item) => item.status === "open" && !seen.has(item.id))];
  const available: ItemView[] = [];
  const blocked: ItemView[] = [];
  for (const item of allOpen) {
    const blockers = view.graph.blocked_by?.[item.id] ?? item.dependencies;
    if (blockers.some((id) => statusById.get(id) === "open")) blocked.push(item);
    else available.push(item);
  }
  return { available, blocked };
}

function collectArtifacts(view: SprintView): ArtifactView[] {
  const artifacts = [
    ...view.artifacts,
    ...view.subsprints.flatMap((sub) => [
      ...sub.artifacts,
      ...sub.items.flatMap((item) => item.artifacts),
    ]),
  ];
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.id)) return false;
    seen.add(artifact.id);
    return true;
  });
}

function collectRelations(view: SprintView, ids: string[]): RelationRow[] {
  const scopedIds = new Set(ids);
  return view.graph.edges.filter((edge) => scopedIds.has(edge.from) && scopedIds.has(edge.to));
}

function collectRelevantArtifacts(view: SprintView, current: SubsprintView | null, past: ItemView[], future: ItemView[]): ArtifactView[] {
  const targetIds = new Set<string>([
    "sprint",
    ...(current ? [current.id] : []),
    ...past.map((item) => item.id),
    ...future.map((item) => item.id),
  ]);
  return collectArtifacts(view).filter((artifact) => artifact.status === "active" && targetIds.has(artifact.target_id));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
