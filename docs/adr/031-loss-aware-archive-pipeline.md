# ADR-031: Separate Capture, Canonical Archive, and Presentation

## Status

Accepted as the architectural direction on 2026-08-13. The canonical wire
schema remains experimental until it is validated against real and synthetic
ChatGPT graph fixtures.

## Context

Liska currently extracts a selected conversation path into a flat
`ConversationData.messages` array and immediately turns that array into a
Markdown note. That is sufficient for the existing user-visible export, but it
cannot represent a full branch graph, empty structural nodes, ordered tool and
reasoning blocks, general attachments, Canvas history, or unknown provider
fields without losing information.

The local `chat-archive-reader` demonstrates that ChatGPT exports require the
complete `mapping`, including `parent`, `children`, `current_node`, hidden
messages, system and tool nodes, attachments, and provider-specific content
types. It can navigate the graph, but its normalized message model still
flattens structured content into text before Markdown export.

A separate AI Exporter sample inspected during this decision contained 23 flat
message rows with 73 ordered text blocks and 7 attachment blocks. Its Markdown
projection preserved all 73 text blocks but omitted all 7 attachments, message
IDs, model fields, and some timestamps. The JSON contained no parent, child,
current-node, or branch fields. This confirms that a third-party "JSON export"
is not necessarily raw or lossless.

The long-term product may grow beyond a browser export button into a modular
local archive, renderer, synchronization tool, bridge, and scheduler. Those
roles need explicit boundaries before the ChatGPT no-scroll path is added.

## Decision

Every web-provider path will be split into three stages:

1. **Capture** stores source-specific raw artifacts from one conversation.
2. **Normalize** deterministically derives a versioned Liska archive graph.
3. **Present and deliver** derives Markdown, HTML, PDF, Obsidian notes,
   clipboard content, bridge briefs, or future formats from the canonical graph.

Presentation code must not parse provider responses. Provider capture code must
not format Markdown or call Obsidian. Normalizers must remain pure enough to run
against saved raw fixtures without a signed-in browser.

### 1. Raw capture layer

A capture is an immutable, local snapshot of the data available for one
conversation at one moment. It may contain multiple artifacts rather than one
assumed response:

```text
captures/<capture-id>/
  manifest.json
  responses/conversation.json
  responses/other-provider-payload.json
  assets/<provider-or-content-addressed-name>
```

The first browser implementation may download these as separate files. A ZIP or
directory bundle is a packaging decision, not part of the semantic contract.

The capture manifest records:

- provider, conversation ID, capture ID, timestamp, and capture method;
- artifact media type, byte length, SHA-256 digest, and source endpoint name;
- attempted asset fetches and their explicit states: fetched, unavailable,
  declined, expired, or failed;
- completeness claims, warnings, and observed unknown content types.

When possible, response bodies are retained byte-for-byte and hashed before
parsing. Raw snapshots are never overwritten; a later capture creates a new
capture ID.

The raw boundary is deliberately narrow:

- capture only conversation-scoped responses and assets, not the entire page or
  unrelated account state;
- never store cookies, Authorization headers, browser storage, bearer tokens, or
  request credentials;
- treat signed and temporary asset URLs as sensitive source data;
- keep raw output local and do not send it to Obsidian, clipboard, Drive, or any
  other destination by default;
- use an exact provider-host allowlist and require a trusted user action.

An API response is preferred because it can preserve the graph without virtual
scrolling. A DOM fallback remains valid, but its manifest must identify the
capture as `dom-derived` and must not claim unseen branches or nodes are
complete. Saving the whole application HTML is not the fallback default because
it can include unrelated interface and account data.

### 2. Canonical Liska archive layer

The canonical archive is derived data and can always be regenerated from its
referenced raw capture with the same normalizer version. Its working schema is
named `liska-thread/1`.

The provider-neutral envelope contains these conceptual sections:

```json
{
  "schema": "liska-thread/1",
  "archiveId": "chatgpt:<conversation-id>",
  "inputs": [
    {
      "captureId": "...",
      "manifestSha256": "...",
      "normalizer": "chatgpt-web/1"
    }
  ],
  "conversation": {
    "id": "...",
    "title": "...",
    "provider": "chatgpt",
    "url": "https://chatgpt.com/c/...",
    "currentNodeId": "..."
  },
  "graph": {
    "rootIds": ["..."],
    "nodes": {}
  },
  "assets": {},
  "diagnostics": {},
  "extensions": {}
}
```

