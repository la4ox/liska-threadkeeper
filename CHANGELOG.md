# Changelog

This changelog records Liska releases. For history before the fork, see the
[upstream releases](https://github.com/sho7650/obsidian-AI-exporter/releases)
and [upstream changelog](https://github.com/sho7650/obsidian-AI-exporter/blob/main/CHANGELOG.md).
Liska preserves the applicable attribution and license notices in
[NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## [Unreleased]

### Changed

- Stage 1: simplified CI, Pages, and Release Please automation; added a
  cross-platform production ZIP command.
- Stage 2: removed unsupported live-browser, Nix/direnv, and repository-local
  automation tooling from the maintained surface.
- Stage 3: pruned inherited historical plans, investigations, design records,
  obsolete ADRs, and the upstream-generated changelog; aligned English and
  Japanese runtime/public copy; retained documentation now describes Liska's
  supported offline checks and manual smoke-test boundary.

## [3.0.0] - 2026-08-12

First Liska release.

### Added

- DeepSeek export reads the active conversation branch through its same-origin
  history response without page scrolling, with a safe DOM fallback for the
  selected thread.

### Changed

- Rebranded the independent fork as Liska — AI Threadkeeper.
- Hardened local-first export boundaries: user-initiated outputs, loopback-only
  Obsidian access, and no analytics, telemetry, or Liska-operated service.
