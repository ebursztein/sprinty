# Changelog Change Map Coverage

## Status

| Area | Status | Notes |
|---|---|---|
| Change map | Complete | Git numstat, file/directory/language aggregation, hotspots |
| Changelog Markdown | Complete | Semver sections plus coverage and change-map tables |
| Coverage close gate | Complete | `sprint_close()` requires LCOV path for completed code items |
| Verification | Complete | Focused tests, full suite, and Sprinty's own coverage run passed |

## Key Verification Commands

- `npm test -- src/git/git.test.ts src/domain/change-map.test.ts src/domain/changelog.test.ts src/store/store.test.ts src/server.e2e.test.ts`
- `npm test`
- `npm run test:coverage`

## Release Holds

- Cleared for this iteration: changelog Markdown table, change-map aggregation, coverage-required
  close, MCP E2E, full suite, and Sprinty's generated LCOV parsing passed on 2026-06-14.
