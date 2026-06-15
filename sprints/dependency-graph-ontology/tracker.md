# Sprint: dependency-graph-ontology

## Tasks

- [x] Add failing tests for terminal statuses, changelog, and dependency graph -- projection/store/E2E coverage added; duplicate existing edge test failed before the validator fix
- [x] Implement ontology and dependency events -- item statuses are `open`, `completed`, `split`, `deprecated`; `dependencies_added` events maintain graph edges
- [x] Wire MCP schemas/tools -- `context_notes`, creation-time dependencies, `dependencies()`, and required `done().changelog`
- [x] Update docs and dashboard wording -- README, skills, client instructions, dashboard fallback/rendering
- [x] Focused verification -- `npm test -- src/store/store.test.ts`; `npm test -- src/server.e2e.test.ts`
- [x] Full verification with MCP E2E final gate -- `npm test`

## Notes

- Discovery: current projection used `status: resolved` plus `disposition`.
  Desired model is terminal statuses directly.
- Added proper graph validation at write time: unknown target, unknown
  dependency, self-edge, duplicate input edge, duplicate existing edge, and
  cycles are rejected before ledger append.
- `current()` and dashboard state expose graph nodes, edges, blocked_by,
  unblocks, topological_order, and cycles.
- The E2E bookshop sprint now exercises context notes, notes, updates, split,
  dependencies, changelog, search, dashboard state, deprecate, and close.

## Coverage Ledger

- Unit/contract: `src/domain/graph.test.ts`, `src/domain/projection.test.ts`,
  `src/domain/enums.test.ts`, `src/domain/events.test.ts`,
  `src/tools/current.test.ts`, `src/store/store.test.ts`
- Functional: `src/tools/register.test.ts`; bookshop MCP scenario in
  `src/server.e2e.test.ts`
- Adversarial: store and MCP tests cover unknown endpoints, self-edge,
  duplicate dependencies, duplicate existing edges, cycle attempts, missing
  changelog, and gate evidence mismatch
- E2E/VM or integration: `src/server.e2e.test.ts` includes the final MCP gate
  for dependency graph and changelog behavior
- Telemetry/observability: projection/dashboard state expose graph and
  changelog data; timeline includes dependency and resolution events
- Performance: not applicable
- Missing/deferred: followup tools and generated `changelog()` helper are a
  separate slice