Each graph node has a stable ID, optional parent ID, ordered child IDs, optional
message, and source references. Empty nodes remain valid structural nodes.
Parent and child links are both retained and checked for consistency.

Each message preserves:

- provider message ID, author role and name, recipient and channel;
- create and update timestamps, status, model, and visibility metadata;
- an **ordered** array of typed blocks rather than one flattened string;
- references to assets, citations, Canvas events, and tool calls/results;
- provider IDs and JSON Pointers back to the raw artifact.

The initial block vocabulary may include text, Markdown, HTML, code, reasoning,
tool call, tool result, execution output, citation, quote, attachment reference,
Canvas event, error, and unknown. Raw HTML remains inert data; escaping and
sanitization happen only in renderers.

Known provider-only fields live under namespaced extensions such as
`extensions.openai`. Unknown structures are not silently converted to a string:
the canonical node records their source type and raw reference, with a bounded
JSON value only when it is safe and useful to retain outside the raw layer.

The canonical schema will not copy every provider's spelling. Instead it keeps
stable semantics plus a crosswalk:

```json
{
  "sourceRefs": [
    {
      "format": "chatgpt.web.history",
      "kind": "message",
      "id": "provider-id",
      "rawPointer": "/mapping/provider-node-id/message"
    }
  ]
}
```

This permits a later official-export importer to map its own IDs and fields to
the same archive without pretending that web responses and official exports
have identical shapes.

Canonical assets are addressed by stable archive IDs and, after download,
content hashes. Signed URLs are not canonical identifiers. The asset manifest
preserves filename, MIME type, size, dimensions, source references, local
artifact reference, and acquisition state without embedding large base64
payloads in the main JSON.

### 3. Presentation and destination layer

Renderers consume only validated canonical archives. Initial graph views are:

- current or explicitly selected leaf as one linear conversation;
- every leaf as a separate document with shared ancestry identified;
- a graph index that links branches and their generated files;
- later, a single branching document if it remains readable.

The branch-view sequence keeps the existing current-branch export as the
one-click default. Its first working slice adds a local chooser whose selected
view targets exactly one declared leaf. Its second working slice writes one
all-branches index plus one complete root-to-leaf Markdown document per
declared leaf. Raw, manifest, and canonical artifacts remain once per capture
and durable destination rather than being copied into every presentation. A
missing `currentNodeId` does not prevent deterministic all-leaf enumeration.
The branch catalog stores only each leaf's target, counts, and unique suffix;
the shared root path is reconstructed lazily while one leaf is rendered and
written. This keeps a long common prefix from being multiplied in memory for
wide voice-chat trees.

Branch selection remains local and happens only after the trusted capture has
produced a validated canonical graph. Provider node identifiers are internal
selection capabilities; all-branch filenames, links, and frontmatter use an
opaque capture identity and the platform origin instead of provider
conversation identifiers. Capture-scoped names prevent selected/all-branch
views from silently overwriting another snapshot. The multi-document mode is
available only to durable File and Obsidian destinations. Clipboard remains a
single-document destination and reports that it skipped an all-branches bundle
instead of flattening or silently truncating it. An index is written to a
destination only after every intended leaf file was confirmed there; otherwise
the user gets a partial-bundle warning and the complete canonical archive stays
the recovery source.

Append, merge, automatic deduplication, and a monolithic branching Markdown
document remain separate later decisions. The initial implementation favors
complete, inspectable snapshots over implicit mutation.

Markdown, HTML, and future PDF are presentation formats, not backup sources.
PDF should normally be produced from the HTML presentation layer. Obsidian,
download, and clipboard are destinations; they do not own extraction logic.
Obsidian Local REST API is therefore optional and is never required to create a
raw or canonical local export.

Future bridge briefs, daily maps, project contexts, and model-assisted summaries
also belong to this derived layer. They must carry provenance pointers back to
canonical message and node IDs. Model output may propose summaries or links but
must never mutate raw captures or silently rewrite the canonical archive.

## Module boundaries

The exact directory layout may evolve, but the dependency direction is fixed:

