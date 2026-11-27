# ADR-087: Admit Claude Artifact archives from an exact selected route

Status: accepted for the final installed candidate and one bounded current-personal manual baseline; no account-completeness, scheduler, or isolated-frame capture claim.

## Context

An ordinary selected Claude Artifact can share the legacy `#markdown-artifact`
surface while its URL carries a distinct Artifact-selection suffix. The first
candidate fell through to the legacy Deep Research report path. After it used
structured detail, background sender validation still rejected the selected
route for both inline and staged archive-companion persistence because the
query/hash were not admitted. Markdown survived, but archive companions did not.

The live issue was route admission, not a reason to read the Artifact iframe.
The isolated provider frame remains a separate source whose bytes are not
captured by this decision.

## Decision

Use one shared literal classifier in the Claude extractor and background
sender validation. It admits either the clean conversation route or the exact
Artifact-selection form: a lowercase UUID conversation path, one lowercase UUID
Artifact query, and an optional lowercase 8-4 hexadecimal fragment. It rejects
normalized, malformed, or extra route variants. Archive companion writes still
require the top frame and a same-origin Claude document; existing abort cleanup
is unchanged. The same route admission covers inline and staged archive writes.

On a strictly selected Artifact route, prefer structured detail and preserve the
stable isolated-frame omission. If organization evidence is missing, detail is
null, or detail capture errors, retain ordinary transcript fallback. A genuine
legacy Deep Research report remains preferred when no strict Artifact-selection
route is present, even if a separate frame is visible. Do not read the
cross-origin iframe, add permission/network authority, or infer attachment
bytes.

## Consequences

The final installed Artifact canary retained one capture identity and produced
raw, manifest, and canonical companions in both File and Obsidian; their
per-capture hashes and lengths matched. The current-personal manual catalog had
12 targets: all 12 have raw/manifest pairs; nine nonempty targets also have
canonical/Markdown, while three truly empty targets have only raw/manifest.
The assembled snapshot is 42 files / 2,187,461 bytes. The latest capture set
was copied preserve-only outside the repository, and File/Obsidian copies
matched hashes and lengths per capture.

Attachments and isolated Artifact-frame bytes remain not-attempted/omitted.
`accountComplete` is false. No branch enumeration, provider-completeness,
scheduler, or cross-account claim follows from this manual bounded sequential
baseline. It does not satisfy the future owner-bound resumable account runner.

## Validation and artifact identity

The exact final installed build was rebuilt after the final source diff; the
distribution contains 66 files / 6,205,578 bytes. The ZIP is 2,822,822 bytes
with SHA-256
`517b396cc94231baa68dc5d739ddecb64497f4cf202c6c5f202a10ac189c8ff6`. The
previous installed build was preserved separately for rollback.

The focused worker suite passed 1,105/1,105 plus 12 auto-scroll checks; the
parent focused suite passed 367/367. TypeScript, lint, Prettier, diff checks,
production build, and service-worker runtime validation passed; independent
review was ready. The full matrix finished with 12,998 passed / 3 skipped and
six timeouts in one unrelated native lifecycle harness under concurrent load;
that exact harness passed 65/65 in isolation. The final live canary returned
raw/manifest/canonical for the same capture in both destinations, and all 12
latest captures reconciled.

## Next gate

Run a fresh installed ChatGPT scope and regression pass. A future owner-bound
resumable account runner and separate Claude binary-attachment/Artifact-frame
capture remain later, distinct work. No automatic account runner or full
provider completeness is claimed.
