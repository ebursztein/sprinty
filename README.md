# sprinty

A disciplined-sprint MCP server for AI coding agents — **Claude Code, Codex, and Gemini**.

Sprinty gives an agent first-class tools to run a sprint with structure that can't silently rot:
structured **sprint → subsprint → item** objects, dependency edges with cycle detection, an
**immutable append-only ledger** anchored to real git commits, Git-backed **change maps**, durable
file **artifacts**, item-scoped **notes**, Markdown changelogs with file tables, **programmatic
close-gates** that re-run your tests and require coverage evidence before a sprint can close, a
bounded **regex search** over the record, and a **live follow-along dashboard**.

The point: the agent doesn't drift, and the record doesn't lie. IDs are minted server-side, items
can't exist without gates, `item_done` rejects a commit that doesn't exist or lacks a semver
changelog line, and `sprint_close` refuses to close while anything is open, coverage is missing, or
a gate fails.

## Install

Sprinty has two layers:

- the MCP server, which runs from npm as `npx -y sprinty-mcp`;
- optional client manifests under `clients/` for agents that support plugins or extensions.

The npm package is `sprinty-mcp`. The server, MCP tool namespace, and client manifests are named
`sprinty`. The tarball ships the canonical top-level `skills/` directory; client directories in a
Git checkout may symlink to it, but package consumers should treat the top-level `skills/` directory
as authoritative.

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

Sprinty does not guess from the MCP server process cwd. Start a sprint with explicit paths:

```json
{
  "goal": "Build the catalogue MCP",
  "git_dir": "/absolute/path/to/your/repo",
  "data_dir": "/absolute/path/to/your/repo/.sprinty",
  "context_notes": ["optional context"]
}
```

`git_dir` is where commits, gates, coverage, and change maps run. `data_dir` is where Sprinty stores
the `current` pointer and append-only JSONL ledgers. Use a worktree-scoped, uncommitted `data_dir`,
such as `<git_dir>/.sprinty` when that path is gitignored; avoid shared temp dirs or any directory
that will be committed. After a Codex/MCP restart, call `sprint_list(data_dir)` to inspect the
existing ledgers and `sprint_resume(git_dir, data_dir)` to reattach without creating a sprint.
Use `sprint_detach()` to clear a process binding before resuming another sprint. For read-only
tools before `sprint_new`, you may also pre-bind the MCP server with `SPRINTY_GIT_DIR` and
`SPRINTY_DATA_DIR` or `--git-dir` and `--data-dir`; both are required together.
`SPRINTY_REPO_DIR` and `SPRINTY_WORKTREE` remain accepted as legacy aliases for `git_dir` only when
a `data_dir` is also supplied.

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
sprint_list(data_dir?) -> sprint_resume(git_dir, data_dir) | sprint_detach()
sprint_new(goal, git_dir, data_dir, context_notes?)
  -> dashboard()
  -> overview() | next() | search(pattern, context_size?)
  -> subsprint_new(description, goals[], gates[], dependencies?)
  -> subsprint_list() | subsprint_get(id)
  -> item_add(subsprint, title, description, code_locations[], gates[], dependencies?, high_priority?)
  -> item_update(id, note?, title?, description?, high_priority?, dependencies?)
  -> note_add(id, text) | note_list(id) | note_get(id) | note_update(id, text)
  -> artifact_add(title, path, description?, related_items?) | artifact_list() | artifact_get(id) | artifact_update(id, ...)
  -> item_done(id, commit_id, gate_results[], changelog) | item_split(id, ...) | item_deprecate(id, reason)
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
dashboard shows the sprint goal, explicit git/data paths, branch/worktree, artifact shelf, sprint progress, item status
distribution, code churn, subsprint progress, open items, gate evidence, dependency graph state,
commit ids and changelog lines for completed items, changed-file hotspots, and a paginated ledger
from the immutable timeline.

The dashboard server binds to `127.0.0.1` on an ephemeral port and is read-only. It lives only for
the running MCP server process, and a successful `sprint_close()` or `sprint_archive()` stops that
dashboard URL so old sprint dashboards do not pile up.

## Proof Model

Sprinty records timestamps on every event and projects them into the sprint timeline. Completed
items require a real git commit id and controlled changelog entry when `item_done()` is called, and
`sprint_close()` checks that the commit still resolves before closing. `item_done()` also records a
Git-backed change map for the commit: file, language, directory, additions, deletions, net change,
churn, item ids, and commit ids. `changelog()` renders a Markdown release note with semver sections,
coverage, and change-map tables. `item_done()` also requires passing evidence for every declared
item gate, including manual gates. When an early declared gate was a placeholder, `item_done()` can
record an explicit supersession: the final passing gate result names the declared gate in
`supersedes` and includes a `supersession_reason`, preserving strict evidence without pretending
the placeholder command was the final proof. Dependencies are stored as ids and replaced with
`item_update({ id, dependencies })`; pass `dependencies: []` to remove a bad edge. Writes reject
unknown ids, duplicates, and cycles. Use `next()` for the active work window and `subsprint_get({
id })` or `item_get({ id })` for focused detail.
At close, executable gates are re-run by Sprinty and `sprint_close()` requires an LCOV coverage
report path.

Artifacts are append-only too: updates are separate ledger events, never in-place silent edits.
Public artifact tools expose file paths and optional related item ids. Notes are first-class records
with ids like `N001`, but they must attach to a specific item id; they are not a planning surface.

Items have two text fields by design: `title` is a short one-line label for the tree/dashboard, and
`description` is bounded detail for the expanded item body. `high_priority` is a simple boolean
that promotes available work in `next()`; it is not a ranking system. Use one item per independently
verifiable behavior, tool, endpoint, component, or migration step. If an item needs a list of
unrelated deliverables in the title, split it before adding it. Oversized `item_add()` calls return
a validation nudge to create more than one smaller item. Notes must attach to a specific item id and
must not be used as a substitute for trackable items.

## Response Budgets

Sprinty tools are designed for agent token budgets:

- `overview()` is compact: sprint title/details, compact notes/artifacts, and subsprint counts only.
  Use `subsprint_get({ id })` for item rows.
- `next()` is the active work window and deliberately omits the full dependency graph. By default it
  returns one resolved item, all available high-priority items, then one normal available item per
  subsprint; tune that with `past`, `future_per_subsprint`, and `include_high_priority`.
- `search({ pattern, context_size })` uses JavaScript regex syntax and returns compact rows with
  `{ id, type, text, tool_call }`.
- list tools are compact and point to the matching `_get()` tool for full untruncated detail.
- tool responses omit timestamps and empty fields; the ledger and dashboard keep audit detail.

The repository includes hard response-size and speed gates against a hermetic Capsem-shaped fixture.
The steady-state read-handler p95 cap is 2ms.

## Storage

One append-only JSONL ledger file per sprint under the explicit `data_dir`, with a `current` pointer
naming the active sprint (this enforces one-open-sprint unicity for that binding). `git_dir` and
`data_dir` are intentionally separate so agents can run gates against one checkout while storing
Sprinty state somewhere deliberate. It is local state — keep it gitignored when `data_dir` lives
inside a repository, and scope it to the active worktree or repo instead of a shared process temp
directory.

## Develop

```bash
npm install
npm test            # builds, then runs unit + e2e tests
npm run test:coverage
npm run build
```

## License

Apache-2.0 © Elie Bursztein
