# ADR-036: Canonical-derived HTML presentation

Status: Accepted

## Context

Liska's readable outputs are currently Markdown presentations. Structured
ChatGPT and DeepSeek captures also preserve an exact raw response, a
credential-free manifest, and a validated `liska-thread/1` canonical graph.
The compatibility Markdown projection is intentionally lossy: it retains the
established user/assistant reading view and reports block families that do not
fit that contract.

HTML must not be reconstructed from that Markdown. Doing so would turn a known,
reported compatibility loss into the input of a second format. It would also
make later attachment localization depend on rendered text rather than the
destination's verified archive receipt.

## Decision

HTML is a derived presentation of one already validated canonical branch. The
renderer accepts:

- one immutable `liska-thread/1` archive;
- one exact target node, defaulting to the canonical current node;
- the SHA-256 of the exact canonical artifact used as its source;
- a versioned presentation profile;
- an optional, separately finalized set of destination-owned asset bindings.

The renderer returns a `liska-html/1` document plus deterministic diagnostics.
It never captures provider data, reads a destination, performs I/O, consults the
clock, or mutates raw, manifest, canonical, or receipt objects.

HTML is not an archive companion kind. Raw, manifest, and canonical artifacts
remain the fixed archive-core trio. A later persistence layer may write HTML as
a sibling derived artifact only after the destination has finalized that trio.
The derived output must bind its source canonical digest and, when present, its
asset-binding digest. It must not reopen or rewrite archive evidence.

## Visibility policy

The default profile mirrors the existing reading contract:

- user and assistant messages are eligible for visible presentation;
- non-user/assistant message bodies remain canonical-only and produce aggregate
  diagnostics rather than newly visible content;
- reasoning, tool calls/results, execution output, and provider errors are
  visible only when the existing tool-content option is enabled;
- Canvas and unknown provider payloads are labelled as preserved canonical
  evidence, never emitted as executable or raw interactive content.

This policy can evolve through an explicit profile version. A richer renderer
must not silently reveal content that the selected profile keeps hidden.

## HTML safety policy

All canonical strings are untrusted presentation input.

- Text and attributes are escaped.
- Markdown is parsed and rendered through an explicit safe node policy.
- Markdown images are inert references unless an exact finalized local asset
  binding authorizes a local image.
- Provider HTML is never inserted as markup. Version 1 renders escaped source in
  a labelled inert block and records a diagnostic.
- HTTP(S) citations may become user-clicked links only when they contain no
  embedded credentials. Unsafe or unsupported destinations remain visible text.
- Scripts, forms, frames, objects, base URLs, meta refresh, remote fonts, remote
  media, and automatic network requests are absent.
- A restrictive CSP is defense in depth; it does not replace escaping or the
  structural renderer policy.

Every canonical block is either rendered or represented by a stable explicit
placeholder/diagnostic. Unsupported AST nodes and block variants do not vanish.

## Asset bindings

Asset bindings are destination evidence, not canonical fields. A binding can be
used only when it agrees with one canonical fetched asset on opaque asset ID,
lowercase SHA-256, media type, byte length, and exact content-addressed relative
path. Paths are confined to the export bundle and cannot contain traversal,
absolute roots, provider filenames, URLs, or identifiers.

Only inert PNG, JPEG, GIF, and WebP bindings may produce a local `<img>`.
Other explicitly supported verified binaries may produce local download links.
SVG, HTML, scriptable documents, and unsupported types never become embedded
active content. Missing or invalid bindings produce labelled references.

The pure renderer checks structure and canonical agreement. The caller remains
responsible for proving the binding set and digest from the destination's exact
finalized receipt and persisted bytes.

## Resource bounds and failure

Rendering has explicit limits for selected graph nodes, messages, blocks,
source characters, Markdown AST nodes/depth, serialized JSON evidence, asset
bindings, diagnostics, and final HTML bytes. An invalid archive, target,
digest, binding, or exceeded limit fails with a stable value-free code. It does
not substitute the legacy Markdown projection or emit a partial document as a
complete one.

## Delivery sequence

1. Land the pure renderer, contract, adversarial fixtures, and deterministic
   diagnostics.
2. Preserve provider-neutral structured presentation context for ChatGPT and
   DeepSeek without reconstructing it from Markdown.
3. Add opt-in File delivery after archive-core finalization. Existing Markdown,
   Clipboard, and Obsidian behavior remains unchanged.
4. Add destination receipt bindings and offline bundle verification.
5. Extend branch-bundle delivery only after aggregate HTML work/write budgets
   and cancellation semantics are demonstrated.

## Deferred decisions

Automatic PDF generation is not part of `liska-html/1`. Browser printing is a
user workflow, not verified PDF persistence. A PDF slice must separately choose
an engine/transport and prove cancellation, fonts, CJK, math, pagination,
offline assets, byte limits, and terminal write confirmation.

Also deferred: provider visual cloning, remote embeds, active HTML/SVG,
interactive Canvas replay, arbitrary attachment conversion, and archive schema
changes made only for styling.

## Consequences

The first HTML output is intentionally conservative. Its value comes from
preserving canonical order and structured code, quotations, citations, tool
evidence selected by policy, and explicit loss diagnostics—not from imitating a
provider UI. The separation keeps archival truth append-only and allows HTML,
PDF, or future views to evolve without changing captured evidence.
