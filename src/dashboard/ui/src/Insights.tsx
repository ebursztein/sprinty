import { useEffect, useRef, useState } from "react";
import { Chart, registerables, type ChartConfiguration } from "chart.js";
import type { SprintView } from "../../../domain/projection.js";
import {
  buildCompletionSummary,
  buildEventBuckets,
  recentTimelineWindow,
} from "../chart-windows.js";
import {
  buildCodeMetricRows,
  buildChangelogVerbRows,
  formatDuration,
} from "../presentation.js";
import { deriveDashboardModel } from "../model.js";
import { Empty } from "./ui";
Chart.register(...registerables);
function Plot({
  config,
  label,
}: {
  config: ChartConfiguration;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = new Chart(ref.current, config);
    return () => chart.destroy();
  }, [config]);
  return (
    <div className="chart-frame">
      <canvas ref={ref} aria-label={label} role="img" />
    </div>
  );
}
export default function Insights({ sprint }: { sprint: SprintView }) {
  const [hours, setHours] = useState(4);
  const now = Date.parse(sprint.eta?.estimated_at ?? new Date().toISOString());
  const start = Date.parse(sprint.created_at);
  const recent = recentTimelineWindow(
    sprint.timeline,
    hours * 3600000,
    now,
    start,
  );
  const buckets = buildEventBuckets(recent, {
    nowMs: now,
    windowMs: hours * 3600000,
    sprintStartedAtMs: start,
    bucketCount: 16,
    categories: ["added", "edited", "closed"],
    formatLabel: (ts) =>
      new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
  });
  const allItems = sprint.subsprints.flatMap((s) => s.items);
  const summary = buildCompletionSummary(
    sprint.timeline,
    allItems.filter((i) => i.status === "open").length,
    allItems.length,
    {
      nowMs: now,
      windowMs: hours * 3600000,
      sprintStartedAtMs: start,
      estimate: sprint.eta,
      movingAverageWindow: 5,
      formatEta: (ts) => new Date(ts).toLocaleString(),
    },
  );
  const dark = document.documentElement.classList.contains("dark");
  const ink = dark ? "#94a3b8" : "#64748b";
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { labels: { color: ink, usePointStyle: true, boxWidth: 6 } },
    },
    scales: {
      x: { ticks: { color: ink, maxTicksLimit: 6 }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: { color: ink },
        grid: { color: dark ? "#ffffff0b" : "#0000000b" },
      },
    },
  };
  const activity: ChartConfiguration = {
    type: "bar",
    data: {
      labels: buckets.map((b) => b.label),
      datasets: ["added", "edited", "closed"].map((name, i) => ({
        label: name,
        data: buckets.map(
          (b) => b.segments.find((s) => s.category === name)?.count ?? 0,
        ),
        backgroundColor: ["#3b82f6", "#a78bfa", "#94a3b8"][i],
        borderRadius: 3,
      })),
    },
    options: base,
  };
  const completion: ChartConfiguration = {
    type: "line",
    data: {
      labels: summary.ratePoints.map((p) =>
        new Date(p.time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      ),
      datasets: [
        {
          label: "Resolved work (%)",
          data: summary.ratePoints.map((p) => p.percent),
          borderColor: "#3b82f6",
          backgroundColor: "#3b82f61a",
          fill: true,
          stepped: "after",
          pointRadius: 0,
        },
      ],
    },
    options: base,
  };
  return (
    <div className="insights">
      <div className="view-heading">
        <div>
          <h2>Progress with context</h2>
          <p>
            Charts show the record. ETA comes from the shared activity-aware
            estimator.
          </p>
        </div>
        <label>
          Chart window{" "}
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value="1">Last hour</option>
            <option value="4">Last 4 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
          </select>
        </label>
      </div>
      <div className="chart-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Completion over time</h3>
              <p>Resolved items across the selected window</p>
            </div>
          </div>
          {summary.ratePoints.length ? (
            <Plot label="Completion over time" config={completion} />
          ) : (
            <Empty title="No completion history yet">
              Completed work will appear here.
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Event activity</h3>
              <p>Added, edited, and closed work</p>
            </div>
          </div>
          <Plot label="Event activity" config={activity} />
        </section>
      </div>
      <div className="chart-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Code changes</h3>
              <p>Git-backed changes recorded for this sprint</p>
            </div>
          </div>
          <dl className="stat-list">
            {buildCodeMetricRows(deriveDashboardModel(sprint)).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Changelog</h3>
              <p>What the sprint delivered</p>
            </div>
          </div>
          <dl className="stat-list">
            {buildChangelogVerbRows(sprint).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
            <div>
              <dt>ETA training samples</dt>
              <dd>{sprint.eta?.sample_count ?? 0}/20</dd>
            </div>
            <div>
              <dt>Estimated remaining effort</dt>
              <dd>{formatDuration(sprint.eta?.remaining_work_ms ?? null)}</dd>
            </div>
          </dl>
        </section>
      </div>
      {sprint.coverage && (
        <section className="panel coverage-panel">
          <h3>Coverage</h3>
          <dl className="stat-list">
            {(["lines", "branches", "functions"] as const).map((key) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {sprint.coverage![key].percent.toFixed(1)}% ·{" "}
                  {sprint.coverage![key].covered}/{sprint.coverage![key].total}
                </dd>
              </div>
            ))}
          </dl>
          <code>{sprint.coverage.path}</code>
        </section>
      )}
    </div>
  );
}
