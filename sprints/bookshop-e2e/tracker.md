# Sprint: bookshop-e2e

## Tasks

- [x] Add bookshop MCP e2e test -- covers `sprint_new`, `subsprint_new`, `add`, `update`, `note`, `split`, `current`, `done`, `deprecate`, `search`, `dashboard`, and `sprint_close`
- [x] Focused e2e verification -- `npm test -- src/server.e2e.test.ts` passed
- [x] Full verification gate -- `npm test` passed with 57 tests

## Notes

- Discovery: existing e2e helper can connect a fresh temp git repo per scenario.
- Verification: `git diff --check` passed.

## Coverage Ledger

- Unit/contract: not applicable, test-only addition
- Functional: bookshop sprint creates, amends, notes, splits, adds follow-up items, completes, deprecates, searches, opens dashboard state, and closes
- Adversarial: manual gate evidence required and supplied for declared item gate
- E2E/VM or integration: focused MCP e2e and full suite passed
- Telemetry/observability: dashboard `/state` asserts timestamped timeline and commit id
- Performance: not applicable
- Missing/deferred: pending
