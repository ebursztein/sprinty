import type { ArtifactView, SprintView, ItemView, SubsprintView, TimelineEntry } from "../domain/projection.js";
import type { DependencyGraph } from "../domain/graph.js";

export interface CurrentWindow {
  goal: string;
  last_resolved: ItemView[];
  next: ItemView[];
  current_subsprint: SubsprintView | null;
  graph: DependencyGraph;
  artifacts: ArtifactView[];
  recent_artifacts: ArtifactView[];
  recent_activity: TimelineEntry[];
}

export function windowCurrent(view: SprintView, past: number, future: number): CurrentWindow {
  const items = view.subsprints.flatMap((s) => s.items);
  const resolved = items.filter((i) => i.status !== "open");
  const open = orderOpenItems(view, items);
  const current = open[0]
    ? view.subsprints.find((sub) => sub.id === open[0]!.subsprint_id) ?? null
    : view.subsprints.find((s) => s.status === "open") ?? null;
  return {
    goal: view.goal,
    last_resolved: resolved.slice(-past),
    next: open.slice(0, future),
    current_subsprint: current,
    graph: view.graph,
    artifacts: collectRelevantArtifacts(view, current, resolved.slice(-past), open.slice(0, future)),
    recent_artifacts: collectArtifacts(view).filter((artifact) => artifact.status === "active").slice(-future),
    recent_activity: view.timeline.slice(-Math.max(5, past + future)),
  };
}

function orderOpenItems(view: SprintView, items: ItemView[]): ItemView[] {
  const openById = new Map(items.filter((item) => item.status === "open").map((item) => [item.id, item]));
  const ordered = (view.graph.topological_order ?? [])
    .map((id) => openById.get(id))
    .filter((item): item is ItemView => Boolean(item));
  const seen = new Set(ordered.map((item) => item.id));
  return [...ordered, ...items.filter((item) => item.status === "open" && !seen.has(item.id))];
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

function collectRelevantArtifacts(view: SprintView, current: SubsprintView | null, past: ItemView[], future: ItemView[]): ArtifactView[] {
  const targetIds = new Set<string>([
    "sprint",
    ...(current ? [current.id] : []),
    ...past.map((item) => item.id),
    ...future.map((item) => item.id),
  ]);
  return collectArtifacts(view).filter((artifact) => artifact.status === "active" && targetIds.has(artifact.target_id));
}
