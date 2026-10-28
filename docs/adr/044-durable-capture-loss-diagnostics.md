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
  - history-load-partial
  - image-capture-failed
```

Schema 1 has a closed allowlist:

- `history-load-partial` — the configured history loader explicitly reached a
  partial outcome. Disabled loading, a missing loader configuration, a missing
  container, or an unknown outcome does not qualify.
- `image-capture-failed` — at least one identified image capture was attempted
  and failed. Intentionally disabled image export, Clipboard image omission,
  and a later destination write failure are different conditions.

The list is sorted and deduplicated. It carries no count, URL, provider text,
filename, exception, or arbitrary warning string. Empty or absent fields mean
only that no schema-1 condition was recorded; they never prove completeness.

The serializer emits the fields independently of optional template toggles and
does not change the Markdown body or its content hash. The background boundary
accepts only an own enumerable bounded array of exact schema-1 codes.

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
- a current-completeness assessment would require a separate contract.

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
