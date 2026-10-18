import type { ItemView, SprintView } from "./projection.js";
/** Expand subsprint dependencies into their open member items, including inherited parent dependencies. */
export function dependencyResolver(view: SprintView): (item: ItemView) => string[] {
    const byId = new Map(view.subsprints.flatMap(s => s.items).map(i => [i.id, i]));
    const subs = new Map(view.subsprints.map(s => [s.id, s]));
    return (item: ItemView) => {
        const result = new Set<string>();
        const seen = new Set<string>();
        const expand = (id: string) => {
            if (seen.has(id))
                return;
            seen.add(id);
            const dependency = byId.get(id);
            if (dependency) {
                if (dependency.status === "open")
                    result.add(id);
                return;
            }
            const sub = subs.get(id);
            if (sub?.status === "open") {
                for (const child of sub.items)
                    if (child.status === "open")
                        result.add(child.id);
                for (const dep of sub.dependencies ?? [])
                    expand(dep);
            }
        };
        for (const id of [...item.dependencies, ...(subs.get(item.subsprint_id)?.dependencies ?? [])])
            expand(id);
        return [...result];
    };
}
export function itemDependencies(view: SprintView, item: ItemView): string[] { return dependencyResolver(view)(item); }
export function orderOpenItems(view: SprintView, items: ItemView[], actorId?: string): {
    available: ItemView[];
    blocked: ItemView[];
} {
    const rank = new Map((view.graph.topological_order ?? []).map((id, index) => [id, index]));
    const ordered = items.filter(i => i.status === "open").sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    const resolve = dependencyResolver(view);
    const dependencies = new Map(ordered.map(item => [item.id, resolve(item)]));
    const blocked = ordered.filter(i => dependencies.get(i.id)!.length > 0);
    const available = ordered.filter(i => !dependencies.get(i.id)!.length && (!actorId || !i.claim?.owner || i.claim.owner === actorId));
    if (actorId)
        available.sort((a, b) => Number(b.claim?.owner === actorId) - Number(a.claim?.owner === actorId));
    return { available, blocked };
}
