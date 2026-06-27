<script lang="ts">
  import { onDestroy, onMount, tick as svelteTick } from "svelte";
  import {
    ArcElement,
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    DoughnutController,
    Filler,
    Legend,
    LineController,
    LineElement,
    LinearScale,
    PointElement,
    Tooltip,
    type ChartConfiguration,
  } from "chart.js";
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { deriveDashboardModel, filterLedgerRows, ledgerVerbIcon, statusDotClass, statusPillClass, type DashboardModel, type LedgerEntity, type LedgerRow, type LedgerVerb, type TreeSubsprint } from "../model";
  import type { ArtifactView, ItemView, SprintView, SubsprintView, TimelineEntry } from "../../../domain/projection";

  let sprint: SprintView | null = null;
  let model: DashboardModel | null = null;
  let error: string | null = null;
  let stale = false;
  let selectedSubId: string | null = null;
  let expandedItemIds: string[] = [];
  let ledgerPage = 0;
  let ledgerSearch = "";
  let ledgerEntityFilter: LedgerEntity | "all" = "all";
  let ledgerVerbFilter: LedgerVerb | "all" = "all";
  let theme: "light" | "dark" = "dark";
  let themeMounted = false;
  let changelogVerbChartCanvas: HTMLCanvasElement | null = null;
  let eventChartCanvas: HTMLCanvasElement | null = null;
  let completionChartCanvas: HTMLCanvasElement | null = null;
  let changelogVerbChart: Chart | null = null;
  let eventChart: Chart | null = null;
  let completionChart: Chart | null = null;
  let chartSignature = "";
  let chartRenderQueued = false;

  type CompletionPoint = { time: number; movingAverageMs: number; durationMs: number };
  type CompletionRatePoint = { time: number; percent: number; completed: number };
  type ProgressMetricRow = { label: string; count: number; done: number; total: number; tone: string };
  type ChangelogVerbMetricRow = { label: string; value: number; tone: string };

  type EventSegment = { category: string; count: number };

  type EventBucket = { label: string; total: number; segments: EventSegment[] };

  type CompletionSummary = {
    points: CompletionPoint[];
    ratePoints: CompletionRatePoint[];
    rateStart: number | null;
    rateEnd: number | null;
    avgMs: number | null;
    medianMs: number | null;
    minMs: number | null;
    maxMs: number | null;
    etaMs: number | null;
    etaAt: string | null;
    projectedAt: number | null;
    openItems: number;
    remainingItems: number;
  };

  const pageSize = 8;
  const themeKey = "sprinty-dashboard-theme";
  const targetEventBuckets = 30;
  const movingAverageWindow = 5;
  const chartCategories = ["added", "edited", "closed"];
  const changelogVerbCategories = ["added", "fixed", "changed", "removed", "deprecated", "security"];
  Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Filler, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip);

  $: model = sprint ? deriveDashboardModel(sprint) : null;
  $: if (model && !selectedSubId) selectedSubId = model.activeSubsprint?.id ?? model.sprint.subsprints[0]?.id ?? null;
  $: selectedSub = model?.sprint.subsprints.find((sub) => sub.id === selectedSubId) ?? model?.activeSubsprint ?? null;
  $: isDark = theme === "dark";
  $: if (themeMounted) applyTheme(theme);
  $: ledgerRows = model?.ledger ?? [];
  $: ledgerEntityOptions = [...new Set(ledgerRows.map((row) => row.entity))].sort();
  $: ledgerVerbOptions = [...new Set(ledgerRows.map((row) => row.verb))].sort();
  $: filteredLedgerRows = filterLedgerRows(ledgerRows, { query: ledgerSearch, entity: ledgerEntityFilter, verb: ledgerVerbFilter });
  $: ledgerPages = Math.max(1, Math.ceil(filteredLedgerRows.length / pageSize));
  $: if (ledgerPage > ledgerPages - 1) ledgerPage = ledgerPages - 1;
  $: visibleLedger = filteredLedgerRows.slice(ledgerPage * pageSize, ledgerPage * pageSize + pageSize);
  $: selectedExpandedCount = selectedSub?.items.filter((item) => expandedItemIds.includes(item.id)).length ?? 0;
  $: sprintGoals = model ? dedupePreserveOrder(model.sprint.subsprints.flatMap((sub) => sub.goals)).slice(0, 8) : [];
  $: sprintSuccessCriteria = model ? dedupePreserveOrder(model.sprint.context_notes).slice(0, 8) : [];
  $: eventsByBucket = model ? buildEventBuckets(model.sprint.timeline) : [];
  $: completionSummary = model ? buildCompletionSummary(model.sprint.timeline, model.progress.items.open, model.progress.items.total) : null;
  $: progressMetricRows = model ? buildProgressMetricRows(model) : [];
  $: changelogVerbRows = model ? buildChangelogVerbRows(model.sprint) : [];
  $: if (themeMounted && completionSummary) queueChartRender();

  onMount(() => {
    const saved = window.localStorage.getItem(themeKey);
    const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
    theme = saved === "light" || saved === "dark" ? saved : prefersLight ? "light" : "dark";
    themeMounted = true;
    applyTheme(theme);
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => clearInterval(timer);
  });

  onDestroy(() => {
    changelogVerbChart?.destroy();
    eventChart?.destroy();
    completionChart?.destroy();
  });

  function applyTheme(next: "light" | "dark"): void {
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    document.body.dataset.theme = next;
    document.body.classList.toggle("dark", next === "dark");
    window.localStorage.setItem(themeKey, next);
  }

  function toggleTheme(): void {
    theme = isDark ? "light" : "dark";
  }

  async function tick(): Promise<void> {
    try {
      const response = await fetch("/state");
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      sprint = await response.json() as SprintView;
      error = null;
      stale = false;
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load state.";
      stale = sprint !== null;
    }
  }

  function selectSub(sub: TreeSubsprint): void {
    selectedSubId = sub.id;
  }

  function toggleItem(item: ItemView): void {
    expandedItemIds = expandedItemIds.includes(item.id)
      ? expandedItemIds.filter((id) => id !== item.id)
      : [...expandedItemIds, item.id];
  }

  function resetLedgerPage(): void {
    ledgerPage = 0;
  }

  function inspectLedgerTarget(row: LedgerRow): void {
    if (!model || !row.clickable) return;
    if (row.targetKind === "subsprint") {
      selectedSubId = row.id;
      return;
    }
    if (row.targetKind === "item") {
      openItem(row.id);
    }
  }

  function openItem(id: string): void {
    if (!model) return;
    const item = model.sprint.subsprints.flatMap((sub) => sub.items).find((candidate) => candidate.id === id);
    if (!item) return;
    selectedSubId = item.subsprint_id;
    if (!expandedItemIds.includes(item.id)) expandedItemIds = [...expandedItemIds, item.id];
  }

  function collapseSelectedItems(): void {
    if (!selectedSub) return;
    const selectedIds = new Set(selectedSub.items.map((item) => item.id));
    expandedItemIds = expandedItemIds.filter((id) => !selectedIds.has(id));
  }

  function markdown(value: string): string {
    return DOMPurify.sanitize(String(marked.parse(value)));
  }

  function fmt(ts: string | null | undefined): string {
    if (!ts) return "";
    const date = new Date(ts);
    return Number.isNaN(date.valueOf()) ? ts : date.toLocaleString();
  }

  function statusClass(status: string): string {
    return statusPillClass(status);
  }

  function statusDot(status: string): string {
    return statusDotClass(status);
  }

  function subsprintDotStatus(sub: TreeSubsprint): string {
    return sub.status === "open" && sub.tone === "active" ? "active" : sub.status;
  }

  function itemDotStatus(item: ItemView): string {
    if (model?.blockedItems.some((blocked) => blocked.id === item.id)) return "blocked";
    if (item.id === model?.currentItem?.id) return "active";
    return item.status;
  }

  function itemDisplayStatus(item: ItemView): string {
    return model?.blockedItems.some((blocked) => blocked.id === item.id) ? "blocked" : item.status;
  }

  function ledgerEntityClass(entity: LedgerEntity): string {
    return `ledger-chip ledger-entity-${entity}`;
  }

  function ledgerVerbClass(verb: LedgerVerb): string {
    return `ledger-chip ledger-verb ledger-verb-${verb}`;
  }

  function ledgerTargetClass(row: LedgerRow): string {
    return `ledger-target ledger-target-${row.targetKind}`;
  }

  function ledgerEntryCountLabel(filteredCount: number, totalCount: number): string {
    const entryLabel = totalCount === 1 ? "entry" : "entries";
    return filteredCount === totalCount
      ? `${totalCount} ${entryLabel}`
      : `${filteredCount} of ${totalCount} ${entryLabel}`;
  }

  function treeRowClass(sub: TreeSubsprint): string {
    const classes = ["tree-row"];
    if (selectedSubId === sub.id) classes.push("tree-row-selected");
    if (sub.tone === "done") classes.push("tree-row-done");
    if (sub.tone === "active") classes.push("tree-row-active");
    if (sub.tone === "muted") classes.push("tree-row-muted");
    return classes.join(" ");
  }

  function itemRowClass(item: ItemView): string {
    const classes = ["todo-row"];
    if (item.id === model?.currentItem?.id) classes.push("todo-current");
    else if (item.id === model?.nextItem?.id) classes.push("todo-next");
    else if (model?.blockedItems.some((blocked) => blocked.id === item.id)) classes.push("todo-blocked");
    if (item.status !== "open") classes.push("todo-terminal");
    return classes.join(" ");
  }

  function gateSummary(item: ItemView): string {
    const passed = item.gate_results.filter((gate) => gate.passed).length;
    const failed = item.gate_results.filter((gate) => !gate.passed).length;
    const pending = Math.max(0, item.gates.length - passed - failed);
    return `${passed}/${item.gates.length} passed${failed ? `, ${failed} failed` : ""}${pending ? `, ${pending} pending` : ""}`;
  }

  function targetLabel(artifact: ArtifactView): string {
    return artifact.target_id === "sprint" ? "sprint" : artifact.target_id;
  }

  function itemTitle(item: ItemView): string {
    const title = (item as ItemView & { title?: string | null }).title;
    if (title?.trim()) return title;
    return item.description.split(/\s+/).slice(0, 10).join(" ");
  }

  function dedupePreserveOrder(values: string[]): string[] {
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

  function parseTs(ts: string | null | undefined): number | null {
    if (!ts) return null;
    const value = Date.parse(ts);
    return Number.isNaN(value) ? null : value;
  }

  function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || ms <= 0) return "--";
    const totalMinutes = Math.max(1, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function formatBucketLabel(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function buildEventBuckets(entries: TimelineEntry[]): EventBucket[] {
    const normalized = entries
      .map((entry) => ({ entry, time: parseTs(entry.ts) }))
      .filter((row): row is { entry: TimelineEntry; time: number } => row.time !== null)
      .sort((a, b) => a.time - b.time);

    if (!normalized.length) return [];

    const timestamps = normalized.map((row) => row.time);
    const firstTs = timestamps[0] ?? 0;
    const lastTs = timestamps[timestamps.length - 1] ?? firstTs;
    const spanMs = Math.max(1, lastTs - firstTs);
    const bucketCount = targetEventBuckets;
    const bucketMs = spanMs / bucketCount;

    const buckets: { label: string; total: number; counts: Map<string, number> }[] = Array.from({ length: bucketCount }, (_, index) => ({
      label: formatBucketLabel(firstTs + index * bucketMs),
      total: 0,
      counts: new Map(),
    }));

    for (const { entry, time } of normalized) {
      const category = eventAction(entry);
      if (!category) continue;

      const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((time - firstTs) / bucketMs)));
      const bucket = buckets[bucketIndex];
      if (!bucket) continue;

      bucket.total += 1;
      bucket.counts.set(category, (bucket.counts.get(category) ?? 0) + 1);
    }

    return buckets.map((bucket) => ({
      label: bucket.label,
      total: bucket.total,
      segments: chartCategories
        .map((category) => ({ category, count: bucket.counts.get(category) ?? 0 }))
        .filter((segment) => segment.count > 0),
    }));
  }

  function eventAction(entry: TimelineEntry): string | null {
    if (
      entry.type === "sprint_created" ||
      entry.type === "subsprint_created" ||
      entry.type === "item_added" ||
      entry.type === "note_added" ||
      entry.type === "artifact_added" ||
      entry.type === "follow_up_added" ||
      entry.type === "dependencies_added"
    ) return "added";

    if (
      entry.type === "item_updated" ||
      entry.type === "note_updated" ||
      entry.type === "dependencies_replaced" ||
      entry.type === "artifact_amended"
    ) return "edited";

    if (
      entry.type === "sprint_closed" ||
      entry.type === "sprint_archived" ||
      entry.type === "item_resolved" ||
      entry.type === "artifact_deprecated" ||
      entry.type === "spike_concluded" ||
      entry.type === "spike_deprecated"
    ) return "closed";

    return null;
  }

  function buildCompletionSummary(entries: TimelineEntry[], openItems: number, totalItems: number): CompletionSummary {
    const normalized = entries
      .map((entry) => ({ entry, time: parseTs(entry.ts) }))
      .filter((row): row is { entry: TimelineEntry; time: number } => row.time !== null)
      .sort((a, b) => a.time - b.time);

    const starts = new Map<string, number>();
    const points: CompletionPoint[] = [];
    const ratePoints: CompletionRatePoint[] = [];
    const rateTotal = Math.max(0, totalItems);
    let completedItems = 0;
    const firstTime = normalized[0]?.time ?? null;
    const lastTime = normalized[normalized.length - 1]?.time ?? firstTime;

    if (rateTotal > 0 && firstTime !== null) {
      ratePoints.push({ time: firstTime, percent: 0, completed: 0 });
    }

    for (const { entry, time } of normalized) {
      if (entry.type === "item_added") {
        starts.set(entry.id, time);
        continue;
      }

      if (entry.type === "item_resolved") {
        const started = starts.get(entry.id);
        if (started === undefined) continue;
        const durationMs = Math.max(0, time - started);
        starts.delete(entry.id);
        points.push({ time, durationMs, movingAverageMs: 0 });
        if (rateTotal > 0) {
          completedItems = Math.min(rateTotal, completedItems + 1);
          ratePoints.push({
            time,
            percent: Math.round((completedItems / rateTotal) * 100),
            completed: completedItems,
          });
        }
      }
    }

    for (let i = 0; i < points.length; i++) {
      const start = Math.max(0, i - movingAverageWindow + 1);
      const window = points.slice(start, i + 1);
      const sum = window.reduce((acc, point) => acc + point.durationMs, 0);
      points[i] = { ...points[i], movingAverageMs: Math.round(sum / window.length) };
    }

    const durations = points.map((point) => point.durationMs);
    if (!durations.length) {
      return {
        points: [],
        ratePoints,
        rateStart: firstTime,
        rateEnd: lastTime,
        avgMs: null,
        medianMs: null,
        minMs: null,
        maxMs: null,
        etaMs: null,
        etaAt: null,
        projectedAt: null,
        openItems,
        remainingItems: Math.max(0, openItems),
      };
    }

    const avgMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
    const sorted = [...durations].sort((a, b) => a - b);
    const medianMs = sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const minMs = sorted.length > 0 ? sorted[0] : null;
    const maxMs = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const remainingItems = Math.max(0, openItems);
    const etaMs = avgMs > 0 ? avgMs * remainingItems : null;
    const projectedAt = etaMs && ratePoints.length ? ratePoints[ratePoints.length - 1]!.time + etaMs : null;
    const etaAt = projectedAt ? new Date(projectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
    const rateEnd = projectedAt && projectedAt > (lastTime ?? projectedAt) ? projectedAt : lastTime;

    return {
      points,
      ratePoints,
      rateStart: firstTime,
      rateEnd,
      avgMs,
      medianMs,
      minMs,
      maxMs,
      etaMs,
      etaAt,
      projectedAt,
      openItems,
      remainingItems,
    };
  }


  function buildProgressMetricRows(model: DashboardModel): ProgressMetricRow[] {
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

  function buildChangelogVerbRows(sprint: SprintView): ChangelogVerbMetricRow[] {
    const counts = new Map<string, number>();
    for (const category of changelogVerbCategories) counts.set(category, 0);
    for (const entry of sprint.changelog) counts.set(entry.verb, (counts.get(entry.verb) ?? 0) + 1);
    return changelogVerbCategories
      .map((category) => ({ label: category, value: counts.get(category) ?? 0, tone: category }))
      .filter((row) => row.value > 0);
  }

  function eventEntity(entry: TimelineEntry): string {
    if (entry.type.startsWith("sprint_")) return "sprint";
    if (entry.type.startsWith("subsprint_")) return "subsprint";
    if (entry.type.startsWith("item_")) return "item";
    if (entry.type.startsWith("note_")) return "note";
    if (entry.type.startsWith("artifact_")) return "artifact";
    if (entry.type.startsWith("dependencies_") || entry.type.startsWith("dependency_")) return "dependency";
    if (entry.type.startsWith("follow_up_")) return "follow_up";
    if (entry.type.startsWith("spike_")) return "spike";
    return "other";
  }

  function countProgressClass(tone: string): string {
    const color =
      tone === "artifact" ? "progress-secondary"
      : tone === "dependency" ? "progress-accent"
      : tone === "follow_up" ? "progress-info"
      : tone === "note" ? "progress-warning"
      : tone === "other" ? "progress-neutral"
      : tone === "spike" ? "progress-error"
      : tone === "subsprint" ? "progress-info"
      : tone === "item" ? "progress-success"
      : tone === "sprint" ? "progress-neutral"
      : "progress-primary";
    return `progress count-progress ${color}`;
  }

  function renderCharts(): void {
    if (!eventChartCanvas || !completionChartCanvas || !completionSummary) return;
    const signature = JSON.stringify({
      theme,
      changelogVerbRows,
      eventsByBucket,
      completion: {
        ratePoints: completionSummary.ratePoints,
        rateStart: completionSummary.rateStart,
        rateEnd: completionSummary.rateEnd,
      },
    });
    if (signature === chartSignature) return;

    Chart.getChart(changelogVerbChartCanvas ?? "")?.destroy();
    Chart.getChart(eventChartCanvas)?.destroy();
    Chart.getChart(completionChartCanvas)?.destroy();
    changelogVerbChart?.destroy();
    eventChart?.destroy();
    completionChart?.destroy();

    const nextChangelogVerbChart = changelogVerbChartCanvas && changelogVerbRows.length
      ? new Chart(changelogVerbChartCanvas, changelogVerbChartConfig(changelogVerbRows))
      : null;
    const nextEventChart = new Chart(eventChartCanvas, eventChartConfig(eventsByBucket));
    const nextCompletionChart = new Chart(completionChartCanvas, completionChartConfig(completionSummary));
    changelogVerbChart = nextChangelogVerbChart;
    eventChart = nextEventChart;
    completionChart = nextCompletionChart;
    chartSignature = signature;

    requestAnimationFrame(() => {
      changelogVerbChart?.resize();
      eventChart?.resize();
      completionChart?.resize();
      changelogVerbChart?.update("none");
      eventChart?.update("none");
      completionChart?.update("none");
    });
  }

  function queueChartRender(): void {
    if (chartRenderQueued) return;
    chartRenderQueued = true;
    void svelteTick().then(() => {
      chartRenderQueued = false;
      renderCharts();
    });
  }

  function chartPalette(): Record<string, string> {
    return {
      sprint: "#71717a",
      subsprint: "#3b82f6",
      item: "#10b981",
      added: "#3b82f6",
      edited: "#f59e0b",
      closed: "#10b981",
      fixed: "#22c55e",
      changed: "#f59e0b",
      removed: "#ef4444",
      deprecated: "#71717a",
      security: "#a855f7",
      note: "#f59e0b",
      artifact: "#8b5cf6",
      dependency: "#ec4899",
      follow_up: "#06b6d4",
      spike: "#f97316",
      other: "#52525b",
      axis: theme === "dark" ? "#475569" : "#cbd5e1",
      grid: theme === "dark" ? "rgba(71, 85, 105, 0.42)" : "rgba(148, 163, 184, 0.38)",
      label: theme === "dark" ? "#a1a1aa" : "#52525b",
    };
  }

  function changelogVerbChartConfig(rows: ChangelogVerbMetricRow[]): ChartConfiguration<"doughnut"> {
    const palette = chartPalette();
    return {
      type: "doughnut",
      data: {
        labels: rows.map((row) => `${titleCase(row.label)} ${row.value}`),
        datasets: [{
          data: rows.map((row) => row.value),
          backgroundColor: rows.map((row) => palette[row.tone] ?? palette.other),
          borderColor: theme === "dark" ? "#020617" : "#f8fafc",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        cutout: "62%",
        plugins: {
          legend: {
            display: true,
            position: "right",
            labels: {
              boxHeight: 10,
              boxWidth: 10,
              color: palette.label,
              padding: 14,
              usePointStyle: true,
            },
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const row = rows[item.dataIndex];
                return `${titleCase(row?.label ?? "change")}: ${item.formattedValue}`;
              },
            },
          },
        },
      },
    };
  }

  function eventChartConfig(buckets: EventBucket[]): ChartConfiguration<"bar"> {
    const palette = chartPalette();
    return {
      type: "bar",
      data: {
        labels: buckets.map((bucket) => bucket.label),
        datasets: chartCategories.map((category) => ({
          label: category.replace("_", " "),
          data: buckets.map((bucket) => bucket.segments.find((segment) => segment.category === category)?.count ?? 0),
          backgroundColor: palette[category],
          borderRadius: 2,
          borderSkipped: false,
          maxBarThickness: 14,
          stack: "events",
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: "index",
            intersect: false,
            filter: (item) => Number(item.raw) > 0,
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              color: palette.label,
              autoSkip: true,
              maxTicksLimit: 4,
              maxRotation: 0,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: palette.grid },
            border: { color: palette.axis },
            ticks: {
              color: palette.label,
              precision: 0,
              maxTicksLimit: 4,
            },
          },
        },
      },
    };
  }

  function completionChartConfig(summary: CompletionSummary): ChartConfiguration<"line"> {
    const palette = chartPalette();
    const points = summary.ratePoints.map((point) => ({ x: point.time, y: point.percent }));
    const last = summary.ratePoints[summary.ratePoints.length - 1];
    const projection = buildProjectedRateSteps(summary).map((point) => ({ x: point.time, y: point.percent }));

    return {
      type: "line",
      data: {
        datasets: [
          {
            label: "Completion",
            data: points,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.22)",
            borderWidth: 3,
            fill: "origin",
            pointRadius: 4,
            pointHoverRadius: 5,
            stepped: "after",
            tension: 0.28,
          },
          {
            label: "Projected",
            data: projection,
            borderColor: "#60a5fa",
            backgroundColor: "rgba(96, 165, 250, 0.12)",
            borderDash: [6, 5],
            borderWidth: 3,
            fill: "origin",
            pointRadius: 0,
            stepped: "after",
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => formatBucketLabel(Number(items[0]?.parsed.x ?? 0)),
              label: (item) => `${item.dataset.label}: ${Math.round(Number(item.parsed.y))}%`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: summary.rateStart ?? undefined,
            max: summary.rateEnd ?? undefined,
            grid: { display: false },
            border: { color: palette.axis },
            ticks: {
              color: palette.label,
              maxTicksLimit: 5,
              callback: (value) => formatBucketLabel(Number(value)),
            },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: palette.grid },
            border: { color: palette.axis },
            ticks: {
              color: palette.label,
              stepSize: 25,
              callback: (value) => `${value}%`,
            },
          },
        },
      },
    };
  }

  function buildProjectedRateSteps(summary: CompletionSummary): CompletionRatePoint[] {
    const last = summary.ratePoints[summary.ratePoints.length - 1];
    if (!last || !summary.avgMs || summary.avgMs <= 0 || summary.remainingItems <= 0) return [];

    const total = Math.max(1, last.completed + summary.remainingItems);
    const steps: CompletionRatePoint[] = [last];
    for (let index = 1; index <= summary.remainingItems; index++) {
      const completed = Math.min(total, last.completed + index);
      steps.push({
        time: last.time + summary.avgMs * index,
        percent: Math.round((completed / total) * 100),
        completed,
      });
    }
    return steps;
  }

  function completionStatsLine(summary: CompletionSummary | null): string {
    if (!summary) return "Median -- / fastest -- / slowest -- / ETA -- / ETA time --";
    return [
      `Median ${formatDuration(summary.medianMs)}`,
      `Fastest ${formatDuration(summary.minMs)}`,
      `Slowest ${formatDuration(summary.maxMs)}`,
      `ETA ${formatDuration(summary.etaMs)} (${summary.remainingItems} item${summary.remainingItems === 1 ? "" : "s"})`,
      `ETA time ${summary.etaAt ?? "--"}`,
    ].join(" / ");
  }

  function titleCase(value: string): string {
    return value.replace(/(^|[_ -])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix === "_" ? " " : prefix}${letter.toUpperCase()}`);
  }
</script>

<svelte:head>
  <title>sprinty dashboard</title>
</svelte:head>

{#if !model}
  <main class="loading-screen">
    <div class="loading-panel">
      <div class="brand-mark">S</div>
      <h1>Loading Sprinty</h1>
      {#if error}<p>{error}</p>{/if}
    </div>
  </main>
{:else}
  <div class:dark={isDark} class="dashboard-frame" data-theme={theme}>
    <div class="dashboard-canvas">
      <header class="topbar">
        <div class="topbar-title">
          <div class="eyebrow">Sprinty dashboard</div>
          <h1 class="sprint-title">{model.sprint.goal}</h1>
        </div>
        <div class="topbar-actions">
          <span class={statusClass(model.sprint.status)}>{model.sprint.status}</span>
          <span class="coverage-chip badge badge-outline">{model.sprint.coverage?.lines.percent ?? "--"}% cov</span>
          <button
            class="theme-switch"
            on:click={toggleTheme}
            aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
            aria-pressed={isDark}
            title={`Switch to ${isDark ? "light" : "dark"} theme`}
          >
            <span class="theme-switch-icon theme-switch-sun" aria-hidden="true"></span>
            <span class="theme-switch-icon theme-switch-moon" aria-hidden="true"></span>
            <span class="theme-switch-thumb" aria-hidden="true"></span>
          </button>
        </div>
        <details class="sprint-metadata-fold">
          <summary class="sprint-metadata-summary">Sprint details</summary>
          <div class="sprint-metadata">
            <div>
              <span>Details</span>
              <ul>
                <li>Branch {model.sprint.branch || "detached"}</li>
                <li>Git {model.sprint.dir || model.sprint.worktree}</li>
                <li>Data {model.sprint.data_dir || "not configured"}</li>
                <li>Started {fmt(model.sprint.created_at)}</li>
                {#if stale}
                  <li class="warning-text">stale connection</li>
                {/if}
              </ul>
            </div>
            <div>
              <span>Goals</span>
              {#if sprintGoals.length}
                <ul>
                  {#each sprintGoals as goal}
                    <li>{goal}</li>
                  {/each}
                </ul>
              {:else}
                <ul><li>No goals set.</li></ul>
              {/if}
            </div>
            <div>
              <span>Success criteria</span>
              {#if sprintSuccessCriteria.length}
                <ul>
                  {#each sprintSuccessCriteria as criterion}
                    <li>{criterion}</li>
                  {/each}
                </ul>
              {:else}
                <ul><li>No success criteria set.</li></ul>
              {/if}
            </div>
          </div>
        </details>
      </header>

      <main class="dashboard-main">
        <section class="overview-band" data-testid="stats-strip">
          <div class="metrics-grid">
            <div class="metric-panel metric-progress">
              <div class="metric-heading">
                <span>Sprint progress</span>
                <strong>{model.progress.items.percent}%</strong>
              </div>
              <progress
                class="progress progress-primary progress-track"
                value={model.progress.items.done}
                max={Math.max(1, model.progress.items.total)}
                aria-label="Item progress"
              ></progress>
              <div class="metric-foot">{model.progress.items.done}/{model.progress.items.total} items done</div>
              <div class="progress-bars" aria-label="Progress ratios">
                {#each progressMetricRows as row}
                  <div class="progress-bar-row">
                    <span><b>{row.label}</b><small>{row.count}</small></span>
                    <progress class={countProgressClass(row.tone)} value={row.done} max={Math.max(1, row.total)} aria-label={row.label}></progress>
                    <strong>{row.done}/{row.total}</strong>
                  </div>
                {/each}
              </div>
            </div>

            <div class="metric-panel metric-stats">
              <div class="metric-heading"><span>Changelog verbs</span></div>
              {#if changelogVerbRows.length}
                <div class="verb-chart-layout" aria-label="Changelog verb chart">
                  <div class="verb-chart-shell">
                    <canvas bind:this={changelogVerbChartCanvas} aria-label="Changelog verb doughnut chart"></canvas>
                  </div>
                </div>
              {:else}
                <div class="empty-inline">No changelog entries yet.</div>
              {/if}
            </div>
          </div>

          <div class="charts-band">
            <div class="metric-panel chart-panel">
              <div class="metric-heading"><span>Event activity by action</span></div>
              {#if eventsByBucket.length}
                <div class="chart-stack" aria-label="Stacked event chart">
                  <canvas bind:this={eventChartCanvas} aria-label="Stacked event chart"></canvas>
                </div>
                <div class="chart-legend" aria-label="Event category legend">
                  {#each chartCategories as category}
                    <span class={`legend-chip bucket-${category}`}>
                      {category.replace("_", " ")}
                    </span>
                  {/each}
                </div>
              {:else}
                <div class="empty-inline">No timeline activity yet.</div>
              {/if}
            </div>

            <div class="metric-panel chart-panel">
              <div class="metric-heading">
                <span>Completion rate over time</span>
              </div>
              {#if completionSummary && completionSummary.ratePoints.length}
                <div class="completion-chart-shell">
                  <canvas bind:this={completionChartCanvas} aria-label="Completion rate trend"></canvas>
                  <div class="completion-scale">
                    <span>{completionSummary.ratePoints.at(-1)?.percent ?? 0}% complete</span>
                    <span>{completionSummary.points.length} finished item{completionSummary.points.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div class="completion-summary-line">{completionStatsLine(completionSummary)}</div>
              {:else}
                <div class="empty-inline">No completed items yet.</div>
              {/if}
            </div>
          </div>
        </section>

        <section class="workbench">
          <aside class="tree-panel" data-testid="subsprint-sidebar">
            <div class="tree-header">
              <h2>Subsprints</h2>
              <span>{model.sprint.subsprints.length}</span>
            </div>
            <div class="tree-list">
              {#each model.tree as sub}
                <button class={treeRowClass(sub)} on:click={() => selectSub(sub)}>
                  <div class="tree-row-main">
                    <span class={statusDot(subsprintDotStatus(sub))}></span>
                    <span class="tree-id">{sub.id}</span>
                    <span class="tree-label" title={sub.label}>{sub.label}</span>
                  </div>
                  <div class="tree-row-progress">
                    <span><b>{sub.progress.done}</b>/{sub.progress.total}</span>
                    <div class="mini-track"><div style={`width:${sub.progress.percent}%`}></div></div>
                  </div>
                </button>
              {/each}
            </div>
          </aside>

          <section class="core-panel" data-testid="item-core">
            <div class="core-header">
              <div class="min-w-0">
                <div class="eyebrow">{selectedSub?.id ?? "No subsprint"}</div>
                <h2>{selectedSub?.description ?? "No subsprint selected"}</h2>
                {#if selectedSub}
                  <p>{selectedSub.kind}{selectedSub.spike_conclusion ? `: ${selectedSub.spike_conclusion}` : ""}</p>
                {/if}
              </div>
              <div class="core-actions">
                {#if selectedSub}<span class={statusClass(selectedSub.status)}>{selectedSub.status}</span>{/if}
                <button class="collapse-button" disabled={selectedExpandedCount === 0} on:click={collapseSelectedItems}>
                  Collapse all
                </button>
              </div>
            </div>

            {#if selectedSub?.goals.length}
              <details class="goals-fold">
                <summary>Goals</summary>
                <ul>
                  {#each selectedSub.goals as goal}
                    <li>{goal}</li>
                  {/each}
                </ul>
              </details>
            {/if}

            <div class="todo-list">
              {#each selectedSub?.items ?? [] as item}
                <article class={itemRowClass(item)} data-testid="item-row">
                  <button class="todo-button" on:click={() => toggleItem(item)} aria-expanded={expandedItemIds.includes(item.id)}>
                    <span class={statusDot(itemDotStatus(item))}></span>
                    <span class="todo-id">{item.id}</span>
                    <span class="todo-title">{itemTitle(item)}</span>
                    <span class={statusClass(itemDisplayStatus(item))}>{itemDisplayStatus(item)}</span>
                    <span class:todo-expand-open={expandedItemIds.includes(item.id)} class="todo-expand" aria-hidden="true"></span>
                  </button>

                  {#if expandedItemIds.includes(item.id)}
                    <div class="todo-detail">
                      <div class="detail-copy prose prose-zinc max-w-none dark:prose-invert">{@html markdown(item.description)}</div>
                      <div class="detail-grid">
                        <div><span>Files</span><strong>{item.code_locations.join(", ")}</strong></div>
                        <div><span>Gates</span><strong>{gateSummary(item)}</strong></div>
                        {#if item.dependencies.length}
                          <div>
                            <span>Depends on</span>
                            <strong class="dependency-list">
                              {#each item.dependencies as dependency}
                                <button type="button" class="dependency-link" on:click={() => openItem(dependency)}>{dependency}</button>
                              {/each}
                            </strong>
                          </div>
                        {/if}
                        {#if item.commit_id}<div><span>Commit</span><strong>{item.commit_id}</strong></div>{/if}
                        {#if item.changelog}<div><span>Changelog</span><strong>{item.changelog.verb}: {item.changelog.line}</strong></div>{/if}
                        {#if item.artifacts.length}<div><span>Artifacts</span><strong>{item.artifacts.map((artifact) => artifact.title).join(", ")}</strong></div>{/if}
                        {#if item.follow_ups.length}<div><span>Follow-ups</span><strong>{item.follow_ups.map((follow) => `${follow.bug_ids.join(", ")}: ${follow.description}`).join("; ")}</strong></div>{/if}
                      </div>
                    </div>
                  {/if}
                </article>
              {:else}
                <div class="empty-panel">No items in this subsprint yet.</div>
              {/each}
            </div>
          </section>
        </section>

        <section class="artifact-strip" data-testid="artifact-shelf">
          <div class="section-title">
            <span>Artifacts</span>
            <span>{model.artifacts.active.length} active</span>
          </div>
          <div class="artifact-list">
            {#each model.artifacts.recent as artifact}
              <a class="artifact-token" href={artifact.uri} title={artifact.uri}>
                <span>{artifact.kind}</span>
                <strong>{artifact.title}</strong>
                <small>{targetLabel(artifact)}</small>
              </a>
            {:else}
              <div class="empty-inline">No artifacts recorded yet.</div>
            {/each}
          </div>
        </section>

        <section class="ledger-panel" data-testid="ledger-table">
          <div class="ledger-header">
            <div class="section-title">
              <span>Ledger</span>
              <span>{ledgerEntryCountLabel(filteredLedgerRows.length, ledgerRows.length)}</span>
            </div>
            <div class="ledger-controls" aria-label="Ledger filters">
              <input
                class="ledger-search"
                type="search"
                bind:value={ledgerSearch}
                on:input={resetLedgerPage}
                placeholder="Search ledger"
                aria-label="Search ledger"
              />
              <select class="ledger-select" bind:value={ledgerEntityFilter} on:change={resetLedgerPage} aria-label="Filter ledger entity">
                <option value="all">All types</option>
                {#each ledgerEntityOptions as entity}
                  <option value={entity}>{entity.replace("_", " ")}</option>
                {/each}
              </select>
              <select class="ledger-select" bind:value={ledgerVerbFilter} on:change={resetLedgerPage} aria-label="Filter ledger verb">
                <option value="all">All verbs</option>
                {#each ledgerVerbOptions as verb}
                  <option value={verb}>{verb}</option>
                {/each}
              </select>
            </div>
            <div class="pager">
              <button disabled={ledgerPage === 0} on:click={() => ledgerPage = Math.max(0, ledgerPage - 1)}>Prev</button>
              <span>{ledgerPage + 1}/{ledgerPages}</span>
              <button disabled={ledgerPage >= ledgerPages - 1} on:click={() => ledgerPage = Math.min(ledgerPages - 1, ledgerPage + 1)}>Next</button>
            </div>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr><th>Target</th><th>Type</th><th>Verb</th><th>Text</th><th>Time</th></tr>
              </thead>
              <tbody>
                {#each visibleLedger as row}
                  <tr>
                    <td>
                      {#if row.clickable}
                        <button class={ledgerTargetClass(row)} on:click={() => inspectLedgerTarget(row)}>{row.id}</button>
                      {:else}
                        <span class={ledgerTargetClass(row)}>{row.id}</span>
                      {/if}
                    </td>
                    <td><span class={ledgerEntityClass(row.entity)}>{row.entity.replace("_", " ")}</span></td>
                    <td><span class={ledgerVerbClass(row.verb)}><span class="ledger-verb-icon" aria-hidden="true">{ledgerVerbIcon(row.verb)}</span>{row.verb}</span></td>
                    <td>{row.text}</td>
                    <td>{fmt(row.time)}</td>
                  </tr>
                {:else}
                  <tr>
                    <td colspan="5" class="ledger-empty">No matching ledger rows.</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  </div>
{/if}
