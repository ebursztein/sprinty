# Sprinty

When a task is non-trivial, run a disciplined sprint with the sprinty MCP.

See `skills/how-to-run-a-sprint` and `skills/using-sprinty`. The loop:

```
sprint_new(goal, git_dir, data_dir, context_notes?)
  -> dashboard()
  -> subsprint_new(description, goals[], gates[], dependencies?)
  -> spike(description, goals[], gates[], dependencies?)
  -> add(subsprint, title, description, code_locations[], gates[], dependencies?)
  -> artifact_add/list/amend/deprecate(...)
  -> follow_up(target, description, bug_id|bug_ids)
  -> dependencies(target, dependencies[])
  -> done(commit_id, gate_results[], changelog) | split(...) | deprecate(reason)
  -> spike_conclude(subsprint, conclusion) | spike_deprecate(subsprint, reason)
  -> changelog()
  -> sprint_close(coverage: { path, format: "lcov", command? })
```

Rules: IDs are minted by the server (`S01`, `S01-001`) — never invent them. Start with explicit
absolute `git_dir` and `data_dir`; `git_dir` is where commits/gates/coverage run, and `data_dir`
stores Sprinty's `current` pointer and JSONL ledgers. Every item needs a
description, at least one code location, and at least one gate. `done` requires a real commit,
passing evidence for every declared item gate, and a semver-style changelog line with a verb such as
`added`, `fixed`, or `removed`. `split` and `deprecate` are terminal non-code exits. Each
subsprint should be one feature; use `spike()` for feature investigations, then close the spike with
`spike_conclude()` or `spike_deprecate()`. Use `artifact_add/list/amend/deprecate` for durable
outputs and `follow_up()` with bug ids for bugs found while moving fast. `current()` returns the
dependency graph, including topological order and cycles, plus relevant artifacts, recent artifacts,
and recent activity. `done` records a Git-backed change map. `changelog()` returns Markdown with
changelog and change-map tables. `sprint_close` rechecks commits, re-runs executable gates, requires
an LCOV coverage report path, and refuses to close on any blocker. Use `search(pattern,
context_lines)` to query the immutable ledger. Use `dashboard()` immediately after `sprint_new()`,
and give the returned localhost URL to the human so they can watch the sprint timeline.
