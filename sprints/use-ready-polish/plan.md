# Use-Ready Polish Plan

## What and Why

Make Sprinty safe and understandable enough to start using in real coding sessions.
The current engine is promising, but it needs stronger proof invariants, clearer
human-facing docs, a usable dashboard, and a less ambiguous Codex/plugin story.

## Key Decisions and Trade-offs

- Keep the MCP API small and compatible where possible.
- Preserve append-only ledger behavior while adding richer projection metadata.
- Treat user-supplied gate evidence as audit data, but verify all executable gates
  again at close.
- Improve the dashboard without introducing a frontend build step.
- Clarify plugin packaging honestly rather than implying npm installs all client
  plugins if it does not.

## Files to Modify

- `src/domain/events.ts`
- `src/domain/projection.ts`
- `src/store/store.ts`
- `src/gates/run.ts`
- `src/dashboard/page.ts`
- `src/dashboard/server.ts`
- relevant tests under `src/**`
- `README.md`
- `skills/*.md`
- `clients/codex/*`
- `package.json` if packaging scope changes

## Dependencies and Ordering

1. Add tests for gate result matching, timestamps, close-time commit checks, and
   gate timeout behavior.
2. Implement the minimal domain/store/gate changes to pass.
3. Add dashboard tests for safe rendering and human-useful state.
4. Replace debug dashboard markup with safe DOM rendering and timeline sections.
5. Rewrite README/plugin docs for human install and dashboard usage.
6. Run focused tests, then full test suite.

## Done Means

- `done()` refuses missing, extra, or mismatched gate results.
- Sprint close re-checks commit existence for completed items.
- Sprint projections expose created/updated/closed timestamps for timeline use.
- Gate execution cannot hang indefinitely.
- Dashboard safely renders user-controlled text and shows a useful sprint timeline.
- README explains how a human opens the dashboard and how Codex installs Sprinty.
- Tests cover the new behavior and pass.

## Testing Proof Matrix

- Unit/contract: store, projection, gate runner, dashboard HTML.
- Functional: full MCP e2e still closes a valid sprint.
- Adversarial: missing/mismatched gates, fake commits at close, timeout gate,
  script-like dashboard text.
- E2E/VM or integration: MCP e2e test suite.
- Telemetry/observability: timeline timestamps are exposed in projection/state.
- Performance: gate timeout prevents unbounded hangs.

