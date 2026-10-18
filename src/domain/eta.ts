import { ACTIVITY_WINDOW_MS } from "./collaboration.js";
import type { ItemView, SprintView } from "./projection.js";
import { dependencyResolver } from "./work-order.js";
export interface EtaEstimate {
    status: "learning" | "running" | "paused" | "awaiting_handover" | "complete";
    remaining_work_ms: number | null;
    range_ms: [
        number,
        number
    ] | null;
    finish_at: string | null;
    finish_range_at: [
        string,
        string
    ] | null;
    sample_count: number;
    active_agent_count: number;
    estimated_at: string;
}
export function quantile(values: number[], fraction: number): number {
    const position = (values.length - 1) * fraction, index = Math.floor(position);
    return values[index]! + (values[Math.min(index + 1, values.length - 1)]! - values[index]!) * (position - index);
}
export function estimateEta(view: SprintView, now: number): EtaEstimate {
    const items = view.subsprints.flatMap(s => s.items);
    const open = items.filter(i => i.status === "open");
    const samples = items.filter(i => i.status === "completed" && i.claim.history.length && i.claim.active_work_ms > 0)
        .sort((a, b) => (a.resolved_at ?? "").localeCompare(b.resolved_at ?? "") || a.id.localeCompare(b.id)).slice(-20).map(i => i.claim.active_work_ms).sort((a, b) => a - b);
    const active = view.agents.filter(a => a.attached && now - Date.parse(a.last_activity_at) <= ACTIVITY_WINDOW_MS && now >= Date.parse(a.last_activity_at));
    const result: EtaEstimate = { status: "learning", remaining_work_ms: null, range_ms: null, finish_at: null, finish_range_at: null, sample_count: samples.length, active_agent_count: active.length, estimated_at: new Date(now).toISOString() };
    if (!open.length)
        return { ...result, status: "complete", remaining_work_ms: 0, range_ms: [0, 0] };
    if (samples.length < 3)
        return result;
    // Estimate remaining aggregate effort even while paused; it does not assume a future worker count.
    const effort = (item: ItemView, typical: number) => Math.max(typical * 0.25, typical - item.claim.active_work_ms);
    const total = (typical: number) => Math.round(open.reduce((sum, i) => sum + effort(i, typical), 0));
    result.remaining_work_ms = total(quantile(samples, .5));
    result.range_ms = [total(quantile(samples, .25)), total(quantile(samples, .75))];
    if (!active.length)
        return { ...result, status: "paused" };
    if (open.some(i => i.claim.owner && !active.some(a => a.id === i.claim.owner)))
        return { ...result, status: "awaiting_handover" };
    const resolveDependencies = dependencyResolver(view);
    const deps = new Map(open.map(i => [i.id, resolveDependencies(i)]));
    // Empty dependent subsprints cannot be scheduled as item work.
    if (open.some(i => [...i.dependencies, ...(view.subsprints.find(s => s.id === i.subsprint_id)?.dependencies ?? [])].some(id => view.subsprints.some(s => s.id === id && s.status === "open" && !s.items.length))))
        return { ...result, status: "learning" };
    const schedule = (typical: number): number | null => {
        const remaining = new Map(open.map(i => [i.id, i]));
        const finished = new Map<string, number>();
        const workers = new Map(active.map(a => [a.id, 0]));
        const downstream = new Map<string, number>();
        const path = (id: string, visiting = new Set<string>()): number => {
            if (visiting.has(id))
                return Infinity;
            if (downstream.has(id))
                return downstream.get(id)!;
            const next = new Set(visiting);
            next.add(id);
            const successors = open.filter(i => deps.get(i.id)!.includes(id));
            const length = effort(remaining.get(id) ?? open.find(i => i.id === id)!, typical) + Math.max(0, ...successors.map(i => path(i.id, next)));
            downstream.set(id, length);
            return length;
        };
        for (const item of open)
            if (!Number.isFinite(path(item.id)))
                return null;
        while (remaining.size) {
            const ready = [...remaining.values()].filter(i => deps.get(i.id)!.every(id => finished.has(id)));
            ready.sort((a, b) => Number(!!b.claim.owner) - Number(!!a.claim.owner) || downstream.get(b.id)! - downstream.get(a.id)! || a.id.localeCompare(b.id));
            const item = ready[0];
            if (!item)
                return null;
            const readyAt = Math.max(0, ...deps.get(item.id)!.map(id => finished.get(id)!));
            const candidates = [...workers].filter(([id]) => !item.claim.owner || id === item.claim.owner)
                .sort((a, b) => Math.max(a[1], readyAt) - Math.max(b[1], readyAt) || a[0].localeCompare(b[0]));
            const worker = candidates[0];
            if (!worker)
                return null;
            const stop = Math.max(worker[1], readyAt) + effort(item, typical);
            workers.set(worker[0], stop);
            finished.set(item.id, stop);
            remaining.delete(item.id);
        }
        return Math.round(Math.max(...finished.values()));
    };
    const expected = schedule(quantile(samples, .5)), low = schedule(quantile(samples, .25)), high = schedule(quantile(samples, .75));
    if (expected === null || low === null || high === null)
        return { ...result, status: "learning" };
    return { ...result, status: "running", finish_at: new Date(now + expected).toISOString(), finish_range_at: [new Date(now + Math.min(low, expected, high)).toISOString(), new Date(now + Math.max(low, expected, high)).toISOString()] };
}
