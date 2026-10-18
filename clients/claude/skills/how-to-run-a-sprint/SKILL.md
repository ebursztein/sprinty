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
  resolves in the repo, and Sprinty runs the item's gates itself rather than taking your word for it.
  You cannot check the box on work that is not really finished.
- **A human wants to watch without interrupting you.** `sprint_new` returns a live dashboard URL.
- **The record has to be auditable.** The ledger is append-only, and `search({ pattern })` queries it.

Cost is real: items need a title, description, code locations, and gates, and closing needs a
changelog and coverage. Pay it for multi-commit or multi-session work. Skip it for a one-line fix.

## Loop

1. Orient before binding. Call `info({ git_dir })` for the default `<git_dir>/.sprinty` ledger directory, `info({ data_dir })` for an explicit ledger directory, or `info({ workspace_dirs: [...] })` for a compact workspace view. Resume with `sprint_resume({ git_dir, data_dir? })`. Start fresh only with `sprint_new({ goal, git_dir, data_dir?, context_notes })`.
2. Share the dashboard URL returned by `sprint_new({})` or `sprint_resume({})`. Use `dashboard_info({})` to re-read it, `dashboard_restart({})` to refresh it, `overview({})` for compact orientation, and `next({})` for the active work window.
3. Create feature-sized subsprints with `subsprint_new({ description, goals, gates, dependencies })`.
4. Create atomic work with `item_add({ subsprint, title, description, code_locations, gates, gate_timeout_ms, dependencies, high_priority })`. `gate_timeout_ms` defaults to 5000; use a positive integer to customize it or `null` to disable it. If the work is too large, make more items; do not hide scope in notes.
5. Claim before changing code: `item_claim({ id })`. The connection remembers your identity and claim generation. No token or name is needed on ordinary calls; explicit tokens/generations remain available to advanced clients. Release claims when handing work back. Work against one owning item. Every `item_update` requires its item `id` and accepts only allowlisted fields. Use `item_update({ id, gates, gate_timeout_ms })` to revise executable gate settings on an open or completed item before close, or `item_update({ id, commit_id })` to correct a completed item's verified commit. New manual evidence cannot be added after completion. Structural fields stay immutable.
6. Resolve each item exactly once: `item_done({ id, commit_id, changelog })`, `item_split({ id, description, goals, gates, dependencies })`, or `item_deprecate({ id, reason })`. `item_deprecate` also accepts a subsprint id to drop a whole subsprint and its open items.
7. Use `search({ pattern, context_size:512 })`, `*_list`, and focused `*_get` tools when you need detail.
8. Optionally preview or export the current changelog with `changelog({ path? })`.
9. Close with `sprint_close({ coverage:{ path, format:"lcov", command }, force? })`; Sprinty rechecks gates using item-specific timeouts and writes the canonical changelog automatically. Use `force:true` only to record and bypass final executable-gate failures; it does not waive ledger or coverage requirements.

## Rules

- Never invent ids; read minted ids from tool results.
- Use explicit `git_dir`; `data_dir` defaults to `<git_dir>/.sprinty` when omitted. Never rely on MCP cwd.
- Keep responses compact. Prefer `next`, `overview`, `search`, and list/get pairs over full views. `next({})` returns all available high-priority items, then one normal available item per subsprint by default, prioritizing your existing claims over unclaimed work. A suggestion from `next` is not a claim: claim it atomically before editing, and choose another item if someone else already owns it.
- Notes must be bound to an item id. Work needs an item.
- Gates prove items. Sprinty runs each executable gate itself at `item_done` and records the real output, so do not pass `gate_results` for them; only `manual` gates take your evidence. A gate that cannot fail (`true`, `echo ok`) is rejected when you declare it.
- Item gates run under a 5s default budget. Set `gate_timeout_ms` to a positive integer to customize it or `null` to disable the timeout. A gate that overruns is killed and marked unverified: the item still completes, but nothing was proven.
- Every response carries `next_tools`, concrete calls derived from real state. Prefer them over guessing ids.
- `item_done` records each item's SemVer changelog verb and line; `changelog({ path? })` previews or exports Markdown from those entries.
- `sprint_close` is the final gate: it rejects open items, missing commits/item changelog entries/coverage, or failing executable gates, then writes the canonical changelog automatically. `force:true` bypasses only executable-gate failures and is recorded on the close event.
- Every subsprint must end resolved. A subsprint you created but never filled with items still counts as open work; give it items or drop it with `item_deprecate({ id: "S0n", reason })`.

