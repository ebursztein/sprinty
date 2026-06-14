import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitContext, verifyCommit } from "./git.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-git-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  writeFileSync(join(dir, "f.txt"), "x");
  run(["add", "f.txt"]);
  run(["commit", "-m", "init"]);
  const sha = run(["rev-parse", "HEAD"]);
  return { dir, sha };
}

describe("git", () => {
  it("reports branch and worktree for a repo", () => {
    const { dir } = initRepo();
    const ctx = gitContext(dir);
    expect(ctx.branch).toBe("main");
    expect(ctx.worktree.length).toBeGreaterThan(0);
  });

  it("verifies a real commit and rejects a fake one", () => {
    const { dir, sha } = initRepo();
    expect(verifyCommit(dir, sha)).toBe(true);
    expect(verifyCommit(dir, "0000000000000000000000000000000000000000")).toBe(false);
  });
});
