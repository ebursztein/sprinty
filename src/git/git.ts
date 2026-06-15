import { execFileSync } from "node:child_process";

export interface GitContext { branch: string; worktree: string; }
export interface GitNumstatEntry { file: string; additions: number; deletions: number; }

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

export function gitContext(dir: string): GitContext {
  let branch = "";
  let worktree = dir;
  try { branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]); } catch { branch = ""; }
  try { worktree = git(dir, ["rev-parse", "--show-toplevel"]); } catch { worktree = dir; }
  return { branch, worktree };
}

export function verifyCommit(dir: string, sha: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function commitNumstat(dir: string, sha: string): GitNumstatEntry[] {
  const output = git(dir, ["show", "--numstat", "--format=", "--no-renames", sha]);
  if (!output.trim()) return [];
  return output.split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 3)
    .map(([additions, deletions, file]) => ({
      file: file ?? "",
      additions: additions === "-" ? 0 : Number(additions),
      deletions: deletions === "-" ? 0 : Number(deletions),
    }))
    .filter((entry) => entry.file.length > 0 && Number.isFinite(entry.additions) && Number.isFinite(entry.deletions));
}
