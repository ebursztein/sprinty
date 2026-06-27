import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./src/App.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");

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
    expect(app).toContain("DoughnutController");
    expect(app).toContain("Filler");
    expect(app).toContain("Legend");
    expect(app).not.toContain("PieController");
    expect(app).toContain("ArcElement");
    expect(app).toContain("const targetEventBuckets = 30");
    expect(app).toContain("const changelogVerbCategories");
    expect(app).toContain("new Chart(changelogVerbChartCanvas");
    expect(app).toContain("new Chart(eventChartCanvas");
    expect(app).toContain("new Chart(completionChartCanvas");
    expect(app).not.toContain("new Chart(statusChartCanvas");
    expect(app).toContain("<canvas bind:this={changelogVerbChartCanvas}");
    expect(app).toContain('aria-label="Changelog verb doughnut chart"');
    expect(app).toContain("<canvas bind:this={eventChartCanvas}");
    expect(app).toContain("<canvas bind:this={completionChartCanvas}");
    expect(app).not.toContain("<canvas bind:this={statusChartCanvas}");
    expect(app).toContain("Completion rate over time");
    expect(app).toContain("Event activity by action");
    expect(app).toContain("Changelog verbs");
    expect(app).toContain('const chartCategories = ["added", "edited", "closed"]');
    expect(app).toContain('label: "Projected"');
    expect(app).toContain("borderDash");
    expect(app).toContain('fill: "origin"');
    expect(app).toContain('stepped: "after"');
    expect(app).toContain("buildProjectedRateSteps");
    expect(app).toContain("summary.remainingItems");
    expect(app.indexOf("Chart.getChart")).toBeLessThan(app.indexOf("new Chart(changelogVerbChartCanvas"));
    expect(app).toContain("stepSize: 25");
    expect(app).toContain("completionStatsLine(completionSummary)");
    expect(app).toContain('class="completion-summary-line"');
    expect(app).not.toContain("<small>{completionStatsLine(completionSummary)}</small>");
    expect(app).toContain('type: "doughnut"');
    expect(app).toContain('cutout: "62%"');
    expect(app).toContain("legend: {");
    expect(app).toContain('position: "right"');
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
    expect(app).not.toContain('label: "Commits"');
    expect(app).toContain("buildChangelogVerbRows");
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
    expect(cssBlock(".verb-chart-shell")).toContain("h-52");
    expect(cssBlock(".verb-chart-shell")).not.toContain("border");
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
    expect(cssBlock(".metrics-grid")).toContain("lg:grid-cols-2");
    expect(cssBlock(".metric-panel")).toContain("min-w-0");
    expect(cssBlock(".progress-bar-row")).toContain("grid-cols");
    expect(cssBlock(".verb-stat")).toBe("");
  });
});
