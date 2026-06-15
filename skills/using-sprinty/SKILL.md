---
name: using-sprinty
description: Reference for the sprinty MCP tools — exact inputs, what each returns, and the failure modes. Use when you need the precise contract of a sprinty tool.
---

# Using sprinty (tool reference)

| Tool | Input | Returns / Rejects |
|---|---|---|
| `sprint_new` | `{ goal, context_notes?[] }` | sprint view + orientation. Rejects if a sprint is already open. |
| `info` | `{}` | full sprint view (subsprints + items + statuses). |
| `current` | `{ past?=1, future?=3 }` | last terminal items, next open items, current subsprint notes, dependency graph. |
| `subsprint_new` | `{ description, goals[], gates[], dependencies?[] }` | `{ id: "S0N", … }`. Rejects unknown deps/cycles. |
| `add` | `{ subsprint, description, code_locations[], gates[], dependencies?[] }` | `{ id: "S0N-00M", … }`. Rejects unknown subsprint/deps/cycles. |
| `update` | `{ target, note }` | view. Rejects unknown target. |
| `done` | `{ item, commit_id, gate_results[], changelog }` | view. Rejects fake commit / missing, extra, mismatched, or failing gate evidence / missing changelog / terminal item. |
| `split` | `{ item, description, goals[], gates[] }` | view. Item → `split`, new subsprint seeded. |
| `deprecate` | `{ item, reason }` | view. Requires non-empty reason. |
| `note` | `{ element, text }` | view. `element` is an item or subsprint id. |
| `dependencies` | `{ target, dependencies[] }` | view. Adds dependency edges. Rejects unknown ids, duplicates, or cycles. |
| `search` | `{ pattern, context_lines?=0 }` | regex matches over the current sprint ledger, with context lines. |
| `changelog` | `{}` | `{ markdown }`. Renders semver changelog sections plus coverage and change-map tables. |
| `sprint_close` | `{ coverage: { path, format:"lcov", command? } }` | closed view, or an error listing every blocker. Coverage is required when completed code items exist. |
| `dashboard` | `{}` | `{ url }` — read-only live view. Give this localhost URL to the human. |

**Gate shape:** `{ kind: "test"|"typecheck"|"build"|"command"|"manual", spec, category? }`.
Executable kinds are re-run at `sprint_close`; `manual` relies on recorded evidence.

**GateResult shape (for `done`):** `{ kind, spec, passed, evidence }`. Results must match the
item's declared gates exactly by `kind` and `spec`; `passed:false` is rejected.

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
`topological_order`, and `cycles`. Sprinty rejects dependency writes that would create a cycle.

**Timestamps:** every ledger event has `ts`. The projected sprint view includes `created_at`,
`closed_at`, item/subsprint timestamps, dependency events, and `timeline[]` for human auditability.

**Storage:** one append-only JSONL ledger per sprint under `.sprinty/`, with a `.sprinty/current`
pointer naming the active sprint (this enforces one-open-sprint unicity). `.sprinty/` is per
working tree, so git worktrees run independent sprints.
