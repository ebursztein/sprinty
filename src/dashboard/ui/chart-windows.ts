import type { TimelineEntry } from "../../domain/projection.js";

export type EventSegment = { category: string; count: number };
export type EventBucket = { label: string; total: number; segments: EventSegment[] };
export type CompletionPoint = { time: number; movingAverageMs: number; durationMs: number };
export type CompletionRatePoint = { time: number; percent: number; completed: number };

export interface CompletionSummary {
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
}

type WindowOptions = {
  nowMs: number;
  windowMs: number;
  sprintStartedAtMs?: number | null | undefined;
};

export function parseTs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const value = Date.parse(ts);
  return Number.isNaN(value) ? null : value;
}

export function recentTimelineWindow(entries: TimelineEntry[], windowMs: number, nowMs: number, sprintStartedAtMs?: number | null): TimelineEntry[] {
  const cutoff = fixedWindowStart({ nowMs, windowMs, sprintStartedAtMs });
  return entries.filter((entry) => {
    const time = parseTs(entry.ts);
    return time !== null && time >= cutoff && time <= nowMs;
  });
}

export function buildEventBuckets(
  entries: TimelineEntry[],
  options: {
    nowMs: number;
    windowMs: number;
    sprintStartedAtMs?: number | null;
    bucketCount: number;
    categories: string[];
    formatLabel: (ts: number) => string;
  },
): EventBucket[] {
  const bucketCount = Math.max(1, options.bucketCount);
  const windowStart = fixedWindowStart(options);
  const effectiveWindowMs = Math.max(1, options.nowMs - windowStart);
  const bucketMs = Math.max(1, effectiveWindowMs / bucketCount);
  const buckets: { label: string; total: number; counts: Map<string, number> }[] = Array.from({ length: bucketCount }, (_, index) => ({
    label: options.formatLabel(windowStart + index * bucketMs),
    total: 0,
    counts: new Map(),
  }));

  const normalized = entries
    .map((entry) => ({ entry, time: parseTs(entry.ts) }))
    .filter((row): row is { entry: TimelineEntry; time: number } => row.time !== null && row.time >= windowStart && row.time <= options.nowMs)
    .sort((a, b) => a.time - b.time);

  for (const { entry, time } of normalized) {
    const category = eventAction(entry);
    if (!category) continue;

    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((time - windowStart) / bucketMs)));
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;

    bucket.total += 1;
    bucket.counts.set(category, (bucket.counts.get(category) ?? 0) + 1);
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    total: bucket.total,
    segments: options.categories
      .map((category) => ({ category, count: bucket.counts.get(category) ?? 0 }))
      .filter((segment) => segment.count > 0),
  }));
}

export function eventAction(entry: TimelineEntry): string | null {
  if (
    entry.type === "sprint_created" ||
    entry.type === "subsprint_created" ||
    entry.type === "item_added" ||
    entry.type === "artifact_added" ||
    entry.type === "follow_up_added" ||
    entry.type === "dependencies_added"
  ) return "added";

  if (
    entry.type === "item_updated" ||
    entry.type === "note_added" ||
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

export function buildCompletionSummary(
  entries: TimelineEntry[],
  openItems: number,
  totalItems: number,
  options: {
    nowMs: number;
    windowMs: number;
    sprintStartedAtMs?: number | null;
    movingAverageWindow: number;
    formatEta: (ts: number) => string;
  },
): CompletionSummary {
  const historyStart = fixedHistoryStart(options);
  const normalized = entries
    .map((entry) => ({ entry, time: parseTs(entry.ts) }))
    .filter((row): row is { entry: TimelineEntry; time: number } => row.time !== null && row.time >= historyStart && row.time <= options.nowMs)
    .sort((a, b) => a.time - b.time);

  const windowStart = fixedWindowStart(options);
  const starts = new Map<string, number>();
  const points: CompletionPoint[] = [];
  const ratePoints: CompletionRatePoint[] = [];
  const rateTotal = Math.max(0, totalItems);
  let completedItems = 0;

  if (rateTotal > 0) {
    completedItems = Math.min(rateTotal, normalized.filter((row) => row.entry.type === "item_resolved" && row.time < windowStart).length);
    ratePoints.push({ time: windowStart, percent: percent(completedItems, rateTotal), completed: completedItems });
  }

  for (const { entry, time } of normalized) {
    if (entry.type === "item_added") {
      starts.set(entry.id, time);
      continue;
    }

    if (entry.type !== "item_resolved") continue;
    if (time < windowStart) {
      starts.delete(entry.id);
      continue;
    }

    const started = starts.get(entry.id);
    const durationStart = Math.max(started ?? windowStart, windowStart);
    const durationMs = Math.max(0, time - durationStart);
    starts.delete(entry.id);
    points.push({ time, durationMs, movingAverageMs: 0 });

    if (rateTotal > 0) {
      completedItems = Math.min(rateTotal, completedItems + 1);
      ratePoints.push({ time, percent: percent(completedItems, rateTotal), completed: completedItems });
    }
  }

  if (rateTotal > 0) {
    const last = ratePoints[ratePoints.length - 1];
    if (last && last.time < options.nowMs) {
      ratePoints.push({ time: options.nowMs, percent: percent(completedItems, rateTotal), completed: completedItems });
    }
  }

  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - options.movingAverageWindow + 1);
    const window = points.slice(start, i + 1);
    const sum = window.reduce((acc, point) => acc + point.durationMs, 0);
    points[i] = { ...points[i]!, movingAverageMs: Math.round(sum / window.length) };
  }

  const durations = points.map((point) => point.durationMs);
  const stats = durationStats(durations);
  const remainingItems = Math.max(0, openItems);
  const etaMs = stats.avgMs && stats.avgMs > 0 ? stats.avgMs * remainingItems : null;
  const projectedAt = etaMs && remainingItems > 0 ? options.nowMs + etaMs : null;
  const etaAt = projectedAt ? options.formatEta(projectedAt) : null;
  const rateEnd = projectedAt && projectedAt > options.nowMs ? projectedAt : options.nowMs;

  return {
    points,
    ratePoints,
    rateStart: windowStart,
    rateEnd,
    avgMs: stats.avgMs,
    medianMs: stats.medianMs,
    minMs: stats.minMs,
    maxMs: stats.maxMs,
    etaMs,
    etaAt,
    projectedAt,
    openItems,
    remainingItems,
  };
}

function fixedWindowStart(options: WindowOptions): number {
  const requested = options.nowMs - options.windowMs;
  if (options.sprintStartedAtMs === null || options.sprintStartedAtMs === undefined) return requested;
  const sprintStart = Math.min(options.nowMs, options.sprintStartedAtMs);
  return Math.max(requested, sprintStart);
}

function fixedHistoryStart(options: WindowOptions): number {
  if (options.sprintStartedAtMs === null || options.sprintStartedAtMs === undefined) return Number.NEGATIVE_INFINITY;
  return Math.min(options.nowMs, options.sprintStartedAtMs);
}

function percent(done: number, total: number): number {
  return total <= 0 ? 0 : Math.round((done / total) * 100);
}

function durationStats(durations: number[]): { avgMs: number | null; medianMs: number | null; minMs: number | null; maxMs: number | null } {
  if (!durations.length) return { avgMs: null, medianMs: null, minMs: null, maxMs: null };
  const avgMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    avgMs,
    medianMs,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
  };
}
