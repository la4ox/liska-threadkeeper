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
as evidence for the historical revision. The complete source fix merged through
PR 25 as `650d8c9`: rejected math uses context-stable entity literals,
formatting-only inline wraps normalize without changing TeX, `%` comment line
endings are preserved by display promotion, table neighbors cannot capture
generated literals, and image-placeholder processing cannot span math
delimiters. Current-head CI and code review were clean; the separate GitHub
Security Review did not execute because its quota was exhausted.

The nested-Canmore occurrence `commit:8fc721c0bb0881919910f4805e72250d`
remains open for later Cloud reconciliation, but its source fix merged through
PR 26 as `915e367`. A single-part JSON-looking payload is scanned without
materializing an object graph before `JSON.parse`: 4 MiB of source text, 64
nested containers, and 4,096 structural tokens are explicit parse ceilings.
They deliberately exceed the canonical sanitizer's existing 16-level/512-entry
budgets so ordinary truncate-and-succeed behavior remains compatible. Exceeded
budgets fail with one fixed code; the current capture path retains exact raw and
manifest evidence and creates no canonical companion. Current-head CI and Code
Review were clean; the unavailable Security Review was deliberately deferred.

The page-prototype occurrence `commit:0fb1786e6cf08191a25da26b5593adfc`
remains open for later Cloud reconciliation, but its source fix merged through
PR 27 as `cf733f1`. The implementation
captures native TypedArray buffer/length getters at document start, removes
species-sensitive `subarray` and `ArrayBuffer.slice`, copies digest input through
captured internal-slot operations, Base64-encodes indexed bytes directly, and
returns byte views across async boundaries only inside a null-prototype envelope.
Late getters, constructor/species hooks, and `Uint8Array.prototype.then` no
longer observe or mutate closure-owned response bytes. Current-head CI and Code
Review were clean; Security Review completed clean on the pre-batching security
head, and the reviewed batching-only follow-up had no unresolved finding.

The question-heading occurrence `commit:3a431a24ce6c81919819b0c524645220`
is fixed through PR 28 as `f53fd6d`. The shared heading
serializer now runs only after whitespace normalization, Markdown-character
stripping, and visible-length truncation, then converts backslashes and ASCII
angle brackets to numeric entities. Direct tags, code-wrapped tags,
stripping-synthesized tags, and odd/even backslash runs therefore remain literal
heading text without altering the established 60-character visible limit.
The overlapping earlier occurrence `commit:b5198215444c81919473f54504506272`
and the backtick-specific occurrence are both closed as fixed in Security
Cloud against that same merged boundary.

The tool-metadata occurrence `commit:1a0101353b0c819183fb067d15974853`
is fixed through PR 29 as `f58758f` and closed in Security Cloud. The shared presentation
boundary promotes only a punctuation-encoded title and places the complete
tool/search body inside a collision-safe literal fence. Markdown links and
images, raw HTML, Obsidian embeds/callouts, and forged message labels therefore
remain evidence instead of active note syntax. Claude tool HTML is converted to
readable Markdown while preserving exact pre/code whitespace, replacement-token
text, marker collisions, and adjacent block boundaries. Its whole-response
fallback now removes status headers from a clone before sanitization, so the
disabled tool-content setting cannot leak those headers through ordinary
assistant content.

The late GitHub Security Review of PR 29 separately confirmed an availability
defect in Claude tool conversion: collision discovery and marker restoration
rescanned the complete fragment once per code block. The dedicated follow-up
replaces that path with one conversion-local capability and one restoration
pass, while an operation-local budget spans ordinary extraction or every
auto-scroll window before deduplication. Byte, markup, section, code, metadata,
DOM, ancestor/line, ordered-list, table, and Markdown ceilings fail the whole
extraction visibly rather than silently dropping evidence. Follow-up review also
closed non-code expansion through quotes/math attributes, nested table selector
fan-out, repeated favicon rows, ordered-list indexing, and disconnected nested
KaTeX candidates. Resolve the historical PR 29 thread only after the follow-up
is present on the merged current head.

