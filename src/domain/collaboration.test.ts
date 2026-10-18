import { describe, it, expect } from "vitest";
import { LedgerEvent, type LedgerEvent as Event } from "./events.js";
import { project } from "./projection.js";
const minute = 60000;
const origin = Date.parse("2026-10-18T10:00:00Z");
function history() {
    const events: Event[] = [];
    const add = (minutes: number, raw: Record<string, unknown>) => events.push(LedgerEvent.parse({ ...raw, seq: events.length, ts: new Date(origin + minutes * minute).toISOString() }));
    add(0, { type: "sprint_created", goal: "g", branch: "main", worktree: "/w", dir: "/w" });
    add(0, { type: "subsprint_created", subsprint_id: "S01", description: "d", goals: ["g"], gates: [{ kind: "manual", spec: "review" }], spawned_from_item: null });
    for (let i = 1; i <= 7; i++)
        add(0, { type: "item_added", item_id: `S01-00${i}`, subsprint_id: "S01", description: "d", code_locations: ["a"], gates: [{ kind: "manual", spec: "review" }] });
    add(0, { type: "agent_attached", id: "a", name: "curious-otter", token_hash: "hash" });
    add(0, { type: "agent_attached", id: "b", name: "quiet-fox", token_hash: "hash2" });
    const claim = (id: string, at: number, owner = "a", generation = 1) => add(at, { type: "item_claimed", item_id: id, owner, generation, agent_id: owner });
    const activity = (at: number, id = "a") => add(at, { type: "agent_activity", id, agent_id: id });
    const finish = (id: string, at: number, disposition = "completed") => add(at, { type: "item_resolved", item_id: id, disposition, commit_id: "abcdef0", gate_results: [], spawned_subsprint: null, reason: null });
    return { events, add, claim, activity, finish };
}
describe("claim timing and shared ETA", () => {
    it("clips overnight sleep and queue time out of active duration samples", () => {
        const h = history();
        for (let i = 1; i <= 3; i++) {
            const start = (i - 1) * 10;
            h.claim(`S01-00${i}`, start);
            h.finish(`S01-00${i}`, start + 2);
        }
        h.claim("S01-004", 30);
        h.activity(31);
        h.activity(12 * 60);
        h.finish("S01-004", 12 * 60 + 2);
        const view = project(h.events, origin + (12 * 60 + 2) * minute)!;
        expect(view.subsprints[0]!.items[3]!.claim.active_work_ms).toBe(8 * minute);
        expect(view.eta.sample_count).toBe(4);
        expect(view.eta.range_ms![1]).toBeLessThan(30 * minute);
        expect(project(h.events, origin + 24 * 60 * minute)!.subsprints[0]!.items[3]!.claim.active_work_ms).toBe(8 * minute);
    });
    it("uses only the latest twenty eligible completions", () => {
        const h = history();
        for (let i = 8; i <= 25; i++)
            h.add(0, { type: "item_added", item_id: `S01-${String(i).padStart(3, "0")}`, subsprint_id: "S01", description: "Queued", code_locations: ["a"], gates: [{ kind: "manual", spec: "review" }] });
        for (let i = 1; i <= 25; i++) {
            const id = `S01-${String(i).padStart(3, "0")}`;
            h.claim(id, (i - 1) * 3);
            h.finish(id, (i - 1) * 3 + 2);
        }
        expect(project(h.events, origin + 100 * minute)!.eta).toMatchObject({ sample_count: 20, status: "complete", remaining_work_ms: 0 });
    });
    it("excludes repeated silent gaps while keeping observed work", () => {
        const h = history();
        h.claim("S01-001", 0);
        h.activity(60);
        h.activity(120);
        h.finish("S01-001", 122);
        expect(project(h.events, origin + 122 * minute)!.subsprints[0]!.items[0]!.claim.active_work_ms).toBe(12 * minute);
    });
    it("requires three samples; legacy, split and deprecated items do not train ETA", () => {
        const h = history();
        h.claim("S01-001", 1);
        h.finish("S01-001", 3);
        h.claim("S01-002", 4);
        h.finish("S01-002", 6, "deprecated");
        h.finish("S01-003", 7);
        h.claim("S01-004", 8);
        h.finish("S01-004", 10, "split");
        const view = project(h.events, origin + 10 * minute)!;
        expect(view.eta.status).toBe("learning");
        expect(view.eta.sample_count).toBe(1);
    });
    it("flags three other completions and one hour inactivity independently", () => {
        const h = history();
        h.claim("S01-001", 0);
        for (let i = 2; i <= 4; i++)
            h.finish(`S01-00${i}`, i);
        const claim = project(h.events, origin + 60 * minute)!.subsprints[0]!.items[0]!.claim;
        expect(claim.stall_reasons).toEqual(["three_other_items_completed", "owner_inactive_one_hour"]);
        h.activity(61);
        expect(project(h.events, origin + 61 * minute)!.subsprints[0]!.items[0]!.claim.stall_reasons).toEqual(["three_other_items_completed"]);
        h.add(62, { type: "item_progress", item_id: "S01-001", message: "Finished implementation", agent_id: "a" });
        expect(project(h.events, origin + 62 * minute)!.subsprints[0]!.items[0]!.claim.stall_reasons).toEqual([]);
    });
    it("preserves bounded handovers and historical durations after release", () => {
        const h = history();
        h.claim("S01-001", 0);
        h.activity(60, "b");
        h.add(60, { type: "item_claimed", item_id: "S01-001", owner: "b", generation: 2, explanation: "Owner offline; continuing verification", agent_id: "b" });
        h.add(62, { type: "item_released", item_id: "S01-001", generation: 2, agent_id: "b" });
        const item = project(h.events, origin + 120 * minute)!.subsprints[0]!.items[0]!;
        expect(item.claim.total_claimed_ms).toBe(62 * minute);
        expect(item.claim.owner).toBeNull();
        expect(item.claim.history[1]!.explanation).toContain("offline");
        expect(() => LedgerEvent.parse({ type: "item_progress", seq: 0, ts: new Date(origin).toISOString(), item_id: "x", message: "x".repeat(501) })).toThrow();
    });
    it("schedules parallel workers, dependencies, inactivity and completion consistently", () => {
        const h = history();
        for (let i = 1; i <= 3; i++) {
            h.claim(`S01-00${i}`, (i - 1) * 3);
            h.finish(`S01-00${i}`, (i - 1) * 3 + 2);
        }
        h.activity(10);
        h.activity(10, "b");
        const parallel = project(h.events, origin + 10 * minute)!;
        expect(parallel.eta.status).toBe("running");
        expect(parallel.eta.remaining_work_ms).toBe(8 * minute);
        expect(Date.parse(parallel.eta.finish_at!) - (origin + 10 * minute)).toBe(4 * minute);
        h.add(10, { type: "dependencies_replaced", target_id: "S01-005", dependencies: ["S01-004"] });
        h.add(10, { type: "dependencies_replaced", target_id: "S01-006", dependencies: ["S01-005"] });
        h.add(10, { type: "dependencies_replaced", target_id: "S01-007", dependencies: ["S01-006"] });
        const serial = project(h.events, origin + 10 * minute)!;
        expect(Date.parse(serial.eta.finish_at!) - (origin + 10 * minute)).toBe(8 * minute);
        expect(project(h.events, origin + 20 * minute)!.eta.status).toBe("paused");
        h.claim("S01-004", 10, "b");
        h.activity(20);
        expect(project(h.events, origin + 20 * minute)!.eta.status).toBe("awaiting_handover");
        for (let i = 4; i <= 7; i++)
            h.finish(`S01-00${i}`, 21);
        expect(project(h.events, origin + 21 * minute)!.eta).toMatchObject({ status: "complete", remaining_work_ms: 0 });
    });
});
