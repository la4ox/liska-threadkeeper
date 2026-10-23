# Security follow-up plan

This plan keeps repository-wide Security Cloud work separate from provider
feature development. Findings remain open until their exact current revision is
reconciled with source and verification evidence.

## Current checkpoint

The first fix wave covered eight statically confirmed findings:

- collision-safe code fences and literal citation titles across ChatGPT DOM,
  Perplexity, NotebookLM, and Deep Research;
- linear, bounded ChatGPT sandbox-link parsing with one per-invocation evidence
  index;
- indexed canonical asset source-reference merging;
- linear parent/child membership checks in shared and ChatGPT graph validation;
- a 20,000-node DeepSeek normalization ceiling applied after verified raw
  companion creation;
- DeepSeek signed-path redaction across punctuation, encoded query keys, and
  Markdown character-reference spellings.
- fail-safe ChatGPT attachment inventory: provider-shaped role/MIME/filename
  metadata cannot silently turn an unproven PNG into a policy-declined asset or
  falsely complete the ledger;
- YAML-safe frontmatter strings: leading mapping/sequence indicators and
  non-printable characters cannot corrupt provider-controlled titles or tags.

Source finding IDs:

- `commit:d3839e26cc30819189dbd819859edc61`
- `commit:c77d0507779481918bb27c30dcd55e41`
- `commit:f7a03865197c81919bfb7c0ffb3957e3`
- `commit:4aba4e52d3f8819182681100d1fe1368`
- `commit:2387521a87f48191a526e99985492f83`
- `commit:6c0253bdf58c8191bd85f1e507823ec0`
- `commit:7f599e3e531481918b44b12cc641daed`
- `commit:142acce52d248191bd0780a27b396930`

Pull request 11 merged as `6e9098a`. Continuous scans completed successfully
for its newly reachable commits; the security-fix commits `1509bfc` and
`e676428` and final source-head commit `493df81` returned zero new findings.
These scans are diff-scoped, not a repository-wide proof. Historical occurrence
rows remain separate records until explicitly reconciled and closed.

The first six findings above are closed as fixed in Security Cloud. The seventh
and eighth are fixed and independently reviewed on the current local branch,
but remain open in Cloud until this branch is published; local evidence must not
be presented as a remotely reachable fix. A separate stale-sync API-key race
finding, `commit:41c1f05321f48191b8bbc9bf9e9ffb91`, is also closed: published
commit `ccf9a56` serializes migration/settings mutations, fresh-reads sync after
local verification, and has a deterministic interleaving regression test.

The math-attribute occurrence
`commit:eb1705ab69ac8191a043d3d6cb44fe4c` is administratively marked fixed in
Security Cloud, but that status was applied before the saved fix-check's active
Markdown fallback was actually repaired. Treat the Cloud row as premature, not
as evidence. The complete source fix is staged on
`codex/security-math-markdown`: rejected math uses context-stable entity
literals, formatting-only inline wraps normalize without changing TeX, `%`
comment line endings are preserved by display promotion, table neighbors cannot
capture generated literals, and image-placeholder processing cannot span math
delimiters. It is not a published remediation until its reviewed pull request is
merged.

Current follow-up validation: 151 test files / 4,082 tests; 95.14% statements,
90.68% branches, 98.43% functions, and 97.65% lines; production build and ZIP
reconciliation, formatting, platform-registry lint and source lint pass with
only the same three pre-existing advisory warnings. A dated fresh `npm audit`
reports zero known vulnerabilities.

Math-slice validation: 166 test files / 5,037 tests pass with one bounded
worker; the focused Markdown/sanitizer/image/E2E matrix passes 360 tests.
Production build, formatting, diff checks, and source/platform lint pass with
the same three pre-existing advisory warnings. Independent parser-backed review
found no remaining P0-P3 issue. Live Obsidian rendering is still an explicit
unverified surface; the review used the installed Marked parser.

## Remaining finding triage

Review the remaining Security Cloud findings against the current pull-request
head, preserving one verdict per finding:

1. Markdown/frontmatter boundaries: YAML quoting, headings, math attributes,
   tool metadata, citation URLs/titles, and raw DeepSeek Markdown.
2. Resource bounds: branch fan-out, nested Canmore JSON, image response
   buffering/timeouts, and frontmatter parsing.
3. Storage and Obsidian boundaries: stale append paths, remaining credential
   disclosure paths, and response-body error handling.
4. Supply-chain and repository hygiene: mutable CI actions and live fixture
   URLs.

Prioritize confirmed reachable medium/low findings. Treat informational items
as evidence-backed hardening, not automatic defects. Do not close, merge, or
silence a cloud finding merely because a nearby path changed.

## Upstream delta audit

The first source audit is complete in
[`upstream-2.14.9-audit.md`](upstream-2.14.9-audit.md). It compares upstream
`v2.7.13` through `v2.14.9` without merging wholesale.

- Inspect provider blocks that Liska has changed least: Perplexity,
  Gemini/NotebookLM, Claude, common Markdown conversion, storage/Obsidian, UI,
  and CI.
- Map upstream fixes to the current Liska architecture before porting them;
  preserve raw-first archives, explicit branch selection, destination honesty,
  immutable snapshots, and the no-credential-export boundary.
- Prefer small source-backed ports with focused regressions over a broad merge.
- Record useful upstream changes that are already superseded or incompatible,
  so they are not repeatedly reconsidered.

## Reconciliation sequence

1. Re-list historical Security Cloud findings and classify fixed, current,
   duplicate, or hardening-only items against the zero-finding final scan.
2. Close a finding only after the corresponding current-head invariant and
   verification evidence are explicit.
3. Continue the evidence-gated ports recorded in the completed upstream audit.
4. Send each later provider/security slice through its own focused pull request
   and final-main continuous scan.

## Exit criteria

- no open medium finding remains confirmed on the current head;
- every remaining low/informational item has a source-backed verdict and owner
  or deliberate deferral;
- upstream changes in untouched provider/shared blocks have been reviewed;
- full tests, coverage, build, lint, formatting, and one independent review are
  green after the final security patch set.
