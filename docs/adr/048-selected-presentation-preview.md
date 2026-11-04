# ADR-048: Selected presentation preview without a second canonical archive

- Status: Accepted; Text/Markdown/HTML selection implemented and installed-live-verified
- Date: 2026-11-04
- Related: ADR-031, ADR-036, ADR-042, ADR-047, ITH-002, ITH-009

## Context

Liska now has one append-only archive authority and several replaceable reading
views. A local preview needs search, explicit message/range selection and
Text/HTML/Markdown copy or download, but a selected excerpt is not another
capture and must not become a reduced canonical graph.

The existing `StructuredPresentationContext.selectedNodeIds` already proves a
complete canonical root-to-target path. Reusing that field for an arbitrary
message subset would destroy its current invariant. Existing output orchestration
is also unsuitable: `handleSync()` validates configured destinations and
`persistExtractedNote()` starts archive-companion persistence before the reading
output. Preview must neither contact Obsidian nor save raw, manifest or canonical
companions merely because the user wants to inspect an excerpt.

Legacy Markdown and canonical-derived HTML/Text currently differ in omission
semantics. HTML and Text omit hidden, technical-channel and non-user recipients;
legacy Markdown does not apply the same gate. Search and selection therefore
cannot use legacy Markdown as their shared source without exposing content that
the other reading profiles intentionally omit.

## Decision

Canonical remains singular and unchanged. Preview creates an immutable
presentation-selection snapshot bound to the exact authorized canonical bytes:

```ts
interface PresentationSelectionV1 {
  readonly schema: 'liska-presentation-selection/1';
  readonly sourceCanonicalSha256: string;
  readonly branchTargetNodeId: string;
  readonly messageNodeIds: readonly string[];
  readonly profile: Readonly<{
    schema: 'liska-reading-profile/1';
    includeToolContent: boolean;
  }>;
}
```

`branchTargetNodeId` identifies one complete canonical path. `messageNodeIds`
is a detached, unique, canonically ordered, nonempty subset of selectable
message-bearing nodes on that path. It never contains DOM ranges, search text,
display ordinals, destination settings or raw/provider authority. Inclusive
range gestures are UI conveniences which resolve to this same explicit ID list.

The snapshot does not rewrite parents, roots, `currentNodeId`, diagnostics or
assets and is never called a canonical archive. A later `view.json`, if useful,
is only a versioned presentation manifest/receipt for the excerpt.

## Shared visibility and search

Preview rows are bounded structured values such as `{ nodeId, role,
presentedText }`, prepared from canonical message/block meaning under the same
reading profile used by the selected renderer.

- Structural nodes and wholly omitted messages are not selectable.
- Hidden, technical-channel and non-user-recipient messages remain omitted even
  when tool content is enabled.
- Tool/reasoning content follows the explicit `includeToolContent` profile.
- Search indexes only the presented row content. It filters/highlights but never
  mutates selection.
- An empty UI selection is allowed; Copy and Download are disabled until a
  nonempty snapshot is committed.
- Changing capture, branch target or reading profile creates a new state and
  invalidates older asynchronous results instead of migrating selection.

The first implementation is Text-only. HTML and a new canonical-derived
Markdown excerpt renderer will consume the same resolved selection later.
Legacy full-note Markdown behavior remains unchanged.

## Capture-only boundary

Preview receives an explicitly authorized capture-only capability. It may use
the current structured capture machinery, but it must not validate configured
outputs, contact Obsidian, persist archive companions, acquire attachments,
write Clipboard/File automatically or enter all-branches delivery.

Supported first routes are ChatGPT current/selected branch and DeepSeek current.
DeepSeek selected branch is not implemented today and remains unavailable
rather than silently falling back.

Structured capture may create temporary staged raw/canonical bytes before the
context is retained. Capture-only orchestration therefore owns best-effort stage
cleanup on success, cancellation, navigation change, missing/invalid context,
all-branches refusal and error. It authorizes the exact canonical length/hash
and path before preparing rows, then keeps only the bounded selected-branch
presentation in memory.

## Surface and lifecycle

The real trusted popup opens one dedicated extension-owned preview surface.
Authority is registered to the exact surface URL, window/tab, source tab/route,
operation generation and settings/profile snapshot; arbitrary extension pages
are not admitted.

Private preview content is transferred once through a bounded in-memory session.
It is never placed in URL parameters, session/local storage, logs or ordinary
status polling. Close, Clear, Stop, expiry, source navigation, identity loss and
worker/session loss invalidate the session and release references. Loss is shown
honestly; content is not reconstructed from storage.

Copy and Download are separate explicit trusted actions over the same frozen
selection. They are labeled as selected excerpts/reading views, include no
archive sidecars or automatic attachment acquisition, and never retry an
uncertain external write. This slice records terminal browser/clipboard outcomes,
not a durable content receipt. If a selection-specific receipt is introduced,
it must bind the selection digest, renderer/version, exact byte length/hash and
source canonical digest; existing whole-capture receipt paths are not reused.

## Implementation sequence

1. Extract the existing capture seam without changing export behavior or
   persistence order.
2. Add one Text vertical slice: capture-only session, bounded rows, local search,
   checkbox/range selection, immutable snapshot, Copy and `.txt` Download.
