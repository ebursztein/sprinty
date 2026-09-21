---
name: using-sprinty
description: Use when calling any Sprinty MCP tool and you need the exact contract - tool names, required fields, field limits, id formats, compact response rules, restart recovery, or note/artifact/item semantics. Read this before guessing at arguments or when a Sprinty tool call was rejected.
---

# Using Sprinty

Prefer compact commands first. Lists are compact and say which `_get()` tool returns full detail. Mutating tools return acknowledgements plus `next_tools`, concrete follow-up calls derived from live state; do not expect or request full sprint dumps from mutations.

## Core Tools

| Tool | Input | Use |
|---|---|---|
| `info` | `{ git_dir?, data_dir?, workspace_dirs?[] }` | First-call orientation before binding. Returns startup workflow, resume/create help, dashboard state, and sprint rows with title, created time, and open/closed/blocked item counts. |
| `sprint_resume` | `{ git_dir, data_dir? }` | Rebind this MCP process to an existing sprint. Returns a bounded `briefing` (counts, current item, blocked ids, last resolved, recent notes), the `skills` to read, and the dashboard URL - use it instead of re-deriving state with overview+next. `data_dir` defaults to `<git_dir>/.sprinty`. Never call `sprint_new` as a resume trick. |
| `sprint_detach` | `{}` | Clear this process binding before resuming a different sprint. |
| `sprint_new` | `{ goal, git_dir, data_dir?, context_notes?[] }` | Start one sprint with explicit `git_dir`; `data_dir` defaults to `<git_dir>/.sprinty`. Returns the dashboard URL. |
| `overview` | `{}` | Compact sprint title/details/artifacts/subsprints/items. Use this to orient. |
| `next` | `{ past?=1, future?, future_per_subsprint?=1, include_high_priority?=true }` | Compact active work window. Returns all available high-priority items first, then normal available items per subsprint. `future` caps the total returned across all subsprints. No full graph. |
| `search` | `{ pattern, context_size?=512 }` | Regex search. Returns `{ id, type, text, tool_call }`; use `tool_call` for full detail. |
| `dashboard_info` | `{}` | Current localhost dashboard URL and port, or `running:false` when stopped. |
| `dashboard_restart` | `{}` | Restart the dashboard server and return the new URL and port. |

## Work Tools

| Tool | Input | Use |
|---|---|---|
| `subsprint_new` | `{ description, goals[], gates[], dependencies?[] }` | Create a feature-sized unit. |
| `subsprint_list` | `{}` | Compact subsprint rows. Use `subsprint_get({ id })` for full detail. |
| `subsprint_get` | `{ id }` | Full subsprint detail and compact item rows. |
| `item_add` | `{ subsprint, title, description, code_locations[], gates[], gate_timeout_ms?, dependencies?[], high_priority? }` | Create an atomic item. `gate_timeout_ms` defaults to 5000; use a positive integer to customize it or `null` to disable the timeout. Title 3-80 chars, single line; description 20-800 chars; at least one `code_locations` entry; 1-3 gates. |
| `item_get` | `{ id }` | Full item detail. |
| `item_update` | `{ id, note?, title?, description?, high_priority?, gates?[], gate_timeout_ms?, commit_id?, dependencies?[] }` | Mutate allowlisted fields by item id. Open or completed items may revise executable gates/timeouts before close; `commit_id` corrects a completed item and recomputes its change map. New manual evidence cannot be added after completion. |
| `item_done` | `{ id, commit_id, changelog, gate_results?[] }` | Complete an item. Sprinty runs executable gates under the item's configured timeout and records their real output; pass `gate_results` only for `manual` gates. A timed-out gate is marked unverified and does not block the item. Commit must resolve. |
| `item_split` | `{ id, description, goals[], gates[], dependencies?[] }` | Resolve an oversized item by creating a new subsprint. |
| `item_deprecate` | `{ id, reason }` | Resolve an item as intentionally dropped. Also accepts a subsprint id: that deprecates the subsprint and cascades to its open items. |

## Notes And Artifacts

| Tool | Input | Use |
|---|---|---|
| `note_add` | `{ id, text }` | Attach a note to an item id only. Notes do not replace items. |
| `note_list` | `{ id }` | Compact notes for an item. Use `note_get({ id })` for full text. |
| `note_get` | `{ id }` | Full note detail. Note ids are random: `N` + 12 hex. Ledgers written earlier keep their `N001`-style ids. |
| `note_update` | `{ id, text }` | Replace note text by note id. |
| `artifact_add` | `{ title, path, description?, related_items?[] }` | Attach a durable sprint file/output. |
| `artifact_list` | `{}` | Compact artifact rows. Use `artifact_get({ id })` for full detail. |
| `artifact_get` | `{ id }` | Full artifact detail including description. |
| `artifact_update` | `{ id, title?, path?, description?, related_items?[] }` | Amend artifact metadata. |

## Close

`sprint_close({ coverage:{ path, format:"lcov", command? }, force? })` re-runs executable gates using each item's configured timeout and writes the canonical SemVer changelog with item entries, current commits, coverage, and change maps. `force:true` records the override and bypasses only executable-gate failures; unresolved work, missing commits/item changelog entries, and missing coverage still block close. Use `changelog({ path? })` only to preview or export that content before close. Use `sprint_archive({ reason })` only for recovery.

## Rules

- Always minimize tokens: use `next`, `overview`, `*_list`, `search`, then focused `*_get`.
- Public id inputs are always named `id`.
- Notes attach only to item ids. If the note describes work, create one or more `item_add` items.
- `high_priority` is a boolean, not a ranked priority model. `next({})` promotes all available high-priority items before the per-subsprint normal window unless `include_high_priority:false`.
- Dependencies are ids. `item_update({ id, dependencies:[...] })` replaces the item's dependency set and rejects unknown ids, duplicates, and cycles.
- Tool responses omit timestamps and empty fields; the append-only ledger keeps audit data.
- `next_tools` on every response names calls whose ids exist right now. Following it is cheaper and safer than constructing ids yourself.
- `item_get` reports `actual_code_locations` from the resolving commit, and `undeclared_code_locations` when the commit touched files the item never declared.
