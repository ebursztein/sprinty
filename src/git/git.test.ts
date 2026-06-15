import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitContext, commitNumstat, verifyCommit } from "./git.js";

function initRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "sprinty-git-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir }).toString().trim();
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  run(["config", "commit.gpgsign", "false"]);
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

  it("reports numstat for files touched by a commit", () => {
    const { dir } = initRepo();
    const run = (args: string[]) => execFileSync("git", args, { cwd: dir }).toString().trim();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "book.ts"), "export const title = 'A';\nexport const price = 12;\n");
    writeFileSync(join(dir, "README.md"), "Bookshop\n");
    run(["add", "src/book.ts", "README.md"]);
    run(["commit", "-m", "bookshop"]);
    const sha = run(["rev-parse", "HEAD"]);

    expect(commitNumstat(dir, sha)).toEqual([
      { file: "README.md", additions: 1, deletions: 0 },
      { file: "src/book.ts", additions: 2, deletions: 0 },
    ]);
  });
});
