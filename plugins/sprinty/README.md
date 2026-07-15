# Sprinty Codex CLI Plugin

This is the Codex CLI plugin bundle for Sprinty.

Install from the GitHub marketplace:

```bash
codex plugin marketplace add ebursztein/sprinty
codex plugin add sprinty@sprinty
```

For local development from a checkout:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty
```

Start a new Codex CLI thread after install. The plugin provides:

- Sprinty MCP tools through `npx -y sprinty-mcp`
- `skills/how-to-run-a-sprint`
- `skills/using-sprinty`

Expected agent loop:

1. Start or resume with explicit `git_dir` and `data_dir`.
2. Show the dashboard URL returned by `sprint_new()` or `sprint_resume()`.
3. Track each feature as a `subsprint_new(...)` unit.
4. Add atomic work with `item_add(...)`.
5. Record durable outputs with `artifact_add/list/get/update`.
6. Resolve each item with `item_done(...)`, passing gate evidence, a Git commit, and a SemVer changelog verb plus line.
7. Run `changelog(...)`, then `sprint_close(...)`.

For MCP-only setup without plugin skills:

```bash
codex mcp add sprinty -- npx -y sprinty-mcp
```

Sprinty does not infer state from the Codex MCP launch cwd. Start every sprint with explicit
`git_dir` and `data_dir`; `git_dir` is where commits, gates, coverage, and change maps run, while
`data_dir` stores the `current` pointer and JSONL ledgers. When `data_dir` is omitted and `git_dir`
is provided, Sprinty uses `<git_dir>/.sprinty`. Call `info({ git_dir })` first for startup
orientation and compact sprint rows, or `info({ workspace_dirs: [...] })` to inspect multiple data
dirs. Then call `sprint_resume(git_dir, data_dir?)` to reattach without creating a new sprint. Use
`sprint_detach()` before switching one MCP process to another sprint. For read-only tools before
`sprint_new`, you may pre-bind with both `SPRINTY_GIT_DIR` and `SPRINTY_DATA_DIR` or both
`--git-dir` and `--data-dir`.