The append-boundary occurrence `commit:65c64c5574f08191871348273e586bf6`
is fixed through PR 30 as `7ff531f` and closed in Security Cloud. New ordinary
conversation bodies carry one exact format sentinel and one exact sentinel per
complete message group. Provider/tool content reserves those spellings, while
image stripping/resolution preserves only existing service lines and
neutralizes newly composed marker substrings. V1 tails therefore keep tool
evidence and question headers without trusting visible role labels. Legacy
notes recover from a valid extension-generated `message_count`; an unmarked
count-less note fails explicitly without overwrite rather than guessing or
reporting a false no-op. ADR-033 records the compatibility and migration
contract.

The citation-title occurrence `commit:cb0e9bb83f88819181f8a884fdf468a9`
and Research-URL occurrence `commit:1972e53d5bbc81918ded9e6b8bd3b4d7`
are fixed through PR 31 as `76f1254`. Citation
placeholders now require a per-isolated-world capability plus strict generated
label grammar in normal and table consumers; marker-like provider DOM remains
visible but literal. NotebookLM fallback labels must be numeric. One shared
HTTP(S) serializer canonicalizes source URLs and percent-encodes Markdown
destination backslashes/parentheses without double encoding. ADR-034 records
the provenance, compatibility, and URL contract.

The raw-DeepSeek-Markdown occurrence
`commit:4aa52b95bddc819189aa49cfe8ef0559` is repaired on
`codex/security-deepseek-markdown`. Provider Markdown now uses a structural
CommonMark AST before the derived reading export. Remote images, unsafe/private
destinations, reference definitions, and Obsidian links/embeds become visible
literal text without changing raw/canonical evidence. Code, footnotes, math,
ordinary public links, multiline labels, and list containers remain intact.
ChatGPT local archive links require exact destinations carried from the already
verified destination receipt; a provider-authored lookalike is inert. ADR-035
records this boundary.

Current follow-up validation: 151 test files / 4,082 tests; 95.14% statements,
90.68% branches, 98.43% functions, and 97.65% lines; production build and ZIP
reconciliation, formatting, platform-registry lint and source lint pass with
only the same three pre-existing advisory warnings. A dated fresh `npm audit`
reports zero known vulnerabilities.

Math-slice validation: 166 test files / 5,039 tests pass with one bounded
worker; the focused Markdown/sanitizer/image/E2E matrix passes 362 tests.
Production build, formatting, diff checks, and source/platform lint pass with
the same three pre-existing advisory warnings. Independent parser-backed review
found no remaining P0-P3 issue. Live Obsidian rendering is still an explicit
unverified surface; the review used the installed Marked parser.

Canmore-slice validation: 166 test files / 5,057 tests and the focused
normalizer/capture/staging matrix of 202 tests pass. Production build and
source/platform lint pass with only the same three pre-existing warnings. The
independent review found one P3 numeric-scalar compatibility regression; it is
fixed and covered. Browser/OPFS destination persistence was not repeated; its
staged lifecycle remains mocked plus covered by the existing persistence tests.

TypedArray-slice validation: 166 test files / 5,069 tests and the focused
capture/resolver matrix of 22 files / 758 tests pass. Production build,
formatting, diff checks, and source/platform lint pass with the same three
pre-existing warnings. Independent review found an additional async
`Uint8Array.prototype.then` assimilation route; it is fixed and covered. The
first GitHub Code Review then found that direct Base64 concatenation built one
multi-million-node rope for a 16 MiB inline payload; encoding now flushes bounded
4,096-triplet blocks. A live browser MAIN-world capture was not repeated for
this slice.

Question-heading slice validation: all 166 test files / 5,075 tests pass in six
memory-bounded batches; the focused formatter/Markdown/append/count matrix
passes 4 files / 279 tests. Independent review found no P0-P3 issue and ran a
separate four-file / 301-test pass plus 78 parser probes without an HTML node.
Production build and source/platform lint pass with only the same three
pre-existing warnings. Actual Obsidian rendering was not repeated; the reviewer
used the installed Markdown parser.

Tool-content slice validation: all 166 test files / 5,086 tests pass in six
memory-bounded batches. The independent final review ran seven focused suites /
431 tests plus runtime probes for active Markdown/HTML, forged labels,
line-ending variants, callout flattening, marker collisions, replacement tokens,
and code-block boundaries; it found no remaining P0-P3 issue. Production build,
repository formatting, diff checks, and source/platform lint pass with only the
same three pre-existing advisory warnings. A live Claude page and the actual
Obsidian renderer were not repeated for this slice.

