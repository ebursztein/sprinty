# Bookshop E2E Plan

## What and Why

Add an end-to-end MCP test that models a realistic bookshop sprint. This gives
Sprinty a human-readable scenario that proves sprint creation, item completion,
dashboard visibility, timestamps, real commit ids, and close gates work together.

## Files to Modify

- `src/server.e2e.test.ts`

## Done Means

- The E2E test starts a bookshop sprint through MCP.
- It creates a subsprint and an item with executable and manual gates.
- It completes the item with a real commit id and matching gate evidence.
- It checks the dashboard URL and `/state` projection.
- It closes the sprint successfully.

## Testing Proof Matrix

- E2E/VM or integration: targeted `src/server.e2e.test.ts`.
- Functional: full suite.
- Adversarial: manual gate evidence must be present because the item declares it.
- Telemetry/observability: timestamped timeline is asserted via dashboard state.

