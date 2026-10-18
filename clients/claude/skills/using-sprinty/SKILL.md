---
name: using-sprinty
description: Use when calling any Sprinty MCP tool and you need the exact contract - tool names, required fields, field limits, id formats, compact response rules, restart recovery, or note/artifact/item semantics. Read this before guessing at arguments or when a Sprinty tool call was rejected.
---

# Using Sprinty

Prefer compact commands first. Lists are compact and say which `_get()` tool returns full detail. Mutating tools return acknowledgements plus `next_tools`, concrete follow-up calls derived from live state; do not expect or request full sprint dumps from mutations.

## Core Tools

| Tool | Input | Use |
|---|---|---|
| `info` | `{ git_dir?, data_dir?, workspace_dirs?[] }` | First-call orientation before binding. Returns startup workflow, resume/create help, dashboard state, and sprint rows with title, created time, and open/closed/blocked item counts. |
| `sprint_resume` | `{ git_dir, data_dir?, agent_token? }` | Rebind this MCP process to an existing sprint. Returns a bounded `briefing` (counts, current item, blocked ids, last resolved, recent notes), the `skills` to read, and the dashboard URL - use it instead of re-deriving state with overview+next. `data_dir` defaults to `<git_dir>/.sprinty`. Never call `sprint_new` as a resume trick. |
| `sprint_detach` | `{}` | Clear this process binding before resuming a different sprint; only the sole attached agent may detach the connection. |
| `sprint_new` | `{ goal, git_dir, data_dir?, context_notes?[], agent_token? }` | Start one sprint with explicit `git_dir`; `data_dir` defaults to `<git_dir>/.sprinty`. Returns the dashboard URL. |
| `overview` | `{}` | Compact sprint title/details/artifacts/subsprints/items. Use this to orient. |
| `next` | `{ past?=1, future?, future_per_subsprint?=1, include_high_priority?=true }` | Compact active work window. Prioritizes your claims, then unclaimed ready work; applies high-priority and per-subsprint window settings. Suggested work still needs an atomic claim. `future` caps the total returned across all subsprints. No full graph. |
| `search` | `{ pattern, context_size?=512 }` | Regex search. Returns `{ id, type, text, tool_call }`; use `tool_call` for full detail. |
| `dashboard_info` | `{}` | Current localhost dashboard URL and port, or `running:false` when stopped. |
| `dashboard_restart` | `{}` | Restart the dashboard server and return the new URL and port. |

## Agent and claim tools

Identity is automatic for one agent per MCP connection and for native caller integration. Claude plugin hooks supply native `client_session_id`/`client_agent_id`; these fields are client plumbing, not values the model should construct. Bound tools still accept `agent_token` as a fallback for other shared clients. Native identity credentials live in private files under the gitignored data directory; never commit that directory.

| Tool | Input | Use |
|---|---|---|
| `agent_list` | `{ offset?=0, limit?=20 }` | Paginated agent names, active/inactive/detached state, last activity and claim counts; no tokens. |
| `items_claimed` | `{ mine?=false, offset?=0, limit?=20 }` | Paginated current claims with owner, timing, progress and stall reasons. `mine:true` uses automatic caller identity. Maximum page size is 50. |
| `agent_attach` | `{ agent_token? }` | Attach a new identity or recover an existing one; returns its generated name and token. |
| `agent_detach` | `{ agent_token? }` | Release only this agent's claims and detach its identity. |
| `agent_heartbeat` | `{ agent_token? }` | Report owner activity without recording item progress. |
| `item_claim` | `{ id, force?, agent_token? }` | Atomically claim work; optional force is the explanation for overriding ownership immediately (1–500 characters). Retain the returned generation. |
| `item_release` | `{ id, agent_token?, claim_generation? }` | Release your current claim. |
| `item_takeover` | `{ id, explanation?, force?, agent_token? }` | Use explanation for potentially stalled work, or force as the explanation for an immediate override (1–500 characters). Retain the new generation. |
| `item_progress` | `{ id, message, agent_token?, claim_generation? }` | Record meaningful progress on your claim; message is nonempty and at most 500 characters. |

