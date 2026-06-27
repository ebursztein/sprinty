# Sprinty

Disciplined sprint tracking for AI coding agents.

Sprinty is an MCP server that gives agents a structured way to plan, execute, verify, and close
non-trivial coding work. It keeps the sprint record local, append-only, and tied to real git
commits, so an agent cannot quietly lose track of work, invent ids, or mark items done without
evidence.

## Why Use Sprinty?

Without Sprinty, long agent sessions often drift:

- work gets tracked in loose prose that is hard to resume;
- tasks are marked done without a real commit or passing gate evidence;
- follow-up context disappears after a restart;
- humans cannot easily see what the agent is doing right now.

With Sprinty, the agent gets MCP tools for:

- sprint, subsprint, and item tracking with server-minted ids;
- dependency edges, blocked work, and cycle detection;
- item gates that require passing evidence before completion;
- git commit validation and per-item change maps;
- notes and artifacts attached to the sprint record;
- compact `overview`, `next`, and `search` reads for agent token budgets;
- a local dashboard URL returned by `sprint_new` and `sprint_resume`;
- strict `sprint_close` checks that refuse to close while work, coverage, or gates are missing.

## Installation

Sprinty is published as the npm package `sprinty-mcp`.

```bash
npx -y sprinty-mcp
```

The server is usually launched by an MCP client. Sprinty works with any MCP client that can run a
local command.

### Codex

Add Sprinty to `~/.codex/config.toml`:

```toml
[mcp_servers.sprinty]
command = "npx"
args = ["-y", "sprinty-mcp"]
```

### Claude Code

```bash
claude mcp add sprinty -- npx -y sprinty-mcp
```

The repository also includes a Claude plugin manifest in `clients/claude/`.

### Gemini CLI

From a repository checkout:

```bash
gemini extensions install ./clients/gemini
```

The Gemini extension uses `clients/gemini/gemini-extension.json` and `clients/gemini/GEMINI.md`.

### Codex Plugin From A Checkout

For local plugin development from this repository:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty-local
```

The installable plugin bundle lives in `plugins/sprinty/`.

## Quick Start

Sprinty never guesses the repository from the MCP server process cwd. Start a sprint with explicit
paths:

```json
{
  "goal": "Ship the dashboard lifecycle change",
  "git_dir": "/absolute/path/to/repo",
  "data_dir": "/absolute/path/to/repo/.sprinty",
  "context_notes": ["optional notes for the agent"]
}
```

- `git_dir` is where Sprinty checks commits, runs gates, reads coverage, and builds change maps.
- `data_dir` is where Sprinty stores the `current` pointer and JSONL ledgers.
- Use a worktree-scoped, gitignored `data_dir`, such as `<git_dir>/.sprinty`.

After a restart, inspect and resume the same sprint:

```text
sprint_list({ data_dir })
sprint_resume({ git_dir, data_dir })
```

You can also pre-bind a read-only MCP process with both environment variables:

```bash
SPRINTY_GIT_DIR=/absolute/path/to/repo
SPRINTY_DATA_DIR=/absolute/path/to/repo/.sprinty
```

Both `SPRINTY_GIT_DIR` and `SPRINTY_DATA_DIR` are required together.

## Basic Workflow

```text
sprint_new({ goal, git_dir, data_dir, context_notes? })
  -> returns dashboard.url
overview({})
subsprint_new({ description, goals, gates, dependencies? })
item_add({ subsprint, title, description, code_locations, gates, dependencies?, high_priority? })
next({})
item_done({ id, commit_id, gate_results, changelog: { verb: "added" | "fixed" | "changed" | "removed" | "deprecated" | "security", line } })
changelog({ path? }) -> { path }
sprint_close({ coverage: { path, format: "lcov", command? } })
```

Use `item_split` when an item is too large and `item_deprecate` when an item is intentionally
dropped. Use `sprint_detach` before switching one MCP process to a different sprint.

## Dashboard

`sprint_new` and `sprint_resume` automatically start a read-only local dashboard and return:

```json
{
  "dashboard": {
    "running": true,
    "url": "http://127.0.0.1:60767",
    "port": 60767
  }
}
```

Open the URL in a browser to watch progress while the agent works. The dashboard shows sprint
status, items, blocked work, gates, artifacts, changelog entries, change maps, and the ledger.

Dashboard tools:

- `dashboard_info` returns the current dashboard URL and port without restarting it.
- `dashboard_restart` restarts the dashboard server and returns the new URL and port.
- `sprint_close`, `sprint_archive`, and `sprint_detach` stop the dashboard.

## Available Tools

### Sprint Tools

| Tool | What it does |
| --- | --- |
| `sprint_new` | Start a sprint with explicit `git_dir` and `data_dir`; returns orientation and dashboard info. |
| `sprint_resume` | Reattach to an existing sprint after an MCP restart; returns dashboard info. |
| `sprint_list` | List ledgers in a `data_dir` without creating a sprint. |
| `sprint_detach` | Clear this MCP process binding and stop the dashboard. |
| `sprint_close` | Re-run gates, require coverage evidence, and close only when all work is resolved. |
| `sprint_archive` | Archive an active sprint with a recovery reason. |
| `overview` | Compact sprint summary for orientation. |
| `next` | Compact active work window with available and blocked items. |
| `search` | Regex search over the immutable sprint ledger. |
| `changelog` | Write the semver Markdown changelog to `path` or the sprint data dir and return only the path. |

### Work Tools

| Tool | What it does |
| --- | --- |
| `subsprint_new` | Create a feature-sized unit of work. |
| `subsprint_list` | List subsprints with compact item counts. |
| `subsprint_get` | Read one subsprint and its item rows. |
| `item_add` | Create one atomic, gated item. |
| `item_get` | Read full item detail. |
| `item_update` | Update item metadata, notes, priority, or dependency edges. |
| `item_done` | Complete an item with a real commit, passing gate evidence, and a semver changelog verb plus line. |
| `item_split` | Resolve an oversized item by creating a new subsprint. |
| `item_deprecate` | Drop an item with an explicit reason. |

### Notes And Artifacts

| Tool | What it does |
| --- | --- |
| `note_add` | Attach a note to an item. |
| `note_list` | List notes for an item. |
| `note_get` | Read one note. |
| `note_update` | Update one note. |
| `artifact_add` | Attach a durable file path to the sprint. |
| `artifact_list` | List active artifacts. |
| `artifact_get` | Read one artifact record. |
| `artifact_update` | Update artifact metadata. |

### Dashboard Tools

| Tool | What it does |
| --- | --- |
| `dashboard_info` | Report whether the dashboard is running and, if so, its URL and port. |
| `dashboard_restart` | Restart the dashboard and return the new URL and port. |

## How Sprinty Stores Data

Sprinty writes one append-only JSONL ledger per sprint under `data_dir`. The ledger is local state;
keep it out of git unless you intentionally want to preserve it elsewhere. Sprinty projects that
ledger into compact read models for agents and into the dashboard for humans.

Completed items record the commit id, gate results, changelog entry, and Git-backed file change map.
`sprint_close` re-checks commits, re-runs executable gates, requires coverage evidence, and refuses
to close while any item is still open.

## More Documentation

- [How to run a sprint](skills/how-to-run-a-sprint/SKILL.md)
- [Full Sprinty tool contract](skills/using-sprinty/SKILL.md)
- [Codex client notes](clients/codex/README.md)
- [Gemini client notes](clients/gemini/GEMINI.md)

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## License

Apache-2.0 © Elie Bursztein
