# ADR-049: Bounded selected PDF as a separate local renderer

- Status: Accepted; automated, packaged and installed-live gates complete
- Date: 2026-11-04
- Related: ADR-031, ADR-036, ADR-042, ADR-047, ADR-048, ITH-002

## Context

The accepted selected-reading projection already provides one immutable,
canonical-order subset of bounded safe Text, Markdown and HTML bodies. DOCX
proved that a document renderer can consume that projection without receiving a
canonical graph, provider transport, attachments, destinations or archive
authority. PDF is still a different product: pagination, embedded fonts,
unbreakable content and physical pages need their own limits and evidence.

Browser print cannot satisfy this contract. User print settings influence the
result, closing a print dialog does not prove that a file was saved, and Liska
would not own exact output bytes for a render receipt. A low-level PDF writer
would provide exact drawing control but require Liska to implement mixed-style
line layout, pagination and list flow itself.

## Decision

Use exact `pdfmake@0.3.13` in one short-lived module worker. The page snapshots
the already adopted preview, title, complete reading profile and ordered
selection before its first await. The worker receives only selected
`{ role, htmlBody }` rows and independent lowering-only limits.

The renderer maps the existing allowlisted safe-HTML grammar into a small typed
PDF model and then into a pdfmake document definition. It is not a general HTML
converter and never inserts source HTML into a DOM. It calls only the buffer
API; pdfmake's own download, print and open helpers are outside the boundary.
The exact returned bytes are admitted, hashed and delivered once through the
existing binary exact-download-ID adapter.

The pinned prebuilt pdfmake closure still contains dormant URLResolver,
FileSaver, open/print and guarded global-discovery implementations. Therefore
the boundary is established by reachability and effects, not by scanning the
bundle for forbidden words: v1 supplies no images, attachments or other
resource URLs, installs a deny-all URL policy before layout, invokes only
`getBuffer()`, and runs in a DOM-less one-shot worker. A regression replaces
`fetch` with a failing spy and proves that a successful render does not call it;
installed Comet CSP execution remains a separate acceptance gate.

The fixed v1 layout is A4 portrait with fixed margins, type sizes and line
spacing. Paragraphs, headings, emphasis, strong text, inline/preformatted code,
lists, blockquotes, rules, line breaks, placeholders and literalized links are
supported. Large paragraphs, lists and preformatted blocks may cross pages;
code is never silently truncated or shrunk to an unreadable size.

## Font and representation policy

The four Roboto files packaged by the pinned pdfmake release are the text faces.
One exact Google Fonts `NotoEmoji[wght].ttf` at commit
`023eedd8780dd254e5905901473ed55e5475ee73` is the explicit monochrome fallback
for common emoji and symbols that Roboto lacks, including the heart and fox used
in real chats. Its Git blob is `c2c26ab612a88a8610ff9cfbb89299bf2aea6c7a`
and SHA-256 is
`de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`.
The worker routes complete grapheme clusters by exact cmap coverage; variation
selectors and ZWJ are admitted only inside an otherwise supported emoji
cluster. It does not read system fonts, fetch a font or resource, use a CDN or
compile a font at runtime. Exact font hashes and coverage form a versioned
policy. A cluster outside both policies refuses the render atomically; missing
glyphs never become silent tofu. The first accepted scope is therefore tested
Latin, Cyrillic, common symbols and monochrome emoji, not every writing system,
CJK or color-emoji presentation.

The current selected safe-HTML grammar has no native table, math, image or SVG
nodes and no asset bytes. PDF v1 therefore has zero native-table, typeset-math
or image authority. Existing literal source and placeholders remain visible,
but the renderer must not reconstruct semantics that the projection did not
retain. This limitation is explicit rather than a reason to acquire assets or
change capture.

## Independent limits

The initial maxima are independent ceilings, not interchangeable allowances:

- 100 selected rows;
- 1 Mi UTF-16 source characters and 150,000 decoded Unicode code points;
- 50,000 tokens, nesting depth 16 and list depth 8;
- 10,000 layout nodes, 5,000 blocks and 15,000 runs;
- 16 code points per atomic emoji grapheme;
- 20,000 code points per preformatted block and 4,000 per source line;
- 100 rendered pages and 8 MiB exact PDF bytes;
- one worker job and a 20-second lifetime covering layout, serialization and
  hashing.

