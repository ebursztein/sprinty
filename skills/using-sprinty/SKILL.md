---
name: using-sprinty
description: Use when an agent needs the exact Sprinty MCP tool contract, public tool names, compact response rules, restart recovery, or note/artifact/item semantics.
---

# Using Sprinty

Prefer compact commands first. Lists are compact and say which `_get()` tool returns full detail. Mutating tools return acknowledgements plus `help`; do not expect or request full sprint dumps from mutations.

## Core Tools

| Tool | Input | Use |
|---|---|---|
| `sprint_list` | `{ data_dir? }` | Inspect ledgers without creating or binding. Returns sprint title plus open/closed/blocked item counts. |
| `sprint_resume` | `{ git_dir, data_dir }` | Rebind this MCP process to an existing sprint and return the dashboard URL. Never call `sprint_new` as a resume trick. |
| `sprint_detach` | `{}` | Clear this process binding before resuming a different sprint. |
| `sprint_new` | `{ goal, git_dir, data_dir, context_notes?[] }` | Start one sprint with explicit paths and return the dashboard URL. |
| `overview` | `{}` | Compact sprint title/details/artifacts/subsprints/items. Use this to orient. |
| `next` | `{ past?=1, future_per_subsprint?=1, include_high_priority?=true }` | Compact active work window. Returns all available high-priority items first, then normal available items per subsprint. No full graph. |
| `search` | `{ pattern, context_size?=512 }` | Regex search. Returns `{ id, type, text, tool_call }`; use `tool_call` for full detail. |
| `dashboard_info` | `{}` | Current localhost dashboard URL and port, or `running:false` when stopped. |
| `dashboard_restart` | `{}` | Restart the dashboard server and return the new URL and port. |

## Work Tools

| Tool | Input | Use |
|---|---|---|
| `subsprint_new` | `{ description, goals[], gates[], dependencies?[] }` | Create a feature-sized unit. |
| `subsprint_list` | `{}` | Compact subsprint rows. Use `subsprint_get({ id })` for full detail. |
| `subsprint_get` | `{ id }` | Full subsprint detail and compact item rows. |
| `item_add` | `{ subsprint, title, description, code_locations[], gates[], dependencies?[], high_priority? }` | Create an atomic item. Title 3-80 chars; description 20-500 chars. Oversized inputs mean create more than one item. |
| `item_get` | `{ id }` | Full item detail. |
| `item_update` | `{ id, note?, title?, description?, high_priority?, dependencies?[] }` | Mutate item metadata and/or replace dependency ids. Use `dependencies:[]` to remove all dependencies. |
| `item_done` | `{ id, commit_id, gate_results[], changelog }` | Complete an item. Commit must resolve; every declared gate needs passing evidence. |
| `item_split` | `{ id, description, goals[], gates[], dependencies?[] }` | Resolve an oversized item by creating a new subsprint. |
| `item_deprecate` | `{ id, reason }` | Resolve an item as intentionally dropped. |

## Notes And Artifacts

| Tool | Input | Use |
|---|---|---|
| `note_add` | `{ id, text }` | Attach a note to an item id only. Notes do not replace items. |
| `note_list` | `{ id }` | Compact notes for an item. Use `note_get({ id:"N001" })` for full text. |
| `note_get` | `{ id }` | Full note detail. Note ids are `N001`, `N002`, ... |
| `note_update` | `{ id, text }` | Replace note text by note id. |
| `artifact_add` | `{ title, path, description?, related_items?[] }` | Attach a durable sprint file/output. |
| `artifact_list` | `{}` | Compact artifact rows. Use `artifact_get({ id })` for full detail. |
| `artifact_get` | `{ id }` | Full artifact detail including description. |
| `artifact_update` | `{ id, title?, path?, description?, related_items?[] }` | Amend artifact metadata. |

## Close

Use `changelog({})` for Markdown. Use `sprint_close({ coverage:{ path, format:"lcov", command? } })`; close re-runs executable gates and refuses open items, missing commits, missing changelog, missing coverage, or failing gates. Use `sprint_archive({ reason })` only for recovery.

## Rules

- Always minimize tokens: use `next`, `overview`, `*_list`, `search`, then focused `*_get`.
- Public id inputs are always named `id`.
- Notes attach only to item ids. If the note describes work, create one or more `item_add` items.
- `high_priority` is a boolean, not a ranked priority model. `next({})` promotes all available high-priority items before the per-subsprint normal window unless `include_high_priority:false`.
- Dependencies are ids. `item_update({ id, dependencies:[...] })` replaces the item's dependency set and rejects unknown ids, duplicates, and cycles.
- Tool responses omit timestamps and empty fields; the append-only ledger keeps audit data.
