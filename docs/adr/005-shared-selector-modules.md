# ADR-005: Shared selector modules as the extractor SSOT

## Status

Accepted — current selector single source of truth (reaffirmed 2026-08-12).

## Context

Each supported provider changes its DOM independently. Extractors need selector
sets that remain readable, typed, and reviewable without copying them across
production files. The maintained test surface is offline: static fixtures and
unit tests exercise extractor behaviour; a selector-specific test may import a
pure selector module where useful.

There is no maintained live Playwright browser contract, authenticated-session
workflow, or external-site validation suite. Provider changes are checked with
offline regression fixtures and a deliberate manual smoke test when extractor
code changes (ADR-030).

## Decision

Keep each provider's selector definitions in
`src/content/extractors/selectors/`. Extractors import their own module, so
there is one authoritative definition for each selector set. The modules are
pure constants and types, allowing focused offline tests to import them without
loading browser-only extractor dependencies.

Derived selector strings remain beside their inputs:

- Gemini owns `COMPUTED_SELECTORS` with its source selector groups.
- Claude owns `JOINED_SELECTORS` with its source selector groups.
- `index.ts` re-exports the public selector groups for focused tooling and
  tests; it does not create a second definition.

The current modules cover Gemini, Claude, ChatGPT, Perplexity, Gemini Notebook,
and DeepSeek. New providers add their selector module alongside the extractor.

## Consequences

- Selector changes have one production source and are reviewed with the
  extractor that consumes them.
- Static fixtures provide repeatable regression evidence without saved provider
  sessions or network-dependent tests.
- A manual live smoke test remains a release-quality check for changed
  extractors, not a CI gate or a promise of live DOM coverage.