Input and semantic counters are checked before expensive allocations where the
pipeline can know them. Page and byte ceilings are final admission checks and do
not pretend to be a hard JavaScript heap cap. Any limit, missing glyph, malformed
worker reply, cancellation, deadline or renderer error refuses the whole result.
There is no truncation, Text fallback, recapture or automatic retry.

## Artifact, receipt and lifecycle

The PDF artifact and render receipt have PDF-specific schemas. The receipt binds
the source canonical digest, branch target, complete reading profile, selection
digest, safe-HTML/adapter/renderer versions, layout and font-policy versions,
effective limits, input/semantic/layout counts, finite diagnostics, page count,
exact byte length and SHA-256. It contains no saved/delivered claim.

Browser delivery remains a separate receipt with the exact download ID and
terminal success, failure or unknown outcome. A successful render is not a
successful download, and a successful browser download is not independent disk
read-back. The page omits the private branch target from its displayed receipt.

Clear, close, expiry, lease loss and page disposal abort the controller and
terminate the worker. The worker is also terminated after its first admitted or
failed response. Operation token and page epoch reject stale or late results
before Blob creation. One output lock covers textual, DOCX and PDF actions.

## Rejected routes

- Browser print: no exact render bytes or reliable saved-file outcome.
- Remote conversion: transmits private conversation content and adds network
  authority.
- Markdown-first conversion: compounds known presentation loss.
- DOCX-to-PDF: couples two independently versioned projections and receipts.
- Rasterized conversation pages: turns selectable text into images and reopens
  the deliberately deferred conversation-image subsystem.
- General HTML-to-PDF: broadens parser/CSS/resource authority beyond the current
  safe grammar.

The strongest counterargument is that pdfmake cannot prove a hard heap cap while
laying out a document. If the bounded input plus worker termination is
insufficient, if the packaged worker cannot run under the current MV3 CSP, or if
v1 requires pixel-perfect HTML, native tables, typeset math or every Unicode
script, this approach is rejected rather than weakened with a print fallback.

## Acceptance gates

1. Package spike: real Vite module worker, packaged fonts, Cyrillic and
   multi-page content under the installed Comet CSP; the fixed resource-free,
   deny-all buffer path must complete without a network call.
2. Contract and mapper tests: canonical-order selection, mixed runs, nested
   lists, code, placeholders, literal links, missing-glyph refusal and every
   independent limit.
3. Independent structure: PDF parser confirms pages, extracted text and embedded
   fonts; cancellation, deadline, stale replies and a later successful job are
   covered.
4. Visual fixtures: rasterized representative and near-page-boundary PDFs have
   no clipping, overlap, tofu, accidental blank pages or broken page flow.
5. Installed delivery: exact browser terminal outcome and independent physical
   hash match the render receipt; the PDF opens visibly; cancelling Save As
   produces no retry.
6. Regression: Text, Markdown, HTML and DOCX schemas/bytes/lifecycle remain
   unchanged. PDF adds no capture, provider, archive, attachment, Obsidian or
   all-branches authority.

## Sources

- [pdfmake features and browser installation](https://github.com/bpampuch/pdfmake/blob/master/README.md)
- [pdfmake document definition and tables](https://pdfmake.github.io/docs/0.3/document-definition-object/tables/)
- [pdfmake custom-font VFS](https://pdfmake.github.io/docs/0.3/fonts/custom-fonts-client-side/vfs/)
- [Pinned Google Fonts Noto Emoji TTF](https://github.com/google/fonts/blob/023eedd8780dd254e5905901473ed55e5475ee73/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf)
- [Noto Emoji OFL 1.1](https://github.com/google/fonts/blob/023eedd8780dd254e5905901473ed55e5475ee73/ofl/notoemoji/OFL.txt)
- [Chrome extension content security policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Chrome downloads terminal states](https://developer.chrome.com/docs/extensions/reference/api/downloads#type-State)