```text
provider capture adapters
          |
          v
raw capture manifest + artifacts
          |
          v
provider normalizers --> canonical schema + graph validation
                                  |
                                  v
                     selectors / diff / merge
                                  |
                                  v
                     renderers and bridge views
                                  |
                                  v
                 download / clipboard / Obsidian
```

The intended product modules are:

- **Liska Capture**: privileged browser adapters and DOM fallbacks;
- **Liska Archive Core**: schema, validation, graph traversal, diff, and later
  snapshot materialization;
- **Liska Views**: Markdown, HTML/PDF, graph indexes, and bridge artifacts;
- **Liska Destinations**: download, clipboard, Obsidian, and future local stores;
- **Liska Orchestration**: optional scheduler/daemon and diagnostics, added only
  after manual capture is reliable.

Core normalization and rendering should be ordinary deterministic TypeScript,
independent of Chrome APIs. Browser privileges stay at the capture and
destination edges.

Large conversations must not require simultaneous in-memory copies of raw JSON,
canonical JSON, Markdown, and base64 assets. The storage boundary must allow
chunked or staged persistence before archive bundles grow beyond the current
extension-message limits.

## ChatGPT-first implementation plan

1. Define TypeScript types, JSON Schema, graph validators, and small synthetic
   fixtures for old/new ChatGPT graph variants.
2. Add a trusted-click, same-origin ChatGPT capture path that first saves the
   exact conversation response and capture manifest. Verify the live endpoint
   rather than hard-coding an assumed route from memory.
3. Implement a pure ChatGPT raw-to-`liska-thread/1` normalizer. Preserve every
   node, link, ordered block, known metadata field, and raw pointer.
4. Add JSON download as an output independent of Obsidian.
5. Render the current branch from the canonical graph and compare it with the
   existing DOM Markdown output. Keep the DOM extractor as a marked partial
   fallback.
6. Add selected-branch, every-leaf, and graph-index export modes.
7. Acquire and package attachments with explicit completeness diagnostics; then
   cover tool/system nodes, reasoning, citations, Canvas, and Deep Research.
8. Move DeepSeek onto the same canonical core after ChatGPT proves the schema.
9. Add official-export importers and cross-format reconciliation later, using
   source IDs and raw pointers instead of field-name guesses.

PDF, automatic scheduling, a local daemon, archive merging, Bridge/Ariadne
integration, and other providers are intentionally deferred until the first six
steps establish a loss-aware ChatGPT path.

## Verification contract

No personal raw conversation is committed as a fixture. Real captures are
validated locally, then reduced to synthetic or deliberately redacted cases.

For each provider fixture, tests must prove:

- raw artifact hash and manifest consistency;
- absence of request credentials in persisted artifacts and logs;
- exact node count and preservation of source IDs;
- valid roots, current node, parent/child symmetry, and cycle diagnostics;
- ordered block preservation, including interleaved reasoning and tool content;
- explicit retention/reference of unknown content types;
- attachment acquisition states with no silent omission;
- deterministic canonical JSON for the same input and normalizer version;
- correct selected-path rendering and all-branch enumeration;
- safe Markdown/HTML escaping at the rendering boundary.

Live smoke validation must include at least one long ChatGPT conversation with
branches and attachments. Tool/system messages, Canvas, and Deep Research need
separate fixtures because one conversation may not contain every format.

## Consequences

- Liska can preserve information that no current Markdown renderer displays.
- New renderers and destinations do not require another provider scrape.
- Saved raw snapshots can be re-normalized when provider formats or Liska's
  schema evolve.
- Official exports and live web captures can later be reconciled through stable
  source references without forcing identical provider schemas.
- The implementation initially becomes more explicit and produces more than one
  artifact, but format changes and partial captures become observable instead of
  silently destructive.

## Deferred TODO: explicit snapshot deduplication

- [ ] Add a separate, user-invoked archive analysis/deduplication action. The
      default capture path remains append-only: it never overwrites or silently
      deletes an earlier raw, manifest, canonical, or partial snapshot.
- [ ] Show an exact preview before cleanup: snapshots considered equivalent,
      evidence that would remain, estimated space recovered, and every path selected
      for removal. Any deletion requires a distinct confirmation.
- [ ] Preserve at minimum the first capture, latest verified capture, meaningful
      graph-change checkpoints, and partial/failure evidence useful for diagnosing
      provider drift or normalizer regressions.
