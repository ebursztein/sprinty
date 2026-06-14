---
name: using-sprinty
description: Reference for the sprinty MCP tools — exact inputs, what each returns, and the failure modes. Use when you need the precise contract of a sprinty tool.
---

# Using sprinty (tool reference)

| Tool | Input | Returns / Rejects |
|---|---|---|
| `sprint_new` | `{ goal }` | sprint view + orientation. Rejects if a sprint is already open. |
| `info` | `{}` | full sprint view (subsprints + items + statuses). |
| `current` | `{ past?=1, future?=3 }` | last resolved items, next open items, current subsprint notes. |
| `subsprint_new` | `{ description, goals[], gates[] }` | `{ id: "S0N", … }`. |
| `add` | `{ subsprint, description, code_locations[], gates[] }` | `{ id: "S0N-00M", … }`. Rejects unknown subsprint. |
| `update` | `{ target, note }` | view. Rejects unknown target. |
| `done` | `{ item, commit_id, gate_results[] }` | view. Rejects fake commit / failing gate / already resolved. |
| `split` | `{ item, description, goals[], gates[] }` | view. Item → `split`, new subsprint seeded. |
| `deprecate` | `{ item, reason }` | view. Requires non-empty reason. |
| `note` | `{ element, text }` | view. `element` is an item or subsprint id. |
| `search` | `{ pattern, context_lines?=0 }` | regex matches over the current sprint ledger, with context lines. |
| `sprint_close` | `{}` | closed view, or an error listing every blocker. |
| `dashboard` | `{}` | `{ url }` — read-only live view. |

**Gate shape:** `{ kind: "test"|"typecheck"|"build"|"command"|"manual", spec }`.
Executable kinds are re-run at `sprint_close`; `manual` relies on recorded evidence.

**GateResult shape (for `done`):** `{ kind, spec, passed, evidence }`. `passed:false` is rejected.

**Storage:** one append-only JSONL ledger per sprint under `.sprinty/`, with a `.sprinty/current`
pointer naming the active sprint (this enforces one-open-sprint unicity). `.sprinty/` is per
working tree, so git worktrees run independent sprints.
