# Changelog Change Map Coverage Plan

## What and Why

Add a native sprint analysis layer:

- `changelog()` returns release-readable Markdown.
- The Markdown includes change-map tables, not only bullet changelog lines.
- Change maps are computed from completed item commits with Git numstat.
- Item, subsprint, and sprint views expose file/directory/language hotspots.
- `sprint_close()` requires submitted code coverage evidence.

## Key Decisions

- Start with Git file stats only. No `sem` dependency in core.
- Attribute each changed file to the completed Sprinty item whose commit touched it.
- Aggregate by item, subsprint, sprint, directory, and language.
- Coverage evidence is submitted at close time as `{ path, format:"lcov", command? }`.
- Store only the parsed coverage summary in the immutable `sprint_closed` event.

## Files

- `src/git/git.ts`
- `src/domain/change-map.ts`
- `src/domain/changelog.ts`
- `src/domain/events.ts`
- `src/domain/projection.ts`
- `src/tools/schemas.ts`
- `src/tools/register.ts`
- `src/store/store.ts`
- `vitest.config.ts`
- MCP, store, projection, and changelog tests
- README/skills/client instructions

## Done Means

- Completed items expose change maps derived from their commit ids.
- Subsprints and sprint expose aggregated change maps and hotspots.
- `changelog()` returns Markdown with semver changelog sections and change-map tables.
- `sprint_close()` rejects missing coverage and stores supplied coverage on close.
- MCP E2E covers changelog Markdown tables, change-map attribution, and coverage-required close.
- Full suite passes.

## Testing Proof Matrix

- Unit/contract: Git numstat parser, change-map aggregation, changelog Markdown renderer, projection coverage.
- Functional: store/tool tests for changelog and close coverage.
- Adversarial: close rejects missing/invalid coverage; missing commits do not create bogus change-map rows.
- E2E/VM or integration: MCP bookshop/focused scenario exercises changelog table and coverage-required close.
- Telemetry/observability: projection/dashboard state exposes coverage and change maps.
- Performance: not applicable for first pass; Git stats are per completed item commit.
