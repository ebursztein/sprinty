# Use-Ready Polish

## Status

| Area | Status | Notes |
|---|---|---|
| Proof invariants | Complete | Gate result matching, close-time commit verification |
| Timeline | Complete | Event timestamps exposed in projected state |
| Dashboard | Complete | Safe DOM rendering and human-readable live view |
| Docs/plugin story | Complete | README and Codex package clarity |
| Verification | Complete | Focused tests, full suite, package dry run, production audit, browser check |

## Key Verification Commands

- `npm test -- src/store/store.test.ts src/domain/projection.test.ts src/gates/run.test.ts src/dashboard/server.test.ts`
- `npm test`

## Release Holds

- Release holds cleared by focused verification, full suite, package dry run, production audit, browser check, and docs/package alignment.
