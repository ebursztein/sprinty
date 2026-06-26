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
    expect(app).toContain("const targetEventBuckets = 30");
    expect(app).toContain("new Chart(eventChartCanvas");
    expect(app).toContain("new Chart(completionChartCanvas");
    expect(app).toContain("<canvas bind:this={eventChartCanvas}");
    expect(app).toContain("<canvas bind:this={completionChartCanvas}");
    expect(app).toContain("Completion rate over time");
    expect(app).toContain('label: "Projected"');
    expect(app).toContain("borderDash");
    expect(app).not.toContain("Completion pace (5-item moving avg)");
    expect(app).toContain('class="code-bars"');
    expect(app).toContain('code-bar-${row.tone}');
    expect(styles).toContain(".code-bar-add");
    expect(styles).toContain(".code-bar-delete");
    expect(styles).toContain(".code-bar-file");
    expect(styles).toContain(".code-bar-gate");
    expect(cssBlock(".completion-stats-grid")).not.toContain("grid-cols-2");
    expect(cssBlock(".completion-stats-grid div")).toContain("justify-between");
    expect(cssBlock(".topbar")).toContain("grid-cols");
    expect(cssBlock(".sprint-metadata-fold")).toContain("col-span-2");
    expect(cssBlock(".code-bar-row")).toContain("grid-cols");
  });
});
