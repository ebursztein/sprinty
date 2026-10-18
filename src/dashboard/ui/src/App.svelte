<script lang="ts">
  import { onDestroy, onMount, tick as svelteTick } from "svelte";
  import {
    BarController,
    BarElement,
    ArcElement,
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
  import { buildCompletionSummary, buildEventBuckets, parseTs, recentTimelineWindow, type CompletionRatePoint, type CompletionSummary, type EventBucket } from "../chart-windows";
  import { deriveDashboardModel, filterLedgerRows, gateRows, gateSummary, ledgerVerbIcon, statusDotClass, statusPillClass, type DashboardModel, type GateRow, type LedgerEntity, type LedgerRow, type LedgerVerb, type TreeSubsprint } from "../model";
  import {
    buildChangelogVerbRows,
    buildCodeMetricRows,
    buildProgressMetricRows,
    completionStatsLine,
    countProgressClass,
    dedupePreserveOrder,
    fmt,
    formatBucketLabel,
    formatDuration,
    gateStateLabel,
    itemDisplayStatus,
    itemDotStatus,
    itemRowClass,
    itemTitle,
    ledgerEntityClass,
    ledgerEntryCountLabel,
    ledgerTargetClass,
    ledgerVerbClass,
    statusClass,
    statusDot,
    subsprintDotStatus,
    summaryIconForTone,
    targetLabel,
    titleCase,
    treeRowClass,
    type ChangelogVerbMetricRow,
    type CodeMetricRow,
    type ProgressMetricRow,
    type SummaryIconName,
  } from "../presentation";
  import SummaryIcon from "./SummaryIcon.svelte";
  import type { ArtifactView, ItemView, SprintView } from "../../../domain/projection";

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
  let nowMs = Date.now();
  let themeMounted = false;
  let eventChartCanvas: HTMLCanvasElement | null = null;
  let completionChartCanvas: HTMLCanvasElement | null = null;
  let changelogVerbChartCanvas: HTMLCanvasElement | null = null;
  let eventChart: Chart | null = null;
  let completionChart: Chart | null = null;
  let changelogVerbChart: Chart | null = null;
  let chartSignature = "";
  let chartRenderQueued = false;


  const pageSize = 8;
  const themeKey = "sprinty-dashboard-theme";
  const targetEventBuckets = 30;
  const chartWindowMs = 4 * 60 * 60 * 1000;
  const movingAverageWindow = 5;
  const chartCategories = ["added", "edited", "closed"];
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
  $: sprintStartedAtMs = model ? parseTs(model.sprint.created_at) : null;
  $: recentTimeline = model ? recentTimelineWindow(model.sprint.timeline, chartWindowMs, nowMs, sprintStartedAtMs) : [];
  $: eventsByBucket = model ? buildEventBuckets(recentTimeline, { nowMs, windowMs: chartWindowMs, sprintStartedAtMs, bucketCount: targetEventBuckets, categories: chartCategories, formatLabel: formatBucketLabel }) : [];
  $: completionSummary = model ? buildCompletionSummary(model.sprint.timeline, model.progress.items.open, model.progress.items.total, {
    nowMs,
    windowMs: chartWindowMs,
    sprintStartedAtMs,
    estimate: model.sprint.eta,
    movingAverageWindow,
    formatEta: (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }) : null;
  $: progressMetricRows = model ? buildProgressMetricRows(model) : [];
  $: changelogVerbRows = model ? buildChangelogVerbRows(model.sprint) : [];
  $: codeMetricRows = model ? buildCodeMetricRows(model) : [];
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
    eventChart?.destroy();
    completionChart?.destroy();
    changelogVerbChart?.destroy();
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
    nowMs = Date.now();
    try {
      const response = await fetch("/state", { cache: "no-store" });
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

  function renderCharts(): void {
    if (!eventChartCanvas || !completionChartCanvas || !completionSummary) return;
    const signature = JSON.stringify({
      theme,
      eventsByBucket,
      completion: {
        ratePoints: completionSummary.ratePoints,
        rateStart: completionSummary.rateStart,
        rateEnd: completionSummary.rateEnd,
      },
      changelogVerbRows,
    });
    if (signature === chartSignature) return;

    Chart.getChart(eventChartCanvas)?.destroy();
    Chart.getChart(completionChartCanvas)?.destroy();
    if (changelogVerbChartCanvas) Chart.getChart(changelogVerbChartCanvas)?.destroy();
    eventChart?.destroy();
    completionChart?.destroy();
    changelogVerbChart?.destroy();

    const nextEventChart = new Chart(eventChartCanvas, eventChartConfig(eventsByBucket));
    const nextCompletionChart = new Chart(completionChartCanvas, completionChartConfig(completionSummary));
    const nextChangelogVerbChart = changelogVerbChartCanvas && changelogVerbRows.length
      ? new Chart(changelogVerbChartCanvas, changelogVerbChartConfig(changelogVerbRows))
      : null;
    eventChart = nextEventChart;
    completionChart = nextCompletionChart;
    changelogVerbChart = nextChangelogVerbChart;
    chartSignature = signature;

    requestAnimationFrame(() => {
      eventChart?.resize();
      completionChart?.resize();
      changelogVerbChart?.resize();
      eventChart?.update("none");
      completionChart?.update("none");
      changelogVerbChart?.update("none");
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
      other: "#52525b",
      axis: theme === "dark" ? "#475569" : "#cbd5e1",
      grid: theme === "dark" ? "rgba(71, 85, 105, 0.42)" : "rgba(148, 163, 184, 0.38)",
      label: theme === "dark" ? "#a1a1aa" : "#52525b",
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

  function changelogVerbChartConfig(rows: ChangelogVerbMetricRow[]): ChartConfiguration<"doughnut"> {
    const palette = chartPalette();
    return {
      type: "doughnut",
      data: {
        labels: rows.map((row) => `${titleCase(row.label)} ${row.value}`),
        datasets: [
          {
            data: rows.map((row) => row.value),
            backgroundColor: rows.map((row) => palette[row.tone] ?? palette.other),
            borderColor: theme === "dark" ? "#020617" : "#ffffff",
            borderWidth: 2,
            hoverOffset: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        cutout: "62%",
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              color: palette.label,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            callbacks: {
              label: (item) => `${item.label}: ${item.formattedValue}`,
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
            pointRadius: 0,
            pointHoverRadius: 0,
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
    const perItemEtaMs = summary.etaMs && summary.remainingItems > 0 ? summary.etaMs / summary.remainingItems : null;
    if (!last || !perItemEtaMs || perItemEtaMs <= 0 || summary.remainingItems <= 0) return [];

    const total = Math.max(1, last.completed + summary.remainingItems);
    const steps: CompletionRatePoint[] = [last];
    for (let index = 1; index <= summary.remainingItems; index++) {
      const completed = Math.min(total, last.completed + index);
      steps.push({
        time: last.time + perItemEtaMs * index,
        percent: Math.round((completed / total) * 100),
        completed,
      });
    }
    return steps;
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
              <div class="metric-heading"><span>Changelog stats</span></div>
              {#if changelogVerbRows.length}
                <div class="changelog-chart-shell">
                  <canvas bind:this={changelogVerbChartCanvas} aria-label="Changelog verb chart"></canvas>
                </div>
              {:else}
                <div class="empty-inline">No changelog entries yet.</div>
              {/if}
            </div>

            <div class="metric-panel metric-code">
              <div class="metric-heading"><span>Code stats</span></div>
              <table class="summary-table" aria-label="Code count table">
                <thead>
                  <tr><th>Metric</th><th>Num</th></tr>
                </thead>
                <tbody>
                  {#each codeMetricRows as row}
                    <tr>
                      <td class={`summary-label summary-${row.tone}`}><SummaryIcon name={row.icon} className="summary-icon" />{row.label}</td>
                      <td>{row.value}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
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
                    <span>{model.progress.items.done} finished item{model.progress.items.done === 1 ? "" : "s"}</span>
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
                <button class={treeRowClass(sub, selectedSubId)} on:click={() => selectSub(sub)}>
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
                  <p>{selectedSub.status}</p>
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
                <article class={itemRowClass(item, model)} data-testid="item-row">
                  <button class="todo-button" on:click={() => toggleItem(item)} aria-expanded={expandedItemIds.includes(item.id)}>
                    <span class={statusDot(itemDotStatus(item, model))}></span>
                    <span class="todo-id">{item.id}</span>
                    <span class="todo-title">{itemTitle(item)}{#if item.claim?.owner_name}<small> · {item.claim.owner_name} · {formatDuration(item.claim.claim_duration_ms)}</small>{/if}{#if item.claim?.stall_reasons.length}<small class="scope-drift"> · Potential stall</small>{/if}</span>
                    <span class={statusClass(itemDisplayStatus(item, model))}>{itemDisplayStatus(item, model)}</span>
                    <span class:todo-expand-open={expandedItemIds.includes(item.id)} class="todo-expand" aria-hidden="true"></span>
                  </button>

                  {#if expandedItemIds.includes(item.id)}
                    <div class="todo-detail">
                      <div class="detail-copy prose prose-zinc max-w-none dark:prose-invert">{@html markdown(item.description)}</div>
                      <div class="detail-grid">
                        <div><span>Files</span><strong>{item.code_locations.join(", ")}</strong></div>
                        {#if item.undeclared_code_locations?.length}
                          <div><span>Also touched</span><strong class="scope-drift">{item.undeclared_code_locations.join(", ")}</strong></div>
                        {/if}
                        {#if item.claim?.history.length}
                          <div><span>Owner / claimed</span><strong>{item.claim.owner_name ?? "Released"} · {formatDuration(item.claim.total_claimed_ms)} total</strong></div>
                          <div><span>Time waiting unclaimed</span><strong>{formatDuration(item.claim.queue_wait_ms)}</strong></div>
                          <div><span>Estimated active work</span><strong>{formatDuration(item.claim.active_work_ms)}</strong></div>
                          {#if item.claim.stall_reasons.length}<div><span>Potential stall</span><strong>{item.claim.stall_reasons.includes("three_other_items_completed") ? "Three other items completed without progress. " : ""}{item.claim.stall_reasons.includes("owner_inactive_one_hour") ? "Owner inactive for one hour." : ""}</strong></div>{/if}
                          <div><span>Claim history</span><strong>{#each item.claim.history as interval}<span class="gate-row">{interval.owner_name} · {new Date(interval.claimed_at).toLocaleString()} → {interval.ended_at ? new Date(interval.ended_at).toLocaleString() : "present"}{#if interval.explanation} · {interval.explanation}{/if}</span>{/each}</strong></div>
                        {/if}
                        <div><span>Gates</span><strong>{gateSummary(item)}</strong></div>
                        {#if item.gates.length}
                          <div class="gate-rows">
                            <span>Gate runs</span>
                            <strong>
                              {#each gateRows(item) as gate}
                                <span class="gate-row gate-{gate.state}">
                                  <span class="gate-state">{gateStateLabel(gate.state)}</span>
                                  <code class="gate-spec">{gate.kind}: {gate.spec}{gate.cwd ? ` (in ${gate.cwd})` : ""}</code>
                                  {#if gate.evidence}<span class="gate-evidence">{gate.evidence.slice(0, 300)}</span>{/if}
                                </span>
                              {/each}
                            </strong>
                          </div>
                        {/if}
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
