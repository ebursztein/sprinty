---
name: using-sprinty
description: Reference for the sprinty MCP tools — exact inputs, what each returns, and the failure modes. Use when you need the precise contract of a sprinty tool.
---

# Using sprinty (tool reference)

| Tool | Input | Returns / Rejects |
|---|---|---|
| `sprint_new` | `{ goal, git_dir, data_dir, context_notes?[] }` | sprint view + orientation. `git_dir` is where commits, gates, coverage, and change maps run. `data_dir` is where Sprinty stores `current` and sprint JSONL ledgers. Both should be absolute paths. Use a worktree-scoped, uncommitted `data_dir`, such as `<git_dir>/.sprinty` when that path is gitignored. Rejects if a sprint is already active. After this, call `dashboard()` and show the URL to the human. |
| `info` | `{}` | full sprint view (subsprints + items + statuses), including `dir` and `data_dir` so binding mistakes are obvious. Rejects before binding unless the MCP server was started with explicit `SPRINTY_GIT_DIR` and `SPRINTY_DATA_DIR`. |
| `current` | `{ past?=1, future?=3 }` | last terminal items, `current`, actionable `next`, `blocked_open`, current subsprint notes, dependency graph, and enriched `relations` rows. |
| `subsprint_new` | `{ description, goals[], gates[], dependencies?[] }` | `{ id: "S0N", … }`. Rejects unknown deps/cycles. |
| `spike` | `{ description, goals[], gates[], dependencies?[] }` | creates a spike subsprint. Spikes reuse normal subsprint/item mechanics. |
| `spike_conclude` | `{ subsprint, conclusion }` | records the required spike conclusion after its items are resolved. |
| `spike_deprecate` | `{ subsprint, reason }` | deprecates a spike with a reason. Spikes are not deleted. |
| `add` | `{ subsprint, title, description, code_locations[], gates[], dependencies?[] }` | `{ id: "S0N-00M", … }`. `title` is a short one-line tree label (3-80 chars). `description` is bounded detail (20-500 chars). Rejects unknown subsprint/deps/cycles. |
| `update` | `{ target, note }` | view. Rejects unknown target. |
| `done` | `{ item, commit_id, gate_results[], changelog }` | view. Rejects fake commit / missing, extra, mismatched, or failing gate evidence / missing changelog / terminal item. |
| `split` | `{ item, description, goals[], gates[] }` | view. Item → `split`, new subsprint seeded. |
| `deprecate` | `{ item, reason }` | view. Requires non-empty reason. |
| `note` | `{ element, text }` | view. `element` is an item or subsprint id. |
| `artifact_add` / `artifact` | `{ target?="sprint", kind, title, uri, description? }` | adds a durable artifact attached to sprint, subsprint, or item. |
| `artifact_list` | `{ target?, include_deprecated?=false }` | lists active artifacts, optionally scoped or including deprecated artifacts. |
| `artifact_amend` | `{ artifact, kind?, title?, uri?, description? }` | records an immutable amendment event. |
| `artifact_deprecate` | `{ artifact, reason }` | deprecates an artifact with a reason; artifacts are not deleted. |
| `follow_up` | `{ target?="sprint", description, bug_id? OR bug_ids?[] }` | records a follow-up and requires at least one bug id. |
| `dependencies` | `{ target, dependencies[] }` | view. Adds dependency edges. Rejects unknown ids, duplicates, or cycles. |
| `search` | `{ pattern, context_lines?=0 }` | regex matches over the current sprint ledger, with context lines. |
| `changelog` | `{}` | `{ markdown }`. Renders semver changelog sections plus coverage and change-map tables. |
| `sprint_close` | `{ coverage: { path, format:"lcov", command? } }` | closed view, or an error listing every blocker. Coverage is required when completed code items exist. A successful close stops the live dashboard URL for that sprint. |
| `sprint_archive` | `{ reason }` | archived view. This is an alpha recovery path and requires a reason. A successful archive also stops the live dashboard URL for that sprint. |
| `dashboard` | `{}` | `{ url }` — read-only live view. Give this localhost URL to the human. |