Claude tool-resource follow-up validation: all 170 test files / 5,201 tests pass
in six memory-bounded batches. Focused conversion, extractor, Markdown-safety,
and sanitizer coverage passes 5 files / 233 tests; an independent final pass
reran 192 Claude/sanitizer tests and found no remaining P0-P3 issue. Production
build, targeted formatting, diff checks, source/platform lint, and `npm audit`
pass with the same three pre-existing warnings and zero known vulnerabilities.
No real Chrome/Claude timing smoke was repeated.

Append-boundary slice validation: all 167 test files / 5,103 tests pass in six
memory-bounded batches. Focused source-to-sink and integration coverage includes
the historical forged-label no-op, marker reservation, legacy recovery,
count-less v1 notes, LF/CRLF, question headers, tool evidence, annotations,
image strip/File/Obsidian transformations, callout flattening, and explicit
multi-output refusal without overwrite. Independent review found three P2/P3
seams—the generated frontmatter separator, post-image marker composition, and
legacy heading lookback—and rechecked their fixes with 240 round-trip scenarios
plus 26 probes; no P0-P3 remains. Production build, formatting, diff checks, and
source/platform lint pass with only the same three pre-existing warnings. A
live browser/Obsidian append was not repeated.

Citation-boundary slice validation: all 168 test files / 5,112 tests pass in
six memory-bounded batches. Focused coverage includes forged refs/definitions,
guessed and cross-realm tokens, ordinary/table consumers, malformed NotebookLM
labels, Gemini/Claude Research destinations, Perplexity compatibility, unsafe
scheme fallback, existing percent escapes, and literal backslashes in URL
query/fragment text. Independent review passed 284 citation tests plus 37
targeted Research checks and a final 176-test rerun; CommonMark probes produced
one link and zero injected images, with no P0-P3 remaining. Production build,
formatting, diff checks, and source/platform lint pass with only the same three
pre-existing warnings. Live provider sharing and Obsidian rendering were not
repeated.

Provider-Markdown slice validation: all 169 test files / 5,160 tests pass in
memory-bounded batches. Focused coverage includes the historical DeepSeek
assistant/reasoning payload, structured user records, inline/reference images,
multiline labels, list-contained definitions/fences, indented and multiline
code, entity/backslash destination decoding, private IPv4/IPv6/local names,
malformed outer syntax, exact ChatGPT receipt provenance, and long escape runs.
The first independent review found seven concrete parser/provenance/performance
seams; the candidate was replaced with the structural parser and each reproducer
is now covered. Two GitHub Code Review passes then found nested image
descriptions, single-token and active-body Obsidian footnotes, cross-message
image references and fence state, assistant math, and newly exposed unsafe-link
titles; all seven are covered and fixed. Production build and source/platform
lint pass with only the same three pre-existing warnings; `npm audit` reports
zero known vulnerabilities. Actual Obsidian rendering was not repeated.

Per the maintainer's explicit checkpoint decision, an unavailable per-PR
GitHub Security Review does not block an intermediate merge when current-head
CI, current-head Code Review, focused/full tests, and one independent local
security review are clean. Do not automatically retry or spend security-review
credits. After the current large roadmap block is complete, launch one explicit
Cloud Security repository scan and reconcile its full-repository findings.

## Remaining finding triage

Review the remaining Security Cloud findings against the current pull-request
head, preserving one verdict per finding:

1. Markdown/frontmatter boundaries: reconcile the provider-Markdown fix after
   merge. YAML, math, question-heading, tool-content, append, and citation
   occurrences are fixed; resolve the historical Claude tool-conversion review
   thread only after its bounded single-pass follow-up is on current `main`.
2. Resource bounds: branch fan-out, image response buffering/timeouts, and
   frontmatter parsing; reconcile the merged Canmore fix.
3. Capture integrity: reconcile the merged TypedArray primordial fix and retain
   its late-prototype regressions.
4. Storage and Obsidian boundaries: stale append paths, remaining credential
   disclosure paths, and response-body error handling.
5. Supply-chain and repository hygiene: mutable CI actions and live fixture
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
