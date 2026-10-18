import type { ArtifactView, ItemView, SprintView } from "../../domain/projection.js";
import type { CompletionSummary } from "./chart-windows.js";
import {
  statusDotClass,
  statusPillClass,
  statusToneFor,
  type DashboardModel,
  type GateRow,
  type LedgerEntity,
  type LedgerRow,
  type LedgerVerb,
  type TreeSubsprint,
} from "./model.js";

// Pure presentation helpers, lifted out of App.svelte so they can be tested by calling them
// rather than by grepping the component source for substrings.
export type ProgressMetricRow = { label: string; count: number; done: number; total: number; tone: string };
export type SummaryIconName = "check" | "command" | "edit" | "file" | "plus";
export type ChangelogVerbMetricRow = { label: string; value: number; tone: string; icon: SummaryIconName };
export type CodeMetricRow = { label: string; value: number; tone: string; icon: SummaryIconName };

const changelogVerbCategories = ["added", "fixed", "changed", "removed", "deprecated", "security"];

export function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts);
  return Number.isNaN(date.valueOf()) ? ts : date.toLocaleString();
}

export function statusClass(status: string): string {
  return statusPillClass(status);
}

export function statusDot(status: string): string {
  return statusDotClass(status);
}

export function subsprintDotStatus(sub: TreeSubsprint): string {
  return sub.status === "open" && sub.tone === "active" ? "active" : sub.status;
}

export function itemDotStatus(item: ItemView, model: DashboardModel | null): string {
  if (model?.blockedItems.some((blocked) => blocked.id === item.id)) return "blocked";
  if (item.id === model?.currentItem?.id) return "active";
  return item.status;
}

export function itemDisplayStatus(item: ItemView, model: DashboardModel | null): string {
  return model?.blockedItems.some((blocked) => blocked.id === item.id) ? "blocked" : item.status;
}

export function ledgerEntityClass(entity: LedgerEntity): string {
  return `ledger-chip ledger-entity-${entity}`;
}

export function ledgerVerbClass(verb: LedgerVerb): string {
  return `ledger-chip ledger-verb ledger-verb-${verb}`;
}

export function ledgerTargetClass(row: LedgerRow): string {
  return `ledger-target ledger-target-${row.targetKind}`;
}

export function ledgerEntryCountLabel(filteredCount: number, totalCount: number): string {
  const entryLabel = totalCount === 1 ? "entry" : "entries";
  return filteredCount === totalCount
    ? `${totalCount} ${entryLabel}`
    : `${filteredCount} of ${totalCount} ${entryLabel}`;
}

export function treeRowClass(sub: TreeSubsprint, selectedSubId: string | null): string {
  const classes = ["tree-row"];
  if (selectedSubId === sub.id) classes.push("tree-row-selected");
  if (sub.tone === "done") classes.push("tree-row-done");
  if (sub.tone === "active") classes.push("tree-row-active");
  if (sub.tone === "muted") classes.push("tree-row-muted");
  return classes.join(" ");
}

export function itemRowClass(item: ItemView, model: DashboardModel | null): string {
  const classes = ["todo-row"];
  if (item.id === model?.currentItem?.id) classes.push("todo-current");
  else if (item.id === model?.nextItem?.id) classes.push("todo-next");
  else if (model?.blockedItems.some((blocked) => blocked.id === item.id)) classes.push("todo-blocked");
  if (item.status !== "open") classes.push("todo-terminal");
  return classes.join(" ");
}

export function gateStateLabel(state: GateRow["state"]): string {
  return state === "unverified" ? "too slow" : state;
}

export function targetLabel(artifact: ArtifactView): string {
  return artifact.target_id === "sprint" ? "sprint" : artifact.target_id;
}

export function itemTitle(item: ItemView): string {
  const title = (item as ItemView & { title?: string | null }).title;
  if (title?.trim()) return title;
  return item.description.split(/\s+/).slice(0, 10).join(" ");
}

