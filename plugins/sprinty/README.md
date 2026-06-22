# Sprinty Codex CLI Plugin

This is the Codex CLI plugin bundle for Sprinty. `skills` is a symlink to the repository's
canonical `skills/` directory, so skill content is not duplicated while the manifest still satisfies
Codex CLI's `./skills/` path rule.

Install from a repository checkout:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty-local
```

Then start a new Codex CLI thread. The plugin provides:

- Sprinty MCP tools through `npx -y sprinty-mcp`
- `skills/how-to-run-a-sprint`
- `skills/using-sprinty`

Expected agent loop:

1. Call `info()` first to orient to the current sprint and repository binding.
2. Start or continue the Sprinty sprint, then show the returned dashboard localhost URL to the human. Use `dashboard_info()` to re-read it or `dashboard_restart()` to refresh it.
3. Track each feature as a `subsprint_new(...)` unit, then add atomic items with `add(...)`; each item needs a short title, bounded description, code locations, and gates.
4. Record durable outputs with `artifact_add/list/amend/deprecate`.
5. Record follow-up bugs with `follow_up(...)` and at least one bug id.
6. Use `spike(...)` for investigations; spikes are still subsprints with normal child items, but they close only through `spike_conclude(...)` or `spike_deprecate(...)`.
7. Resolve each item with `done(...)`, passing gate evidence, and a Git commit before `sprint_close(...)`.

For MCP-only setup without plugin skills:

```bash
codex mcp add sprinty -- npx -y sprinty-mcp
```

Sprinty does not infer state from the Codex MCP launch cwd. Start every sprint with explicit
`git_dir` and `data_dir`; `git_dir` is where commits, gates, coverage, and change maps run, while
`data_dir` stores the `current` pointer and JSONL ledgers. After a Codex/MCP restart, call
`sprint_list(data_dir)` and then `sprint_resume(git_dir, data_dir)` to reattach without creating a
new sprint. Use `sprint_detach()` before switching one MCP process to another sprint. For read-only
tools before `sprint_new`, you may pre-bind with both `SPRINTY_GIT_DIR` and `SPRINTY_DATA_DIR` or
both `--git-dir` and `--data-dir`.
