---
name: how-to-run-a-sprint
description: Use at the start of non-trivial implementation work that should be tracked in Sprinty with explicit binding, item ownership, gates, and close checks.
---

# How To Run A Sprint

A Sprinty sprint is item-driven. Do not keep parallel prose trackers when tools are available.

## Loop

1. Bind explicitly. Use `sprint_list({ data_dir })` to inspect existing ledgers after restart, then `sprint_resume({ git_dir, data_dir })`. Start fresh only with `sprint_new({ goal, git_dir, data_dir, context_notes })`.
2. Call `dashboard({})` and share the URL. Use `overview({})` for compact orientation and `next({})` for the active work window.
3. Create feature-sized subsprints with `subsprint_new({ description, goals, gates, dependencies })`.
4. Create atomic work with `item_add({ subsprint, title, description, code_locations, gates, dependencies, high_priority })`. If the work is too large, make more items; do not hide scope in notes.
5. Work against one owning item. Use `item_update({ id, note })` for progress, `item_update({ id, title, description, high_priority })` for metadata, `item_update({ id, dependencies })` to replace graph edges, `note_add({ id, text })` only for item-scoped observations, and `artifact_add({ title, path, description, related_items })` for durable files.
6. Resolve each item exactly once: `item_done({ id, commit_id, gate_results, changelog })`, `item_split({ id, description, goals, gates, dependencies })`, or `item_deprecate({ id, reason })`.
7. Use `search({ pattern, context_size:512 })`, `*_list`, and focused `*_get` tools when you need detail.
8. Finish with `changelog({})`, then `sprint_close({ coverage:{ path, format:"lcov", command } })`.

## Rules

- Never invent ids; read minted ids from tool results.
- Use explicit `git_dir` and `data_dir`. Never rely on MCP cwd.
- Keep responses compact. Prefer `next`, `overview`, `search`, and list/get pairs over full views. `next({})` returns all available high-priority items, then one normal available item per subsprint by default.
- Notes must be bound to an item id. Work needs an item.
- Gates prove items. `item_done` requires a real commit and passing evidence for every declared gate.
- `sprint_close` is the final gate: it rejects open items, missing commits/changelog/coverage, and failing executable gates.
