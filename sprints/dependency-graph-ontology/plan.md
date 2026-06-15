# Dependency Graph Ontology Plan

## What and Why

Make Sprinty's work model match the desired ontology:

- Items are `open`, `completed`, `split`, or `deprecated`.
- `done()` is the only code-completion action and requires a changelog line.
- `split()` and `deprecate()` are terminal non-code outcomes with no changelog.
- Dependencies are first-class graph edges that can be attached at creation or
  added later through a `dependencies()` tool.
- `current()` shows the dependency graph so the agent can reason about blocked
  and unblocked work.

## Key Decisions

- Keep existing ledger event names for compatibility, but project item status
  directly from the terminal disposition.
- Keep `disposition` in the view temporarily as a compatibility alias while
  making `status` the authoritative state.
- Represent dependencies as IDs. The target can be any known sprint element.
- Reject invalid dependency edges at write time, including unknown endpoints,
  duplicate edges, self-edges, and cycle-forming edges.
- Add changelog only to completed items.

## Files

- `src/domain/events.ts`
- `src/domain/enums.ts`
- `src/domain/gates.ts`
- `src/domain/projection.ts`
- `src/tools/current.ts`
- `src/tools/register.ts`
- `src/tools/schemas.ts`
- `src/store/store.ts`
- tests and docs touched as needed

## Done Means

- Tests prove dependency edges can be created at add/subsprint time and later
  through `dependencies()`.
- `current()` returns graph nodes and edges.
- `done()` requires and returns a semver changelog line.
- `split` and `deprecate` produce terminal statuses without changelog.
- Full suite passes.
- The final gate includes an MCP E2E scenario that exercises dependency graph
  and changelog behavior.

## Testing Proof Matrix

- Unit/contract: projection/current/store tests.
- Functional: MCP e2e bookshop scenario exercises dependencies and changelog.
- Adversarial: invalid dependency ids, invalid targets, duplicate edges,
  self-edges, cycle attempts, and missing changelog rejected.
- E2E/VM or integration: MCP e2e suite must include this sprint's new graph
  and changelog behavior before release holds clear.
- Telemetry/observability: dependency graph and changelog visible in projection.
- Performance: not applicable.
