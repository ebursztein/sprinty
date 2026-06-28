import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../domain/projection.js";
import { buildCompletionSummary, buildEventBuckets, recentTimelineWindow } from "./chart-windows.js";

const hour = 60 * 60 * 1000;
const now = Date.parse("2026-06-28T12:00:00.000Z");
const windowMs = 4 * hour;

function event(type: TimelineEntry["type"], hoursAgo: number, id = "S01-001"): TimelineEntry {
  return {
    seq: Math.round(hoursAgo * 10),
    ts: new Date(now - hoursAgo * hour).toISOString(),
    type,
    id,
    text: type,
  } as TimelineEntry;
}

describe("dashboard fixed chart windows", () => {
  it("filters recent timeline events against wall-clock now, not the newest historical event", () => {
    const entries = [
      event("item_added", 6),
      event("note_added", 5),
    ];

    expect(recentTimelineWindow(entries, windowMs, now)).toEqual([]);
  });

  it("builds event buckets over the fixed wall-clock window even when stale events exist", () => {
    const buckets = buildEventBuckets([event("item_added", 6)], {
      nowMs: now,
      windowMs,
      bucketCount: 4,
      categories: ["added", "edited", "closed"],
      formatLabel: (ts) => String(ts),
    });

    expect(buckets).toHaveLength(4);
    expect(buckets.map((bucket) => bucket.total)).toEqual([0, 0, 0, 0]);
    expect(buckets[0]?.label).toBe(String(now - windowMs));
    expect(buckets[3]?.label).toBe(String(now - hour));
  });

  it("keeps completion rate anchored to now and projects ETA from now", () => {
    const summary = buildCompletionSummary([
      event("item_added", 7, "S01-001"),
      event("item_resolved", 6, "S01-001"),
      event("item_added", 2, "S01-002"),
      event("item_resolved", 1, "S01-002"),
    ], 1, 3, {
      nowMs: now,
      windowMs,
      movingAverageWindow: 5,
      formatEta: (ts) => new Date(ts).toISOString(),
    });

    expect(summary.rateStart).toBe(now - windowMs);
    expect(summary.ratePoints.map((point) => [point.time, point.completed])).toEqual([
      [now - windowMs, 1],
      [now - hour, 2],
      [now, 2],
    ]);
    expect(summary.avgMs).toBe(hour);
    expect(summary.projectedAt).toBe(now + hour);
    expect(summary.rateEnd).toBe(now + hour);
  });

  it("does not render chart windows before the sprint started", () => {
    const sprintStartedAtMs = now - hour;
    const buckets = buildEventBuckets([event("item_added", 2)], {
      nowMs: now,
      windowMs,
      sprintStartedAtMs,
      bucketCount: 4,
      categories: ["added", "edited", "closed"],
      formatLabel: (ts) => String(ts),
    });
    const summary = buildCompletionSummary([
      event("item_added", 2.5, "S00-001"),
      event("item_resolved", 2, "S00-001"),
      event("item_added", 0.75, "S01-001"),
      event("item_resolved", 0.25, "S01-001"),
    ], 1, 2, {
      nowMs: now,
      windowMs,
      sprintStartedAtMs,
      movingAverageWindow: 5,
      formatEta: (ts) => new Date(ts).toISOString(),
    });

    expect(recentTimelineWindow([event("item_added", 2)], windowMs, now, sprintStartedAtMs)).toEqual([]);
    expect(buckets[0]?.label).toBe(String(sprintStartedAtMs));
    expect(summary.rateStart).toBe(sprintStartedAtMs);
    expect(summary.ratePoints[0]).toEqual({ time: sprintStartedAtMs, percent: 0, completed: 0 });
  });
});
