---
name: how-to-run-a-sprint
description: Use at the start of any non-trivial change to run a disciplined, ledgered sprint via the sprinty MCP. Covers the open -> item-driven build -> resolve -> close loop and the gates.
---

# How to run a sprint

A sprint is one focused unit of work for this session. It is item-driven: you do not
write prose plans, you create structured items the sprinty MCP records in an immutable ledger.

## The loop

1. **`sprint_new(goal, context_notes?)`** — one sentence of intent plus optional context. Returns
   the skills to use and a primer. Call **`info()`** any time to re-orient.
2. **`subsprint_new(description, goals[], gates[], dependencies?)`** — carve the work into a goal-bearing unit.
   A gate is always *about something*: `{ kind: test|typecheck|build|command|manual, spec, category? }`.
3. **`add(subsprint, description, code_locations[], gates[], dependencies?)`** — add an item. All three are
   required. The item's gates are what proves it; a `test`-kind gate is the test you must write.
4. Work the item. Use **`update(target, note)`** to record intermediate discoveries,
   **`note(element, text)`** for observations, and **`dependencies(target, dependencies[])`** to
   add graph edges. `current()` returns the dependency graph with topological order.
5. Resolve every item exactly one way:
   - **`done(item, commit_id, gate_results[], changelog)`** — completed. Requires a *real*
     commit, passing evidence for every declared item gate, and a semver changelog line. Sprinty
     records the commit's Git change map automatically.
   - **`split(item, description, goals[], gates[])`** — the item was too big; it becomes a new
     subsprint (atomically resolved as `split`). Then `add` items into the new subsprint.
   - **`deprecate(item, reason)`** — drop it, on the record, with a real reason.
6. **`changelog()`** — render the Markdown release note. It includes semver sections, coverage, and
   change-map tables for the sprint and each subsprint.
7. **`sprint_close({ coverage:{ path, format:"lcov", command? } })`** — the teeth. It re-runs every
   executable gate, parses the coverage report path, and refuses to close if any item is open, any
   completed item lacks a commit/changelog, coverage evidence is missing, or any gate fails. Read
   the blockers, fix them, close again.

## Rules

- Never invent an id. The server mints `S01`, `S01-001`. Read them back from tool results.
- No item without a description, at least one code location, and at least one gate.
- Don't go out of order: orient with `info()`/`current()` before adding or resolving.
- Use dependency ids when work is blocked. Sprinty rejects unknown ids and cycles.
- Generate coverage before close and pass the report path, usually `coverage/lcov.info`.
- The ledger is append-only. You cannot un-say a resolution — resolve honestly.
- Want to watch it live? **`dashboard()`** returns a localhost URL. Surface that URL to the human
  so they can open it in a browser while you work.
- Search the immutable record anytime with **`search(pattern, context_lines)`** (regex + grep-style context).
- One sprint open at a time. Start a new sprint only after `sprint_close()` accepts the current one.
- Every ledger event has a timestamp. Use the dashboard timeline, `info()`, or `search()` when the
  human asks what happened when.
