---
name: how-to-run-a-sprint
description: Use at the start of any non-trivial change to run a disciplined, ledgered sprint via the sprinty MCP. Covers the open -> item-driven build -> resolve -> close loop and the gates.
---

# How to run a sprint

A sprint is one focused unit of work for this session. It is item-driven: you do not
write prose plans, you create structured items the sprinty MCP records in an immutable ledger.

## The loop

1. **`sprint_new(goal)`** — one sentence of intent. Returns the skills to use and a primer.
   Call **`info()`** any time to re-orient (especially after a context reset).
2. **`subsprint_new(description, goals[], gates[])`** — carve the work into a goal-bearing unit.
   A gate is always *about something*: `{ kind: test|typecheck|build|command|manual, spec }`.
3. **`add(subsprint, description, code_locations[], gates[])`** — add an item. All three are
   required. The item's gates are what proves it; a `test`-kind gate is the test you must write.
4. Work the item. Use **`update(target, note)`** to record intermediate discoveries, and
   **`note(element, text)`** for observations on an item or subsprint.
5. Resolve every item exactly one way:
   - **`done(item, commit_id, gate_results[])`** — completed. Requires a *real* commit and
     passing gate results. The server verifies the commit exists.
   - **`split(item, description, goals[], gates[])`** — the item was too big; it becomes a new
     subsprint (atomically resolved as `split`). Then `add` items into the new subsprint.
   - **`deprecate(item, reason)`** — drop it, on the record, with a real reason.
6. **`sprint_close()`** — the teeth. It re-runs every executable gate and refuses to close if any
   item is unresolved, any completed item lacks a commit, or any gate fails. Read the blockers,
   fix them, close again.

## Rules

- Never invent an id. The server mints `S01`, `S01-001`. Read them back from tool results.
- No item without a description, at least one code location, and at least one gate.
- Don't go out of order: orient with `info()`/`current()` before adding or resolving.
- The ledger is append-only. You cannot un-say a resolution — resolve honestly.
- Want to watch it live? **`dashboard()`** returns a URL that auto-refreshes.
- Search the immutable record anytime with **`search(pattern, context_lines)`** (regex + grep-style context).
- One sprint open at a time. Start a new sprint only after `sprint_close()` accepts the current one.
