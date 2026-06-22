# Sprinty for Codex CLI

The supported command-line Codex plugin lives at `plugins/sprinty/`, with the repository-local
marketplace at `.agents/plugins/marketplace.json`. This directory is documentation only.

Install from a repository checkout:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty-local
```

Then start a new Codex CLI thread so the plugin skills and MCP server are loaded.

This marketplace layout is for Git/repo installs, not the npm tarball. The npm package provides the
MCP server used by the plugin (`npx -y sprinty-mcp`).

The installed plugin provides:

- Sprinty MCP tools through `npx -y sprinty-mcp`
- shared Sprinty skills from the canonical repository `skills/` directory

The npm package includes the top-level `skills/` directory for MCP resource serving. Client
directories may contain symlinks to that canonical directory in a Git checkout; npm tarballs do not
need per-client skill copies.

MCP-only setup without plugin skills:

```bash
codex mcp add sprinty -- npx -y sprinty-mcp
```

Sprinty does not infer state from Codex's MCP launch cwd. Start every sprint with explicit
`git_dir` and `data_dir`; `git_dir` is where commits, gates, coverage, and change maps run, while
`data_dir` stores the `current` pointer and JSONL ledgers. After a Codex/MCP restart, call
`sprint_list(data_dir)` and then `sprint_resume(git_dir, data_dir)` to reattach without creating a
new sprint. Use `sprint_detach()` before switching one MCP process to another sprint. For read-only
tools before `sprint_new`, you may pre-bind with both `SPRINTY_GIT_DIR` and `SPRINTY_DATA_DIR` or
both `--git-dir` and `--data-dir`.

Do not copy skill files into client directories; keep them in the top-level `skills/` directory.

For human visibility during a sprint, open the dashboard URL returned by `sprint_new()` or
`sprint_resume()` in a browser. Use `dashboard_info()` to re-read it and `dashboard_restart()` to
refresh the dashboard server.
