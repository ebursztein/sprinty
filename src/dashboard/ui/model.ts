import type { ArtifactView, ItemView, SprintView, SubsprintView, TimelineEntry } from "../../domain/projection.js";

export type TreeTone = "done" | "active" | "current" | "next" | "blocked" | "muted" | "normal";

export interface DashboardModel {
  sprint: SprintView;
  activeSubsprint: SubsprintView | null;
  currentItem: ItemView | null;
  nextItem: ItemView | null;
  blockedItems: ItemView[];
  progress: {
    items: { total: number; done: number; open: number; percent: number };
    statuses: { total: number; completed: number; open: number; split: number; deprecated: number };
    gates: { total: number; passed: number; failed: number; pending: number };
    subsprints: Array<{ id: string; label: string; done: number; total: number; percent: number }>;
    code: { files: number; additions: number; deletions: number; net: number; churn: number; hotspots: number };
  };
  artifacts: { active: ArtifactView[]; recent: ArtifactView[]; deprecated: ArtifactView[] };
  tree: TreeSubsprint[];
  ledger: LedgerRow[];
}

export interface TreeSubsprint {
  id: string;
  label: string;
  goals: string[];
  status: SubsprintView["status"];
  defaultOpen: boolean;
  tone: TreeTone;
  progress: { done: number; total: number; percent: number };
  items: TreeItem[];
}

export interface TreeItem {
  id: string;
  label: string;
  status: ItemView["status"];
  tone: TreeTone;
  gateSummary: string;
  dependencies: string[];
  blocked: boolean;
}

export interface TimelineRow {
  seq: number;
  id: string;
  type: TimelineEntry["type"];
  text: string;
  time: string;
}

export type LedgerEntity = "artifact" | "dependency" | "follow_up" | "item" | "note" | "spike" | "sprint" | "subsprint";
export type LedgerVerb = "add" | "amend" | "archive" | "close" | "conclude" | "create" | "deprecate" | "replace" | "update";
export type LedgerTargetKind = "artifact" | "follow_up" | "item" | "note" | "sprint" | "subsprint" | "unknown";

export interface LedgerRow extends TimelineRow {
  entity: LedgerEntity;
  verb: LedgerVerb;
  targetKind: LedgerTargetKind;
  clickable: boolean;
}

export interface LedgerFilters {
  query: string;
  entity: LedgerEntity | "all";
  verb: LedgerVerb | "all";
}

export function deriveDashboardModel(sprint: SprintView): DashboardModel {
  const items = sprint.subsprints.flatMap((sub) => sub.items);
  const { available, blocked } = orderOpenItems(sprint, items);
  const blockedIds = new Set(blocked.map((item) => item.id));
  const currentItem = available[0] ?? null;
  const nextItem = available[1] ?? null;
  const activeSubsprint = currentItem
    ? sprint.subsprints.find((sub) => sub.id === currentItem.subsprint_id) ?? null
    : sprint.subsprints.find((sub) => sub.status === "open") ?? null;
  const done = items.filter((item) => item.status !== "open").length;
  const statusTotals = statusProgress(items);
  const gateTotals = gateProgress(items);
  const code = codeStats(sprint);
  const subsprintProgress = sprint.subsprints.map((sub) => {
    const total = sub.items.length;
    const subDone = sub.items.filter((item) => item.status !== "open").length;
    return { id: sub.id, label: sub.description, done: subDone, total, percent: percent(subDone, total) };
  });

  return {
    sprint,
    activeSubsprint,
    currentItem,
    nextItem,
    blockedItems: blocked,
    progress: {
      items: { total: items.length, done, open: items.length - done, percent: percent(done, items.length) },
      statuses: statusTotals,
      gates: gateTotals,
      subsprints: subsprintProgress,
      code,
    },
    artifacts: {
      active: sprint.artifacts.filter((artifact) => artifact.status === "active"),
      recent: sprint.artifacts.filter((artifact) => artifact.status === "active").slice(-6).reverse(),
      deprecated: sprint.artifacts.filter((artifact) => artifact.status === "deprecated"),
    },
    tree: sprint.subsprints.map((sub) => treeSubsprint(sub, activeSubsprint, currentItem, nextItem, blockedIds)),
    ledger: sprint.timeline.slice().reverse().map(ledgerRow),
  };
}

export function filterLedgerRows(rows: LedgerRow[], filters: LedgerFilters): LedgerRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.entity !== "all" && row.entity !== filters.entity) return false;
    if (filters.verb !== "all" && row.verb !== filters.verb) return false;
    if (!query) return true;
    return [
      String(row.seq),
      row.id,
      row.type,
      row.entity,
      row.verb,
      row.text,
      row.time,
    ].some((value) => value.toLowerCase().includes(query));
  });
}

function orderOpenItems(sprint: SprintView, items: ItemView[]): { available: ItemView[]; blocked: ItemView[] } {
  const openById = new Map(items.filter((item) => item.status === "open").map((item) => [item.id, item]));
  const statusById = new Map(sprint.graph.nodes.map((node) => [node.id, node.status]));
  const ordered = (sprint.graph.topological_order ?? [])
    .map((id) => openById.get(id))
    .filter((item): item is ItemView => Boolean(item));
  const seen = new Set(ordered.map((item) => item.id));
  const allOpen = [...ordered, ...items.filter((item) => item.status === "open" && !seen.has(item.id))];
  const available: ItemView[] = [];
  const blocked: ItemView[] = [];
  for (const item of allOpen) {
    const blockers = sprint.graph.blocked_by?.[item.id] ?? item.dependencies;
    if (blockers.some((id) => statusById.get(id) === "open")) blocked.push(item);
    else available.push(item);
  }
  return { available, blocked };
}

