# ADR-044: Durable capture-loss diagnostics

## Status

Accepted for the bounded legacy-provider capture slice.

## Context

Legacy provider extractors can save an honest partial Markdown note while also
reporting non-fatal loss through a toast or the browser console. Those messages
disappear after a few seconds. A pre-fix Gemini image canary demonstrated the
gap: both durable notes correctly omitted the unavailable image and emitted no
false local link, but neither note retained evidence that an identified image
capture had failed.

Persisting the existing warning strings is unsafe. They may contain provider
URLs, exception text, filenames, response details, or localized prose. A body
footer is also a poor fit: ordinary append relies on the message-boundary
declaration being the first nonblank body line and treats the existing body as
user-owned. Extra hidden HTML comments would broaden the final-Markdown gate.

## Decision

Liska records only positively observed historical capture-loss conditions in
two owned frontmatter fields:

```yaml
liska_loss_diagnostics_schema: 1
liska_loss_diagnostics:
  - claude-artifact-content-omitted
  - history-load-partial
  - image-capture-failed
```

Schema 1 has a closed allowlist:

- `claude-artifact-content-omitted` — a recognized visible current Claude
  Artifact frame was present, while its isolated document body was outside the
  authorized extractor boundary and was not included. A hidden, inert,
  dismissed, unrecognized, or absent frame does not qualify and never proves
  that the conversation has no Artifacts;
- `history-load-partial` — the configured history loader explicitly reached a
  partial outcome. For Claude this includes an observed indexed-row gap,
  duplicate/conflicting/noncanonical stable UUID, tail or relative-order
  conflict, unsupported row, unresolved older-history marker, container
  replacement failure or bounded traversal timeout. Claude's identical marker
  shape does not qualify when it sits between or after indexed rows and denotes
  only a later-history virtualization gap. Disabled loading, a missing loader
  configuration, a missing container, or an unknown outcome does not qualify.
- `image-capture-failed` — at least one identified image capture was attempted
  and failed. Intentionally disabled image export, Clipboard image omission,
  and a later destination write failure are different conditions.

The list is sorted and deduplicated. It carries no count, URL, provider text,
filename, exception, or arbitrary warning string. Empty or absent fields mean
only that no schema-1 condition was recorded; they never prove completeness.

The serializer emits the fields independently of optional template toggles and
does not change the Markdown body or its content hash. The background boundary
accepts only an own enumerable bounded array of exact schema-1 codes.

An unsuccessful private image placeholder is not durable presentation content.
Markdown safety may neutralize its `![` opener before a destination sees it, so
File, Obsidian and stripping paths recognize both the literal and neutralized
`g2o-image://` placeholder grammar. The expected line-isolated form is removed.
An anomalous inline, code or HTML-shaped form remains literal so deletion cannot
expose a fence or compose new Markdown/HTML syntax. Neither form is reactivated
as an embed, even if a matching image ID is present.

Destination cleanup reparses only the already size-bounded note body. It
protects every intersecting code, HTML, link, definition and image range, caps
tree traversal at 200,000 scheduled nodes, and preserves unresolved markers on
parse/traversal failure. The traversal cap does not bound the parser's initial
allocation; that remains within the existing note-size boundary rather than a
new streaming guarantee.

Append treats the list as monotonic historical evidence:

- existing and incoming codes merge by set union;
- a later successful attempt does not erase an earlier observed loss;
- an equal-message-count export may update only the owned diagnostic fields
  when it contributes a new code, preserving the body byte-for-byte;
- repeating the same evidence is a no-op;
- a shorter incoming capture cannot attach diagnostics to a longer note;
- malformed, duplicate, unknown-schema, or unknown-code owned blocks fail
  closed and are never silently rewritten.

## Scope boundary

This slice covers capture-time facts known before ordinary note serialization.
It does not claim comprehensive export-loss reporting. In particular:

- File image writes currently happen after the Markdown download;
- Obsidian destination image failures have a different ordering seam;
- Clipboard deliberately strips images;
- canonical-derived HTML has its own structured diagnostics;
- current Claude document-Artifact acquisition would require a separately
  reviewed optional frame permission, freshness proof, bounded parser and
  destination-honest companion contract;
- providers without Claude's exact stable-identity/tail proof still require a
  separate current-completeness contract.

Those cases must not be inferred from schema-1 codes.

## Rejected alternatives

- **Persist warning prose:** leaks unbounded provider/runtime details and makes
  merge semantics localization-dependent.
- **Visible body footer:** changes body hashes and accumulates or moves through
  append in misleading ways.
- **Hidden HTML comments:** requires broadening composer-owned HTML authority
  and still remains invisible to readers.
- **Replace diagnostics on each export:** erases historical evidence and turns
  a bounded observation list into an unsupported current-state verdict.

## Consequences

The durable note can now distinguish “content was saved” from “no supported
loss was observed.” Append can add newly discovered evidence without rewriting
user content. New diagnostic codes require an explicit schema review, producer
evidence, boundary validation, serializer coverage, and append tests.
