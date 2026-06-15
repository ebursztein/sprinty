# Sprinty

When a task is non-trivial, run a disciplined sprint with the sprinty MCP.

See `skills/how-to-run-a-sprint` and `skills/using-sprinty`. The loop:

```
sprint_new(goal, context_notes?)
  -> subsprint_new(description, goals[], gates[], dependencies?)
  -> add(subsprint, description, code_locations[], gates[], dependencies?)
  -> dependencies(target, dependencies[])
  -> done(commit_id, gate_results[], changelog) | split(...) | deprecate(reason)
  -> changelog()
  -> sprint_close(coverage: { path, format: "lcov", command? })
```

Rules: IDs are minted by the server (`S01`, `S01-001`) — never invent them. Every item needs a
description, at least one code location, and at least one gate. `done` requires a real commit,
passing evidence for every declared item gate, and a semver-style changelog line with a verb such as
`added`, `fixed`, or `removed`. `split` and `deprecate` are terminal non-code exits. `current()`
returns the dependency graph, including topological order and cycles. `done` records a Git-backed
change map. `changelog()` returns Markdown with changelog and change-map tables. `sprint_close`
rechecks commits, re-runs executable gates, requires an LCOV coverage report path, and refuses to
close on any blocker. Use
`search(pattern, context_lines)` to query the immutable ledger. Use `dashboard()` for a live view,
and give the returned localhost URL to the human so they can watch the sprint timeline.