The connection remembers the current claim generation. Advanced clients can supply `claim_generation` as an explicit stale-owner fence. A result from `next` does not reserve work: if a claim fails because another agent owns it, select other ready work or wait. Do not retry edits using a former owner's generation. Subsprint deprecation is rejected if it would resolve another agent's claimed work.

## Work Tools

| Tool | Input | Use |
|---|---|---|
| `subsprint_new` | `{ description, goals[], gates[], dependencies?[] }` | Create a feature-sized unit. |
| `subsprint_list` | `{}` | Compact subsprint rows. Use `subsprint_get({ id })` for full detail. |
| `subsprint_get` | `{ id }` | Full subsprint detail and compact item rows. |
| `item_add` | `{ subsprint, title, description, code_locations[], gates[], gate_timeout_ms?, dependencies?[], high_priority? }` | Create an atomic item. `gate_timeout_ms` defaults to 5000; use a positive integer to customize it or `null` to disable the timeout. Title 3-80 chars, single line; description 20-800 chars; at least one `code_locations` entry; 1-3 gates. |
| `item_get` | `{ id }` | Full item detail. |
| `item_update` | `{ id, note?, title?, description?, high_priority?, gates?[], gate_timeout_ms?, commit_id?, dependencies?[] }` | Mutate allowlisted fields by item id. Open or completed items may revise executable gates/timeouts before close; `commit_id` corrects a completed item and recomputes its change map. New manual evidence cannot be added after completion. |
| `item_done` | `{ id, commit_id, changelog, gate_results?[] }` | Complete an item. Sprinty runs executable gates under the item's configured timeout and records their real output; pass `gate_results` only for `manual` gates. A timed-out gate is marked unverified and does not block the item. Commit must resolve. |
| `item_split` | `{ id, description, goals[], gates[], dependencies?[] }` | Resolve an oversized item by creating a new subsprint. |
| `item_deprecate` | `{ id, reason }` | Resolve an item as intentionally dropped. Also accepts a subsprint id: that deprecates the subsprint and cascades to its open items. |

## Notes And Artifacts

| Tool | Input | Use |
|---|---|---|
| `note_add` | `{ id, text }` | Attach a note to an item id only. Notes do not replace items. |
| `note_list` | `{ id }` | Compact notes for an item. Use `note_get({ id })` for full text. |
| `note_get` | `{ id }` | Full note detail. Note ids are random: `N` + 12 hex. Ledgers written earlier keep their `N001`-style ids. |
| `note_update` | `{ id, text }` | Replace note text by note id. |
| `artifact_add` | `{ title, path, description?, related_items?[] }` | Attach a durable sprint file/output. |
| `artifact_list` | `{}` | Compact artifact rows. Use `artifact_get({ id })` for full detail. |
| `artifact_get` | `{ id }` | Full artifact detail including description. |
| `artifact_update` | `{ id, title?, path?, description?, related_items?[] }` | Amend artifact metadata. |

## Close

`sprint_close({ coverage:{ path, format:"lcov", command? }, force? })` re-runs executable gates using each item's configured timeout and writes the canonical SemVer changelog with item entries, current commits, coverage, and change maps. `force:true` records the override and bypasses only executable-gate failures; unresolved work, missing commits/item changelog entries, and missing coverage still block close. Use `changelog({ path? })` only to preview or export that content before close. Use `sprint_archive({ reason })` only for recovery.

## Rules

- Always minimize tokens: use `next`, `overview`, `*_list`, `search`, then focused `*_get`.
- Public id inputs are always named `id`.
- Notes attach only to item ids. If the note describes work, create one or more `item_add` items.
- `high_priority` is a boolean, not a ranked priority model. `next({})` promotes all available high-priority items before the per-subsprint normal window unless `include_high_priority:false`.
- Dependencies are ids. `item_update({ id, dependencies:[...] })` replaces the item's dependency set and rejects unknown ids, duplicates, and cycles.
- Tool responses omit timestamps and empty fields; the append-only ledger keeps audit data.
- `next_tools` on every response names calls whose ids exist right now. Following it is cheaper and safer than constructing ids yourself.
- `item_get` reports `actual_code_locations` from the resolving commit, and `undeclared_code_locations` when the commit touched files the item never declared.

