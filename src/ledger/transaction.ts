import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync, writeSync, ftruncateSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
const held = new Set<string>();
export function canonicalDirectory(dir: string): string {
    const absolute = resolve(dir);
    if (existsSync(absolute))
        return realpathSync(absolute);
    return join(canonicalDirectory(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
}
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
}
/** Publish a nonempty lock directory atomically; a late reaper cannot remove a new owner's nonempty directory. */
export function withDataLock<T>(directory: string, run: () => T, timeoutMs = 5000): T {
    const root = canonicalDirectory(directory);
    if (held.has(root))
        return run();
    mkdirSync(root, { recursive: true });
    const lock = join(root, ".write-lock");
    const token = `${process.pid}-${randomUUID()}`;
    const candidate = join(root, `.lock-${token}`);
    mkdirSync(candidate);
    writeFileSync(join(candidate, token), String(process.pid));
    const deadline = Date.now() + timeoutMs;
    try {
        for (;;) {
            try {
                renameSync(candidate, lock);
                break;
            }
            catch (error) {
                if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? ""))
                    throw error;
                try {
                    for (const owner of readdirSync(lock)) {
                        const pid = Number(owner.split("-")[0]);
                        if (Number.isInteger(pid) && pid > 0 && !alive(pid)) {
                            try {
                                unlinkSync(join(lock, owner));
                            }
                            catch { /* another reaper won */ }
                        }
                    }
                    try {
                        rmdirSync(lock);
                    }
                    catch { /* a live lock remains */ }
                }
                catch { /* released while inspecting */ }
                if (Date.now() >= deadline)
                    throw new Error("Sprinty storage is busy; retry this call.");
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
            }
        }
        held.add(root);
        try {
            recoverTransaction(root);
            return run();
        }
        finally {
            held.delete(root);
            unlinkSync(join(lock, token));
            try {
                rmdirSync(lock);
            }
            catch { /* a reaper may have removed the empty directory */ }
        }
    }
    finally {
        if (existsSync(candidate)) {
            unlinkSync(join(candidate, token));
            rmdirSync(candidate);
        }
    }
}
export interface FileWrite {
    name: string;
    contents: string;
    offset?: number;
}
function durableReplace(path: string, contents: string): void {
    const temp = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temp, "wx");
    try {
        writeFileSync(fd, contents);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(temp, path);
}
function syncDirectory(root: string): void {
    const fd = openSync(root, "r");
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
function apply(root: string, writes: FileWrite[]): void {
    for (const write of writes) {
        if (!/^(?:\d+\.jsonl|current|CHANGELOG\.md)$/.test(write.name))
            throw new Error("Invalid transaction target.");
        const path = join(root, write.name);
        if (write.offset === undefined)
            durableReplace(path, write.contents);
        else {
            const fd = openSync(path, existsSync(path) ? "r+" : "w+");
            try {
                if (statSync(path).size < write.offset)
                    throw new Error("Ledger is shorter than its recovery offset.");
                ftruncateSync(fd, write.offset);
                const bytes = Buffer.from(write.contents);
                let written = 0;
                while (written < bytes.length)
                    written += writeSync(fd, bytes, written, bytes.length - written, write.offset + written);
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
        }
    }
    syncDirectory(root);
}
export function recoverTransaction(root: string): void {
    const journal = join(root, ".transaction.json");
    if (!existsSync(journal))
        return;
    const writes = JSON.parse(readFileSync(journal, "utf8")) as FileWrite[];
    apply(root, writes);
    unlinkSync(journal);
    syncDirectory(root);
}
/** Caller holds the data lock. Replay truncates to recorded offsets, making recovery idempotent. */
export function commitTransaction(root: string, writes: FileWrite[]): void {
    if (!writes.length)
        return;
    durableReplace(join(root, ".transaction.json"), JSON.stringify(writes));
    syncDirectory(root);
    apply(root, writes);
    unlinkSync(join(root, ".transaction.json"));
    syncDirectory(root);
}
