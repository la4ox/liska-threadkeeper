# ADR-034: Citation Markdown requires provenance and safe destinations

- Status: Accepted
- Date: 2026-10-24
- Security occurrences: `commit:cb0e9bb83f88819181f8a884fdf468a9`,
  `commit:1972e53d5bbc81918ded9e6b8bd3b4d7`
- Related: ADR-031

## Context

NotebookLM and Perplexity turn provider citation DOM into internal
`data-footnote-ref` and `data-footnote-def` placeholders. Custom Turndown rules
then emit native Markdown footnotes. Gemini and Claude Deep Research use the
same Markdown title policy but build a References section directly.

The old contract treated the attribute name itself as proof that a placeholder
was extension-generated. Provider HTML could carry the same attributes and
reach verbatim Markdown rules, including the independent table serializer.
NotebookLM's fallback also accepted arbitrary visible text as a footnote label.

Research source URLs were checked for an HTTP(S) scheme but the original string
was then placed inside `](...)`. A valid URL containing `)` could close that
destination and create a second Markdown node. Canonical URLs may also retain a
literal backslash in query or fragment text, where CommonMark consumes it as an
escape or prevents link parsing.

## Decision

### 1. Internal footnote placeholders carry a per-run capability

One 128-bit random token is created inside the content script's isolated module
graph. Extension-created reference spans and definition paragraphs carry that
token alongside a strictly validated label. Supported labels are:

- Deep Research: decimal source index (`N`);
- message citations: `m{messageIndex}-{sourceNumber}`.

The token is temporary transformation state. It is consumed before final note
generation, never written to Markdown, and is intentionally different in an
independently loaded module graph.

Turndown's normal ref rule, definition rule, and custom table path require both
valid label grammar and the exact runtime token. A missing, guessed, stale, or
cross-realm token receives no footnote authority.

### 2. Untrusted marker-like DOM remains visible but literal

Sanitization may retain the internal attribute names so generated placeholders
survive DOMPurify. Provenance is enforced at interpretation time, not by the
attribute allow-list alone.

Elements with marker-like attributes but no valid capability are serialized as
entity-literal visible text. The same rule applies inside tables, including
non-`SPAN` carriers and forged definitions. Content is not silently discarded.

### 3. NotebookLM fallback labels are numeric-only

The normal ARIA form already supplies a numeric prefix. When that form is
absent or malformed, the visible button text must itself be decimal digits;
otherwise the citation is dropped. Titles continue through the shared
single-line Markdown link-text encoder.

### 4. HTTP(S) destinations use one shared serializer

NotebookLM/Perplexity footnotes and Gemini/Claude Research References share the
same HTTP(S) serializer:

1. trim and parse with `URL`;
2. reject every non-HTTP(S) scheme;
3. emit canonical `href`;
4. percent-encode literal backslashes and parentheses required by Markdown
   destination grammar;
5. preserve already encoded `%5C`, `%28`, and `%29` without double encoding.

Unsafe URLs retain the existing title-only fallback. URL deduplication, source
ordering, unreferenced Research sources, and richer-title upgrades remain
unchanged.

## Consequences

- Provider DOM cannot opt itself into extension-only footnote rules.
- Malformed labels cannot terminate ref/definition grammar.
- Research URLs remain one link destination and cannot append an image or link.
- Final Markdown remains deterministic despite the runtime capability token.
- Root origins are canonicalized with a trailing slash; this is URL-equivalent
  and matches the existing Perplexity behavior.
- Live provider-role control and actual Obsidian network loading remain runtime
  proof gaps; the exported active syntax is closed independently of them.