## Concurrent agents and timing

`sprint_new` and `sprint_resume` return `agent: { id, name, token }`; `info` reports your generated adjective–animal identity. The connection remembers your identity automatically; ordinary calls need no name or token. Tokens are an advanced fallback for clients without automatic caller integration. Codex stdio agents normally have separate connections. The Claude plugin bundles a `PreToolUse` hook that supplies native session/subagent IDs, so shared-connection callers are also identified automatically. Update the installed plugin to get this hook; an MCP-only install does not include it. Other shared clients can use `agent_attach({})` and explicit `agent_token`. Without native caller integration, omitting it is allowed only with one attached agent. Never share tokens between agents or put them in notes/artifacts. `agent_detach` releases only your claims; it keeps the shared dashboard and other agents attached. Use `sprint_detach` only when you are the connection's sole agent.

Before editing an item, call `item_claim({ id, agent_token? })`. Then use the returned claim generation when appropriate: item mutation tools accept `claim_generation` as an explicit stale-write fence. Repeating your own claim is idempotent. `item_release({ id })` hands work back. Item edits, completion, splitting and deprecation require ownership; collaborative notes and artifacts remain available to other agents. A completed item's last owner may correct its recorded metadata and gates. Native caller mappings recover identity and claim generations after an MCP restart. Codex can supply `CODEX_THREAD_ID`, or a launcher can set `SPRINTY_SESSION_ID`; without a stable native ID, a new MCP process gets a new identity. For manual recovery, resume with your existing `agent_token`. Never invent native caller IDs in tool arguments.

For long tasks, call `agent_heartbeat({})` every four minutes while actively working and `item_progress({ id, message })` when meaningful progress occurs. Progress messages are trimmed and limited to 500 characters. Generic server uptime and dashboard polling do not count as agent activity. Repeated calls within one second coalesce their durable heartbeat, while mutations retain their own attributed timestamps.

Sprinty tracks claim age, historical ownership, estimated active work and owner inactivity separately. It flags a **potential stall** after either three other distinct items complete without item progress, or one hour without owner activity. Reads/heartbeats do not reset the three-item counter. Notes, item edits and related artifact updates do. No work is automatically reassigned: use `item_takeover({ id, explanation })` on a potentially stalled claim, with a nonempty explanation capped at 500 characters. History preserves both owners and the handover; old owners cannot continue writing. For an interrupted session or any explicit reassignment, use `item_claim({ id, force: "Previous session terminated; continuing its work" })`. `force` is the explanation (trimmed, 1–500 characters), not a boolean. It overrides ownership immediately without an inactivity or stall requirement; Sprinty does not infer that an owner is defunct. `item_takeover({ id, force: "Reason for reassignment" })` supports the same override. Both record the explanation and fence the previous owner. Ordinary claims retain exclusive ownership, and ordinary takeovers still require a potential stall. Rejections explain the unmet conditions and show the force option.

ETA is one shared activity-aware estimate. It excludes queue age, counts at most five minutes after each observed activity event within claim intervals, and uses the latest 20 eligible completed items (minimum three). Legacy, split and deprecated items do not train it. The median estimates item effort; the 25th–75th percentile range is an estimate range, not a statistical confidence interval. Remaining working time is aggregate estimated effort; the finish range separately accounts for active agents, existing owners and dependencies. With no agents active in five minutes it shows `paused`; work owned by an inactive agent shows `awaiting_handover`. Both suppress calendar finish forecasts. Before sufficient samples it shows `learning`; resolved work shows `complete`.

A shared data directory supports concurrent local processes on one canonical worktree. Separate worktrees retain separate sprint bindings. Gate execution is asynchronous and runs outside the write lock; if state changes during verification, retry the tool rather than treating stale evidence as valid.
