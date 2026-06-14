import { execFileSync } from "node:child_process";

export interface GitContext { branch: string; worktree: string; }

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
