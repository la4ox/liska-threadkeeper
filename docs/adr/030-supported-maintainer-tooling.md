# ADR-030: Keep Maintainer Tooling Small and Supported

## Status

Accepted (2026-08-12).

## Context

The fork inherited three maintainer-specific systems that were outside the
shipped extension:

- a live Playwright/CDP harness that persisted reusable AI sessions, exposed an
  authenticated Chrome profile through a loopback DevTools port, and was not
  exercised by CI;
- a Nix/direnv task mirror for macOS and Linux that duplicated npm scripts and
  did not support the maintainer's Windows environment;
- Claude-specific autonomous skills and configuration, including stale product
  and release assumptions.

The live harness also made the default Vitest command platform-dependent even
though the extension's offline fixtures and snapshots already provide stable,
reviewable extractor regression coverage.

## Decision

- Remove the top-level live `e2e/` harness and its Playwright, dotenv, and tsx
  dependencies.
- Keep `test/extractors/e2e/`: despite its historical name, it is an offline
  Vitest fixture/snapshot suite with no saved login state or live browser.
- Remove the Nix/direnv task mirror and declare Node 24 directly in
  `package.json` and CI.
- Remove repository-local Claude automation. Maintainer and release guidance
  lives in tool-neutral tracked documentation.
- Keep the architecture tests and platform/document consistency checks.

## Consequences

- `npm run test:coverage` is the same maintained suite on Windows and CI.
- The repository no longer contains tooling that asks maintainers to persist
  third-party session cookies or run a long-lived authenticated CDP endpoint.
- Live provider validation remains a deliberate manual smoke test using the
  installed extension; a future automated browser harness must have an explicit
  security model, cross-platform owner, and CI or documented maintainer value.
- The removal is complete: retained documentation describes the supported
  offline suite and manual smoke-test boundary, not the removed live harness.