export function dedupePreserveOrder(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return "--";
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatBucketLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


export function buildProgressMetricRows(model: DashboardModel): ProgressMetricRow[] {
  const totalSubsprints = model.sprint.subsprints.length;
  const closedSubsprints = model.sprint.subsprints.filter((sub) => sub.status === "closed").length;
  return [
    {
      label: "Items",
      count: model.progress.items.total,
      done: model.progress.items.done,
      total: model.progress.items.total,
      tone: "item",
    },
    {
      label: "Subsprints",
      count: totalSubsprints,
      done: closedSubsprints,
      total: totalSubsprints,
      tone: "subsprint",
    },
  ];
}

export function buildChangelogVerbRows(sprint: SprintView): ChangelogVerbMetricRow[] {
  const counts = new Map<string, number>();
  for (const category of changelogVerbCategories) counts.set(category, 0);
  for (const entry of sprint.changelog) counts.set(entry.verb, (counts.get(entry.verb) ?? 0) + 1);
  return changelogVerbCategories
    .map((category) => ({ label: category, value: counts.get(category) ?? 0, tone: category, icon: summaryIconForTone(category) }))
    .filter((row) => row.value > 0);
}

export function buildCodeMetricRows(model: DashboardModel): CodeMetricRow[] {
  const commits = new Set(
    model.sprint.subsprints
      .flatMap((sub) => sub.items)
      .map((item) => item.commit_id)
      .filter((commit): commit is string => Boolean(commit)),
  );
  return [
    { label: "Added", value: model.progress.code.additions, tone: "added", icon: "plus" },
    { label: "Changed", value: model.progress.code.churn, tone: "changed", icon: "edit" },
    { label: "Files edited", value: model.progress.code.files, tone: "file", icon: "file" },
    { label: "Commits", value: commits.size, tone: "commit", icon: "command" },
  ];
}

export function summaryIconForTone(tone: string): SummaryIconName {
  if (tone === "added") return "plus";
  if (tone === "fixed") return "check";
  if (tone === "changed") return "edit";
  if (tone === "removed" || tone === "deprecated" || tone === "security") return "edit";
  return "file";
}

export function countProgressClass(tone: string): string {
  const color =
    tone === "artifact" ? "progress-secondary"
    : tone === "dependency" ? "progress-accent"
    : tone === "follow_up" ? "progress-info"
    : tone === "note" ? "progress-warning"
    : tone === "other" ? "progress-neutral"
    : tone === "subsprint" ? "progress-info"
    : tone === "item" ? "progress-success"
    : tone === "sprint" ? "progress-neutral"
    : "progress-primary";
  return `progress count-progress ${color}`;
}


export function completionStatsLine(summary: CompletionSummary | null): string {
  if (summary?.estimate) {
    const eta = summary.estimate;
    const range = eta.range_ms ? (eta.range_ms[0] === eta.range_ms[1] ? formatDuration(eta.range_ms[0]) : `${formatDuration(eta.range_ms[0])}–${formatDuration(eta.range_ms[1])}`) : "--";
    const finish = eta.finish_range_at ? eta.finish_range_at.map(ts => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })).join("–") : "--";
    return `Estimated working time ${range} / ${eta.status.replaceAll("_", " ")} / ${eta.active_agent_count} active agent${eta.active_agent_count === 1 ? "" : "s"} / ${eta.sample_count} samples${eta.finish_range_at ? ` / Approx. finish ${finish}` : ""}`;
  }
  if (!summary) return "Median -- / fastest -- / slowest -- / ETA -- / ETA time --";
  return [
    `Median ${formatDuration(summary.medianMs)}`,
    `Fastest ${formatDuration(summary.minMs)}`,
    `Slowest ${formatDuration(summary.maxMs)}`,
    `ETA ${formatDuration(summary.etaMs)} (${summary.remainingItems} item${summary.remainingItems === 1 ? "" : "s"})`,
    `ETA time ${summary.etaAt ?? "--"}`,
  ].join(" / ");
}

export function titleCase(value: string): string {
  return value.replace(/(^|[_ -])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix === "_" ? " " : prefix}${letter.toUpperCase()}`);
}
