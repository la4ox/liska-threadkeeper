# Security follow-up plan

This plan keeps repository-wide Security Cloud work separate from provider
feature development. Findings remain open until their exact current revision is
reconciled with source and verification evidence.

## Repository-scan reconciliation — 2026-11-03

Current source baseline: `main` at
`707fbaa34b3c5e29a4151968ed4922c2e8fd76b8` (PR 106). Repository workflow
`wfr_2fb83850c5a62f2fe37cc2e9027a22fd468892181394444e89a66e64426dfc66`
completed against that exact revision with partial coverage and three medium
findings. A completed scan is evidence for those three occurrences, not proof
that every repository surface was exhausted.

The earlier ten-finding repository workflow
`wfr_c294dc0cd6f299d087315e0f99ec41d66f098d39a4abf0dfdf55e9fca9aab721`
still exposes all occurrences as `New`. Current Security Cloud detail pages show
only a read-only status badge and `Fix with Codex`; the list action menu exposes
only CSV export. The connector close operation accepts commit-scan findings
with `commit_detail.id` and `version`, which these repository-scan occurrences
do not provide. Therefore Cloud administration remains unavailable: do not
launch duplicate source fixes or claim that the rows were remotely closed.

Current-main reconciliation of the older scan is source-backed as follows:

- nine categories are remediated by merged PRs 92, 96, 97, 99, 102, 103, 104,
  105 and 106;
- the default-port occurrence remains an intentional exact-loopback
  compatibility policy, hardened by PR 101's unauthenticated/authenticated
  Local REST API identity preflight. It is not honestly `Fixed`; use accepted
  risk or not actionable if a future administrative surface offers that state.

The newer scan's three findings remain distinct:

1. **Claude/DeepSeek aggregate provider work** — branch
   `codex/provider-block-work-budget-v2` has a reviewed local candidate. Every
   public preflight, inventory and normalizer path now fails closed with a typed
   provider-content limit. Per-artifact bytes are capped at 32 MiB; each
   traversal admits at most 250,000 visited occurrences and 250,000 emitted
   blocks; one operation shares 2,000,000 auxiliary work units through capture
   and up to two DeepSeek destination rebuilds. Malformed/nonasset entries,
   empty FILE fragments, nested metadata, sanitization and repeated attachment
   handling consume the budget before filtering or copying. Existing graph,
   asset and honest DOM-partial fallback semantics remain separate.
2. **Obsidian loopback service identity** — PR 101 detects accidental unrelated
   services but does not cryptographically authenticate the process or remove
   the narrow inter-request race. Treat stronger pairing, certificate or native
   process identity as a separate product/trust-boundary decision.
3. **Provider-controlled Obsidian code-block processors** — execution depends on
   installed third-party render plugins such as Dataview. Research prevalence,
   vault policy and safe reading/export representation separately; do not fold
   a speculative plugin redesign into the provider-budget patch.

The provider-budget candidate passes its 16-file, 685-test affected matrix,
TypeScript/Vite/runtime build, formatting, lint with warning-only repository
notices and diff checks. Independent review reproduced a 19,999-message capture
plus two destination reconstructions at 1,139,952 shared work units, retained
the accepted 16-level metadata boundary, and found no concrete bypass or
regression. The first published-head Code Review then found one evidence-lifetime
P2: a limit reached during normalization was rethrown after the verified raw and
manifest pair existed, but the outer DOM fallback could recover companions only
from provider structured-capture errors. A content-layer WeakMap sidecar now
binds that already-verified pair to the exact typed limit error without wrapping,
serializing or extending its lifetime. Early preflight/inventory limits remain
companion-free; late limits retain the pair through successful or failed DOM
fallback and staged navigation cleanup. The follow-up's four provider suites
pass 113 tests and the production build, formatting and diff checks pass.
Browser and durable destination-write acceptance remain unclaimed; current-head
CI/reviews are still required before source closure.

## Current-main security roadmap — 2026-11-02

Baseline: `main` at `2ac32ec58af29742ac4646440ed64582a9d84c67`.
This checkpoint supersedes older candidate/status wording below without
rewriting the historical evidence. Merged source remediation, Security Cloud
administration, adopted product direction, installed-runtime acceptance and a
new repository scan are separate states.

### Merged since the repository scan

