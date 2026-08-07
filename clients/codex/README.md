# Sprinty for Codex CLI

The supported command-line Codex plugin lives at `plugins/sprinty/`, with the repository
marketplace at `.agents/plugins/marketplace.json`. This directory is documentation only.

Install from GitHub:

```bash
codex plugin marketplace add ebursztein/sprinty
codex plugin add sprinty@sprinty
```

Install from a local checkout:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty
```

Then start a new Codex CLI thread so the plugin skills and MCP server are loaded.

This marketplace layout is for Git/repo installs, not the npm tarball. The npm package provides the
MCP server used by the plugin (`npx -y sprinty-mcp`). Codex does not currently use a standalone
OpenAI npm plugin package for this flow.

The installed plugin provides:

- Sprinty MCP tools through `npx -y sprinty-mcp`
- shared Sprinty skills from the canonical repository `skills/` directory

The plugin bundle contains its own `skills/` directory so Git marketplace installs remain
self-contained.

MCP-only setup without plugin skills:

```bash
codex mcp add sprinty -- npx -y sprinty-mcp
```

Sprinty does not infer state from Codex's MCP launch cwd. Start every sprint with explicit
`git_dir` and `data_dir`; `git_dir` is where commits, gates, coverage, and change maps run, while
`data_dir` stores the `current` pointer and JSONL ledgers. When `data_dir` is omitted and `git_dir`
is provided, Sprinty uses `<git_dir>/.sprinty`. Call `info({ git_dir })` first for startup
orientation and compact sprint rows, or `info({ workspace_dirs: [...] })` to inspect multiple data
dirs. Then call `sprint_resume(git_dir, data_dir?)` to reattach without creating a new sprint. Use
`sprint_detach()` before switching one MCP process to another sprint. For read-only tools before
`sprint_new`, you may pre-bind with both `SPRINTY_GIT_DIR` and `SPRINTY_DATA_DIR` or both
`--git-dir` and `--data-dir`.

For human visibility during a sprint, open the dashboard URL returned by `sprint_new()` or
`sprint_resume()` in a browser. Use `dashboard_info()` to re-read it and `dashboard_restart()` to
refresh the dashboard server.
