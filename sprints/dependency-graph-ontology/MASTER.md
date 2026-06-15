# Dependency Graph Ontology

## Status

| Area | Status | Notes |
|---|---|---|
| Item ontology | Complete | Terminal statuses are authoritative; `disposition` remains a compatibility alias |
| Dependencies | Complete | Graph is maintained in projection/current/dashboard with topological order and cycle detection |
| Changelog | Complete | `done()` requires semver-style `{ verb, line }`; split/deprecate do not carry changelog |
| Verification | Complete | Focused tests and full MCP E2E final gate pass |

## Key Verification Commands

- `npm test -- src/domain/projection.test.ts src/tools/current.test.ts src/store/store.test.ts src/server.e2e.test.ts`
- `npm test`

## Release Holds

- Cleared for this iteration: focused tests, MCP E2E graph/changelog scenario,
  adversarial dependency edge coverage, and full suite passed on 2026-06-14.
