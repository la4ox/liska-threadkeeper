# ADR-042: Final reading-Markdown context isolation

## Context

Raw, manifest, and canonical artifacts preserve provider evidence. Markdown is a
derived reading surface and already neutralizes active provider syntax during
ordinary conversation composition. Two later seams were not covered by that
policy:

1. Deep Research appended its References section after HTML conversion and
   bypassed the ordinary final active-Markdown policy.
2. Append mode joined an independently safe new tail to an existing note. An
   old unclosed `<script>`, `<pre>`, HTML comment, or Markdown fence could then
   reinterpret or hide the new messages. A CommonMark reference and its
   definition could also become active only after the two halves were joined.

A synthetic matrix exercised the real composer, append builder, Obsidian
handler, parser, line-ending restoration, and mocked destination. On the
unchanged runtime, 11 of 18 cases demonstrated the gaps: open HTML/fence
contexts activated or swallowed safe tail content, while Deep Research retained
an automatic remote image and private body/References links. Closed contexts,
forged marker reservation, literal HTML, and parser-failure controls remained
safe.

## Decision

1. The complete Deep Research Markdown, including generated References, passes
   through `neutralizeActiveProviderMarkdown`. Provider copies of both Liska
   message-boundary spellings are reserved first. Public HTTP(S) citations stay
   usable; private destinations and remote images become literal. A
   `g2o-image://` placeholder is trusted only when the same conversation owns
   matching captured-image metadata.
2. Append uses a separate refusal-only final-context gate. It is not the
   provider policy and never rewrites the existing note body. It parses the
   exact LF-normalized joined body after destination transforms, then either
   returns that exact string or one fixed, value-free refusal code.
3. Only the newly extracted tail may be callout-flattened. The old body remains
   unchanged under the existing ADR-026 normalization contract. The original
   detected LF, CRLF, or lone-CR convention is restored only after the gate.
4. Exact full-line composer markers in the new tail carry explicit source
   ranges. They must remain standalone parser HTML nodes. Marker-shaped provider
   text, hidden markers, extra markers, invalid ranges, and count mismatches are
   refused.
5. HTML, fenced/indented code, or inline-code nodes may not cross the append
   seam. Unexpected new raw HTML is refused rather than repaired. Effective
   CommonMark link/image references and definitions may not bind across the seam
   in either direction.
6. Parser input is bounded by the existing 32 MiB content ceiling and traversal
   by 200,000 scheduled nodes. Invalid positions, accessors, parser failure,
   cycles, over-budget work, or non-convergence fail with fixed codes and no
   content-bearing diagnostics.
7. A gate refusal is terminal for the existing-note operation. It performs no
   note/image write and never falls through to a fresh overwrite. A genuine
   lookup miss may still create a new collision-safe note under the existing
   contract.

## Compatibility and exclusions

- A zero-message trusted note keeps exactly one format declaration. An empty
  legacy note can gain the declaration as its first non-empty line. A non-empty
  legacy note stays legacy rather than receiving authority midway through its
  body.
- Existing closed user HTML and same-side CommonMark references remain
  untouched. Open or ambiguous contexts now make append fail visibly; the user
  can retain the old note and save a separate fresh snapshot instead.
- The gate models CommonMark. It does not claim complete isolation for
  Obsidian-specific footnotes, math, or third-party plugin syntax. Those remain
  renderer-specific evidence gates.
- The node ceiling applies after the parser's initial allocation. The byte cap
  bounds parser input but does not redefine the product's durable-file-size
  contract.
- A 32 MiB body plus generated frontmatter and image-before-note network failure
  remain explicit characterizations, not promises of a final serialized limit
  or atomic remote writes.
- Raw/manifest/canonical archives, canonical-derived HTML, reconciliation
  bundles, staged transport, and archive receipts are unchanged.

## Verification boundary

The focused final composer/append/gate matrix covers LF, CRLF, lone CR,
astral-offset handling, HTML comments/tags, backtick and tilde/container fences,
trusted and forged markers, cross-seam references in both directions, parser and
hostile-object failures, zero-message recovery, tail-only transforms, immutable
inputs, and no-write refusal. Actual Obsidian rendering and plugin-specific
Markdown semantics remain live follow-up surfaces.
