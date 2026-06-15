# sprinty

A disciplined-sprint MCP server for AI coding agents — **Claude Code, Codex, and Gemini**.

Sprinty gives an agent first-class tools to run a sprint with structure that can't silently rot:
structured **sprint → subsprint → item** objects, dependency graphs with topological ordering and
cycle detection, an **immutable append-only ledger** anchored to real git commits,
Git-backed **change maps**, durable **artifacts**, bug-backed **follow-ups**, feature-sized
**spikes**, Markdown changelogs with file tables, **programmatic close-gates**
that re-run your tests and require coverage evidence before a sprint can close, a **regex search**
over the record, and a **live follow-along dashboard**.

The point: the agent doesn't drift, and the record doesn't lie. IDs are minted server-side, items
can't exist without gates, `done` rejects a commit that doesn't exist or lacks a semver changelog
line, and `sprint_close` refuses to close while anything is open, coverage is missing, or a gate
fails.

## Install

Sprinty has two layers:

- the MCP server, which runs from npm as `npx -y sprinty-mcp`;
- optional client manifests under `clients/` for agents that support plugins or extensions.

The npm package is `sprinty-mcp`. The server, MCP tool namespace, and client manifests are named
`sprinty`.

### Claude Code

Add the MCP server directly:

```bash
claude mcp add sprinty -- npx -y sprinty-mcp
```

The repo also includes a Claude plugin manifest in `clients/claude/`.

### Codex

Fast path: add the MCP server to `~/.codex/config.toml`:

```toml
[mcp_servers.sprinty]
command = "npx"
args = ["-y", "sprinty-mcp"]
```

If your MCP host launches servers from a temp directory, bind Sprinty to the active repo explicitly:

```toml
[mcp_servers.sprinty.env]
SPRINTY_REPO_DIR = "/absolute/path/to/your/repo"
```

You can also pass `--repo-dir /absolute/path/to/your/repo` to the server command. Without an
explicit repo directory, Sprinty uses the MCP server process cwd.

Codex CLI plugin path: install the repo-local marketplace from a repository checkout:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty-local
```

The installable plugin bundle is `plugins/sprinty/`, and the marketplace index is
`.agents/plugins/marketplace.json`. This marketplace layout is for Git/repo installs, not the npm
tarball. The plugin uses a `plugins/sprinty/skills` symlink to the canonical top-level `skills/`
directory; there is no duplicated Codex-only skill copy.

After installation, ask Codex to use Sprinty for a non-trivial task. It should call `sprint_new`
before implementation and `sprint_close` before claiming the sprint is done.

### Gemini CLI

`clients/gemini/` is a Gemini extension (`gemini-extension.json` + `GEMINI.md` + skills):

```bash
gemini extensions install ./clients/gemini
```

The skill guidance is authored once in `skills/`. Client packages should reference or symlink that
content rather than copying it.

## The loop

```
sprint_new(goal, context_notes?)
  -> dashboard()
  -> subsprint_new(description, goals[], gates[], dependencies?)
  -> spike(description, goals[], gates[], dependencies?)
  -> add(subsprint, description, code_locations[], gates[], dependencies?)
  -> artifact_add/list/amend/deprecate(...)
  -> follow_up(target, description, bug_id|bug_ids)
  -> dependencies(target, dependencies[])
  -> done(commit_id, gate_results[], changelog) | split(...) | deprecate(reason)
  -> spike_conclude(subsprint, conclusion) | spike_deprecate(subsprint, reason)
  -> changelog()
  -> sprint_close(coverage: { path, format: "lcov", command? })
```

Full tool reference: [`skills/using-sprinty/SKILL.md`](skills/using-sprinty/SKILL.md).
How to run a sprint: [`skills/how-to-run-a-sprint/SKILL.md`](skills/how-to-run-a-sprint/SKILL.md).

## Watching the Dashboard

The dashboard is for the human sitting next to the agent.

1. Ask the agent to call `dashboard()`.
2. Open the returned `http://127.0.0.1:<port>` URL in a browser.
3. Leave it open while the sprint runs; it refreshes every two seconds.

Agents should call `dashboard()` right after `sprint_new()` and show the URL to the human. The
dashboard shows the sprint goal, branch/worktree, artifact shelf, sprint progress, item status
distribution, code churn, subsprint progress, open items, gate evidence, dependency graph state,
commit ids and changelog lines for completed items, changed-file hotspots, and a paginated ledger
from the immutable timeline.

The dashboard server binds to `127.0.0.1` on an ephemeral port and is read-only. It lives only for
the running MCP server process.

## Proof Model

Sprinty records timestamps on every event and projects them into the sprint timeline. Completed
items require a real git commit id and controlled changelog entry when `done()` is called, and
`sprint_close()` checks that the commit still resolves before closing. `done()` also records a
Git-backed change map for the commit: file, language, directory, additions, deletions, net change,
churn, item ids, and commit ids. `changelog()` renders a Markdown release note with semver sections,
coverage, and change-map tables. `done()` also requires passing evidence for every declared item
gate, including manual gates. Dependencies are stored as a real graph: `current()` returns nodes,
edges, adjacency indexes, topological order, and cycle information; writes reject cycles. At close,
executable gates are re-run by Sprinty and `sprint_close()` requires an LCOV coverage report path.
Artifacts are append-only too: amendments and deprecations are separate ledger events, never
in-place edits or deletes. Follow-ups require bug ids. Spikes are subsprints with a `spike` flag:
they can have normal items, but must be concluded or deprecated with a reason, and spike work is
kept out of release changelog output.

## Storage

One append-only JSONL ledger file per sprint under `.sprinty/` in the repo you're working on, with a
`.sprinty/current` pointer naming the active sprint (this enforces one-open-sprint unicity).
`.sprinty/` is per working tree, so git worktrees run independent sprints. It is local state — keep
it gitignored.

## Develop

```bash
npm install
npm test            # builds, then runs unit + e2e tests
npm run test:coverage
npm run build
```

## License

Apache-2.0 © Elie Bursztein
