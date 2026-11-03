# ADR-047: Canonical-derived plain-text presentation

- Status: Accepted; implemented and installed-live-verified
- Date: 2026-11-03
- Accepted: 2026-11-04
- Related: ADR-031, ADR-036, ADR-042

## Context

Liska already emits three different products that must not be conflated:

- exact raw, manifest and `liska-thread/1` canonical archive evidence;
- compatibility Markdown for reading and Obsidian workflows;
- opt-in `liska-html/1` derived reading views for eligible structured captures.

The compatibility Markdown projection intentionally omits or flattens canonical
block families that do not fit its established contract. Renaming that Markdown
to `.txt`, or using it as the input for every later format, would carry those
losses forward without distinguishing source absence from projection omission.

A third-party exporter reference exposes PDF, DOCX, image, Markdown, JSON and
text only after a separate preview and message-selection layer. Liska needs the
same separation of concerns, but its private conversation content must remain
local and its archive evidence must remain append-only.

## Decision

The first new format is an opt-in canonical-derived plain-text reading view.
Version 1 uses these closed contracts:

- renderer/presentation schema and version: `liska-text/1`;
- derived transport schema: `liska-derived-text/1`;
- deterministic output: `index.txt`;
- terminal receipt:
  `presentation/liska-text-1.receipt.json`, schema
  `liska-derived-text-output-receipt/1`;
- synchronized default-off setting: `enableTextExport`;
- background action: `persistDerivedTextPresentation`.

The renderer consumes one already validated ChatGPT or DeepSeek canonical branch,
the SHA-256 of the exact canonical artifact, one exact target node and the
existing tool-content visibility choice. It performs no capture, network access,
destination read, clock read or archive mutation. It is not an archive companion
kind and makes no completeness claim.

Version 1 is limited to current or explicitly selected single-branch File
captures. It does not add all-branches text, Clipboard text, Obsidian text,
Claude/DOM-fallback text, preview selection, PDF, DOCX, image or user-facing JSON.

## Text rendering policy

The output is deterministic UTF-8 text intended for inspection, search and
portable reading. It preserves canonical message and block order.

- Visible user and assistant messages receive explicit role boundaries.
- Plain-text and Markdown block source remains visible as text; Markdown is not
  parsed into a second hidden authority. Every physical source line, including
  provider-controlled metadata, receives the constant `│ ` reading prefix while
  structural headings remain unprefixed. Delimiter-like content therefore stays
  visibly inside its source block instead of impersonating a role or diagnostic.
- Code, provider HTML, reasoning, tool calls/results, execution output and
  provider errors receive explicit inert labels. Tool content follows the
  existing opt-in profile.
- Quotes, citations and attachment references retain useful labels and safe
  visible values without acquiring, opening or embedding new bytes.
- Structural nodes, hidden or non-user/assistant messages, unknown/Canvas
  blocks, empty values and unsupported content produce stable diagnostics or
  placeholders instead of disappearing.

The presentation includes its renderer identity and canonical digest. These
lines establish provenance for the reading file; they do not authenticate the
provider or replace the separate receipt.

## Authorization, bounds and delivery

Text preparation reuses the same architectural boundary as canonical-derived
HTML: exact canonical bytes are independently serialized, bounded, hashed and
matched to retained structured presentation evidence before rendering. Raw
transport fields and legacy Markdown never enter the renderer.

Rendering has explicit ceilings for selected nodes, blocks, source characters,
diagnostics, JSON evidence and final text bytes. Invalid identity, digest,
profile, graph or limits fail with fixed value-free codes. No partial text file
is returned as complete.

Persistence starts only after File has confirmed the matching raw, manifest and
canonical trio. The text write and receipt write have independent terminal
outcomes. Only the browser-confirmed final path, exact UTF-8 byte length and
SHA-256 authorize the receipt. A dispatched-but-unconfirmed write is not retried
automatically; text failure remains presentation-local and never downgrades the
archive or Markdown result.

## Deferred shared preview

This slice deliberately proves one renderer and its delivery seam before a
larger interface is introduced. A later extension-owned preview may build an
immutable selection specification over one canonical branch and expose local
search, message/range selection and Markdown/text/HTML copy or download.

That preview must distinguish “all messages in this branch” from “all branches”,
must not let search mutate selection implicitly, and must not silently attach a
full raw/canonical archive when the user selected only a subset for sharing.
A future `view.json` is a versioned selected presentation, not a renamed
canonical archive.

## Acceptance evidence

The production package and complete repository suite passed after the File
transport admitted exact `text/plain` artifacts without widening the accepted
MIME boundary to parameterized, case-variant, image or script content. The final
suite passed 266 test files and 9,605 tests, with one file and three tests
skipped; production build, TypeScript, formatting and lint completed with only
the repository's existing lint warnings.

An installed Comet capture then persisted the ordinary archive companions,
compatibility Markdown, canonical-derived HTML and the new `index.txt` plus its
terminal receipt. The 46,165-byte UTF-8 artifact contained 822 lines with LF
line endings, 311 visibly framed source lines and 40 message boundaries. Its
actual byte length and SHA-256 matched the receipt, and the receipt's source
digest matched the exact canonical artifact. No private conversation content,
local path or provider URL is retained in this repository evidence.

After the bounded smoke, the user's normal destination settings were restored:
Obsidian and File enabled, Clipboard disabled. The text option remains enabled
as the explicit user choice made for this slice.

## Consequences

The first visible result is intentionally smaller than format parity with other
exporters. It establishes that additional local formats can be added without
turning Markdown into archive truth or weakening File delivery evidence. PDF
and DOCX remain separate renderer decisions because their pagination, fonts,
structure, asset handling and output-size limits differ materially.
Conversation-to-image is not active work while an ordinary browser screenshot
meets the actual need.