function treeSubsprint(
  sub: SubsprintView,
  active: SubsprintView | null,
  current: ItemView | null,
  next: ItemView | null,
  blockedIds: Set<string>,
): TreeSubsprint {
  const total = sub.items.length;
  const done = sub.items.filter((item) => item.status !== "open").length;
  const isActive = active?.id === sub.id;
  return {
    id: sub.id,
    label: sub.description,
    goals: sub.goals,
    status: sub.status,
    defaultOpen: isActive,
    tone: sub.status === "closed" ? "done" : sub.status === "deprecated" ? "muted" : isActive ? "active" : "normal",
    progress: { done, total, percent: percent(done, total) },
    items: sub.items.map((item) => ({
      id: item.id,
      label: itemTitle(item),
      status: item.status,
      tone: item.id === current?.id ? "current" : item.id === next?.id ? "next" : blockedIds.has(item.id) ? "blocked" : item.status === "open" ? "normal" : "muted",
      gateSummary: gateSummary(item),
      dependencies: item.dependencies,
      blocked: blockedIds.has(item.id),
    })),
  };
}

function statusProgress(items: ItemView[]): { total: number; completed: number; open: number; split: number; deprecated: number } {
  return {
    total: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    open: items.filter((item) => item.status === "open").length,
    split: items.filter((item) => item.status === "split").length,
    deprecated: items.filter((item) => item.status === "deprecated").length,
  };
}

function gateProgress(items: ItemView[]): { total: number; passed: number; failed: number; pending: number } {
  const total = items.reduce((sum, item) => sum + item.gates.length, 0);
  const passed = items.reduce((sum, item) => sum + item.gate_results.filter((gate) => gate.passed).length, 0);
  const failed = items.reduce((sum, item) => sum + item.gate_results.filter((gate) => !gate.passed).length, 0);
  return { total, passed, failed, pending: Math.max(0, total - passed - failed) };
}

function codeStats(sprint: SprintView): { files: number; additions: number; deletions: number; net: number; churn: number; hotspots: number } {
  return {
    files: sprint.change_map.by_file.length,
    additions: sprint.change_map.by_file.reduce((sum, row) => sum + row.additions, 0),
    deletions: sprint.change_map.by_file.reduce((sum, row) => sum + row.deletions, 0),
    net: sprint.change_map.by_file.reduce((sum, row) => sum + row.net, 0),
    churn: sprint.change_map.by_file.reduce((sum, row) => sum + row.churn, 0),
    hotspots: sprint.change_map.hotspots.length,
  };
}

function gateSummary(item: ItemView): string {
  if (item.gates.length === 0) return "no gates";
  const passed = item.gate_results.filter((gate) => gate.passed).length;
  const failed = item.gate_results.filter((gate) => !gate.passed).length;
  const pending = Math.max(0, item.gates.length - passed - failed);
  return `${passed}/${item.gates.length} pass${failed ? `, ${failed} fail` : ""}${pending ? `, ${pending} pending` : ""}`;
}

function itemTitle(item: ItemView): string {
  const title = (item as ItemView & { title?: string | null }).title;
  if (title?.trim()) return title;
  return item.description.split(/\s+/).slice(0, 10).join(" ");
}

function timelineRow(entry: TimelineEntry): TimelineRow {
  return { seq: entry.seq, id: entry.id, type: entry.type, text: entry.text, time: entry.ts };
}

function ledgerRow(entry: TimelineEntry): LedgerRow {
  const base = timelineRow(entry);
  const meta = ledgerMeta(entry);
  const targetKind = targetKindFor(entry.id);
  return {
    ...base,
    ...meta,
    targetKind,
    clickable: targetKind === "item" || targetKind === "subsprint",
  };
}

function ledgerMeta(entry: TimelineEntry): { entity: LedgerEntity; verb: LedgerVerb } {
  switch (entry.type) {
    case "sprint_created": return { entity: "sprint", verb: "create" };
    case "sprint_closed": return { entity: "sprint", verb: "close" };
    case "sprint_archived": return { entity: "sprint", verb: "archive" };
    case "subsprint_created": return { entity: "subsprint", verb: "create" };
    case "item_added": return { entity: "item", verb: "add" };
    case "item_updated": return { entity: "item", verb: "update" };
    case "item_resolved": return { entity: "item", verb: entry.text === "deprecated" ? "deprecate" : "close" };
    case "note_added": return { entity: "note", verb: "add" };
    case "note_updated": return { entity: "note", verb: "update" };
    case "dependencies_added": return { entity: "dependency", verb: "add" };
    case "dependencies_replaced": return { entity: "dependency", verb: "replace" };
    case "artifact_added": return { entity: "artifact", verb: "add" };
    case "artifact_amended": return { entity: "artifact", verb: "amend" };
    case "artifact_deprecated": return { entity: "artifact", verb: "deprecate" };
    case "follow_up_added": return { entity: "follow_up", verb: "add" };
    case "spike_concluded": return { entity: "spike", verb: "conclude" };
    case "spike_deprecated": return { entity: "spike", verb: "deprecate" };
  }
}

function targetKindFor(id: string): LedgerTargetKind {
  if (id === "sprint") return "sprint";
  if (/^S\d{2}-\d{3}$/.test(id)) return "item";
  if (/^S\d{2}$/.test(id)) return "subsprint";
  if (/^N\d{3}$/.test(id)) return "note";
  if (/^A\d{3}$/.test(id)) return "artifact";
  if (/^F\d{3}$/.test(id)) return "follow_up";
  return "unknown";
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}
