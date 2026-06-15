export interface GraphNode {
  id: string;
  kind: "sprint" | "subsprint" | "item" | "followup";
  label: string;
  status: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  blocked_by: Record<string, string[]>;
  unblocks: Record<string, string[]>;
  topological_order: string[];
  cycles: string[][];
}

export class GraphCycleError extends Error {
  constructor(readonly cycles: string[][]) {
    super(`Dependency graph contains a cycle: ${cycles.map((c) => c.join(" -> ")).join("; ")}`);
    this.name = "GraphCycleError";
  }
}

export function buildDependencyGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: { throwOnCycle?: boolean } = {},
): DependencyGraph {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const cleanEdges = dedupeEdges(edges).filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const blockedBy = Object.fromEntries(nodes.map((n) => [n.id, [] as string[]]));
  const unblocks = Object.fromEntries(nodes.map((n) => [n.id, [] as string[]]));

  for (const edge of cleanEdges) {
    blockedBy[edge.from]!.push(edge.to);
    unblocks[edge.to]!.push(edge.from);
  }

  const cycles = findCycles(nodes, cleanEdges);
  if (cycles.length > 0 && options.throwOnCycle) throw new GraphCycleError(cycles);

  return {
    nodes,
    edges: cleanEdges,
    blocked_by: blockedBy,
    unblocks,
    topological_order: cycles.length > 0 ? [] : topoSort(nodes, blockedBy, unblocks),
    cycles,
  };
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

function topoSort(
  nodes: GraphNode[],
  blockedBy: Record<string, string[]>,
  unblocks: Record<string, string[]>,
): string[] {
  const remainingDeps = new Map(nodes.map((n) => [n.id, blockedBy[n.id]?.length ?? 0]));
  const ready = nodes.filter((n) => remainingDeps.get(n.id) === 0).map((n) => n.id);
  const out: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift()!;
    out.push(id);
    for (const dependent of unblocks[id] ?? []) {
      const next = (remainingDeps.get(dependent) ?? 0) - 1;
      remainingDeps.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
  }

  return out.length === nodes.length ? out : [];
}

function findCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const byFrom = new Map<string, string[]>();
  for (const node of nodes) byFrom.set(node.id, []);
  for (const edge of edges) byFrom.get(edge.from)?.push(edge.to);

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      if (start >= 0) cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;

    visiting.add(id);
    stack.push(id);
    for (const next of byFrom.get(id) ?? []) visit(next);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const node of nodes) visit(node.id);
  return cycles.slice(0, 1);
}
