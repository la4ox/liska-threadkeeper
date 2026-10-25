# Liska documentation

## Public documentation

- [Project overview and installation](../README.md)
- [Privacy policy](privacy.html)
- [License](../LICENSE) and [upstream attribution](../NOTICE.md)

## Maintainers

- [Maintenance and release guide](maintaining.md)
- [Build reproducibility guide](build-reproducibility.md)
- [Fitness-function assessment](fitness-functions-assessment.md)
- [Changelog](../CHANGELOG.md)

## Active implementation plans

- [ChatGPT follow-up plan](chatgpt-todo.md)
- [Security follow-up and upstream delta plan](security-todo.md)
- [Upstream 2.14.9 delta audit](upstream-2.14.9-audit.md)
- [Upstream 2.14.15 delta audit](upstream-2.14.15-audit.md)

## Chrome Web Store

- [Dashboard listing source](store/listing.md)
- [English description](store/description_en.md)
- [Japanese description](store/description_ja.md)

## Retained architecture decisions

- [ADR-002](adr/002-gemini-auto-scroll.md), [ADR-003](adr/003-markdown-module-split.md), [ADR-004](adr/004-obsidian-url-input.md), [ADR-005](adr/005-shared-selector-modules.md), [ADR-008](adr/008-image-sync-strategy.md)
- [ADR-012](adr/012-fitness-functions.md), [ADR-013](adr/013-build-reproducibility-comparison.md), [ADR-014](adr/014-platform-registry-ssot.md), [ADR-015](adr/015-entry-shim-coverage.md)
- [ADR-017](adr/017-autoscroll-virtualized-platforms.md), [ADR-018](adr/018-progress-aware-scroll-deadline.md), [ADR-019](adr/019-coverage-measurement-scope.md), [ADR-020](adr/020-vault-path-segment-encoding.md)
- [ADR-021](adr/021-remote-image-fetch-in-service-worker.md), [ADR-022](adr/022-anchor-insertion-window-merge.md), [ADR-023](adr/023-multi-host-platform-registry.md), [ADR-024](adr/024-scroll-progress-includes-movement.md)
- [ADR-025](adr/025-note-identity-probe-and-fork-diagnostics.md), [ADR-026](adr/026-line-ending-handling.md), [ADR-027](adr/027-generated-image-capture-from-rendered-element.md), [ADR-028](adr/028-message-count-survives-callout-flattening.md), [ADR-029](adr/029-maintainer-controlled-automation.md), [ADR-030](adr/030-supported-maintainer-tooling.md)
- [ADR-031](adr/031-loss-aware-archive-pipeline.md): raw capture, canonical conversation graph, and derived presentations/destinations
- [ADR-032](adr/032-staged-large-chatgpt-capture.md): chunked OPFS transport for raw/canonical ChatGPT artifacts above inline limits
- [ADR-033](adr/033-trusted-append-message-boundaries.md): extension-owned message identity for safe append
- [ADR-034](adr/034-citation-footnote-provenance.md): capability-bound citations and safe Markdown destinations
- [ADR-035](adr/035-provider-markdown-rendering-safety.md): structural provider-Markdown policy and receipt-proven local links
- [ADR-036](adr/036-canonical-html-presentation.md): pure canonical-derived HTML and destination-owned asset bindings
- [ADR-037](adr/037-chatgpt-official-export-import.md): exact single-conversation import from an official ChatGPT export
- [ADR-038](adr/038-chatgpt-cross-format-reconciliation.md): compare-only web-vs-official canonical reconciliation
- [ADR-039](adr/039-chatgpt-reconciliation-delivery.md): explicit local official-vs-web reconciliation and immutable File ZIP delivery
- [ADR-040](adr/040-chatgpt-reconciliation-obsidian.md): atomic create-only Obsidian reconciliation snapshots with root-last readback
- [ADR-042](adr/042-final-reading-markdown-boundary.md): final Deep Research and append-context isolation for derived Markdown
- [ADR-043](adr/043-snapshot-analysis-only.md): exact-byte snapshot analysis with no mutation authority
