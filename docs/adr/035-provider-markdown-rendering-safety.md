# ADR-035: Provider Markdown is structurally neutralized for reading exports

- Status: Accepted
- Date: 2026-10-24
- Security occurrence: `commit:4aa52b95bddc819189aa49cfe8ef0559`
- Related: ADR-031, ADR-034

## Context

DeepSeek and ChatGPT structured captures retain provider-authored Markdown in
the canonical archive. The legacy reading projection marked assistant content
as Markdown and escaped raw angle brackets, but did not interpret Markdown
images, URI destinations, reference definitions, or Obsidian `[[...]]` /
`![[...]]` syntax. A model response could therefore make the rendered note
request a remote tracking image or a loopback resource. Unsupported schemes and
local-vault embeds also remained active.

The final Markdown cannot be treated as uniformly untrusted plain text. Liska
deliberately creates local archive links after a destination-specific ChatGPT
attachment receipt has been verified. Code examples, footnotes, tables, math,
and ordinary public citations must keep their original Markdown structure.
Raw and canonical artifacts must remain exact evidence rather than inheriting a
presentation sanitizer.

## Decision

### 1. Parse before editing the derived presentation

`contentFormat: markdown` and user-role text pass through one CommonMark parser
at the message-formatting boundary. The parser supplies exact source positions;
Liska edits only syntax proven to be active in that parse:

- every provider-authored inline or reference image becomes entity-literal;
- unresolved image-like prose is neutralized before a later message can supply
  its reference definition;
- nested bracket syntax inside a neutralized image description is made literal
  so removing the outer image cannot expose a new active child;
- links and definitions remain active only for allowed destinations;
- Obsidian wikilinks and embeds in prose become entity-literal;
- fenced, indented, list-contained, and multiline inline code remain unchanged.

Obsidian `[^id]: body` footnotes are distinguished from CommonMark link
definitions even when a single-token body would otherwise satisfy definition
grammar. Active Markdown inside their bodies is still handled by the normal
node policy.

Malformed outer syntax is not trusted as a protective container. Any active
child node that the parser recognizes is still neutralized. A parser failure
falls back to disabling bracket syntax instead of returning the original active
text.

### 2. Link destinations use a narrow policy

The parser's decoded destination is classified, so CommonMark backslash escapes
and character references cannot disguise a scheme or hostname. Reading exports
allow:

- empty and same-note fragment destinations;
- public `http:` and `https:` destinations without user information;
- one exact runtime-proven local ChatGPT archive destination.

Other schemes, relative paths, credentials, loopback, link-local, private,
multicast, documentation-only, and local-name destinations become literal.
Remote images are never activated merely because their URL is public.

### 3. Local attachment authority is receipt-bound

Shape is not provenance. A provider string that merely resembles
`_liska-archive/...` receives no exception.

After raw/canonical identity, capture receipt, destination, asset ledger, hashes,
source references, and exact replacements have all been verified, the ChatGPT
sandbox localizer records only the destinations it actually generated on the
corresponding runtime `ConversationMessage`. The formatter allowlists exact set
membership plus the established content-addressed archive-path grammar. This
runtime field is not copied from provider data and is not written into raw or
canonical artifacts.

### 4. Literal tool evidence remains a separate boundary

Reasoning and tool/search content continues through the collision-safe literal
fence introduced by ADR-033-era security work. It does not rely on this link
policy for safety.

## Consequences

- Raw, manifest, and canonical companions retain the provider payload exactly.
- Safe public links, formatting, math, footnotes, and code remain readable.
- Remote/loopback images and Obsidian embeds cannot become automatic resources
  in the derived note.
- Structured user-role records receive the same active-resource boundary as
  assistant Markdown.
- The production content bundle includes the MIT-licensed
  `mdast-util-from-markdown` CommonMark parser; this trades a modest bundle-size
  increase for parser-equivalent boundaries instead of a bespoke partial
  grammar.
- Actual Obsidian network behavior remains a live-runtime proof gap. Tests prove
  that the generated source no longer contains the active nodes described by
  the finding.
