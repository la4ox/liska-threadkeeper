# ADR-088: Acquire exact Claude ordinary files from the original-contents route

Status: accepted for exact top-level ordinary files; one installed ordinary-image File/Obsidian path is live-proven, while non-image and Artifact families remain scoped gaps.

## Context

Claude structured detail already inventories attachment metadata but deliberately
left every binary `not-attempted`. A current ordinary image showed why the visible
preview was not sufficient: `/api/{organization}/files/{file}/preview` returned a
smaller WebP derivative, while the Download control separately requested
`/api/organizations/{organization}/files/{file}/contents`. That response declared
the `original` variant and its exact byte length matched the raw `size_bytes`.
Claude then wrapped those bytes in a page-owned `blob:` URL for the browser save.

The original route is therefore available without observing Blob creation,
download history or reusable credentials. The committed detail response already
contains the organization identity, conversation identity, exact top-level
message-file pointers, `file_uuid`, success state and declared size needed to
bind a request.

## Decision

Enable acquisition only when **Export images & attachments** is on and File or
Obsidian is selected. Freeze the organization, conversation and exact route from
the successful structured capture. Admit only top-level
`/chat_messages/{i}/files/{j}` records whose every manifest source reference
rebinds to the same lowercase `file_uuid`, successful provider record and exact
nonnegative declared byte length. Filename, extension, preview URL, DOM position
and nearby metadata are never identity.

Construct only the observed same-origin
`/api/organizations/{organization}/files/{file}/contents` URL. Use authenticated
same-origin GET, reject redirects and any final URL mismatch, require HTTP 200 and
`x-served-file-variant: original`, and require present length headers plus actual
body length to agree with committed raw. Safe response or raw MIME may be kept;
otherwise bytes use the inert `application/octet-stream` path.

Acquisition is sequential: at most 32 attempts, 64 MiB per file, 128 MiB total,
and a hard 30-second deadline per attempted response including body reads.
Unresolved, nested, ambiguous, over-limit and unstarted records remain
`not-attempted`. An attempted transport or integrity failure becomes `failed`.
Distinct raw identities that produce one content-addressed path retain one
deterministic fetched binary; later identities record a stable duplicate-path
failure instead of breaking the destination manifest.

Persist the exact raw companion first. If no destination confirms raw, perform
no binary request. Acquire once, stage bytes through the existing provider-neutral
binary route, then rebuild and write manifest/canonical independently for each
raw-successful File/Obsidian destination. A failed destination write must downgrade
that destination's fetched claim to `failed`; another destination may remain
fetched. Provider IDs, organization IDs, request URLs, headers and Blob URLs are
runtime-only and never enter manifest, canonical or logs.

## Explicit exclusions

- The preview derivative is not an original fallback.
- Message `attachments` without exact `file_uuid`, nested tool content, generated
  Artifact downloads and isolated Artifact-frame bytes are not admitted.
- Legacy Markdown continues to omit attachment blocks; no readable-link or HTML
  presentation authority follows from binary preservation.
- Graph, message and branch completeness remain unchanged. This is not account
  completeness, a scheduler, a resumable account runner or cross-account proof.
- A failed installed run does not authorize automatic retry or route widening.

## Validation

The focused parent matrix passed 199/199 across resolver, acquisition,
normalization, staging, background/offscreen coverage, extraction and bootstrap.
The full matrix passed 13,031 tests with three skipped; its only failure was the
expected exact import-closure pin after adding the pure shared binary descriptor.
After updating that one-file closure, the exact 18-test harness passed. TypeScript,
production build, service-worker runtime validation, Prettier and lint completed
without errors. Independent ordinary review found no material defect.

The installed acceptance exported one chat containing an ordinary PNG and one
historical DOCX. File and Obsidian each contain the same four archive files / 3
directories / 438,165 bytes with exact pairwise hashes. The 312,340-byte fetched
binary matches the separately downloaded original PNG byte-for-byte. Raw length
and SHA match the manifest; canonical input matches the manifest SHA. Durable
JSON contains no organization UUID, contents/blob URL, credential or request
header key.

The old DOCX original request returned an HTTP failure and remains an attempted
failed record with no path, acquired size or hash. This is correct loss evidence,
not proof of general DOCX support or unavailability. The next family gate is a
fresh current non-image original-byte sample; isolated Artifact frames remain a
different decision.

## Related decisions

- [ADR-031](031-loss-aware-archive-pipeline.md)
- [ADR-064](064-explicit-ordinary-direct-png-acquisition.md)
- [ADR-087](087-claude-artifact-archive-route-admission.md)
- [ITH-004](../idea-threads/ITH-004-attachment-acquisition-authority.md)
- [ITH-001](../idea-threads/ITH-001-claude-isolated-artifact-capture.md)
