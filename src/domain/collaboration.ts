import type { LedgerEvent } from "./events.js";
import type { SprintView } from "./projection.js";
export const ACTIVITY_WINDOW_MS = 5 * 60000;
export const INACTIVE_STALL_MS = 60 * 60000;
export interface AgentView {
    id: string;
    name: string;
    attached: boolean;
    last_activity_at: string;
    activity: string[];
}
export interface ClaimInterval {
    owner: string;
    owner_name: string;
    generation: number;
    claimed_at: string;
    ended_at: string | null;
    explanation: string | null;
}
export interface ClaimState {
    owner: string | null;
    owner_name: string | null;
    generation: number;
    history: ClaimInterval[];
    claimed_at: string | null;
    last_progress_at: string | null;
    claim_duration_ms: number;
    total_claimed_ms: number;
    active_work_ms: number;
    queue_wait_ms: number;
    owner_inactive_ms: number;
    other_completions: number;
    stall_reasons: string[];
}
export function emptyClaim(): ClaimState {
    return { owner: null, owner_name: null, generation: 0, history: [], claimed_at: null, last_progress_at: null, claim_duration_ms: 0, total_claimed_ms: 0, active_work_ms: 0, queue_wait_ms: 0, owner_inactive_ms: 0, other_completions: 0, stall_reasons: [] };
}
export function collaboration(view: SprintView, events: LedgerEvent[], now: number): void {
    const agents = new Map<string, AgentView>();
    const items = new Map(view.subsprints.flatMap(s => s.items).map(i => [i.id, i]));
    const progressSeq = new Map<string, number>();
    const completed = new Map<string, number>();
    const artifacts = new Map<string, string[]>();
    const notes = new Map<string, string>();
    for (const item of items.values())
        item.claim = emptyClaim();
    const progress = (id: string, event: LedgerEvent) => {
        const claim = items.get(id)?.claim;
        if (claim?.owner) {
            claim.last_progress_at = event.ts;
            progressSeq.set(id, event.seq);
        }
    };
    const end = (id: string, ts: string) => {
        const claim = items.get(id)?.claim;
        const interval = claim?.history.at(-1);
        if (interval && interval.ended_at === null)
            interval.ended_at = ts;
        if (claim) {
            claim.owner = null;
            claim.owner_name = null;
            claim.claimed_at = null;
        }
    };
    for (const event of events) {
        if (event.type === "agent_attached")
            agents.set(event.id, { id: event.id, name: event.name, attached: true, last_activity_at: event.ts, activity: [event.ts] });
        const actor = agents.get(event.agent_id ?? (event.type === "agent_activity" ? event.id : ""));
        if (actor) {
            actor.last_activity_at = event.ts;
            actor.activity.push(event.ts);
        }
        switch (event.type) {
            case "agent_detached": {
                const agent = agents.get(event.id);
                if (agent)
                    agent.attached = false;
                for (const item of items.values())
                    if (item.claim.owner === event.id)
                        end(item.id, event.ts);
                break;
            }
            case "item_claimed": {
                const claim = items.get(event.item_id)?.claim;
                if (!claim)
                    break;
                end(event.item_id, event.ts);
                claim.owner = event.owner;
                claim.owner_name = agents.get(event.owner)?.name ?? event.owner;
                claim.generation = event.generation;
                claim.claimed_at = event.ts;
                claim.history.push({ owner: event.owner, owner_name: claim.owner_name, generation: event.generation, claimed_at: event.ts, ended_at: null, explanation: event.explanation ?? null });
                progress(event.item_id, event);
                break;
            }
            case "item_released":
                end(event.item_id, event.ts);
                break;
            case "item_progress":
                progress(event.item_id, event);
                break;
            case "item_updated":
            case "dependencies_replaced":
            case "dependencies_added":
                progress(event.target_id, event);
                break;
            case "note_added":
                notes.set(event.note_id ?? String(event.seq), event.element_id);
                progress(event.element_id, event);
                break;
            case "note_updated":
                progress(notes.get(event.note_id) ?? "", event);
                break;
            case "artifact_added": {
                const targets = [event.target_id, ...(event.related_items ?? [])];
                artifacts.set(event.artifact_id, targets);
                for (const id of targets)
                    progress(id, event);
                break;
            }
            case "artifact_amended": {
                const previous = artifacts.get(event.artifact_id) ?? [];
                const targets = event.related_items ? [previous[0] ?? "sprint", ...(event.related_items ?? [])] : previous;
                artifacts.set(event.artifact_id, targets);
                for (const id of targets)
                    progress(id, event);
                break;
            }
            case "item_resolved":
                if (event.disposition === "completed" && !completed.has(event.item_id))
                    completed.set(event.item_id, event.seq);
                end(event.item_id, event.ts);
                break;
        }
    }
    view.agents = [...agents.values()];
    for (const item of items.values()) {
        const claim = item.claim;
        for (const interval of claim.history) {
            const start = Date.parse(interval.claimed_at);
            const stop = Math.max(start, interval.ended_at ? Date.parse(interval.ended_at) : now);
            claim.total_claimed_ms += stop - start;
            const windows = (agents.get(interval.owner)?.activity ?? []).map(ts => Date.parse(ts))
                .filter(t => t <= stop && t + ACTIVITY_WINDOW_MS > start).sort((a, b) => a - b);
            let coveredUntil = start;
            for (const time of windows) {
                const a = Math.max(start, time, coveredUntil), b = Math.min(stop, time + ACTIVITY_WINDOW_MS);
                if (b > a)
                    claim.active_work_ms += b - a;
                coveredUntil = Math.max(coveredUntil, b);
            }
        }
        const lifetimeEnd = item.resolved_at ? Date.parse(item.resolved_at) : now;
        claim.queue_wait_ms = Math.max(0, lifetimeEnd - Date.parse(item.created_at) - claim.total_claimed_ms);
        if (claim.owner && item.status === "open") {
            claim.claim_duration_ms = Math.max(0, now - Date.parse(claim.claimed_at!));
            claim.owner_inactive_ms = Math.max(0, now - Date.parse(agents.get(claim.owner)?.last_activity_at ?? claim.claimed_at!));
            claim.other_completions = [...completed].filter(([id, seq]) => id !== item.id && seq > (progressSeq.get(item.id) ?? -1)).length;
            if (claim.other_completions >= 3)
                claim.stall_reasons.push("three_other_items_completed");
            if (claim.owner_inactive_ms >= INACTIVE_STALL_MS)
                claim.stall_reasons.push("owner_inactive_one_hour");
        }
    }
}
