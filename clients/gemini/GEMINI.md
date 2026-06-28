# Sprinty

When a task is non-trivial, run a disciplined sprint with the sprinty MCP.

See `skills/how-to-run-a-sprint` and `skills/using-sprinty`. The loop:

```
sprint_list(data_dir?) -> sprint_resume(git_dir, data_dir) | sprint_detach()
sprint_new(goal, git_dir, data_dir, context_notes?)
  -> dashboard URL in response | dashboard_info() | dashboard_restart()
  -> subsprint_new(description, goals[], gates[], dependencies?)
  -> spike(description, goals[], gates[], dependencies?)
  -> next(past?, future_per_subsprint?, include_high_priority?)
  -> add(subsprint, title, description, code_locations[], gates[], dependencies?, high_priority?)
  -> item_update(id, note?, title?, description?, high_priority?, dependencies?)
  -> artifact_add/list/amend/deprecate(...)
  -> follow_up(target, description, bug_id|bug_ids)
  -> done(commit_id, gate_results[], changelog) | split(...) | deprecate(reason)
  -> spike_conclude(subsprint, conclusion) | spike_deprecate(subsprint, reason)
  -> changelog()
  -> sprint_close(coverage: { path, format: "lcov", command? })
```

Rules: IDs are minted by the server (`S01`, `S01-001`) — never invent them. Start with explicit
absolute `git_dir` and `data_dir`; `git_dir` is where commits/gates/coverage run, and `data_dir`
stores Sprinty's `current` pointer and JSONL ledgers. After a Codex/MCP restart, use
`sprint_list(data_dir)` and `sprint_resume(git_dir, data_dir)` to reattach without creating a new
sprint; use `sprint_detach()` before switching one MCP process to another sprint. Every item needs a
description, at least one code location, and at least one gate. `done` requires a real commit,
passing evidence for every declared item gate, and a semver-style changelog line with a verb such as
`added`, `fixed`, or `removed`. `split` and `deprecate` are terminal non-code exits. Each
subsprint should be one feature; use `spike()` for feature investigations, then close the spike with
`spike_conclude()` or `spike_deprecate()`. Use `artifact_add/list/amend/deprecate` for durable
outputs and `follow_up()` with bug ids for bugs found while moving fast. `next()` returns the active
work window with relevant artifacts and recent activity: all available `high_priority` items first
by default, then normal available items per subsprint. `item_update({ id, dependencies })` replaces
dependencies, so pass `dependencies: []` to remove a bad edge. `done` records a Git-backed change map and each item's SemVer changelog entry. `changelog({ path? })` generates the SemVer Markdown file with
sections, item entries, commits, coverage, and change-map tables; run it before `sprint_close`. `sprint_close` rechecks commits, re-runs executable gates, requires
an LCOV coverage report path, and refuses to close on any blocker. Use `search(pattern,
context_lines)` to query the immutable ledger. Show the dashboard URL returned by `sprint_new()` or
`sprint_resume()` to the human so they can watch the sprint timeline; use `dashboard_info()` to
re-read it and `dashboard_restart()` to refresh it.
