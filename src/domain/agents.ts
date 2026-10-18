import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
export interface Actor {
    id: string;
    name: string;
    generations: Map<string, number>;
}
export const actors = new AsyncLocalStorage<Actor>();
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function newIdentity(names: string[]): {
    actor: Actor;
    token: string;
} {
    const adjectives = ["curious", "nimble", "patient", "bright", "steady", "quiet", "brave", "clever"];
    const animals = ["otter", "fox", "owl", "badger", "heron", "panda", "lynx", "falcon"];
    const id = randomUUID();
    let name = `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${animals[Math.floor(Math.random() * animals.length)]}`;
    const base = name;
    let suffix = 1;
    while (names.includes(name))
        name = `${base}-${id.slice(0, 8)}-${suffix++}`;
    return { actor: { id, name, generations: new Map() }, token: randomBytes(32).toString("hex") };
}