- [PR 92](https://github.com/la4ox/liska-threadkeeper/pull/92), merge
  `d34c8b2`: bounded streamed Obsidian text, binary and directory reads;
  authenticated reads reject redirects and exact archive/staged readbacks keep
  their size, hash and timeout diagnostics.
- [PR 95](https://github.com/la4ox/liska-threadkeeper/pull/95), merge
  `09dbb18`: documentation-only adoption of the extension-owned export popup in
  [ITH-009](idea-threads/ITH-009-extension-owned-export-popup.md). It did not
  move runtime export authority out of provider-page DOM.
- [PR 96](https://github.com/la4ox/liska-threadkeeper/pull/96), merge
  `dd240ab`: ordinary images use immutable full-SHA identities; Obsidian uses
  create-only persistence plus exact readback, and File confirms retained image
  paths before dispatching Markdown.
- [PR 97](https://github.com/la4ox/liska-threadkeeper/pull/97), merge
  `29cd48e`: ChatGPT and DeepSeek privacy-diagnostic membership is linear while
  preserving ordered output, provider-specific keys, sanitation side effects
  and archive bytes.
- [PR 99](https://github.com/la4ox/liska-threadkeeper/pull/99), merge
  `ef26fca`: opaque replay crosses MAIN through a bounded primitive wire and
  rejects post-arming Promise poisoning. PR 98 was the earlier review vehicle
  for the same source line and is not a second remediation.
- [PR 101](https://github.com/la4ox/liska-threadkeeper/pull/101), merge
  `f035a80`: the adopted Obsidian identity hardening now performs a bounded
  unauthenticated Local REST API root preflight before bearer use, then requires
  an authenticated response from the same service/version contract.
- [PR 102](https://github.com/la4ox/liska-threadkeeper/pull/102), merge
  `5527545`: DeepSeek structured capture, fallback and durable evidence remain
  bound to one exact conversation identity across navigation and await seams.
- [PR 103](https://github.com/la4ox/liska-threadkeeper/pull/103), merge
  `34fe11a`: nested ChatGPT content normalization is iterative, budgeted and
  typed-failure aware instead of consuming the JavaScript call stack.
- [PR 104](https://github.com/la4ox/liska-threadkeeper/pull/104), merge
  `ad2c693`: Markdown and image processing use bounded aggregate work,
  indexed protected ranges and streaming placeholder scans before final size
  admission.
- [PR 105](https://github.com/la4ox/liska-threadkeeper/pull/105), merge
  `2ac32ec`: build-comparison ZIP acquisition, inventory, extraction and hashing
  are pinned, streamed and bounded with rejected-tree cleanup.

All ten merge commits are ancestors of this baseline. Their presence on
`main` does not by itself close a repository-scan occurrence or prove an
installed browser/vault path. Do not launch duplicate fixes merely because an
administrative Cloud row remains open.

### Product and archive decisions to preserve

#### Extension-owned export UI

- The candidate popup has two tabs: `Export` first and `Settings` second. Frequent
  situational choices belong beside the explicit Export actions; persistent
  preferences stay in Settings.
- The page fox is a warm, launch-only affordance (the separate default-visibility preference remains deferred). It may open the extension
  surface but never selects a branch, authorizes capture or starts persistence.
- Feature-detect `chrome.action.openPopup()` on newer Chromium. Older or
  unsupported browsers retain the browser-toolbar popup; a compact
  extension-owned window is the fallback when programmatic opening is absent or rejected. Do not force a browser upgrade and
  do not fall back to direct page-DOM export.
- Do not use a warning that users must read, Shadow DOM alone or a full-height
  side panel as the authorization boundary.
- The candidate worker controller binds a one-shot 30-second intent to a fresh
  operation generation, exact tab/top-frame/document/route, and immutable
  effective settings and destinations. Operations expire after two hours.
  Explicit generations accompany content messages; preparation cannot commit
  any of the six durable output families. Stage ownership survives worker
  restart in bounded extension-private session metadata; missing/corrupt state
  fails closed. Cancellation permits only exact owned-stage cleanup.
- Deterministic controller, real-worker dispatch, content lifecycle and popup
  tests cover replay, wrong owners, settings/output drift, phase, restart,
  expiry, ABA, branch selection, close/cancel and fallback identity. The
  launch-only redress substitute finds no page export/branch/Stop action nodes.
  A synthetic browser preview checks the 380px popup and Settings. These are
  not an installed-provider or old-Chromium live receipt; keep those gates open
  before claiming deployed closure of `csf_5072816416f2eab1f2507059`.

#### Snapshot and image identity

- Provider filename, provider reference, capture event and local retained path
  are different facts. Raw/canonical evidence keeps provider metadata; a
  manifest maps it to exact destination paths, lengths and SHA-256 digests.
- SHA-256 identifies exact stored bytes only. Capture time and source identity
  remain provenance even when two events contain byte-identical images.
- Never rename an existing asset to `.old`/`.backup`, silently replace it, or
  repair an uncertain write by deleting it. Changed bytes receive another
  immutable path; verified identical bytes may be reused where the destination
  can actually read and hash them.
- Keep repeated full snapshots append-only. Cross-snapshot destructive
  deduplication remains a separate explicit product under ITH-006, not an
  automatic side effect of export.
- The broader File snapshot layout remains future work: one unique
  capture-scoped directory containing Markdown, raw, manifest, canonical and
  assets. Persist bounded raw evidence and confirmed assets before publishing
  Markdown; write a completion manifest last. Its absence means incomplete,
  not a falsely complete archive.
- Chrome `conflictAction: 'uniquify'` can change a retained name. PR 96 binds
  links to browser-reported terminal path/state/existence evidence, but a real
  collision canary remains required. Downloads history is not filesystem byte
  readback or a permanence guarantee.

#### Deep nested content

- Replace recursive canonical traversal with an iterative explicit stack. Do
  not rely on tail-call optimization, recursive generators or silent
  truncation.
- Initial implementation targets are design ceilings, not shipped promises:
  64 MiB raw acquisition, 32 MiB canonical and Markdown output, depth 2,048,
  250,000 visited occurrences and 1,000,000 work units. Yield/cancel around
  every 2,048 work units or approximately 8 ms; wall-clock time is a watchdog,
  not the primary deterministic acceptance rule.
- On exhaustion, report a typed limit and counters, preserve already admitted
  raw bytes, discard/quarantine partial canonical output, publish no ordinary
  complete snapshot and create no completion manifest. Measure these ceilings
  against the largest real fixtures and exact limit/limit+1 cases before
  adopting them in source.

#### Obsidian destination policy

- Exact loopback, canonical full origin, no URL credentials, no unexpected
  redirects, worker-owned bearer use, safe vault-path segments, bounded
  responses and configuration invalidation are security invariants. A high port
  number alone does not authenticate the local process.
- Decision 2026-11-02: keep intentional default-port compatibility; the scanner
  item is not actionable merely from port number. Settings/UI and background
  validation admit only exact loopback `127.0.0.1`, http/https, no URL
  credentials and no redirects; provider pages and chat text cannot save
  `obsidianUrl`. Add a stronger separate hardening boundary instead: perform a
  bounded unauthenticated `GET /` with no bearer, require exact Local REST API
  `status`, `service`, version shape and `authenticated: false`, and only then
  send the key. The authenticated root response must confirm the same service
  and versions with `authenticated: true`; every mismatch fails closed. This
  catches accidental unrelated loopback services but does not claim
  cryptographic process identity or eliminate the narrow inter-request race.

### Repository-scan categories at current main

The ten-finding scan at `389e310` now has current-main source or policy
boundaries for nine categories: bounded Obsidian reads, ordinary-image
collisions, privacy-diagnostic quadratic work, opaque replay provenance,
default-port policy plus identity preflight, DeepSeek navigation identity,
iterative nested ChatGPT content, Markdown/image work admission and bounded
build-comparison ZIP handling. PRs 102–105 deliberately remained separate,
reviewable slices; their merge ancestry does not itself update Security Cloud.

**Provider-DOM trusted-control redress** is the only scanned source category not
yet on `main`. The candidate below implements ITH-009 without restoring page
authority for old-browser convenience. Keep it as its own PR and reconcile the
exact occurrence only after current-head CI/reviews and merge ancestry.

The adopted Obsidian unauthenticated identity preflight is already merged in PR 101. It preserves intentional `80`/`443` compatibility, sends no bearer on probe
failure, strictly validates both bounded root responses and retains stable
authentication/throttle diagnostics. It is separate hardening, not permission
to relabel the scanner's default-port policy verdict as an exploit fix.

### Pending live gates and final reconciliation

- PR 92: disposable Local REST API compatibility for ordinary text/list/binary
  reads; unit streams already cover exact caps, overflow and redirects.
- PR 96: real Chrome `uniquify` collision plus disposable Obsidian same-bytes,
  different-bytes and create-only conflict behavior. Verify the installed Local
  REST API version and binary conditional-write handler.
- PR 99: installed Chromium MAIN-world transfer and ordinary timeout-fallback
  capture, preserving inline/staged limits, document pinning, cleanup and fixed
  error codes.
- ChatGPT phase exit: one natural, unpadded provider response above 16 MiB must
  traverse staged replay into both durable destinations with exact hashes,
  chunk facts, cleanup and worker-restart evidence. Keep the 64 MiB raw ceiling;
  canonical size or synthetic padding is not provider-ingress proof.

Each source slice needs focused regressions, the relevant full checks, one
independent candidate review, current-head CI/review and merge ancestry. Do not
retry unavailable per-PR Security Review or spend credits automatically. After
this roadmap block, run one explicit findings-only repository scan against a
frozen then-current `main` and reconcile every occurrence with source and
runtime evidence. No new scan, Cloud closure or installed-runtime proof is
claimed by this document update.

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

The 2026-10-25 current-main reconciliation closed three additional historical
occurrences with explicit merged ancestry and static invariant evidence:
`commit:0fb1786e6cf08191a25da26b5593adfc` (TypedArray capture integrity),
`commit:16702a6e90648191ba8a63da60539e95` (unbounded branch fan-out), and
`commit:8fc721c0bb0881919910f4805e72250d` (nested Canmore JSON). No new Cloud scan
was launched; the existing occurrence records advanced from version 7/new to
version 8/fixed.

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
is closed as fixed after current-main reconciliation. Its source fix merged
through PR 26 as `915e367`. A single-part JSON-looking payload is scanned without
materializing an object graph before `JSON.parse`: 4 MiB of source text, 64
nested containers, and 4,096 structural tokens are explicit parse ceilings.
They deliberately exceed the canonical sanitizer's existing 16-level/512-entry
budgets so ordinary truncate-and-succeed behavior remains compatible. Exceeded
budgets fail with one fixed code; the current capture path retains exact raw and
manifest evidence and creates no canonical companion. Current-head CI and Code
Review were clean; the unavailable Security Review was deliberately deferred.

The page-prototype occurrence `commit:0fb1786e6cf08191a25da26b5593adfc`
is closed as fixed after current-main reconciliation. Its source fix merged
through PR 27 as `cf733f1`. The implementation
captures native TypedArray buffer/length getters at document start, removes
species-sensitive `subarray` and `ArrayBuffer.slice`, copies digest input through
captured internal-slot operations, Base64-encodes indexed bytes directly, and
returns byte views across async boundaries only inside a null-prototype envelope.
Late getters, constructor/species hooks, and `Uint8Array.prototype.then` no
longer observe or mutate closure-owned response bytes. Current-head CI and Code
Review were clean; Security Review completed clean on the pre-batching security
head, and the reviewed batching-only follow-up had no unresolved finding.

The branch-fan-out occurrence `commit:16702a6e90648191ba8a63da60539e95`
is likewise closed as fixed. The merged wide-branch stack caps nodes, leaves,
path visits, source work, planned writes, per-note bytes, per-destination logical
bytes, physical planned bytes, and HTML render work; safe-integer overflow fails
closed. Prepared parent paths avoid per-leaf full-catalog rescans, while one
AbortSignal-backed Stop path reaches measurement, branch writes, indexes, and
HTML finalization. The live 239-leaf capture remains positive evidence for the
bounded catalog, not authority to raise the separate 1 GiB source-work ceiling.

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

The upstream DES-019 audit promoted two later reading-surface seams from
hypotheses to reproduced local gaps. Complete Deep Research Markdown bypassed
the active-resource policy after References were appended, while an existing
open HTML/comment/fence context could reinterpret or hide a separately safe
append tail. Branch `codex/persistence-seam-evidence` applies the existing
policy to the complete Deep Research body and adds a separate refusal-only,
bounded append-context gate. Only the new tail is transformed; the old body is
never sanitized, and any crossing context, hidden owned marker, cross-seam
CommonMark reference, parser failure, or budget failure stops without a write
or overwrite fallback. ADR-042 records the fixed-code and compatibility
boundary. Obsidian-specific plugin/footnote semantics, a final serialized-file
cap, and preflight before binary image writes remain explicit later decisions.

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

PR 46 merged the runtime-boundary candidate as `4070b1d` without starting
another scan. Append hints are now
keyed by normalized endpoint, exact vault template, stable search root,
provider, and conversation id; the current direct path wins, and a memo path is
admitted only when its parent matches the exact template with date tokens kept
as bounded rollover variables. This covers endpoint/scope changes, sibling
prefixes, leading-date templates, and inline forms such as
`AI/{platform}-{YYYY}` without storing or logging the API key.

The Gemini CDN worker now rejects an oversized declared length early and also
counts the actual streamed response bytes, cancelling at the existing 10 MiB
ceiling regardless of absent, invalid, or falsely small headers. The existing
five-second AbortController remains armed through body reads; bodyless,
unsupported-MIME, unsuccessful, stalled, and cancellation-failure paths return
stable local failures without an unbounded `blob()`/`arrayBuffer()` fallback.
`commit:72ec616ef89c81918fae119209a1107b`,
`commit:43efe06fa6b08191b8bfe3ce69fa19be`, and the overlapping timeout occurrence
`commit:621515f4ee488191a93dd9a3c856df77` are now closed as fixed against that
reviewed merged head.
The separate `codex/gemini-image-redirect-boundary` candidate adds exact
`lh3.google.com` permission/CSP as a final-response-only host. Source and final
URLs reject userinfo, nondefault ports, non-HTTPS schemes, and look-alikes. One
authenticated/no-referrer/no-store fetch follows browser-managed redirects;
the final URL is checked and a rejected body cancelled before status/MIME/read.
Network/final-URL failures are fixed local strings, without raw exception/URL
leakage, retry, or anonymous/authenticated fallback. The single deadline and
streamed cap remain. Prior live/retained evidence records anonymous 403 responses
and session-dependent links. Fetch may send eligible browser-managed cookies to
the permitted CDN/redirect hosts, but Liska never reads or serializes
cookie/request-header values or exposes them to the model, content script, or
durable output. URL presence is reference evidence, not byte availability;
stale/failed links never become fetched claims.

Intermediate redirect hops are not observable or validated per-hop; final-host
acceptance is not a full egress proof. Packaged permission expansion may require
re-consent. The pre-change installed Gemini canary twice failed one detected
generated image, with byte-identical File/Obsidian notes and no false link.
The exact post-change build is now live-verified on that same image: File and
Obsidian retained byte-identical 236,990-byte JPEGs (1024 by 559), matching
SHA-256 and one correct local link per note. Checked durable outputs contain no
remote-host, signed-path, cookie, authorization, or request-header residue.
Intermediate-hop inspection, packaged permission re-consent and real
cancellation behavior remain live gates; image decompression and persistence
are proven for this one sample.

The two honest pre-fix notes nevertheless retained no durable warning about the
missing image. PR 66 closes that gap with versioned allowlisted historical codes
for explicit partial history loading and failed identified-image capture. It
carries no count, URL, filename, exception, response, header, provider text, or
arbitrary warning string. Background validation is accessor-safe; append unions
codes without rewriting body bytes, permits an idempotent same-count
metadata-only update, and rejects shorter or malformed evidence. Destination
image-write failures, intentional Clipboard omission, derived HTML, and
current-completeness remain outside schema 1. The exact installed Gemini canary
persisted `image-capture-failed`, retained the real JPEG, and contained no
`g2o-image://`, `blob:`, canary ID, neutralized opener, or false local link.

The first frozen local diff scan `e30f6c9e-9417-4599-9904-a74d6386d220`
reported no security findings and preserved two below-bar correctness
candidates: mixed-EOL body rewriting and escaped owned-key duplication. Both
were fixed, and a second final-code review found no reportable security
candidate. Subsequent review generalized the owned-key boundary: exact
frontmatter delimiters are shared with append, and every noncanonical literal,
escaped, tagged, anchored, explicit, flow, or folded owned-key mention now fails
closed. GitHub exact-head Code Review and Security Review remain the merge gates
because that final parser hardening followed the second local frozen snapshot.

PR 47 merged the five remaining informational fixes as `47c944b`:

- Obsidian text, binary, and directory response bodies share the initial
  fetch's stable network-error translation. Append refuses every uncertain read
  or operation instead of treating it as absence and starting a fresh write.
- Frontmatter list accumulation is linear without changing parser semantics.
- The captured Gemini fixture carries an inert synthetic avatar; a narrow
  fixture-wide guard rejects live Google account-avatar URLs, and both fixture
  guides require account/profile identifiers to be replaced before commit.
- The Store draft declares Authentication information `Yes` for the locally
  stored Obsidian API key while retaining the local-only/no-sync/no-third-party
  disclosure.
- CI pins checkout v7 and setup-node v7 to the exact immutable SHAs returned by
  their official tag refs, keeps its read-only token and Node 24 behavior, and
  disables checkout credential persistence.

This checkpoint does not rewrite public Git history, submit the Store dashboard,
or claim a live interrupted Obsidian response. Exact-head CI, Code Review, and
Security Review completed clean; fetched `main` contains the reviewed head, and
the five corresponding Cloud records were then closed.

## Security Cloud reconciliation result

The post-merge query for `new`, `triaged`, and `in_progress` records returns
zero. This means the historical queue was reconciled one occurrence at a time;
it is not a claim that one new repository scan proved the complete current tree.
Automatic per-commit scanning remains disabled. After the large roadmap block,
run one explicit repository scan and reconcile any new records against the then
current `main`.

## Upstream delta audit

The first source audit is complete in
[`upstream-2.14.9-audit.md`](upstream-2.14.9-audit.md). It compares upstream
`v2.7.13` through `v2.14.9` without merging wholesale.

The follow-up [`upstream-2.14.15-audit.md`](upstream-2.14.15-audit.md) classifies
the 13 commits through `v2.14.15`. Dependency updates are already present or
inapplicable; the NotebookLM selector change is optional housekeeping. The
bounded DES-019 follow-up and its sentinel-range-aware final-note boundary are
merged through PR 42; upstream append-context and size-policy work remain
deliberately unported.

- Inspect provider blocks that Liska has changed least: Perplexity,
  Gemini/NotebookLM, Claude, common Markdown conversion, storage/Obsidian, UI,
  and CI.
- The first installed-build provider pass now verifies distinct open-report and
  closed-conversation Gemini Research exports plus a six-message Gemini
  Notebook export with 136 unique resolved per-message citation definitions.
  The apparent Notebook citation loss was a verifier-pattern error, not a
  product defect. Perplexity did not receive a Liska isolated-world content
  script in Comet on exact `www.perplexity.ai`, despite installed host access;
  source inspection rules out selector drift as a permanent launcher blocker.
  Reproduce with the current build in another Chromium browser before granting
  another origin or changing selectors. Do not add bare `perplexity.ai` from an
  omnibox display that merely hides `www`.
- Daybreak Blue is available here only through GitHub Codex Security Review.
  The unavailable advisory-access probe has no separate application path and
  is not an outstanding repository permission or merge gate.
- The October Claude DOM/thread slice is merged through PR 43. A fresh installed
  canary now confirms one complete two-message transcript and one 22-message
  transcript accumulated across 36 scroll iterations, with byte-identical
  Download and Obsidian copies. Live October tool-label output remains separate.
  The same canary exposes a new isolated document-Artifact frame that neither
  upstream 2.14.15 nor the legacy top-document selector can read. The current
  candidate preserves the transcript and durably records the omission without
  adding frame permission. The installed 41-file candidate now proves that exact
  code and fixed warning in both Download and Obsidian with byte-identical notes;
  a full companion remains gated by the freshness and security triggers in
  ITH-001. Do not reuse the stale compatibility branch's truncation
  implementation.
- Selector-derived provider readiness now has a current-main candidate with an
  exhaustive provider/host map and cross-provider negative matrix. It remains a
  UI-injection hint; no live-provider timing claim or capture authority follows.
- ChatGPT paired-turn and reverse-axis handling now has a fallback-only local
  candidate. API-first archives remain authoritative; live CSS/reverse-scroll
  and keyless cross-window identity remain explicit gaps rather than inferred
  support.
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
3. Retain only the still-unproven DES-019 append-context, transformed-size, and
   ordering candidates; the confirmed final-note seam is already merged.
4. Send each later provider/security slice through its own focused pull request
   and final-main continuous scan.

## Exit criteria

- no open medium finding remains confirmed on the current head;
- every remaining low/informational item has a source-backed verdict and owner
  or deliberate deferral;
- upstream changes in untouched provider/shared blocks have been reviewed;
- full tests, coverage, build, lint, formatting, and one independent review are
  green after the final security patch set.

## Repository-scan ordinary-image destination integrity — candidate 2026-11-01

Repository workflow
`wfr_c294dc0cd6f299d087315e0f99ec41d66f098d39a4abf0dfdf55e9fca9aab721`
reported medium finding `csf_f4bdef66eee0e03879dd3d07` / occurrence
`occ_6d8073e1a620a00d37a7797f` against revision `389e310`: ordinary File and
Obsidian image links were not bound to collision-safe retained files.

Branch `codex/sec-immutable-images` starts from merged main `09dbb18` and has a
reviewed local candidate. Ordinary images now use strict full-SHA planning under
`liska-v1`; fresh Obsidian uses create-only persistence plus bounded exact
readback and embeds only confirmed full vault-relative paths; File confirms all
image terminal/path/existence evidence before it dispatches Markdown. Failed or
uncertain Obsidian images are removed with the existing count warning, while
File fails before Markdown. Legacy title/index resolver exports are removed.

Independent review found and closed two additional candidate seams: fresh
Downloads evidence had ignored `state`/`exists`, and a protected-Markdown parser
budget failure had been misclassified as image-free success. The absolute
Downloads prefix remains explicitly browser-owned and opaque; another
same-privilege extension mutating download paths is outside the cooperative
browser boundary. Downloads evidence is not byte readback or a permanence
claim.

The final affected matrix passes 9 test files / 574 tests. TypeScript and the
production build, targeted ESLint, focused formatting and diff checks pass; the
independent candidate review reports no material finding under the stated
boundary.

The candidate is not yet merged or live-browser accepted. Keep the Cloud
finding open until the reviewed source head is merged, fetched `main` contains
that head, current-head CI/reviews are clean, and the merged invariant is
reconciled back to the exact occurrence. Do not treat local tests as authority
to close the remote record.

## Repository-scan queue after PR 96 — 2026-11-01

PR 96 merged reviewed head `f1266ad` as `dd240ab`; CI, Code Review and Security
Review are clean, and merge ancestry is verified. The corresponding
repository-scan image occurrence is still administratively `New`: repository
findings expose neither the commit version required by the connector close API
nor a status action in the current detail UI. Keep source remediation and Cloud
administration distinct; do not launch a duplicate fix or claim closure.

Static triage of the other nine current records against `dd240ab` yields eight
confirmed queues and one superseded record:

1. ChatGPT opaque-replay page primordials;
2. provider-DOM trusted-control redress (owned by ITH-009);
3. quadratic ChatGPT/DeepSeek privacy diagnostics;
4. recursive nested ChatGPT content normalization;
5. superlinear Markdown/image processing before the final size gate;
6. DeepSeek navigation identity mixing;
7. unbounded build-comparison ZIP extraction/readback;
8. default-port normalization bypass of the Obsidian minimum-port rule.

The Obsidian response-buffering record is superseded by PR 92's bounded text,
binary and directory readers. This is static triage only; no runtime exploit or
new repository scan was performed.

## Markdown work-budget local checkpoint — 2026-11-02

Uncommitted candidate on `codex/markdown-image-work-budget-v2`, based on
`34fe11a`, addresses `csf_84640545793a9181af6b7482` /
`occ_017e9f17bfa0d7fb725f028b`. Shared sticky parser/work admission covers
ordinary formatting, Deep Research conversion and final Markdown safety.
Image processing uses merged intervals, binary lookup and streaming placeholder
scanning. Original-source inert fallback preserves independently validated
composer markers; raw/canonical inputs are not mutated.

The independent candidate review found an upstream formatting parser bypass
and a protected-placeholder marker-survival regression. Both received targeted
repairs and regression tests. Current local evidence: 516 targeted tests pass,
production build passes, and repository lint has zero errors (35 warnings). A
bounded two-worker full run completed all test cases with 248 files passed / 1
skipped and 9,196 tests passed / 3 skipped. No browser acceptance, commit, push
or PR exists for this slice yet.

The first full-suite terminal session was lost on tool reconnection; its result
remains unknown. The replacement run's test verdict is green, but its command
exited 1 only after testing because the optional JSON reporter was pointed at
`.git/liska-markdown-tests.json`; `.git` is a worktree link file, not a
directory. Do not misclassify that reporter-path error as a failed test or claim
the wrapper command itself exited zero.

## Build-comparison ZIP-budget local checkpoint — 2026-11-02

Uncommitted candidate on `codex/build-compare-zip-budgets-v2`, based on
`ad2c693`, addresses finding `csf_df767b6997375ba3775f0f72` / occurrence
`occ_b358ca1a1082e72e6d0b2438`: both `--ci-zip` and downloaded release assets
previously converged on unbounded native extraction and recursive whole-file
hashing. The candidate uses pinned `yauzl@3.4.0`, complete bounded inventory
before writing, portable-path/type/alias admission and sequential streamed
SHA-256/CRC-32 extraction. Excluded entries consume every archive budget.
Local manifests now use iterative traversal and bounded chunked hashing.

Independent review identified one remaining acquisition race: admitted metadata
had still been followed by unbounded `gh release download` resolving a mutable
tag/name again. The repaired candidate validates the exact package-repository
API URL and numeric asset ID, then streams that pinned endpoint with `gh api`.
A create-only destination never retains bytes beyond the advertised size or
64 MiB ceiling. Stderr capture is bounded to 8 KiB; successful process exit,
exact size and an advertised SHA-256 digest are required. Missing legacy
digests remain compatible. Abort, child/pipe error and a ten-minute timeout
kill the transfer and remove partial files without a child-close deadlock.

Current local evidence: 100 focused tests pass (105 with the adjacent packaging
suite), including independent ZIP bytes,
exact/+1 lowered ceilings, excluded high-ratio input, path/type/Unicode/case
conflicts, CRC/declared/runtime length failures, partial-tree cleanup, multi-chunk
hashing, real native ASCII packaging and actual CLI 0/1/2, `--keep` and `--twice`
precedence/build-count checks. Targeted script ESLint and the production build
pass. A real `npm run compare-build -- --twice` completed two production builds
and exited 0 with identical manifests. Standard UTF-8/Unicode-path names are
supported; ambiguous unflagged
non-ASCII legacy codepages are deliberately rejected. Windows `tar` itself lost
an accent during a local non-ASCII round-trip, so no codepage inference was added.

Transfer regressions also cover pinned repository/API identity, chunked
over-limit replacement with early abort and incomplete producer consumption,
exact-size/digest success, truncation, nonzero child exit, bounded stderr,
spawn/stdout/stderr errors without a close event, finite timeout and create-only
preservation. A bounded live read-only production CLI check against public
`v3.0.0` asset `511567805` (117,146 bytes) completed digest validation and ZIP
extraction, then exited 1 for ordinary content differences, not operational
failure. The isolated temporary root was empty after cleanup; no release was
mutated.

The complete repository suite passes 249 files / 9,281 tests, with one file / 3
tests skipped. Production build, targeted script ESLint, Prettier and diff checks
also pass after the reviewed transfer repair and final close-error cleanup.

This checkpoint is local source/test evidence, not a merge, installed-runtime
acceptance or Security Cloud closure. Keep the exact occurrence open until the
reviewed source head is merged and reconciled through the current-main gates.

## Extension-owned export authority local checkpoint — 2026-11-02

Uncommitted candidate on `codex/provider-owned-export-confirmation-v2`, based on
`2ac32ec`, addresses finding `csf_5072816416f2eab1f2507059` / occurrence
`occ_0a02f7562dd1274cab065c4e`. Provider DOM now contains only a launch-only fox;
current/branch actions, branch/all selection and Stop live in extension-owned
UI. Export is the default popup tab and Settings remains independent.

A worker-owned, session-restorable controller consumes a 30-second intent once,
binds a fresh generation to exact tab, top-frame document, provider route,
settings/destinations and mode, and requires that generation on content capture,
preparation and every durable output family. Selected ChatGPT capture cannot
commit until a second extension-owned ordinal/all choice. Registered compact
windows preserve Chrome 111 fallback without broad permissions or URL-only
authority. Exact owned-stage cleanup remains available after cancellation;
already-dispatched or uncertain commits are never reclaimed or retried.

Independent reviews found three material P2 seams. First, a queued navigation cancel
could lose to an authorization awaiting settings; synchronous tab revocation
epochs plus final route/document/phase/expiry/revision checks now close it.
Second, cancellation could throw after a caller relinquished a temporary stage;
messages are now synchronously prepared before ownership transfer, and worker
denial cleans only a proven uncommitted generation-owned stage. Direct
interleaving and unmocked binary/archive regressions cover both repairs.
Third, an old branch button could survive while another extension surface
replaced the operation/selection and then submit its ordinal against the new
generation. Branch choices are now retired immediately on either identity
change, every listener captures its exact response identity, and late old
catalog responses are ignored. The reviewer reproduced the original race and
then verified that the repaired retained listener sends no choice.

The first published-head Code Review found two further bounded-capacity P2s.
Retained empty terminal history could occupy all 64 operation slots for roughly
two hours, and an initial reclamation fix did not reserve future operation slots
for pending intents from other tabs. Admission now enforces `operations +
intents + new intent <= 64`, reclaims only the oldest terminal records with no
owned stages, and repairs legacy overreservation before a claim by preserving
live/cleanup-owning records and revoking newest excess intents. The reviewer's
delayed two-tab reproduction now transitions `62 operations + 2 intents` to 64
claimed operations; restart preserves both authorizations. All-protected and
32-intent controls remain fail-closed.

The next current-head review found that a successful explicit archive/binary
abort deleted its temporary stage but left the exact cleanup capability in the
controller. That stale ownership could make 64 honest cancel/cleanup cycles look
permanently protected and close the cap again. Post-result accounting now
revalidates the exact request stage/generation/owner and releases ownership only
after `{ success: true }`; pending, failed, unknown, unauthorized and mismatched
cleanup retains the capability for a safe retry. Both 64-cycle reproductions now
admit the next export, and restart/retry/wrong-owner controls pass.

Final local evidence after the terminal-status repair: the complete repository
coverage suite passes 254 files / 9,393 tests, with one file / 3 tests skipped. The earlier
closed affected matrix passed 154 files / 6,101 tests, with one file / 2 tests
skipped; the final reviewer-equivalent authorization/UI matrix passes 6 files /
132 tests, the final controller/route matrix passes 2 files / 128 tests,
and the directly affected background matrix passes 41 files / 1,622 tests.
Production build, emitted-worker runtime check, lint (52 warnings / 0 errors),
formatting and diff checks pass. A synthetic 380px preview checks Export default,
literal branch descriptors, ordinal/all selection, Stop/status, cancellation and
preserved Settings. Completion wording is now neutral unless the worker can prove
that selected-branch preparation ended before any extension-owned choice; that
bounded outcome says explicitly that nothing was saved.

The first current-head CI run passed every test but failed its unchanged 95%
global statement threshold at 94.87%. Thirty-nine deterministic controller tests
now cover malformed fallback windows, rejected begin/choice handshakes, exact
stage handoff and cleanup failures, wrong senders/sources, duplicate stages,
pending-intent tab lifecycle and related fail-closed branches. The unchanged
coverage gate now exits zero at 95.01% statements (26,185 / 27,558); controller
coverage is 99.26% statements and 100% lines/functions. No production branch or
threshold was weakened for coverage.

The final 45-file / 1,258,921-byte build was copied into the existing unpacked
Liska target through the verified rollback-preserving updater. Source and
installed inventory SHA-256 are both
`1f141146d803bb261853ad16fb0079ead88756110f614cb946207540474b9e06`;
manifest SHA-256 is
`917e32400149125f1896fb6546b40bf1dc4f7341a6afe8024cc0b93a5db7cac9`.
Rollback `liska-rollback-20261102T194014713Z-23e746d9f9974e5ab3d2a0eab03b8633`
is retained. Comet Developer mode was enabled and only Liska was reloaded. The
source manifest adds no permission or web-accessible-resource entry; CRXJS
exposes one shared pure contract chunk automatically, with no tokens, controller
or popup UI.

An installed ChatGPT smoke then confirmed the exact title/route and preserved
Obsidian + File destinations, while Settings' configured Local REST API test
returned `Connection successful!`. The page fox opened the extension popup and
never displayed current/branch/Stop actions in provider DOM. `Choose branch…`
entered the no-save preparation phase, exposed extension-owned Stop, then opened
one registered compact extension window with a literal `#1 · 34 messages ·
current` descriptor and a separate `Export all branches` action. Stop cancelled
before a branch/all choice; reopening the toolbar popup retained `Stopped`, and
fresh filesystem checks found zero new files in the browser download roots, the
maintained chat-export folder or the open Obsidian vault. Reloading Liska
invalidated the already-open tab's old content-script context; one ordinary page
reload was required before the new controller could be claimed.

This proves the installed toolbar, launch-only fox, registered branch window,
preparation, Stop/cancel and reopened-status paths without modifying a chat or an
append-only archive. It does not exercise durable current/ordinal/all output, nor
does it emulate absent/rejected `action.openPopup()` on an older supported
Chromium. Keep those T6 limits explicit and keep the finding open until
current-head review/CI and merge ancestry are complete. Ordinary chat text
remains outside the demonstrated threat precondition; hostile or compromised
provider-page code is required for the original redress path.

## Earlier linear privacy-diagnostic candidate evidence

Branch `codex/sec-linear-privacy-diagnostics` addresses
`csf_238ec3b8127a895cabcda3a7` / `occ_0b55bd216944b6ba5eeae57e` at the two
recorder boundaries. Private WeakMap/Set membership replaces repeated array
scans while preserving the ordered serialized arrays, exact provider-specific
dedup keys, first-row messages, repeated sanitation side effects and structural
tracker literals.

The deterministic pre-fix proof measured 4,032,008 and 16,064,008 historical
array reads at 2,000 and 4,000 unique keys; the candidate stays within 16 at
both sizes. Review also covered partial `push` failure after an element was
retained but before length assignment completed. Five affected suites pass 354
tests; complete archive JSON hashes, TypeScript, production build, targeted
lint, formatting and diff checks pass. Publish this as its own PR; close or
reclassify the Cloud row only after reviewed merge ancestry is established.
