---
name: how-to-run-a-sprint
description: Use before starting implementation work that spans more than one commit or one session - a feature, refactor, migration, or bug-fix campaign - and when resuming or closing that work later. Sprinty tracks it in a git-anchored ledger that survives context loss, compaction, and MCP restarts, so state is recovered with info() and sprint_resume() instead of reconstructed from memory. Triggers on "sprint", "track this work", "plan this feature", "pick up where we left off", or any multi-step build the user will want to watch.
---

# How To Run A Sprint

A Sprinty sprint is item-driven. Do not keep parallel prose trackers when tools are available.

## Why Use This Instead Of A Scratch Todo List

An in-session todo list is cheaper, and for a two-step fix it is the right tool. Reach for Sprinty when
any of these are true, because a todo list cannot do them:

- **The work outlives your context.** The ledger is on disk. After compaction, a restart, or a handoff
  to another session, `info({ git_dir })` then `sprint_resume({ git_dir })` restores exactly what was
  done, what is open, and what is blocked. A todo list is gone.
- **You need to not fool yourself about "done".** `item_done` refuses without a commit that actually
  resolves in the repo and passing evidence for every gate the item declared. You cannot check the box
  on work that is not really finished.
- **A human wants to watch without interrupting you.** `sprint_new` returns a live dashboard URL.
- **The record has to be auditable.** The ledger is append-only, and `search({ pattern })` queries it.

Cost is real: items need a title, description, code locations, and gates, and closing needs a
changelog and coverage. Pay it for multi-commit or multi-session work. Skip it for a one-line fix.

## Loop

1. Orient before binding. Call `info({ git_dir })` for the default `<git_dir>/.sprinty` ledger directory, `info({ data_dir })` for an explicit ledger directory, or `info({ workspace_dirs: [...] })` for a compact workspace view. Resume with `sprint_resume({ git_dir, data_dir? })`. Start fresh only with `sprint_new({ goal, git_dir, data_dir?, context_notes })`.
2. Share the dashboard URL returned by `sprint_new({})` or `sprint_resume({})`. Use `dashboard_info({})` to re-read it, `dashboard_restart({})` to refresh it, `overview({})` for compact orientation, and `next({})` for the active work window.
3. Create feature-sized subsprints with `subsprint_new({ description, goals, gates, dependencies })`.
4. Create atomic work with `item_add({ subsprint, title, description, code_locations, gates, dependencies, high_priority })`. If the work is too large, make more items; do not hide scope in notes.
5. Work against one owning item. Use `item_update({ id, note })` for progress, `item_update({ id, title, description, high_priority })` for metadata, `item_update({ id, dependencies })` to replace graph edges, `note_add({ id, text })` only for item-scoped observations, and `artifact_add({ title, path, description, related_items })` for durable files.
6. Resolve each item exactly once: `item_done({ id, commit_id, gate_results, changelog })`, `item_split({ id, description, goals, gates, dependencies })`, or `item_deprecate({ id, reason })`. `item_deprecate` also accepts a subsprint id to drop a whole subsprint and its open items.
7. Use `search({ pattern, context_size:512 })`, `*_list`, and focused `*_get` tools when you need detail.
8. Generate the sprint changelog with `changelog({ path? })`; Sprinty writes SemVer Markdown and returns only the path.
9. Close only after the changelog exists: `sprint_close({ coverage:{ path, format:"lcov", command } })`.

## Rules

- Never invent ids; read minted ids from tool results.
- Use explicit `git_dir`; `data_dir` defaults to `<git_dir>/.sprinty` when omitted. Never rely on MCP cwd.
- Keep responses compact. Prefer `next`, `overview`, `search`, and list/get pairs over full views. `next({})` returns all available high-priority items, then one normal available item per subsprint by default.
- Notes must be bound to an item id. Work needs an item.
- Gates prove items. `item_done` requires a real commit and passing evidence for every declared gate.
- `item_done` records each item's SemVer changelog verb and line; `changelog({ path? })` generates the Markdown file from those entries.
- `sprint_close` is the final gate and comes after changelog generation: it rejects open items, missing commits/changelog/coverage, and failing executable gates.
- Every subsprint must end resolved. A subsprint you created but never filled with items still counts as open work; give it items or drop it with `item_deprecate({ id: "S0n", reason })`.