**Gate shape:** `{ kind: "test"|"typecheck"|"build"|"command"|"manual", spec, category?, cwd? }`.
Executable kinds are re-run at `sprint_close` from `git_dir` unless `cwd` is set. `cwd` is resolved
relative to `git_dir` unless absolute. `manual` relies on recorded evidence.

**Subsprint shape:** each subsprint should be a feature-sized unit with its own user-visible or
agent-visible outcome. Avoid catch-all phase names like "cleanup" unless the cleanup itself is the feature.
Spikes are regular subsprints with `kind:"spike"`; add normal items to them, then close them with
`spike_conclude()` or retire them with `spike_deprecate()`. Spike items do not contribute to the
release changelog.

**Item shape:** each item should be atomic: one tool, one endpoint, one component, one migration, or
one independently verifiable behavior. Prefer `catalogue_refresh`, `catalogue_list`,
`catalogue_search`, `catalogue_get`, `catalogue_preview`, and `catalogue_check` as six items over
"build the catalogue MCP" as one item. If an item title needs "and", "plus", or a comma-separated
list of outcomes, split it before calling `add()`.

**GateResult shape (for `done`):** `{ kind, spec, cwd?, passed, evidence, supersedes?, supersession_reason? }`.
Results must match the item's declared gates exactly by `kind`, `spec`, and `cwd`; `passed:false`
is rejected. If an early declared gate was a placeholder and the real final gate has a different
spec, pass the final gate as `kind/spec/cwd` and set `supersedes` to the declared gate plus a short
`supersession_reason`. Supersession still requires passing evidence and must name an actual declared
gate; it is for explained replacement, not skipped proof.

**Changelog shape (for `done`):** `{ verb, line }`, where `verb` is one of
`added|fixed|changed|removed|deprecated|security`.

**Change maps:** `done()` records Git numstat for the completed item's commit. Projected views expose
`change_map.by_file`, `by_directory`, `by_language`, and `hotspots` at item, subsprint, and sprint
levels. Rows include file, language, directory, items, commits, additions, deletions, net, and churn.

**Coverage shape (for `sprint_close`):** pass a path, not raw report text:
`{ coverage: { path:"coverage/lcov.info", format:"lcov", command:"npm run test:coverage" } }`.
Sprinty verifies the file exists, parses LCOV totals, stores only the summary, and includes it in
`changelog()` Markdown.

**Dependency graph:** dependency edges are `from -> to`, meaning `from` depends on `to`.
`current()` and `info()` expose `graph.nodes`, `graph.edges`, `blocked_by`, `unblocks`,
`topological_order`, and `cycles`. `current()` computes the work window for the agent: `current`
is the first open item whose dependencies are no longer open, `next` is the actionable open window,
and `blocked_open` lists open items still blocked by open dependencies. `relations[]` enriches the
relevant ids with direct blocker/unblocker nodes including labels and statuses, so agents do not
have to infer "what is related to what" from raw edges. `current()` also returns relevant artifacts,
recent artifacts, and recent activity. Sprinty rejects dependency writes that would create a cycle.

**Timestamps:** every ledger event has `ts`. The projected sprint view includes `created_at`,
`closed_at`, item/subsprint timestamps, dependency events, and `timeline[]` for human auditability.

**Storage:** one append-only JSONL ledger per sprint in `data_dir`, with a `current` pointer in that
same directory naming the active sprint (this enforces one-open-sprint unicity for the binding).
Keep `git_dir` and `data_dir` explicit; do not rely on the MCP process cwd, workspace roots, or a
worktree guess. `data_dir` is local agent state, not source code: scope it to the current worktree
or repo, keep it out of commits, and avoid shared temp directories that could mix sessions.
