# Sprinty

When a task is non-trivial, run a disciplined sprint with the sprinty MCP.

See `skills/how-to-run-a-sprint` and `skills/using-sprinty`. The loop:

```
sprint_new(goal)
  -> subsprint_new(description, goals[], gates[])
  -> add(subsprint, description, code_locations[], gates[])
  -> done(commit_id, gate_results[]) | split(...) | deprecate(reason)
  -> sprint_close()
```

Rules: IDs are minted by the server (`S01`, `S01-001`) — never invent them. Every item needs a
description, at least one code location, and at least one gate. `done` requires a real commit and
passing gates. `sprint_close` re-runs the gates and refuses to close on any blocker. Use
`search(pattern, context_lines)` to query the immutable ledger and `dashboard()` for a live view.