3. Add selection-aware HTML on the same snapshot without attachment acquisition.
4. Add canonical-derived Markdown on the same snapshot. Do not retrofit the
   selection onto rendered legacy Markdown.

Steps 1–4 are complete. PDF and DOCX start only after this selection/profile
contract is stable; this implementation closes that precondition but does not
combine the two document renderers into the preview contract.
Conversation-to-image stays outside the roadmap while an ordinary browser
screenshot meets the visual-snapshot need.

## Text vertical implementation evidence

The first vertical now implements `liska-presentation-selection/1` and a
detached `liska-text-preview/1`. The preview retains only the source canonical
digest, one branch target, title, reading profile and bounded ordered rows. It
does not retain a canonical object, raw/manifest companions, asset bytes,
provider transport or destination settings. Selection resolves to immutable
canonical node IDs before the selected Text renderer runs.

One extension-owned in-memory protocol binds the initiating popup, exact source
tab/route/document generation and exact preview tab/window/document. The page
gets one bounded payload take and acknowledgement; pending, capture, delivery
and absolute page leases remain distinct. Clear, close, expiry, source change,
worker loss and terminal delivery release the capability and best-effort clean
owned capture stages. The capability allowlist excludes provider probes,
attachment acquisition and every durable output sink.

Installed Comet exposed two browser-specific facts without weakening that
identity boundary. It aliases the same extension page as `comet-extension://`,
and `tabs.update()` may return the previous page while its requested navigation
is still pending. Liska admits only the explicit Chrome/Comet scheme alias with
every byte after the scheme unchanged, then waits at most five seconds for a
fresh read-back of the exact extension ID, fixed path, UUID query and completed
tab. Source capture starts only after that proof. A fixed value-free startup
stage distinguishes window, navigation, registration and source-accept failures
without forwarding native browser details or retrying.

The installed live check opened one current ChatGPT branch as 40 bounded rows
with an empty initial selection. Selecting one row enabled local output actions;
filtering to the assistant role showed 32 rows while preserving the hidden
selected row; Clear reduced the page to zero rows and disabled output. No
Clipboard or File action was invoked, no archive or destination setting changed,
and no private title, message body, conversation ID or path is recorded here.

## Multiformat projection implementation evidence

`liska-presentation-preview/1` is a new detached presentation projection, not an
extension of `liska-text-preview/1` and not a reduced canonical graph. While the
authorized canonical branch is still present, Liska prepares self-contained
Text, Markdown and HTML bodies for each selectable message, then releases the
capture/stages before the one-shot page transfer. The wire projection retains
only canonical digest, branch target, title, frozen profile/renderer versions,
ordered node IDs/roles, the three bounded bodies and finite diagnostics. It
contains no graph topology, canonical messages, source references, extensions,
raw/provider values, asset IDs/bindings/bytes/paths or destination settings.

Preparation and adoption enforce 5,000 rows, 1 Mi UTF-16 characters per row,
8 Mi aggregate characters across every retained format and metadata, and a
12 Mi UTF-8 serialized envelope. Selected output is built only for the chosen
format and is independently capped at 8 Mi characters / 12 Mi UTF-8 bytes.
Parser/source/work accounting is shared across the prepared branch rather than
reset per row. Overflow refuses the preview atomically; it does not truncate,
fall back to Text or recapture.

HTML reuses the canonical block semantics with an empty asset-binding set,
filename-only attachment placeholders, a no-network CSP and selected-row-only
diagnostics. Markdown is generated from typed canonical blocks rather than the
legacy note. Each body is parser-validated as autonomous: raw HTML,
definitions/references/images, unsafe links and unfinished physical fences are
rejected at wire adoption. The captured `enableInertCodeBlocks` boolean remains
part of the immutable presentation profile and the final selected Markdown is
transformed once over the complete document. The existing Text `/1` adapter and
whole-archive HTML bytes remain unchanged.

The page keeps Text-only cards/search in the DOM, adds one trusted Text /
Markdown / HTML selector, and freezes format plus node IDs before the first
await. Copy writes source text; download uses the frozen artifact's exact MIME,
extension and bytes while preserving exact-ID terminal observation and no-retry
semantics. HTML source is never inserted into the extension page.

Installed Comet captured the same 40-row current ChatGPT branch with zero
initial selection. One short user row was selected. Markdown clipboard completed
with 817 UTF-8 bytes and an independently computed digest. HTML Save As remained
honestly `unknown` after its browser-observation deadline, but the same existing
dialog later wrote a separately verified 2,412-byte offline file with DOCTYPE,
CSP, one selected article and no script element. The physical file proves local
bytes, not a retroactive browser terminal receipt. No second download attempt,
archive write or settings change occurred.

## Consequences

The first preview PR is larger than a contract-only change, but it proves the
schema against a real interface and delivery path before freezing it for every
format. The preliminary capture-seam refactor is allowed as a separate
behavior-preserving PR because capture and output persistence are currently
interleaved inside `handleSync()`.

No excerpt can claim archival completeness, and no UI choice can silently cause
full raw/canonical evidence to be shared. The cost is an explicit capture-only
capability, bounded ephemeral session lifecycle and new selection-aware
renderers rather than a shortcut through existing Markdown.
