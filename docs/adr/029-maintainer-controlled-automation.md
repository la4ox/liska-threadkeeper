# ADR-029: Maintainer-Controlled Repository Automation

## Status

Accepted (2026-08-12).

## Context

The fork inherited separate workflows for CI, Release Please, and GitHub Pages.
In Liska, the Pages workflow had no site entry point and failed because Pages
was not enabled. Release Please also failed because GitHub Actions was not
allowed to create pull requests, and its history-based version calculation did
not understand the fork's independent `3.0.0` baseline.

The release ZIP command additionally depended on Unix shell syntax and a
separately installed `zip` command, so it could not be run from the maintainer's
Windows environment.

## Decision

- Keep one least-privilege GitHub Actions workflow with the protected job name
  `ci`.
- Make CI validate linting, formatting, coverage, and the production ZIP.
- Build ZIPs through a checked-in cross-platform Node script that validates the
  package and Chrome manifest versions before archiving a filtered `dist/` tree.
- Create releases explicitly from a tested commit, following
  `docs/maintaining.md`.
- Do not deploy GitHub Pages until Liska has an intentional public site.
- Treat conventional commits as a human-readable convention, not a Husky or CI
  gate.

## Consequences

- No workflow has permission to create pull requests, publish a site, or release
  code.
- Release publication remains an explicit maintainer responsibility, including
  the smoke test and tag target.
- Windows, macOS, Linux, and CI share one packaging implementation and one
  exclusion rule.
- Automated changelog/version pull requests can be reconsidered later if their
  maintenance value becomes greater than their permissions and complexity.