## Concurrent agents and timing

`sprint_new` and `sprint_resume` return `agent: { id, name, token }`; `info` reports your generated adjective–animal identity. The connection remembers your identity automatically; ordinary calls need no name or token. Tokens are an advanced fallback for clients without automatic caller integration. Codex stdio agents normally have separate connections. The Claude plugin bundles a `PreToolUse` hook that supplies native session/subagent IDs, so shared-connection callers are also identified automatically. Update the installed plugin to get this hook; an MCP-only install does not include it. Other shared clients can use `agent_attach({})` and explicit `agent_token`. Without native caller integration, omitting it is allowed only with one attached agent. Never share tokens between agents or put them in notes/artifacts. `agent_detach` releases only your claims; it keeps the shared dashboard and other agents attached. Use `sprint_detach` only when you are the connection's sole agent.

Before editing an item, call `item_claim({ id, agent_token? })`. Then use the returned claim generation when appropriate: item mutation tools accept `claim_generation` as an explicit stale-write fence. Repeating your own claim is idempotent. `item_release({ id })` hands work back. Item edits, completion, splitting and deprecation require ownership; collaborative notes and artifacts remain available to other agents. A completed item's last owner may correct its recorded metadata and gates. Native caller mappings recover identity and claim generations after an MCP restart. Codex can supply `CODEX_THREAD_ID`, or a launcher can set `SPRINTY_SESSION_ID`; without a stable native ID, a new MCP process gets a new identity. For manual recovery, resume with your existing `agent_token`. Never invent native caller IDs in tool arguments.

For long tasks, call `agent_heartbeat({})` every four minutes while actively working and `item_progress({ id, message })` when meaningful progress occurs. Progress messages are trimmed and limited to 500 characters. Generic server uptime and dashboard polling do not count as agent activity. Repeated calls within one second coalesce their durable heartbeat, while mutations retain their own attributed timestamps.

Sprinty tracks claim age, historical ownership, estimated active work and owner inactivity separately. It flags a **potential stall** after either three other distinct items complete without item progress, or one hour without owner activity. Reads/heartbeats do not reset the three-item counter. Notes, item edits and related artifact updates do. No work is automatically reassigned: use `item_takeover({ id, explanation })` on a potentially stalled claim, with a nonempty explanation capped at 500 characters. History preserves both owners and the handover; old owners cannot continue writing. For a terminated or interrupted session, use `item_takeover({ id, explanation, recover_inactive: true })` once its owner is inactive (more than five minutes without activity). This explicit recovery does not require the one-hour/three-completion stall threshold and cannot override an active owner. Inactivity alone does not prove termination: confirm the session is interrupted in the explanation. Rejections report the observed inactivity, required threshold and completion count, or the exact active-owner condition blocking recovery.

ETA is one shared activity-aware estimate. It excludes queue age, counts at most five minutes after each observed activity event within claim intervals, and uses the latest 20 eligible completed items (minimum three). Legacy, split and deprecated items do not train it. The median estimates item effort; the 25th–75th percentile range is an estimate range, not a statistical confidence interval. Remaining working time is aggregate estimated effort; the finish range separately accounts for active agents, existing owners and dependencies. With no agents active in five minutes it shows `paused`; work owned by an inactive agent shows `awaiting_handover`. Both suppress calendar finish forecasts. Before sufficient samples it shows `learning`; resolved work shows `complete`.

A shared data directory supports concurrent local processes on one canonical worktree. Separate worktrees retain separate sprint bindings. Gate execution is asynchronous and runs outside the write lock; if state changes during verification, retry the tool rather than treating stale evidence as valid.
