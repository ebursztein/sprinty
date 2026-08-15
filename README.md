# Sprinty

[![npm version](https://img.shields.io/npm/v/sprinty-mcp.svg)](https://www.npmjs.com/package/sprinty-mcp)

Sprinty is an MCP server for running disciplined coding sprints with AI agents. It gives agents
server-minted sprint, subsprint, and item IDs; explicit dependencies; gate evidence; Git-backed
change maps; SemVer changelogs; and a local dashboard so humans can watch the work while it happens.

![Sprinty dashboard](/docs/sprinty-dashboard.png)

## Install

Sprinty is published to npm as `sprinty-mcp`. The npm package is the MCP server. Claude and Codex
plugin installs are distributed from this Git repository through each client's marketplace system.

### Claude Code

MCP-only install:

```bash
claude mcp add sprinty -- npx -y sprinty-mcp
```

Plugin install, with Sprinty skills plus the MCP server:

```bash
claude plugin marketplace add ebursztein/sprinty
claude plugin install sprinty@sprinty
```

The Claude marketplace manifest is `.claude-plugin/marketplace.json`; the plugin bundle is
`clients/claude/`.

### Codex

MCP-only install:

```bash
codex mcp add sprinty -- npx -y sprinty-mcp
```

Plugin install, with Sprinty skills plus the MCP server:

```bash
codex plugin marketplace add ebursztein/sprinty
codex plugin add sprinty@sprinty
```

The Codex marketplace manifest is `.agents/plugins/marketplace.json`; the plugin bundle is
`plugins/sprinty/`. Codex does not currently use an OpenAI npm plugin package for this flow.

### Gemini CLI

Use the MCP server directly from npm:

```bash
npx -y sprinty-mcp
```

The repository also includes a Gemini extension in `clients/gemini/` for clients that install local
Gemini extensions.

### Cursor, VS Code, Kiro, GitHub Copilot, ChatGPT & Codex

Sprinty ships a portable [Agent Plugins](https://agent-plugins.org) package at the repository root
(`plugin.json`, `mcp.json`, `skills/`), so any conformant client can load the skills and the MCP
server without a client-specific bundle. Follow your client's plugin install instructions and point
it at this repository.

Claude Code and Gemini CLI are not Agent Plugins clients today; they use the bundles above.

### Any MCP Client

Configure a stdio MCP server with:

```json
{
  "command": "npx",
  "args": ["-y", "sprinty-mcp"]
}
```

## Use

Sprinty never guesses the repository from the MCP server process cwd. Start or resume with explicit
paths:

```text
sprint_new({ goal, git_dir, data_dir, context_notes? })
sprint_resume({ git_dir, data_dir })
```

Use a worktree-local, gitignored `data_dir`, usually `<git_dir>/.sprinty`. When `data_dir` is
omitted and `git_dir` is provided, Sprinty uses `<git_dir>/.sprinty`. `sprint_new` and
`sprint_resume` return the dashboard URL. Call `info({ git_dir })` first for startup orientation and
compact sprint rows. Use `info({ workspace_dirs: [...] })` when you need to inspect multiple Sprinty
data dirs together, then `sprint_resume({ git_dir, data_dir })`.

## Tools

| Tool | Purpose |
| --- | --- |
| `info` | Startup orientation before binding, including sprint rows, resume/create help, and dashboard state. |
| `sprint_new` | Start a sprint with explicit `git_dir` and `data_dir`; returns orientation and dashboard info. |
| `sprint_resume` | Reattach this MCP session to an existing sprint. |
| `sprint_detach` | Clear this MCP process binding and stop the dashboard. |
| `sprint_close` | Close only after all work is resolved, changelog exists, gates pass, and coverage is supplied. |
| `sprint_archive` | Archive an active sprint with a recovery reason. |
| `overview` | Compact sprint summary for orientation. |
| `next` | Compact active work window with current, next, blocked, relations, notes, and artifacts. |
| `search` | Regex search over the immutable sprint ledger. |
| `changelog` | Generate SemVer Markdown and return the path. |
| `subsprint_new` | Create a feature-sized unit of work. |
| `subsprint_list` | List subsprints with compact item counts. |
| `subsprint_get` | Read one subsprint and its item rows. |
| `item_add` | Create one atomic, gated item with an optional gate timeout. |
| `item_get` | Read full item detail. |
| `item_update` | Update item metadata, execution settings, or dependency edges. |
| `item_done` | Complete an item with a real commit, gate evidence, and changelog entry. |
| `item_split` | Resolve an oversized item by creating a seeded subsprint. |
| `item_deprecate` | Drop an item with an explicit reason, or pass a subsprint id to drop it and its open items. |
| `note_add` | Attach a note to an item. |
| `note_list` | List notes for an item. |
| `note_get` | Read one note. |
| `note_update` | Update one note. |
| `artifact_add` | Attach a durable file path to the sprint. |
| `artifact_list` | List active artifacts. |
| `artifact_get` | Read one artifact record. |
| `artifact_update` | Update artifact metadata. |
| `dashboard_info` | Report the current dashboard URL and port. |
| `dashboard_restart` | Restart the dashboard and return the new URL and port. |

## Release

Publishing is gated by tests. The GitHub Release workflow runs `npm ci`, `npm test`, and only then
`npm publish --access public`.

Local checks:

```bash
npm test
npm run typecheck
```

## License

Apache-2.0
