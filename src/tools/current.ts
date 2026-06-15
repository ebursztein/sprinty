import type { SprintView, ItemView, SubsprintView } from "../domain/projection.js";
import type { DependencyGraph } from "../domain/graph.js";

export interface CurrentWindow {
  goal: string;
  last_resolved: ItemView[];
  next: ItemView[];
  current_subsprint: SubsprintView | null;
  graph: DependencyGraph;
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
  };
}
