# Project status

## Inert language-tagged reading blocks — reviewed local candidate

Branch `codex/inert-reading-code-blocks` addresses Security Cloud occurrence
`occ_c2c12fb6b7545bfbdde03e63` without pretending to sandbox Obsidian plugins.
The new synced `enableInertCodeBlocks` option is default-on and applies at the
shared final reading-Markdown boundary for File, Clipboard, fresh Obsidian and
all-branches measurement; exact raw/manifest/canonical companions and
canonical-derived HTML bypass it unchanged.

Actual CommonMark tagged fences are wrapped as visibly preserved source behind
one unlabelled collision-safe outer fence. A bounded physical-source invariant
then refuses any remaining run of three or more backticks/tildes with a
non-empty same-line suffix unless it is already inside a source-visible fenced
code node. This closes Obsidian reinterpretations through footnotes, block
comments, list/quote containers and multiline-inline ambiguity without copying
the proprietary parser or maintaining a language denylist. Candidate-free
notes return byte-identically before parser admission, preserving full 32 MiB
reading output compatibility.

Append never rewrites the old body: it neutralizes only the new tail, recomputes
trusted marker ranges and refuses a tagged/ambiguous old prefix or diagnostics
update. Explicit opt-out preserves legacy syntax highlighting and intended
plugin rendering. The fixed failure is
`inert-code-block-finalization-failed`; it never falls back to active Markdown.

The implementation's focused matrix passes 15 files / 672 tests; the parent's
final high-signal matrix passes 6 files / 353 tests, including the full-size
candidate-free persistence case. TypeScript/production build, lint with zero
errors, formatting and diff checks pass. Independent review found successive
Obsidian-dialect bypasses and drove the final parser-independent physical
invariant; the last reviewer recheck was blocked by the external model's policy,
so exact mechanical verification was completed locally. No live vault write or
third-party processor execution was performed. The source claim is deliberately
limited to language-specific fenced-code dispatch.

## Claude/DeepSeek aggregate provider budget — merged

PR 107 merged reviewed head `dbab233` as `acccd3b` and addresses the current-main
Security Cloud finding that Claude and DeepSeek could repeatedly traverse
provider-controlled block, attachment and metadata collections without one
aggregate work boundary. The candidate adds a shared typed
`ProviderContentLimitError` and keeps public preflight, inventory and normalizer
calls safe when invoked independently.

Each exact raw artifact is limited to 32 MiB. A traversal admits at most 250,000
visited occurrences and 250,000 emitted blocks; one capture operation shares
2,000,000 auxiliary work units through repeated phases and up to two DeepSeek
destination rebuilds. Items are charged before filtering, deduplication or
copying, including malformed/nonasset entries, empty FILE fragments, Claude
tool-result evidence, nested provider metadata and privacy sanitization.
DeepSeek best-effort inventory, resolver, binding and finalization catches
rethrow the typed limit instead of degrading it into apparent success. The
existing 20,000-node graph and 50,000-asset inventory contracts remain intact,
and ordinary provider failures may still produce the existing honestly marked
DOM-partial fallback.

The affected matrix passes 16 files / 685 tests. TypeScript, Vite and generated
runtime build checks pass; lint has zero errors and only the repository's
warning-level size/complexity notices; formatting and diff checks pass. An
independent reviewer reproduced 19,999 messages across capture plus two
reconstructions at 1,139,952 shared work units, the accepted 16-level metadata
boundary, linear repeated-attachment source-ref handling and fail-closed
conflicting metadata. It reported no remaining concrete bypass or regression.

Published-head Code Review subsequently found one P2 in evidence retention. A
limit raised during normalization already had a verified raw/manifest companion,
but rethrowing the exact limit error prevented the outer provider extractor from
recovering that pair for DOM fallback or staged navigation cleanup. The narrow
follow-up stores only that exact error-to-companion association in a content-layer
WeakMap, rethrows the same typed error and leaves early limits companion-free.
Claude and DeepSeek now retain raw evidence through successful and failed DOM
fallback and abort staged evidence after navigation; Claude also reports the
stable limit code instead of `unknown-error`. The four focused suites pass 113
tests and the full production build passes. No browser or durable
destination-write acceptance is claimed yet.

The exact Security Cloud detail UI currently cannot administratively close the
older repository-scan rows: `STATUS` is read-only, `Fix with Codex` opens a chat,
and the only list action is CSV export. The connector close endpoint is limited
to versioned commit-scan findings. Nine older categories are source-remediated
on current `main`; the default-port item is an intentional compatibility policy
and must not be mislabeled `Fixed`. The other two current findings—stronger
Obsidian process identity and third-party executable code-block processors—stay
separate from this patch.

## Durable capture-loss diagnostics — installed candidate

Branch `codex/durable-loss-diagnostics` adds a privacy-bounded historical loss
contract for ordinary legacy-provider Markdown. Two always-on frontmatter keys
carry only sorted, deduplicated schema-1 codes:
`history-load-partial` and `image-capture-failed`. They mean that Liska
positively observed those conditions during an attempt associated with the
document; absence never proves completeness, and a later successful attempt
does not erase earlier evidence.

Only an explicit partial history-loader outcome qualifies. Disabled loading,
missing configuration/container, and unknown outcomes remain unclassified. An
image diagnostic requires an identified image capture attempt that failed;
intentionally disabled export, Clipboard omission, and destination write
failures are separate conditions. Existing human-facing warnings remain, but
their URL, filename, exception, response, and localized prose never enter the
durable fields.

The background boundary accepts only an own enumerable bounded array of exact
codes. Unknown schema/codes, duplicate owned keys, malformed lists, accessors,
hidden or inherited data, symbolic extras, and ambiguous future blocks fail
closed. Save-note validation now precedes JSON sizing so a hostile diagnostic
getter cannot execute during size measurement.

Append merges diagnostics as a historical set. A same-message-count run writes
only when it contributes a new code, preserves the body and line endings
byte-for-byte, and reports that metadata changed without claiming new messages.
Repeated evidence is a no-op; shorter captures cannot annotate longer notes.
Ordinary message-boundary and final-Markdown checks remain authoritative for
real appended tails.

Independent review found and closed the parser/integrity family before commit:
a metadata-only update no longer normalizes a mixed-EOL user body; only an
exact `---` line closes frontmatter; and, after masking the one canonical block,
any other literal, escaped, quoted, tagged, anchored, explicit, flow, or folded
mention of the owned key family fails closed. Focused regressions cover those
forms and the exact mixed-EOL PUT body.

Markdown safety may neutralize an unsuccessful private image placeholder before
destination resolution. File, Obsidian and stripping paths now remove the
expected line-isolated neutralized grammar and never convert it back into an
active embed, even if an image with the same ID is supplied. An anomalous
inline, code or HTML-shaped marker stays inert instead of being deleted and
joining surrounding tokens. This closes the private `g2o-image://` residue
exposed by the first exact producer canary without weakening remote-image,
fenced-code or message-boundary protections.

ADR-044 records the semantics and the deliberate boundary: schema 1 does not
cover post-Markdown File image failures, Obsidian destination image failures,
intentional Clipboard omission, derived HTML, or current-completeness
assessment. The current integrated tree passes all 234 test files: 8,002 tests
passed and one existing test skipped (8,003 total), with one worker. Coverage
remains above the repository threshold at 95.06% statements, 91.76% branches,
98.60% functions and 97.56% lines. TypeScript, the 294-module production build
and service-worker runtime check pass. Full source/platform lint has zero errors
and the same three pre-existing warnings; exact Prettier 3.7.4 and diff checks
also pass.

The exact installed candidate contains 41 files / 1,154,236 bytes. Source and
installed aggregate SHA-256 both equal `8313d728...c0b7`; manifest SHA-256 is
`a79b440e...e8db`, and rollback
`liska-rollback-20261029T024810957Z-71b407980e004e6ea7cb57d759f66cdd`
retains the previous bytes. Native CUA reloaded only Liska and the Gemini page
was then reloaded for the current content script.

One File-only ordinary Gemini canary placed a revoked, undecoded same-origin
Blob image inside the extractor's exact first-priority
`.markdown.markdown-main-panel`; the live clone contained that identified image
with `naturalWidth=0`. One trusted click emitted the fixed one-image failure
warning, retained the real 236,990-byte JPEG with SHA-256
`55ba81ea...f81f`, and wrote a 14,107-byte Markdown note (SHA-256
`a5d81e31...2557`) with exactly `image-capture-failed`. The note contains no
`g2o-image://`, `blob:`, canary ID, neutralized image opener or false local
link. A page reload removed the synthetic node and observer. Obsidian and File
output, auto-scroll and image export were restored; Clipboard and append remain
disabled. Exact-head CI and GitHub reviews remain the merge gate.

## Provider live gates — Gemini Research and Gemini Notebook

A current installed-build canary now distinguishes the two Gemini Research
surfaces instead of treating the report card as an ordinary message. With the
immersive report panel open, File and Obsidian received byte-identical
78,013-byte Markdown documents with one report message. The rendered final
paragraph was visible at the bottom of the panel and matched the saved tail.
With the panel closed, the same page produced a separate byte-identical
9,269-byte ordinary conversation note with eight role sections. The two routes
have different IDs and body hashes; the report contains no ordinary role
sentinels, while the closed view contains four user and four Gemini sections.
Both pairs have valid frontmatter and no checked credential, header, cookie, or
unsafe-URL residue. Serialized `type` is absent by the existing note-generator
contract; `message_count` is present as 1 and 8 respectively. Zero report
footnotes is valid for this source-free sample and is not by itself evidence of
loss.

One current Gemini Notebook canary also completed to File and Obsidian. The
destinations contain six unique message bodies and the same frontmatter
identity/count. File is 44,231 bytes and Obsidian is 43,815 bytes; removing
exactly 208 expected File-only blockquote prefixes makes every line identical.
The citation contract is intact: 362 `m<assistant-index>-<number>` occurrences
resolve to 226 references and 136 unique definitions, with zero duplicate
definitions, unresolved references, orphan definitions, out-of-contract labels,
or checked credential/active-scheme residue. A first verifier incorrectly
looked only for purely numeric footnote labels; the corrected contract and a
sanitized live DOM probe both confirm the existing
`button.citation-marker.chat-bidi-enabled` plus child-label shape.

Perplexity remains a browser-specific live gate, not a demonstrated extractor
regression. The authenticated Comet document is exact `www.perplexity.ai` even
though its omnibox hides `www`; adding the apex host is therefore unjustified.
The installed manifest grants the exact `www` host, but after a hard refresh and
the readiness fallback deadline the page contained no Liska launcher/styles,
and DevTools exposed the page and Comet-agent worlds without a Liska content
script context. Current source would inject after at most ten seconds once the
content script runs, regardless of selector drift. Test the same current build
in a non-Comet Chromium session before changing provider selectors, origins, or
permissions; Comet may suppress third-party content scripts on its own domain.
No provider code changed at this checkpoint.

## Gemini generated-image redirect boundary — live-verified checkpoint

Branch `codex/gemini-image-redirect-boundary` starts at `d45e450`. The
pre-change installed Liska canary twice detected one generated image at
`lh3.googleusercontent.com` but failed capture; File and Obsidian notes were
byte-identical and contained no false image link. Upstream observed the exact
redirect `lh3.googleusercontent.com -> lh3.google.com`.

The local implementation adds only exact `https://lh3.google.com/*` permission
and `https://lh3.google.com` CSP connect origin, never `*.google.com`. Direct
sources still require the original googleusercontent family. Source/final URLs
require HTTPS, no username/password, and the default HTTPS port. A separate
final-response validator admits only that family or exact `lh3.google.com`.
One authenticated fetch explicitly includes browser-managed credentials, omits
referrers, disables cache reuse, and lets the browser follow redirects, without
retry or anonymous/authenticated fallback. Rejected final URLs cancel the
available body before status, MIME, or body reads;
network/final-URL errors are fixed strings without raw URL/exception leakage.
The existing streamed 10 MiB cap and single five-second deadline remain.

Intermediate redirect hops are not observable or validated per-hop; final-host
acceptance is not a full egress proof. Packaged permission expansion may require
re-consent. README, privacy policy, Store draft, ADR-021/027, upstream audit and
security TODO now state that boundary. Prior live/retained evidence of anonymous
403 responses and session-dependent links justifies preserving browser-managed
authentication. Fetch may send eligible cookies to the permitted CDN/redirect
hosts, but Liska never reads or serializes cookie/request-header values or
exposes them to the model, content script, or durable output. URL presence is
reference evidence, not byte availability; stale/failed links never become
fetched claims.

Final authenticated-tree checks: six focused suites / 186 tests, standalone
`tsc --noEmit`, guarded 288-module production build, repository formatting and
diff checks pass. Source/platform lint passes with the same three pre-existing
advisory warnings. Built manifest/worker inspection confirms exact permission/CSP,
authenticated fetch options, and final-URL validation before status processing.
The final full suite passes all 224 files: 7,588 tests passed and one existing
test skipped (7,589 total), with one bounded worker. Only this authenticated-tree
result is the current full-suite evidence.

The exact committed build `ff4d1fa` was installed by the verified unpacked
installer: source and installed inventories both contain 40 files / 1,109,241
bytes, aggregate SHA-256 `31415014...e9d6`, and manifest SHA-256
`602c8cc3...ec80`. Rollback
`liska-rollback-20261028T164747986Z-670cd08cf30c46c880af4b4b4016d953`
retains the previous bytes. Comet reloaded only Liska; an ordinary page refresh
then removed stale connection state before one trusted export.

With auto-scroll enabled, the same small named Gemini chat mounted one decoded
`AI generated` image. The post-fix export wrote a 236,990-byte JPEG to File and
Obsidian; both physical files are byte-identical with SHA-256
`55ba81ea21fb8fad27475bdef5faf4e351772da83a4278809dc92f861869f81f`,
valid JPEG SOI/EOI and decoded dimensions 1024 by 559. Visual inspection of the
local JPEG matches the displayed Gemini image. Each destination note contains
exactly one local link to `conversation-121244f5-img-1.jpg`, the same identity
and ten alternating role sections; all ten normalized message bodies match.
Neither note contains a remote image target or checked `googleusercontent`,
`lh3`, signed-path, cookie, authorization, or request-header residue.

This closes the one-image installed File/Obsidian acquisition and persistence
gate. It does not reveal intermediate redirect hops, cookie eligibility, or
prove packaged-update re-consent/cancellation behavior. The completed static
Codex Security diff scan `088304af-c28d-4408-85ce-15c1f83f299c` found no
plausible changed-code vulnerability and intentionally retained those runtime
questions as partial coverage.

The separate loss-diagnostics gap from those two pre-fix exports is now closed
by PR 66. Schema 1 retains only sorted `history-load-partial` and
`image-capture-failed` codes, never provider URLs or arbitrary exception text;
append merges that historical evidence without rewriting body bytes. An exact
installed Gemini canary preserved the real JPEG and durable failure code while
leaving no private placeholder, `blob:`, canary ID, or false local link. This
still does not claim destination image-write failures or current completeness.

## Confirmed working

- Repository: `la4ox/liska-threadkeeper`; upstream remains `sho7650/obsidian-AI-exporter`.
- Released baseline: `v3.0.0` at `539c1ae`; cleanup work continues from that tagged commit.
- Product identity is `Liska — AI Threadkeeper`, version `3.0.0`; the major version preserves monotonic browser updates from upstream 2.7.13 and marks the independent product/privacy boundary. Release artifacts use `liska-threadkeeper-<version>.zip`. Original MIT attribution is preserved in `LICENSE` and `NOTICE.md`.
- File and clipboard exports work without Obsidian. Obsidian remains an optional output through Local REST API 5.1.0 on exact loopback host `127.0.0.1`. HTTPS health, certificate, and bearer authentication were verified independently on port `27124`. Because Comet's extension service worker did not inherit the tab's self-signed-certificate exception, the browser integration uses the plugin's HTTP compatibility endpoint on `127.0.0.1:27123`. End-to-end DeepSeek sync produced a 2,854,272-byte note with frontmatter `message_count: 1408` and exactly 1,408 rendered role markers.
- DeepSeek signed-in exports use the same-origin history response, reconstruct the selected active branch, preserve Markdown, and optionally include Thinking. DOM/scroll fallback remains available.
- Live DeepSeek export was verified on a 2,803,334-byte conversation: 1,382 messages (691 user + 691 assistant), 690 reasoning blocks, correct first/last roles, and no alternation breaks. It completed in seconds without scrolling.
- DeepSeek now has a provider-specific `liska-capture/1` → `liska-thread/1` adapter on `codex/deepseek-canonical-core`. It preserves exact non-delta history-response bytes, every validated parent/child node, ordered text/Markdown/reasoning/unknown blocks, manifest unknown-type evidence, and a current-node Markdown projection. Durable File/Obsidian outputs receive raw/manifest/canonical companions through provider-bound inline or staged transport; DOM fallback remains explicitly partial and can retain verified raw/manifest evidence after a post-capture normalization failure. The initial metadata-only checkpoint kept every DeepSeek asset honestly `not-attempted`; the later bounded direct-history acquisition path is described below. A post-reload live File smoke on 2026-09-18 preserved a 40,585-byte raw response, a 955-byte manifest, a 67,220-byte canonical archive, and Markdown marked `structured-api / complete`. Raw and manifest hashes linked exactly; all 12 nodes and 11 edges were reachable from one root with no cycle, dangling, or asymmetric link; three reasoning and three unknown blocks remained typed; credential/signed-URL scans of manifest/canonical were clean. The live provider omitted `cache_control`; Liska accepted the self-contained graph while continuing to reject explicit cache deltas.
- A content-free field-shape probe of an older live raw found a `files` array on every message and two populated metadata-only records. The ledger hashes provider IDs into opaque asset IDs, deduplicates only exact IDs, and retains exact raw pointers. Canonical attachment source references now use null provider IDs, so provider IDs and signed transport remain raw-only.
- The public DeepSeek frontend bundle identifies the page-owned metadata resolver as exact same-origin `GET /api/v0/file/fetch_files` with the query key `file_ids`. Bounded live calls for both an older and the fresh synthetic attachment returned metadata but no usable `signed_path`; product code does not call this route and does not copy its bearer, `x-client`, or `x-device` headers. Its URL builder accepts a path under the configured file-service `/api` base and adds resource mode `ty`; this informed validation but does not authorize an active resolver.
- A fresh synthetic 93-byte text attachment supplied `signed_path` in a verified history `FILE` fragment record (`chat_messages[].fragments[].files[]`); the live message-level `files` field was absent. Clicking its card issued no `fetch_files` request; the page performed one direct `GET https://files.deepseeksvc.com/api${signed_path}&ty=r` and received `200 application/octet-stream`, content length 93, and exact source bytes. A later reloaded canary exposed the complementary legacy shape: `message.files` had SUCCESS/id/size but no `signed_path`; after a page-native card click, current-document ResourceTiming contained the exact file-service URL with `initiatorType=fetch` and exact `file_id,state,ty` keys. Liska now inventories both raw locations and, only after raw persistence, merges valid in-band candidates with the newest 512 already-observed timing entries. Every passive URL must pass the full fixed-host grammar, bind its `file_id` uniquely to current verified raw sourceRefs and a recomputed asset ID, and remain runtime-only; in-band wins. The fallback never clicks a card, clears performance entries, or installs an observer, so an attachment not already previewed remains unresolved. Credential-free GETs remain sequential and bounded to 20 attempts, 64 MiB per asset, and 128 MiB total; exact nonempty response URL, passive MIME, declared size, and locally computed SHA-256 are required. Destination results independently govern regenerated manifest/canonical `fetched` claims. Relative `signed_path`, observed URLs, state tokens, and provider file IDs are removed even from degraded canonical blocks and privacy diagnostics.
- Exports require a trusted user click. Programmatic page clicks cannot trigger file, clipboard, or authenticated Obsidian operations.
- Remote image fetch and offscreen clipboard response waits are bounded to five seconds.
- Image-export-enabled append can now persist only images referenced by the verified new tail through strict content-addressed create-only/readback semantics; image-export-disabled append retains text-only placeholder stripping.
- The experimental `liska-capture/1` and `liska-thread/1` archive layers now preserve exact raw artifact bytes separately from a credential-free manifest, verify artifact and manifest SHA-256 provenance, validate/traverse complete branch graphs, and project either `currentNodeId` or an explicit leaf into the existing flat Markdown contract while reporting legacy omissions.
- ChatGPT's live web-history route was confirmed as `GET /backend-api/conversation/{conversationId}`. A local structural probe observed a direct `mapping` graph with a structural root, a current node, and sibling branches; no personal response body, title, conversation ID, cookie, header, or credential remains in the worktree or was committed. The pure normalizer consumes only hash-verified exact bytes, retains all graph nodes and ordered typed blocks, scrubs signed URLs and account/correlation identifiers from the canonical layer with diagnostics, and uses synthetic fixtures only.
- ChatGPT no-scroll capture is enabled for Chromium 111+ behind a trusted click and the narrow `scripting` permission. A marker-gated MAIN-world script runs at document start only in an inactive disposable conversation tab, observes the page-native exact GET response, and never reads or serializes request headers, cookies, account data, or unrelated traffic. Responses up to 16 MiB use the inline verified path; larger responses up to 64 MiB use the staged transport described below. Control state remains closure-private, background re-verifies bytes and SHA-256 in extension context, and only the created tab is closed.
- The ChatGPT bridge normalizes the complete captured graph transiently, projects the selected current branch through the existing Deep Research safety guard, and falls back to marked DOM/scroll extraction on any capture, integrity, normalization, or projection failure. Personal raw response bytes are persisted only to the user's selected durable outputs, never the repository or clipboard. A live Comet smoke exported 28 current-branch messages (5 user + 23 assistant role markers) while only 5 turn elements were rendered in the DOM, wrote a 31,187-byte Obsidian note, emitted no fallback warning or capture failure code, and left zero marker tabs open.
- ChatGPT capture authorization now treats `sender.tab.url` as the exact current conversation capability while allowing `MessageSender.url` to retain an older same-origin document path after ChatGPT `history.pushState` navigation. Live Comet smokes passed in both directions between ordinary and custom-GPT chats without reload, and a legacy loss-test that redirected from `/c/...` into a project/custom-GPT route completed structured capture without a capture-failure code.
- The fresh private-corpus pass completed structured capture for a branch-heavy conversation and the largest current positive sample. The latter preserved a 13,117,554-byte raw response with matching manifest length/SHA-256, complete graph/branch claims, and a 29,201,569-byte canonical archive.
- Real ChatGPT Canmore messages are now typed at message level instead of flattened as text. A live Canvas recapture retained 10 calls and 10 results as exactly 20 ordered `canvas_event` blocks (2 create and 18 update halves), with no text duplicates, duplicate content metadata, or invalid raw pointers; the exact raw artifact remains the lossless authority.
- The first explicit branch-view slice is live-verified in Comet. The established `Bring thread home` button still exports the provider-declared current path. A separate trusted `Choose branch` control captures and normalizes the complete graph once, builds an iterative deterministic leaf catalog, shows only bounded visible user/assistant previews in a local picker, and projects exactly the selected leaf. A two-leaf private smoke exported both ordinals independently to Downloads and Obsidian from a 725-node graph with one branch point. Both captures produced raw/manifest/canonical companions; each 1,862,119-byte raw matched its own manifest size and SHA-256, and each canonical archive retained schema `liska-thread/1`, 725 nodes, two leaves, and one branch point. The selected Markdown views contained 619 and 66 legacy-renderable messages; the differences from the picker's 651 and 73 canonical message counts were exactly accounted for by explicit non-user/assistant and empty-message omission warnings. Provider node IDs never enter picker DOM or filenames. Selected notes carry capture/branch provenance, use capture-scoped filenames, and bypass append mode so an alternate branch cannot be merged into the ordinary conversation note. Cancellation writes nothing; failures before or after selection never substitute the rendered current branch.
- The all-branches slice is live-verified in Comet. The same trusted picker can choose `Export all branches`; Liska reuses that single capture/normalization, commits raw/manifest/canonical once per durable destination, then reconstructs and writes one leaf at a time followed by a content-free index. A live two-leaf bundle produced exactly two leaf notes plus one index in both Downloads and Obsidian, with one capture directory and three companion files per destination. The companion bytes were identical across destinations; the 1,862,119-byte raw matched its manifest length and SHA-256; canonical retained schema `liska-thread/1`, 725 nodes, two leaves, and one branch point. Both index links resolved in both destinations, leaf frontmatter retained ordinals 1/2 and rendered counts 619/66, and neither the serialized index nor any leaf filename contained the provider conversation ID or URL. All-branch notes and links use capture-scoped identity and the platform origin. Canonical-only leaves receive explicit stubs rather than disappearing. Clipboard is skipped with one compact warning, progress is reported in ten-branch steps, and a destination receives its index only after every leaf file there succeeds. The catalog retains only targets, counts, and unique suffixes: tests cover 12,000-node depth, a 2,000-node shared prefix with 400 leaves without prefix multiplication, and an 80-leaf sequential bundle with no branch-count ceiling.
- ChatGPT attachment references now receive an offline-first capture ledger before normalization. A content-free structural probe of 16 locally saved raw snapshots confirmed coexisting `sediment:`, older `file-service:`, and metadata-only ID forms without emitting message text, filenames, IDs, URLs, or transport values. The inventory handles content parts plus metadata `attachments`/`files`, deduplicates only exact IDs or exact pointers, keeps same-name ambiguities separate, maps each opaque SHA-256-derived ledger ID to exact raw pointers, and records `not-attempted` rather than falsely claiming unavailable or fetched. A malformed or ambiguous inventory degrades only asset completeness to `unknown` with a stable warning; it does not destroy the verified raw capture.
- The attachment ledger is live-verified in Comet on a private ChatGPT capture without inspecting message bodies, attachment names, IDs, or transport values. The manifest and canonical archive each contained seven assets—four `image_asset_pointer` sources and three metadata records—all in `not-attempted`; every manifest raw pointer resolved to an exact object in the verified raw artifact. Four transport references remained only in raw evidence, while manifest and canonical contained zero `sediment:`/`file-service:` values and zero signed-query markers. The capture directory contained only raw, manifest, and canonical JSON. Downloads and Obsidian copies were byte-identical for all three files, and the raw length/SHA-256 matched its manifest.
- A bounded live route probe on that capture confirmed three `file-service:` image pointers matching three metadata IDs plus one distinct `sediment:` pointer. All four rendered sources used exact same-origin `GET /backend-api/estuary/content` with the query-key schema `cid,id,p,sig,ts,v`; values were never emitted or retained. The four responses were successful `200 image/png` transfers of approximately 1.40, 1.98, 2.59, and 2.77 MiB. Inspection of the already loaded public ChatGPT frontend modules—without another private-data request—confirmed that both pointer schemes are stripped to a file ID, then resolved through the frontend's `/files/download/{file_id}` API helper with conversation context and inline intent; success yields `download_url`, while `file_not_found` and `file_expired` are explicit provider error codes.
- Earlier file-ID resolver work established that Liska must never reconstruct provider authorization or read header/cookie values. The current boundary observes only an exact page-owned helper response, validates its signed same-origin content URL, and performs one browser-authenticated same-origin content GET. Chrome attaches eligible session credentials; extension code never reads, copies, serializes, logs, or persists them.
- Asset acquisition evidence is now fail-closed. `fetched`, `expired`, and `failed` require an attempt timestamp; `not-attempted` and `declined` cannot claim one. Every fetched manifest asset must have exact runtime bytes whose record, length, and SHA-256 are reverified before normalization, and fetched canonical assets require a local path, byte length, and hash. The initial JSON-only ChatGPT companion builder still rejects runtime asset bytes; a separate binary-aware finalizer can accept them only after destination results exist, so no ordinary capture can publish a dangling `fetched` claim. Stable provider file IDs remain only in local canonical source references; signed URLs and `sediment:`/`file-service:` transport values remain raw-only.
- The staged binary persistence route is now connected only to the explicit ChatGPT image-export path. Verified runtime assets are handled sequentially; each crosses Chrome 111 JSON messaging only as independently canonical 512 KiB chunks, is staged under an exact random ID in extension-origin OPFS, and is rechecked for byte length and SHA-256 before output. Persisted names are capture-scoped `assets/<sha256>.<allowlisted-extension>` paths; provider filenames, IDs, signed URLs, and credentials never enter them. Clipboard is rejected; active SVG/HTML/script and macro-capable formats are rejected; File and Obsidian report independent per-asset outcomes; Downloads confirms the actual terminal path after `uniquify`; Obsidian uses no-overwrite preflight plus binary readback/hash verification. A failed release retries one exact abort and reports `binary-stage-cleanup-deferred` if deletion remains unconfirmed. Unconfirmed Downloads ownership is first persisted as a null-ID provisional record, atomically receives Chrome's numeric ID when available, and is reconciled by top-level terminal/startup listeners after MV3 worker suspension or browser restart. The local record is bounded and contains only download ID, random stage ID, extension Blob URL, and timestamp—never archive content or provider identity. A current worker keeps ownership across File and Obsidian siblings; a fresh worker exact-cleans orphaned ownership. Aged exact remnants are pruned only in bounded recovery.
- The staged route is live-verified in Comet with a six-byte synthetic asset and no ChatGPT request or conversation-body read. With Obsidian intentionally stopped, Downloads still succeeded independently and retained exact bytes `00 01 02 03 FE FF` with SHA-256 `7ea646958715ed687aa9ac2f5d785feb1a93411f4f25fdd6c7fcc6ab07fdf0e3`, while Obsidian returned the fixed preflight failure. After Local REST API resumed, a fresh capture wrote byte-identical content-addressed files to both `D:\Downloads` and the configured Obsidian vault, with no warning or error. The temporary trusted-click smoke content script existed only in ignored generated `dist/`; a clean production rebuild removed it and its manifest entry. Two stale generated duplicate files that blocked Vite output cleanup were removed exactly; no source or user archive was deleted.
- The page-owned ChatGPT attachment boundary now has a separate post-persistence opaque resolver observer for the experimental replay route. It opens only after at least one destination has durably written and reverified the initial replay raw. Because ChatGPT defers attachment rendering in hidden documents, the trusted-click observer tab is briefly foregrounded and then exact-closed. The exact marker-gated hook checks only the native plural request URL/method, credentials mode, boolean authorization membership, status, and JSON media type; it reads no plural source body or header value and dispatches zero singular graph requests. A live foreground smoke proved that the earlier two-second window could still open after ChatGPT's cached UI had already requested its image. The corrected state machine starts a dedicated non-extendable eight-second window immediately before the eligible plural source fetch and publishes only after both source `200 JSON` validation and window expiry, in either order. Current public ChatGPT bundles then exposed a second compatibility gap: manual `Vbt` uses `/files/download/{file_id}` with an optional same-conversation `check_context_scopes_for_conversation_id`, while automatic file display/cache can use `/calpico/chatgpt/files/{file_id}`. The observer now accepts only the exact legacy two-key query in either order, the exact scoped three-key query in six orders with both IDs equal to the captured conversation, or the exact query-free Calpico path. Extras, duplicates, aliases, fragments, suffixes, and mismatched IDs fail closed. It still accepts at most 32 responses of 64 KiB each. Background independently revalidates exact shape, base64, length, SHA-256, JSON, signed-URL conversation binding, and committed-raw provider-ID correlation before returning an opaque key plus transient URL. Fresh independent reviews found no material P0-P2 defect.
- Destination-honest attachment orchestration remains trusted-click and raw-first: only raw-successful File/Obsidian destinations continue, Clipboard cannot receive archive binaries, and a zero-asset ledger skips resolver work. The legacy file-ID checkpoint remains metric-only and never acquires bytes. Interpreter acquisition is a separate exact route; it fetches resolved bytes immediately before the remaining-only legacy audit, shares one bounded budget across families, stages once, and writes destination-specific manifest/canonical truth.
- The Standard Codex Security scan of revision `3aa2e8d` reported one medium and six low findings with partial repository coverage. Static follow-up confirmed the useful engineering claims while narrowing the ChatGPT navigation consequence. This working tree closes four relevant boundaries: Deep Research identity is now SHA-256 content-addressed rather than title-only; collision-renamed Obsidian notes use the same resolved namespace for images and wikilinks; common credential aliases are removed from canonical provider extensions and URL queries; and temporary ChatGPT capture is conversation-bound. These fixes are offline-verified but not yet live-browser verified.
- Legacy Markdown warnings now distinguish retained attachment references/metadata from binary files. They no longer imply that omitted attachment bytes were saved merely because canonical JSON succeeded.
- Obsidian archive companions are transported to Local REST API as `application/octet-stream` while retaining `.json` filenames and manifest media types. This avoids the plugin's `application/json` parser/re-serializer and preserves exact bytes for binary readback. Obsidian-only and immediate File+Obsidian live smokes produced Markdown plus raw/manifest/canonical companions; each raw matched its manifest byte length and SHA-256, and all three archive files were byte-identical across Downloads and Obsidian. Fixed allowlisted stage codes report preflight/PUT/readback failures without exposing paths, identifiers, API responses, or exception text.
- `npm run build` and platform lint pass. ESLint has no errors and three pre-existing warnings outside the first-release changes.
- DeepSeek archives/verified attachments and Obsidian API-key hardening were integrated by [PR #10](https://github.com/la4ox/liska-threadkeeper/pull/10), merged at `ef24f3e` in current Git history. The earlier separate draft PR #8/#9 and pending combined-smoke statements are historical: commit `d30d666` records the successful 2026-10-01 File+Obsidian canary with byte-identical raw/manifest/canonical/binary artifacts. Runtime secret reads remain fail-closed; popup saves use the validated, serialized worker route. This is a history reconciliation, not a newly run live check or a release claim.
- ChatGPT checkpoint [PR #7](https://github.com/la4ox/liska-threadkeeper/pull/7) is merged at `588d390`. The later combined DeepSeek/Obsidian integration is anchored by `ef24f3e`; release/tag decisions remain explicit.

## Important limits and risks

- Obsidian browser sync currently sends the bearer over unencrypted HTTP on the local loopback interface because the extension service worker cannot use Comet's tab-scoped certificate exception. The Local REST API binding and Liska's privileged URL validation both restrict this route to exact host `127.0.0.1`; never expose or rebind it to a LAN or Internet interface. HTTPS remains enabled for clients that can explicitly trust the plugin certificate.
- ChatGPT no-scroll current-branch export is live-verified in Comet. DOM/scroll extraction remains a marked fallback for unsupported browsers, provider drift, unavailable document-start state, oversized payloads, and any failed integrity/normalization/projection check.
- The first trusted-click attachment stress smoke on a long branch/voice/Deep-Research conversation failed before raw capture with the stable `conversation-request-timeout` code. The attachment orchestrator therefore never observed resolvers, fetched bytes, or wrote a destination manifest. Read-only structural diagnostics found only six rendered turn nodes; the 479,837-character `client-bootstrap` JSON contained route/session metadata but no `mapping`, `current_node`, or conversation graph. The 142 public JavaScript modules already loaded by that ChatGPT build contained no literal legacy `backend-api/conversation` route. A user-approved reload of only a duplicate test tab, observed without request/response bodies, headers, cookies, or message text, identified the replacement page-owned request: `GET /backend-api/conversations/{conversationId}?include_has_versions=true&num_turns=10`, returning `200 application/json`. The legacy singular endpoint was not requested. Both branch controls enter the same structured capture before catalog construction, so branch count did not cause the timeout; `Choose branch` merely refused the partial DOM fallback. The `num_turns=10` request may itself be partial, so its response structure must be classified before Liska can mark any graph complete. The first CDP buffer no longer retained that response body when structural-read approval arrived; no raw body was read or saved. Later approved reloads, including a cache-bypassing reload whose cache setting was immediately restored, reused provider-managed page state and emitted no plural conversation request. A separately created ephemeral tab, armed on the neutral ChatGPT origin and closed after one target navigation, also inherited that shared state and emitted no plural request. This drift motivated the separate `A-strict` opaque-template experiment rather than another DOM-scroll fallback.
- A read-only static inspection of the locally installed green AI Exporter `4.4.1` package explains its fast `718/718` preview without reading browser storage or message content. Its document-start page-world bridge wraps ChatGPT `fetch`, captures the value of `Authorization` plus `chatgpt-*`/`oai-*` headers in page memory, exposes them to the content script, reads `oai-did` from `document.cookie`, and explicitly performs `GET /backend-api/conversation/{conversationId}` with those headers and `credentials: include`. It therefore bypasses the virtualized `num_turns=10` UI path and still receives a full `mapping` from the legacy singular endpoint in one request. Its parser does not preserve that graph: by default it selects the reachable leaf with the greatest `message.create_time`, flattens the root-to-leaf path, and never consults `current_node`. An internal `otherBranchMessages` projection exists behind `includeAllBranches`, but no ordinary caller enabling it was found; the preview count is not proof that alternative branches were retained.
- The green AI Exporter preview handoff itself is local: the flattened result is stored in extension IndexedDB `chatPreviewDB.chatMessages` with a default seven-day retention and then opened by ID. Its privilege/privacy surface is much wider than Liska's: `*://*/*`, `cookies`, document-start injection, captured bearer/device headers, Google Analytics, remotely enabled Sentry, and header-rewriting rules for Notion/Googleusercontent. PDF export explicitly sends the normalized message payload to `api-service.saveai.net/api/v1/make/power/pdf` (or its unauthenticated limit route) and downloads the returned URL. Explicit Notion export similarly uploads Markdown before importing it. Routine preview creation was not found to upload the conversation body, but ChatGPT conversion failures may send structural context such as mapping counts and root/leaf node identifiers to Sentry; success telemetry also leaves the machine.
- A focused Sol Max architecture review recommends an `A-strict` active-capture experiment and rejects explicit credential extraction as a fallback. The marker-gated MAIN closure may retain a clone of one exact branded plural-conversation `Request` only after verifying exact origin/path/query/UUID, no `fetch(request, init)` override, acceptable credentials, and boolean authorization-header presence. A new singular-endpoint `Request` may copy that `Headers` object opaquely inside the same page realm, but must not read, iterate, serialize, log, message, or store header/cookie/token values. It must use a fresh abort signal, exact same-origin URL, `GET`, `redirect: error`, `cache: no-store`, one dispatch, no retry, and the captured previous fetch. Explicit bearer/device extraction like the green exporter remains forbidden. The strongest residual risk is operational rather than Fetch semantics: provider-managed warm state may suppress every eligible template request in a disposable tab.
- The disabled-by-default `Experimental ChatGPT metadata probe` is implemented without active replay. It has a separate exact message/response contract, a 45-second page deadline inside a 50-second disposable-tab envelope, and exact late cleanup. Two initial warm Comet runs against the current ChatGPT build reached the exact branded plural request and returned `init-present`; after adding value-free RequestInit classification, two further runs after a full extension/page reload both returned `eligible-init-empty` in 6–6.5 seconds with Obsidian intentionally stopped. The probe made zero singular dispatches and exported nothing. A live-discovered ordering bug that required a reachable Obsidian output before the no-output probe is fixed and regression-tested. The MAIN observer classifies RequestInit without reading property values: only absent, null/undefined/ordinary empty, or ordinary exact `signal`-only shapes can proceed to response metadata; header/body/method/credentials-bearing, unknown, custom-prototype, polluted-prototype, throwing Proxy, and malformed shapes fail closed. Exact origin/path/raw query and GET are established before `Request.clone()`, so cross-origin/query/fragment/POST mismatches cannot tee a body. The observer reads only the non-secret credentials mode, boolean `Headers.has('authorization')`, response status, and JSON media type; it never reads request-header values, cookies/storage, or response/conversation bodies. `singularDispatchCount` is structurally fixed to zero, and exact bridge validators reject enumerable, non-enumerable, and symbol extras. Independent review found and rechecked lifecycle, URL-primordial/original-fetch transparency, prototype-pollution, exact-shape, and pre-clone-gating fixes as ready. A transparently lying Proxy remains a documented JavaScript limitation in the current no-replay diagnostic.
- The disabled-by-default replay switch now means **force replay directly**. In normal mode the passive observer waits 15 seconds for a graph request; only `conversation-request-timeout` permits one automatic replay. A claimed request receives its own 180-second response window and is never replayed. Probe and force-replay remain mutually exclusive; each replay dispatches at most once. Explicit replay failure stays fail-closed, while a failed automatic fallback may still produce the existing honestly marked DOM current-branch export. The previously verified stress capture retained its complete 1,083-node graph without credential or signed-transport residue.
- The catalog and writer no longer multiply shared prefixes, but the picker still renders every leaf option in the page DOM; hundreds are covered offline, while extremely wide graphs may eventually need a virtualized list. File Downloads can externally uniquify a manually colliding filename without returning the actual name; capture-scoped UUID filenames make ordinary collisions negligible, but that adversarial collision remains unverified and suppressing the index cannot yet be guaranteed for File as it is for Obsidian.
- Earlier generic `capture-failed` results on project/custom-GPT and ordinary chats were reproduced as an SPA sender-URL mismatch and resolved by the bounded same-origin authorization fix. Fresh legacy, branch-heavy, large, and Canvas smokes did not reproduce those fallbacks. Future provider drift still falls back safely: with auto-scroll disabled, Markdown contains only the rendered DOM subset and is marked `dom-fallback / partial`; user-visible warnings expose only stable stage/error codes.
- Successful ChatGPT structured capture now writes immutable raw JSON, its credential-free manifest, and canonical `liska-thread/1` as separate companion files under `_liska-archive/<opaque-conversation-key>/<capture-id>/` for each selected durable output. Downloads use private Blob URLs rather than data URLs; Obsidian writes are binary-read-back and SHA-256 verified; Clipboard never receives archive bytes.
- Live sub-16-MiB captures produced all three Downloads companions, matched raw SHA-256 to their manifests, retained complete graphs/branches, and generated canonical archives. Markdown frontmatter records `capture_mode: structured-api` and `capture_completeness: complete` while explicit warnings enumerate content that the legacy renderer omits.
- Raw and manifest persistence precede normalization. If provider normalization fails, those two companions remain downloadable for deterministic offline repair; canonical is appended only after normalization succeeds. Deep graph validation is iterative, so long linear conversations no longer overflow the JavaScript call stack.
- The first temporary-tab implementation bounds a single ChatGPT conversation response to 16 MiB and holds a base64 transfer transiently in memory. The largest current live sample is already 13,117,554 bytes, leaving limited headroom. Larger captures need staged local persistence instead of silently raising or hiding the limit.
- Live resolver evidence now contains five empty bounded outcomes and closes the passive-observer experiment. An older seven-reference conversation produced two immutable byte-identical 1,472,828-byte raw captures because a browser-control timeout obscured the first successful click; no files were removed. A newer conversation produced background, foreground, eight-second pre-dispatch, and strict multi-route captures, each with one 1,284,848-byte raw, 17 manifest/canonical references, complete graph/messages/branches, zero attempted/local claims, zero binary files, clean durable transport scans, and no leftover marker tabs. The final run observed the foreground marker lifecycle from zero to one and back to zero while allowing both current public endpoint contracts, yet still received no resolver response. Its verified raw contained eight `sediment:` pointers and no estuary/signed URL, while the active page structurally displayed one direct estuary image. A credential-free scan of the current public React Router manifest and 264 conversation JS modules confirmed that ChatGPT's typed `safeGet` client owns the resolver routes; no private response, cookie, or chat text was used. Current runtime evidence therefore shows that these calls do not surface through the tested `window.fetch` observer path. Real resolver/acquisition, signed-URL lifetime, real attachment MIME behavior, and forced MV3-suspension recovery remain gaps. One asset is capped at 64 MiB until Obsidian upload/readback becomes fully streaming; chunks remain 512 KiB and no whole-asset base64 message is created.
- The first active metric-only trusted-click smoke completed on a short current conversation whose rendered page contained seven direct estuary images. One stale pre-reload click failed before settings read with `Extension context invalidated`, created no marker tab, and wrote nothing. After reloading that page, one real click opened exactly one active marker tab and exact-closed it without duplicates. File output produced one Markdown plus raw/manifest/canonical companions and zero binary files. The 1,284,848-byte raw matched its manifest length and SHA-256, retained 280 graph nodes, and projected complete structured Markdown with 83 messages. Manifest and canonical each retained 17 assets, all `not-attempted`, with zero attempt timestamps, local paths/artifact refs, or acquired hashes. Structural scans of durable JSON found zero provider-ID/auth keys, resolver bodies, transport pointers, estuary URLs, or signed-query values. The short count-only toast expired before observation, so a positive `observed N/M` result is not yet proven and the smoke must not be repeated blindly. The same internally reconstructed safe warning is now duplicated to a local `[G2O]` console entry and the final destination manifest. Both contain only counts; IDs, URLs, response bodies, and conversation content remain excluded. Invalid, negative, reversed, non-integer, or over-cap metrics fail archive finalization rather than persisting.
- One fresh post-reload capture read the durable v1 metric exactly once: `ChatGPT active resolver observed 0/16; binary acquisition remains disabled.` The capture again produced one Markdown plus three archive JSON files and zero archive binaries. Raw retained 280 nodes and matched manifest length/SHA-256; Markdown remained `structured-api / complete` with 83 messages; all 17 manifest/canonical assets remained `not-attempted` with zero attempted/local evidence. Durable structural scans again found zero resolver/auth/provider keys, transport pointers, estuary/signed URL values, or signed-query values. The metric proves that settings were correct, raw verification succeeded, 16 exact ledger-derived IDs were planned, and zero validated resolver responses reached content. It does **not** distinguish a safe early runtime failure from 16 dispatched requests with zero valid responses because metric v1 omitted failure code, dispatch count, and outcome histogram. This is a telemetry gap, not user error and not yet a conclusive route failure.
- Audit v2 now preserves the existing background result without widening the privacy boundary. A completed diagnostic becomes one exact aggregate line containing requested, dispatched, observed, and a stable eleven-code outcome histogram. An early or otherwise incomplete failure instead records `dispatched=unknown`, `outcomes=unavailable`, and one allowlisted stable failure code; it never fabricates dispatches or per-ID outcomes. The detailed line is reconstructed from strictly validated numbers/enums only and is stored in the destination manifest; the toast remains short. Provider IDs, timestamps, URLs, statuses, headers, bodies, exception text, and conversation content are not representable in the durable metric. Invalid counts, keys, totals, ordinal arithmetic, origin-stage codes, or failure combinations fail archive finalization. The attachment ledger and binary behavior are unchanged: every record remains `not-attempted`, acquisition/staging stay disabled, and there is still no retry, Calpico fallback, route widening, source-body/DOM capture, or header-value extraction.
- The one approved audit-v2 live run resolved the v1 ambiguity without widening capture. Its exact aggregate was `requested=16; dispatched=16; observed=0; outcomes=observed:0,http-error:0,rejected:16,non-json:0,oversized:0,timed-out:0,not-dispatched:0; failure=none`. Therefore the lifecycle, one-shot command, and all 16 dispatches completed; this was not a settings or early-runtime failure. No resolver response passed the existing safe acceptance boundary. The new package contained exactly Markdown plus raw/manifest/canonical, no binary files; raw matched the manifest byte length and SHA-256; all 17 manifest assets remained `not-attempted` with zero attempted/local evidence. The aggregate `rejected` code intentionally does not retain whether rejection occurred in native fetch or later body/URL validation. This active route is now closed as reference-only: do not repeat it, connect acquisition, add a fallback, or weaken the diagnostic boundary.
- The user's plausible endpoint-specific authorization hypothesis justified one narrower follow-up without reading credentials. Generic active `rejected` was removed and split into page-owned `fetch-rejected`, page-owned `response-processing-rejected`, and background-owned `payload-validation-rejected`; MAIN cannot originate the last code. Inventory remains 20-reference-capable while every live diagnostic boundary is physically capped at one deterministic ID. A fresh Sol review found and rechecked a setup/fetch attribution bug: Request-construction failure now terminates promptly as `hook-state-failed` before `dispatchCount` changes, rather than producing a contradictory fetch outcome. The one approved live result was `requested=1; dispatched=1; observed=0; payload-validation-rejected=1`, with every other outcome zero and `failure=none`. Therefore Request construction and fetch succeeded, ChatGPT returned `200 JSON`, page-side bounded clone/body/hash processing succeeded, and rejection occurred only in background payload validation. The output contained exactly three capture JSON files plus Markdown; raw matched manifest length/SHA-256; all 17 assets remained `not-attempted` with zero attempted/local evidence; no binary existed; `Syncing` ended and the marker tab exact-closed. This rules out a fetch-level absence of authorization but does not rule out an endpoint-specific authorization/error envelope encoded as `200 JSON`. The remaining likely boundary is a missing/changed `download_url` or a signed URL that fails exact conversation binding. No automatic retry is permitted.
- A fresh neutral-page inspection of 57 already loaded public ChatGPT scripts—without a conversation route, private response, storage, cookie, or header read—identified the concrete mismatch behind that payload result. Current `SendIfAvailable` file helper keeps preview mode (`conversation_id` plus `inline=true`) separate from explicit download mode (`download_intent=true` plus `check_context_scopes_for_conversation_id`); Liska had combined preview and scope parameters into an unsupported hybrid. Current success handling requires `status === "Success"` and then reads top-level `download_url`; `file_not_found` and `file_expired` remain explicit error codes. The local fix now uses exact explicit-download parameters, requires the Success envelope in active and shared passive parsers, and replaces generic background payload rejection with value-free `payload-integrity-rejected`, `download-url-missing`, and `download-url-binding-rejected`. A fresh reviewer found and rechecked the missing-status protocol gap before live use. Default conversations are covered; optional `gizmo_id` for some custom-GPT attachments is not yet derived and remains an explicit limitation.
- The one approved corrected-build smoke returned `requested=1; dispatched=1; observed=0; download-url-missing=1`, with every other outcome zero and `failure=none`. Exact download-mode therefore constructed and fetched successfully, and response bytes passed page processing plus background media/base64/length/SHA validation; no acceptable own `status === "Success"` plus string `download_url` envelope remained. The current value-free code deliberately cannot distinguish `Retry`, `file_not_found`, `file_expired`, another non-success status, malformed JSON, or a protocol-violating Success without URL. Because the deterministic first ledger ID is not freshness-ranked, an old unavailable attachment is a plausible explanation and this result does not show that the corrected route fails for fresh files. Output contained exactly Markdown plus three capture JSON files; raw matched manifest length/SHA-256; all 17 assets stayed `not-attempted` with zero attempted/local evidence; no binary existed; `Syncing` ended and the marker tab exact-closed. No automatic retry is permitted.
- Two separate user-approved clicks on actual visible attachment controls revealed that neither used the file-ID resolver. Each page action issued `GET /backend-api/conversation/{conversationId}/interpreter/download` with only the query keys `message_id` and `sandbox_path`, received `200 application/json`, then fetched a signed `/backend-api/estuary/content` URL and received `200 application/vnd.openxmlformats-officedocument.wordprocessingml.document`. The second helper response was confirmed as a fresh network response; signed DOCX responses were served from the browser disk cache and completed without failure. Query values, file/conversation/message IDs, headers, response bodies, filename, and content were not emitted or retained. Neither click produced a Playwright download event or a new file in `D:\Downloads`, so physical save is not claimed. This independently repeated flow proves that these visible cards are interpreter/sandbox outputs and that ChatGPT attachment acquisition is a discriminated family rather than one resolver: ordinary file-ID download, interpreter `message_id + sandbox_path`, and library-ID download have separate provider contracts. The current active file-ID diagnostic must not be generalized to interpreter/library assets.
- A user-approved real `Скачать файл` action confirmed the provider mechanics: interpreter helper 200, signed-content 200, and a physical valid PDF download. The final fresh Liska canary refined that result: the signed content GET must retain the browser-managed same-origin session. With `credentials: include` and no cookie/header access, one exact DOCX persisted successfully through the same content-addressed staged pipeline.
- Interpreter candidates now come from two exact committed-raw structures: metadata attachments at `/mapping/{node}/message/metadata/attachments/{i}`, or direct assistant-rendered Markdown links whose destination is `sandbox:/mnt/data/...`. Both bind the same-node `message.id`; message/path identity is hashed before it reaches the manifest, so filenames and sandbox paths remain raw-only. User/tool content, arbitrary strings, image syntax, inline/fenced/indented code, malformed/double encoding, traversal, controls, backslashes, ambiguous assets, and unsafe IDs fail closed. Multiple links in one text part receive distinct opaque IDs; exact pairs deduplicate deterministically; the cap remains 20.
- The interpreter adapter is live-verified behind the trusted-click `Export images & attachments` gate on standard `/c/{conversationId}` DOCX and PDF outputs. The pinned helper accepts own-field `status` values `Success` or `success`, ignores extra descriptive fields, and returns only a validated signed URL. Legacy URLs retain UUID `cid` binding; current exact `id,fn,cd,ts,p,cid,sig,v` URLs use numeric `cid` and are bound by the exact same-conversation helper route, pinned document, and committed-raw message/path pair. Content performs one immediate same-origin GET with browser-managed `credentials: include`, `redirect: error`, `no-referrer`, and `no-store`; it never reads or serializes cookies/headers, adds no cookie permission, and never retries. Interpreter bytes are acquired before the remaining-only legacy audit; both families share one 20-attempt/128 MiB budget and persist once. The earlier DOCX canary saved 38,620 verified bytes with valid ZIP entries and exact manifest/canonical evidence. Custom-GPT, library-ID, Calpico fallback, retries, and broad raw/DOM scanning remain unsupported.
- The post-image-fix File-only mixed-attachment canary is live-verified, with **partial overall attachment coverage**. One trusted click after extension/page reload saved a 2,313,476-byte PNG and a 51,741-byte PDF, plus raw (112,121 bytes), manifest (4,377 bytes), canonical (218,453 bytes), and Markdown (15,669 bytes / 16 presentation messages). The PNG is byte-for-byte identical to the separately retained native ChatGPT download, including SHA-256 and its 1448 by 1086 PNG dimensions. Both binaries match actual length/hash/path claims in manifest and canonical; PDF header/EOF passes, without a semantic or visual PDF-review claim. Raw length/SHA-256 matches manifest, and canonical input hashes the exact manifest. Raw and canonical retain identical 36-node / 35-edge graphs, ordered child links, single root/leaf, and current node; all nodes are reachable, with no dangling references or cycles. All six asset IDs, states, and seven raw pointers reconcile across layers. Two assets are `fetched`; the PNG combines two exact raw pointers without duplicate bytes. The prior DOCX and three PNG metadata records remain `not-attempted`, with no attempt timestamps, acquired hashes, or local paths. Their references are preserved; availability or expiration is not established. Manifest warnings are empty, Markdown remains `structured-api / complete`, and the scoped manifest/canonical scan found zero checked runtime resolver/credential keys or signed estuary URLs. Exactly one new capture and one Markdown were added, both older snapshots remain, and no marker tab remains. No Obsidian or clipboard output was requested.
- A long branch-heavy ordinary-chat canary exposed a loss-order bug before attachment acquisition: 267 individually valid asset records included five assistant text parts containing 2, 2, 3, 3, and 4 distinct sandbox links, so the old global one-pointer/one-asset invariant rejected the enriched manifest and discarded an already verified raw response. Source refs now remain unique within each asset, while distinct opaque assets may share one exact raw scalar pointer; ambiguous matching never selects an arbitrary record. The latest post-offscreen-fix strict replay, with acquisition/scroll/append disabled and File-only output, produced raw 9,834,958 bytes, manifest 137,507 bytes, canonical 20,261,613 bytes, and Markdown 2,090,849 bytes. Independent local verification plus parent raw-hash readback confirmed raw length/SHA-256 against manifest and canonical input linkage to the manifest. Raw/canonical have identical node IDs, parent/child edges, roots, and current node: 2,285 reachable nodes, 2,284 edges, 239 leaves, 68 branch points, max fan-out 10, no missing references or cycles. Both retain 267 assets as `not-attempted`, with no acquired binaries and zero manifest warnings. Markdown reports `structured-api`, `complete`, and 927 presentation messages. All outputs are new snapshots; no older export was replaced and no marker tab remained. Canonical has 7,259 diagnostic entries whose message semantics were not audited in this transport checkpoint; their presentation remains separate work. Canonical byte lengths on 243 unacquired assets are permitted provider metadata (`resolvedAssetFields`), not evidence of fetched files; all lack a local artifact reference and acquired hash.
- Structured graph transport now has an explicit `inline | staged` boundary. ChatGPT responses up to 16 MiB keep the live-verified inline route; larger ChatGPT raw responses up to 64 MiB and DeepSeek raw responses above 16 MiB use independently canonical 512 KiB chunks. Background creates a random 192-bit `archive-stage-*` capability in the separate `liska-archive-stages` OPFS namespace, accepts only sequential offsets (or an exact byte-identical acknowledged retry), and seals only after final length/SHA-256 verification. Content reassembles and rehashes raw solely for the existing non-streaming normalizer. Raw remains staged until its selected durable outputs finish; canonical JSON above the 32 MiB inline limit uses the same staged route, while manifest remains inline and never records the stage ID. File/Obsidian paths remain append-only; Obsidian retains binary readback/hash verification. File ownership survives MV3 suspension in a bounded local registry containing only download ID, random stage ID, extension Blob URL, and timestamp. Null callback IDs are never guessed and quarantine exact cleanup for at most 24 hours. Archive-stage messages require the exact top-frame conversation document for their declared ChatGPT or DeepSeek source, while offscreen accepts only the same-extension worker without tab/document metadata. Fresh independent review found no residual P0-P2 issue after source binding, cleanup propagation, and privacy hardening.
- Synthetic staged-graph evidence covers the exact 16 MiB boundary, a complete 20 MiB raw capture, canonical JSON above 32 MiB, UTF-8 split boundaries, duplicate/gap/overlap/conflict handling, OPEN/SEALED retries, exact sender/offscreen gates, cancellation, File/Obsidian release, and fresh-worker terminal recovery without a whole-payload runtime message. A real-provider response above 16 MiB remains unverified. Explicit opaque replay deliberately remains on its existing 16 MiB inline cap rather than becoming an oversized fallback.
- The staged path is now live-verified in Comet after correcting an offscreen-only API mismatch. A zero-byte diagnostic returned `offscreen-worker-entry-unavailable`: Chromium does not expose `runtime.getManifest` to offscreen pages. The exact worker URL is now read once from the installed package's own manifest with a three-second, no-credentials/no-redirect fetch; content tabs and extension documents remain rejected, and no storage operation begins before sender verification. Live zero-byte begin/abort passes. A 16,777,264-byte synthetic stage crossed 33 bounded chunks in 3.792 seconds with an exact SHA-256 readback and acknowledged abort. Two 131-byte synthetic JSON File outputs matched filesystem length/hash; the refined control also proved readable bytes before commit and an unavailable stage after output. No chat data entered those synthetic probes. New live offscreen entrypoint: `offscreen-DFZtwxPD.js`; worker entrypoint: `service-worker.ts-DkgHGaUn.js`.
- The two scan-derived hardening items that remained outside this checkpoint are now closed by later merged work: shared structural budgets bound recursive ChatGPT/DeepSeek normalization, and the all-branches stack bounds source work, planned writes, per-note bytes, per-destination logical/physical bytes, and aggregate physical work. The separate 1 GiB source-work refusal for the known real graph remains an intentional live product limit, not a missing ceiling.
- One earlier settings run attempted an Obsidian archive write after the user had visually disabled that output without a confirmed persisted update. Destination toggles now send an acknowledged popup-only background update, apply an in-memory override before `chrome.storage.sync` completes, and serialize rapid changes. Live Obsidian-only followed immediately by File+Obsidian smokes confirmed the toggle/readback path.
- Automatic scheduled backups are not implemented; every export starts from a real user click.
- Provider-controlled frontmatter strings now quote leading `?`/`,` indicators
  and encode forbidden C0/C1/BOM-sentinel characters as `\\uXXXX`. Existing
  newline/tab/YAML escapes and byte-stable ordinary strings remain unchanged;
  focused coverage includes provider titles, block-sequence tags, append
  parsing and the common note generator used by File, Clipboard and Obsidian.
- DeepSeek images are not captured. The existing attachment pipeline is mainly Gemini-specific and bounded to 20 images, 10 MiB each, and 48 MiB combined base64 data per note.
- Tail-only append-image persistence is offline-verified but still awaits installed Obsidian creation/reuse/refusal and filesystem readback acceptance. It never backfills historical images and does not provide external note CAS.
- DOM-only auto-scroll is intentionally bounded to five minutes. Provider markup changes can still require extractor maintenance.
- The inherited live-E2E authentication/daemon harness was removed. It stored reusable AI sessions and exposed authenticated Chrome through a loopback DevTools port, while providing no CI-backed guarantee for Liska on Windows. Offline extractor fixtures and snapshot tests remain.
- The current visual icon is the inherited purple crystal. A dedicated Liska icon is a separate design task.
- GitHub Pages is intentionally disabled. The privacy policy remains available from its tracked source file.
- Release Please is intentionally removed from the active workflow surface; releases are explicit maintainer actions documented in `docs/maintaining.md`.

## Artifacts

- Loadable unpacked extension: `dist/`
- Current local package: `liska-threadkeeper-3.0.0.zip`, 265,209 bytes, SHA-256 `B0D338765E8DE3DC141A925C5FD16555403FFA146305042233D304389936A3CF`; all 29 packaged files exactly match the final `dist/` tree.
- DeepSeek history client/parser: `src/content/extractors/deepseek-api.ts`
- DeepSeek canonical normalizer and synthetic fixture: `src/archive/normalizers/deepseek.ts`, `src/archive/normalizers/deepseek/`, and `test/fixtures/archive/deepseek-raw/branching-replace.json`
- Provider-neutral inline/staged JSON companion builder: `src/content/capture/json-archive-companion.ts`
- Privacy policy source: `docs/privacy.html`
- Current product and setup guide: `README.md`
- Documentation index: `docs/README.md`
- Maintainer and release guide: `docs/maintaining.md`
- Chat archive pipeline decision and phased plan: `docs/adr/031-loss-aware-archive-pipeline.md`
- Staged large-graph transport decision: `docs/adr/032-staged-large-chatgpt-capture.md`
- Canonical archive core and schema: `src/archive/` and `src/archive/schema/liska-thread-1.schema.json`
- Credential-free raw capture primitives: `src/archive/capture.ts` and `src/content/capture/response.ts`
- ChatGPT verified-byte normalizer: `src/archive/normalizers/chatgpt.ts` and `src/archive/normalizers/chatgpt/`
- Disposable-tab capture primitive and strict runtime contract: `src/background/chatgpt-capture.ts` and `src/lib/chatgpt-capture-contract.ts`
- Staged raw/canonical contract, OPFS store, and MV3 recovery: `src/lib/archive-stage-contract.ts`, `src/offscreen/archive-stage-store.ts`, `src/background/archive-stage-handlers.ts`, and `src/background/archive-stage-download-recovery.ts`
- Marker-gated MAIN-world document-start observer: `src/content/capture/chatgpt-document-start.ts`
- ChatGPT content bridge and current-branch composition: `src/content/capture/chatgpt-current-branch.ts` and `src/content/extractors/chatgpt.ts`
- Destination-honest ChatGPT attachment orchestration: `src/content/chatgpt-asset-export.ts`
- Post-persistence opaque resolver contract/runtime/bridge: `src/lib/chatgpt-opaque-resolver-contract.ts`, `src/background/chatgpt-opaque-resolver.ts`, and `src/content/capture/chatgpt-opaque-resolver-request.ts`
- Active metric-only resolver contract/runtime/bridge: `src/lib/chatgpt-active-resolver-contract.ts`, `src/background/chatgpt-active-resolver.ts`, and `src/content/capture/chatgpt-active-resolver-request.ts`
- Interpreter resolver contract/runtime/bridge: `src/lib/chatgpt-interpreter-resolver-contract.ts`, `src/background/chatgpt-interpreter-resolver.ts`, and `src/content/capture/chatgpt-interpreter-resolver-request.ts`
- Synthetic ChatGPT raw fixture and end-to-end projection test: `test/fixtures/archive/chatgpt-raw/branching-mixed-content.json` and `test/content/chatgpt-archive-pipeline.test.ts`
- Canonical-to-legacy branch adapter: `src/content/archive-projection.ts`

## Historical ChatGPT integration checkpoint

Combined [PR #10](https://github.com/la4ox/liska-threadkeeper/pull/10) merged
into `main` at `ef24f3e`. This section records the compatibility starting point;
later checkpoints in this file, not the historical
`codex/chatgpt-2026-10-compat` branch name, describe current merged state.

The current ChatGPT compatibility slice repairs the October 2026 page request
shape without weakening the loss-aware archive boundary:

- replay/probe accept a bounded plain own-data `HeadersInit` record as well as
  the established native Request path. Header names and values remain inside the
  document-start MAIN-world closure and never enter messages, logs, storage, or
  diagnostics;
- the page's original fetch receiver, arguments, synchronous exception, and
  returned promise remain unchanged. A singular Request is constructed once and
  dispatched at most once, only after the page-owned plural source resolves as
  exact `200 application/json`;
- source authorization now uses captured native `Response.url` and
  `Response.redirected` getters. The final response must be an unredirected exact
  `https://chatgpt.com/backend-api/conversations/{selectedId}` URL with one of
  the two allowlisted raw query orderings. Empty, malformed, redirected,
  cross-origin, wrong-ID, extra-query, and post-WebIDL base-mutation cases fail
  closed before replay;
- string inputs resolve through a captured genuine `Node.prototype.baseURI`
  getter and are rechecked after the single init/header classification pass.
  Network-path references are rejected; native Request handling is unchanged;
- plain-header snapshots are bounded to 64 fields, 128-byte names, 8 KiB values,
  and 32 KiB aggregate text. Accessors, symbols, inherited pollution, invalid
  bytes, duplicate case-folded names, unstable reflection, and unsupported
  prototypes fail with fixed enum-only diagnostics;
- passive and active resolver modes retain their earlier strict eligibility.
  Interpreter transport alone accepts the confirmed October 2026 source shape:
  a primitive string or genuine native Request with a bounded plain own-data
  header override. It uses only the captured override, requires authorization
  membership without reading its value, allows only `include`/`same-origin`
  credentials, and never clones or consumes the page Request;
- interpreter queue ownership is now explicit across fetch, response-body read,
  and SHA-256 calculation. One per-item timer covers the entire operation; late
  completions cannot advance the queue or overwrite terminal state. A failure
  before the first helper dispatch preserves its fixed run error instead of
  collapsing to `not-dispatched`; once any helper request was dispatched,
  partial ordinal evidence remains authoritative;
- the old generic page timeout is split into `target-not-observed`,
  `source-response-timeout`, and `replay-response-timeout`. Background timeout
  remains explicitly ambiguous. No retry, cache-bypass reload, token/session
  route, active-tab mutation, DOM fallback substitution, or guessed branch was
  added;
- persistence logging now emits only destination enums and success booleans.
  Filenames, paths, note bodies, warnings, errors, response objects, credentials,
  and archive content are excluded.

Live Comet verification on a private 232-message ordinary ChatGPT conversation
completed three successive final-phase exports, including an immediate warm
repeat. The final response-URL-gated build produced a fresh snapshot in both
Downloads and Obsidian:

- raw `conversation.json`: 2,684,770 bytes;
- manifest: 1,884 bytes;
- canonical `liska-thread-1.json`: 4,434,199 bytes;
- complete graph: 453 nodes, one root, current node present, two preserved asset
  references, zero manifest warnings, and `graph/messages/branches = complete`;
- Downloads and Obsidian raw/manifest/canonical copies have identical SHA-256
  values inside the snapshot;
- Markdown was written to both destinations. Downloads retained the ordinary
  547,823-byte form; Obsidian retained the configured flattened 546,535-byte
  form;
- each successful run received a distinct random capture ID and a new archive
  directory. Older snapshots were not replaced, and no marker tab remained.

One earlier warm run on a pre-phase-diagnostic build ended in the old generic
timeout. The exact phase was therefore not recoverable. It did not write a
partial snapshot, and the timeout did not recur in the later cold/warm/final
sequence. This remains an explicit reliability observation rather than a reason
for an automatic retry.

The interpreter attachment compatibility slice is now live-verified on a
private standard ChatGPT conversation containing both current and older
interpreter assets. The metadata-only probe observed the exact
`eligible-init-plain-headers` request class. After an extension and page reload,
three successive trusted-click exports produced new immutable snapshots in both
Downloads and Obsidian:

- raw `conversation.json`: 112,439 bytes;
- manifest: 4,354 bytes;
- canonical `liska-thread-1.json`: 218,585 bytes;
- complete graph: 36 nodes, one root, current node present, six preserved asset
  references, and `graph/messages/branches = complete`;
- one current PDF was fetched through the page-owned interpreter flow and saved
  as a 51,741-byte content-addressed binary. Its manifest length and SHA-256
  match the file; it begins with `%PDF-1.4`, and Poppler parses one unencrypted
  A4 page;
- one older interpreter asset returned HTTP 404 and remains explicitly
  `not-attempted`; four PNG inventory records also remain honestly
  `raw-inventory-not-attempted`. Overall asset completeness is therefore
  `partial`, without inventing missing bytes;
- raw, manifest, canonical, and PDF copies are byte-identical between Downloads
  and Obsidian. Repeated exports retained the same PDF hash while creating new
  capture directories; older snapshots were not replaced;
- manifest/canonical scans contain no authorization or cookie fields, bearer
  token, signed-query parameter, signed OAI URL, or `download_url` field;
- the temporary metadata probe was restored to off and strict replay to on.

A content-free follow-up over the four unresolved PNG ledger entries found
usable identities rather than a settings/routing regression: three have one
accepted direct metadata ID, and the fourth has two equivalent `sediment:`
pointers for one identity. All four are unique active-plan candidates and none
is interpreter-eligible. They remained `not-attempted` because the passive
eight-second observer saw no matching page-owned resolver request for these
historical/lazy assets.

The active file-ID route is now live-verified through its first bounded
data-bearing adapter on a separate ordinary ChatGPT conversation with a freshly
visible generated PNG. Its complete graph has 35 current-path nodes and six
image ledger records. A pure committed-raw plan resolves whole-ledger identity
strength and ambiguity before choosing exactly one eligible PNG; interpreter
ownership wins first, the selected active identity is never retried passively,
and passive matching keeps the complete ledger until after winner selection so
a weaker pointer alias cannot trigger a duplicate fetch. Any unsupported
nonempty direct identity fails closed before sibling or pointer fallback in both
passive and active evidence families.

The helper remains the one page-observed
`/backend-api/files/download/{id}` route with exactly `conversation_id`,
`inline=false`, `download_intent=false`, and
`include_library_file_state=true`. It reuses closure-private source
authorization only inside MAIN, copies no credential outside that closure, and
has no retry, endpoint fallback, route discovery, or concurrent dispatch. Background
rebinds the signed URL to the exact transient plan; the existing downloader then
verifies response URL, media type, PNG bytes, length, and SHA-256 before
destination-specific persistence can claim `fetched`.

A local static interoperability review of installed AI Exporter 4.6.0 explained
its apparent speed without adopting its broader trust model. It captures the
same conversation API, hydrates every mapping image through the same helper
family with `inline=true`, and uses up to six workers while silently skipping
individual failures. It also retains authorization/device headers in its own
runtime, has broad background image-fetch permissions, may compress images, and
chooses the newest reachable leaf rather than ChatGPT `current_node`. Liska
keeps its closure-private authorization, explicit current/selected branch,
original-byte verification, sequential acquisition, and honest failure states.
One same-identity live A/B changed only `inline=false` to `inline=true`; both
modes returned the same `http-error`. The experiment was fully rolled back, so
no second-mode fallback remains.

Two final-build trusted-click exports completed independently. The warm canary
receipt was `requested=1`, `dispatched=1`, `observed=1`, with every failure
bucket zero. It wrote raw 82,854 bytes, manifest 4,734 bytes, canonical 186,521
bytes, and one 1,474,502-byte PNG (1122 by 1402) to both Downloads and Obsidian.
All four companion/binary files were byte-identical across destinations; the
Markdown views were also byte-identical at 25,894 bytes. Manifest and actual
PNG length/SHA-256/path agree, one asset is `fetched`, and five remain honestly
`not-attempted`. The same content-addressed PNG hash repeated across both
immutable captures. Durable manifest/canonical scans found no selected provider
identity or transient signed URL, and no marker tab remained.

A bounded content-level batch now selects at most four distinct ordinary PNG
identities while leaving every background/MAIN transaction single-item. It runs
strictly sequentially, assigns ownership before dispatch, immediately acquires
each successful candidate through the shared 20-attempt/128-MiB budget, excludes
all selected identities from passive retry, and stops before another helper when
the shared attempt or byte budget is exhausted. One aggregate durable audit
preserves completed outcomes, known dispatches, unknown-dispatch run failures,
and allowlisted terminal counts without IDs, URLs, timestamps, or bodies. Its
caller-owned inputs are snapshotted once through own data descriptors before
validation and formatting; iterator, accessor, Proxy-get, repeated-descriptor,
and sparse-array attacks are covered.

The historical four-PNG canary then selected and dispatched all four identities:
three returned `http-error`, while the fourth produced a verified 2,313,476-byte
PNG (1448 by 1086). Its opaque ID and SHA-256 exactly match the one unique PNG
that older captures had fetched, proving historical availability without
inventing expiry for the other three. The current 51,741-byte PDF also remained
fetched. Downloads and Obsidian each retained five byte-identical archive files
plus byte-identical Markdown; all temporary tabs closed.

Structural reconciliation showed that three failed records had tool-role
`metadata.attachments` names shaped as `liska_pdf_render/page-N.png` or
`liska_docx_render/page-N.png`, consistent with transient document previews in
that historical sample. The first policy marked the exact role/MIME/name shape
`declined`, but it had no affirmative source-document relationship. A later
security reconciliation removed that filename-derived exclusion: role, MIME,
name, adjacency and provider-key aliases cannot by themselves authorize binary
omission. Such PNGs now remain ordinary `not-attempted` records, retain opaque
identity and every exact sourceRef, and stay eligible for the existing bounded
resolver/acquisition paths. This can spend an existing PNG slot on a historical
thumbnail but does not expand attempts, bytes, retries or endpoints. Generic
explicit `declined` records remain supported downstream for a user decision or
a future policy with structural proof.

The old canary that retained three previews as `declined`, two assets as
`fetched`, and one document as `not-attempted` remains historical evidence of
the retired heuristic. Current regression evidence instead uses an isolated
preview-shaped PNG with no source document: inventory reports
`not-attempted`, completeness remains honest, and active planning accepts the
asset. Raw and canonical losslessness continue to be the repair authority.

The fresh canary selected its two eligible PNG identities and fetched both:
1,474,502 and 1,429,642 bytes, each a verified 1122-by-1402 PNG. The first hash
matches the earlier one-PNG canary; the second had previously remained
`not-attempted`. Raw/manifest/canonical plus both binaries and Markdown were
byte-identical between Downloads and Obsidian, with no leftover marker tab.

Ordinary JPEG support now has a fail-closed, live-verified boundary. A
content-free structural pass over the latest
committed raw snapshot found one ordinary JPEG represented by a direct metadata
ID plus a `sediment:` pointer alias, and a separate JPEG record carrying an
explicit Library ID. The ordinary planner now resolves the whole evidence
ledger before eligibility and refuses every provider identity associated with
`library_file_id` or `libraryFileId`; `source: local` alone is deliberately not
treated as Library ownership. The deny set is applied before both active and
passive winner selection, so an ambiguous Library record cannot disappear and
promote a weaker pointer alias. Multi-ID and unsupported-direct evidence is
retained in the same deny-only whole-ledger pass instead of disappearing before
strength selection. Library assets therefore remain for their own later
contract instead of being sent through the ordinary file-ID helper.

Fetched PNG/JPEG claims now require bounded structural byte validation before
hashing and persistence. PNG checks cover signature, chunk lengths and CRCs,
IHDR/palette/data ordering, and terminal IEND. JPEG checks cover complete 8-bit
Huffman baseline, extended-sequential, and progressive marker/table/scan
structure, including immutable quantization values across progressive scans.
This is intentionally a container/codec-structure check rather than pixel
decoding: zlib and DCT coefficients are not rendered. Other already supported
binary MIME families retain their existing validation contracts.

The controlled live JPEG canary then completed through the unchanged ordinary
file-ID helper. Its durable audit recorded `selected=1/4`, one known dispatch,
one observed resolver response, and zero run failures. Downloads and Obsidian
each retained the same four byte-identical files: 2,684,770-byte raw JSON,
2,624-byte manifest, 4,434,340-byte canonical JSON, and one original
188,009-byte JPEG. The JPEG is an 8-bit baseline SOF0 image measuring 1015 by
1536; its content-addressed `.jpg` path, length, and SHA-256 reconcile across
actual bytes, manifest, and canonical archive. One second JPEG remains honestly
`not-attempted`, so asset completeness is `partial`. Manifest/canonical scans
found zero credential keys, signed transport URLs, `sediment:` or
`file-service:` values. A separate older JPEG fixture currently fails before
raw capture with `opaque-replay-source-http-error`; it produced no new output
and was not retried. The generated trusted-click smoke hook was never added to
source or packaging and was removed after verification.

Content-free archive reconnaissance found no ordinary GIF example and exactly
one WebP record among the newest snapshots for 16 distinct conversation IDs.
That WebP is a pointerless `metadata.attachments` record with explicit
Library-ID evidence; no `.webp` binary was present in its capture. It therefore
does not justify widening the ordinary active image allowlist and instead
becomes evidence for the separate Library contract.

A separate bounded scan of one 191,352,495-byte official-export shard found
four exact `image/webp` attachment records across four conversations and no
`image/gif`. All four sit at `message.metadata.attachments[]` with a direct ID,
declared size/dimensions/source and MIME; none carries `library_file_id`,
artifact, file-service, sediment or interpreter markers. Live navigation
classified the available surfaces more narrowly: two ordinary `/c/...` IDs are
currently unavailable, while the other two resolve to accessible project
routes under `/g/g-p-.../c/...`. Those project records are useful evidence for
the separate owner-context binary-acquisition contract, but still do not
authorize ordinary WebP acquisition. No resolver response or original WebP
bytes were observed.

The first offline Library checkpoint classifies only ledger records reached by
their exact committed-raw source references. Its exported result contains only
opaque asset IDs split into `associated` and `ambiguous` sets; Library ID values
never leave the pure classifier, and no request, URL, endpoint or acquisition
authority is created. Empty aliases and `source: local` alone prove nothing;
conflicting aliases, malformed values, duplicate ledger IDs, missing or
duplicate raw pointers and malformed conversation artifact IDs fail closed as
ambiguous. Separate assets that share one Library association are not merged.
Synthetic inventory plus content-free checks against the saved Library JPEG and
pointerless WebP originally kept both assets `not-attempted` with null local
claims; that frozen offline checkpoint remains the no-authority baseline.

Canonical privacy now treats exact Library, gizmo, project and conversation
template identifier aliases as raw-only structured provider context. Direct and
nested values are omitted with fixed value-free diagnostics at exact raw
pointers. Root gizmo/template evidence retains only `isCustomGpt: true` and
`hasConversationTemplate: true`; authored text, ordinary provider fields, raw
bytes, opaque asset IDs, source references and acquisition states remain
unchanged. Custom-GPT/project ownership remains explicitly unimplemented.

The first live Library transport observation proved that ChatGPT's preview
downloads a `blob:https://chatgpt.com/...`, while the underlying page-owned
flow uses `/backend-api/files/download/<direct attachment id>` and a transient
signed `/backend-api/estuary/content` URL. A browser-owned content GET returned
200; the same signed URL without the authenticated browser session returned 403. The contract therefore reuses the existing MAIN-world credential-bearing
resolver and content-script acquisition seam; it never exports cookies,
Authorization headers, signed URLs or Library IDs and never moves the signed
URL into a background fetch.

The initial production-path canary correctly left the Library JPEG
`not-attempted` and exposed a stricter-than-intended collision rule: a separate
pointer-only inventory record referenced the same provider file as the exact
Library metadata record. The fix permits only that weaker pointer-only alias;
malformed, unsupported, Library-bearing or nonempty direct siblings still fail
closed. Independent review also found and closed a separate merged-ledger
interpreter-precedence defect before the successful canary.

The successful trusted-click canary produced capture
`capture-chatgpt-4bb552a8-ce71-43ce-ae2a-b8632e9a0c4b`. It selected four of four
active slots: one Library JPEG and three ordinary images, with four known
dispatches, four observed helpers and no run failure. The Library JPEG is 9,949
bytes at SHA-256
`29c102f25e517ef317efcd548d120335fd7d146ed42b1482eac8b075be4dcebb`;
it is byte-identical to ChatGPT's own preview download and passes the existing
155 by 194 JPEG structural validator. A second 145,482-byte ordinary JPEG and
two PNGs were also preserved. File and Obsidian contain seven of seven
byte-identical raw/manifest/canonical/binary files. `library_file_id`, signed
transport URLs and credential/header markers are absent from manifest and
canonical output; the immutable raw retains original provider evidence.

The installed extension was returned to its pre-canary `dist` with the exact
29-file tree hash
`8d74d2458ec5f5a6fa978f574ef07896f0f657fa2af539a1df3a21066286d955`.
Temporary screenshots, browser-History copy and both canary builds were removed;
captures remain append-only.

Final exact-tree validation for the combined Library slice passes all 153 test
files / 4,292 tests. Coverage is 95.23% statements, 90.99% branches, 98.47%
functions and 97.72% lines. TypeScript, the production build, source/platform
lint and repository formatting pass; lint retains the same three pre-existing
warnings. The package has 29 of 29 files byte-identical to `dist`, is 228,231
bytes and has SHA-256
`c18d0af1ac2e7a37286d8e83222ba628557fb5379e1e21a4aa044cf07eafcd2c`.
Independent review found and closed the merged-ledger interpreter-precedence
and pointer-alias ambiguity defects, including interpreter ownership on a
separate alias record. GitHub review then exposed and closed nested-envelope
pointer and owner-selection gaps; the final pass found no remaining P0-P2.

Exact-tree validation for this offline Library checkpoint passes all 152 test
files / 4,216 tests. Coverage is 95.20% statements, 90.93% branches, 98.45%
functions and 97.70% lines. TypeScript plus the production build, formatting
and lint also pass; lint retains the same three pre-existing warnings. An
independent review of the complete offline Library checkpoint found no P0-P2 or
material P3 issue and confirmed that this slice creates no acquisition
authority.

Final exact-tree validation for this JPEG slice uses Node 24.18.0 and npm
11.16.0. All 152 test files / 4,192 tests pass; coverage is 95.20% statements,
90.90% branches, 98.45% functions, and 97.70% lines. TypeScript, the production
Vite build, source/platform lint, repository formatting, and ZIP packaging pass;
lint retains only the same three pre-existing advisory warnings. The final ZIP
contains the same 29 files as `dist`, with zero list/hash differences; it is
226,744 bytes with SHA-256
`7348510F48EBE52EA297B88384B469FAE7D421822D0C5C8E3091B8C9A876CAB6`.
Release-to-local reproducibility comparison remains unavailable because no
published `v3.0.0` GitHub release exists. Independent review found no residual
P0-P2 issue after the Library/multi-ID/unsupported-direct whole-ledger fixes.

Fresh exact-tree validation on `codex/upstream-2.14.9-audit`:

- Node 24.18.0 and npm 11.16.0 match the project contract;
- 150 test files / 4,114 tests pass;
- coverage passes at 95.17% statements, 90.73% branches, 98.42% functions, and
  97.65% lines;
- TypeScript, the production Vite build, extension ZIP packaging, source lint,
  platform-registry lint and repository formatting pass; lint retains only the
  same three pre-existing advisory warnings;
- the ZIP contains exactly the same 29 files as `dist`; every hash matches and
  both English and Japanese locale files are present;
- a clean `npm ci` is reproducible and the dated registry `npm audit` result is
  zero known vulnerabilities after the compatible toolchain refresh and removal
  of the single-purpose static-copy plugin;
- independent review reproduced and closed Perplexity mixed-layout ownership,
  duplicate-role, title-order and nested-prose defects; no residual material
  source finding remains in the reviewed upstream-port diff.

Pull request 11 merged to `main` as `6e9098a`. Continuous Security Cloud scans
completed successfully for every newly reachable commit; the fix commits
`1509bfc` and `e676428` and the final source-head commit `493df81` each produced
zero new findings. These are diff-scoped commit scans, not a repository-wide
proof of absence. Older finding occurrences have not been silently treated as
closed and remain a separate reconciliation task.

Pull request 12 merged to `main` as `950f775`. Its final reviewed source head
was `21cebb6`; CI and the final independent review were clean. This JPEG work
continues from that exact merge on `codex/chatgpt-jpeg-assets`.

Pull request 13 merged to `main` as `6c64fd1`; its reviewed source head was
`bc6a6a3`, CI was green and Security review was clean. The repeated ordinary
code-review indicator remained externally stuck after both actionable threads
were resolved, so the merge used the clean CI/Security result, the resolved
review evidence and an independent local review. The Library branch is
rebased onto that exact merge. Its offline privacy and association checkpoint
plus the one-JPEG runtime contract remain unpublished pending their own
reviewable pull request.

The upstream `v2.7.13` → `v2.14.9` audit is retained in
[`docs/upstream-2.14.9-audit.md`](docs/upstream-2.14.9-audit.md). This branch now
adapts the Perplexity rollout fixes, strict popup settings reads, a length-aware
append reader, and compatible dependency/build-chain updates. Claude current
DOM, ChatGPT DOM fallback, typed truncation guards, Gemini completeness/title
and the exact Google image redirect permission remain explicit later slices.

Pull request 14 merged the independently reviewed Library-JPEG slice to `main`
as `a55d9b8`; its reviewed source head was `2948f99`, and CI plus the final
manual security review were clean.

The next owner-context checkpoint is implemented on
`codex/chatgpt-owner-context`. A shared raw classifier selects exactly one direct
or nested graph, fails closed on malformed, conflicting, wrapper-level,
custom-GPT, project, or template evidence, and guards every independently
callable attachment planner. The background derives an immutable content-free
`standard | custom-gpt | project` family from the exact current tab route. Only
that family crosses runtime messaging; owner slugs and paths remain
background-only. Capture and strict replay preserve the validated owner route,
while provider title-slug canonicalization is admitted only when origin,
conversation UUID, route family, empty query, and nonce/mode marker remain
exact. Custom/project routes and owner-bearing raw therefore retain raw,
manifest, canonical, and Markdown but create zero attachment resolver,
acquisition, staging, or fake zero-dispatch audit authority.

A live custom-GPT canary wrote a new append-only Obsidian snapshot with a
41,929-byte hash-bound raw artifact, 11 canonical nodes, no assets, and no owner
route in manifest/canonical. A separate live project canary exercised the
actual denial path: raw 2,609,652 bytes, manifest 5,663 bytes, canonical
4,954,122 bytes, 132 nodes, and nine retained assets. All nine remain
`not-attempted`; attempt timestamps, local artifacts, binary files, and binary
dispatches are zero. The capture directory contains exactly raw, manifest, and
canonical JSON, and the manifest carries one fixed content-free policy warning.
Temporary query-key smoke hooks read no values, headers, bodies, or chat text;
they were removed by a clean build and never entered source or the package.

Final validation passes 155 test files / 4,456 tests. Coverage is 95.25%
statements, 91.06% branches, 98.48% functions, and 97.70% lines. TypeScript,
production build, source/platform lint, repository formatting, ZIP packaging,
and independent review pass; lint retains the same three pre-existing advisory
warnings. The ZIP contains 29 of 29 files byte-identical to `dist`, is 229,975
bytes, and has SHA-256
`9dbb625982acb2006d16dfd731dd80a5ecdc6dc7e770d8db92eff57bb0561f11`.
The installed Comet tree is the same 29-file production build; its pre-live
rollback is retained under `C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks`.

Pull request 15 merged the owner-context archive-only contract to `main` as
`f4c04d5`; its reviewed source head was `9638938`. CI, ordinary review, Security
review, and the final independent local review were clean.

The next standard-chat research-output checkpoint is implemented on
`codex/chatgpt-deep-research`. A finalized destination receipt is emitted only
after that destination has independently confirmed its binary writes and its
final manifest plus canonical companion. The receipt contains only the opaque
capture/conversation keys, exact final manifest SHA-256, and safe
content-addressed binary descriptors. Provider IDs, filenames, URLs, source
pointers, and statuses cannot cross the receipt validator. File and Obsidian
notes are now decorated separately, so each note links only binaries present in
that destination and carries the exact matching `archive_capture_id` and
`archive_manifest_sha256`; Clipboard receives neither local links nor an
arbitrary durable-destination hash. Receipt-bound Markdown uses a capture-scoped
filename and treats every occupied candidate, including the same conversation,
as immutable. Earlier notes and user edits are therefore never overwritten by a
new or repeated archive presentation.

A live standard-chat canary containing research/search evidence and a produced
DOCX retained a direct 49-node graph with 48 messages: 2 user, 24 assistant and
22 tool roles. Canonical JSON preserved 12 text, 12 reasoning, 12 citation, 7
code, 20 execution-output and 13 attachment blocks. The 287,632-byte raw,
8,959-byte manifest and 612,899-byte canonical archive remained hash-bound.
Four historical PNG attempts ended honestly as failed, nine PNG references
remained `not-attempted`, and one 45,036-byte DOCX was fetched under SHA-256
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
Downloads and Obsidian retained byte-identical raw, manifest, canonical and
DOCX artifacts. Each capture-scoped Markdown note has one local archive link;
both targets exist and hash to that exact content address, while the original
provider `sandbox:` reference remains additive historical text rather than
being guessed away. Both note frontmatters bind to the final reviewed-build
capture `capture-chatgpt-8d66dd07-be72-4285-99cf-8791257386a9` and the exact
persisted manifest hash
`98551c2aa445df27bcd4ead8729704c1d6c7e3b2aa30b30d89b9d20f450389ec`.
File companions now require Chrome to confirm the exact requested terminal path
for both inline and staged archive transport; a uniquified raw, manifest or
canonical filename fails the destination instead of issuing a misleading
receipt. Provenance warnings are likewise emitted only after that destination's
Markdown write succeeds.

The focused Codex Security diff scan of `f4c04d5..d45c911` completed with all
ten changed source files covered and no validated security finding. It did
reproduce one same-user correctness defect in the append-only contract: a
later ordinary `title-date` append could select an existing same-conversation
receipt-bound snapshot. Existing-note lookup and collision reuse now exclude
top-level `archive_capture_id`, `archive_manifest_sha256`, and
`presentation_mode` markers, including simply quoted YAML keys. Nested mappings
and block-scalar text remain ordinary note content rather than false immutable
markers. The snapshot is therefore neither appended to nor overwritten; the
ordinary export selects a fresh collision-free path. A final independent review
found no residual P0-P3 issue in this repair.

Final validation passes 157 test files / 4,602 tests. Coverage is 95.26%
statements, 91.15% branches, 98.53% functions, and 97.70% lines. TypeScript,
production build, source/platform lint, repository formatting, ZIP packaging,
and independent review pass; lint retains only the same three pre-existing
advisory warnings. The ZIP contains 29 of 29 files byte-identical to `dist`, is
231,480 bytes, and has SHA-256
`92ef88ae6fab2b6969278956810ef4e08c08c23cd4b8504fef5aadad58ee24c7`.
The installed Comet tree matches that production build exactly; its 29-file
pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\deep-research-prelive-20261023-074014-d2aba19b`.

The next wide-branch checkpoint is implemented on
`codex/chatgpt-wide-branch` at `e29165e`, now integrating the PR 16 merge
`9fb7835`. A prepared session validates the archive and complete catalog
once, resolves ordinals in O(1), reconstructs paths from validated parent links,
and reuses one immutable timestamp across measurement and writing. Public
defensive renderers remain unchanged. Structural preflight rejects before any
output at 50,000 nodes, 512 leaves, 1,000,000 path visits, 1 GiB expanded source
work, or 2,048 planned writes. After archive evidence succeeds, an exact dry
pass uses the same File/Obsidian transforms as the writer and caps each note at
16 MiB, logical Markdown at 1 GiB per destination, and total planned physical
bytes at 2 GiB. A canonical settings snapshot prevents popup changes during a
long run from invalidating that measurement.

All-branches File notes and indexes now wait for an ID-bound terminal Downloads
state and require Chrome's exact requested filename. Interrupted, uniquified,
unknown, and already-owned outcomes cannot issue a false success or index. One
unknown File transfer stops later File dispatches while an independent Obsidian
destination may finish. A trusted persistent `Stop export` control remains
separate from transient progress toasts; cancellation stops scheduling new
work, retains confirmed evidence/files, and never deletes an immutable capture.

The final source passes 161 test files / 4,679 tests. Coverage passes at 95.21%
statements, 91.02% branches, 98.53% functions, and 97.75% lines. TypeScript,
production build, ZIP packaging, repository formatting, independent review,
and source/platform lint pass; lint retains only the same three pre-existing
advisory warnings. The ZIP is 234,395 bytes with SHA-256
`d2959575477525f551ade4f8783b1050502c6edd1cda1a725f421090cd63b778`.
The installed Comet tree matches its 29-file build exactly; rollback is retained
at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\wide-branch-prelive-20261023-090422-8bdaf390`.

Live Comet evidence has two parts. A one-leaf standard chat wrote exact File
branch/index names plus raw (287,632 bytes), manifest (8,959), canonical
(612,899), and one fetched DOCX (45,036). Raw length/hash and canonical manifest
provenance reconcile; the 49-node graph has one leaf, the index link resolves,
and both Markdown files share capture
`capture-chatgpt-6b5be94f-293f-4cdd-817f-d079d2d32102`. On the genuinely wide
graph, the picker became usable after roughly 65 seconds, retained 239 leaves,
and cancellation created no Downloads file. `Export all branches` then rejected
at structural preflight before any output because expanded source work exceeded
the 1 GiB checkpoint limit. A content-free measurement of the existing matching
canonical graph is 2,285 nodes, 239 leaves, 68 branch points, 230,694 path
visits, and 1,128,535,662 expanded source bytes (1.051 GiB). The ceiling remains
unchanged: raising it, for example to 1.25 GiB, requires an explicit maintainer
decision followed by the real full-write/index run.

The next all-branches destination-receipt checkpoint is implemented on
`codex/chatgpt-all-branches-receipts` at `4da4ed1`, now integrating the PR 17
merge `cbf38c1`. Every File/Obsidian branch note and index now
requires one strict destination-owned archive receipt. The plain
attachments-disabled path first confirms that destination's complete
raw/manifest/canonical trio and then constructs an empty-assets receipt; the
attachment-enabled path uses only the receipt emitted after destination-specific
archive finalization. Receipt containers are descriptor-snapshotted without
invoking caller accessors or methods. Missing, duplicate, malformed, or
identity-mismatched receipts fail closed for only that destination.

Each leaf and index is decorated before both exact measurement and writing,
while its already capture-scoped filename is preserved. The second pass must
reproduce the same filename, UTF-8 byte length, and SHA-256 before dispatch;
same-length drift therefore cannot evade the guard. Branch and index notes carry
the exact final manifest hash plus only that destination's confirmed local
capture-level attachment links. Provider links remain untouched and the text
explicitly avoids asserting that a capture-level file belongs to every branch.
An independent adversarial review found and closed one P2 in outer receipt-array
snapshotting; the final review found no residual P0-P2.

Final validation passes 161 test files / 4,710 tests. Coverage passes at 95.22%
statements, 91.06% branches, 98.53% functions, and 97.74% lines. TypeScript,
production build, ZIP packaging, repository formatting, independent review,
and source/platform lint pass; lint retains only the same three pre-existing
advisory warnings. The ZIP is 234,972 bytes with SHA-256
`5f7e920f69b8853091ce3d7e51ce74f9d41fa27e38dcc6c182409c81ef8d18d0`.
The installed Comet tree matches its 29-file production build; rollback is
retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\all-branches-receipts-prelive-20261023-100236-e9cf9886`.

A new append-only File canary created capture
`capture-chatgpt-92ae2c7b-362e-496a-989a-5e76cd3c567d`: raw 287,632 bytes,
manifest 8,959 bytes, canonical 612,899 bytes, one 47,904-byte branch, and one
1,224-byte index. Raw length/hash and canonical input provenance reconcile with
the persisted manifest. Both Markdown frontmatters contain the exact manifest
SHA-256 `9912a092738e39997f8818d1b44a743ac9693733a68d4b04daa4e86e52b71d18`;
the index link resolves to the exact branch filename, with no doubled capture
suffix. Both notes link the same existing 45,036-byte DOCX whose SHA-256 is
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
This live gate rechecked File output only; the Obsidian variant remains covered
by destination-divergence regressions rather than a fresh vault read in this
checkpoint.

The finalized physical-byte checkpoint is implemented on
`codex/chatgpt-physical-budget` at `dcdaa49`, now integrating the PR 18 merge
`429d2a5`. Every strict destination receipt owns detached byte lengths for
its exact finalized raw, manifest, and canonical artifacts. All-branches
accounting seeds each successful destination from that trio plus each confirmed
receipt asset exactly once, independently of branch count and without
cross-destination deduplication. Supplied receipts must also bind their raw byte
length to the original capture companion; malformed, accessor-backed,
overflowing, or mismatched receipts isolate only that destination.

The same checked destination seed drives summary dispatched/confirmed bytes and
the 2 GiB aggregate physical budget. A representable initial seed above that cap
rejects before any Markdown fingerprint or write, while logical Markdown remains
a separate per-destination counter. Stop after archive finalization retains the
already confirmed physical seed in its summary. This is exact accounting for
successful finalized destinations, not a whole-operation pre-write disk gate.
At this checkpoint, raw/binary residue from a destination that failed later
finalization was still unaccounted. The later operation-local per-write ledger
closes that historical gap with confirmed/unknown/not-dispatched sink evidence;
it still does not claim net disk usage or restart-persistent ownership.
GitHub review then exposed the remaining adversarial case where two individually
representable destination totals overflow the aggregate safe-integer range. The
budget now short-circuits that aggregate to a bounded over-cap sentinel and
returns an ordinary `physical-planned-bytes` rejection summary before any
Markdown fingerprint/write instead of rejecting the persistence promise.

Final validation passes 162 test files / 4,733 tests. Coverage passes at 95.27%
statements, 91.11% branches, 98.57% functions, and 97.77% lines. TypeScript,
production build, ZIP packaging, repository formatting, independent review,
and source/platform lint pass; lint retains only the same three pre-existing
advisory warnings. The ZIP is 235,317 bytes with SHA-256
`9c5d2617bf255c04d7fb8a9237d93454df00fdc89dce639af3bf6550f5cd2365`.
The installed Comet tree matches its 29-file production build exactly; its clean
pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\physical-budget-review-fix-prelive-20261023-104608-f29ded47`.

A fresh two-destination canary created capture
`capture-chatgpt-513c3dd9-f332-412e-b417-28cdb81b0fc8` and reported one branch
plus an index saved to both Obsidian and File. Both destinations retained
byte-identical raw (287,632 bytes), manifest (8,959), canonical (612,899), and
DOCX (45,036) artifacts; raw and canonical provenance reconcile, and the DOCX
hash remains
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
Both leaf/index pairs bind to manifest SHA-256
`83beb122d73065038858f9b806da2afeca351d3293595f7cad9efe8ebcbe720d`,
their index links and capture-level asset links resolve, and their filenames
remain exact. File serialized the leaf to 47,904 bytes; Obsidian serialized the
same logical leaf to 47,096 bytes because its enabled long-message flattening is
measured separately. Both indexes are 1,224 bytes.

PR 16 merged to `main` as `9fb7835`, PR 17 as `cbf38c1`, PR 18 as `429d2a5`,
and PR 19 as `c112b84`. Every merged reviewed head is an ancestor of the fetched
remote `main`; the four staged checkpoints are now linear.

The current sandbox-link localization checkpoint is implemented on
`codex/chatgpt-sandbox-links` in parser commit `5fc033f`, integration commit
`7dff1b9`, and merge checkpoint `4f9d203`. It does not add a resolver or binary
authority. The bounded presentation parser accepts only ordinary inline links
from exact assistant text parts and rejects code, HTML/angle ambiguity,
blockquotes, reference definitions, malformed nesting, unsafe paths, and
unsupported raw shapes. After one durable destination has finalized its exact
raw/manifest/canonical trio and fetched binaries, detached runtime evidence is
rebound to that destination's strict receipt, original raw bytes, canonical
digest, selected path, whole ledger, exact source pointer, and content-addressed
asset tuple. Only then does a copy-on-write presentation replace the destination
span; raw, manifest, and canonical bytes remain untouched. Clipboard, DOM
fallback, and all-branches presentations remain unchanged, and every mismatch
fails soft to the provider link plus the existing verified appendix.

Independent review found and closed a cross-part Markdown fence edge: matching
identity counts were insufficient when one identical link was hidden in code
and another was visible. The final implementation derives exact text-block
spans from the same projection helper used by legacy rendering and requires the
identity, encoded destination, and absolute UTF-16 start/end to match the
combined visible message. Both the spanning-fence and same-identity swap
regressions now remain unchanged rather than rewriting a code example. The
final independent pass found no residual P0-P3 issue. GitHub current-head review
then found one fail-soft false negative: a reference definition inside an
unambiguous inline or top-level fenced code example vetoed a later ordinary
link. Presentation scanning now computes code ranges first and ignores only
those unambiguous code-only definitions; paragraph-ambiguous indented code
remains conservative. Focused regressions cover both code forms and the later
link, while current-head Security review remains clean.

Live Comet verification used two append-only current-branch captures. The broad
attachment chat created `capture-chatgpt-f6014b81-99b1-4961-9a9d-45b5a5b1d9f1`
in both Downloads and Obsidian, retained byte-identical raw/manifest/canonical
and a 2,313,476-byte PNG, and honestly left its unfetched DOCX/PDF provider links
untouched. The exact DOCX gate then created
`capture-chatgpt-cafbe981-4baf-4458-97af-5a3cb0f5e7c0` in both destinations:
raw 287,632 bytes, manifest 8,966, canonical 612,891, and one 45,036-byte DOCX
with SHA-256
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
All four artifact hashes match across destinations; raw length/hash and canonical
manifest provenance reconcile. File and Obsidian Markdown are 47,915 and 47,107
bytes respectively because long-message flattening remains destination-specific.
Both bind to manifest SHA-256
`ed019fbcc67720a1500f6da93ebe0ba5eb54cff285662736571a5afe52763aec`,
contain zero `sandbox:` references, and contain exactly two links to the same
existing content-addressed DOCX: the localized inline link and the appendix.

Final exact-tree validation passes 164 test files / 4,898 tests. Coverage is
95.34% statements, 91.27% branches, 98.64% functions, and 97.81% lines.
TypeScript, production build, source/platform lint, repository formatting, ZIP
packaging, diff checks, and independent review pass; lint retains only the same
three pre-existing advisory warnings. The final reviewed-build ZIP is 239,473
bytes with SHA-256
`945d12385e1c2292891a02440d550f5b5e66ef71b68dd26cfa88671fde206408`.
The live-smoke build was 29/29 files byte-identical to the installed Comet tree;
its verified rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\sandbox-links-prelive-20261023-123622-e87f98df`.

PR 20 merged the live-verified sandbox-link checkpoint to `main` as `c3c6e82`;
its reviewed head `257ee47` is an ancestor of fetched remote `main`.

The next settings-stable routing checkpoint is implemented on
`codex/chatgpt-stable-routing`. Every first-party structured durable write now
carries one detached, canonical, secret-free snapshot of the routing settings
that authorized it: inline and staged archive companions, staged binaries, and
Markdown. Background re-reads current settings and combines them with any
in-flight output override immediately before admitting a durable dispatch. A
different snapshot, or a requested destination that is now disabled, returns
the fixed `settings-changed` result without writing, retrying, stripping guards,
or borrowing authority from a sibling destination. Legacy callers that omit
the snapshot remain compatible but receive no new stability guarantee.

Staged mismatch cleanup remains narrowly authorized. Only a valid
sender-authorized message can exact-abort its named temporary archive or binary
stage; malformed or untrusted messages gain no cleanup authority. A cleanup
failure is retained only as the allowlisted
`archive-stage-cleanup-deferred`/`binary-stage-cleanup-deferred` warning, while
arbitrary private errors remain excluded. ChatGPT binary companion builders now
also preserve the original capture timestamp instead of silently replacing it
at finalization. Final destination receipts remain the sole provenance and link
authority. This checkpoint guarantees routing consistency at message admission;
it does not claim atomic cancellation, a fixed physical vault identity, or
restart recovery.

Independent review found and closed two bounded defects before the live gate:
the real ChatGPT companion builders had dropped `capturedAt`, and exact staged
cleanup warnings were being swallowed by orchestration. The final review found
no residual P0-P3 issue. Exact-tree validation passes 165 test files / 4,950
tests. Coverage is 95.36% statements, 91.30% branches, 98.68% functions, and
97.82% lines. TypeScript, production build, source/platform lint, repository
formatting, ZIP packaging, and diff checks pass; lint retains only the same
three pre-existing advisory warnings. The final ZIP is 239,904 bytes with
SHA-256
`6ad44eb98899bfe559b686cec94c2dc3c772ef17f645a4d856af2ecb07f38dcf`.
Its 29-file production tree is byte-identical to the build currently installed
in Comet.

A fresh positive Comet canary, with settings deliberately left unchanged during
the operation, created
`capture-chatgpt-dadab422-4fae-4f15-8317-68df19f64f0c` in both Downloads and
Obsidian. The destinations retained byte-identical raw (287,632 bytes), manifest
(8,959), canonical (612,899), and DOCX (45,036) artifacts. The DOCX SHA-256 is
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`;
raw length/hash, canonical input provenance, and all cross-destination hashes
reconcile. File and Obsidian notes are 47,917 and 47,109 bytes respectively,
contain zero `sandbox:` references, and each contains exactly two resolving
content-addressed links. The negative mid-operation settings race is covered by
the deterministic admission matrix, not claimed as a live UI proof. The clean
pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\stable-routing-prelive-20261023-134118-40ac6dab`.

PR 21 merged the settings-stable routing checkpoint to `main` as `c896cd5`;
its reviewed head `87344b2` is an ancestor of fetched remote `main`.

The operation-local write-fact ledger is implemented on
`codex/chatgpt-write-ledger` at `9030de4`. Durable archive and binary routes now
return an exact typed sink observation only when a first-party ledger call opts
in: `confirmed`, `unknown`, or `not-dispatched`, with a separate bounded cleanup
fact. Legacy durable callers and ordinary Markdown keep their previous response
shapes. Confirmation still means the established strict contract—exact
Obsidian readback or terminal exact-path Download—not PUT acceptance or a
download ID. A timed-out/readback-mismatched/path-unconfirmed write is charged
as unknown; settings, preflight, integrity, or start rejection before a durable
dispatch remains not-dispatched.

One closure-owned bounded ledger follows an all-branches operation through raw,
binary, manifest, and canonical attempts. Its detached snapshots contain only
an opaque capture binding, local attempt ordinal, destination/kind enums, exact
verified payload length, terminal state, and cleanup boolean—never bodies,
provider IDs, hashes, paths, filenames, credentials, or arbitrary errors.
Duplicate identical observations are idempotent; conflicts, accessors, foreign
operation evidence, incomplete receipt coverage, unsafe integers, and aggregate
overflow fail closed. Confirmed sink evidence is latched before temporary-stage
cleanup, so a later cleanup/bookkeeping failure cannot erase it.

All requested destinations now remain in the all-branches summary even when a
later artifact prevents finalization. In ledger mode, confirmed plus unknown
artifact bytes from every requested destination seed the shared physical budget;
receipt totals are not added again. Only receipt-qualified destinations may
receive branch Markdown, indexes, manifest provenance, local links, fetched
asset claims, or sandbox localization. A malformed supplied ledger blocks new
Markdown rather than silently falling back to a smaller receipt-only total.
Legacy callers without a ledger retain the previous finalized-receipt accounting.
Current/selected and DeepSeek retain the optional typed seam but do not create
unused ledgers; this checkpoint is neither persistent audit storage nor a
restart, retry, deletion, recovery, or net-disk guarantee.

Independent implementation and follow-up reviews found no residual P0-P3
issue. GitHub current-head review then found two user-honesty gaps: successful
archive writes hid allowlisted cleanup-deferred evidence, and a receipt-qualified
destination could hide unknown binary bytes omitted from its final manifest.
Both are fixed in `e0d3246`; cleanup warnings are now independent of write
success, and unknown artifact bytes are disclosed across every requested
destination. A later current-head review found that the ledger accepted shorter
capture IDs than the existing ChatGPT/DeepSeek contracts; `b6c451a` aligns both
provider-specific maxima and adds boundary/one-over regressions. Exact-tree
validation passes 166 test files / 5,011 tests. Coverage is 95.28% statements,
91.33% branches, 98.60% functions, and 97.73% lines.
TypeScript, production build, source/platform lint, repository formatting, ZIP
packaging, and diff checks pass; lint retains only the same three pre-existing
advisory warnings. A parent rerun of the ten decisive suites passes 286 tests.
The final review-fixed ZIP is 242,564 bytes with SHA-256
`d056682127b5985200925e05bc3fdc3c62497acbf247949c628e170077c79e27`.
Its 29-file production tree is byte-identical to the build installed in Comet.
The clean pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\write-ledger-capture-id-fix-prelive-20261023-152409-b6c451a`.

A fresh positive all-branches Comet canary created
`capture-chatgpt-0b38fe0b-d061-406b-a3ef-4b3d05a07b41` from the final
review-fixed build in both Downloads and Obsidian. Raw (287,632 bytes), manifest
(8,959), canonical (612,899), and DOCX (45,036) copies are byte-identical across
destinations; raw length/hash and canonical manifest provenance reconcile. Both
one-leaf indexes resolve their exact emitted branch name and all four notes bind
to manifest SHA-256
`295db787b80edb7160770012bc6b56f12bfe5a61f2de3434d4e530ae5cdcfe58`.
File and Obsidian branch notes are 47,904 and 47,096 bytes because their existing
destination transforms remain independent; both indexes are 1,224 bytes. The
manifest retained one fetched, four failed, and nine not-attempted asset records:
the verified DOCX is linked once from every branch/index view, while the
remaining unfetched sandbox reference stays honest. Temporary resolver tabs
exact-closed. This proves the unchanged-settings positive ledger path, not a
live failure race or worker-restart guarantee; those remain deterministic/static
evidence only. The subsequent capture-ID boundary fix does not alter this
ordinary UUID path; its 29-file build is installed, reloaded, and byte-identical
to `dist`.

The operation-local write ledger is checkpointed and live-verified. The next
ChatGPT live gates still require a real provider response above 16 MiB, a
multiple-same-title produced-file sample, or an available additional binary
family. Until such evidence exists, the 1 GiB source-work limit remains a
deliberate refusal for the known 1.051 GiB graph, and custom-GPT/project binaries
plus the archived Library WebP remain separately evidence-gated. Independent
typed truncation and untouched-provider/upstream hardening can proceed without
inventing transport authority.

## Local math-Markdown security checkpoint

Branch `codex/security-math-markdown` repairs the still-reachable fallback behind
Security Cloud occurrence `commit:eb1705ab69ac8191a043d3d6cb44fe4c`.
Delimiter-containing, oversized, malformed, or internal-placeholder-shaped
`data-math` values now become readable entity literals instead of active
Markdown. Display lines retain their boundaries without becoming indented code;
math-bearing table cells isolate neighboring punctuation; valid inline/display
TeX remains math, with formatting-only line wraps collapsed and `%` comment
line endings preserved through display promotion. The internal image grammar
now rejects matches spanning math delimiters, while punctuation-rich generated
alt text still resolves.

The Cloud occurrence says fixed, but its saved historical fix-check correctly
records that the earlier backslash/dollar-only fallback remained active at that
older revision. The actual fix merged through PR 25 as `650d8c9`; reviewed head
`d2e9df8` is an ancestor of fetched `origin/main`. Current-head CI and Code
Review were clean, the only P2 review thread was fixed and resolved, and the
local independent parser-backed review was clean. The separate GitHub Security
Review did not execute because its quota was exhausted; no live Obsidian render
was repeated.

## Local Canmore JSON security checkpoint

Security Cloud occurrence
`commit:8fc721c0bb0881919910f4805e72250d`. Message-level Canmore can carry a
JSON string nested inside the already parsed provider graph; the old path called
`JSON.parse` before the canonical sanitizer's depth, entry, and string budgets.
The candidate performs one quote/escape-aware, non-materializing preflight
first. JSON-looking input is limited to 4 MiB of source text, 64 nested
containers, and 4,096 structural tokens. These parse ceilings remain wider than
the existing canonical 16-level/512-entry sanitizer, so valid Canvas payloads
retain the established truncation behavior rather than being silently narrowed.

Exceeded budgets throw fixed code `canmore-json-budget-exceeded`. Inline capture
tests prove the resulting normalization failure retains byte-identical raw
length/hash/body plus manifest and emits no canonical artifact. Plain provider
text, malformed JSON fallback, quoted punctuation/escapes, bounded scalars,
valid create/update events, exact boundaries, and the reviewed 129-character
numeric scalar retain their prior semantics. Evidence: 166 test files / 5,057
tests, the focused seven-file / 202-test matrix, production build, and
source/platform lint with only the same three pre-existing warnings. Independent
review found one P3 numeric-type regression; it is fixed and covered. The source
fix merged through PR 26 as `915e367`; reviewed head `a24d696` is an ancestor of
fetched `origin/main`, with clean current-head CI and Code Review. Browser OPFS
and physical destination persistence were not repeated in this slice.

Per maintainer decision, unavailable per-PR Security Review quota is not an
intermediate blocker when current-head CI/Code Review and the local independent
security evidence are clean. Do not automatically retry paid security review.
After the current large roadmap block, run one explicit Cloud Security scan of
the complete repository and reconcile its findings.

## Local TypedArray capture-integrity checkpoint

Security Cloud occurrence
`commit:0fb1786e6cf08191a25da26b5593adfc`. The document-start hook previously
captured TypedArray methods but later read configurable inherited accessors and
used species-sensitive `Uint8Array.subarray` / `ArrayBuffer.slice`. Page code
running after startup could therefore observe or mutate closure-owned response
bytes before their SHA-256 and Base64 were finalized.

The candidate snapshots native TypedArray `buffer` and `byteLength` getters at
document start, performs every later size read through captured `Reflect.apply`,
copies digest input through captured `Uint8Array.set`, and encodes Base64 directly
from bounded indexed bytes. Staged chunks are encoded as ranges without creating
subarrays. Chunk storage uses null-prototype records, and `readBoundedClone`
crosses its async Promise boundary through a null-prototype envelope so a late
`Uint8Array.prototype.then` cannot receive the exact aggregate. Direct mutation,
throwing accessors, `length`, both species constructors, thenable assimilation,
non-zero-offset views, empty/inline/staged limits, and every resolver mode are
covered.

Evidence: 166 test files / 5,069 tests, the focused 22-file / 758-test
capture-resolver matrix, production build, formatting, diff checks, and
source/platform lint with only the same three pre-existing warnings. Independent
review found the additional async-then path; it is fixed and covered. The first
GitHub Code Review then found that direct Base64 concatenation could create one
multi-million-node rope; encoding now flushes bounded 4,096-triplet blocks. A
live browser MAIN-world smoke was not repeated for this slice. The source fix
merged through PR 27 as `cf733f1`; reviewed head `51183a7` is an ancestor of
fetched `origin/main`. Fresh current-head CI and Code Review were clean; Security
Review was clean on the pre-batching security head, with the batching-only review
thread fixed and resolved. Retain the planned final full-repository Cloud scan.

## Local question-heading security checkpoint

PR 28, merged as `f53fd6d`, addresses Security Cloud occurrence
`commit:3a431a24ce6c81919819b0c524645220`. Optional question headers are built
from raw user/provider content. The previous cleanup deleted backticks and
underscores before emitting the label directly, so code-formatted HTML or even
`<i_mg>` could become an active `<img>` heading.

The candidate keeps whitespace normalization, Markdown-character stripping,
word-boundary truncation, and the 60-visible-character contract unchanged. Only
after that decision, the shared heading serializer converts backslashes and
ASCII angle brackets to numeric entities. Entity parsing yields text without a
second HTML parse, and encoding the backslashes removes odd/even escape-parity
ambiguity. The same line feeds callout, blockquote, and plain formats; disabled
headers and assistant messages remain untouched.

Evidence: all 166 test files / 5,075 tests pass in six memory-bounded batches;
the focused formatter/Markdown/append/count matrix passes 4 files / 279 tests.
Independent review found no P0-P3 issue and ran a separate 301-test pass plus 78
parser probes without an HTML node. Production build and source/platform lint
pass with only the same three pre-existing warnings. Actual Obsidian rendering
was not repeated; the reviewer used the installed Markdown parser. Existing
UTF-16 truncation can still split an emoji surrogate pair; that predates and is
not changed by this slice. Reviewed source head `bbde708` is an ancestor of
fetched `origin/main`; current-head CI, Code Review, and Security Review were
clean.

## Local tool-content boundary security checkpoint

PR 29, merged as `f58758f`, addresses Security Cloud occurrence
`commit:1a0101353b0c819183fb067d15974853`. Provider-controlled tool/search
metadata previously reached generated Markdown as active links, images,
Obsidian embeds/callouts, or message-shaped labels. The shared formatter now
uses a punctuation-encoded `Tool Activity` title and preserves the complete
body inside a collision-safe literal fence in callout, blockquote, and plain
formats. Blank lines and nested backtick runs remain intact; message counting
stays honest before and after long-callout flattening.

Claude `.standard-markdown` tool fragments are sanitized and converted to
readable Markdown before that literal boundary. A placeholder pass preserves
exact pre/code indentation and terminal blank lines without replacement-string
interpretation, cross-block marker collisions, or adjacent-fence concatenation.
When no normal Markdown body is present, Claude's whole-response fallback now
removes status/tool headers from a clone before sanitization, so the opt-in data
cannot leak through ordinary assistant content while the setting is disabled.

Evidence: all 166 test files / 5,086 tests pass in six memory-bounded batches;
the independent final review passed seven focused suites / 431 tests and found
no remaining P0-P3 issue after three converter regressions were fixed. Production
build, repository formatting, diff checks, and source/platform lint pass with
only the same three pre-existing warnings. No live Claude-page or Obsidian-render
smoke was repeated. Reviewed source head `5e88298` is an ancestor of fetched
`origin/main`; CI and current-head Code Review were clean. The historical Cloud
occurrence is closed as fixed. The late Security Review then found a separate
P2 availability issue: Claude tool conversion rescanned the full fragment per
code block and again per marker restoration.

Follow-up source head `6fe968b` replaces those scans with one conversion-local
128-bit capability and one literal restoration traversal. One mutable budget is
fresh per ordinary extraction and shared across every auto-scroll harvest before
deduplication. It bounds per-section and aggregate HTML work, markup count,
sections, code candidates, metadata rows, DOM nodes, ancestor/line work,
ordered-list sibling scans, table nesting, and retained/generated Markdown.
Exceeding a ceiling fails the complete extraction with a value-free error; it
never silently omits tool evidence or reports a partial result as complete.

Independent review additionally found pre-conversion amplification through
nested blockquotes, decoded math attributes, table descendant selectors,
repeated favicon rows, ordered-list indexing, and detached nested KaTeX nodes.
Each bounded reproducer is covered. Nested tables now fail visibly rather than
being flattened, shared result rows are read once, and KaTeX preprocessing skips
static-list candidates disconnected by an outer replacement.

Evidence: all 170 test files / 5,201 tests pass in six memory-bounded batches;
the focused converter/extractor/Markdown/sanitizer matrix passes 5 files / 233
tests. The final independent pass reran the three Claude suites plus sanitizer
(192 tests) and found no remaining P0-P3 issue. Production build, targeted
formatting, diff checks, source/platform lint, and `npm audit` pass with only the
same three pre-existing advisory warnings and zero known dependency
vulnerabilities. A real Chrome/Claude timing smoke was not repeated, so JSDOM
proves the bounded paths and regressions but not a hard browser wall-clock.

## Claude October DOM compatibility checkpoint

The fresh `codex/claude-october-dom` branch ports only the stranded transcript
scrolling and October assistant-root commits from `origin/codex/claude-compat`
onto current `main`. It deliberately excludes that stale branch's truncation
guard, which is superseded by the typed partial-DOM persistence checkpoint
below, and excludes its broad intermediate provider documentation.

Claude now prefers the semantic transcript scroller and accepts the class
fallback only outside navigation ancestry when an indexed row contains an
extractor-owned user or assistant root. Strong October identities, distinct
legacy roots, and the weak streaming fallback are unioned in priority order;
overlapping wrappers retain the prior greedy priority semantics without
quadratic pairwise scans, so strong siblings survive while a later containing
weak wrapper is discarded. A
collapsed inert wrapper inside a live indexed row remains readable, while a
hidden/inert row, dismissed outer panel, or closed artifact remains excluded.
Assistant answer chrome, October status rows, and legacy status headers are
removed only from a detached clone, preserving the visible final answer and
exact code whitespace without mutating Claude's page.

October tool rows merge with the richer legacy tool path in DOM order. Every
inspected row consumes the existing shared section/input budget; every retained
label consumes one metadata entry plus exact separator/Markdown bytes. The same
mutable budget remains shared across virtual scroll windows before
deduplication. Independent review iterations closed four retained P2s and one
interim data-loss regression: a 4,097th October row and output after an
exhausted 32 MiB Markdown budget now fail with fixed value-free errors; an
indexed navigation sidebar no longer receives scroll writes or produces a
false `complete` result; the fallback derives anchors from every supported user
and assistant role; and candidate preflight plus ancestry-set selection replaces
the former pairwise containment curve without collapsing sibling operations.

Evidence: five focused Claude suites pass 230 tests; the complete suite passes
194 files / 6,474 tests. Production build transforms 251 modules; formatting,
diff checks, and source/platform lint pass with zero errors and the same three
pre-existing warnings. The final independent review loaded production modules,
rechecked every reproducer, compared 3,000 synthetic candidate sets against the
former greedy semantics without a mismatch, and measured 4,001 / 8,001 / 16,389
`contains` calls for 1,000 / 2,000 / 4,097 rows instead of the prior quadratic
curve. No blocking issue remained.

For one bounded live canary, Comet loaded the exact 29-file build of source head
`7f4595c` from the established unpacked-extension directory after creating a
rollback snapshot under `CodexTools/liska-dist-before-claude-7f4595c-20261024-1848Z`.
The authenticated Claude page exposed messages 26–32 plus a `Load previous
messages` control. With persisted settings left untouched, one trusted click
saved a new 7,706-byte Markdown file containing six non-empty current-window
turns: three user and three assistant records, six v1 message boundaries, and
one format marker. Structural checks found zero `Claude responded`, `Copy
answer`, `message-actions`, `data-cds`, or `data-testid` leakage. The browser
reported `Saved locally`; the canary submitted no Claude message and made no
page edit. The file proves the Download destination succeeded. Any additional
configured local destination fan-out was not independently inspected.

This canary proves current October DOM extraction for the mounted window only.
It does not prove full-history auto-scroll for the 32-message chat, because the
persisted auto-scroll setting was not changed and earlier messages remained
behind Claude's explicit load control. It also produced no tool-activity block,
so live October label output remains unproven despite the bounded offline path.
After the final candidate-work and sibling-preservation fixes, the exact
29-file build of source head `c5ea76c` replaced the installed tree with zero
hash or size differences and was reloaded once. The extension details page
showed an active service worker and no Errors control. No second private-chat
export was needed or performed.

## Provider-owned readiness checkpoint

The fresh `codex/provider-readiness-port` branch ports only the four selector
readiness commits from the stale compatibility stack onto current `main`.
Historical STATUS/provider-plan edits and the superseded truncation guard are
absent from the code diff. Bootstrap now receives one exhaustive typed
`CONVERSATION_READY_SELECTORS` map derived from each extractor's owned selector
module instead of carrying a broad duplicate cross-provider literal.

The map covers six logical platforms and all seven registered host surfaces:
Gemini, Claude, ChatGPT, Perplexity, DeepSeek, and both Gemini Notebook hosts.
Immediate and MutationObserver checks query only the selected provider's full
supported readiness surface, including current and legacy fallbacks. Perplexity's
legacy query selector is single-sourced outside its current live-selector group;
Claude combines the complete post-PR-43 user/assistant role groups while requiring
an indexed owned row or supported rowless transcript root. Foreign-provider,
broad conversation-class, dead ChatGPT article, and thread-width decoys do not
trigger early injection.

Readiness remains only a local UI-control hint. It performs no extraction,
capture, messaging, fetch, persistence, or credential read. ChatGPT and DeepSeek
remain structured-first, the 100 ms mutation debounce is unchanged, and the
unconditional 10-second escape still injects controls when a supported page has
no mounted conversation DOM.

Evidence: the focused selector/bootstrap/Perplexity matrix passes 5 files / 276
tests; the complete suite passes 196 files / 6,594 tests. Production build
transforms 252 modules; formatting, diff checks, and source/platform lint pass
with zero errors and the same three pre-existing warnings. Independent review
ran the production modules through 18 positive, 90 cross-provider negative, and
four unsupported DOM cases with zero discrepancy and found no material issue.
No live-provider timing or injection claim is attached to this wiring
checkpoint.

## ChatGPT paired-DOM fallback checkpoint

The fresh `codex/chatgpt-dom-fallback` branch selectively adapts upstream
`b60e88c` to Liska's explicitly partial rendered fallback. API-first complete
graph capture remains the ordinary path; selected-branch and explicit replay
failures remain fail-closed; raw/manifest/canonical companions, structured
projection, archive image authority, destination receipts, and partial-DOM
overwrite protection are unchanged. Upstream's blob-image collector and global
current-layout-first switch are deliberately absent.

The fallback now recognizes current `div[data-turn-key]` pairs and every
supported legacy section selector together. Priority-preserving DOM overlap
selection keeps distinct mixed-rollout roots while dropping only a weaker
containing duplicate. A paired turn emits its prompt followed by its rendered
answer blocks; date separators and the assistant role label stay out of both.
A valid stable turn key always controls both role keys even when child message
IDs arrive later. Child IDs are used only when the turn key is absent; keyless
same-window duplicates retain distinct fallback keys. Identity across keyless
virtual remounts remains best-effort, consistent with the mandatory
`dom-fallback / partial` result.

One shared scroll axis now measures distance from the oldest edge for ordinary
positive and column-reverse negative scroll origins. ChatGPT requests a two-
second visible top settle so late older pages can mount before completion. A
zero-range current window is not skipped while that settle can still produce
history; hidden pages never settle complete and flow into the existing runtime
`partial` outcome. Normal-axis Claude and legacy ChatGPT behavior retain their
previous accumulation semantics.

Independent review found and closed four P2 data-integrity seams: paired user
fallback could misclassify assistant preformatted text; first-match legacy turn
selection could discard a distinct testid-only root; and late child IDs could
change stable remount keys and retain stale plus final messages. GitHub review
then proved that zero-range history growth reset stability but not the settle
clock, letting a second late page be skipped; every growth now restarts both.
The final pass
also verified API-first/selected/replay isolation, mixed current/legacy order,
reverse-axis delayed loading, hidden/zero-range handling, and typed partial-DOM
persistence.

Evidence: ten focused suites pass 366 tests; the complete suite passes 198
files / 6,615 tests. Production build transforms 253 modules; formatting, diff
checks, and source/platform lint pass with zero errors and the same three
pre-existing warnings. Raw browser DOM access was unavailable under the browser
host policy. A native read-only observation exposed one visible user heading and
two assistant headings plus the current compact launcher, but does not prove the
CSS selectors or real reverse-scroll mechanics. No forced live fallback or live
full-history claim is attached to this checkpoint.

## Typed partial DOM persistence checkpoint

Source head `32fb7b5` carries the existing DOM loader outcome as runtime-only
`complete`, `partial`, or `unknown` evidence from shared virtualized extractors
and Gemini. A skipped, disabled, unconfigured, or missing-container loader is
explicitly unknown; only a non-skipped successful load is complete. Existing
timeout warnings remain unchanged. This signal is distinct from structured
archive `capture_completeness` and is never serialized into note frontmatter or
body.

Before authorizing an exact same-conversation mutable Obsidian overwrite, a
known-partial note now compares its incoming message count with the existing
note's trusted v1 sentinels or strict legacy `message_count`. A smaller capture
fails as `partial-capture-would-shrink-note`; absent, malformed, mismatched, or
otherwise untrusted old count fails as
`partial-capture-existing-count-untrusted`. The guard stops before image or
Markdown writes and never escapes to a suffix filename. First saves,
equal/larger partial counts, File/Clipboard, valid complete/unknown traffic,
and immutable archive presentations retain their previous behavior. Invalid
partial direct-call counts fail with a fixed value-free code.

Evidence: all 171 test files / 5,272 tests pass in six memory-bounded batches;
the focused extraction/note/validation/append/background matrix passes 9 files /
569 tests. Independent review passed 8 focused suites / 404 tests plus 14 strict
count probes and 24 isolated save scenarios with no P0-P3 finding. Production
build, targeted formatting, diff checks, source/platform lint, and `npm audit`
pass with only the same three pre-existing advisory warnings and zero known
dependency vulnerabilities. No destructive live Obsidian timeout smoke was run.
This count guard does not prove message-prefix/content alignment and does not
eliminate concurrent-write races.

## Compact Liska launcher checkpoint

Source head `d8f711d` replaces the two permanently expanded export controls with
one fixed 44 by 44 pixel local-SVG Liska launcher. A trusted launcher click,
mouse hover, or keyboard focus reveals the existing controls; `Escape`, focus
departure, or a completed action collapses them again. The launcher itself has
no export authority: only the unchanged real action buttons can start work, and
their trusted-event checks remain in force. Non-ChatGPT providers receive only
the current-thread action, while ChatGPT retains both current-thread and branch
selection.

Busy state, reinjection, focus handoff, localization, and mobile safe-area
placement are covered without new assets, permissions, dependencies, network
requests, or persisted state. At viewports up to 540 pixels, ordinary toasts
move to the top-right so they cannot cover the vertically stacked launcher
actions. The all-branches stop card intentionally remains above progress toasts;
its final result becomes visible after the stop card is removed.

Evidence: all 171 test files / 5,285 tests pass in six memory-bounded batches;
the UI/bootstrap subset passes 2 files / 104 tests and the complete content
batch passes 52 files / 2,141 tests. Production build/typecheck, formatting,
diff checks, source/platform lint, and `npm audit` pass with only the same three
pre-existing advisory warnings and zero known dependency vulnerabilities. A
live Comet smoke loaded the candidate unpacked build, confirmed the collapsed
fox, trusted reveal of both ChatGPT actions, and `Escape` collapse without
starting an export. The installed tree was then restored to the prior stable
build. Real touch input, narrow-device safe-area geometry, and other-provider
host CSS remain live visual follow-ups rather than claimed proof.

## Canonical HTML renderer foundation checkpoint

Source head `3a5af58` introduces the pure `liska-html/1` presentation boundary
described by ADR-036. It renders one validated canonical branch directly rather
than reconstructing HTML from the deliberately lossy legacy Markdown view.
The renderer is deterministic and browser/destination-independent: it performs
no capture, network, storage, clock, DOM, download, or archive mutation.

The default profile exposes only ordinary visible user/assistant messages.
Non-user roles, hidden/non-final/tool-recipient messages, and their bodies stay
canonical-only. Enabling tool content reveals only typed reasoning, tool,
execution, and error blocks inside otherwise eligible messages. Every canonical
block family is either rendered or represented by an explicit aggregate
diagnostic/placeholder; provider HTML and Markdown images remain inert.
External navigation is limited to exact credential-free HTTP(S) links that
require a user click.

Optional local assets require a separate finalized binding set. Each binding
must agree with a canonical fetched asset on opaque ID, content-addressed path,
lowercase SHA-256, MIME type, and byte length. Only PNG/JPEG/GIF/WebP may become
local images; other allowlisted passive types are download links. The renderer
never infers authority from canonical paths, filenames, provider URLs, or
acquisition state alone, and it cannot itself verify absent bytes or a caller's
binding-set digest.

Work is bounded before recursive validation and before expensive Markdown AST
construction. Caller ceilings may only tighten global limits. The parser guard
covers direct and mixed quote/list nesting, CR/LF/CRLF, CommonMark backtick and
tilde fences, invalid backtick info strings, ambiguous raw-HTML fence state,
per-line container runs, and aggregate container work. UTF-8 output bytes are
counted incrementally. Exceeding a limit fails with a stable value-free code and
never returns a partial HTML document.

Evidence: the focused renderer suite passes 127 tests. Independent review found
and closed inherited array behavior plus four Markdown pre-parser/state bypass
families; its final pass found no remaining P0-P3 issue. All 171 repository test
files / 5,329 tests pass in six memory-bounded groups. Production build/typecheck,
repository formatting, diff checks, source/platform lint, and `npm audit` pass
with only the same three pre-existing warnings and zero known vulnerabilities.
Live provider/browser delivery and offline asset-bundle opening are intentionally
not claimed: settings, destination receipts, File persistence, and UI wiring are
the next slice. Automatic PDF remains a separate transport/rendering decision.

## Local append-boundary security checkpoint

PR 30, merged as `7ff531f`, addresses Security Cloud occurrence
`commit:65c64c5574f08191871348273e586bf6`. Visible `**User:**` and provider
labels were both presentation and identity, so hostile plain-format content
could inflate the old body count and turn a real append into a successful
zero-message no-op.

Ordinary conversation bodies now declare boundary format v1 and place one
exact extension-owned sentinel before each complete message group. Tool/search
evidence and question headers sit inside that group. Provider, user, and tool
content reserve the exact spellings. Image placeholder stripping and
destination-specific resolution preserve only pre-existing service lines in a
declared v1 body and neutralize marker substrings newly composed by each
transform; unterminated provider fences cannot hide later sentinels.

V1 notes count exact markers. Unmarked legacy notes recover from their valid
extension-generated frontmatter count, so already-poisoned bodies can append
the right tail while remaining byte-preserved. An unmarked legacy note without
a trustworthy count returns fixed error `append-message-boundaries-untrusted`,
writes nothing, and cannot fall through to overwrite. ADR-033 records the
format, compatibility, image-transform, CRLF, and explicit-migration rules.

All 167 test files / 5,103 tests pass in six memory-bounded batches. Focused
source-to-sink tests cover the historical forged-label suppression,
plain/callout/blockquote, question headers, tool groups, LF/CRLF, optional
counts, unclosed fences, image-composed markers, repeated no-op, personal
annotations, and multi-output refusal. Independent review found and rechecked
the frontmatter separator, post-image transform, and v1 heading-lookback seams
with 240 round-trip scenarios plus 26 probes; no P0-P3 issue remains. Production
build, repository formatting, diff checks, and source/platform lint pass with
only the same three pre-existing warnings. A live browser/Obsidian append was
not repeated. Reviewed source head `e26f648` is an ancestor of fetched
`origin/main`; CI and current-head Code Review were clean. The historical Cloud
occurrence is closed as fixed. Security Review was still running when the
non-blocking merge completed and was not retried.

## Local citation-boundary security checkpoint

PR 31, merged as `76f1254`, addresses Security Cloud occurrences
`commit:cb0e9bb83f88819181f8a884fdf468a9` and
`commit:1972e53d5bbc81918ded9e6b8bd3b4d7`. Provider HTML previously gained
extension-only footnote authority from public attribute names, NotebookLM
fallback labels were not typed, and a valid HTTP(S) source URL could terminate
its Markdown destination.

Extension-generated refs/definitions now carry a 128-bit per-run capability
and strict decimal / `mN-N` labels. Ordinary, definition, and table consumers
all require both. Marker-like provider DOM is retained as entity-literal text.
NotebookLM rejects nonnumeric fallback labels. Perplexity and Gemini/Claude
Research share one canonical HTTP(S) destination serializer that percent-encodes
literal backslashes and parentheses without double encoding existing escapes.

All 168 test files / 5,112 tests pass in six memory-bounded batches. Focused
tests cover forged refs/definitions, guessed/cross-realm tokens,
malformed labels, table carriers, hostile Research URLs, unsafe schemes,
encoded delimiters, ordering, deduplication, title upgrades, and ordinary
provider/Research output. Independent review found and rechecked the query/
fragment backslash edge. It passed 284 citation tests, 37 targeted Research
checks, and a final 176-test rerun; CommonMark probes produced one link and zero
injected images, with no P0-P3 remaining. Production build, repository
formatting, diff checks, and source/platform lint pass with only the same three
pre-existing warnings. Live provider sharing and Obsidian rendering were not
repeated. Merge `76f1254` is on fetched `origin/main`; current-head CI, Code
Review, and Security Review were clean. Both Cloud occurrences are closed as
fixed.

## Local provider-Markdown rendering security checkpoint

Branch `codex/security-deepseek-markdown` addresses Security Cloud occurrence
`commit:4aa52b95bddc819189aa49cfe8ef0559`. Structured provider Markdown previously
passed from the canonical projection to the reading export with only raw angle
brackets escaped. Remote and loopback images, unsupported destinations, and
Obsidian links/embeds could therefore remain active in a rendered note.

The reading boundary now parses CommonMark and edits exact source positions.
Provider-authored inline/reference images, private or unsupported link and
definition destinations, and Obsidian `[[...]]` / `![[...]]` prose become
entity-literal. Public HTTP(S) links, fragments, formatting, math, footnotes,
multiline labels, indented/fenced/list-contained code, and multiline inline
code remain intact. Structured user-role records receive the same protection.
Raw, manifest, and canonical companions remain unchanged.

Validated local ChatGPT archive links are not recognized by shape alone. The
sandbox localizer carries only exact destinations it generated after raw,
canonical, receipt, source-reference, hash, and destination verification. The
formatter requires membership in that runtime set plus the established
content-addressed path grammar. Provider-authored lookalikes stay literal.
ADR-035 records the contract.

All 169 test files / 5,160 tests pass in memory-bounded batches. Nine focused
source-to-sink suites pass 416 tests. The first independent patch review found
seven concrete issues in the discarded bespoke scanner: malformed-container
nesting, list-fence lifetime, multiline/reference parsing, entity/backslash URL
decoding, path-shape-only trust, code corruption, and quadratic escape scans.
The structural implementation covers every reproducer, including the adjacent
provider-controlled user-record path. Two GitHub Code Review passes then found
nested image descriptions, single-token/active-body Obsidian footnotes,
cross-message image references and fence state, assistant math, and newly
exposed unsafe-link titles. All seven are covered without flattening code,
footnotes, or math. Production build, repository formatting, and
source/platform lint pass with only the same three pre-existing warnings; `npm
audit` reports zero known vulnerabilities. Actual Obsidian rendering was not
repeated, so renderer network behavior remains an explicit live proof gap.

## Canonical HTML File-delivery checkpoint

Source head `4528871` completes the first opt-in File-only delivery slice on
`codex/canonical-html-delivery`. Structured ChatGPT and DeepSeek snapshots retain
provider-neutral presentation context only after the raw/manifest/canonical
archive trio is confirmed. The content layer then reserializes and rehashes the
exact canonical archive once, invokes pure `liska-html/1`, and asks background to
persist fixed `index.html` followed by a deterministic
`presentation/liska-html-1.receipt.json`. Background independently revalidates
base64, strict UTF-8, byte length, SHA-256, sender, destination, and current
settings. HTML is not offered for PDF, Obsidian, Clipboard, DOM fallback, or an
unfinalized asset-bearing snapshot.

The popup exposes `Canonical HTML reading view` as a default-off opt-in enabled
only while File output is selected. A live Comet smoke found that the new field
had been omitted from the storage pass-through list: the popup reported success,
but reload returned it to false. The field is now persisted alongside the other
non-secret sync settings, with a round-trip regression test. The temporary
test-only sender relaxation was never committed. The original user settings
were restored after the smoke, and the previously installed stable build was
put back after an exact reload.

The first private canary unexpectedly contained attachment evidence. It
correctly retained Markdown plus raw/manifest/canonical and a verified JPEG,
while producing no HTML or receipt under the current no-unfinalized-assets rule.
A separate no-asset structured canary then wrote raw (41,929 bytes), manifest
(857 bytes), canonical (73,478 bytes), HTML (33,716 bytes), receipt (539 bytes),
and Markdown (33,033 bytes). It retained 11 canonical nodes, one root, zero
manifest warnings, and zero assets. A local 36-check verifier reconciled every
length/hash/provenance edge, canonical metadata, fixed paths, null asset-binding
digest, renderer version, CSP, and the absence of executable elements, event
handlers, remote `src`, external styles, base elements, and meta refresh. Comet
also rendered the saved file as a readable offline conversation.

All 180 test files / 5,615 tests pass in the established six memory-bounded
batches. A monolithic Vitest run again exhausted worker memory and is not used as
evidence; it produced no assertion failure before worker teardown. Production
build/typecheck, repository formatting, source/platform lint, and `npm audit`
pass with only the same three pre-existing warnings and zero known dependency
vulnerabilities. Independent review found no P0-P3 issue in the persistence fix;
its requested close/reopen Comet proof is covered by the live reload above. The
next HTML slice is destination-finalized local-asset bindings and then
all-branches reading bundles. Automatic PDF remains separate.

## Canonical HTML finalized-asset checkpoint

Source head `d1eae64` on `codex/html-finalized-assets` adds the second opt-in
File-only HTML slice. ChatGPT and DeepSeek attachment finalization can now return
the exact destination-final canonical archive plus confirmed File asset records.
Only after raw, manifest, canonical, and asset writes succeed does the content
layer build `liska-html-asset-bindings/1`, rebind the retained presentation to
that final canonical, and render local images/download links. Every binding must
match opaque asset ID, content-addressed path, MIME type, byte length, SHA-256,
canonical acquisition state, and `localArtifactRef`; unsupported active types
remain unbound. Obsidian success cannot authorize File HTML.

All 181 test files / 5,707 tests pass in six memory-bounded batches. The content
batch passes with four workers; an additional unlimited-worker rerun exhausted
memory without an assertion failure and is not used as evidence. Production
build/typecheck, repository formatting, diff checks, source/platform lint, and
`npm audit` pass with only the same three pre-existing warnings and zero known
dependency vulnerabilities. Independent review found no P0-P3 issue.

A local real-archive smoke reused an earlier destination-confirmed ChatGPT
snapshot containing one fetched 188,009-byte JPEG and one honest
`not-attempted` sibling. Production code reverified the actual JPEG bytes,
canonical descriptor, final record, selected path, and non-null binding digest;
the derived receipt carried the same digest. The saved HTML contained one exact
local `assets/<sha256>.jpg` image, no remote image source and no script element.
It rendered successfully in a browser; the unbound sibling remained an explicit
placeholder plus diagnostic rather than disappearing or borrowing the fetched
file. A separate live no-asset File smoke from the parent slice remains valid.

Fresh live recapture attempts on two older image conversations exposed a
separate provider-capture gap before any destination write: fail-closed A-strict
replay rejected a newly observed opaque path, then ordinary structured capture
timed out and the current ChatGPT DOM fallback found no primary turn selectors.
No archive or Markdown was falsely reported as saved. Treat this as a ChatGPT
capture-compatibility follow-up, not as evidence against finalized HTML binding.

All temporary smoke overrides were removed; the worktree is clean. The user's
stable installed build and ordinary settings (Obsidian + File on, Clipboard and
HTML off) were restored. The exact asset-aware candidate build is preserved at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-html-assets-candidate-d1eae64-20261024`.
Do not open this slice's PR until parent PR 36 merges cleanly; then rebase onto
current main, rerun focused/build checks, and open the next reviewed PR.

## Canonical HTML all-branches B1 core checkpoint

Stacked source commits `47e9f2b` and `002f998` define the pure all-branches
foundation without adding delivery. The separate
`liska-derived-branch-html/1` and
`liska-derived-branch-output-receipt/1` contracts accept only a closed leaf
ordinal or index role and derive exact capture-root paths themselves:
`branch-000001.html`, `branches.html`, and matching fixed receipt paths under
`presentation/`. Existing current-view v1 validators remain mutually exclusive
and unchanged.

`prepareArchiveHtmlBranchSession` preflights and validates the archive, profile,
limits and finalized binding evidence once. An iterative private graph snapshot
retains deterministic declared root/child order, parent links and compact branch
metrics. Each `renderLeaf(ordinal)` rebuilds only that selected message path and
returns one HTML result plus a frozen compact fact; the session retains no leaf
HTML cache and performs no repeated child-array, catalog or `getNodePath` work.
The default 512-leaf ceiling may only be tightened. A deterministic local index
accepts only the complete ordered set of unmodified facts issued by the same
session and exposes only generated local links, generic branch labels, counts,
current flags, aggregate diagnostics and canonical/binding provenance.

An independent review found one confirmed P2 validation-to-use race: a stateful
top-level Proxy could present a valid canonical digest during validation and
markup during a later index read. Inputs, profile/limits, binding-set headers and
binding scalars are now captured once from own enumerable data descriptors and
used only through detached snapshots; both index digests are escaped as defense
in depth. Exact Proxy regressions now perform zero ordinary getter reads. The
repeat review found no remaining P0-P3 issue.

Evidence: all 183 test files / 5,865 tests pass in six memory-bounded batches.
The focused 13-suite / 894-test matrix includes byte-equivalence with the
defensive current renderer, a 12,000-node chain, exact 512/513 leaf boundaries,
wide/shared-prefix order, session-bound fact rejection, hostile inputs and both
current/branch transport contracts. Production typecheck/build (241 modules),
repository formatting, diff checks, source/platform lint and `npm audit` pass
with only the same three pre-existing warnings and zero known dependency
vulnerabilities. Browser delivery, persistence, aggregate HTML budgets,
cancellation and unknown-write behavior remain B2/B3; the closure-private
message bodies retain the documented no-mutation obligation.

## Canonical HTML all-branches B2a persistence checkpoint

Source commits `395c80d` and `f28281e` add a closed, not-yet-invoked File
transport for one already-built branch leaf or index. The exact
`persistDerivedBranchHtmlPresentation` envelope accepts no caller path, receipt,
bundle count or completeness flag. Background verifies the detached
`liska-derived-branch-html/1` bytes first, writes the exact generated HTML path
once, and only terminal exact-path confirmation authorizes construction and one
write of the locally matched receipt. Current-view v1 remains a separate action
and response contract.

`liska-derived-branch-html-persist-response/1` retains two independent sink
facts. Confirmed HTML is not downgraded when its receipt is unknown or
not-dispatched; unknown HTML blocks the receipt and cannot authorize a retry.
Cleanup-deferred evidence stays on the affected write. A bounded content sender
distinguishes pre-dispatch refusal, attempted-but-unconfirmed transport, and a
validated detached response; its 120-second deadline reports only unconfirmed,
does not cancel the background write, ignores late callbacks and never retries.

Independent review found two admission P2s before the final state. First,
descriptor validation did not retain the admitted caller envelope, so a Proxy
or mutation during `getSettings()` could replace capture identity before File
dispatch. The listener now snapshots the complete envelope, artifact and dense
File output exactly once before sizing and uses that detached value throughout.
Second, a stateful `action` descriptor could initially evade detachment and flip
later. New branch dispatch now also requires a closure-local admission
capability threaded through every async gate and checked at the final handler;
the message cannot supply it. Five tested flip points produce zero writes. A
separate callback-context loss that could leave the sender pending is bounded
and settles value-free as unconfirmed.

Evidence: all 188 test files / 6,079 tests pass in six memory-bounded batches.
The focused background/B1/B2a matrix passes 33 suites / 1,097 tests, and the
bounded sender matrix passes 10 suites / 434 tests. Production typecheck/build
(244 modules), repository formatting, diff checks, source/platform lint and
`npm audit` pass with only the same three pre-existing warnings and zero known
dependency vulnerabilities. B2a has no bootstrap caller and makes no delivery
claim; live Chrome timing, B2b canonical authorization and B3 bundle
orchestration remain explicit next gates.

## Canonical HTML all-branches B2b authorization checkpoint

Source commit `107e763` adds the target-free archive evidence and authorization
layer without enabling the exporter. `StructuredArchivePresentationContext`
retains only provider-neutral archive identity, exact manifest/canonical
descriptors and the presentation profile. The existing selected context extends
that base with an exact target/path; ChatGPT's stricter subtype and current
single-view API remain compatible.

One shared authorization boundary preflights the closure-private archive,
serializes the exact canonical JSON once, verifies UTF-8 length and SHA-256, and
rechecks detached identity/descriptors across the single async hash. Current
`prepareDerivedHtmlArtifact` and the new branch adapter use that same path.
`prepareDerivedHtmlBranchPresentationSession` then creates one B1 session and
builds leaf or index artifacts on demand: canonical hashing is not repeated,
each materialized HTML body receives its own artifact hash, and no all-leaf HTML
cache or persistence claim exists.

File-finalized evidence now also has an archive-level builder. It reconciles the
whole final canonical asset map and binding digest once; the prior selected-view
builder is a compatibility wrapper over the same work. Tests compose one
synthetic ChatGPT/DeepSeek finalized context through B2b into the bounded B2a
sender, but no bootstrap/provider route invokes it yet.

Independent review found one selected-path P2 during the refactor: the manual
parent walk had lost declared-root membership and parent-to-child symmetry checks
from the old `getNodePath`. A shared descriptor-only helper now verifies dense
root/child arrays, exact bidirectional ancestry, root uniqueness, path bounds and
cycle/repeat rejection in both retention and selected authorization. The initial
authorization preserves the prior archive/selected JSON-preflight ordering and
error codes; post-hash checks preflight only the selected array before detecting
structural drift. Repeat review found no remaining P0-P3 issue.

Evidence: all 190 test files / 6,212 tests pass in six memory-bounded batches.
The focused B2b matrix passes 15 suites / 848 tests, including a 4,096-node
selected path, once-only canonical hashing, per-output hashes, 512 branches,
same-session facts, hostile descriptors and B2b-to-B2a composition. Production
typecheck/build (246 modules), repository formatting, diff checks,
source/platform lint and `npm audit` pass with only the same three pre-existing
warnings and zero known dependency vulnerabilities. B3 orchestration, aggregate
budgets, cancellation, index-completion gating and live browser delivery remain
explicitly unimplemented.

## Canonical HTML all-branches B3a measurement checkpoint

The pure B3a plan now measures the complete File HTML bundle without dispatching
or writing anything. One destination-finalized archive capability authorizes the
canonical bytes once, then renders every leaf followed by the local index. The
plan retains only compact artifact, receipt and exact message-envelope
fingerprints plus the original same-session rendering facts; HTML/base64 bodies
exist only transiently. A closure recreates one document at a time in the same
session and withholds the body unless its descriptor, provenance, receipt bytes
and full JSON envelope reproduce exactly. Cancellation and failure are sticky,
concurrent recreation fails closed, and there is no retry or caller-supplied
path/completeness authority.

Markdown and HTML now share one exact physical-byte budget. HTML reserves its
artifact and receipt bytes atomically and separately accounts the homogeneous
HTML bytes produced by both render passes. Structural preflight also counts two
File writes for every leaf and the index: 512 leaves with two Markdown
destinations plus File HTML is rejected before persistence at 2,052 planned
writes rather than silently raising the 2,048 ceiling or omitting an output.
The normal sender and dry measurement use the same deterministic envelope
builder, so message-size admission cannot drift between the two passes.

Independent review found and the implementation closed one P2 identity race: a
stateful context could previously present capture identity A through ordinary
property reads and canonical B through own descriptors. The plan now detaches
the exact archive-context descriptors before its first await and uses that one
snapshot for both receipt identity and B2b authorization. Proxy and first-yield
shell-mutation regressions cover the boundary. The repeat review found no
remaining P0-P3 issue.

Evidence after the fix: the focused plan/budget/transport set passes 3 suites /
95 tests; the complete content set passes 62 suites / 2,523 tests. Production
typecheck/build transforms 246 modules, scoped ESLint, Prettier and diff checks
are clean, and the independent rereview passes 5 suites / 199 tests. B3a still
has no bootstrap caller and performs zero destination writes. B3b must wire the
shared structural option, finalized File evidence, sequential observations,
unknown-write halting and index-completion summary before any live canary.

## Canonical HTML all-branches B3b1 evidence checkpoint

ChatGPT all-branches extraction now retains a separate target-free
`StructuredArchivePresentationContext` from the exact captured archive,
companion descriptors and snapshotted tool-content profile. It carries no
selected target or path and remains distinct from the existing current/selected
presentation capability. Invalid archive evidence fails closed through the
established selection-failure path without provider-value details.

Attachment finalization can now return a separate
`fileArchivePresentation` capability. It is created only after the
destination-normalized File manifest/canonical pair is confirmed and only from
asset records whose exact File binary writes were reconciled as fetched.
Obsidian completion, incomplete File finalization and evidence-builder failure
cannot authorize it; builder failure also does not downgrade the already
completed archive. Bootstrap forwards the archive context only for an explicit
all-branches HTML + File request. The deferred warning remains and no HTML or
receipt dispatch is enabled by this checkpoint.

Evidence: the complete repository suite passes 191 files / 6,234 tests; content
passes 62 / 2,528 and extractors pass 17 / 578. Production build transforms 246
modules; lint has zero errors and only the same three baseline warnings;
formatting and diff checks are clean. Main-agent focused verification passes 3
suites / 110 tests and the independent review passes 5 suites / 251 tests with
no P0-P3 finding. B3b2 still owns the no-attachment File evidence path, combined
measurement, sequential delivery, unknown-write halting and user summary.

## Canonical HTML all-branches B3b2a persistence checkpoint

The all-branches persistence layer can now accept an explicit File HTML request,
and that request must match the exact bit retained by the structural preflight.
HTML cannot be added after a weaker preflight. Markdown measurement and B3a HTML
measurement consume one physical-byte budget before the first presentation
write; a combined budget rejection leaves the retained archive intact and
dispatches neither Markdown nor HTML. Without the opt-in, the legacy version-1
summary shape and behavior remain unchanged.

After combined measurement, Markdown keeps its existing per-destination
independence. File HTML then recreates and sends one leaf pair at a time. HTML
and receipt outcomes are counted separately; an unconfirmed transport charges
both planned files as unknown and stops all later File HTML without retry.
Confirmed HTML remains confirmed when its receipt is unavailable. Known
non-dispatch may allow later leaves, but the index body is not even recreated
unless every leaf pair is confirmed. A Stop waits for an in-flight pair's
observation, records it, and prevents the next pair. File Markdown unknown also
blocks subsequent HTML, while a confirmed Markdown failure may leave the
independent HTML route available.

Plain/no-attachment export may create presentation evidence only after the exact
File trio is confirmed. Attachment-finalized export may use only its supplied
evidence and never rebuild from the older pre-attachment archive. A new
reconciliation boundary detaches context descriptors and bindings once, then
matches them to the exact accepted File receipt by destination, identity,
manifest digest/length, canonical length and every supported asset's
path/hash/MIME/length. The accepted receipt protocol does not carry canonical
SHA-256, so B3a still reserializes and authorizes the canonical body/hash; the
sink link available here is its exact length plus the finalized manifest hash.

Independent review found and the implementation closed one P2: valid evidence
for canonical B could previously be paired with a File receipt for A when both
shared capture identity. The mixed A/B regression now produces HTML
`evidence-unavailable`, preserves Markdown, and sends zero HTML messages. The
repeat review found no remaining P0-P3 issue.

Evidence: the complete content set passes 63 suites / 2,577 tests; main-agent
focused verification passes 5 suites / 284 tests. Production build transforms
250 modules, scoped ESLint, Prettier and diff checks are clean, and the final
independent rereview passes 4 suites / 216 tests. This checkpoint exposes no
bootstrap/UI caller yet; summary rendering and live delivery remain B3b2b.

## Canonical HTML all-branches B3b2b bootstrap checkpoint

Bootstrap now computes one File HTML opt-in before the structural preflight and
passes the same decision into the prepared persistence session. An oversized
combined plan is therefore rejected before the ChatGPT attachment/raw pipeline
writes anything. Attachment mode forwards only the destination-final
`fileArchivePresentation`; the plain/no-attachment path supplies no evidence
and lets the persistence layer create it only after the File trio is confirmed.
HTML-off and no-File paths omit the request entirely and preserve the legacy
summary/messages. The single-view HTML helper is never used for all-branches.

The former “not available yet” warning is removed. The authoritative summary
now reports Markdown/archive and File-only HTML separately. A clean complete
run names both formats and attributes HTML only to File even when Markdown also
reaches Obsidian. Partial, failed, rejected and cancelled runs expose closed
HTML status/reason, confirmed leaf pairs, index-pair state, confirmed/unknown/
not-dispatched sink counts, unknown bytes and deferred cleanup without
inventing a failed physical-write state or leaking provider/native errors.
Attachment caveats still turn an otherwise complete run into a warning.

Evidence: focused bootstrap/summary verification passes 3 suites / 48 tests;
the complete content set passes 63 suites / 2,584 tests. Production build
transforms 250 modules; scoped ESLint, Prettier and diff checks are clean. The
independent bootstrap review passes 4 suites / 142 tests with no P0-P3 finding.
The content chunk is now 501.07 kB minified and crosses Vite's informational
500 kB warning threshold; behavior is unaffected, and code splitting remains a
later maintainability task rather than a last-minute delivery rewrite. Live
browser delivery is the remaining gate for this stacked checkpoint.

## Canonical HTML all-branches live reconciliation fix

The first live all-branches File canary retained a complete raw/manifest/
canonical archive, two confirmed PNG assets, two Markdown leaves and the
Markdown index, but produced no HTML or presentation receipts. Replaying the
fresh capture through the pure pipeline proved that archive identity, File
receipt reconciliation and both asset bindings were valid; plan preparation
then failed at the renderer boundary with `html-input-invalid`.

The defect was in the reconciliation snapshot itself. Strict descriptor reads
materialized each accepted binding as a null-prototype record, while the HTML
JSON preflight intentionally accepts only ordinary plain records. Reconciled
evidence therefore became unusable immediately after it had been validated.
Bindings are now copied into frozen ordinary objects after the same exact-key
read. The security and destination-honesty checks are unchanged.

A regression now passes reconciled File evidence with a confirmed PNG through
the real all-branches renderer and builds a leaf. The live capture also passes
the complete offline evidence, reconciliation and three-document planning path
after the fix. The popup regression additionally sends its real settings
message through structured-clone/JSON transport and the worker validator, so a
mixed popup/worker generation remains distinguishable from a schema defect.

Evidence: the focused affected set passes 6 suites / 295 tests; production
build transforms 250 modules; lint has zero errors and the same three baseline
warnings; formatting and diff checks are clean; the complete suite passes 192
files / 6,292 tests. The rebuilt installed extension
matches its candidate at 29/29 files. The final live canary produced one
complete capture with raw/manifest/canonical, two confirmed PNGs, two Markdown
leaves plus index, two HTML leaves plus index, and three receipt files. Every
HTML byte length and SHA-256 matches its receipt; no blob, extension, backend
API, signed-query or provider download route remains in the HTML. The local
index and one leaf were opened in Comet and rendered with working relative
navigation and readable layout. This checkpoint is ready to commit.

## Compact launcher current-main port checkpoint

The compact launcher delta now sits directly above the reviewed typed-partial
head `e7455ec`, which already includes canonical HTML File delivery from current
`main`. The port retains the same six launcher/localization/test/documentation
files; canonical HTML settings/messages and partial-capture persistence guards
are inherited unchanged. The only manual merge resolution preserved the typed,
launcher, and canonical HTML checkpoint sections together in this file.

Evidence: the launcher UI suite passes 1 file / 70 tests and the complete suite
passes 181 files / 5,699 tests. Production build transforms 239 modules; lint
has zero errors and the same three baseline warnings; platform lint, formatting
and diff checks are clean. Independent integration review found no P0-P3 issue
in authority, trusted-event, focus, busy/reinjection, picker/stop-card,
localization, HTML-setting, or typed-guard boundaries. The previous live Comet
launcher smoke remains applicable to the unchanged six-file delta; the combined
current-main build has not yet replaced the installed all-branches canary.

## Compact launcher + all-branches HTML integration checkpoint

The reviewed compact launcher head `fea4680` is now integrated with the
live-verified all-branches HTML delivery stack. Typed partial-DOM persistence,
canonical HTML, finalized asset bindings, all-branches Markdown/HTML receipts,
and the compact two-action ChatGPT launcher coexist in one build. The merge had
documentation-only conflicts; code and message contracts merged without manual
rewrites.

Independent review found and the integration closed two narrow mobile/busy UI
issues. At widths up to 540 pixels, an active all-branches Stop panel formerly
shared the toast's top-right coordinates and obscured progress. Such toasts now
move to a safe-area-aware bottom position above the collapsed launcher only
while Stop is active, including existing/replaced toasts and controller cleanup.
The busy spinner also ignores trusted launcher toggles, so hidden disabled
actions cannot reopen or leave a stale pinned latch; the first idle click opens
normally.

Evidence: the focused integration set passes 10 files / 602 tests; the launcher
suite passes 72 tests; and the final clean complete suite passes 193 files /
6,378 tests. Production build transforms 251 modules; lint has zero errors and
the same three baseline warnings; platform lint, formatting and diff checks are
clean. Final independent review found no remaining P0-P3 issue. A combined live
Comet smoke loaded an exact 29-file candidate, showed the collapsed fox without
covering the page, revealed exactly the current-thread and branch actions, and
collapsed on Escape. The known two-branch ChatGPT canary reached the picker with
653- and 73-message branches plus `Export all branches`; Cancel wrote nothing.
During capture the launcher remained collapsed/busy, and the first idle click
after cancellation reopened both actions, directly covering the latch fix. The
prior exact all-branches HTML/receipt write remains valid because the delivery
path is unchanged. Real narrow touch/safe-area geometry remains a visual
follow-up, not claimed proof. This checkpoint is ready to commit and submit.

## Live same-title owner-context checkpoint

A fresh recapture of a legacy private ChatGPT conversation preserved a complete
2,565,338-byte raw response, 23,088-byte manifest, 4,401,278-byte canonical
archive, 260,042-byte Markdown note, 225,693-byte canonical HTML view, and
540-byte HTML receipt. The archive retained 42 asset records and three exact
same-title groups: two PDF records, five DOCX records, and three further DOCX
records. All ten records have distinct opaque asset IDs; filename equality did
not deduplicate them.

The original raw carries unsupported or ambiguous owner context. Liska therefore
emitted the stable owner-context warning, called no optional resolver/acquirer,
and preserved all 42 assets as `not-attempted` with no SHA-256, local path, or
false fetched claim. This proves live same-title identity and canonical
preservation, not collision-free destination naming for multiple fetched files.
That remaining binary question belongs to a future explicit owner-context
contract and does not authorize borrowing the ordinary-chat resolver.

A new live-shaped regression fixes the observed 2/5/3 topology: ten distinct
IDs survive final canonical rebuilding under ambiguous ownership, all terminal
states remain honest, owner values are absent from canonical output, and no
optional binary path runs. The focused owner-context suite passes 83 tests.
Together with the inventory suite, focused evidence passes 2 files / 104 tests;
the final complete suite passes 193 files / 6,379 tests. Production build
transforms 251 modules; lint has zero errors and the same three baseline
warnings; platform lint, formatting and diff checks are clean. Independent
review found no remaining P0-P3 issue or vacuous assertion path.

## Live generic ZIP binary checkpoint

A fresh ordinary-owner ChatGPT recapture retained a 9,825,646-byte raw response,
139,943-byte manifest, 20,484,025-byte canonical archive, 1,938,029-byte HTML
view, and exact 603-byte receipt. Of 267 canonical assets, nine were fetched and
destination-confirmed: four JPEG, three PDF, and two generic ZIP files. Every
binary's content-addressed filename, byte length, SHA-256 and canonical local
reference match the saved bytes. The two ZIP files are 6,545 and 7,055 bytes,
start with `PK0304`, contain seven readable entries each, and contain no Office
content-type, relationship, PowerPoint, Word, or Excel package roots.

ZIP remains a passive download. Production now accepts exact
`application/zip` only after bounded response reading and a fixed-record prefix
gate: ordinary local-file headers require at least 30 bytes and empty-archive
EOCD records at least 22. MIME-labelled arbitrary bytes and 29/21-byte truncated
headers fail before SHA/runtime persistence while still charging read budget.
This is deliberately not a complete ZIP integrity parser; split, spanned, SFX,
and temporary-split prefixes remain unsupported without separate evidence.

The same capture left five PPTX and two text/plain references `not-attempted`;
interpreter diagnostics explicitly record incomplete resolution. ZIP success
does not relabel or authorize those families. The HTML receipt matches its file
and carries a non-null binding digest; nine fetched assets remain canonical even
when only four selected-branch JPEG references render locally. One literal
`backend-api` phrase occurs only as inert visible text, never in `href`, `src`,
query, or signature-bearing markup. The raw remains below the 16 MiB staged
threshold, so that gate is still open.

Focused acquisition/interpreter/receipt verification passes 3 files / 124
tests. Production build transforms 251 modules; lint has zero errors and the
same three baseline warnings; platform lint, formatting and diff checks are
clean. Independent review reproduced both ZIPs and found no P0-P3 issue while
confirming the prefix-only compatibility boundary. The final complete suite
passes 193 files / 6,385 tests.

## Live CSV negative-evidence checkpoint

A separate fresh ordinary-owner ChatGPT recapture retained a 2,341,476-byte raw
response, 34,869-byte manifest, and 5,392,330-byte canonical archive with 64
asset records. The established active route fetched four verified JPEG images;
both `text/csv` records remained distinct and `not-attempted`. No CSV byte
fetch, SHA-256, local path, or false completion claim occurred, and the only
manifest warning describes the bounded four-image active audit.

This is a negative compatibility result, not authority to add a CSV route. The
current live frontend supplied no exact resolver evidence for either CSV record.
CSV stays unsupported until a credential-free, owner-bound live contract is
observed and independently gated.

## Upstream 2.14.15 audit checkpoint

The upstream audit now covers `244df7f..c1c199c` (`v2.14.9` through
`v2.14.15`): 13 commits and 52 changed files. DOMPurify, Vite, Vitest and
coverage updates are already present; fast-uri, markdown-it and zod changes are
inapplicable to the current dependency tree. Release/copy churn and the
NotebookLM dead-selector cleanup do not justify a broad merge. No upstream
permission, host-permission, CSP, provider-route, or persistence-protocol change
was found.

The high-value signal is upstream DES-019's final note-body HTML boundary, but a
direct port would escape Liska's trusted HTML-comment message sentinels, collide
with the structured `contentFormat` contract, weaken byte-accurate accounting,
and import more revealing logs. Question, tool, citation, math, table, link and
code-fence subpaths are already superseded by stronger local fixes. The next
security slice is therefore a bounded local raw-text/attribute reproducer matrix;
only a confirmed reachable seam may receive an isolated per-path fix. Final
sink-gate work remains deferred until sentinel provenance and append context are
designed explicitly.

## Local final-note HTML checkpoint

The bounded DES-019 follow-up confirmed two reachable local seams. First,
CommonMark treats LF, CRLF, and lone CR as line endings while the line-oriented
angle escape previously split only on LF; a lone CR could therefore hide a
closing fence and leave following HTML untouched. Second, a list-contained
fence could make the bespoke scanner miss the opener and treat its closer as a
new top-level opener. The second payload survived the complete
`conversationToNote` path as an active MDAST `html` node for both user content
and structured assistant Markdown.

The candidate normalizes line endings before fence tracking and obtains exact
fenced, indented, and multiline inline-code ranges from the installed CommonMark parser, with a
monotonic range cursor and a conservative bounded fallback. The authoritative
ordinary-note pass now entity-literalizes every parser-confirmed raw-HTML node,
reparses once after structural edits, and fails closed on invalid parser/range
state. Liska's two append/count comments are not text-allowlisted: the body
composer supplies ordered exact UTF-16 ranges, the safety layer verifies each
full-line marker and shifts the ranges through applied edits, and provider
copies remain inert before composition.

Focused Markdown and safety coverage passes 2 files / 236 tests. The complete
suite passes 193 files / 6,404 tests. Production build transforms 251 modules;
source/platform lint has zero errors and only the same three pre-existing
warnings. Formatting and diff checks are clean. Raw, manifest, canonical,
canonical-derived HTML, destination receipts, append refusal, and physical-byte
accounting are unchanged. Independent review exercised 3,024 production-path
combinations across HTML wrappers, inner Markdown payloads, four code contexts,
three line endings, three message formats, and both roles, plus six actual-note
cases above 1 MiB. It found zero untrusted HTML/image/private-link nodes and
retained a two-message count throughout; 10k/20k/40k helper-line probes completed
in 250/415/857 ms without the former quadratic curve. Live Obsidian rendering
was not repeated; parser reparse evidence proves the active nodes are absent
from generated source while exact generated markers remain.

## Security Cloud runtime-boundary checkpoint

The 2026-10-25 reconciliation closed three already-merged historical findings
without launching a new Cloud scan: TypedArray capture integrity
(`commit:0fb1786e6cf08191a25da26b5593adfc`), unbounded branch fan-out
(`commit:16702a6e90648191ba8a63da60539e95`), and nested Canmore JSON
(`commit:8fc721c0bb0881919910f4805e72250d`). Each occurrence advanced from
version 7/new to version 8/fixed only after its fix ancestry and current-main
invariant were reread. Eight existing findings remained open at that point.

PR 46 merged the two shared runtime-boundary repairs as `4070b1d`. Append-mode path
hints are keyed by normalized endpoint, exact vault template, stable search
root, provider, and conversation id; no API key enters the key. The current
direct path has authority over a memo, and the hinted file's parent must match
the exact current template with date tokens retained as rollover variables.
Endpoint or destination changes, sibling prefixes, leading-date templates, and
inline forms such as `AI/{platform}-{YYYY}` are covered without breaking title
renames or calendar rollover.

The Gemini CDN worker no longer calls `response.blob()` before enforcing its
10 MiB limit. It rejects a clearly oversized `Content-Length`, counts actual
streamed bytes regardless of headers, cancels on the first over-limit chunk,
and retains the existing five-second deadline through the body read. Missing
bodies, unsupported MIME, HTTP errors, stalled reads, and cancellation failures
produce stable local failures; ordinary credentialed CDN fetch and exact-cap
images retain their prior result contract. The stale append-path occurrence,
the post-buffer image-size occurrence, and the overlapping timeout occurrence
are now closed as fixed against that merged head. Five informational findings
remained open afterward.

Focused source-to-sink coverage passes 6 files / 295 tests. The complete suite
passes 198 files / 6,633 tests. Production build transforms 253 modules;
formatting and diff checks are clean. Source/platform lint has zero errors and
the same three pre-existing advisory warnings. Independent review found one
real rollover regression for a date token embedded inside a path segment; the
template matcher above fixes it, its reproducer is retained, and the final
static refresh found no remaining bypass or compatibility regression. A live
Chrome CDN transfer was not repeated, so actual browser decompression,
same-host redirect, and transport-cancellation behavior remain explicit proof
gaps rather than claimed runtime evidence.

## Security Cloud final-hygiene checkpoint

PR 47 merged the final-hygiene candidate as `47c944b`. Obsidian
text, binary, and directory body consumption uses the same transport-error
normalization as the initial fetch. Append mode no longer treats any uncertain
read or operation as proof that the old note is absent: recognized API errors
return the established user guidance, while unknown errors fail with the fixed
`append-operation-failed` code; neither path starts a fresh overwrite.

Frontmatter list parsing now mutates its fresh per-key array with `push` instead
of copying the complete prefix for every item. Ordering, duplicates, quoted
values, duplicate-key reset, LF/CRLF handling, raw frontmatter, and body bytes
remain unchanged; a 20,000-item regression covers the former quadratic shape.

The real Google account-avatar URL has been removed from the captured Gemini
fixture and replaced by an inert one-pixel data URL without changing extracted
conversation output. A fixture-wide architecture test rejects that account
avatar namespace while leaving legitimate generated-image CDN paths available.
The fixture guides now require account/profile identifiers to be synthetic.
Historical Git copies are not rewritten by this source fix and remain an
explicit repository-history limitation.

The Chrome Web Store draft now marks Authentication information `Yes`: the
user-supplied Obsidian key is locally stored and used only for authenticated
loopback requests, never synced, exported, or sent to a third party. CI keeps
its existing triggers, read-only token, Node 24, npm cache, and commands, but
pins checkout v7 and setup-node v7 to the exact full SHAs returned by their
official GitHub tag refs; checkout credential persistence is explicitly off.
The exact pinned action metadata also declares `node24`.

Focused verification passes 14 files / 498 tests. The complete suite passes
200 files / 6,651 tests. Independent review found one surviving unknown-body
error route into the old append fallback; the final fail-closed change and its
no-write regressions remove it, and the refreshed review is clean. Production
build transforms 253 modules; source/platform lint has zero errors and the same
three pre-existing advisory warnings; formatting and diff checks pass. Exact-head
CI, Code Review, and Security Review completed clean, and all five corresponding
Cloud records were then closed. The repository currently has zero open
`new`/`triaged`/`in_progress` Security Cloud findings. No live Obsidian body
interruption or Store dashboard submission was repeated; those remain explicit
runtime boundaries rather than inferred success.

## ChatGPT official-export importer core checkpoint

The first browser-independent official-export slice is implemented on
`codex/chatgpt-official-export-importer`. It streams a complete conversations
JSON array under fixed source/object/count/depth ceilings, selects exactly one
conversation by provider ID, and retains only that object's byte-exact owned
excerpt. Neighboring chats are parsed for source validity and duplicate IDs but
their bytes are cleared rather than retained. Titles, array position, and graph
shape are never selectors.

`liska-capture/1` now distinguishes existing HTTP artifacts from an honest
`official-export-slice` file source. Existing browser manifest serialization is
unchanged; official provenance retains only semantic file role, conversation
index, byte offset, and observed source length—never a local filename or path.
The selected excerpt hash is authoritative. This first slice does not claim a
portable whole-file digest or reconstructability after the parent export is
gone.

The official normalizer profile is fixed to `chatgpt-official/1` and can run
only with method `official-export`. Official nodes in the measured format omit
`children`, so canonical child links are derived from the authoritative
`parent` relation in parsed mapping order and disclosed through
`official-export-children-derived`. Mixed explicit/derived child shapes fail
closed. Asset descriptors are inventoried as metadata-only `not-attempted`
records; no binary directory or signed transport is inferred. A valid excerpt
whose graph cannot normalize returns the last verified conservative `raw-only`
bundle with graph/messages/branches marked `unknown`, never false canonical
success. Duplicate keys at any JSON object depth fail before `JSON.parse` can
discard the earlier value.

Synthetic focused coverage currently passes 8 files / 242 tests, including 86
selector cases. Two content-free local smokes streamed the 109,346,038-byte
official file end to end: a 1,051,058-byte excerpt produced 294 nodes / 293
messages / 42 assets, and a 2,322,195-byte branched excerpt produced 686 nodes,
two leaves, one branch point, and 22 assets. Both canonical archives validated;
no title, message, filename, or attachment value entered the logs or repository.

The complete suite passes 202 files / 6,750 tests. Production build transforms
256 modules; source/platform lint has zero errors and the same three
pre-existing advisory warnings; formatting and diff checks pass. Independent
review found two material loss paths—duplicate JSON keys discarded by
`JSON.parse`, and recovery rehashing that could lose an already verified
raw-only bundle. Nested key tracking and conservative-first manifest promotion
close both; the final review is clean.

Browser file-picker/orchestration, durable raw/manifest/canonical writes,
official export ZIP/binary association, parent-file hashing, and cross-format
comparison are not part of this core slice. ADR-037 records the exact boundary.

## Dots route-isolation checkpoint

Two trusted exports from `https://chatgpt.com/dots/home` confirmed a host-only
false positive. Each produced a separate 9,091-byte note labelled ChatGPT with
a timestamp-derived ID, ten visible DOM messages, and no raw, manifest,
canonical archive, or loss warning. After removing only generated IDs and
timestamps, the two note bodies were byte-identical. This is not Dots support.

The candidate introduces a narrow route guard: exact `chatgpt.com` paths
`/dots` and `/dots/*` are rejected by `ChatGPTExtractor.canExtract`, and
bootstrap now admits an extractor only when its own route-aware `canExtract`
passes. Dots therefore receives no ChatGPT current/branch controls and cannot
reach Base DOM fallback through `handleSync`. Ordinary `/c/{id}`,
`/g/{slug}/c/{id}`, non-Dots legacy DOM fallback, and all other providers keep
their existing admission behavior.

Focused route/extractor/bootstrap/UI/architecture coverage passes 8 files / 324
tests; the complete suite passes 203 files / 6,771 tests. Production build
transforms 257 modules; source/platform lint has zero errors and the same three
pre-existing advisory warnings. Independent review found two lifecycle races:
post-readiness injection after navigation and busy-state loss when controls were
recreated. Post-wait admission, eligibility-aware SPA teardown/restoration, and
an operation-level export lock close both; the refreshed review is clean. This
is only a misclassification guard: no Dots raw transport, branches,
memory/persona state, attachments, canonical adapter, or durable output is
claimed. History-only URL changes without a DOM mutation and live SPA behavior
remain explicit proof gaps; trusted sync still rechecks admission before output.

The next Dots transport-discovery pass remains stopped before code, but an
explicitly authorized selected-tab observation now grounds the route family.
One current Dots page used exact same-origin JSON GETs for
`/backend-api/tbo/by-thread/{thread}`, `/backend-api/tbo/{dot~user}`,
`/backend-api/tbo/{dot~user}/threads?include_hidden&limit`,
`/backend-api/messaging/rooms/{room}`, and
`/backend-api/messaging/rooms/{room}/messages?limit`. The same page separately
used a room `live` event stream plus aeon/voice routes; those realtime/write
surfaces are not conversation-history authority. All identifiers and query
values were redacted before retention.

The observation recorded only method, normalized path shape, query-key names,
status and response MIME. It read no header, cookie, storage value, request or
response body, and issued no direct API request or synthetic message. One
selected-tab reload reproduced the routes; Chrome did not make the already
received bodies available through the bounded CDP surface. A content-free scan
of existing official ChatGPT exports yielded no matching Dots/TBO/room
route-based evidence; whether those exports contain a usable Dots conversation
representation remains unverified.

This route grammar is sufficient to design a narrow user-initiated selected-tab
probe, not to implement a provider adapter. The next evidence gate is a
schema-only shape from one exact room-metadata GET and its same-room messages
GET, accepting exactly one room identity during a finite observation. The TBO
route bodies remain out of scope: their presence does not prove that they omit
memory, persona or account state. Only after the schema gate may one
conversation-scoped raw artifact be considered. No generic same-origin
observer, dynamic allowlist learning, direct request replay, realtime stream
capture, memory or persona collection is authorized.

Branch `codex/dots-schema-probe` implements that evidence gate as a diagnostic,
not an exporter. An exact popup-only action reloads one already-selected Dots
tab once. A separate MAIN-world document-start observer admits only page-owned
GETs for one room-metadata endpoint and its same-room `messages?limit` endpoint,
then retains only a fixed-vocabulary structural schema. Provider values,
unknown property names, IDs, URLs, hashes, timestamps and response bodies never
cross the evidence boundary; TBO, live, aeon and voice surfaces remain excluded.
Background revalidates the detached projection, top frame and exact document,
removes only its nonce marker, and writes one fixed local diagnostic JSON file.
No archive, Obsidian, Clipboard or settings sink is reachable from this action.

The production build now post-bundles the import-free observer into one
synchronous classic `dots-schema-document-start.js`. The built manifest keeps
ordinary ChatGPT first and Dots second inside one ordered MAIN document-start
entry; this avoids a live Comet compatibility failure where the second of two
otherwise identical entries was never parsed. The current Dots artifact is
22,517 bytes with SHA-256
`2712899de29de7caee8ac738654db62f129b51b2e5cc0bc1056f81df22a5167d`.
Focused route, observer, contract, popup, build and worker checks pass; the full
coverage suite passes 231 files / 7,849 tests with one existing skip. Production
build transforms 292 modules, lint has zero errors and the same three
pre-existing warnings, and statement coverage is 95.04% against the unchanged
95% floor. CI's layering rule also remains unchanged: the self-contained
`chrome.scripting` page-state reader lives in `lib`, so background no longer
imports the import-free MAIN observer from `content`. Independent review is
clean after fixing the async-loader gap, ordinary failure cleanup, a late
`tabs.update` marker race and same-document host fragment removal.

Live provider compatibility is still deliberately unclaimed. An installed
stable-page canary proved that the synchronous hook arms, returns the fixed
`target-not-observed` refusal, removes its nonce fragment and writes no file.
The host can also remove that fragment itself in the same document, so the hook
now accepts only the exact marked URL or its exact hashless base while background
still pins the document ID. A metadata-only refinement can distinguish an exact
room Fetch refused solely because `RequestInit` is present without reading any
init field. Its live classification remains pending: later attempts were
invalidated by the Dots page itself failing during reload.

One later trusted popup canary ran once on a stable eligible Dots tab and
returned exactly `Dots schema probe did not complete (timed-out).` The nonce
fragment was absent afterward, and no diagnostic download appeared in browser
or filesystem checks. The operation was not retried. That code can originate
either from the MAIN observer's hard deadline or the background observation
deadline; the popup does not distinguish them. Hook arming, endpoint admission
and Fetch-init versus URL-object versus XHR therefore remain unproven for this
run. No route or transport admission was widened, and this result alone does
not justify another run or a Fetch/XHR adjustment. Once the real raw contract
is grounded, the schema control should move out of the ordinary product surface
or be removed.

Branch `codex/dots-timeout-origin` closes only that diagnostic ambiguity. The
unchanged MAIN hard timer now emits fixed `observer-timed-out`; exhaustion of
the background polling deadline emits fixed `background-timed-out`. Generic
`timed-out` remains an accepted legacy response for mixed-version cleanup but
is not emitted by current code. No request, route, timer, retry, captured value,
projection field, permission, download or durable sink changed. Focused
observer/background/contract coverage passes 3 files / 203 tests, TypeScript
passes, and the five unrelated Claude auto-scroll cases that timed out only in
the resource-heavy full run passed together in isolation. No installed Dots
canary has been run from this candidate; live provider compatibility and raw
adapter authority remain unclaimed. `ITH-008` preserves the longer evidence
gate and revisit conditions.

The intended archive behavior after this evidence gate is not a permanently
redacted export. For the current workflow, one Dot to one long-lived room is the
working identity hypothesis: create one complete local raw/manifest/canonical
and Markdown snapshot, then append only provider-ID-backed tail messages after
reverifying the same Dot/room identity and exact historical prefix. Raw,
manifest and canonical captures remain append-only snapshots. Room changes,
history edits/reordering, incomplete pagination or any non-prefix result must
fork a new snapshot with an explicit diagnostic rather than overwrite or merge
silently.

## ChatGPT cross-format reconciliation core checkpoint

Branch `codex/chatgpt-cross-format-reconciliation` adds a browser-independent,
compare-only contract for one `chatgpt-web/1` canonical snapshot and one
`chatgpt-official/1` snapshot of the same exact provider conversation. The
fixed result schema is `liska-chatgpt-comparison/1`; semantic projections are
domain-separated under `chatgpt-canonical-semantic/1`.

The comparator detaches both inputs before its first hash await and rejects
accessors, symbols, cycles, sparse arrays, non-plain/non-JSON values, unsafe hash
results, and mutation of the owned hash bytes. Container width is checked before
child descriptors are read; descriptors are then consumed lazily. Combined
non-raiseable ceilings cover JSON values/depth/string units, nodes, blocks,
assets, diagnostics, difference rows, digest work, and final report bytes.
Failures—including caller Proxy traps—expose only a fixed error code.

The report keeps exact left/right capture scope and exact canonical IDs, then
compares conversation fields, node topology, message ownership and typed blocks,
asset metadata/content/acquisition claims, leaf ancestor chains, and bounded
diagnostic code/severity counts. It does not copy titles, message text,
filenames, paths, diagnostic text, source references, or provider extensions;
it does not merge, fuzzy-match, deduplicate, or infer asset absence. Parent-
derived and sibling/root order remain explicitly informational.

A private content-free local smoke compared two already-existing raw-derived
canonical snapshots of the same conversation. The web side had 494 nodes, 493
messages, and 42 assets; the official side had 294 nodes, 293 messages, and 42
assets. The report found 128 semantically equal common nodes, 200 web-only nodes,
166 common-node conflicts, 200 web-only messages, 293 common-message conflicts,
and all 42 exact asset IDs equal with no asset conflict. No official-only node,
message, or asset ID was present. The report was 402,000 UTF-8 bytes and logged
no private payload text or local path.

This proves a real cross-format retention difference while separately preserving
asset agreement. It does not prove the cause of the 200 omitted official nodes,
external binary availability, or completeness of either capture. ADR-038 records
the contract and the next delivery boundary.

Focused verification passes 5 files / 110 tests, including the new reconciler
plus official importer, canonical core, and branch semantics. The complete local
suite passes 204 files / 6,809 tests; TypeScript plus the production build pass
with 260 transformed modules. ESLint has zero errors and the unchanged three
baseline warnings, while platform lint, Prettier, and `git diff --check` pass.

## ChatGPT reconciliation local-delivery checkpoint

Branch `codex/chatgpt-reconciliation-delivery` turns the merged official import
and compare-only core into an explicit local File workflow. The popup opens a
dedicated extension page rather than trying to keep a long 109 MiB stream alive
inside the transient settings popup. The page accepts one existing web canonical
JSON and one uncompressed official conversations JSON; neither source is
modified, uploaded, discovered automatically, or matched by title/filename.

The delivery core copies and caps web bytes before decode, rejects BOM, invalid
UTF-8, malformed JSON, duplicate decoded keys, excessive depth/value work, and
any archive except exactly one `chatgpt-web/1` ChatGPT input. Its exact provider
conversation ID is the only official selector. Official bytes stream in bounded
chunks through the complete-array importer. Normalized output contains exact
official raw, official manifest, official canonical, a content-free comparison
envelope, and a root `liska-chatgpt-reconciliation-bundle/1` manifest. Raw-only
normalization failure preserves exact raw+manifest+root manifest and makes no
comparison claim.

The selected web file is bound by exact original byte length/SHA-256. The root
manifest excludes itself; its exact byte hash is the opaque bundle ID, while the
conversation path key is a hash of the provider ID. Fixed artifact paths, per-
artifact and aggregate hard ceilings, sequential sanitized hashes, and owned
bytes preserve deterministic append-only evidence without importing source
filenames, local paths, titles, message text, source references, extensions, or
diagnostic prose into metadata.

One deterministic ZIP32 STORE archive carries the ordered artifacts with CRC-32,
UTF-8 names, fixed timestamps, and bounded output. One content-addressed Save As
download distinguishes confirmed, interrupted, start-failed, and unconfirmed
states; uncertain dispatch is never retried automatically and retains its Blob
lease for bounded late-terminal cleanup. Cancellation stops local stream work
before output. The UI explicitly explains that the user must choose a source
folder in Save As because read-only file selection grants no write authority.

Independent review reproduced two P2s: collect-all canonical validation could
amplify a compact malformed graph into millions of issues before refusal, and a
completion first observed by timeout reconciliation could race into a false
`unknown`. Exact input cardinality plus node/block/asset/diagnostic ceilings now
run before a one-issue bounded validator, and timeout reconciliation awaits the
already-observed terminal item. Focused reproducers and the bounded independent
recheck are clean with no remaining material finding.

A content-free real core smoke streamed the existing 109,346,038-byte official
export against the existing 4,401,278-byte web canonical file. It completed as
normalized in about three seconds, producing five artifacts totaling 2,516,091
bytes, a 402,891-byte comparison envelope, and a 2,516,775-byte ZIP with the root
manifest last. Only content-free counts/sizes were logged and no filesystem
output was created; exact private raw/canonical data remained inside the
in-memory bundle. Local browser rendering confirms the desktop page and popup
entry are readable. The exact 36-file candidate was copied byte-for-byte into the
established Comet unpacked-extension directory after preserving its previous
29-file tree at `CodexTools/liska-rollbacks/reconciliation-delivery-prelive-
20261025-041110-0336d76`; eleven stale hashed assets were removed from the live
tree and remain recoverable there. Comet confirmed extension reload and opened
the candidate reconciliation page. Product policy reserves local extension-page
file selection and Save As for the user, so that final write remains the live
gate rather than an automated claim.

The focused importer/comparator/delivery/UI set passes 8 files / 232 tests.
The memory-bounded complete suite passes 208 files / 6,861 tests; TypeScript and
the production build pass with 269 transformed modules. Source/platform lint has
zero errors and the same three baseline warnings; Prettier and diff checks pass,
and the production dependency audit reports zero vulnerabilities. Independent
review and its bounded recheck are clean. The user-owned installed-extension
file-selection/Save As completion remains before the live gate can be closed.

## ChatGPT reconciliation Obsidian candidate checkpoint

Stacked branch `codex/chatgpt-reconciliation-obsidian` adds a separate explicit
Obsidian destination to the reconciliation page without changing the reviewed
File ZIP route. It is off by default and does not contact Obsidian merely because
files were selected. Preparation remains page-local; artifact bytes never cross
runtime messaging or extension storage.

The writer reads strict local-only settings once, validates exact loopback host
`127.0.0.1`, pins one operation date/folder and fresh attempt ID, detaches and
re-hashes the complete normalized/raw-only delivery before its first network
write, and routes only fixed artifacts under
`_liska-reconciliation/{conversationKey}/{bundleId}/{attemptId}/`. No title,
source filename/path, provider ID,
vault folder, loopback URL, API key, or exception prose enters receipts.

An authenticated bounded root capability read must identify Obsidian Local REST
API with a stable numeric self version at least 5.5.0. This is the first version
whose official contract makes `If-None-Match: *` atomic create-only and returns
412 without writing. Every target is first checked with a redirect-refusing
zero-body existence read; each exact-byte conditional PUT is followed by bounded
binary readback and length/SHA-256 verification. Artifacts remain sequential and
the unchanged root manifest is last. Collision, timeout, response loss,
readback mismatch or cancellation stops successors, performs no retry/delete,
and reports partial/unknown state honestly.

The installed unauthenticated root reports service `Obsidian Local REST API`,
self `5.1.0`, and Obsidian `1.14.4`. The candidate therefore refuses this live
installation before artifact-path access; no vault write was attempted. Official
5.5.0 release documentation confirms conditional create-only semantics. A user
plugin update and bounded positive/collision canaries remain required before
this destination can be called live-verified.

The writer/API/delivery set passes 3 files / 160 tests, while the integrated
writer/page/API set passes 5 files / 178 tests. The memory-bounded complete suite
passes 209 files / 6,931 tests; TypeScript and the production build pass with 270
transformed modules. Source/platform lint has zero errors and the same three
baseline warnings; Prettier, diff checks and the production dependency audit are
clean. Independent review found no material issue. Positive 5.5+ normalized,
collision, cancellation and page-lifetime canaries remain before a stacked PR.

After PR 51 merged, this branch integrated the reviewed File slice plus current
`main`. Conflict resolution retained ADR-040 and every later checkpoint, while
the combined popup/build keeps both Archive Tools pages private and independent.
The current-main Obsidian/reconciliation/API/snapshot targeted matrix passes 13
files / 330 tests; the complete suite passes 220 files / 7,230 tests with two
workers. TypeScript/build pass with 287 transformed modules; source/platform
lint has zero errors and the same three warnings; formatting/diff and the built
snapshot-page closure guard pass. A fresh 5.5+ capability check and the
positive/collision/cancellation/page-lifetime live canaries remain before merge.

The branch was later merged with current `main` after the final reading-
Markdown, provider-compatibility and snapshot-analysis core/page slices landed.
The combined popup keeps both Archive Tools entries, Vite emits both private
reconciliation and snapshot-analysis pages, and the snapshot analyzer remains
outside provider web-accessible resources. The integrated targeted matrix
passes 16 files / 367 tests; the complete suite passes 219 files / 7,160 tests
with two workers. A fresh exact-head TypeScript/build pass transforms 287 modules; source/
platform lint has zero errors and the same three warnings, formatting/diff and
the built snapshot-page closure guard pass.

The fresh production candidate was then installed with a recoverable 36-file
rollback and verified byte-for-byte across all 40 current files. One user-owned
run saved a 2,516,895-byte normalized reconciliation ZIP from the existing
4,401,278-byte web canonical plus 109,346,038-byte official source. Independent
verification passed signature/central directory, CRC, five ordered STORE
entries, fixed timestamps, root-last ordering, root-hash filename binding and
every artifact length/SHA. The 1,051,058-byte official excerpt exactly matched
its declared source slice; manifest, canonical and comparison identities
reconciled; the 402,939-byte content-free comparison copied no tested complete
title/message payload strings and the ZIP retained no neighboring conversation
entry. The File delivery live gate is closed; merge and stacked PR rebases are
next.

The final current-head Code Review also found a terminal-ordering P2 in the
Save As observer: a `complete` event racing an older timeout search could wait
on a second filename lookup while the stale `in_progress` result settled the
caller as `unknown`. Event completion now becomes terminal synchronously with a
nullable filename; search completion still retains the observed name. The
strengthened regression holds all unexpected later searches pending, fails on
the old code as `unknown`, and passes on the fix with exactly two searches and
one cleanup. Independent bounded recheck found no remaining material issue.

After Local REST API was updated, both public and authenticated loopback root
reads identified service `Obsidian Local REST API`, self `5.5.2`, and Obsidian
`1.14.4`; the authenticated response was admitted without reading a vault path.
An exact-head local production-core canary then prepared the same measured web/
official pair and wrote one normalized five-artifact snapshot through the real
API. The directory contained exactly 2,516,236 bytes: official excerpt,
official manifest, official canonical, content-free comparison, then the
2,023-byte root manifest. Independent filesystem verification matched every
descriptor length/SHA-256, the exact source-file byte slice, canonical and
comparison schemas, root hash/bundle ID `370691c6...3015`, and a strictly later
root timestamp.

The same live target then exercised the atomic race boundary: preflight was
deliberately held at absent while the first create-only PUT targeted the
existing artifact. Local REST API returned 412, Liska reported fixed code
`collision`, performed no readback or successor write, and the original bytes
remained hash-identical. A separate cancellation immediately after authenticated
server admission stopped before the first artifact-path request and created no
attempt directory. The writer/API positive, exact-readback, root-last, 412 and
cancellation gates are therefore live-verified. The installed exact build and
its reconciliation page were reloaded in Comet, but browser control cannot
acquire `chrome-extension://`; this run does not claim a repeated native file-
picker/result-rendering or mid-request page-unload canary. Those page bindings
remain covered by the integrated offline suite rather than hidden as live
evidence.

## Final reading-Markdown persistence seam checkpoint

Branch `codex/persistence-seam-evidence` converts the upstream 2.14.15 DES-019
audit into local evidence and a narrow adaptation. On unchanged current main, a
synthetic matrix produced 11 failures from 18 cases: an existing open
`<script>`, `<pre>`, HTML comment, or Markdown fence could activate or swallow a
separately safe append tail, while Deep Research retained a remote Markdown
image and private body/References links after its separate converter path.
Closed contexts, forged-marker reservation, parser failure, and literal HTML
controls stayed safe.

The complete Deep Research body now enters the existing structural
active-Markdown policy after References are appended. Public citations remain
active; private destinations and automatic remote images become literal; only
captured-image-backed `g2o-image://` placeholders retain authority. The final
body hash follows that transformation, and source conversation objects remain
unchanged.

Append now transforms only the extracted new tail. A separate refusal-only
mdast gate parses the exact LF-normalized joined body before any PUT, validates
the new tail's exact composer-owned marker positions, and rejects HTML/code
contexts or effective CommonMark references that cross the seam. The old body
is never sanitized. Failure returns one fixed value-free code, performs no note
or binary write, and cannot fall through to a fresh overwrite. The existing
LF/CRLF/lone-CR restoration contract remains last. Trusted and empty legacy
zero-message notes append their first message with exactly one format marker.

The gate bounds parser input at the existing 32 MiB content ceiling and tree
work at 200,000 scheduled nodes. That is not a new durable-file-size promise;
the initial parser allocation, Obsidian-specific footnote/plugin semantics, and
network failure after binary image writes remain explicit limits. Raw,
manifest, canonical, canonical-derived HTML, reconciliation, staged transport,
and archive receipts are unchanged. ADR-042 records the boundary.

Focused verification passes 9 files / 606 tests. The complete local suite
passes 206 files / 6,920 tests with two workers. TypeScript and the production
build pass with 261 transformed modules; source/platform lint has zero errors
and the unchanged three advisory warnings; repository formatting and diff
checks pass. Independent review found one low-reachability zero-count
compatibility regression; it is fixed, covered in trusted/legacy forms, and the
bounded recheck is clean. Actual Obsidian rendering was not repeated.

## Upstream provider compatibility checkpoint

Branch `codex/upstream-provider-small-fixes` applies two narrow behavior ports
from the retained upstream audit without importing divergent extractor modules.
Gemini now prefers its bounded generated conversation name from
`document.title` and retains the first-query/default fallback for empty or
product-only titles. NotebookLM drops the obsolete
`.xap-inline-dialog.citation-marker` selector; the current numbered
`button.citation-marker` shape, including `chat-bidi-enabled`, remains covered
and the `mat-icon` more-citations button stays excluded.

No route, conversation identity, permission, setting, destination, append,
raw/canonical archive, or citation-provenance contract changed. The complete
suite passes 206 files / 6,927 tests; the focused Gemini/NotebookLM/readiness
set passes 3 files / 157 tests. A current authenticated provider page was not
repeated, so live title and selector compatibility remain explicit rollout
gates rather than inferred success.

## Snapshot analysis-only core checkpoint

Branch `codex/snapshot-dedup-analysis` implements the first explicit snapshot
deduplication slice without granting any mutation authority. Callers supply two
to sixteen exact byte inventories; the core synchronously detaches accepted
views, strictly parses bounded JSON with duplicate-key rejection, recomputes
every file hash/length, verifies current-writer ChatGPT web raw/manifest/fetched
assets, replays canonical normalization, and emits a deterministic ordinal-only
plan. There is no filesystem discovery, browser/UI route, delete, move,
quarantine, rewrite, or safe-to-delete result.

Every candidate relation carries `preserveBoth: true`. Exact complete inventory
bytes can be `byte-identical`; equal raw with differing evidence remains
`same-raw-different-evidence`; equal versioned canonical projections with
different raw are advisory `semantic-candidate`; partial or unsupported exact
matches remain `unverifiable`. Raw-only, partial, opaque/presentation-bearing,
unsupported-version, integrity-failed, first/latest/tied chronology and graph-
change snapshots receive explicit preservation reasons. Graph transitions are
set-based inside timestamp ties and bridge raw-only/unverifiable gaps, including
A→B→A reversions.

Independent review found three material boundaries. The public inventory digest
initially committed private/title-derived slot names; it now hashes only a
sorted multiset of byte lengths and content digests while exact path equality
stays internal. Tied graph changes initially depended on selection order, and
raw-only snapshots could hide a later verified transition; timestamp graph sets
and adjacent nonempty observations close both. Replay output now receives the
same canonical ceilings before certification. The bounded final recheck is
clean.

Focused verification passes 7 files / 214 tests. The complete local suite
passes 209 files / 7,028 tests with two workers. TypeScript and the production
build pass with 268 transformed modules; source/platform lint has zero errors
and the unchanged three advisory warnings; repository formatting and diff
checks pass. Coverage before the final four regressions was 95.01% statements,
92.21% branches, 100% functions and 97.34% lines for the new core. ADR-043
records the current-writer-only, selected-inputs-only and trusted-hash limits.

## Snapshot analysis local-page checkpoint

Branch `codex/snapshot-analysis-ui` exposes the preserve-only core through a
dedicated extension page rather than the transient settings popup. The user
adds two to sixteen snapshot folders separately; each trusted selection is
copied immediately, one common top-level folder segment is validated then
discarded, nested slots and opaque extras remain intact, and the complete
operation is preflighted before sequential reads. The page displays only
ordinals, counts, measured bytes, fixed evidence labels/codes and content
commitments. No folder/file name, source text, native exception, setting,
credential, storage value or runtime message crosses the page boundary.

Analysis/cancellation uses an operation epoch and AbortSignal. New accepted
selections, removals and reset invalidate stale results; opening then cancelling
the picker or submitting a rejected folder preserves the existing report and
unknown-download observer. Web Crypto yields between hashes, while copy warns
that active digest and synchronous parser work cannot stop instantly. Exact
encoded plan bytes can be saved only by a trusted click. The page distinguishes
confirmed exact-ID terminal completion, failure and unknown; unknown disables
redispatch until a deliberate new analysis/reset, and stale callbacks consume
`runtime.lastError` without exposing its message.

The page imports no background/content/offscreen/storage/network or filesystem-
mutation layer. A static popup link opens it independently of settings reads.
The production build keeps the page/analyzer/controller chunk private; one
shared WAR chunk contains only the pure ChatGPT normalizer/validators used by
both replay and content extraction. Removing the otherwise unused snapshots
re-export from the broad archive barrel made this closure explicit without
manual chunk duplication or manifest/permission changes.

Focused verification passes 9 files / 91 tests; the complete suite passes 215
files / 7,107 tests with two workers. TypeScript and the production build pass
with 277 transformed modules; source/platform lint has zero errors and the same
three warnings; formatting, diff and the actual built-page closure guard pass.
Independent review found two lifecycle P2s—picker-open/invalid selection erased
valid state, and stale Save As callbacks could leave `runtime.lastError`
unconsumed—plus effective-language accessibility drift. All are fixed and the
fresh built artifact recheck is clean.

An isolated synthetic Chrome render reached ready state at 1280 px and 390 px
with no page errors, external requests, horizontal overflow or canary-name
display. This is layout evidence only. Installed extension folder selection,
native Save As/Downloads behavior, browser portability and near-limit
responsiveness were not exercised and remain explicit live gates.

## ChatGPT official-export multi-shard candidate checkpoint

Stacked branch `codex/chatgpt-official-shards` removes the requirement to guess
which physical conversation array contains the exact web-canonical conversation
ID. Legacy `conversations.json` stays unchanged; the page can now accept one or
more exact `conversations-NNN.json` files, snapshots the complete FileList,
rejects mixed/duplicate/extra names before reading bytes, and sorts numeric shard
indices independently of picker order. Only fixed numeric shard provenance is
serialized; source filenames and local paths remain transient.

Core scanning is sequential and bounded across the complete selected set. All
shards share one 2 GiB observed-byte ceiling, one 100,000-record ceiling, one ID
ledger and an explicit 1,000-source cap. Current-object size/depth limits remain
unchanged. A target match never short-circuits later UTF-8/JSON/neighbor/trailing
validation; duplicate target or unrelated IDs across shards fail, and retained
selected bytes are erased on any late failure. Import, normalization and bundle
construction run once only after every shard succeeds.

Conversation index, JSON pointer, byte offsets and source length remain local to
the selected shard; optional numeric `shardIndex` propagates through exact raw
source, canonical `openai.officialExport` and delivery receipt, while the legacy
single-file serialization omits it. Three measured manifest-v1 exports all
declare logical `conversations.json` as six shards `000…005`.

The live August set contains 561 array records across six files totaling
477,261,486 bytes (largest 133,894,326). Initial strict validation exposed four
literal empty objects in shard 004 and no other identity-free record. Exact `{}`
is now treated as provider padding: it consumes the aggregate record budget,
increments `ignoredEmptyRecordCount`, and produces explicit manifest/provenance
evidence. Any nonempty object without a valid ID/mapping still fails closed.

The final content-free six-shard smoke completed normalized in about 11.7 seconds,
selected shard 0, disclosed four ignored empty records, and produced five
artifacts totaling 2,516,426 bytes with a 402,944-byte comparison envelope. No
conversation value/provider ID was printed and no filesystem output was written.

Focused selector/importer/capture/normalizer/delivery/UI verification passes 6
files / 227 tests; the memory-bounded complete suite passes 209 files / 6,953
tests. TypeScript and the production build pass with 270 transformed modules;
source/platform lint has zero errors and the same three baseline warnings;
Prettier, diff checks and the production dependency audit are clean. Independent
review is clean after hostile metadata/Proxy hardening. Installed shuffled-
FileList/cancellation/ZIP canaries remain before a stacked PR can merge.

After the Obsidian reconciliation slice merged, the one shard commit was
replayed onto current `main`. Conflict resolution retained every later status,
ADR and exact 5.5.2 live receipt, added ADR-041 in chronological order, and did
not touch the current terminal-download fix, either private Vite entry or the
extension manifest. The integrated importer/reconciliation/normalizer/snapshot
matrix passes 18 files / 464 tests; the complete suite passes 220 files / 7,252
tests with two workers. TypeScript and the production package build pass with
287 transformed modules. Source/platform lint has zero errors and the same three
warnings; formatting, diff, built snapshot-page closure and the production
dependency audit pass with zero vulnerabilities. Installed multi-file canaries
remain the next evidence gate.

The exact rebased production build was then installed with a recoverable
40-file rollback. A direct production-core canary accepted all six real shards
in shuffled descriptor order, consumed all 477,261,486 bytes numerically, kept
the target in shard 0, disclosed four empty records, and produced five artifacts
totaling 2,516,416 bytes plus a deterministic 2,517,100-byte ZIP. The same bytes
passed the current Obsidian writer/readback. A later-shard cancellation reached
shard 4 and performed zero hash/output work; an omitted-target set consumed all
367,915,448 remaining bytes before fixed refusal.

After extension reload, one real installed-page run showed six selected files
and verified the Obsidian-only destination. It produced one new immutable
five-artifact attempt totaling 2,516,521 bytes with bundle ID
`2d79b83d...f0a1c`. Independent filesystem verification matched every
descriptor length/SHA-256, the exact selected shard-0 source slice,
`shardIndex: 0`, four ignored empty records, all three expected schemas, the
root hash/bundle ID and root-last timestamp. The page reported all selected
destinations verified. Native screenshot capture remained unavailable, but the
accessibility tree exposed the exact six-file selection and final status.
Installed native negative-input acceptance now closes two bounded UI paths.
Selecting synthetic `conversations-000.json` together with an invalid
`export_manifest.json` produced the exact fixed failure status, kept the result
panel hidden, restored every control and made zero Local REST requests. The
synthetic source hashes, lengths and modification times remained unchanged, and
no new reconciliation ZIP or partial appeared in either Downloads root.

The first uninstrumented 512 MiB cancellation attempt lost the timing race:
Save As opened before the click, the File dialog was cancelled, and an already
completed synthetic Obsidian snapshot remained append-only. It is therefore not
accepted as cancellation evidence. A clean fresh-page repeat used only a
transient page-local hold around the selected later shard's pending file read.
The actual native Cancel click reported `isTrusted: true`, released that hold
after the click, and ended with the exact warning `Reconciliation cancelled. No
output was dispatched.` The result stayed hidden, controls were restored, and
File remained selected while Obsidian was disabled. Both baseline and terminal
Local REST resource counts were zero. Source hashes, lengths and creation-time
modification stamps remained unchanged; no File ZIP or Obsidian output was
dispatched. Reloading the page removed the transient hold.

This closes trusted native Cancel against an instrumented read boundary and the
invalid-extra-file refusal. Arbitrary uninstrumented timing and actual page
unload remain explicitly unclaimed.

## ChatGPT current-runtime diagnostic checkpoint

Branch `codex/chatgpt-current-runtime-drift` begins a diagnostic-only repair of
the current ChatGPT drift without widening capture authority. A-strict replay
previously reduced every unclaimed request-family mismatch to
`target-not-observed`. The candidate adds one fixed terminal code,
`target-not-observed-singular-path-seen`, after the existing deadline only when
the observer saw an input naming the exact current singular pathname and never
claimed an eligible plural source.

The new observation is one closure-private boolean. It reads no query contents,
headers, body, response, identifier, exception or request record; primitive
strings and the captured native Request URL getter are the only input forms.
It never claims, clones, terminates early, dispatches, retries or changes the
original page fetch. Dispatch/claimed timeout precedence, exact plural query
grammar, temporary-tab readiness, ordinary capture, probe/resolver routes and
all timers remain unchanged. Generic unrelated inputs still end as
`target-not-observed`.

Focused document-start/background/contract/plain-header/request verification
passes 5 files / 828 tests. TypeScript, targeted source lint, formatting and
diff checks pass. The regressions cover deadline-only publication, repeated
singular inputs, native Request and primitive-string privacy, singular followed
by eligible plural success and every timeout phase, unrelated/coercible/poisoned
inputs, exact result shapes and serialized-reader propagation.

A separate bounded live DOM inspection on one user-approved historical ChatGPT
conversation returned only aggregate shapes. It found five current
`div[data-turn-key]` roots; every root had exactly one user bubble, one assistant
role marker and one assistant Markdown block. The exact timeline scroller was
present under `main`, used ordinary `column` flow, had vertical range and held
all five roots. No text, attribute value, identifier, link, title, HTML, network,
storage or application global was read or retained. The earlier zero-turn DOM
symptom was not reproduced, so this candidate does not change selectors. An
installed exact-build A-strict run remains the next evidence gate; the new code
can narrow one no-claim case but cannot itself prove today's request family.

The first exact-build A-strict canary loaded the fresh content script and entered
`Syncing…`, but remained pending for more than five minutes. Replay's background
deadline is 190 seconds; after it had elapsed there was no open marker tab, Save
As dialog, G2O warning/error, Download capture, Markdown file, Obsidian capture,
or terminal UI status. Closing only the agent-created canary tab produced no
output delta. This is evidence of an unbounded outer runtime-message wait, not a
provider payload/image timeout or permission to retry capture.

The follow-up candidate wraps only the content-side replay message in a
205-second envelope, leaving 10 seconds beyond the background maximum. It
clears its timer on early resolve/reject, observes both late outcomes so neither
can become unhandled, and never retries, cancels the background request, writes,
or exposes private runtime diagnostics. A private WeakSet distinguishes only the
self-created timeout and maps it to fixed detail
`opaque-replay-runtime-message-timeout`; ordinary rejection retains
`opaque-replay-runtime-message-failed`. Focused bridge verification passes 19/
19 tests, including both capture paths, exact deadline, early cleanup, spoofed
timeout-shaped errors, and late resolve/reject. TypeScript, targeted lint,
formatting and diff checks pass. One installed rerun remains required.

That rerun exposed a more fundamental precondition failure before the new
content-side deadline could be exercised: Comet reported service-worker
registration status 15 with `document is not defined`. The emitted worker
closure had selected the browser conditional export of
`decode-named-character-reference`, whose module initializer eagerly calls
`document.createElement`. The candidate now aliases only that exact package to
its installed DOM-free table decoder; global Vite export conditions and all
capture routes remain unchanged.

A new post-build AST guard starts from the emitted manifest worker, traverses
its complete local static/re-export/literal-dynamic-import closure, fails closed
on missing, escaping, external or uninspectable dependencies, and rejects the
demonstrated eager DOM initializer while allowing deferred page-injection
callbacks. The old closure is rejected as `eager-dom-create-element`; the new
closure passes with 9 files / 297,795 bytes. Decoder parity covers all 2,125
installed entities plus invalid, prefix, case and multicodepoint cases. The
focused guard suite passes 30/30 tests and the complete suite passes 221 files /
7,321 tests. TypeScript and the guarded production build pass with 288
transformed modules; source/platform lint has zero errors and the same three
baseline warnings; formatting and diff checks pass. Independent review and
deterministic closure verification are clean.

The exact 40-file build was then installed byte-for-byte with a recoverable
rollback. Reloading only Liska made the worker registration link active, and a
fresh foreground historical-chat canary left `export in progress` in about 30
seconds instead of hanging. It produced a `structured-api`, complete graph /
messages / branches capture in both File and Obsidian: the two 27,573-byte
Markdown files are SHA-256 identical and name the same capture ID and manifest
hash. The immutable Obsidian archive contains the same-origin raw response,
manifest, canonical JSON, two fetched JPEGs and two fetched PNGs. Every fetched
raw/asset descriptor reconciles exactly by relative path, byte length and
SHA-256; two further asset references remain honestly `not-attempted`, so asset
completeness stays partial rather than being overstated. This closes worker
registration, runtime-message settlement and the foreground replay live gate.

## Snapshot analysis installed acceptance checkpoint

Branch `codex/snapshot-analysis-live-acceptance` starts from merged main without
a production-code delta. Current source inspection confirms that all-branches
HTML bootstrap/delivery is already implemented and live-verified; the roadmap
was stale rather than the feature incomplete. The exact next slice is therefore
the existing private snapshot-analysis page's installed acceptance, not another
HTML implementation.

Two immutable same-conversation candidates are prepared for that gate. Each
folder contains 7 files totaling 3,336,176 bytes and reports complete graph,
messages and branches with partial asset completeness. Their four fetched image
files are content-identical; raw response, manifest and canonical bytes differ,
so the pair exercises real snapshot comparison rather than duplicate folder
selection. No archive is modified.

The same two explicit folders have now passed the production analysis core as
an independent UI oracle. Both ordinals verify at 7 files / 3,336,176 bytes;
their inventory SHA-256 values are distinct. The 1,022-byte encoded
`liska-snapshot-analysis/1` report has SHA-256
`1dac3ca02d3e099a2e10dd167139be5cac9ac110dadf0942ff4082dc6f709dce`,
sets `analysisOnly: true` and `mutationAuthorized: false`, and emits no sparse
relation. It preserves ordinal 0 as first-observed and ordinal 1 as
latest-observed; both additionally retain unique-evidence, partial-capture and
external-references-unassessed reasons. The temporary local harness was removed;
only the content-free expected report remains under the task-specific
`CodexTools/cua/snapshot-analysis-live` evidence directory for exact comparison
with the later Save As bytes.

After the Windows 11 upgrade, native Computer Use opened the Liska popup and
private analysis page without a fallback, selected both exact folders through
the system directory picker and completed the installed analysis. The UI
reported verified byte consistency for both ordinals, no candidate relation and
the preserve-only result `Keep every snapshot`; source files were unchanged.

Save As initially reached the page's deliberate `unknown` state, so no retry
was made. The browser later published exact completion. Downloads contained
exactly one new `liska-snapshot-analysis.json`: 1,022 bytes with SHA-256
`1dac3ca02d3e099a2e10dd167139be5cac9ac110dadf0942ff4082dc6f709dce`,
byte-identical to the independent oracle. Schema, fixed booleans, both inventory
digests, preserve reasons and zero relations all match. Opening a third folder
picker and cancelling it preserved both selections and the rendered report.
This closes the installed Comet picker/analyze/Save As/late-terminal/cancel
gate. Other-browser portability and responsiveness near hard limits remain
separate evidence gates; no cleanup authority was added.

## Snapshot analysis near-limit acceptance checkpoint

Branch `codex/snapshot-analysis-near-limit` starts from merged main `ced61dc`
without a production-code delta. A deterministic local fixture contains sixteen
separately selected synthetic raw-only snapshot folders, 36 files and exactly
267,386,880 selected bytes (255 MiB). Three opaque pads are exactly 64 MiB and a
fourth is 66,042,992 bytes; every file stays within the unchanged 64 MiB limit.
The metadata-only inventory SHA-256 is
`8beba3889132f8fe8e50d2a0b6e4214d042dfefb42aecf10916eef433df31b48`.

The installed Comet picker accepted all sixteen folders in order. Its cards
matched every expected file count and byte total, disabled Add at the limit and
enabled Analyze. One uninstrumented Analyze showed the first completed file
within the initial roughly 245 ms refresh and reached the exact terminal status
`Analysis complete. No source files were changed.` by the next captured state
20.1 seconds after the click. It rendered all sixteen ordinal cards, each
honestly `Unverifiable` for this raw-only/opaque workload. Save was never
invoked.

A separate delayed Cancel attempt arrived after completion and is retained as
non-evidence. The accepted uninstrumented run was still in `Checking bytes,
provenance, and canonical replay…` when an actual native accessibility click was
accepted by the trusted-only Cancel handler. The refreshed page showed
`Analysis cancelled. No report was saved.` within 284 ms. After another 38.8
seconds the same cancelled status remained, the report was absent, Save stayed
disabled, Analyze was reenabled and Cancel was disabled; no stale completion
rendered.

Independent post-run verification found zero SHA-256 or byte-length mismatches
across all 36 selected files, no unexpected file and no source timestamp change
at inventory precision. No new snapshot-analysis JSON or partial appeared in
either top-level Downloads directory. The focused snapshot-analysis matrix
passes 8 files / 177 tests. This closes installed Comet responsiveness and
native Cancel for a near-aggregate-limit read/copy/hash workload. Parser-heavy
near-limit replay and supported-browser portability remain separate gates; no
limit or mutation authority changed.

## Snapshot analysis Chrome portability checkpoint

Branch `codex/snapshot-analysis-chrome-portability` starts from merged main
`f0df962` without a production-code delta. A user-operated ordinary Google
Chrome session opened the installed private `Compare local snapshots` page and
selected synthetic `snapshot-04` and `snapshot-05`. Both cards reported exactly
2 files / 1,081 bytes, and Analyze reached the exact terminal status `Analysis
complete. No source files were changed.`

The rendered report contained two ordinal-only `Unverifiable` cards with fixed
`writer-encoding-invalid`, unique-evidence, integrity-not-verified and external-
links-unassessed reasons. It reported no comparable candidate relationship and
the preserve-only conclusion `Keep every snapshot`. Save was not invoked.

Independent post-run verification matched all four selected file lengths,
SHA-256 values and timestamps at inventory precision, with no missing or
unexpected file. The shared fixture inventory still hashes to
`8beba3889132f8fe8e50d2a0b6e4214d042dfefb42aecf10916eef433df31b48`.
Neither checked top-level Downloads root contains a newer snapshot-analysis
report or partial; the only report predates this fixture. This closes the
private analysis page's installed portability gate in ordinary Google Chrome.
It does not generalize to other browser families or unrelated provider content-
script injection, and it adds no output or mutation authority.

## ChatGPT official-export manifest admission candidate checkpoint

Branch `codex/reconciliation-manifest-admission` starts from merged main
`d041b4c`. Four saved official `export_manifest.json` samples from April through
October 2026 independently confirm one stable provider v1 shape: root
`export_files`, `logical_files`, `manifest_file`, and `version`; exact
`manifest_file: export_manifest.json`; and logical `conversations.json` with
`files`, `shard_count`, and `sharded: true`. Every sample declares six unique
contiguous canonical shards `000…005`. Sizes range from 438,865 to 600,402
bytes; measured maxima are container depth 4, 16,385 JSON value nodes, 11,700
object keys, and 28,085 combined values plus keys.

The private reconciliation page now has one separate optional manifest picker
for sharded mode. Admission snapshots the selected File objects, checks exact
name/count and declared/observed 2 MiB bounds, then strictly rejects BOM,
malformed UTF-8/JSON, duplicate decoded keys, depth above 32, or more than
100,000 value nodes. Only provider version 1 and the exact logical conversation
entry are accepted. Declared and separately selected canonical shard basenames
must match as exact duplicate-free multisets before any web/shard read,
preparation, settings access, hashing, download, or Obsidian call.

The helper returns only a frozen numeric count receipt, which the page discards
before the unchanged importer/delivery path. Raw provider-manifest bytes,
unrelated inventory names/paths/values, filenames, hashes, native exceptions,
and manifest data never enter UI errors or durable output. Without a manifest,
the existing legacy and explicit-shard paths remain unchanged. A manifest is
invalid with legacy mode or inside the shard picker. Cancel or any source change
during its read prevents late bytes from authorizing newer selections. An
explicit Clear manifest control restores no-manifest/legacy mode without page
reload.

Focused helper/page/locale tests pass 3 files / 97 tests; importer and delivery
regressions pass 2 files / 128 tests. The complete suite passes 235 files: 8,079
tests passed and one existing test skipped (8,080 total). Coverage is 95.16%
statements, 91.76% branches, 98.60% functions and 97.59% lines; the new helper
has 98.11% statements, 95.74% branches and 100% functions/lines. TypeScript and
the 295-module production build pass, including the worker-runtime guards. Full
source/platform lint has zero errors and the same three baseline warnings;
Prettier and diff checks pass. Independent review found no material correctness,
security, privacy, or regression issue; its manifest-clear usability note is
resolved.

The reviewed build was then installed through the verified unpacked-extension
installer. Source and installed trees each contain 41 files / 1,159,305 bytes
with aggregate SHA-256
`5553912f93c9fc4ee6efe262f21f024a622ab7a9018518e302c9796f08a5c8a1`;
manifest SHA-256 is
`f8d2ccc7f3deb607819b58db920ac51c827f99c3564da035760810d847091c55`.
Rollback `liska-rollback-20261029T085930909Z-36500516b82046a89b2bcf624226171a`
retains the previous installed bytes. After one Liska reload and later Comet
restart, the private page exposed the manifest picker and disabled Clear control.

One user-operated installed positive canary selected the existing 11,651-byte
synthetic web canonical, six synthetic shards totaling 1,408 bytes, and a
600,402-byte byte-identical copy of the measured October provider manifest. The
page admitted all six declared names, completed normalization/preparation,
opened Save As, and produced bundle ID
`5c01de36cac432ac7413ab00898b2c8b567338455fec045688d445f060083b60`.
Save As was deliberately cancelled; the page honestly reported interrupted
download and `File ZIP not saved`. Obsidian remained disabled.

The same web/manifest pair with shard `005` omitted refused before Save As with
the fixed public status `Reconciliation failed. The selected source files were
not changed.` Clear manifest then emptied only that picker and disabled itself
without reload, while the web canonical, five-shard selection, File destination,
and disabled Obsidian destination remained intact.

Independent post-run verification found zero byte-length or SHA-256 mismatch
across all selected fixtures and manifest bytes; the six shards still total
1,408 bytes. Neither checked top-level Downloads root contains a new
reconciliation ZIP or partial, and the installed/source inventories remain
identical. Full timestamp preservation is not claimed because the copied
manifest lacked a separately recorded pre-run timestamp baseline. This closes
installed positive, missing-shard refusal and clear-control acceptance without
saving provider-manifest bytes or destination output.

## Tail-only Obsidian append images candidate checkpoint

Branch `codex/obsidian-append-images` starts from merged main `a5eb7b0`. Image
processing now begins only after ordinary append lookup and
`buildAppendContent` prove a real new message tail. Diagnostics-only,
equal-count, shorter-capture, no-op, historical-only, image-free, and image-
export-disabled paths preserve their existing behavior and perform zero binary
writes. Image-free tails return byte-for-byte before any placeholder rewrite.

Only exact active standalone placeholders outside code, HTML, links,
definitions and other protected Markdown can bind tail images. Missing,
duplicate, malformed or ambiguous referenced IDs, unsupported MIME,
noncanonical base64, and parser uncertainty fail with fixed content-free codes.
Unreferenced images and historical-prefix placeholders are ignored. The shared
resolver also stops a matching private placeholder inside protected Markdown
from becoming an active fresh File/Obsidian embed.

Exact decoded bytes receive full-SHA filenames under the resolved image root's
`liska-v1` namespace. Different IDs with identical bytes share one asset path;
note title, array index, provider ID/URL, message ordinal and capture order never
enter that identity. Image-bearing append alone requires stable Local REST API
5.5.0 or later. Existing identical bytes are reused; missing assets use
`If-None-Match: *`; create races and failed/unknown writes are accepted only
after exact bounded readback. Different bytes at an occupied path block the
note, with no numbered fallback or unconditional append-image PUT.

All tail transforms and final marker/context validation finish before binary
side effects. After every required asset is verified, Liska rereads the exact
base note, requires byte equality, writes the finalized full note, and reads it
back exactly. A failed note PUT reconciles only to the exact expected body.
This narrows but does not remove the existing external GET-to-PUT race; no CAS or
exactly-once claim is made. A later asset or pre-PUT note-check failure leaves
the note unchanged while verified content-addressed files may remain reusable
but unreferenced. After note PUT begins, failed or nonmatching readback leaves
the note outcome unknown and those assets may already be referenced. Retained
assets are not automatically deleted or claimed safe to delete.

The broad append/image/API matrix passes 9 files / 441 tests. The complete suite
passes 236 files: 8,123 tests passed and one existing test skipped (8,124 total).
Coverage is 95.16% statements, 91.75% branches, 98.61% functions and 97.58%
lines. TypeScript and the 296-module production build pass with worker-runtime
guards; full source/platform lint has zero errors and the same three baseline
warnings. Independent review found and closed one P2 image-free whitespace
regression; its remaining multi-asset evidence suggestion is covered by an
integration test where the first asset verifies, the second remains unknown,
and the note receives zero writes. Installed Obsidian creation/reuse/refusal and
filesystem readback remain before rollout.

## Tail-only Obsidian append images installed acceptance checkpoint

Branch `codex/obsidian-append-images-live-acceptance` starts from merged main
`0203aab`. The reviewed production build was installed through the verified
unpacked-extension installer: source and target each contain 41 files /
1,164,282 bytes with aggregate SHA-256
`1fb73d4a827bd7e6cfc3cd35a6f7809277e11a507f2d3f765ea104c646b5fb26`;
manifest SHA-256 is
`ab6f01a12cc90f5d8257b879f0454705bb4cb39ed4244674067b4e04a51db8ef`.
The live canaries used only an extension-owned synthetic tab and the production
`saveToOutputs` message boundary with Obsidian as the sole destination. The
synthetic pages received no provider conversation, API key or unrelated note
body. Production append lookup retained its configured scoped
filename-listing and candidate-read behavior; no zero-vault-read claim is made.

The production creation/reuse canary seeded one synthetic note, appended image
tail A, appended a later tail B with a different image ID but byte-identical
PNG data, and replayed B exactly. The terminal append counts were respectively
absent, `1`, `1`, and `0`. The final 718-byte note has SHA-256
`a73be3b0...ae4fb`, one boundary declaration, three message markers, one copy
of each synthetic token, two embeds of the same full-SHA asset name, zero
unresolved `g2o-image://` placeholders and `message_count: 3`. Only one physical
67-byte PNG exists; its SHA-256 is `eaa4a94e...80865`. Its first and final mtime
are both `2026-10-29T23:06:37.3893359Z`, with zero observed transitions during
the later-ID reuse and exact replay. Append mode began false, was changed only
for the bounded canary, and was verified false again with all other safe routing
fields unchanged.

The changed-base case used a separately hashed 68-byte PNG
(`0b1e9872...ca726`) and a transient exact-ID scheduling gate placed only after
asset persistence returned and before the unchanged production base-note reread.
The gate reached only after the asset was exactly readable. During its 15-second
window, one external marker was added to the synthetic base note; the note hash
became `79b720e5...bf767`. On release, the existing production path returned the
fixed `append-note-changed-before-write` code with one request and zero retries.
The note retained that exact external hash and marker, one historical message,
and zero proposed-tail tokens; the verified content-addressed PNG remains as the
expected unreferenced reusable asset. This is scheduling-only instrumented
evidence for the real refusal logic, not a new CAS or atomicity claim.

The temporary gate and live-page code were removed from active source and the
installed package. A clean production rebuild
again produced the exact 41-file / 1,164,282-byte aggregate above and was
reinstalled byte-for-byte; rollback
`liska-rollback-20261029T232209274Z-f3eafe7974e142219b4bfc0f1ab95d90`
retains the instrumented target. Comet was restarted and restored its session.
The installed target now matches source on every relative path, length and
SHA-256 with zero temporary canary/reload files. This closes installed
creation, same-byte reuse, exact replay, changed-base refusal, setting restore
and filesystem readback for ADR-045.

## ChatGPT Library text/plain candidate checkpoint

Branch `codex/chatgpt-library-text-plain`, based on main `2de34c0e`, implements
one separately evidence-gated `text/plain` Library family. The supplied offline
capture has two structurally eligible assets. Lexicographic opaque-ID policy
selects the 4,233-byte metadata candidate and leaves the 21,231-byte candidate
`not-attempted`; neither size is claimed as newly fetched evidence. No live
archive or conversation text was read during implementation.

The planner retains exact direct attachment identity, whole-ledger collision
checks and interpreter/owner precedence. Raw must first reach a durable
destination; committed raw is replanned again immediately before the sole
ID-bearing command. Order is interpreter acquisition, Library CSV, Library
JPEG, Library text/plain, then ordinary images. Existing CSV/JPEG priority is
preserved; TXT consumes at most one of the existing four active slots and
shares the unchanged 20-attempt/128 MiB budget. A failed/unknown attempt stays
family-owned with no retry, fallback or second text selection.

Exact ledger `text/plain` must match the response MIME essence. Bytes are
opaque and retained under `assets/<sha256>.txt`; there is no decoding, encoding
guarantee, newline normalization, transcoding or inline preview. Existing HTML
binding renders a download only. File and Obsidian fetched claims remain
independent. The optional 0/1 `libraryTextPlainAttemptCount` extends only the
closed `asset-batch-4` aggregate audit; older audit shapes and warning text
remain unchanged, and TXT never counts as ordinary images. Library IDs and
signed transport remain raw-only/transient; the unchanged canonical ordinary
attachment source IDs are not new durable resolver evidence.

Focused verification passes 8 files / 612 tests; TypeScript, source/platform
lint (zero errors, the same three baseline warnings) and the guarded production
build (288 modules) pass. The full suite passes 224 files / 7,525 tests, with one
Windows-only case-sensitivity test skipped. Independent code review and a
separate 392-test verification pass found no material issue.

The exact committed candidate `631c031` was installed by the verified unpacked
installer: source and installed inventories both contain 40 files / 1,108,764
bytes with aggregate SHA-256 `2ff981c3...20b5`; rollback
`liska-rollback-20261028T142008932Z-daa0b347fc63496c816f09a99e1494c8`
retains the previous bytes. Comet reloaded only Liska, and the Local REST API
connection check succeeded before the canary.

One trusted click then created capture
`capture-chatgpt-cd922308-c0e2-4b23-a092-b68e44e8bf49` in File and Obsidian.
The 12 shared capture paths are byte-identical. File additionally has only the
expected 1,937,991-byte canonical HTML and its hash-bound receipt. Both
destinations contain the same fetched 4,233-byte text/plain asset at
`assets/1a1fcf5d...76.txt`; its physical bytes, filename digest, manifest and
canonical path/length/SHA-256 agree. The second text/plain record remains
`not-attempted` with no local evidence. Raw is 9,825,646 bytes and matches its
manifest SHA-256; both byte-identical manifests have SHA-256
`8144e7df...5513`, which canonical also binds.

The closed audit records `selected=4/4`, `completed=4`, `observed=4`, one
Library text/plain, one Library JPEG, zero Library CSV and two ordinary-image
attempts. File and Obsidian notes both report 875 messages, complete structured
capture, the same manifest digest and the same local TXT link. Their byte sizes
differ because of destination formatting; both have 34,610 lines and become
line-for-line equal after removing Markdown structural prefixes. The selected
Library ID has zero exact matches in the inspected non-raw artifacts. No
URL-valued field was structurally tied to that record, so this canary makes no
exact-value URL-absence claim. The selected ordinary direct attachment `id`
has 10 matches across two non-raw artifact classes; current normalizer code
intentionally retains such IDs as pre-existing source provenance, not as a new
resolver field. A focused regression now proves acquisition leaves those
source refs unchanged while resolver warnings/receipts contain neither that
direct ID nor the Library ID sentinel.

This closes the one-item Library text/plain live gate without claiming general
Library text, decoding, encoding validation, inline preview or owner-context
binaries. An initially suspected compact-launcher clipping issue was not
reproduced: the first native coordinate action had missed the launcher, and the
below-viewport accessibility point belonged to a hidden action. No UI defect is
claimed from that observation.

## ChatGPT Library CSV candidate checkpoint

Branch `codex/chatgpt-library-csv` adds one evidence-gated passive CSV family
without broadening the existing resolver route. Two retained CSV records from a
real standard-owner capture were rechecked against committed raw. Both are
unambiguous Library-associated metadata attachments with one valid direct file
ID, no pointer/sandbox or interpreter ownership, no whole-ledger collision, and
independent admission under every existing Library JPEG invariant when only the
MIME predicate is substituted. No provider ID, Library ID, filename, URL or
source content entered the evidence receipt.

The candidate admits exact `text/csv` only and deterministically attempts one
record before Library JPEG and ordinary images. It consumes one of the existing
four active file-ID slots and the unchanged shared attempt/128 MiB byte budget.
Authority begins before dispatch; every helper, binding, HTTP, MIME, URL,
oversize or persistence failure remains family-owned and cannot fall through to
passive retry. The second CSV stays `not-attempted`. Exact bytes are neither
decoded, parsed, formula-sanitized, transcoded nor rendered; existing
metadata/response MIME agreement, bounded reading, content-addressed staging
and destination receipts remain the persistence boundary.

Historical image-only audits retain their exact `image-batch-4` shape. A CSV
run uses closed aggregate `asset-batch-4` evidence with separate 0/1 Library
CSV and JPEG counts and no representable provider values. Strict replay alone
wires the new resolver; background endpoint, permissions, message payload,
signed-URL grammar, binary contract, canonical schema and HTML presentation are
unchanged.

Focused verification passes 8 files / 475 tests; the complete suite passes 222
files / 7,405 tests. TypeScript and the guarded production build pass with 288
transformed modules; source/platform lint has zero errors and the same three
baseline warnings; formatting and diff checks pass. Independent review and
deterministic verification are clean. The exact build is not yet installed:
one live CSV acquisition plus File/Obsidian manifest/canonical/path/length/hash
reconciliation remains the enablement gate.

The committed 40-file candidate was installed by the verified unpacked-
extension installer. Its 1,107,773-byte source and installed aggregate SHA-256
both equal `526d7564...ce34`; the prior `dist` remains under immutable rollback
`liska-rollback-20261026T140354514Z-c224acc9984d4f87a857455599385f2b`.
Native CUA then reloaded only Liska on `comet://extensions`; the browser stayed
open, the reload toast appeared and the worker registered.

A fresh foreground capture of the evidence chat completed in about one minute.
It retained a complete graph/messages/branches archive with partial assets and
fetched the deterministic first Library CSV: 14,717 bytes at
`assets/5435b777...c7ee6f.csv`, with filename, physical hash, manifest and
canonical path/length/SHA-256 all equal. Its exact raw size fact is also 14,717.
The second 751-byte CSV remains `not-attempted`. The closed audit records four
observed dispatches: one Library CSV, one Library JPEG and two ordinary JPEGs.

Downloads and Obsidian contain seven byte-identical shared archive artifacts;
File adds only the expected canonical HTML and its receipt. Their 325,397-byte
Markdown notes are SHA-256 identical, carry the same manifest digest and link
the local CSV. Two exact Library ID values were checked across manifest,
canonical, both Markdown notes, HTML and receipt with zero matches; transient
signed transport remains unrepresented. Direct attachment `id` values remain
only as pre-existing canonical source metadata, not request credentials. This
closes the one-CSV live gate without claiming general Library text support.

## Verified unpacked-extension installer checkpoint

Branch `codex/extension-installer` adds one explicit PowerShell 7 deployment
path for an already loaded unpacked Liska copy. It never discovers or loads an
extension. The caller names absolute source, target and rollback roots; the
script validates Liska manifest identity and exact worker/popup file entries,
rejects reparse/case/overlap/volume ambiguity, stages beside the target, verifies
the complete inventory by relative path/length/SHA-256, moves the old target to
a unique rollback, promotes the stage and verifies the installed bytes again.
Existing rollbacks are never removed.

Failures before promotion leave the installed target untouched. An injected
second-move failure restores and re-verifies the old bytes. Any recursive stage
cleanup first proves an exact generated child name, parent containment and the
absence of reparse descendants. One independent review found that the initial
manifest preflight treated entry-shaped directories as worker/popup files; the
inventory now maintains a separate file-only set, and executable regressions
reject both directory cases before target mutation.

`PlanOnly` builds nothing, writes nothing and touches no process. A normal
successful install reports `reloadRequired: true` so only Liska needs a browser
extensions-page reload. Full Comet restart is an explicit off-by-default
fallback: graceful exact-executable close first, optional separately requested
force only after timeout, same executable relaunched visibly with session
restore, and a new exact-path main window required. Restart failure retains the
verified install and rollback.

The executable installer suite passes 21 tests with one Windows-only
case-sensitive-filesystem skip; the complete suite passes 222 files / 7,340
tests. TypeScript, the guarded 288-module production build, source/platform
lint, formatting and diff checks pass. A real no-write PlanOnly against the
current CSV candidate and installed Liska reports 40 source files / 1,107,773
bytes, matches an independent aggregate digest, emits no absolute paths and
leaves source, target and all rollback bytes/timestamps unchanged. Actual live
installation then deployed that exact CSV build: the receipt reported 40 files /
1,107,773 bytes, identical source/installed aggregate SHA-256
`526d7564...ce34`, manifest SHA-256 `283ceffd...5e1d`, one new rollback and
`reloadRequired: true`. Native CUA reloaded only Liska on
`comet://extensions`; the `Перезапущено` toast appeared and the service worker
registered while Comet and its conversation tabs remained open. The ordinary
install/reload gate is closed. Full `-RestartComet` remains executable-test-
verified but deliberately unexercised against the user's live session; it is an
optional fallback, not the normal update path.

## ChatGPT staged opaque-replay core candidate checkpoint

Branch `codex/chatgpt-staged-opaque-replay-core` starts from merged main
`6932ee3`. Existing production callers still omit the new internal transport
selector and therefore retain the exact legacy opaque-replay marker, whole-
base64 inline response and 16 MiB limit. Ordinary export, the service-worker
message action, content adaptation and extractor routing are unchanged in this
slice. A real provider response above 16 MiB is still not claimed.

The internal/test-selectable `staged-v2` mode adds an exact versioned replay
capture shape for responses above 16 MiB through the existing 64 MiB ceiling.
MAIN retains completed response bytes behind one nonce-scoped reader and exposes
only transport version, byte length, SHA-256, JSON media type and the exact
512 KiB chunk count. It releases Request/credential state at network completion;
page metadata contains no stage ID, OPFS/archive path, request/header value,
credential or whole `bodyBase64`. Exact 16 MiB remains valid v1 inline traffic.

Background remains the sole stage authority. It pins the temporary tab's exact
top-frame document and route, pulls one independently canonical chunk at a time,
creates the random raw stage, appends/seals it through the existing offscreen
store, revalidates conversation identity, dispatch count, staged metadata,
document identity and final route, then returns only the sealed extension-owned
descriptor. Same-URL document replacement during seal fails closed. Chunk,
document, route, append, seal and timeout failures release the page reader and
abort only extension-allocated IDs; staging never falls back to a larger inline
message.

The archive-stage wrapper now reports allocation before offscreen acknowledgement
and performs an additional exact-ID abort after late fulfilled or rejected
begin/append/seal settlements. This closes the case where an offscreen write or
metadata seal finishes after the caller's timeout and after its first abort.
Unknown, mixed, accessor-backed, non-finite, prototype-polluted and out-of-range
transport shapes are rejected before iteration or storage work. Staged replay
artifacts are accepted only for `16 MiB < byteLength <= 64 MiB`.

Independent review found and closed four material lifecycle gaps: missing staged
conversation binding, an accessor/`Infinity` count-loop hang, same-route document
replacement after seal, and late rejected offscreen settlements without a second
cleanup. Focused verification passes 4 files / 425 tests; the main agent's wider
10-file replay/stage matrix passes 569 tests. TypeScript, the guarded production
build, formatting and diff checks pass; full lint has zero errors and 16 warnings,
13 of them from the deliberately linear new trust-boundary validators/lifecycles.
The complete coverage suite passes 236 files: 8,151 tests passed and one existing
test skipped (8,152 total). Coverage remains at the repository gates: 95.01%
statements, 91.63% branches, 98.47% functions and 97.45% lines. The real unpadded
provider gate remains open: the largest retained real raw inspected locally is
13,117,554 bytes, while larger retained files are canonical derivatives rather
than raw ingress evidence.

## ChatGPT staged opaque-replay integration candidate checkpoint

Branch `codex/chatgpt-staged-opaque-replay-integration` starts from merged main
`37d23d3`. The existing `captureChatGptConversationViaOpaqueReplay` action and
sender-derived target remain unchanged, but its service-worker handler now
selects the reviewed `staged-v2` core. The core default remains legacy inline for
every caller that omits the internal selector. MAIN still emits the established
inline capture shape at and below 16 MiB; only a larger replay response may cross
as the versioned staged metadata and extension-owned raw descriptor.

Content no longer spreads replay artifacts into the ordinary capture contract.
It allowlists the exact inline or staged fields and strips replay-only `kind`,
`relativePath`, transport-version/chunk metadata and staged `bodyBase64` before
the existing capture validator. Ownership transfers only when the existing
pipeline actually invokes its injected `requestCapture` callback. Adaptation or
pre-transfer failure exact-aborts a validated staged result, while downstream
normalization/projection errors retain any loss-aware raw companion and are not
blanket-cleaned by the wrapper.

The runtime-message timeout now claims terminal state before rejection. A late
strict staged success is never delivered to either pipeline or retried; it gets
one bounded exact-stage cleanup whose throw, rejection or non-settlement cannot
replace the fixed timeout outcome. The service worker similarly keeps ownership
until both the replay envelope and route family are accepted. Wrong-family or
malformed outer results clean only a fully validated staged artifact; an
untrusted naked stage ID never grants cleanup authority. Both content and worker
cleanup waits are capped at 500 ms, with bounded stale pruning remaining the
fallback if a context disappears.

A fresh installed forced-replay smoke on an ordinary real ChatGPT conversation
closed the sub-16 MiB compatibility gate. File and Obsidian each retained the
same three companions: 2,684,770-byte raw SHA-256 `5e8a8244...638812`,
1,884-byte manifest SHA-256 `4d8ce024...1629ed`, and 4,435,132-byte canonical
SHA-256 `17a0a108...558aa`. The manifest raw record matches the physical raw
length/hash exactly; graph, messages and branches are complete; two assets remain
honestly `not-attempted`, with zero manifest warnings or unknown content types. All three
files are byte-identical across destinations and no temporary marker tab remained.
The bounded smoke disabled images, tools, HTML, append and auto-scroll, then
restored every original non-secret setting exactly.

The verified installer deployed 41 files / 1,176,303 bytes with identical source
and installed aggregate SHA-256
`01f9d448c1f554f87982c6c07c526c70ac30a119fe1fdcb20a2ac5dc7ea6c5d1`;
manifest SHA-256 is
`e36d99f6c75ba1a5fa37da7c22f210764750ad0c375cfd76d8fb5a86d9de08f2`.
Comet restarted on that package and the installed tree now matches source on
every relative path, length and SHA-256 with no smoke helper residue.

Focused/adjacent verification passes 6 files / 555 tests; the complete coverage
suite passes 236 files with 8,204 tests passed and one existing skip (8,205
total). Coverage is 95.03% statements, 91.65% branches, 98.48% functions and
97.47% lines. TypeScript, the 296-module guarded production build, full lint,
platform checks, formatting and diff checks pass; independent review found no
material defect. This proves activated replay preserves a real sub-16 MiB inline
capture and both destinations. It does not prove an unpadded real response above
16 MiB, live staged worker recovery, or browser fitness near the 64 MiB bound.

## ChatGPT project WebP archive-only checkpoint

One accessible project-scoped conversation from the official-export WebP
reconnaissance was captured through the installed trusted-click path.
Downloads and Obsidian retained byte-identical 900,531-byte raw, 81,866-byte
manifest and 1,916,044-byte canonical companions. The raw record matches its
physical length/SHA-256, canonical binds the exact manifest hash, and File adds
only its expected canonical HTML view and receipt.

The capture contains 159 asset records. Exactly one is `image/webp`; its sole
manifest source pointer resolves to the exact raw metadata object with a direct
ID and declared MIME, size, dimensions and source. It has no Library, artifact,
file-service, sediment or interpreter marker. Manifest and canonical reconcile
the same opaque ledger identity. The canonical declared byte length remains raw
provider metadata, not an acquired-byte claim.

The content-free route classified as `project`, and the production owner policy
denied optional acquisition with `nonstandard-route`. All 159 assets therefore
remain `not-attempted`; the WebP has no attempt timestamp, local path, acquired
hash or binary file. The fixed owner-context warning appears exactly once,
asset completeness is `not-attempted`, and durable manifest/canonical data
contains no project route or owner alias. No temporary marker tab remained.

This closes the planned live gate for exact raw-pointer resolution, owner
classification and honest project-WebP omission. It does not authorize project
binary acquisition, prove an ordinary-chat WebP resolver, provide original
WebP bytes, or justify a WebP byte validator. GIF/WebP active widening remains
evidence-gated.

## Snapshot parser-heavy acceptance checkpoint

Branch `codex/snapshot-parser-heavy-acceptance` adds only an opt-in synthetic
acceptance suite, its deterministic fixture builder and a reproducible evidence
note. Production source, dependencies, browser permissions and every analysis
limit remain unchanged. The default focused invocation constructs no heavy
fixture and reports two skipped tests.

The accepted operation uses two complete replayable ChatGPT snapshot inventories.
Each has a two-node graph, 240 ordinary text blocks and exactly three JSON files:
825-byte manifest, 7,865,403-byte raw and 7,989,984-byte canonical archive. The
production strict parser measures 31,553,758 of 33,554,432 allowed string code
units across the pair, or 94.04%. Both snapshots verify through the current
normalizer and yield exactly one `same-raw-different-evidence` relation with
`preserveBoth: true`. The deterministic report is 1,102 bytes; repeated analysis
is byte-identical, and reversed selection retains equivalent facts after
normalizing its intentional ordinals.

A separate three-snapshot operation keeps every unrelated pre-report enforced
ceiling at or below 50% but reaches 47,330,637 string code units, or 141.06% of
the one shared default. Each heavy inventory verifies when paired with a tiny
valid control. Together they fail with the fixed sanitized `limit-exceeded`
error and return no partial plan. This proves the production budget accumulates
across the complete selection instead of resetting per snapshot; no relation or
report metric is claimed for the refused operation.

Lengths and SHA-256 values for every supplied file match after success, repeat,
reversal and refusal. Reports contain no synthetic payload, source identity,
input path or working-directory value and retain `analysisOnly: true`,
`mutationAuthorized: false` and preserve-only relations. Repeated opt-in runs
complete in about 6.9-7.1 seconds on the recorded local environment. The
existing snapshot core/strict-JSON/page matrix passes 174 tests; repository and
new-test TypeScript checks, scoped formatting and diff checks pass.

This closes actual-scale parser replay and aggregate-ceiling evidence in the
Node core. It does not establish installed-Comet responsiveness, peak-memory
bounds, immediate cancellation of synchronous parsing, or any deduplication,
merge, deletion or mutation authority. The exact workload, commands and
content-free metrics are recorded in
`docs/snapshot-parser-heavy-acceptance.md`.

## Snapshot parser-heavy installed acceptance checkpoint

The exact accepted pair above was written to two temporary synthetic folders
and selected separately through the installed Comet snapshot-analysis page.
Each card reported 3 files / 15,856,212 bytes. One trusted, uninstrumented
Analyze completed, and the terminal `Analysis complete. No source files were
changed.` state was first observed about 11.9 seconds after the click. Both
snapshots rendered `Verified byte consistency`, and the sole candidate
relationship was `Same raw bytes, different evidence. Keep both.`

Save was not invoked, and no snapshot-analysis report with mtime at or after the
pre-run receipt appeared in either checked top-level Downloads root; one older
report predates this run. Post-run checks matched all six source lengths,
SHA-256 values and exact `mtimeMs` values to the receipt. Both selected folders
still contained exactly their original three files. The agent-created analysis
tab was exact-closed afterward.

This closes installed-Comet parser-heavy responsiveness for the measured pair
at 94.04% of the shared JSON-string ceiling. The elapsed observation includes UI
scheduling and is not a performance guarantee. It does not establish peak
memory, immediate cancellation of synchronous parsing, browser behavior for the
refusing triple, other browser families or any mutation authority.

## Official export ZIP source-core checkpoint

Branch `codex/reconciliation-export-zip-core` adds a core-only adapter for one
explicitly selected official ChatGPT export ZIP. It accepts an anonymous
immutable range source and returns the same `officialChunks` or sorted numeric
`officialSources` interface already consumed by the existing official importer.
There is no filesystem extraction, directory search, network request, settings
read, destination writer, archive-schema change or new dependency. The current
unpacked JSON/shard UI and reader are unchanged.

The ZIP profile is deliberately narrow and evidence-backed: single-volume
ZIP32 from byte zero, zero archive comment, exact central/local partition,
STORE or raw DEFLATE, safe root names, bounded metadata, optional exact ZIP32
descriptors, no encryption, ZIP64, prefix/trailing bytes, symlinks or special
files. A present root manifest must pass the existing bounded v1 parser and
exact shard-name-set comparison. Older sharded exports without a manifest are
accepted only as `absent-unverified`; manifest absence never becomes a
completeness claim.

Five real official ZIP central directories were inspected without reading
conversation bodies. They span 1.05–1.81 GB (0.98–1.69 GiB) and 1,048–2,343
entries, use DEFLATE only, and contain no descriptors, encryption, directories,
duplicate or unsafe names, symlinks, comments or ZIP64. Four contain six root
shards plus a manifest; the oldest contains five root shards without one.
Selected JSON plus manifest totals expand to 477.7–605.7 MB (455.6–577.6 MiB),
with a largest selected entry of 202.1 MB (192.8 MiB), inside the unchanged 2 GiB
importer boundary.

The maintained unpacked archive was also inventoried without reading message
content. Its nine ChatGPT sets comprise four legacy single-file exports, one
five-shard manifest-absent export and four six-shard manifest-backed exports;
all conversation sources are at the set root. This keeps unpacked archives as
the primary operational path. ZIP support is only an additive way to feed the
same reader before extraction.

Every central entry and local header is reconciled before any source is
returned. Unrelated payloads are not read, decompressed or hashed. Selected
streams are single-use and ordinal: each prior conversation source must reach
verified compressed EOF, expanded length and CRC before the next can start.
Early return, out-of-order or concurrent consumption poisons the selection;
later corruption/cancellation prevents delivery and hashing even after an
earlier target match. Output chunks are owned copies, including for typed-array
subclasses with aliasing `slice` implementations.

Independent fixtures cover legacy, modern manifest-backed and older
manifest-absent layouts; STORE/DEFLATE; both descriptors; malformed structure,
paths, extras, flags, methods and limits; trailing/truncated streams; ratio,
CRC, cancellation, producer cleanup, privacy and full normalized/raw-only
delivery parity. The final focused/adjacent matrix passes 9 files / 453 tests.
TypeScript, zero-warning scoped ESLint, formatting, diff checks and the guarded
296-module production build pass. Independent review found and closed two P2
contract defects (pre-start source skipping and Buffer-slice aliasing), then
reported no remaining material issue. A completed security diff scan covering
metadata, decompression, cancellation/privacy and delivery composition found no
plausible security candidate.

This does not yet enable a ZIP picker or claim installed-browser compatibility,
File immutability, whole-browser memory bounds or real conversation import from
a private ZIP. Those are separate UI and live-acceptance gates recorded in
ADR-046.

## Claude current transcript and isolated Artifact checkpoint

Branch `codex/claude-current-compat` starts from merged main `36a03ab` and
separates a destination-startup symptom from a provider loss. After the machine
restart, the first ordinary Claude attempt stopped because the configured
Obsidian destination was not running. Starting the existing local app and
repeating the same trusted export produced a 2,769-byte two-message Markdown
file in both Downloads and the configured vault; the copies have identical
SHA-256 and contain exactly one user and one assistant record.

A second authenticated canary used a 22-message chat with one visible document
Artifact. The installed extractor recognized the current user/assistant roles,
selected the semantic transcript scroller, and logged 22 accumulated turns
after 36 upward-scroll iterations. Downloads and Obsidian each received the
same 32,712-byte Markdown note with 11 user and 11 assistant records. No Claude
message was sent and neither the chat nor document was edited.

The transcript success also exposed a real omission. Current Claude renders the
open document panel as one visible top-document `/code/artifact/` iframe whose
same-origin wrapper contains an isolated provider frame and nested document.
The historical `#markdown-artifact` selectors matched zero nodes. Several
document-only headings had zero matches in the saved transcript, so the 22
message note does not preserve the visible Artifact body.

The candidate fixes the misleading silence without expanding authority. It
detects only the recognized visible top-document frame, leaves ordinary and
legacy-report extraction unchanged, and merges the stable
`claude-artifact-content-omitted` code into the existing durable loss-diagnostic
frontmatter while showing one fixed content-free warning. Inert, hidden,
dismissed, non-frame, or differently shaped candidates do not warn and never
become a no-Artifact claim. No frame document is read; there is no new host
permission, fetch, click, output destination, raw archive, or companion file.

The exact 41-file / 1,177,399-byte candidate was installed through the verified
rollback installer after the extension details page identified the actual loaded
unpacked directory. Comet then loaded content bundle `index.ts-dWYE_ODt.js`.
One trusted live export retained all 22 messages, showed the fixed content-free
warning, and wrote schema 1 plus `claude-artifact-content-omitted` to both
destinations. The 32,805-byte Download and Obsidian notes are SHA-256 identical;
the diagnostic contains no Artifact title or provider origin. One earlier
post-reload click reached only an invalidated old extension context and wrote
nothing; two subsequent trial exports used the still-loaded old bundle before
the extension details page corrected the target directory. They remain ordinary
append-only snapshots and do not support candidate claims.

The exact final suite passes 237 files / 8,391 tests with one file / three tests
skipped. The guarded production build transforms 296 modules. Repository lint
passes with zero errors and 16 pre-existing warnings outside this Claude slice;
formatting, diff checks and the idea-thread validator pass. Independent review
found and closed start-of-export timing and bounded CSS-visibility edge cases,
then reported no remaining material issue. The permission-gated companion design
is retained separately in repository-safe idea thread ITH-001: it requires
synthetic edit/version freshness proof, packaged-browser permission and replay
tests, bounded inert parsing, and honest per-destination receipts before
enablement.

## Claude virtual-history completeness and root-remount checkpoint

The earlier two- and 22-message canaries did not cover Claude's long-history
loader. A local official export establishes one repository-private canary with
154 messages: 77 user and 77 assistant. The previously installed Liska build
saved only 52 messages yet classified that DOM pass as complete. Earlier repair
attempts retained 51, 6, 55 and 56 messages as honest `partial` snapshots; they
remain append-only diagnostic evidence rather than failed files to overwrite.

Content-free live observations established the missing identity model. Claude
loads catalog maxima 31, 63, 95, 127 and 153. Every prepend renumbers the same
message rows, while the exact user-root UUID suffix, assistant
`UUID-hub-reply` key and newest assistant tail remain stable. Mutable
`data-index` is therefore order evidence only. The candidate keys by exact
role-namespaced UUID, orders by `index - currentCatalogMax`, pins the newest
tail, and retains bidirectional key/order proof across remounts. Completion
requires exactly `M + 1` keys occupying every relative order from `-M` through
zero. Missing, ambiguous, duplicate or conflicting identities, tail change,
catalog shrink, skipped windows, unsupported renderability or a fallback key
remain sticky `partial` evidence.

Claude keeps its provider-specific 20%-viewport / 64px / 100ms traversal and a
five-second visible, geometry-stable top settle. A small static
`document_start` MAIN-world listener performs only one page-owned relative
`scrollBy` request on the already selected semantic root; it has no extension,
storage, extraction or network authority. The isolated-world caller allows at
most two attempts per root because the first live request disabled Claude's
sticky behavior without moving. Four bounded root replacements therefore cap
the operation at ten requests. Same-chat remounts preserve accumulated
messages, exact-empty evidence and the bounded 16 MiB exact-input tool cache;
cross-chat navigation fails the whole export before any destination write.

The content-free pending-history button also proved directional. On a cold page
it precedes the first mounted row and means older history may remain. After the
full catalog is known, the same shape can sit between rows and represent only a
later-history virtualization gap. Only the former blocks completion. If the
older marker disappears without immediate catalog growth, Liska requires five
seconds of continuous absence before the ordinary five-second top settle may
complete; reappearance resets that grace. This covers Claude's measured
roughly-three-second hide/prepend/show transitions without treating the final
page as a permanently unresolved generation.

The exact final 43-file / 1,191,747-byte build was installed through the
verified rollback installer with identical source and installed aggregate
SHA-256 `800ec3e06ffe3813807e5dc17c9d20d3b37597a77c07c7068bc1428bbeedf5a5`.
From a fresh 26-of-32 mounted page, one ordinary **Bring thread home** gesture,
with no manual loader click or CDP scroll prime, traversed the full catalog and
wrote one 134,052-byte Markdown note. It contains 154 boundary markers, exactly
77 `User` and 77 `Claude` role records, the inert empty assistant boundary at
ordinal 152, `message_count: 154`, and no `history-load-partial`. The one
configured Obsidian
vault contains exactly one same-length candidate with the identical SHA-256
`8448c94b2dbd39866794dde3b3dcd88a297cd17e66964fe1eb67eabebd51d783`.
No Claude message was sent and neither the chat nor its attachments were edited.

Focused checks cover the exact 31→63→95→127→153 prepend sequence, stable UUID
and tail proof, skipped windows, append/shrink conflicts, remounts, exact empty
assistant state, cache invalidation, marker direction, 4,999ms grace rejection,
grace reset and full grace-plus-top-settle extraction. TypeScript, formatting,
diff checks and the guarded production build pass. The exact final Claude
matrix passes 168/168 tests in 842.38 seconds. The last repository-wide run on
the same shared manager passed all 239 unchanged files and isolated one Claude
ordering regression; after that exact correction, the full Claude file passes.
Combined current-input evidence covers 240 passing files / 8,651 passing tests
with one file / three tests skipped; current-head CI remains the independent
single-run gate.

Rendered Claude attachment previews and isolated Artifact companions remain
separate later slices. This checkpoint proves the bounded transcript traversal
and destination equality only; it does not claim Artifact-body capture,
attachment-binary completeness, atomicity against a concurrently edited chat,
or official-export reconciliation as an automatic product feature.

## Claude exact-detail structured capture checkpoint

Claude ordinary chats now have a structured-first capture path that does not
scroll or depend on mounted virtual rows. Authenticated read-only observation
identified one exact page-owned request:
`GET /api/organizations/{organizationId}/chat_conversations/{conversationId}`.
The organization UUID is used only as a same-origin routing hint from an exact
already-observed resource, the exact named page hint, or the current-route
verification link. Liska does not read cookies, request-header values, browser
tokens or arbitrary storage and does not retain the organization UUID in the
manifest or canonical archive. The response UUID must match the current route.

Local Claude evidence was kept source-separated. Two classic official-export
batch directories and one richer reader package contain three conversation
arrays: 15 snapshot records, 11 distinct conversations and 326 distinct
messages. Every observed chain is linear with maximum fan-out one, one omitted
root parent and no current-leaf field, so official exports do not prove whether
alternate branches were absent or pruned. Their message content arrays retain
thinking, tool-use, tool-result, image and document families which the measured
web detail response may omit. The web manifest therefore records graph,
messages and branches as `unknown`, assets as `not-attempted`, and the readable
view as `structured-api / partial` rather than borrowing completeness from the
154-message scrolling canary.

The provider normalizer verifies exact raw and manifest hashes, exact route
identity, unique bounded message IDs, deterministic parent/child order, cycles,
current-leaf reachability and one explicitly diagnosed unresolved root parent.
It retains ordered text/reasoning/tool/citation/attachment/unknown blocks with
JSON-pointer provenance, creates metadata-only asset records without fetching
binaries, bounds large inputs and redacts credential and identity aliases from
canonical extensions. A direct-text-only message receives a stable diagnostic
without asserting that hidden richer content existed. Legacy visible Deep
Research remains ahead of structured capture; every request, schema, integrity,
normalization or projection failure returns to the established partial DOM
path. Verified raw+manifest survive post-identity failures, while same-document
navigation cancels the whole operation and releases staged evidence instead of
mixing conversations.

Background archive authority now admits Claude only from an exact lowercase
UUID `/chat/{id}` top-frame tab with an HTTPS same-origin injection document.
Derived HTML remains ChatGPT/DeepSeek-only. After navigation away from the chat,
only aborting an already owned Claude stage is permitted; begin, append, seal,
read and commit remain exact-chat-bound. Raw inline transport keeps the 16 MiB
boundary, canonical/manifest keep 32 MiB and larger eligible artifacts reuse the
existing bounded stage contract.

The exact candidate was built and installed through the rollback-preserving
unpacked-extension installer: 43 files / 1,220,701 bytes, identical source and
installed aggregate SHA-256
`e64ba277090c23e436bf3d349c66531cb5c81bb04c7cf06140225fc5489159a6`.
Rollback `liska-rollback-20261031T081610269Z-c5c3aa4d48e948fb865d964ebf299dd8`
retains the previous installed bytes. One stale browser reload still referenced
an old removed content bundle and failed closed; a second explicit extension
reload plus page reload loaded the current bundle and logged `Sync initiated`,
`Extracted Claude conversation from local session detail`, note generation and
note-write completion.

The installed four-message canary wrote raw 8,159 bytes / SHA-256
`84b4d9efae6fed310dc34b0b5f140be2e0b2067230fb4722584dd6d0f55123fc`,
manifest 1,226 bytes / SHA-256
`643aa3625c94d38fa423c28363d7ca2e2c76fb43ec206013e00691710e394131`,
and canonical 24,175 bytes / SHA-256
`a09acb61ea9be16f28d7aa5544cfcf99c6f65ae68e934c6986d8ebfa92a04341`.
Raw length/hash match the manifest exactly; canonical input hashes the exact
manifest, retains four message nodes, one root and a present current leaf.
Markdown carries `message_count: 4`, `capture_mode: structured-api` and
`capture_completeness: partial`. Downloads and the configured Obsidian vault
contain byte-identical copies of all three companions; their Markdown notes are
also byte-identical at 5,125 bytes / SHA-256
`6f33f5ee68f76daa360159fab4a8bdb40cdf41a3efdf4df2080002bb6e400576`.
No Claude message was sent, no provider setting changed and no attachment byte
was requested.

Focused normalizer, capture, extractor, background authority and destination
checks pass, as do TypeScript, formatting, diff checks and the guarded
production build. Independent review found and closed sensitive alias leakage,
pre-normalization raw-evidence loss, cross-conversation navigation mixing and
post-navigation stage-cleanup authority. A separately overloaded verbose run
of the legacy 168-test autoscroll file timed out after 22 minutes and is not
accepted as a regression verdict. Its 158 completed tests passed; the ten
timeout cases plus related boundary variants pass together as 19/19 in 112.34
seconds, and the first timeout case passes alone in 5.98 seconds. The rest of
the repository passes 243 files / 8,703 tests with one file / three tests
skipped in 122.07 seconds. Combined unique current-input evidence therefore
covers all 245 files / 8,871 tests with three skips, while deliberately avoiding
a false single-run claim for the resource-heavy autoscroll file. Repository CI
remains the independent current-head single-run gate.

## Dots timeout-origin installed canary 2026-11-01

One separately authorized trusted popup canary ran on 2026-11-01 from the
already-selected exact `/dots/{dot~room}` tab. The installed candidate contains
44 files / 1,223,153 bytes; source and installed aggregate SHA-256 are identical:
`fa8e4da267d792aac112c9d05affa004f2094ff0b06caf629ee663870113e156`.
The installed manifest SHA-256 is
`b556fa5df4243344f52385ec6adb9c85030425d3568749364b0837eb51f15289`.
The rollback leaf exists; local absolute paths are intentionally omitted.

The popup returned exactly `background-timed-out`. The nonce fragment was absent
afterward, and no top-level Dots/schema diagnostic file appeared. The code path
returned before diagnostic download, so the absent file is not evidence of a
download failure. No retry was made.

This establishes popup/background messaging, selected-route and nonce admission,
and completion of the marker-update and reload promises. Background accepted no
terminal MAIN state before its polling deadline. Unlike `observer-timed-out`,
this does not establish acceptance of a MAIN hard-deadline error. It proves
neither hook arming nor MAIN execution, endpoint admission, transport kind, a
room response, RequestInit/URL-object/XHR classification or schema capture. It
also does not establish whether background ever accepted ready or pinned a
document.

This consumes the one authorized origin-specific canary with negative schema
evidence. No retry, code, timer, admission, permission or sink change is justified
by this result. If further work is separately authorized, the useful next bounded
value-free diagnostic is whether background ever accepted ready and pinned a
document, not another unchanged canary. Dots transport and raw-adapter authority
remain unproven; ITH-008 records this boundary as E4 and the spent T1 trigger.

## Official export File range-source and browser-harness candidate checkpoint

Branch `codex/official-zip-file-source` starts from merged main `b4033bc` and
closes the missing browser-File boundary in front of the existing official ZIP
core without wiring ZIP into the reconciliation picker. One explicitly supplied
native `File` becomes an anonymous frozen `OfficialZipSource` containing only
`size` and exact `readRange(start, end, signal)`. The adapter accepts no name,
path, MIME or timestamp; validates safe ranges and the existing ZIP32 archive
ceiling; returns independently owned bytes; and maps native errors and caller
abort reasons to fixed content-free codes.

The adapter captures File/Blob/ArrayBuffer/AbortSignal/Promise platform
intrinsics at module initialization. Instance, subclass and later prototype
overrides cannot substitute same-length bytes or leak native failures. Pending
native reads remain handled after a prompt public abort. The explicit trust
boundary is the browser realm at module import; JavaScript cannot attest a realm
already compromised before import.

An opt-in synthetic browser acceptance extension is committed separately from
the production CRX build. Its manifest has no permissions, host permissions,
background worker, content scripts or network authority and uses a deny-by-
default extension CSP. A Node-only independent ZIP32/CRC generator materializes
eight deterministic files: legacy and both sharded layouts, STORE, truncated
raw DEFLATE, trailing data in the final chunk and exactly across the 1 MiB read
boundary, plus a large low-compressibility DEFLATE workload. Original picker
`File` objects are identified only after explicit selection by exact length and
SHA-256, never by filename, MIME or selection order. The runner exposes only
fixed case IDs, PASS/FAIL/INCONCLUSIVE and bounded numeric metrics.

The combined adapter/core/harness suite passes 255 tests. TypeScript, production
build, repository lint with 31 pre-existing warnings and zero errors,
formatting and diff checks pass. Independent review found no material defect and
separately reconciled fixture bytes, hashes, raw-stream boundaries, native
range ownership and privacy. The ordinary production package contains 55
entries / 394,011 bytes, SHA-256
`fe48d0546d45d017685167e57a3424d57787e02baaebc0941df82fb504ce62f7`,
with zero harness, fixture-index or test-result entries.

This checkpoint is not installed-browser acceptance. Loading the separate test
extension, selecting the generated synthetic files through the real OS picker,
observing native DEFLATE exact/truncated/trailing behavior, cancellation,
backpressure and visible-tab responsiveness still require an explicit browser
run. It does not claim real private-export import, production picker wiring,
delivery, archive authenticity/completeness, total-memory bounds or OS read
cancellation.

## Official export ZIP installed-Comet synthetic acceptance — 2026-11-01

The separate zero-permission MV3 harness completed one clean visible run through
the installed Comet OS File picker with overall `PASS`. All eight synthetic
legacy/sharded, STORE, malformed raw-DEFLATE and large-workload cases passed.
Preflight identified eight original files by exact length/SHA-256 in 63.4 ms;
the measured adapter/native phase took 1,341.5 ms; postflight took 36.9 ms and
confirmed all eight selected-file hashes unchanged. Whole-file pre/postflight
hashing is outside the measured adapter phase.

The exact bounded runner metrics were:

- visible timer/animation heartbeat: `PASS [31.3,20.9,250,67,189]` (maximum
  timer/frame gaps in ms, declared gap ceiling in ms, timer/frame counts);
- direct ranges and owned buffers: `PASS [4,170]`;
- native paused consumer and resumed drain:
  `PASS [6,6,6,6,6,2097152,12636993,16777216,8]` (five read-start samples,
  paused payload bytes, compressed payload bytes, resumed expanded bytes,
  retained chunks);
- active abort with no growth: `PASS [0.2,6,6,0,0]` (public abort ms,
  reads at abort/after observation, output growth, late reads);
- synthetic delayed-source pending abort: `PASS [0.2,1,4,4]` (public abort ms,
  delayed starts, native reads before/after observation).

An earlier run was `INCONCLUSIVE` only because the page became hidden after
the user switched away. Code inspection confirmed hidden-state precedence over
timer-gap classification. That run is neither acceptance evidence nor a runtime
failure.

Independent deterministic verification found exactly eight ZIPs, each with full
SHA-256 and length matching `fixture-index.json`; the index SHA-256 is
`34181009c3a575a1f45d4c2da34d02df67e95328a716ad30e12f54be861c61f7`.
The installed-browser gate is complete for this exact Comet picker/native
runtime and synthetic File/range/DEFLATE/backpressure/abort/responsiveness
workload. Production ZIP UI/delivery and separately authorized private official
export acceptance remain open. This does not prove archive authenticity or
completeness, total browser memory bounds, or OS-level read cancellation.

## Ordinary direct XLSX experiment retired unaccepted — 2026-11-01

This is a historical, documentation-only transfer from unmerged
[PR #89](https://github.com/la4ox/liska-threadkeeper/pull/89), branch
`codex/chatgpt-ordinary-xlsx`, at
[candidate head `f6fb659`](https://github.com/la4ox/liska-threadkeeper/commit/f6fb6591e9311932de29394798de42f5738861b7).
The final installed evidence was recorded in
[`a086fe3`](https://github.com/la4ox/liska-threadkeeper/commit/a086fe3af022b67dc2e52e2170677f1a0f961a08).
None of that branch's ordinary-XLSX implementation, validation profile or
source-diagnostic changes is being adopted into main by this evidence entry.
The capability never passed live byte acceptance and is retired unaccepted.

The historical candidate started from a complete 13,118,031-byte raw capture
with one exact ordinary direct XLSX attachment, declared as 12,101 bytes. The
retained whole ledger contained no Library, interpreter/sandbox,
custom-GPT/project or template ownership marker for that asset. Its branch-only
design required exact direct identity and MIME, positive bounded declared size,
whole-ledger uniqueness/owner separation and immediate committed-raw replan.
It proposed one existing active slot after Library text/plain and before ordinary
images, preserving the four-operation, 20-attempt / 128 MiB budgets and no-retry
ownership rather than widening image, Library or interpreter authority.

Only the candidate's runtime-only `ordinary-direct-xlsx` profile required exact
response MIME/declared length and bounded structural ZIP/OOXML admission before
hashing or persistence. Its lazy validator rejected unsafe package paths,
encryption, external relationships, DTD/entities, VBA/XLM and resource excess.
It did not render/calculate cells, inspect worksheet semantics, verify every
unrelated payload CRC or certify workbook safety. These were candidate design
and offline-test claims, not live validation of the retained workbook.

The branch history records independent review closing a legacy-XLSX regression
with the explicit profile and an XML namespace-amplification case with namespace
reuse plus an aggregate work budget. It records 997 affected ChatGPT tests and
a later source-attribution check of 9 files / 1,068 tests, plus TypeScript,
scoped lint, formatting and build checks. Its broader coverage attempt passed
245 files / 9,079 tests with three skips but timed out in six unchanged Claude
autoscroll cases; those six passed together without coverage. The combined
record therefore covered 246 non-skipped files / 9,085 passing tests, not one
all-green coverage invocation. Recorded CI, Code Review and Security Review
were clean at candidate revision `de7a61d`; none of these historical checks is a
current-main test run or a substitute for live XLSX acceptance.

Three installed trusted-export canaries followed on that branch:

1. The normal-mode canary selected one XLSX but stopped before helper dispatch
   with legacy `source-http-error` (the durable dispatch metric was unknown).
   This ambiguous code did not distinguish a source status from source-response
   processing failure. The asset stayed `not-attempted`, with null attempt
   timestamp/path/length/SHA-256, and no XLSX binary or retry.
2. The attribution canary reported `source-http-4xx` before helper dispatch.
   The same null binary evidence and `not-attempted` state remained. This proved
   only a client-error-class response on the separate source request, not
   authentication, absence, expiry, rate limiting or another cause. No retry ran.
3. The final approved canary on 2026-11-01 passed the source gate with HTTP 200
   JSON and completed one known helper dispatch. Its envelope was classified as
   `provider-status-other`; no download candidate was accepted. No binary
   acquisition, expected-length check or structural OOXML validation occurred.
   The asset was `failed` with `attemptedAt` present, exact XLSX MIME only as
   identity metadata, and null path/byte length/SHA-256. No XLSX binary or retry
   occurred. The locally approved 400–499 integer diagnostic did not fire, so
   this neither explained the earlier 4xx nor established a finer envelope cause.

All three historical canaries preserved pairwise byte-identical File/Obsidian
raw, manifest and canonical companions. The final safe aggregate was:

- Raw: 13,118,031 bytes;
  `67ab8b989fbf12944d8d498235445f72d97684bcb1031904108a5c678212405c`.
- Manifest: 17,248 bytes;
  `976594d6c8f6e409a2cf19585ecdea0f759bac0ef38c8f95e499ee74dd29e684`.
- Canonical: 29,340,883 bytes;
  `6a49dff2bc0d33c21edd7d4262a3637b6f9ce0143c6576f5b856cf95e8dd0f1b`.

File also saved an 8,116,627-byte HTML view and its receipt. Both Markdown notes
were saved but differed by the configured presentation transform; Markdown byte
identity is not claimed. Local-only receipts are
`LISKA-XLSX-NORMAL-MODE-20261031`, `LISKA-XLSX-SOURCE-4XX-20261031` and
`LISKA-XLSX-PROVIDER-STATUS-OTHER-20261101`; only safe aggregates are retained here.

The final canary authorization is spent. Intended disposition: merge the
documentation-only evidence PR first, then close #89 unmerged and retain its
branch as historical evidence. No further canary, code change, retry,
provider-envelope diagnostic or transport redesign is authorized by these
results. Any future ordinary direct XLSX work requires a new, separately
authorized evidence plan; this is not an open acceptance step for main.

## Ordinary image destination-integrity candidate — 2026-11-01

Branch `codex/sec-immutable-images` starts from merged main `09dbb18` and
addresses repository-scan finding `csf_f4bdef66eee0e03879dd3d07` / occurrence
`occ_6d8073e1a620a00d37a7797f`. The former ordinary title/index image namespace
could be externally uniquified after Markdown had already selected the old
name, while fresh Obsidian unconditionally replaced an occupied same-named
attachment.

The candidate shares one strict full-SHA-256 planner between ordinary and append
images. Fresh Obsidian uses the existing create-only Local REST API capability,
bounded exact-byte readback, byte-identical reuse and confirmed full
vault-relative Markdown paths. It never overwrites different existing bytes;
unconfirmed images are omitted with the existing nonfatal count warning. File
persists every content-addressed image before Markdown and requires terminal,
current-complete, current-existing and exact requested relative-path evidence.
Collision rename, interruption, deletion, timeout, lookup failure and parser
uncertainty therefore leave no Markdown that falsely claims the image.

The old `imageFileName`, `resolveImagesForObsidian` and `resolveImagesForFile`
exports are removed rather than retained as unsafe dead APIs. Independent
review found and rechecked the fresh Downloads-state/existence and real
200,000-node parser-budget seams; no material finding remains under the explicit
cooperative-browser boundary. The absolute Downloads root remains browser-owned
and opaque, and Downloads evidence is not byte readback, atomic multi-file
commit or a permanence guarantee.

The final affected matrix passes 9 test files / 574 tests. TypeScript and the
production build, targeted ESLint, focused Prettier and diff checks also pass.

The implementation is offline-verified but is not yet committed, published,
CI-reviewed, installed, or live-accepted. The exact Cloud occurrence remains
open until merge ancestry and current-main evidence are established.

## Ordinary image destination-integrity merge result — 2026-11-01

PR 96 merged the reviewed source head `f1266ad` into `main` as `dd240ab`.
Fetched `origin/main` contains that exact head as an ancestor. GitHub CI passed
248 test files with one file skipped and 9,079 tests with five skips; the
production package built successfully. Exact-head Code Review and Security
Review completed with no findings.

The repository-scan occurrence `occ_6d8073e1a620a00d37a7797f` remains `New`
administratively. Its repository-finding record has no commit detail or version,
so the connector's commit-finding close operation cannot accept it. The web
detail exposed View scan/Fix with Codex but no status mutation. No replacement
scan, duplicate fix PR or fictitious closure was created. Source remediation is
merged; installed File/Obsidian acceptance remains a separate live gate.

## Security Cloud repository-scan static triage — 2026-11-01

All nine records remaining after the ordinary-image fix were re-read against
current `main` `dd240ab`, with no repository `SECURITY.md` policy present. Eight
claims remain statically confirmed and one is superseded by current code. The
confirmed exploitability queue is:

1. page-realm mutable primordials can substitute ChatGPT opaque replay state;
2. provider DOM/CSS can redress the trusted in-page export control;
3. ChatGPT and DeepSeek privacy-diagnostic deduplication is quadratic;
4. nested ChatGPT content normalization has an uncontrolled recursive walk;
5. provider Markdown/image processing permits superlinear pre-limit work;
6. DeepSeek navigation can mix structured evidence from chat A with DOM fallback B;
7. build comparison extracts and reads an untrusted release ZIP without budgets;
8. normalized default ports 80/443 bypass the declared Obsidian minimum port.

The prior low Obsidian-response buffering claim is not actionable on this main:
PR 92 routes ordinary text, binary and directory reads through bounded streaming
and rejects redirects. The ranking is static evidence, not runtime exploitation
or exhaustive new discovery. ITH-009 already owns the provider-DOM UI redesign;
the other confirmed records remain separate fix slices rather than one broad PR.

## Linear privacy diagnostics candidate — 2026-11-01

Branch `codex/sec-linear-privacy-diagnostics` starts at merged main `dd240ab`
and addresses repository finding `csf_238ec3b8127a895cabcda3a7` / occurrence
`occ_0b55bd216944b6ba5eeae57e`. Both provider normalizers formerly scanned the
complete prior redaction array for every new diagnostic. A deterministic
pre-fix reproducer observed 4,032,008 numeric historical-row reads for 2,000
unique keys and 16,064,008 for 4,000.

Each recorder now keeps its ordered diagnostic array as the only serialized
source and uses a private array-keyed WeakMap/Set membership sidecar. ChatGPT
keys exact JSON tuples of code and pointer; DeepSeek retains its pointer-only
contract. Existing arrays are seeded once, replacement/cloned/shared arrays
receive their own index, and duplicate calls still perform sanitation and local
redacted-state callbacks. A partially completed Proxy `push` is reconciled from
only its attempted own data slot before the original error is rethrown, so a
retry preserves the first row without a rescan.

The deterministic regression now stays within 16 historical-row reads at both
input sizes. Complete legitimate ChatGPT and DeepSeek archive JSON hashes remain
byte-identical to the pre-patch outputs. Five affected normalizer/inventory
suites pass 354 tests; TypeScript, the production build, targeted lint,
formatting and diff checks pass. Independent review found the partial-push seam
and rechecked its fix; no other material finding remains in this candidate. It
is not yet committed, published or CI-reviewed.

## Canonical-derived text installed acceptance checkpoint — 2026-11-04

Branch `codex/derived-export-formats-v1` implements the first new presentation
format from ADR-047: a default-off, canonical-derived `liska-text/1` reading
view for current or explicitly selected single-branch ChatGPT/DeepSeek File
captures. It renders deterministic UTF-8 `index.txt` from independently
validated canonical meaning, never from compatibility Markdown, and writes a
separate `liska-derived-text-output-receipt/1` only after the browser confirms
the exact final path, byte length and digest. Raw, manifest, canonical,
Markdown and HTML contracts remain unchanged; all-branches, Clipboard,
Obsidian text, Claude/DOM fallback, preview selection, PDF, DOCX and image are
outside this slice.

Independent review found and the implementation closed two P2 seams: unframed
provider text could impersonate structural roles, and an unknown delivery state
was described as a confirmed failure. Every provider-controlled physical line
is now visibly framed, while confirmed, unknown and not-dispatched outcomes stay
distinct. The installed smoke then exposed one real transport omission:
offscreen Blob URLs admitted JSON and HTML but rejected exact `text/plain`.
The allowlist now admits only exact `text/plain`; parameterized, case-variant,
image and script types remain rejected, with an actual derived-text artifact
regression covering bytes, Blob type and revocation.

The final complete suite passed 266 test files and 9,605 tests, with one file
and three tests skipped and zero failures. Production build, TypeScript,
formatting and lint passed; lint retained 55 existing warnings. The verified
installed package contained 45 files, 1,299,373 bytes and source/installed
SHA-256 `e87f904f5c0e28856bc367e2e668cdc1d7f0838441e395a35ff81134c3228550`.

One trusted installed-Comet File capture persisted the ordinary archive trio,
Markdown, canonical-derived HTML, a 46,165-byte `index.txt` and its 518-byte
receipt. The text contained 822 lines with 821 LF and zero CRLF separators, 311
framed source lines and 40 message boundaries. Actual artifact length/digest
matched the receipt, and the receipt's source digest matched the exact canonical
artifact. This is content-free acceptance evidence; no title, message body,
conversation identifier, local path or provider URL is recorded here.

The smoke-only destination change was rolled back through the real authorized
popup. Obsidian and File are enabled, Clipboard and append remain disabled, and
the UI confirmed `Settings saved successfully!`. Canonical text remains enabled
as the user's explicit choice. Conversation-to-image is not an active format:
an ordinary screenshot covers the current visual-snapshot need.

## Canonical-derived text current-head review fix — 2026-11-04

PR 109's first reviewed head `1f5af3a` passed Code Review but exposed one P2 in
Security Review and one CI-only coverage failure. The renderer's byte ceilings
bounded final output size but not the number of retained array fragments:
newline-dense source could create two entries per separator before the final
join. CI otherwise passed every test and failed only because global statement
coverage was 94.79% against the unchanged 95% threshold.

The follow-up candidate keeps the exact `liska-text/1` output and all existing
source, character and UTF-8 byte ceilings. `TextRenderer.emit()` now ignores
empty fragments after accounting and coalesces nonempty fragments through a
bounded 8,192-character pending buffer into coarse chunks. The final text flush
preserves empty/trailing physical lines and CRLF, CR, LF, U+2028 and U+2029
normalization without a new line rejection contract or Markdown dependency.
Five deterministic 25,000-separator cases verify exact output and cap every
observed join receiver at 8,192 elements; no large-memory runtime reproducer was
performed.

Meaningful contract coverage now includes absent/empty metadata, hidden and
non-user messages, every public renderer limit, invalid/trap-bearing transport
envelopes, canonical identity drift, cleanup deferral and the real partial
delivery where TXT is confirmed but its receipt is not. The complete local CI
test step passes 266 files and 9,719 tests, with one file and three tests skipped.
Coverage passes at 95% statements (`27,157 / 28,585`), 91.75% branches, 98.09%
functions and 97.28% lines. Lint passes with the same 55 existing warnings;
formatting and `build:zip` pass. Exact-current-head GitHub CI, Code Review and
Security Review remain required before merge.

## Canonical-derived text merge result — 2026-11-04

PR 109 merged reviewed head `8fc4a3f` into `main` as merge commit `65b8d59`.
Fetched `origin/main` contains that exact head as an ancestor. Current-head CI
passed; Code Review and Security Review completed without findings, and the one
earlier allocation-amplification thread was answered and resolved. The merged
CI restored the unchanged statement threshold after meaningful boundary tests;
no threshold, exclusion or archive/output contract was weakened.

## Selected-preview capture seam candidate — 2026-11-04

Branch `codex/export-preview-selection-v1` begins at merged main `65b8d59`.
ADR-048 records the next product boundary: canonical remains one complete
append-only graph, while a selected reading view binds its exact digest, one
branch target, ordered message IDs and one reading profile. It never rewrites a
canonical graph or silently attaches raw/manifest/canonical sidecars.

The first preliminary candidate is behavior-preserving only. Existing ChatGPT
branch-mode selection, extraction toast/settings application, DeepSeek identity
snapshot and the original extraction promise now pass through one synchronous
`startConversationCapture` seam. A callback preserves the exact historical
diagnostic-stage transition immediately before `extract()`; no async boundary,
output preflight, cancellation/navigation check, failed-evidence path,
attachment acquisition or persistence ordering changed.

Stage-cleanup helpers remain separate intentionally: stopped extraction,
changed DeepSeek identity and partial persistence use different predicates,
source gates and ownership of unclaimed staged artifacts. The focused capture,
attachment, derived-output and stage-ownership matrix passes 190 tests across
eight files; TypeScript, production build, scoped lint/format and diff checks
pass. The candidate adds no preview UI, capture-only authority or new provider
capability yet.

## Selected-preview capture seam merge result — 2026-11-04

PR 110 merged reviewed head `8533873` into `main` as merge commit `542822c`.
Fetched `origin/main` contains that exact head as an ancestor. Current-head CI,
Code Review and Security Review completed without findings. The merged seam is
behavior-preserving: existing ChatGPT/DeepSeek capture, diagnostics, attachment
and persistence ordering remain unchanged, while later preview work receives one
named synchronous capture boundary.

## Extension-owned Text preview installed checkpoint — 2026-11-04

Branch `codex/text-preview-selection-v1` begins at merged main `542822c` and
implements the first ADR-048 vertical. `liska-presentation-selection/1` binds an
exact canonical digest, one branch target, ordered unique canonical message IDs
and one reading profile. Detached `liska-text-preview/1` retains only bounded
canonical-derived rows needed for local inspection. Neither object is a reduced
canonical archive; raw, manifest, canonical, assets, provider authority and
destination settings do not enter the page.

The trusted popup can open ChatGPT current/selected and DeepSeek current Text
preview. One in-memory controller binds popup, source and preview identities,
separates pending/capture/delivery/page leases, permits only the exact temporary
capture-stage action set, and transfers a payload once before exact ACK. Search
filters only presented rows. Initial selection is empty; checkbox, inclusive
range and Select all resolve to an immutable ordered ID selection. Copy and
Download are separate explicit actions and no ordinary archive/output sink is
reachable from the preview capability.

The first installed attempts exposed a Comet-specific navigation edge. Comet
aliases the extension page as `comet-extension://`, while `tabs.update()` may
return the prior ChatGPT URL before the requested local navigation commits.
Liska now accepts only the explicit Chrome/Comet scheme alias with exact
extension ID/path/UUID query, treats the update response as tab/window identity
only, and waits at most five seconds for a completed exact read-back before
contacting the source. Failure stages are fixed and value-free; no native error,
URL or conversation detail crosses into the popup, and no uncertain start is
retried.

The installed live candidate contained 53 files / 1,359,439 bytes with matching
source/installed aggregate SHA-256
`cf0bef867086399aeaaa1ad748ebfc4bc76a8ae92b24b569090f209bc94ffc7f`.
One current ChatGPT branch opened as 40 rows with zero initially selected.
Selecting one row enabled local actions; filtering to assistant showed 32 rows
and retained one selected row hidden by the filter. Clear reduced the page to
zero rows and disabled outputs; the cleared window was then closed. No Copy,
Download, archive write or settings change was performed. This is a content-free
installed-current-branch checkpoint, not selected-branch or later-format proof.

Independent functional review found one lifecycle P2 before commit: Clear
invalidated a still-open page against its absolute 15-minute lease, and a later
window close did not shorten that already-invalidated deadline. Four repeated
Clear/close cycles could therefore occupy every preview slot. Every closed page
now narrows its existing deadline to the 30-second terminal window even after a
prior invalidation. The exact-boundary regression observes the invalidated lease
at 29,999 ms, its removal at 30,000 ms and a successful fresh start afterward;
the re-review is clean.

The final complete coverage run passed 278 test files and 10,037 tests, with one
file and three tests skipped and zero failures. Statements are 95.12%
(`28,572 / 30,036`), branches 91.87%, functions 98.25% and lines 97.35%.
Installed live coverage remains deliberately scoped: current ChatGPT selection,
filtering and Clear are confirmed; selected ChatGPT, DeepSeek and actual
Clipboard/File actions remain later live evidence rather than inferred claims.

After the reviewed lifecycle fix and localized value-free failure messages, the
final candidate was rebuilt and installed as 53 files / 1,361,409 bytes with
matching source/installed aggregate SHA-256
`5fcd2c409dbc24848fcedd1ed6d248d56808cd79d4e0ef1eb3b65ff554e3af18`
and manifest SHA-256
`d46a0aeb0458e02b24e431afd9d3ea14e9197f654f13f153f78f11c77dc507f5`.
Rollback `liska-rollback-20261104T025904092Z-aa077acd262145fa8cf571ed6cfaf3c0`
is retained. Only Liska and the existing test ChatGPT tab were reloaded; no
browser restart or destination write occurred.

## Selected-preview merge result — 2026-11-04

PR 111 merged reviewed head `b669cc8` into `main` as merge commit `43eac55`.
Fetched `origin/main` contains the exact reviewed head as an ancestor. CI, Code
Review and Security Review completed on that head without findings or unresolved
threads. The merged page therefore establishes the Text selection/session
boundary before richer formats are added.

## Selected Text/Markdown/HTML preview candidate — 2026-11-04

Branch `codex/selected-html-markdown-preview-v1` begins at merged main `43eac55`.
It adds strict frozen `liska-presentation-preview/1` and
`liska-selected-presentation/1` contracts without extending or renaming the
legacy Text `/1` schema. Canonical remains the single semantic archive. During
authorized capture, Liska prepares ordered self-contained Text, Markdown and
HTML bodies plus finite diagnostics, then releases canonical/capture stages
before the existing one-shot page transfer. The projection retains no graph,
canonical messages, source references/extensions, raw/provider facts, asset
IDs/bindings/bytes/paths or destination settings.

The combined projection ceilings remain 5,000 rows, 1 Mi UTF-16 characters per
row, 64 Ki title, 8 Mi aggregate characters and 12 Mi serialized UTF-8 bytes.
Selected output has its own atomic 8 Mi character / 12 Mi byte cap. HTML and
Markdown share preparation-wide parser/source/work accounting, so per-row
generation cannot multiply the admitted work. HTML reuses canonical block
semantics with no asset bindings and a no-network CSP. Markdown derives from
typed blocks, resolves references locally, keeps provider HTML inert and honors
the captured default-on inert tagged-code setting. Strict adoption rejects raw
HTML, images/references/definitions, unsafe links and unfinished physical
fences in wire Markdown.

The popup/page now say `Selected reading preview`. Cards and search still use
only bounded `presentedText`; one native Text/Markdown/HTML selector changes no
selection. Format and ordered IDs are frozen synchronously before the first
lease/output await. Copy always writes source text. Download derives Blob MIME,
extension, filename and bytes from the frozen artifact and retains the prior
exact-ID terminal/read-back, cleanup and no-retry behavior. HTML source is never
inserted into the extension DOM.

Independent functional review found three Markdown fidelity seams before live
acceptance. Entity-looking ampersands in safe URLs could reparse as Unicode;
four-space/mixed-tab/CR-boundary literal text could become escaped indented
code; and ASCII-space-padded NBSP inline code could lose its boundary spaces.
Destination entity escaping, indentation-sensitive literal fencing and the
ASCII-space-specific padding rule close them. Round-trip regressions cover
inline/reference/citation URLs plus Text/quote/citation and whitespace variants;
the final re-review was `ready`. The first PR code review then found one adjacent
emphasis collision: normalizing every parsed `_` delimiter to `*` could merge
neighboring emphasis/strong nodes and introduce literal punctuation. The source
renderer now retains only the parser-validated original `*` or `_` delimiter for
each emphasis/strong node while continuing to rebuild and sanitize its children.
Where decoded text would make an adjacent underscore delimiter intraword, only
that visible boundary code point is emitted as a numeric reference; visible text
and parsed structure remain unchanged. Symmetric, mixed-weight, nested and
character-reference AST round-trip regressions cover that boundary. Independent
re-review is `ready`, including 1,936 additional parser combinations.

A later code-review pass found two further round-trip boundaries. Character
references that decode to leading/trailing whitespace inside emphasis or strong
now remain numeric references at only that delimiter edge. Ordered and unordered
lists retain their parser-validated source delimiter, so adjacent `1.` / `1)`
procedures or `-` / `+` lists cannot merge. Empty list items accept a physical
LF, CR or CRLF after the marker. Focused coverage includes ordinary, nested and
quoted lists; independent re-review checked 45 additional list sources / 60 list
nodes and is `ready`.

The next code-review pass found two remaining structural families. Fenced code
now always receives a separate closing-fence line, with a CRLF separator after a
terminal CR so LF, CR and CRLF payload endings retain their parsed value.
Markdown text newlines inside headings are recursively emitted as numeric
references, while real `break` nodes remain physical and use setext h1/h2.
Boundary whitespace beside heading edges or breaks is protected without changing
visible text. Quote and list container prefixes now follow every physical LF,
CR or CRLF, preserving nested quote/list/fence structure. Focused regressions
cover root and nested containers, soft/hard heading breaks and CR-only payloads;
independent re-review checked 120 additional EOL/nesting combinations and is
`ready`.

The following code-review pass exposed two parser-level seams outside headings.
Every non-space Unicode whitespace character in Markdown text is now an
identity-safe numeric reference, preventing decoded tabs/newlines from becoming
code blocks or paragraph boundaries; paragraph-edge ordinary spaces receive one
boundary reference. Boundary references beside either `*` or `_` emphasis use a
guard matching the installed CommonMark decoder: C0/DEL/C1 controls, surrogates
and Unicode noncharacters stay raw whenever a numeric reference would corrupt
them to `U+FFFD`. Thematic breaks retain their parser-validated source marker
(`*`, `_` or `-`), so they cannot collide with an enclosing list bullet.
Focused middle/start/end whitespace and list-marker regressions pass; exhaustive
decoder-range comparison plus 4,350 extra emphasis/strong combinations found no
remaining mismatch, and independent re-review is `ready`.

A final code-review pass found two block-structure edges. Markdown HTML nodes now
use the same whitespace-safe literal renderer, so blank lines, indentation and
setext-looking text remain inert rather than becoming code or headings. Ordered
lists emit their exact bounded start only for the first item and use marker `1`
for later items; this preserves CommonMark's nine-digit marker limit without
changing displayed numbering, item count or nesting. Focused regressions and
independent re-review are `ready`.

The first security review found one distinct P2: literal provider/user `$` and
`$$` text could become active Obsidian math even though the canonical block did
not distinguish trusted math. `markdownLiteral()` now backslash-escapes dollar
delimiters on every literal path. Inline and fenced code retain their original
dollar bytes. A focused regression proves both halves.

The pre-review installed candidate contains 52 files / 1,384,752 bytes with
matching source/installed aggregate SHA-256
`548cc9f7964ae397a44d51df5db5f2762c2d9ee5a9240ccadfb0523055b90fd6`
and manifest SHA-256
`eb64ed09b3e09b1a1525dc1c625fe6c140bde4af5bd5c2f2ca91fcab2720d631`.
Rollback `liska-rollback-20261104T040953407Z-c84cfb160eca43a19d7b2575b3b22ead`
is retained. One current ChatGPT branch produced 40 rows and zero initial
selection. Selecting one short user row and changing format preserved the same
selection. Markdown clipboard completed with 817 UTF-8 bytes / SHA-256
`a8b392a9dd9fd7a01cd9f0a88c984951e8ee026bffa6e2b80bff4c9d18ed09fe`,
the selected-view header and `1 of 40` provenance.

HTML Save As exceeded the browser-observation deadline and remained honestly
`unknown`; Liska issued no retry. Completing that same already-open native dialog
later produced `liska-selected-reading-live-test.html`, independently verified
as 2,412 UTF-8 bytes / SHA-256
`dd06d989f031268f2f83c883a18d4cbf1d75540725b0bc861bf8a4e99e76166c`,
with DOCTYPE, CSP, one article, `1 of 40` provenance and no script tag. Physical
file existence does not retroactively turn the browser receipt into success.
No archive output or settings changed. Selected-branch ChatGPT, DeepSeek and a
browser-observed terminal-success Save As remain later live evidence; PDF and
DOCX are still separate renderer slices.

The final complete coverage run passes 279 test files and 10,190 tests, with one
file and three tests skipped and zero failures. Statements are 95.09%
(`29,173 / 30,679`), branches 91.78%, functions 98.29% and lines 97.34%.
Full lint passes with zero errors and 55 existing warnings; format, production
build/package, diff checks and the nine-thread/37-relation idea-thread validator
pass.

## Exact CI architecture repair candidate — 2026-11-04

Every published preview head initially failed Linux CI on the architecture
fitness rule with `Cycle detected: lib -> archive -> lib`. The local Windows
suite had reported green because the broad `**/subsystem/**` globs matched zero
files beneath the hidden `/.codex/` worktree ancestor; cycle detection therefore
passed vacuously.

Pure byte-size, Markdown work-budget and inert-code-block helpers now live in a
neutral `src/shared` subsystem. Existing `src/lib` paths remain compatibility
re-exports, `MAX_CONTENT_SIZE` is re-exported from one shared definition, and
archive presentation imports shared helpers directly. This removes the reverse
`archive -> lib` edge without changing exports, function/class identity or the
32 MiB limit.

The cycle fitness rule now uses project-root-anchored absolute globs, includes a
`shared` slice and inspects the exact slices resolved by the pinned ts-archunit
`assignedFrom()` matcher. Every one of the seven declared subsystems must contain
at least one file before cycle evaluation can pass. Restoring the old hidden-path
globs makes the non-vacuity assertion fail. The focused cycle test passes 2/2,
the full architecture directory passes 44 files / 1,576 tests, the shared/facade
matrix passes 485 tests, and the complete current-input coverage run above is
green with the real cycle rule active.

## Selected Text/Markdown/HTML preview merge result — 2026-11-04

PR 112 merged exact reviewed head `2b4db7a` into `main` as merge commit
`b06f542`. Fetched `origin/main` contains that reviewed head as an ancestor.
Current-head CI, Code Review and Security Review completed without unresolved
findings. The merge includes the neutral shared-helper extraction and the
non-vacuous root-anchored cycle fitness rule above; no archive, destination or
selected-presentation contract was weakened to make CI pass.

The final merged build was installed in the stable Comet target as 54 files /
1,388,348 bytes with matching source/installed aggregate SHA-256
`2494a616cb5651f2c30da584873f177077f15dfb1ce54c0a52715d87946e3743`
and manifest SHA-256
`acb2c0e15490640a8e2dc91f66077eb3c94f875c900012d7ffea14a04068d229`.
Rollback `liska-rollback-20261104T101753141Z-e3f136801aaf4893a6cc9af9f59dd029`
is retained. Reloading the exact installed extension exposed `Selected reading
preview` and the Text/Markdown/HTML help on a known ChatGPT page; the temporary
verification tab was then closed and user tabs were preserved.

## Selected DOCX preview candidate — 2026-11-04

Branch `codex/selected-pdf-docx-v1` begins at merged main `b06f542`, but this
slice is deliberately DOCX-only. The page snapshots the adopted detached
preview and ordered selection before the first await, sends only selected safe
HTML bodies, roles, title and independent limits to a one-shot module worker,
and receives exact binary bytes plus a render receipt. The action is a separate
`Download .docx`; it does not enter the Text/Markdown/HTML selector, Copy,
Obsidian, archive companions, attachment acquisition, all-branches delivery or
remote conversion. PDF remains a later independent renderer.

The pinned runtime is `docx@9.15.2`. Independent refusal ceilings are 1,000
rows, 1 Mi UTF-16 HTML characters, 50,000 tokens, depth 64, list depth 8,
10,000 blocks, 30,000 runs, 256 numbering definitions, 8 MiB output and a
30-second packing-plus-hashing lifetime. The iterative grammar maps headings,
paragraphs, editable runs, native lists, quotes, code and placeholders; links
are literalized. `liska-docx-render-receipt/1` binds canonical/profile/selection
identity, counts and diagnostics to exact output length and SHA-256 without
claiming delivery. The page adds the exact browser download ID/outcome and omits
the private branch target from the displayed receipt. Clear, close, expiry and
lease loss abort owned work; an unknown outcome is never retried.

Focused current-input verification passes 12 files / 230 tests. The complete
coverage run passes 283 files and 10,250 tests, with one file and three tests
skipped and zero failures. Statements are 95.10% (`29,655 / 31,180`), branches
91.76%, functions 98.30% and lines 97.36%. Full lint has zero errors and the
unchanged 55 warnings; format and diff checks pass. Production build/package
creates one isolated 229,135-byte DOCX worker, keeps the service worker free of
the DOCX runtime, and includes byte-identical third-party notices in `dist` and
the ZIP. The final current-input 515,330-byte candidate ZIP has SHA-256
`d789c3644cb568407e15ca63525730fe125111bdccad24bcf15a944dc915a66f`.
All nine idea threads validate with 37 relations. Independent functional review
is `ready` with no actionable findings.

Automated tests parse generated OOXML ZIP/XML and verify editable runs, native
numbering, whitespace, placeholders, aggregate limits, worker lifecycle and
exact SHA-256; this is stronger than checking only the `PK` signature. It is not
installed acceptance. Remaining gates are one installed Comet download, an
independent physical-file hash, and Microsoft Word open without a repair prompt
followed by edit/save/reopen. Google Docs/LibreOffice, PDF behavior and broader
provider live coverage are not inferred.

The current candidate was then installed into the stable Comet target as 56
files / 1,631,046 bytes with matching source/installed aggregate SHA-256
`14cc8a04b77e63010673842f33eecafebc6d3f3ad4a5b62bf0d6c38ab58eaa6c`
and manifest SHA-256
`5c8c79bd549ed23b98fb12bbf078fccc5523fbd16eaa67990ede0bff8091d177`.
Rollback `liska-rollback-20261104T112828270Z-06ac666b086a414aa44dbe3a3f082acf`
is retained. Reloaded Comet reports the service worker active and the popup
exposes the new local-DOCX wording. CUA started the preview flow and observed
its bounded ChatGPT marker capture, but Comet did not expose the separate
unfocused preview popup as a targetable window. No DOCX download or archive
action ran, so the three live gates above remain open rather than inferred.

## Selected DOCX installed download and Word-open checkpoint — 2026-11-04

The separate preview popup was recoverable through the native Windows window
inventory after `Alt+Tab`; no fallback capture or approximate desktop click was
needed. The installed current-branch preview adopted 48 rows with zero initial
selection. Selecting the first user row enabled only the explicit reading-view
actions. `Download .docx` completed once with no retry and reported 9,934 bytes /
SHA-256
`6c8d94283d8df0d1c4e01fdfadbe2c3afd769dce0922dff810aff037671323a5`.

The physical file at the configured Downloads location independently matches
both facts. Its OOXML container has 17 entries including content types,
`word/document.xml`, native numbering and core properties. Microsoft Word opened
that exact file in Protected View without a repair warning and rendered one
editable page with the expected title, explicit selected-view disclaimer, role
heading and source text. Protected View is a user-controlled security prompt;
CUA did not bypass it. Edit/save/reopen therefore remains the only open DOCX
live gate. The two earlier unfocused preview windows are expired empty surfaces,
not additional captures or downloads.

## Selected DOCX Word round-trip acceptance — 2026-11-04

After the user explicitly left Protected View, a separate QA copy exercised the
installed Microsoft Word engine without changing the receipt-bound original.
Word opened the copy read-write, inserted one temporary character, observed the
edit, deleted it, proved exact text restoration before save, saved, closed and
reopened read-only with identical text. The reopened document remained one page.
The 15,736-byte round-trip copy has SHA-256
`a6eca861e28c2c09b22a98c1e033ea47eead80078e3502e72998be47e0eee459`;
the original remains 9,934 bytes with its receipt-matching digest.

The dependency bundle exposes Python and Poppler but no bundled LibreOffice.
The current Windows document workflow explicitly permits the verified system
`C:\Program Files\LibreOffice\program\soffice.exe` when `render_docx.py`
discovers LibreOffice through `PATH`. Rerunning the canonical renderer with that
exact system executable plus bundled Python/Poppler produced one 51,408-byte
page PNG. A localized LibreOffice stdout reader raised one non-terminal UTF-8
decode exception, but conversion completed and the page artifact is valid.
Full-page inspection found the expected title, disclaimer, role heading and
source text with no clipping, overlap, missing glyphs or broken spacing. An
earlier Word-export/Poppler fallback produced the same clean one-page layout and
is supplementary evidence, not the canonical renderer claim. Temporary
PDF/PNGs and helper scripts were removed; only the exact download and the
explicit Word-round-trip DOCX remain in Downloads.

This closes the DOCX-only renderer slice. It proves one current system
LibreOffice render, not Google Docs or broad LibreOffice-version compatibility,
and grants no PDF renderer, provider, archive, attachment or destination
authority. PDF remains the next separate renderer slice.

## Selected DOCX merge result — 2026-11-04

PR 113 merged exact reviewed head `aec769f` into `main` as merge commit
`8983929`. Current-head CI, Code Review and Security Review completed without
findings or unresolved threads; GitHub reported the PR mergeable and clean.
Fetched `origin/main` has parents `b06f542` and the exact reviewed head, and
`git merge-base --is-ancestor` returned success. The next branch therefore
starts from the merged DOCX boundary rather than carrying an unreviewed local
candidate forward.

## Selected PDF packaged candidate — 2026-11-04

Branch `codex/selected-pdf-v1` starts from merged DOCX main `8983929`. ADR-049
defines PDF as a separate explicit download-only renderer over the adopted
frozen selected projection. It does not enter the Text/Markdown/HTML selector,
reuse DOCX bytes, call browser print or gain provider, archive, attachment,
Obsidian, all-branches or network authority.

The candidate pins `pdfmake@0.3.13` in a one-shot module worker. Independent
lowering-only maxima are 100 rows, 1 Mi UTF-16 HTML characters, 150,000 decoded
code points, 50,000 tokens, depth 16, list depth 8, 10,000 layout nodes, 5,000
blocks, 15,000 runs, 16 code points per atomic emoji grapheme, 20,000 code
points per pre block, 4,000 per pre line, 100 A4 pages, 8 MiB exact output and a
20-second layout/pack/hash lifetime. Every refusal is atomic; there is no
truncation, Text fallback, recapture or retry.

The four exact pdfmake Roboto faces cover the tested Latin/Cyrillic intersection.
One pinned Google Fonts `NotoEmoji[wght].ttf` from commit `023eedd` is embedded
inline at 1,982,596 bytes / SHA-256
`de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`.
Exact cmap routing accepts tested `♥`, `❤️`, `🦊`, family ZWJ and flag clusters;
unsupported CJK refuses instead of producing tofu. An attempted WOFF2 path was
rejected after real family/flag subset encoding failed inside fontkit. The TTF
path parses the full strings without NUL. Ordinary Roboto long tokens remain
inside fixed A4 margins; atomic emoji clusters use normal no-wrap and reject
above 16 code points.

The PDF core owns PDF-specific schemas, selection/input/font/layout hashes,
effective limits, page/count/diagnostic evidence and exact output bytes/SHA-256
without a delivery claim. The page adds a separate trusted `Download .pdf`, two
lease gates, shared output lock, abort/epoch handling and a branch-target-free
display receipt while preserving DOCX and textual behavior.

Focused current-input verification passes 17 files / 310 tests. PDF.js and
fontkit independently confirm pages, selectable text and embedded fonts; the
core also proves deterministic bytes, pagination, long-token bounds, missing
glyphs, every work/result ceiling, cancellation/deadline through hashing,
stale/malformed replies and one-shot transfer. Full lint has zero errors and the
unchanged 55 warnings; the full coverage run passes 288 files / 10,331 tests
with one file and three tests intentionally skipped (95.14% statements, 97.38%
lines). Format, TypeScript, package and the existing service-worker runtime
guard pass. Production Vite emits one isolated 4,290,174-byte PDF
worker / SHA-256
`5ec98d33267395003d87d554cfcb770d4d68919e76343ca2d6dc31e6302c9e81`.
The prebuilt pdfmake closure retains dormant URLResolver/FileSaver, open/print
and guarded global-discovery helpers, including `fetch`, XHR,
`window`/`document` and `Function` references. The fixed renderer supplies no
resource URLs, installs a deny-all URL policy before layout, invokes only
`getBuffer()` and runs in the DOM-less one-shot worker; a direct regression test
proves that successful rendering never invokes `fetch`. This is a
reachability/effect boundary, not a claim that the third-party closure lacks
those primitives. `importScripts` and WebAssembly are absent, and the
service-worker closure remains unchanged. The final 2,751,213-byte candidate
ZIP has SHA-256
`0fcb305f369a47d5d654b3c935c7b1104c7e4db6a5b34375f1153e47cc468a50`.
Its 25,066-byte `THIRD_PARTY_NOTICES.txt` is byte-identical to the reconciled
source notice (SHA-256
`d5631ad5ebba31298d87a1eb5b1bef95d5450e5dd47465bfa9531dc13a24bb12`);
production dependency audit reports zero vulnerabilities.

A synthetic representative PDF parsed as four A4 pages. Raster inspection of
every page confirmed continuous line numbering across page boundaries, visible
Cyrillic/heart/fox glyphs, rich runs, lists, quote, code and placeholder output,
with no clipping, overlap, tofu, missing content or accidental blank page.
Temporary PDF/PNG/test artifacts were removed.

Installed Comet then loaded the exact stable-target build after an extension-only
reload and page refresh. Selecting one short real ChatGPT message produced
`D:\Downloads\Название канала-selection.pdf`; the browser receipt and independent
physical file both reported 13,735 bytes / SHA-256
`3a969e796c1b0ce8fe6b29eb64a4a531231c0b0346c96b3a7ab724bb430902d9`.
Comet's PDF viewer completed one A4 page and visibly rendered the title,
authority disclaimer, Cyrillic text and heart glyph. A second identical render
opened `Название канала-selection (1).pdf` in Save As; cancelling with Escape
reported `PDF download failed. Nothing was retried.` and no second physical file
existed. Installed worker/CSP execution, exact delivery, visible open and
cancel-without-retry gates therefore pass for the bounded PDF slice.

## Read-only snapshot catalog installed acceptance — 2026-11-04

Branch `codex/snapshot-catalog-v1` starts from merged PDF main `3288eea` and
implements ADR-050's first backup-foundation slice. A dedicated private page
accepts one trusted directory selection, snapshots metadata for every selected
file and reads bodies only for exact lowercase `manifest.json`. It has no
provider capture, network, settings/storage, runtime messaging, Obsidian,
source-file write or mutation path. Its deterministic catalog records manifest
validity, declared completeness, metadata-only artifact/asset/canonical
presence, provider/capture identity, occurrence/conflict facts and fixed issues;
it does not export locators, titles, messages, endpoints, URLs, source pointers
or free-form warnings.

The page lowers the pure core boundary to 4,096 files, 128 manifests, 256 KiB
per manifest, 8 MiB manifest bytes, 512-character paths, 8 TiB selected metadata
and 1 MiB JSON. The core independently validates/detaches plain own data and
native bytes, strict-parses duplicate/unsafe-key-free JSON, isolates the trusted
hash capability, namespaces provider identities, preserves duplicate occurrence
counts and capture conflicts, and revalidates exact selected-file/aggregate
invariants before encoding. The existing exact-byte snapshot analyzer remains
unchanged.

Current automated evidence passes 77 core catalog tests / 219 adjacent archive
tests, a current integrated 173-test catalog/page/architecture subset and the
full repository run: 295 files / 10,500 tests passed with one file / three tests
intentionally skipped (95.06% statements, 97.35% lines). Full lint has zero
errors and the unchanged 55 warnings; format, TypeScript, Idea-Threads
validation, production build, private-page capability checker and service-worker
runtime guard pass. The final 2,770,516-byte candidate ZIP has SHA-256
`9cf6563b9481da899524f2d41c8e8d8dafb2ee356b5f9f98e4a47c5aa4fa9d87`.
Independent functional reviews found and closed the strict encoder's
selected-file and byte-feasibility gaps; final core review and UI review are
ready. Security review remains for the PR.

Installed Comet selected `D:\Downloads\_liska-archive`: 495 files / 858,148,168
bytes, including 121 manifests / 1,360,745 manifest bytes. The page rendered
121 unique valid entries and four unassociated selected files, then saved
`liska-snapshot-catalog.json` at 128,309 bytes / SHA-256
`f3dc0fe282bc8957bb8a8c2c24d42e925a7323b47f266fbdc4405e97707b1f64`.
An independent production-core oracle rebuilt the same bytes while reading only
manifest bodies and confirmed no forbidden locator/content keys in the encoded
schema. A complete hash inventory of all 495 source files before and after the
run retained count, total bytes and aggregate SHA-256
`f5faaab3c0521655d09d770685447f78711e3b4dd3edd86539979b8766a26006`.
This closes the selected-root catalog, not raw/canonical/asset integrity,
account completeness, a provider enumeration adapter, a baseline runner or a
daily scheduler.

## Inert resumability journal installed acceptance — 2026-11-04

Branch `codex/resumability-journal-v1` starts from merged catalog main
`7d13b2d` and implements ADR-051's second backup-foundation slice. A pure
`liska-resumability-journal/1` state machine, dedicated extension-origin
IndexedDB adapter and private page own durable bookkeeping without entering
content scripts, provider adapters, service-worker startup, runtime messaging,
destinations, OPFS stages or existing recovery registries. The page can select
one canonical catalog, create only a paused journal, recover/list it and export
one deterministic private snapshot. It exposes no activate, begin, retry,
schedule, delete, provider or network control.

The core enforces exact run/item/attempt revisions, at most one running attempt,
strict dispatch tokens, restart-to-unknown and no automatic retry. The adapter
uses atomic expected-revision CAS and bounded dedicated storage: 16 runs, 2,048
items per run, eight attempts per item, 8,192 total attempts and 8 MiB. Accepted
abort waits for rollback; a too-late abort waits for commit; a missing terminal
event reports only an unknown transaction outcome. Deterministic tests cover
late commits after timeout/close/versionchange, accepted rollback, corrupt
records, limits and two-store conflicts.

Independent core, IndexedDB and page reviews found and closed revision-lower-
bound, late-commit and pre-persistence error-boundary defects. Final integration
review found one production-only Chromium ordering defect: resetting a file
input clears its live `FileList` in place. Selection now owns the `File`
references before reset; the live-list regression passes and the installed file
chooser accepts the real catalog. PR #116 Code Review then found that a running
record could fit the output ceiling without retaining space for its mandatory
interruption outcome. `begin-attempt` now projects exact pause, cancellation and
restart states under the unchanged limit before returning a dispatch token. A
one-byte-below/exact-boundary regression proves rejection without capacity
padding and successful round-trips for every stop path. The current integrated
journal/catalog matrix passes 15 files / 415 tests; TypeScript, formatting, diff checks, production
build, built-page capability checker and service-worker runtime guard pass. The
full coverage run passes 303 files / 10,748 tests with one file / three tests
intentionally skipped: 95.10% statements, 91.66% branches, 98.24% functions and
97.37% lines. Full lint has zero errors and the unchanged 55 warnings; the
production dependency audit reports zero vulnerabilities.

Installed Comet used stable-target inventory SHA-256
`3a652a6cbb991eb8609bd590f64dd77480ca4fa7658fd0079167fc74e0e12db6`;
the final 37,260-byte journal bundle has SHA-256
`de195da7687d66d381246721ddc6fd3ef01e34557564caee8a501d502202d453`.
The page admitted the accepted catalog as 24 unique conversations from 121
valid capture occurrences, created one revision-0 paused journal with zero
attempts, then survived an extension reload that closed the page. Reopening the
page recovered the same 24 paused items from IndexedDB.

The browser saved `D:\Downloads\liska-resumability-journal.json`: 7,366 bytes,
SHA-256
`3d93db2fd8dfee4804584d02d3ef3c1982b2f3e81571ea779b5003d0d20e2c7b`.
Its catalog digest equals the accepted catalog SHA-256
`f3dc0fe282bc8957bb8a8c2c24d42e925a7323b47f266fbdc4405e97707b1f64`;
the production decoder accepted the physical file and the production encoder
reproduced every byte. No archive source, provider page, capture route,
destination, account baseline or scheduler was touched. Provider-specific
discovery remains the next separately evidenced contract, and account-wide
execution still requires an explicit decision. The final 2,789,703-byte
candidate ZIP has SHA-256
`3eb923d22a19eba18c90f804e899affc615463320fa62cbe6cae070ee479fc87`;
its rebuilt `dist` inventory SHA-256 exactly matches the installed-live receipt.

## Provider discovery evidence gate — 2026-11-04

Branch `codex/provider-discovery-evidence-gate` starts from merged journal main
`a17f057` and records ADR-052 without adding runtime code. A source-only audit of
the current ChatGPT and Claude paths found exact single-conversation detail
capture and timestamp-shaped detail fields, but no repository-safe account-list
schema, account/workspace binding, pagination checkpoint, list-level marker
semantics, archive/deletion visibility or rate-limit contract for either
provider. Existing detail timestamps and capture times therefore remain
non-authorizing observations rather than discovery watermarks.

The next proposed evidence pass is bounded to at most three foreground,
read-only list requests for one explicitly chosen provider, signed-in account
and exact workspace/organization, or `personal/no-workspace`. It excludes
conversation detail/body reads, mutations, account-wide traversal, automatic
retries, background work and retention of real titles, IDs, cursors, account
identifiers or response bodies. Ambiguous, mismatched or changed scope stops the
pass. A confirmed switch closes only the current scoped sample; a later sample
for the other scope uses a separate cap and checkpoint. ChatGPT was the initial
recommendation, not a pre-authorized target. No provider page, endpoint or
account was accessed for this documentation slice.

The current operating default is each provider's visibly active main account in
`personal/no-workspace`; normally dormant backup accounts remain untouched until
explicitly selected. A future scope-aware layout may use
`provider/scope-key/conversation-key/capture-id` only after stable provider scope
binding is evidenced. Display names and emails do not own identity, and existing
unbound captures remain `unbound/legacy`; this slice performs no move or
migration. Multiple accounts or workspaces may live as sibling scope roots
without sharing cursors or histories.

## Claude terminal-list evidence checkpoint — 2026-11-05

The user authorized one foreground read-only list experiment against the visibly
active Claude main account and personal scope. A single page reload emitted
three actual same-route list requests, exhausting the request cap without a
pagination gesture. The observed organization/workspace-bound endpoint used
`chat_conversations_v2` with limit 30, offset 0, `archived=false` and strong
consistency. Responses were HTTP 200 JSON with `data` and `has_more`; one sampled
terminal response contained 12 records and `has_more=false`.

The safe retained schema contains conversation UUID, created/updated opaque
tokens, archive/star/temporary/multiplayer flags, model/platform, nullable
project, settings, summary and workspace-upgrade presence. No real scope value,
conversation ID, title, summary, marker, cursor or response body was retained.
The three response bodies were not compared, so same route/status is not claimed
as same content. No conversation detail/body, mutation, archived page, nonzero
offset or provider write was invoked; DevTools was closed after the cap.

ADR-053 admits only an unwired structural contract for the exact observed
terminal active-list page. `updated_at` remains an opaque token with
`same_token`/`different_token`/`incomparable` outcomes; it cannot prove content
change, freshness or justify skipping capture. `has_more=true`, pagination,
archived/deleted/inaccessible visibility, scope switching, rate limits and marker
semantics remain unsupported pending separately authorized evidence.

Branch `codex/claude-list-observation-contract` implements that pure boundary in
`src/update-discovery/claude` without runtime importers. Admission distinguishes
malformed `rejected`, structurally unobserved `unsupported` and exact terminal
`observed_page` outcomes; it projects only a pre-resolved versioned scope key,
lowercase conversation UUID and optional opaque marker. Duplicate IDs reject,
provider order is discarded through deterministic sorting, and comparison never
returns content/freshness language or downstream authority.

The focused observation/comparator/architecture matrix passes 4 files / 176
tests. The full repository coverage run passes 306 files / 10,920 tests with one
file / three tests intentionally skipped: 95.12% statements, 91.70% branches,
98.25% functions and 97.38% lines. The new module reports 99.40% statements,
98.59% branches and 100% functions/lines. Global TypeScript, full lint (zero
errors and the unchanged 55 warnings), Prettier, diff checks, Idea-Threads
validation, 73 documentation-link tests, production build and dependency audit
all pass.

The module is intentionally absent from the production closure: built `dist`
contains zero Claude observation-contract markers and retains the exact installed
65-file / 6,078,286-byte inventory SHA-256
`3a652a6cbb991eb8609bd590f64dd77480ca4fa7658fd0079167fc74e0e12db6`.
The current 2,789,703-byte candidate ZIP has SHA-256
`d3dea7ebd421bea992e4da25dbba1fed7668076ce51e65900de163a5e720ebeb`.

## Post-PR #118 verification/capture boundary — 2026-11-05

PR #118 merged as exact main `4c3ba7e28bcf50a2c011f4024beabfa41d3386e6`
from reviewed head `ee2e34adc2d125cba38a3e98c14e3e314f12b85c`. The catalog,
transactional inert journal and pure unwired Claude terminal-list contract are
accepted foundations, not an account-wide baseline. The source audit confirms
that attempts reserve capture identities and `confirmed` makes an item
`recorded`, preventing another capture attempt in that run. Existing-snapshot
verification therefore stays outside journal v1 under
[ADR-054](docs/adr/054-local-verification-outside-capture-journal.md); no offline
begin/settle driver or provider wiring is added. A future pure reattachment must
bind the exact original catalog digest, provider/conversation/key, manifest
length/digest and existing capture identity, with matching separate from
verification/support and no journal, provider, network or archive mutation.

The full update-driven backup goal remains unfinished. The next choice is
separately authorized Claude pagination/archived/marker/scope/rate evidence with
actual emitted-request accounting, versus a later explicit account-wide
baseline choice after persisted purpose/capture semantics and provider contracts
are reviewed. ADR-053's opaque-token limits remain unchanged; semantic memory
stays later. ITH-007 records E11/D8/T8 and keeps fulfilled catalog/journal/first
Claude evidence separate from future authority. Idea-Threads validation passes
9 threads / 37 relations and documentation-link tests pass 74/74; changed-doc
Prettier and `git diff --check` also pass. No runtime,
provider or archive behavior changes in this slice.

## ChatGPT list-name evidence checkpoint — 2026-11-05

Branch `codex/chatgpt-list-route-evidence` starts from current merged main
`070e6eb0b02f526f5d957964f6daaefebb8014f3` and records
[ADR-055](docs/adr/055-chatgpt-list-route-evidence.md) as documentation only.
One user-authorized observation reached its cap of exactly three actual
list-name requests. On the already-open ChatGPT chat with DevTools opened, the
Network table showed type `Fetch`, HTTP 200 and names beginning
`conversations?`: one fully visible
`conversations?limit=5&owned_only=false`, plus two partial names containing
`exclude_conversation_origin=tpp` and `conversation_origin=tpp&expand=false`.
Unread query suffixes are not wildcard grammar. Method and full URL were not
inspected; `/backend-api/conversations` remains a candidate route-family
inference, not an observed exact path. Trigger causality was not isolated and
the page was not deliberately reloaded for this pass.

Recording stopped after the third matching list-name request; no fourth was
observed before stop. This is neither network-stop nor terminal/completeness
proof. No list row/details, response body or request headers was opened. No real
IDs, titles, account data, bodies or header values were retained, and no mutation
or manual retry was invoked for the pass. Query meanings, route relations,
scope/account binding, ordering, ownership, identity, envelope/record types,
pagination, completeness, cursor, marker and deletion/archive visibility remain
unknown. HTTP 200 does not establish payload suitability.

DevTools attributed the requests to installed AI Exporter `inject-web.js`, but
the exact Comet-installed 4.6.1 source audit found a pass-through fetch observer.
Its ChatGPT callback retains selected header names/values in the extension,
ignores URL/method/body and intercepts no response body; no real values are
repository evidence. Recursive literal search found no candidate list-route or
observed query constructors. Separate singular detail/export fetch code does not
establish list causality. Attribution proves neither extension-created list
requests nor a page-native caller. ADR-055 retains safe byte/hash provenance,
not local absolute paths or the extension ID.

A classifier would encode lexical familiarity without full request grammar,
response schema, identity, pagination, marker evidence or a consumer. No
classifier, parser, source/test/package/generated change or runtime wiring is
added, and provider-specific update discovery has not functionally advanced.
ITH-007 adds E12/E13/D9/T9 without removing prior nodes. ADR-052/053/054 remain
unchanged; the journal is inert, account-wide baseline authority stays gated,
and semantic memory remains later. A next ChatGPT schema pass needs separate
explicit scope, actual-request counting and stop conditions. Even safe aggregate
list response structure requires explicit permission to inspect because this
pass excluded bodies. No further provider request is authorized here.

Idea-Threads validation passes 9 threads / 37 relations; documentation-link tests
pass 75/75. Changed-document Prettier and `git diff --check` pass. This entry is
append-only; no provider, browser or network action was taken for the docs slice.

## ChatGPT native sidebar container evidence checkpoint — 2026-11-06

Branch `codex/chatgpt-native-sidebar-evidence` starts from current main
`4fc0942480fa7eb35b6fcd989ac42ec684cea663` and records
[ADR-056](docs/adr/056-chatgpt-native-sidebar-evidence.md) as documentation only.
In the separately authorized schema pass, the user disabled AI Exporter and one
reload removed its loaded fetch wrapper. DevTools recording started empty and
active. Reload emitted no relevant sidebar list because docked DevTools had
collapsed the sidebar; opening it once was the isolated trigger.

Exactly two matching native `Fetch` requests were emitted, both `GET` 200 and
initiated by a ChatGPT CDN bundle, at exact path
`/backend-api/gizmos/snorlax/sidebar` with `conversations_per_gizmo=0`, opaque
`cursor`, `limit=20` and `owned_only=false`. The two request cursor values
differed; neither was retained. Recording stopped at budget 2/3. The third
allowed request was deliberately unused because scrolling Recent could emit
multiple refetches and overshoot the cap; stop is not network/completeness proof.

Both observed response envelopes had keys `{items, cursor}`: the first-observed
items array had exactly 20 with a string top cursor; the second had exactly 1
with a null top cursor. Both requests already had cursors, the initial boundary
is unknown and exact cursor handoff equality was not retained or proved. These
are not established initial/final account pages or 21 unique records. Every
visible item summary had `{gizmo, conversations}` with nested conversations
`{items: [], cursor: null}` under explicit `conversations_per_gizmo=0`; empty
arrays do not prove that gizmos lack conversations.

One gizmo wrapper in the second-observed null-cursor response was transiently
expanded only for keys/types: `files` and `tools` arrays; nested `gizmo` with
`id` and `organization_id` strings; `has_tpp_conversation` and
`is_space_backing` booleans; `product_features` object;
`project_connector_scope_limits` and `project_file_limits` null. No headers,
cookies, raw response body or real identity values were persisted. Gizmo ID is
not conversation identity, and the organization field is not authenticated
account/workspace binding. Stability, format, coverage and scope semantics remain
unproved.

This exact native sidebar/gizmo-container evidence does not materially advance
conversation discovery: no conversation record ID/type/format, actual list-level
marker, scope binding or conversation-bearing list was observed. A tiny envelope
parser is possible but would be unused evidence scaffolding, so no parser,
classifier or runtime is added. A future diagnostic consumer could justify a
strictly bounded gizmo-envelope parser, not backup progress. ADR-055's older
`conversations?` names and caller-attribution ambiguity are not reinterpreted.
Catalog, inert journal, schemas and runtime are unchanged; account-wide baseline
and scheduler authority remain gated and semantic memory stays later.

ITH-007 adds E14/E15/D10/T10, records the limited fulfillment of T9 and sets
`last_turn` to 2026-11-06 without removing prior nodes. The next gate is a
separately authorized bounded native conversation-bearing list observation with
exact visible account/scope, actual request grammar, conversation identity
field/type/format, pagination fields and an actual list-level marker. Do not
manually change `conversations_per_gizmo`, guess a route or spend the old cap's
unused request. No further provider request or browser action is authorized.

Idea-Threads validation passes 9 threads / 37 relations; documentation-link tests
pass 76/76. Changed-document Prettier and `git diff --check` pass. This entry is
append-only; no source, test, package or generated artifact is changed, and no
provider, browser or network action was taken for this documentation slice.

## ChatGPT conversation-list page evidence checkpoint — 2026-11-06

Branch `codex/chatgpt-conversation-page-contract` starts from base main
`e09278c35c5c033bd8a02e32c88487aae1272add` and records
[ADR-057](docs/adr/057-chatgpt-unbound-conversation-page-observation.md).
During separately authorized broader read-only research, AI Exporter remained
disabled and the matching list requests were initiated by a ChatGPT CDN bundle.
No mutation was invoked; headers and cookies were not inspected or retained, no
raw response was persisted, and no real values were retained.

The expanded pass used a self-imposed soft cap of six actual list requests, but
two ordinary requests at offsets 20 and 40 preceded a UI-scroll burst of six
list routes: eight actual requests total, a two-request overshoot. This was not
a breach of a user-imposed hard cap because the user authorized broader
read-only research; the overshoot against the stated soft cap remains explicit.
Recording stopped after the burst. A UI gesture/Stop button cannot enforce an
actual-request budget, and stopping does not prove network stop or
completeness.

The ordinary route was exact `GET 200 /backend-api/conversations` with
observed query keys/values `exclude_conversation_origin=tpp`,
`expand=false`, `hide_snorlax=false`, `is_archived=false`,
`is_starred=false`, `limit=20`, `order=updated` and offsets
0/20/40/60. Only bodies at offsets 20/40/60 were inspected; each had exact
envelope keys `{items, limit, offset, total}`, integer `limit`/`offset` echoes,
integer `total` and 20 items, with reported totals 41/61/81. These totals are uninterpreted metadata,
not proof of an actual total, next offset, completeness or 81 unique
conversations. Offset 0's response is unsupported and no terminal ordinary page
was observed. One record's field/type inventory, but no values, is retained in
ADR-057; one sample does not prove every record shape.

The final burst also emitted a TPP ordinary-family request and a per-gizmo
conversations request; neither body was inspected. No scope, route-family
union, overlap or deduplication semantics are inferred. ADR-055's name-only
pass and ADR-056's sidebar/gizmo-container pass remain distinct evidence.

The documented contract and source implementation admit a pure synchronous unwired
`observeChatGptUnboundConversationListPage` for the exact inspected
nonterminal ordinary pages at offsets 20/40/60. It projects bounded identity and
optional opaque update-time marker data, leaves scope unresolved and termination
unknown, treats reported totals as uninterpreted metadata, and has no comparator
or derived continuation/completion. The structure materially advances
provider-specific discovery, but does not establish scope binding, marker
semantics, terminal traversal, baseline/capture/scheduler authority or
production closure.

The implementation adds only provider-local source plus focused functional and
architecture tests. Targeted validation passes 2 files / 174 tests. The full
coverage run passes 308 files with one skipped and 11,098 tests with three
skipped: 95.14% statements, 91.73% branches, 98.26% functions and 97.39% lines;
the new module reports 99.37% statements, 98.30% branches and 100% functions and
lines. Global TypeScript, full lint (zero errors and the unchanged 55 warnings),
full Prettier, Idea-Threads 9/37, documentation links 77/77, dependency audit,
guarded production build/ZIP and independent review all pass.

The production closure still contains zero matches for the new schema,
marker-source and function-name strings. Generated `dist` remains 65 files /
6,078,286 bytes. The 2,789,703-byte candidate ZIP has SHA-256
`867c999fa7e8a1b4e6acf4be3e190ece62c3ab5afad9dfc7fba9892aa761ffce`.

## Pure new-capture purpose/evidence contract acceptance — 2026-11-06

Branch `codex/new-capture-purpose-contract` starts from merged main
`b3ce405c74cdf03c228235fbe90350d1c9918ee4` and records
[ADR-058](docs/adr/058-new-capture-purpose-evidence-contract.md). The source
audit confirms that journal v1 has no persisted purpose and that no existing
ChatGPT destination receipt alone can settle new-capture work: the receipt lacks
operation/attempt/provider/conversation, versioned provider-aware key, exact
catalog, purpose, completeness and assurance binding. File evidence observes a
terminal exact requested path without byte readback; Obsidian performs exact
byte-length/SHA-256 readback. Those assurance bases remain distinct.

The new isolated `src/resumability-journal/purpose` module admits only explicit
`liska-new-capture-operation/1` operations and assesses detached
`liska-new-capture-evidence/1` evidence as `consistent`, `insufficient`,
`conflict` or `rejected`. It binds immutable operation/attempt/reserved capture,
provider/conversation/versioned key and catalog identity; canonical nonempty
all-of destinations; destination-specific manifest/artifact commitments; and a
strict graph/message/branch/asset-inventory policy with every asset fetched and
delivered. Missing facts remain insufficient, contradictions are conflicts and
malformed present identity or commitments are rejected.

`consistent` means only internal relation consistency of supplied bounded data.
It authenticates no producer, freshness, account completeness, current durable
existence or manifest contents and grants no settlement, persistence, execution,
dispatch or retry authority. The module has no decoder/migration, runtime,
provider, browser, clock, storage, IndexedDB, UI, build-entry, capture, archive,
baseline or scheduler wiring. Journal v1 is byte- and meaning-unchanged. The
next semantic gate is a separately reviewed exact-producer adapter and
purpose-aware persistence version after sufficient provider evidence and the
user's explicit next-slice authority; no account-wide driver follows here.

Targeted purpose, architecture, existing journal-core and IndexedDB validation
passes 4 files / 304 tests. The full coverage run passes 310 files with one
skipped and 11,213 tests with three skipped: 95.17% statements, 91.77% branches,
98.27% functions and 97.41% lines. The new module reports 98.35% statements,
96.56% branches, 100% functions and 99.66% lines. Global TypeScript, full lint
with zero errors and the unchanged 55 warnings, full Prettier, Idea-Threads at
9 threads / 37 relations, documentation links at 78/78, dependency audit,
guarded production build/ZIP and independent review all pass.

The production closure contains zero matches for the two new schema strings,
the assessment function name and the strict completeness-policy string.
Generated `dist` remains 65 files / 6,078,286 bytes. The 2,789,703-byte
candidate ZIP has SHA-256
`eac4275202139606a92b712aa0896561e514714985247d98cf672d8eee2ed1ff`.
ITH-007 adds E18/E19/D12/T12 and preserves the remaining producer, persistence,
scope, traversal, baseline and scheduler gates.

## Exact ChatGPT producer evidence and unwired adapter acceptance — 2026-11-06

Branch `codex/new-capture-producer-adapter` starts from merged main
`9a83e6d5b84df7f41dfd1fb547665f84db679a49` and records
[ADR-059](docs/adr/059-chatgpt-producer-evidence-adapter.md). The source audit
confirmed that current File and Obsidian sinks already performed the assurance
needed by ADR-058 but discarded it from their legacy result surfaces. File
confirms terminal download plus exact requested archive path without byte
readback. Obsidian performs bounded binary readback and exact length/SHA-256
comparison. The legacy ChatGPT receipt also omits raw/canonical hashes, complete
asset inventory, completeness and operation/admission binding.

The current archive and binary sinks now add an exact optional observation to
their existing result without changing success/error semantics or issuing any
new request. File retains only `browser-download-complete-path-confirmed` and a
safe archive-relative path; Obsidian retains the actually verified readback
length and SHA-256. The versioned `liska-chatgpt-producer-evidence/1` factual
receipt remains separate from the legacy link receipt and records exact
provider/conversation/capture identity, routing-only legacy digest, original
all-of requested destinations, destination-specific raw/manifest/canonical
commitments, completeness, the complete asset inventory and every retained sink
observation.

Evidence is pinned at its actual temporal boundary. Intent is detached before
the first write; archive commitments before dispatch; raw observations
immediately after the early raw write; binary results immediately when binary
persistence returns; and both destination inventories before the first
destination-builder await. Finalization cannot reconstruct or replace missing
raw/binary facts. An independent review found late-mutation gaps in the first
draft; pre-await snapshots and dedicated regression cases resolved that P2, and
the delta review reports ready with no remaining material finding.

The pure unwired `adaptChatGptProducerEvidence` independently verifies both the
legacy `SHA256(UTF8(conversationId))` routing digest and the provider-aware
catalog recipe
`SHA256(UTF8(JSON.stringify(['liska-conversation-key/1', provider, conversationId])))`.
It never substitutes or prefixes one digest into the other. Only receipts with
an immutable intent supplied before the first write can bind operation, attempt,
reserved capture, exact catalog and required destinations. Ordinary manual and
legacy exports remain factual but insufficient or unsupported; they gain no
purpose meaning after capture.

No journal-v1, journal transition, IndexedDB, catalog schema, UI, provider-list,
baseline, scheduler, settlement, retry or permission change is included. The
adapter has no production consumer. The next gate is a separately reviewed
admission/execution handoff that selects an exact catalog, creates the operation
and attempt, reserves capture identity before the provider request and passes
that immutable intent into capture. Purpose-aware persistence remains later and
journal v1 remains unchanged.

Focused parent validation passes 12 files / 424 tests. The full coverage run
passes 311 files with one skipped and 11,268 tests with three skipped: 95.18%
statements, 91.81% branches, 98.31% functions and 97.42% lines. Global
TypeScript, full lint with zero errors and the unchanged 55 warnings, full
Prettier, Idea-Threads 9/37, documentation links 79/79, dependency audit with
zero vulnerabilities, guarded production build/ZIP and independent review all
pass.

The production closure intentionally contains the factual producer schema in
one content bundle and the File/Obsidian assurance markers in the content and
service-worker bundles. It contains zero matches for the adapter function and
both ADR-058 purpose schema strings. Generated `dist` is 65 files / 6,086,099
bytes. The 2,791,772-byte candidate ZIP has SHA-256
`9408a5a82fd3552d74563cd7a105de025167d804633c78711867693f6ece9acd`.
ITH-007 adds E20/E21/D13/T13, records T12 as partially fulfilled and preserves
the remaining admission, persistence, scope, baseline and scheduler gates.

## Catalog-bound ChatGPT capture handoff acceptance — 2026-11-06

Branch `codex/new-capture-admission-handoff` starts from merged main
`b3f6c9deba1781c0ba235f48177e6ef2a7aa5b2e` and records
[ADR-060](docs/adr/060-catalog-bound-chatgpt-capture-handoff.md). The prior
producer-evidence slice required immutable purpose intent before the first
write, while ordinary capture requested provider data before allocating its
capture ID. This slice closes that ordering gap without wiring a baseline.

The exact canonical catalog admission is now a shared data-only core. The
private journal page preserves its existing API, File reader and default crypto
capability, while both paths use the same strict encoder, byte-for-byte canonical
admission, exact catalog hash and provider-aware conversation-key recipe. No
second parser or competing key derivation is added.

Pure `prepareChatGptNewCapture` copies catalog bytes and request data before the
first await, requires exact full-triple ChatGPT membership, validates the strict
conversation/capture-ID contracts, verifies the provider-aware key and builds
one deeply frozen ADR-058 operation/producer-intent pair. Hash dependencies
receive owned bytes; throwing, mutation, invalid digests and cancellation fail
before capture. Independent review found a late nested-microtask cancellation
window after the final key hash; a final synchronous signal check plus a real
prepare-to-executor zero-request regression resolved that P2. Delta review
reports ready.

The separate unwired `capturePreparedChatGpt` executor requires an injected
single request and optional clock. It revalidates the immutable pair and identity
before dispatch, runs the real ChatGPT capture/normalizer/inventory with a
closure returning the reserved capture ID, and verifies the same provider,
conversation and capture identity across manifest, companion, archive and
asset-export context. It exposes no default runtime bridge, alternate normalizer,
resolver observation, retry, second cleanup, destination write, assessment,
persistence or settlement.

The full offline integration traverses exact catalog admission, the real capture
and normalizer, factual producer receipt and adapter. Current real asset
discovery remains `not-attempted`, including zero assets, so the assessment is
honestly `insufficient/completeness-incomplete`; no strict completeness is
manufactured. Ordinary manual capture behavior remains unchanged.

`JournalDispatchToken`, journal v1/core transitions, IndexedDB and UI remain
unchanged and unused. This handoff reserves identity within one immutable object
but proves neither durable uniqueness nor restart-safe dispatch authority. The
next gate is purpose-aware persistence v2 with atomic pre-dispatch reservation,
pause/restart validation, crash/retry semantics and assessment retention without
automatic settlement. Provider scope, account-wide baseline authority and the
daily scheduler remain separate later choices.

Focused parent validation passes 13 files / 433 tests. The full coverage run
passes 312 files with one skipped and 11,310 tests with three skipped: 95.19%
statements, 91.82% branches, 98.31% functions and 97.43% lines. The handoff
module reports 98.11% statements, 97.43% branches, 100% functions and 98.03%
lines. Global TypeScript, full lint with zero errors and the unchanged 55
warnings, full Prettier, Idea-Threads 9/37, documentation links 80/80, dependency
audit with zero vulnerabilities, guarded production build/ZIP and independent
review all pass.

The production closure contains zero matches for the admission, executor and
prepared-handoff symbols, the handoff path and the ADR-058 operation schema.
Generated `dist` is 65 files / 6,086,237 bytes. The 2,791,807-byte candidate ZIP
has SHA-256
`ade0dd52169c1e4aeadbd0f7f812102ab4c2242046d0d98ccc6b4dd7a721b7cc`.
ITH-007 adds E22/E23/D14/T14, records T13 as fulfilled only for unwired
single-capture ordering and preserves persistence, scope, baseline and scheduler
gates.

## Separate purpose-aware v2 persistence acceptance — 2026-11-06

Branch `codex/purpose-aware-persistence-v2` starts from merged main
`94af6fe90f495cc2fee2b426a028c1da719c8b1c` and records
[ADR-061](docs/adr/061-purpose-aware-persistence-v2.md). Journal v1 cannot gain
purpose persistence in place: its exact database contract requires version 1
and one `journals` store, and its token lacks purpose, operation, catalog and
destination semantics. The accepted 21 v1 source blobs remain identical to the
base commit.

The new isolated `liska-resumability-journal/2` uses a separate
`liska-resumability-journal-v2` database, initially version 1, with one bounded
index-free `operations` store. One record owns one immutable ADR-058 operation,
attempt and reserved capture. It retains phase, active/paused control,
open/abandoned disposition and at most one exact factual-receipt/adapter
observation. No recorded, confirmed, settled, completed, retry, reset, delete or
identity-reuse API exists.

Reservation atomically scans the bounded store and reserves operation, attempt
and capture identities across every retained record. `claimDispatch` commits
`in-flight` before releasing an opaque token from the current handle's private
session. Request success is not commit. Timeout, close and version-change abort
requests still wait for the terminal transaction event; a missing terminal event
returns `transaction-outcome-unknown` with no token or automatic retry.

The store uses one constructor-owned hash authority for exact catalog admission,
producer adaptation and read/recovery replay. Exact factual receipts and the
full adapter result are committed by full-snapshot CAS after asynchronous work
outside IDB. Available observations are replayed on every public preflight;
historical hash dependency failure is retained explicitly as the rejected fact
of that moment and is not silently re-evaluated. `consistent` only moves the
record to `awaiting-resolution` and invalidates the dispatch token; it never
settles work.

Independent review found two pre-commit defects. Per-call hash callbacks could
diverge from the read verifier and poison the whole store; the API now accepts
only the store-owned hash. A valid 8,388,606-byte observation could fit yet leave
no room for abandonment; every write now encodes the real pause, restart,
abandon and two-step control paths at full safe-integer revision width. Exact
boundary tests cover 8,388,608 bytes, the next-byte rejection and revision growth
9→10→11. Delta review reports ready with no material finding.

Opening the database is inert. Explicit recovery validates every record before
an atomic write, converts only in-flight records to unknown/restart and is an
idempotent no-op thereafter. Pause and abandonment preserve identity, evidence
and uncertainty. Closing a handle permanently invalidates its token session; a
fresh handle is required after reopen. `checkCurrent` remains a snapshot, not a
lock over a later provider request or an exactly-once guarantee.

A temporary local Vite harness exercised the actual store in native Chromium:
reserve revision 0, claim revision 1, close/fresh-handle reopen, explicit restart
recovery revision 2, evidence/consistent assessment revision 3, second reopen
with the same `awaiting-resolution` record, and deletion of only the unique test
database. The safe receipt reports `ok: true` and `databaseRemoved: true`. This
does not prove quota/eviction or abrupt OS-shutdown permanence.

No v2 module has a production consumer, page, UI, background, provider, baseline
or scheduler connection. The next gate is a separately reviewed single-operation
execution coordinator that owns currentness at the actual provider effect
boundary and defines cancellation/evidence-persistence races. Provider scope,
account-wide baseline authority and scheduling remain later decisions.

Focused parent validation passes 18 files / 514 tests. The full coverage run
passes 318 files with one skipped and 11,372 tests with three skipped: 95.18%
statements, 91.81% branches, 98.32% functions and 97.42% lines. V2 core reports
98.37% statements, 98.03% branches and 100% functions/lines; v2 IDB reports
92.8% statements, 83.82% branches, 98.78% functions and 96% lines. Global
TypeScript, full lint with zero errors and the unchanged 55 warnings, full
Prettier, Idea-Threads 9/37, documentation links 81/81, dependency audit with
zero vulnerabilities, guarded production build/ZIP, native Chromium smoke and
independent review all pass.

The production closure contains zero matches for the v2 schema/database,
factory, token, namespace and receipt-recording API. Generated `dist` remains 65
files / 6,086,237 bytes. The 2,791,807-byte candidate ZIP has SHA-256
`8eb1ce321ea9c68972040a87d1fc8ba8733f3f3a0290e8c2b368e489be62d9f6`.
ITH-007 adds E24/E25/D15/T15, records T14 as fulfilled for the unwired storage
gate and preserves coordinator, scope, baseline and scheduler authority gates.

## One-shot inline execution coordinator acceptance — 2026-11-06

Branch `codex/purpose-execution-coordinator` starts from merged main
`a370036d8e57672b968b1bd60bba0646818a7e30` and records
[ADR-062](docs/adr/062-single-operation-execution-coordinator.md). The prior v2
store committed reservation but exposed a reusable snapshot token check, while
prepared capture awaited identity hashes before the request. The existing
producer also defaulted missing dependencies to resolver recapture,
authenticated fetch and runtime binary sinks.

The v2 store now provides one-use `consumeDispatch`. It burns the session token
synchronously before its first await, serializes an exact committed-state check,
then performs the final same-handle session fence and invokes a generic effect
callback in one synchronous continuation outside IDB. Independent review found
an earlier microtask gap after consume returned, where close/pause/recovery could
invalidate authority before the coordinator resumed. Moving callback invocation
inside the store-owned final continuation plus eight event-order regressions
resolved that P1. Cross-handle DB/network races remain explicitly outside any
exactly-once claim.

The new unwired `createChatGptExecution(...).run()` shares one one-shot promise.
It derives destinations and producer intent only from the prepared operation,
claims the committed reservation, consumes authority inside the real injected
request wrapper and runs the actual capture/normalizer with the reserved ID.
Successful staged responses are rejected before any stage runtime helper, and a
narrow inline-only seam prevents automatic canonical staging. Ordinary manual
staged capture remains unchanged.

The real producer has an explicit no-acquisition mode. Asset-bearing inventory
is retained as `not-attempted`; no resolver observation, recapture, global fetch,
Library/active route or binary sink default can run. The coordinator supplies one
guarded injected archive sink and the real destination builder in inline-only
mode. Cancellation prevents later sink starts but drains already-started work so
late facts remain available.

Coordinator outcomes keep claim, token consumption, request invocation,
capture/partial companion, producer raw facts/receipts, evidence persistence and
uncertainty as independent dimensions. `evidence-recorded` means only that the
store committed receipts and assessment; it never means settled or complete.
Evidence CAS, quota, close and missing-terminal failures retain runtime facts.
`transaction-outcome-unknown` triggers no compensation or retry because the
commit may already exist.

The v2 schema now admits fixed execution uncertainty reasons for cancellation,
capture, producer and evidence-persistence failure. They require resolution and
do not prove whether external effects happened. Shared headroom projections
include every new reason and its pause/abandon paths. No retry, settlement,
delete or baseline state is added.

The coordinator remains inline-only and no-acquisition. Staged handle ownership,
resolver/acquisition routes, binary sinks and crash-durable recovery of late
unpersisted facts remain a separate next gate. No live provider/account action,
UI, page, baseline or scheduler consumer is added; all 21 v1 source blobs remain
unchanged.

Focused parent validation passes 30 files / 799 tests. The broader worker
regression passes 2,408 tests with two skipped across 76 files, including a
separate 1,826-test manual/staged subset. The full coverage run passes 324 files
with one skipped and 11,441 tests with three skipped: 95.19% statements, 91.81%
branches, 98.33% functions and 97.42% lines. The coordinator reports 96.63%
statements, 90.58% branches, 100% functions and 97.22% lines. Global TypeScript,
full lint with zero errors and the unchanged 55 warnings, full Prettier,
Idea-Threads 9/37, documentation links 82/82, dependency audit with zero
vulnerabilities, guarded production build/ZIP and independent review all pass.

The production closure contains zero matches for the coordinator, token
consumption, uncertainty-transition and v2 authority markers. Generated `dist`
is 65 files / 6,086,636 bytes. The 2,791,929-byte candidate ZIP has SHA-256
`a212d9be7745630ce352cb5867fba0f4a523b1bdbe746ac45380e68d3dcc11dc`.
ITH-007 adds E26/E27/D16/T16, records T15 as fulfilled only for unwired
inline/no-acquisition execution and preserves staged/acquisition, scope, baseline
and scheduler gates.

## Explicit staged capture ownership acceptance — 2026-11-07

Branch `codex/staged-acquisition-ownership` starts from merged main
`39914cfe23c1752b1b3b5c7350faa603aeba8273` and records
[ADR-063](docs/adr/063-explicit-staged-capture-ownership.md). The prior
coordinator was inline-only because capture/canonical stage helpers used ambient
runtime messaging and the legacy archive sink owned every stage in a supplied
companion, aborting unselected stages after a raw-only write.

The unwired coordinator now accepts either the existing inline-only transport or
a complete frozen staged capability. The stage port exposes only bounded read,
canonical-stage creation and explicit release; no generic runtime sender is
available. Request-returned leases bind exact operation/attempt/capture,
conversation, artifact kind, stage ID, byte-length/SHA commitment and an opaque
execution token. Duplicate token/stage IDs, commitment mismatch, cross-execution
reuse and late mutation fail closed.

The real admitted capture, raw stage materialization, normalizer, canonical
companion builder and destination archive builder all use the explicit port in
staged mode. Manual callers that omit it keep their existing runtime stage
behavior. Real staged raw above 16 MiB passes; canonical staging paths use an
injected lower threshold while production's 32-MiB threshold is unchanged.

The isolated staged path uses a selected-artifact sink rather than legacy
companion-wide ownership. Selected stages transfer synchronously at sink
invocation and are never released by execution afterward, even on throw,
rejection, malformed response or uncertain completion. Unselected stages remain
execution-owned until their last reader and every started sink drain, then each
releases at most once. An initial canonical stage is not silently destroyed by a
raw-only sink.

Release reports `released`, `deferred` or `outcome-unknown` independently from
capture/write/evidence facts. Cleanup continues after cancellation, while stop
fences prevent every new read, stage creation, sink or evidence effect. Returned
outcomes remove usable-looking live staged companions after cleanup and retain
normalized capture material plus independent ownership/archive-write/cleanup
facts. Partial failures expose no dead lease as recoverable evidence.

Attachment acquisition remains disabled. Asset-bearing inventory stays
`not-attempted`; resolver recapture, global fetch, Library/active routes, binary
stage and binary sink defaults remain unreachable. No durable late-fact spool is
added: these unwired slices retain late facts best-effort in memory, while v2
unknown/no-retry semantics prevent absence from becoming a false no-effect
claim. Temporary stages and download cleanup records are not treated as purpose
evidence.

Independent review reports no material P0-P2 finding. It confirmed exact lease
binding, synchronous transfer and execution-owned single release. Nine added
regressions explicitly cover duplicate lease tokens/stage IDs and nested async
mutation; no source defect was exposed. The root scoped lint also found and
corrected one unused test-fixture binding.

Focused parent validation passes 12 files / 277 tests. The worker broader run
passes 2,450 tests with two skipped across 83 suites, including 52 staged cases.
The full coverage run passes 325 files with one skipped and 11,494 tests with
three skipped: 95.18% statements, 91.81% branches, 98.33% functions and 97.43%
lines. The staged coordinator aggregate reports 94.48% statements, 90.13%
branches, 98.27% functions and 97.79% lines. Global TypeScript, full lint with
zero errors and the unchanged 55 warnings, full Prettier, Idea-Threads 9/37,
documentation links 83/83, dependency audit with zero vulnerabilities, guarded
production build/ZIP and independent review all pass.

The production closure contains zero matches for the staged execution factory,
lease/sink contracts, selected-write API, coordinator and v2 authority markers.
Generated `dist` is 65 files / 6,086,741 bytes. The 2,791,971-byte candidate ZIP
has SHA-256
`1fa09682b28812228b36651dfaddf8de8584db5d8cc84fa7020709c890501a79`.
ITH-007 adds E28/E29/D17/T17, records T16 as partially fulfilled and preserves
acquisition, scope, baseline and scheduler gates.

First-head GitHub review at `2728c65` found one P2 cancellation race after
destination writes: a stop arriving during the evidence pre-CAS read kept the
effect-start fence but could return without attempting the separate durable
`execution-cancelled` transition. The coordinator now attempts that transition
before returning and retains failed/unknown outcomes without retry or
compensation. Current-head focused reruns pass the staged 52/52 and the complete
coordinator 104/104; full coverage again passes 325 files with one skipped and
11,494 tests with three skipped. The current staged coordinator aggregate is
94.51% statements, 89.77% branches, 98.27% functions and 97.81% lines. ITH-007
adds E30/D18 without widening acquisition, provider, baseline or scheduler
authority.

## Explicit ordinary direct PNG acquisition capability — 2026-11-07

Branch `codex/explicit-attachment-acquisition` starts from merged main
`c22aed4cb18b1311033533cd4e1c75a9ce825be1` and records
[ADR-064](docs/adr/064-explicit-ordinary-direct-png-acquisition.md). It adds one
unwired staged-only `ordinary-direct-png/1` attachment policy; omission and the
explicit disabled value preserve inventory-only behavior.

The exact own-data policy is snapshotted before claim and requires one resolver
observation request, one browser-managed fetcher, one single-asset binary sink,
an integer 1 byte–8 MiB limit and an integer 1–30-second timeout. Missing, extra,
accessor-backed, partial or invalid capabilities fail before the provider
request or durable write. The fixed attempt budget is one.

After raw persistence, the real observer matches the complete committed ledger
before filtering. At most one deterministic originally not-attempted PNG with a
conversation-bound nonnumeric direct URL can proceed. Library, numeric-cid,
active, foreign, other-MIME and ambiguous identities remain not attempted. A
new deny-only interpreter helper reports any exact ownership evidence without
returning message/path/provider values and without inheriting state, cardinality
or the dispatch-plan cap; ambiguous merged records and weaker aliases cannot
fall through to ordinary authority.

The real acquisition core retains URL, response, media, bounded stream, PNG,
length and SHA-256 verification. The mandatory fetcher cannot replace those
checks or fall back to global fetch. Verified detached bytes transfer to the
single binary sink at invocation; the sink owns internal staging/cleanup from
that point, and the coordinator never retries, compensates or cleans an issued
write. Unknown/not-dispatched results normalize to unsuccessful facts with no
success observation and conservative cleanup uncertainty.

Stop fences cover the actual resolver request, fetch, binary invocation,
destination finalization and evidence effect. Started work drains and later
effects do not begin. Immutable privacy-safe resolver/acquisition/binary facts
survive canonical-builder and evidence-CAS failure independently from producer
receipts. They contain no signed URL, resolver key, provider ID, token,
message/path value, response body or arbitrary exception.

Independent review found and closed two material seams: ambiguous interpreter
ownership had been confused with an empty dispatch plan, and
unknown/not-dispatched sink outcomes had retained an optimistic public success
fact. Re-review reports ready. The current focused matrix passes 12 files / 614
tests, including 78 policy and 254 resolver cases; TypeScript, scoped lint,
focused Prettier and diff checks pass.

No live capability provider, production import, UI, global/runtime fallback,
numeric/active/Library/interpreter/XLSX/batch support, provider scope,
account-wide baseline, scheduler, retry, settlement, v2 schema or durable spool
is added. Full repository/build/GitHub acceptance remains pending.

Local acceptance is now complete. Full coverage passes 326 files with one
skipped and 11,581 tests with three skipped: 95.16% statements, 91.80%
branches, 98.33% functions and 97.43% lines. The execution-coordinator aggregate
is 93.20% / 88.94% / 98.85% / 97.22%; the new policy is 90.51% / 87.01% /
100% / 95.68%. Global lint has zero errors and the unchanged 55 warnings; full
Prettier, Idea Threads 9/37, documentation links 84/84, zero-vulnerability
production audit and the guarded production build/ZIP pass. Fresh `dist` is 65
files / 6,087,953 bytes with zero coordinator/policy/v2 markers. The 2,792,264-
byte ZIP has SHA-256
`0d45c9359f84bb6420e4b84debaceaaafd8192a19b45f083175c36dfc828f166`.
Current-head GitHub gates remain pending.

## Explicit selected-baseline planning core — 2026-11-07

Branch `codex/resumable-baseline-plan` starts from merged main
`61d644396b6f10c1c36089a355ff5240b80cc6cf` and records
[ADR-065](docs/adr/065-explicit-baseline-plan-core.md). The new isolated pure
module fills the multi-item planning gap between the exact snapshot catalog and
independent purpose-aware v2 operations without adding persistence, provider
requests or execution authority.

Plan creation requires exact canonical catalog bytes plus a nonempty explicitly
selected subset of complete provider/conversation/key triples. It produces
deterministic ordinal plan bytes bound to new-capture purpose, exact destination
assurances, strict completeness and selected-inputs-only coverage. The plan SHA
remains separate and is reverified through injected hashing at every admission,
reducer and projection boundary; catalog loading alone creates no plan.

The versioned data-only checkpoint starts and recovers paused. It retains exact
revision, caller-supplied monotonic time, opaque budget windows, a maximum of 16
reservation-slot charges/links, at most 128 operation observations and optional
explicit cooldown. Clock jumps never roll a window, unknown results never
refund a slot, and explicit rollover cannot make touched items retryable.
Effect-idempotent repeated observations add no link, charge or history entry but
still advance checkpoint revision/time for CAS ordering.

Every operation link revalidates the complete identity triple, catalog digest,
purpose, operation/attempt/capture IDs, destinations, completeness policy and v2
observation replay. Projection requires the caller's claimed complete detached
v2 snapshot. Foreign, missing, duplicate, stale or orphan records stop
conservatively; the pure module cannot prove a never-linked record was omitted.

Progress categories are only untouched, reserved, in-flight-or-unknown,
awaiting-resolution, paused-or-abandoned and conflict. Reserved active operations
block as pending; in-flight/unknown block even when paused or abandoned.
Awaiting-resolution and safely non-in-flight paused/abandoned items remain
touched and non-retryable but may allow a different untouched item. All
assessments, including consistent, require resolution.

Every next decision contains `executionAuthorized: false` and yields either one
deterministic untouched candidate or a fixed stop reason. No-unattempted-items is
not baseline completion. The focused parent matrix passes 19 files / 522 tests;
TypeScript, scoped zero-warning lint, focused Prettier and diff checks pass.
Independent review reports no P0–P2 finding. Architecture tests pin the exact
seven-file module and 24-file pure runtime closure, zero production consumers or
generated markers and byte-identical v2 source blobs; v1 invariants remain green.

No v1/v2 schema/store, IDB, provider discovery, account scope, cursor/marker,
capture handoff, coordinator, live baseline, scheduler, retry, settlement,
deletion or memory layer is added. Full repository/build/GitHub acceptance and a
future separately authorized durable atomic plan/charge/reservation owner remain
open.

Local acceptance is now complete. Full coverage passes 332 files with one
skipped and 11,651 tests with three skipped: 95.22% statements, 91.86%
branches, 98.36% functions and 97.46% lines. The pure baseline-plan aggregate is
99.53% / 99.07% / 100% / 99.74%. Global lint has zero errors and the unchanged
55 warnings; full Prettier, Idea Threads 9/37, documentation links 85/85,
zero-vulnerability production audit and guarded build/ZIP pass. Fresh `dist` is
65 files / 6,087,953 bytes with zero baseline-plan authority markers. The
2,792,264-byte ZIP has SHA-256
`d1f187116b302bc8dafae39796867666c2c1067fac0abf0b6ece75745a0b5bf1`.
Current-head GitHub gates remain pending.

## Durable baseline owner and atomic reservation — 2026-11-07

Branch `codex/durable-baseline-owner` starts from merged main
`de13928e5cc097301487ad5a3cbba611fb268842` and records
[ADR-066](docs/adr/066-durable-baseline-owner-atomic-reservation.md). It adds a
new rollback-isolated `liska-baseline-owner-v1` IndexedDB rather than changing or
opening the accepted v1/v2 databases.

The exact version-1 schema has one fixed-key `owner` store and one `operations`
store, both out-of-line-key and index-free. The bounded binary owner envelope
retains exact canonical catalog bytes, plan bytes/digest and checkpoint bytes.
Operations retain the unchanged canonical `liska-resumability-journal/2` record
format, but belong only to this new owner domain.

Every read scans both complete inventories in one transaction. Preparation,
hashing, observation replay and next-decision work happen outside IndexedDB.
Every mutation then opens one readwrite transaction over both stores, rescans and
byte-CASes the complete inventories, and releases output only after commit. The
checkpoint item link, reservation-slot charge, record observation and revision-0
reserved operation therefore all commit or all abort. Two racing handles cannot
produce two winning reservations.

Creation stores one exact plan and paused checkpoint and refuses replacement.
Fresh handles may inspect but cannot mutate an existing owner until explicit
restart recovery records paused planning. Atomic reservation derives the current
deterministic ChatGPT item, destinations and completeness only from the stored
plan; exact catalog bytes are required again. The caller supplies only fresh
operation/attempt/capture IDs, time and signal. Every result remains
`executionAuthorized: false`; no token or provider callback exists.

Timeout, close and versionchange follow terminal-event discipline. A refused
transaction abort keeps waiting: observed completion returns committed local
facts, observed abort returns failure, and only a missing terminal event fences
mutations with `transaction-outcome-unknown`. Open cancellation retains the
exact upgrade transaction: accepted abort preserves the initiating error, while
a refused or already-committed upgrade returns `open-outcome-unknown`; late
success closes the database without exposing a connection. Reservation
inspection is read-only and never grants retry or replacement IDs.

The owner retains at most 16 lifetime reservation/link/charge triples, 128
observations and 64 windows. There is no pruning, refund, deletion or database
rotation. Existing v2 control-transition headroom is validated both before
operation insert and on read. Active checkpoint states retain one revision for
recovery; pause/recovery may consume the final revision and leave terminal
paused read-only state without wrap/reset.

Independent review found and closed three P2 seams: pause headroom was initially
too strict; a live schema upgrade was not aborted after timeout/close; and the
spec interval after upgrade commit but before queued open success treated a null
transaction as rollback. Final re-review reports ready with no remaining
material finding. The broader parent matrix passes 24 files / 456 tests;
TypeScript, scoped zero-warning lint, focused Prettier and diff checks pass.

This slice intentionally stops after its first reservation: reserved work blocks
the next candidate and no dispatch/evidence writer is exposed. Existing v1/v2/
baseline-plan source remains unchanged. No migration, provider request,
coordinator integration, settlement, retry, deletion, account scope, baseline
runner, scheduler, UI or memory layer is added. Native-browser IndexedDB timing,
full repository/build/GitHub acceptance and a future baseline-owned
runner/evidence adapter remain open.

Local acceptance is now complete. Full coverage passes 338 files with one
skipped and 11,735 tests with three skipped: 95.22% statements, 91.84%
branches, 98.37% functions and 97.45% lines. The durable owner aggregate is
94.98% / 89.07% / 98.92% / 96.66%. Global lint has zero errors and the
unchanged 55 warnings; full Prettier, Idea Threads 9/37, documentation links
86/86, zero-vulnerability production audit and guarded build/ZIP pass. Fresh
`dist` is 65 files / 6,087,953 bytes with zero durable-owner authority markers.
The 2,792,264-byte ZIP has SHA-256
`c69723aed42149f298859c07b044ea861f715925f31157095becff0e90a61714`.
Native-browser IndexedDB timing and current-head GitHub gates remain pending.

## Baseline-owner execution store port — 2026-11-07

Branch `codex/baseline-owner-execution-adapter` starts from merged main
`da517ea7c8fd089f2ed6f19e1f5e30b2021fa951` and records
[ADR-067](docs/adr/067-baseline-owner-execution-store-port.md). The implementation
reuses the accepted ChatGPT coordinator rather than introducing a second effect
orchestration path.

A new internal store-port exposes exactly read, claim, consume, interruption and
producer-receipt methods. Ports are frozen branded factory results with captured
method references; arbitrary accessor/decorated duck types fail admission. A
native wrapper preserves `PurposePersistenceStore` behavior, while a separate
operation-bound owner port delegates to the existing BaselineOwner transaction,
session and token authority.

The owner port binds one exact plan digest, item ordinal/full triple and
operation/attempt/capture IDs plus an explicit monotonic caller clock. Claim
atomically revises the reserved operation to in-flight and appends its latest
checkpoint observation in the same two-store CAS. Only after commit and a final
same-session fence is an opaque WeakMap token minted.

Consume burns the token synchronously before any await, revalidates the complete
owner/operation inventory through a serializing transaction, then checks the
session and invokes the provider callback in the same continuation outside IDB.
Capabilities are at-most-one invocation, not exactly-once external effects; a
different handle may still race after the final transaction and before provider
start.

Interruption, pause/restart and factual receipts atomically update operation
bytes plus the matching checkpoint observation. Interruption pauses planning;
late evidence may move open in-flight/unknown work to awaiting-resolution but
never reactivates or settles it. Closed fixed-code error mapping preserves
transaction/open uncertainty, so the coordinator never compensates or retries an
unknown commit.

Close, versionchange, transaction uncertainty, pause and restart invalidate
tokens/session authority before persistence awaits. Failed pause leaves dispatch
disabled until explicit activation. Restart converts in-flight work to
unknown/restart and pauses planning; already-paused owners with no in-flight work
use a byte-identical recovery CAS and restore neither tokens nor dispatch.

Envelope admission now accepts exact supported lifecycle states, permits
in-flight/unknown as planning stops rather than corruption, and requires the
latest observation revision/digest for every operation. At most one reserved/
in-flight/unknown effect owner is admitted. Headroom is checked on commit and
read: active reserved needs four revisions/three observations, in-flight three/
two, paused unknown one/one and active unknown two/one. Exact MAX tests prove
reserved M−4 → in-flight M−3 → unknown M−1 → awaiting-resolution M through
pause, restart and explicit interruption; insufficient revision/count/64 KiB
states fail before a port is returned.

Operation snapshots are sorted by ordinal operation ID across commit/read/reopen
without changing checkpoint history. After awaiting-resolution, an explicit
separate reserve call may select another untouched item; no automatic loop or
settlement exists.

Independent review found and closed three P2 seams: execution headroom
undercounted mandatory control transitions, read admission omitted that
headroom, and paused unknown M−1 could be stranded by a redundant recovery
revision before late evidence. Final re-review reports ready. The broader parent
matrix passes 35 files / 723 tests; TypeScript, scoped zero-warning lint, focused
Prettier and diff checks pass.

No v1/v2/baseline-plan source, database migration, production consumer, provider
enumeration, automatic runner, scheduler, retry, settlement, deletion, UI or
memory layer is added. Native-browser owner+coordinator timing, full repository/
build/GitHub acceptance and any manual provider binding remain open.

Local acceptance is now complete. Full coverage passes 342 files with one
skipped and 11,814 tests with three skipped: 95.23% statements, 91.84%
branches, 98.38% functions and 97.46% lines. The owner aggregate is 95.63% /
89.70% / 99.24% / 97.03%, the coordinator is 93.93% / 89.54% / 99.05% /
97.53%, and the branded store port is 100% / 97.29% / 100% / 100%. Global lint
has zero errors and the unchanged 55 warnings; full Prettier, Idea Threads 9/37,
documentation links 87/87, zero-vulnerability production audit and guarded
build/ZIP pass. Fresh `dist` is 65 files / 6,087,953 bytes with zero owner/port
authority markers. The 2,792,264-byte ZIP has SHA-256
`62566aca6d3dde098ef1913be46299eabf6bf4b34b2a937df85134fd280b6a67`.
Native-browser timing and current-head GitHub gates remain pending.
