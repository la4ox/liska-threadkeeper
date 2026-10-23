# ADR-033: Append identity uses trusted message boundaries

- Status: Accepted
- Date: 2026-10-24
- Security occurrence: `commit:65c64c5574f08191871348273e586bf6`
- Related: ADR-023, ADR-026, ADR-028

## Context

Append mode used visible Markdown labels such as `**User:**` and
`> [!NOTE] Claude` both as presentation and as message identity. Provider
content can legitimately contain the same bytes. In plain format, a later
append therefore counted attacker-controlled bold labels as earlier messages;
enough lookalikes turned a real extension into a successful zero-message
no-op, while smaller count drift could select the wrong tail.

Parsing the visible Markdown more carefully cannot solve equal bytes with
different provenance. Tool blocks also precede their assistant response, so a
tail beginning at the visible assistant label loses the tool evidence that
belongs to that message.

The saved frontmatter `message_count` is extension-generated and useful for
legacy recovery, but users can intentionally omit it. Existing notes may also
contain callouts flattened to bold labels, CRLF line endings, question headers,
personal annotations, or old provider names. Append must preserve those bytes
and must never turn an identity failure into a full-note overwrite.

## Decision

### 1. New conversation bodies declare a v1 boundary format

Every non-Deep-Research body begins with an invisible HTML comment:

```markdown
<!-- liska-message-boundaries:v1 -->
```

Each complete message group begins with:

```markdown
<!-- liska-message:v1 -->
```

The group contains any tool/search evidence first, then the visible user or
assistant message. Question headings are inside the same group. Tail extraction
therefore starts at the trusted marker and retains all content belonging to the
message.

### 2. Exact sentinels are reserved syntax

Provider/user/tool content cannot create the two exact comments. Formatting
neutralizes those substrings to visually equivalent inert entities, including
inside code. V1 marker scanning deliberately recognizes exact sentinels even
after an unterminated provider fence, because a malformed message must not hide
later real boundaries.

Image placeholder removal and destination-specific image resolution are
composition boundaries: deleting a private `g2o-image://` placeholder could
join surrounding text into an exact sentinel. Those rewrites therefore run
line by line, preserve only pre-existing service marker lines in an already
declared v1 body, and neutralize marker substrings in every other transformed
segment before blank-line collapse or callout flattening.

### 3. Legacy recovery uses structured evidence

For a v1 body, the exact marker count is authoritative. If a visible
`message_count` is also present, both values must agree.

For an unmarked legacy body, a valid extension-generated frontmatter
`message_count` is authoritative. The legacy visible-label scanner may prove
that too few boundaries remain, but extra visible labels cannot increase the
trusted count. This recovers already-poisoned notes while preserving their
existing body and personal annotations.

An unmarked legacy note without a valid count is irreducibly ambiguous. Append
returns `append-message-boundaries-untrusted`, writes nothing, and does not fall
through to the fresh-save overwrite path. A fresh export can create a v1 note;
automatic guessing is rejected.

### 4. Legacy parsing remains compatibility-only

The combined callout/bold-label scanner remains for old notes and retired
provider labels. V1 bodies use only exact message sentinels. Legacy question
header lookback remains unchanged; v1 tails start exactly at their marker,
because their real question header already follows it.

Line endings are still normalized on read, all transforms still run on LF, and
the original ending is restored only immediately before the Obsidian write per
ADR-026.

## Consequences

- Provider Markdown can no longer spoof append identity in newly generated
  notes.
- Legacy poisoned notes with a valid `message_count` append the correct new
  groups exactly once.
- Tool evidence, question headers, image warnings, and personal annotations
  remain attached and preserved.
- The comments are visible in Markdown source but invisible in normal rendered
  output.
- External tooling that removes both comments and `message_count` makes append
  unavailable rather than silently unsafe.
- Existing corrupted duplicate text is not automatically deleted or deduped.
