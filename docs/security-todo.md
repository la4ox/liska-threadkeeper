# Security follow-up plan

This plan keeps repository-wide Security Cloud work separate from provider
feature development. Findings remain open until their exact current revision is
reconciled with source and verification evidence.

## Current checkpoint

The first fix wave covered six statically confirmed findings:

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

Source finding IDs:

- `commit:d3839e26cc30819189dbd819859edc61`
- `commit:c77d0507779481918bb27c30dcd55e41`
- `commit:f7a03865197c81919bfb7c0ffb3957e3`
- `commit:4aba4e52d3f8819182681100d1fe1368`
- `commit:2387521a87f48191a526e99985492f83`
- `commit:6c0253bdf58c8191bd85f1e507823ec0`

Verification at this checkpoint: 150 test files / 4,029 tests; 95.17%
statements, 90.73% branches, 98.42% functions, and 97.78% lines; production
build, formatting, platform registry lint, and source lint pass with only the
same three pre-existing advisory warnings. Independent review found and closed
escaped-backtick, fenced-container, and Markdown character-reference bypasses.

## Remaining finding triage

Review the remaining Security Cloud findings against the current pull-request
head, preserving one verdict per finding:

1. Markdown/frontmatter boundaries: YAML quoting, headings, math attributes,
   tool metadata, citation URLs/titles, and raw DeepSeek Markdown.
2. Resource bounds: branch fan-out, nested Canmore JSON, image response
   buffering/timeouts, and frontmatter parsing.
3. Storage and Obsidian boundaries: stale append paths, API-key migration and
   disclosure, and response-body error handling.
4. Supply-chain and repository hygiene: mutable CI actions and live fixture
   URLs.

Prioritize confirmed reachable medium/low findings. Treat informational items
as evidence-backed hardening, not automatic defects. Do not close, merge, or
silence a cloud finding merely because a nearby path changed.

## Upstream delta audit

Fetch the latest `sho7650/obsidian-AI-exporter` `main` and compare it with the
fork without merging wholesale.

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

1. Push the verified fix commits to the existing pull request.
2. Let CI and the PR security review evaluate the new head.
3. Re-list Security Cloud findings and classify fixed, current, duplicate, or
   hardening-only items by exact source path and observed revision.
4. Close a finding only after the corresponding current-head invariant and
   verification evidence are explicit.
5. Perform the upstream delta audit before returning to untouched provider
   feature work.

## Exit criteria

- no open medium finding remains confirmed on the current head;
- every remaining low/informational item has a source-backed verdict and owner
  or deliberate deferral;
- upstream changes in untouched provider/shared blocks have been reviewed;
- full tests, coverage, build, lint, formatting, and one independent review are
  green after the final security patch set.
