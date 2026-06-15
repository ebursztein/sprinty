# Sprint: use-ready-polish

## Tasks

- [x] Gate and commit proof invariants -- focused store tests pass
- [x] Timeline timestamps in projections -- focused projection tests pass
- [x] Gate timeout behavior -- focused gate runner tests pass
- [x] Safe, usable dashboard -- dashboard shell test passes and no ledger text uses raw HTML
- [x] README and Codex/plugin docs -- README, skills, Codex, Gemini, and package files updated
- [x] Focused verification -- focused store/projection/gate/dashboard tests pass
- [x] Full verification gate -- full suite, package dry run, and production audit pass

## Notes

- Discovery: current tests pass, but `done()` accepts unrelated passing gate
  results and manual gates can be bypassed.
- Discovery: dashboard uses `innerHTML` with ledger-controlled text.
- Discovery: published npm package currently includes only `dist` and `skills`,
  while README says native plugins ship for each agent.
- Changed approach: include `clients/` in npm package and point Codex plugin skills at the shared
  top-level `skills/` directory.
- Verification: dashboard checked in the in-app browser at desktop and mobile widths.
- Verification: `npm audit --omit=dev --json` reports zero production vulnerabilities.

## Coverage Ledger

- Unit/contract: store, projection, and gate runner focused tests pass
- Functional: full MCP e2e suite passes
- Adversarial: missing/extra gate evidence, fake close-time commit, and timeout covered
- E2E/VM or integration: MCP e2e, npm package dry run, production audit, and browser dashboard verification pass
- Telemetry/observability: event timestamps projected into sprint timeline
- Performance: gate timeout covered
- Missing/deferred: no automated pixel-diff visual regression; browser screenshots were manually inspected
