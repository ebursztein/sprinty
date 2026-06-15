import type { ArtifactView, SprintView, ItemView, SubsprintView, TimelineEntry } from "../domain/projection.js";
import type { DependencyGraph, GraphNode } from "../domain/graph.js";

export interface CurrentWindow {
  goal: string;
  last_resolved: ItemView[];
  current: ItemView | null;
  next: ItemView[];
  blocked_open: ItemView[];
  current_subsprint: SubsprintView | null;
  graph: DependencyGraph;
  relations: RelationRow[];
  artifacts: ArtifactView[];
  recent_artifacts: ArtifactView[];
  recent_activity: TimelineEntry[];
}

export interface RelationRow {
  id: string;
  node: GraphNode | null;
  blocked_by: GraphNode[];
  unblocks: GraphNode[];
}

export function windowCurrent(view: SprintView, past: number, future: number): CurrentWindow {
  const items = view.subsprints.flatMap((s) => s.items);
  const resolved = items.filter((i) => i.status !== "open");
  const { available, blocked } = orderOpenItems(view, items);
  const currentItem = available[0] ?? null;
  const current = currentItem
    ? view.subsprints.find((sub) => sub.id === currentItem.subsprint_id) ?? null
    : view.subsprints.find((s) => s.status === "open") ?? null;
  return {
    goal: view.goal,
    last_resolved: resolved.slice(-past),
    current: currentItem,
    next: available.slice(0, future),
    blocked_open: blocked,
    current_subsprint: current,
    graph: view.graph,
    relations: collectRelations(view, [
      ...(current ? [current.id] : []),
      ...resolved.slice(-past).map((item) => item.id),
      ...available.slice(0, future).map((item) => item.id),
      ...blocked.map((item) => item.id),
    ]),
    artifacts: collectRelevantArtifacts(view, current, resolved.slice(-past), available.slice(0, future)),
    recent_artifacts: collectArtifacts(view).filter((artifact) => artifact.status === "active").slice(-future),
    recent_activity: view.timeline.slice(-Math.max(5, past + future)),
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
  const nodes = new Map(view.graph.nodes.map((node) => [node.id, node]));
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.map((id) => ({
    id,
    node: nodes.get(id) ?? null,
    blocked_by: (view.graph.blocked_by?.[id] ?? []).map((dep) => nodes.get(dep)).filter((node): node is GraphNode => Boolean(node)),
    unblocks: (view.graph.unblocks?.[id] ?? []).map((dep) => nodes.get(dep)).filter((node): node is GraphNode => Boolean(node)),
  }));
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
