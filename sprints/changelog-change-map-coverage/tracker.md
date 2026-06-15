# Sprint: changelog-change-map-coverage

## Tasks

- [x] Add failing tests for Git change maps, Markdown changelog tables, and close coverage evidence -- focused tests failed before implementation
- [x] Implement native Git change-map collection and aggregation -- `done()` stores Git numstat; projection aggregates item/subsprint/sprint maps
- [x] Add `changelog()` tool and Markdown table rendering -- semver sections, coverage table, sprint/subsprint file tables
- [x] Require/store coverage evidence in `sprint_close()` -- close requires LCOV path for completed code items and stores parsed summary
- [x] Update docs/client instructions/dashboard where useful -- README, skills, client instructions, server instructions, dashboard hotspots/coverage
- [x] Focused verification -- targeted test set passed
- [x] Full verification with MCP E2E final gate -- `npm test` and `npm run test:coverage` passed

## Notes

- Discovery: Vitest coverage default produced JSON/HTML but not LCOV; added the `lcov` reporter so
  Sprinty's own `npm run test:coverage` produces `coverage/lcov.info`.
- Changed approach: coverage submission stores only a parsed summary in the ledger; callers pass a
  report path instead of raw coverage text.
- Parsed Sprinty's generated `coverage/lcov.info` through the built parser:
  lines 988/1049 (94.18%), branches 309/359 (86.07%), functions 77/78 (98.72%).

## Coverage Ledger

- Unit/contract: `src/git/git.test.ts`, `src/domain/coverage.test.ts`,
  `src/domain/change-map.test.ts`, `src/domain/changelog.test.ts`,
  `src/domain/projection.test.ts`
- Functional: `src/store/store.test.ts`, `src/tools/register.test.ts`
- Adversarial: close rejects missing coverage and missing report path; legacy resolved events without
  change maps project as empty maps
- E2E/VM or integration: `src/server.e2e.test.ts` covers `changelog()`, close coverage path, and
  dashboard state; `npm run test:coverage` generated Sprinty's own LCOV report
- Telemetry/observability: sprint view and dashboard expose coverage and hotspots; changelog Markdown
  includes coverage and file change-map tables
- Performance: not applicable
- Missing/deferred: semantic entity-level analysis with `sem`
