---
name: how-to-run-a-sprint
description: Use at the start of any non-trivial change to run a disciplined, ledgered sprint via the sprinty MCP. Covers the open -> item-driven build -> resolve -> close loop and the gates.
---

# How to run a sprint

A sprint is one focused unit of work for this session. It is item-driven: you do not
write prose plans, you create structured items the sprinty MCP records in an immutable ledger.

## The loop

1. **`sprint_new(goal, git_dir, data_dir, context_notes?)`** — one sentence of intent plus explicit
   absolute paths. `git_dir` is where commits, gates, coverage, and change maps run. `data_dir` is
   where Sprinty stores the `current` pointer and JSONL ledgers. Make `data_dir` worktree-scoped and
   uncommitted, such as `<git_dir>/.sprinty` when that path is gitignored; avoid shared temp dirs.
   Do not guess from the MCP cwd or workspace roots. Returns the skills to use and a primer. After a
   Codex/MCP restart, do not call `sprint_new` just to make the server notice an existing ledger:
   call **`sprint_list(data_dir)`** to inspect the known ledger directory, then
   **`sprint_resume(git_dir, data_dir)`** to reattach without creating a sprint. Use
   **`sprint_detach()`** before switching one MCP process to another sprint. Call **`info()`** any
   time to re-orient after binding; it must show the expected `dir` and `data_dir`. Then call
   **`dashboard()`** and show the localhost URL to the human so they can follow the sprint.
2. **`subsprint_new(description, goals[], gates[], dependencies?)`** — carve the work into a goal-bearing unit.
   Each subsprint should be one feature, not a loose phase or miscellaneous bucket. A gate is
   always *about something*: `{ kind: test|typecheck|build|command|manual, spec, category?, cwd? }`.
   Executable gates run from `git_dir` unless `cwd` is set, in which case `cwd` must also appear in
   the matching `gate_results[]` entry passed to `done()`.
   Use **`spike(description, goals[], gates[], dependencies?)`** when the feature needs an
   investigation branch; a spike is still a subsprint, can have normal items, and must end with
   **`spike_conclude(subsprint, conclusion)`** or **`spike_deprecate(subsprint, reason)`**.
3. **`add(subsprint, title, description, code_locations[], gates[], dependencies?)`** — add an
   atomic item. `title` is the short tree label (3-80 chars); `description` is bounded detail
   (20-500 chars). The item should be one tool, one endpoint, one component, one migration, or one
   independently verifiable behavior. For MCP work, prefer one item per tool; for UI work, prefer
   one item per real component or screen behavior. The item's gates are what proves it; a
   `test`-kind gate is the test you must write.
4. Work the item. Use **`update(target, note)`** to record intermediate discoveries,
   **`note(element, text)`** for observations, and **`dependencies(target, dependencies[])`** to
   add graph edges. Use **`artifact_add/list/amend/deprecate`** for durable outputs and
   **`follow_up(target, description, bug_id|bug_ids)`** when you discover a bug. `current()`
   returns the dependency graph with topological order, relevant artifacts, recent artifacts, and
   recent activity. Trust `current.current`, `current.next`, `current.blocked_open`, and
   `current.relations` for what is actionable and how items relate; do not infer the next item from
   a raw open-item list.
5. Resolve every item exactly one way:
   - **`done(item, commit_id, gate_results[], changelog)`** — completed. Requires a *real*
     commit, passing evidence for every declared item gate, and a semver changelog line. Sprinty
     records the commit's Git change map automatically.
     If a declared gate was an early placeholder and the final evidence gate has a different spec,
     keep the final gate as the result and set `supersedes` to the declared gate with a
     `supersession_reason`. Use this only to explain a stricter or more accurate replacement, not
     to bypass missing evidence.
   - **`split(item, description, goals[], gates[])`** — the item was too big; it becomes a new
     subsprint (atomically resolved as `split`). Then `add` items into the new subsprint.
   - **`deprecate(item, reason)`** — drop it, on the record, with a real reason.
6. **`changelog()`** — render the Markdown release note. It includes semver sections, coverage, and
   change-map tables for the sprint and each subsprint.
7. **`sprint_close({ coverage:{ path, format:"lcov", command? } })`** — the teeth. It re-runs every
   executable gate, parses the coverage report path, and refuses to close if any item is open, any
   completed item lacks a commit/changelog, coverage evidence is missing, or any gate fails. Read
   the blockers, fix them, close again. When close succeeds, Sprinty stops the live dashboard URL
   for that sprint so localhost dashboard processes do not accumulate.

## Rules

- Never invent an id. The server mints `S01`, `S01-001`. Read them back from tool results.
- Start with explicit `git_dir` and a worktree-scoped, uncommitted `data_dir`; if `info()` reports
  the wrong paths, stop before adding items.
- After Codex or the MCP server restarts, resume with `sprint_list(data_dir)` and
  `sprint_resume(git_dir, data_dir)`; never use a rejected `sprint_new` call as a binding trick.
- Use `sprint_detach()` to clear the current MCP process binding before resuming a different sprint.
- No item without a short title, bounded description, at least one code location, and at least one gate.
- Keep items atomic. If the title needs "and", "plus", or multiple deliverables, split it before
  adding it. Oversized `add()` calls are rejected with a nudge to use `split()` or smaller items.
- Don't go out of order: orient with `info()`/`current()` before adding or resolving.
- Use dependency ids when work is blocked. Sprinty rejects unknown ids and cycles.
- Generate coverage before close and pass the report path, usually `coverage/lcov.info`.
- The ledger is append-only. You cannot un-say a resolution — resolve honestly.
- Want to watch it live? **`dashboard()`** returns a localhost URL. Surface that URL to the human
  so they can open it in a browser while you work. Do this at sprint start, not just at the end.
- Search the immutable record anytime with **`search(pattern, context_lines)`** (regex + grep-style context).
- One sprint open at a time. Start a new sprint only after `sprint_close()` accepts the current one.
- Every ledger event has a timestamp. Use the dashboard timeline, `info()`, or `search()` when the
  human asks what happened when.
