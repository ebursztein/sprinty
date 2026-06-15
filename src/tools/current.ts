import type { ArtifactView, SprintView, ItemView, SubsprintView } from "../domain/projection.js";
import type { DependencyGraph } from "../domain/graph.js";

export interface CurrentWindow {
  goal: string;
  last_resolved: ItemView[];
  next: ItemView[];
  current_subsprint: SubsprintView | null;
  graph: DependencyGraph;
  artifacts: ArtifactView[];
}

export function windowCurrent(view: SprintView, past: number, future: number): CurrentWindow {
  const items = view.subsprints.flatMap((s) => s.items);
  const resolved = items.filter((i) => i.status !== "open");
  const open = items.filter((i) => i.status === "open");
  const current = view.subsprints.find((s) => s.status === "open") ?? null;
  return {
    goal: view.goal,
    last_resolved: resolved.slice(-past),
    next: open.slice(0, future),
    current_subsprint: current,
    graph: view.graph,
    artifacts: collectArtifacts(view),
  };
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
