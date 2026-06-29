import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./src/App.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");
const chartWindows = readFileSync(new URL("./chart-windows.ts", import.meta.url), "utf8");
const summaryIcon = readFileSync(new URL("./src/SummaryIcon.svelte", import.meta.url), "utf8");

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

describe("dashboard presentation", () => {
  it("keeps blocked item rows readable without blue ids or strikeout", () => {
    expect(cssBlock(".todo-blocked .todo-title")).not.toContain("line-through");
    expect(cssBlock(".tree-id,\n  .todo-id")).not.toContain("text-primary");
    expect(cssBlock(".tree-id,\n  .todo-id")).toContain("text-base-content");
  });

  it("renders ledger rows without seq or event columns and puts target first", () => {
    expect(app).toContain("<tr><th>Target</th><th>Type</th><th>Verb</th><th>Text</th><th>Time</th></tr>");
    expect(app).not.toContain("<th>Seq</th>");
    expect(app).not.toContain("<th>Event</th>");
    expect(app).not.toContain("<td>{row.seq}</td>");
    expect(app).not.toContain("<td><code>{row.type}</code></td>");
    expect(app).toContain("ledgerEntryCountLabel(filteredLedgerRows.length, ledgerRows.length)");
    expect(app).toContain('"entries"');
    expect(app).not.toContain("{filteredLedgerRows.length}/{ledgerRows.length} rows");
  });

  it("uses color-coded ledger text instead of pill styling", () => {
    expect(cssBlock(".ledger-chip")).not.toContain("rounded-full");
    expect(cssBlock(".ledger-chip")).not.toContain("ring-1");
    expect(cssBlock(".ledger-chip")).toContain("font-semibold");
  });

  it("keeps expanded item descriptions full width before metadata", () => {
    expect(cssBlock(".todo-detail")).not.toContain("lg:grid-cols");
    expect(app.indexOf("detail-copy")).toBeLessThan(app.indexOf("detail-grid"));
  });

  it("uses clickable dependency ids and clipped subsprint labels", () => {
    expect(app).toContain('class="tree-label" title={sub.label}');
    expect(cssBlock(".tree-label")).toContain("truncate");
    expect(app).toContain('class="dependency-link"');
    expect(app).toContain("on:click={() => openItem(dependency)}");
  });

  it("renders readable dashboard analytics charts and stats", () => {
    expect(app).toContain('from "chart.js"');
    expect(app).toContain("Chart.register");
    expect(app).toContain("Filler");
    expect(app).not.toContain("PieController");
    expect(app).not.toContain("DoughnutController");
    expect(app).not.toContain("ArcElement");
    expect(app).not.toContain("Legend");
    expect(app).toContain("const targetEventBuckets = 30");
    expect(app).toContain("const chartWindowMs = 4 * 60 * 60 * 1000");
    expect(app).toContain("sprintStartedAtMs = model ? parseTs(model.sprint.created_at) : null");
    expect(app).toContain("recentTimelineWindow(model.sprint.timeline, chartWindowMs, nowMs, sprintStartedAtMs)");
    expect(app).toContain("buildEventBuckets(recentTimeline, { nowMs, windowMs: chartWindowMs, sprintStartedAtMs");
    expect(app).toContain("buildCompletionSummary(model.sprint.timeline, model.progress.items.open, model.progress.items.total, {");
    expect(app).toContain("const changelogVerbCategories");
    expect(app).toContain("new Chart(eventChartCanvas");
    expect(app).toContain("new Chart(completionChartCanvas");
    expect(app).not.toContain("new Chart(statusChartCanvas");
    expect(app).not.toContain("new Chart(changelogVerbChartCanvas");
    expect(app).not.toContain("changelogVerbChartCanvas");
    expect(app).toContain('class="summary-table" aria-label="Changelog verb table"');
    expect(app).toContain('class="summary-table" aria-label="Code count table"');
    expect(app).toContain("<canvas bind:this={eventChartCanvas}");
    expect(app).toContain("<canvas bind:this={completionChartCanvas}");
    expect(app).not.toContain("<canvas bind:this={statusChartCanvas}");
    expect(app).toContain("Completion rate over time");
    expect(app).toContain("Event activity by action");
    expect(app).toContain("Changelog verbs");
    expect(app).toContain('const chartCategories = ["added", "edited", "closed"]');
    expect(chartWindows).toContain('entry.type === "note_added"');
    expect(chartWindows).toContain('entry.type === "note_updated"');
    expect(app).toContain('label: "Projected"');
    expect(app).toContain("borderDash");
    expect(app).toContain('fill: "origin"');
    expect(app).toContain('stepped: "after"');
    expect(app).toContain("pointRadius: 0");
    expect(app).toContain("pointHoverRadius: 0");
    expect(app).toContain("buildProjectedRateSteps");
    expect(app).toContain("summary.remainingItems");
    expect(app.indexOf("Chart.getChart")).toBeLessThan(app.indexOf("new Chart(eventChartCanvas"));
    expect(app).toContain("stepSize: 25");
    expect(app).toContain("completionStatsLine(completionSummary)");
    expect(app).toContain('class="completion-summary-line"');
    expect(app).not.toContain("<small>{completionStatsLine(completionSummary)}</small>");
    expect(app).not.toContain('type: "doughnut"');
    expect(app).not.toContain('cutout: "62%"');
    expect(app).not.toContain("Completion pace (5-item moving avg)");
    expect(app).not.toContain("Completion stats");
    expect(app).not.toContain('class="metric-panel completion-stats"');
    expect(app).not.toContain('class="metric-panel metric-status"');
    expect(app).not.toContain('class="status-chart-shell"');
    expect(app).not.toContain('class="status-legend"');
    expect(app).toContain('class="progress progress-primary progress-track"');
    expect(app).toContain("buildProgressMetricRows");
    expect(app).toContain('class="progress-bars"');
    expect(app).toContain("Progress ratios");
    expect(app).toContain("Sprint progress");
    expect(app).toContain("closedSubsprints");
    expect(app).not.toContain('{ label: "Sprint", value');
    expect(app).not.toContain('class="stat-card-grid"');
    expect(app).not.toContain("Activity stats");
    expect(app).not.toContain('label: "Follow-ups"');
    expect(app).toContain('{ label: "Commits"');
    expect(app).toContain('{ label: "Added"');
    expect(app).toContain('{ label: "Changed"');
    expect(app).toContain('{ label: "Files edited"');
    expect(app).toContain("buildChangelogVerbRows");
    expect(app).toContain("buildCodeMetricRows");
    expect(app).toContain("import SummaryIcon from \"./SummaryIcon.svelte\"");
    expect(app).toContain('<SummaryIcon name={row.icon} className="summary-icon" />');
    expect(app).toContain('icon: "plus"');
    expect(app).toContain('if (tone === "fixed") return "check"');
    expect(app).toContain('icon: "edit"');
    expect(app).toContain('icon: "file"');
    expect(app).toContain('icon: "command"');
    expect(app).not.toContain("summary-dot");
    expect(summaryIcon).toContain('data-summary-icon={name}');
    expect(summaryIcon).toContain('name === "plus"');
    expect(summaryIcon).toContain('name === "check"');
    expect(summaryIcon).toContain('name === "edit"');
    expect(summaryIcon).toContain('name === "file"');
    expect(summaryIcon).toContain('name === "command"');
    expect(app).toContain("countProgressClass(row.tone)");
    expect(app).not.toContain("statToneClass(row.tone)");
    expect(app).toContain("progress-success");
    expect(app).toContain("progress-warning");
    expect(app).not.toContain('class="code-bars"');
    expect(app).not.toContain("count-bar-fill");
    expect(styles).toContain(".legend-chip.bucket-added");
    expect(styles).toContain(".legend-chip.bucket-edited");
    expect(styles).toContain(".legend-chip.bucket-closed");
    expect(cssBlock(".metric-status")).toBe("");
    expect(cssBlock(".status-chart-shell")).toBe("");
    expect(cssBlock(".completion-stats-grid")).toBe("");
    expect(cssBlock(".verb-chart-shell")).toBe("");
    expect(cssBlock(".chart-stack")).not.toContain("border");
    expect(cssBlock(".completion-chart-shell")).not.toContain("border");
    expect(cssBlock(".verb-legend")).toBe("");
    expect(cssBlock(".completion-summary-line")).toContain("text-right");
    expect(cssBlock(".tree-row-done")).not.toContain("grayscale");
    expect(cssBlock(".dot-done")).toContain("bg-success");
    expect(cssBlock(".dot-todo,\n  .dot-open")).toContain("bg-warning");
    expect(cssBlock(".topbar")).toContain("grid-cols");
    expect(cssBlock(".sprint-metadata-fold")).toContain("col-span-2");
    expect(cssBlock(".metrics-grid")).not.toContain("lg:grid-cols-3");
    expect(cssBlock(".metrics-grid")).toContain("lg:grid-cols-4");
    expect(cssBlock(".metric-progress")).toContain("lg:col-span-2");
    expect(cssBlock(".summary-table")).toContain("table-fixed");
    expect(cssBlock(".summary-icon")).toContain("h-4");
    expect(cssBlock(".summary-added")).toContain("text-blue-500");
    expect(cssBlock(".summary-fixed,\n  .summary-file")).toContain("text-emerald-500");
    expect(cssBlock(".summary-changed")).toContain("text-amber-500");
    expect(cssBlock(".metric-code")).toContain("content-start");
    expect(cssBlock(".metric-panel")).toContain("min-w-0");
    expect(cssBlock(".progress-bar-row")).toContain("grid-cols");
    expect(cssBlock(".verb-stat")).toBe("");
  });
});
