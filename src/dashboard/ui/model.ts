import type { ItemView, SprintView, SubsprintView, TimelineEntry } from "../../domain/projection.js";

export type TreeTone = "done" | "active" | "current" | "next" | "muted" | "normal";

export interface DashboardModel {
  sprint: SprintView;
  activeSubsprint: SubsprintView | null;
  currentItem: ItemView | null;
  nextItem: ItemView | null;
  progress: {
    items: { total: number; done: number; open: number; percent: number };
    gates: { total: number; passed: number; failed: number; pending: number };
    subsprints: Array<{ id: string; label: string; done: number; total: number; percent: number }>;
  };
  tree: TreeSubsprint[];
  timeline: TimelineRow[];
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
}

export interface TimelineRow {
  seq: number;
  id: string;
  type: TimelineEntry["type"];
  text: string;
  time: string;
}

export interface LedgerRow extends TimelineRow {}

export function deriveDashboardModel(sprint: SprintView): DashboardModel {
  const items = sprint.subsprints.flatMap((sub) => sub.items);
  const openItems = items.filter((item) => item.status === "open");
  const activeSubsprint = sprint.subsprints.find((sub) => sub.status === "open") ?? null;
  const currentItem = openItems[0] ?? null;
  const nextItem = openItems[1] ?? null;
  const done = items.filter((item) => item.status !== "open").length;
  const gateTotals = gateProgress(items);
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
    progress: {
      items: { total: items.length, done, open: openItems.length, percent: percent(done, items.length) },
      gates: gateTotals,
      subsprints: subsprintProgress,
    },
    tree: sprint.subsprints.map((sub) => treeSubsprint(sub, activeSubsprint, currentItem, nextItem)),
    timeline: sprint.timeline.slice().reverse().map(timelineRow),
    ledger: sprint.timeline.map(timelineRow),
  };
}

function treeSubsprint(
  sub: SubsprintView,
  active: SubsprintView | null,
  current: ItemView | null,
  next: ItemView | null,
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
    tone: sub.status === "closed" ? "done" : isActive ? "active" : "normal",
    progress: { done, total, percent: percent(done, total) },
    items: sub.items.map((item) => ({
      id: item.id,
      label: item.description,
      status: item.status,
      tone: item.id === current?.id ? "current" : item.id === next?.id ? "next" : item.status === "open" ? "normal" : "muted",
      gateSummary: gateSummary(item),
      dependencies: item.dependencies,
    })),
  };
}

function gateProgress(items: ItemView[]): { total: number; passed: number; failed: number; pending: number } {
  const total = items.reduce((sum, item) => sum + item.gates.length, 0);
  const passed = items.reduce((sum, item) => sum + item.gate_results.filter((gate) => gate.passed).length, 0);
  const failed = items.reduce((sum, item) => sum + item.gate_results.filter((gate) => !gate.passed).length, 0);
  return { total, passed, failed, pending: Math.max(0, total - passed - failed) };
}

function gateSummary(item: ItemView): string {
  if (item.gates.length === 0) return "no gates";
  const passed = item.gate_results.filter((gate) => gate.passed).length;
  const failed = item.gate_results.filter((gate) => !gate.passed).length;
  const pending = Math.max(0, item.gates.length - passed - failed);
  return `${passed}/${item.gates.length} pass${failed ? `, ${failed} fail` : ""}${pending ? `, ${pending} pending` : ""}`;
}

function timelineRow(entry: TimelineEntry): TimelineRow {
  return { seq: entry.seq, id: entry.id, type: entry.type, text: entry.text, time: entry.ts };
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}
