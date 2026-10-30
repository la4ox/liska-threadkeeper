# ADR-046: Bounded official ChatGPT export ZIP source adapter

- Status: Core-only implementation; not wired to the user interface
- Date: 2026-10-30
- Related: ADR-031, ADR-041, ADR-042, ADR-043, ADR-044

## Context and measured compatibility

A content-free local central-directory inspection of five official exports found:

- archive sizes of 1.05–1.81 GB (0.98–1.69 GiB) and 1,048–2,343 entries;
- DEFLATE only; no descriptors, encryption, directories, exact duplicate names,
  unsafe names, symlinks, comments, or ZIP64;
- four modern archives with exactly six root `conversations-NNN.json` entries
  and root `export_manifest.json`;
- one older archive with five root shards and no manifest;
- selected compressed totals of 67.7–82.3 MB (64.6–78.5 MiB) and expanded
  totals of 477.7–605.7 MB (455.6–577.6 MiB), with a maximum selected entry of
  202.1 MB (192.8 MiB);
- modern manifest size no greater than 600,402 bytes.

Those measurements do not establish archive authenticity, conversation coverage,
or the content integrity of any real export. They justify bounded streaming and
both manifest-present and manifest-absent shard layouts, rather than requiring a
manifest that older official exports do not have. No real export content is part
of the fixtures or this implementation's acceptance evidence.

A separate content-free inventory of nine already unpacked ChatGPT export sets
found four legacy `conversations.json` layouts, one five-shard layout without a
manifest, and four six-shard layouts with a manifest. Conversation JSON was at
the root of every set; nested directories contained other export material. This
confirms that the existing explicit JSON/shard picker remains the primary path
for the maintained archive. The ZIP adapter is additive convenience for a newly
downloaded official container before manual extraction, not a second reader or
source of archive truth.

## Decision

### 1. Adapter, not importer or extractor

`openOfficialExportZip` accepts only an anonymous immutable random-access source
with `size` and `readRange(start, endExclusive, signal)`, an `AbortSignal`, and
optional lower-only limits / trusted streaming raw-DEFLATE dependency. It returns
the existing `officialChunks` **or** `officialSources` shape, plus bounded counts,
declared selected byte totals, and manifest declaration status. Numeric shard
indices are sorted. There is no archive filename input, entry lookup, path listing,
filesystem extraction, network request, settings change, or destination authority.

The existing importer, selection, normalization, delivery, and provenance contracts
are unchanged. JSON semantics remain the importer's responsibility. In particular,
the adapter does not parse conversation JSON, find a target conversation, normalize
raw-only content, or create a replacement completeness claim.

Sources are single-use and sequential. Admission validates all metadata; selected
payload bytes are streamed lazily. Consumers must drain **every** source to EOF,
including sources after a matching conversation, to establish selected ZIP payload
integrity. A shared ordinal cursor advances only at a conversation source's
verified EOF; a later source cannot start while any earlier source is unfinished.
An out-of-order attempt poisons the selection and cancels any active producer.
Returning early from a started source also poisons the remaining sources. Calling
`return()` on a dormant generator does not execute its body: that unstarted return
is observed as an unfinished prior ordinal and poisons the selection when a later
source is attempted. Eager manifest verification does not advance conversation
ordinals. A successful `openOfficialExportZip` is not a payload-integrity receipt.

### 2. Exact layouts and declaration semantics

Accepted candidates are exact ASCII root names only:

- legacy `conversations.json`, without a manifest or shards;
- one or more `conversations-NNN.json` shards, where NNN is exactly three ASCII
  decimal digits, with an optional root `export_manifest.json`.

No wrapper stripping, case recovery, Unicode-path replacement, or path
normalization is performed. Exact raw-name duplicates anywhere in the ZIP are
fatal. Reserved root case aliases and noncanonical numeric shard spellings are
fatal, not additional candidates. Mixed legacy/sharded layouts, manifest-only,
and manifest-with-legacy layouts are rejected.

A present manifest must pass its own ZIP size/CRC checks and the existing
`admitOfficialManifest` parser and exact name-set check before sources are returned.
The status `verified-name-set` means only that this local declaration equals the
selected shard names; it does not authenticate the archive or prove content
completeness. Without a manifest the explicit status is `absent-unverified`, for
both old shards and legacy JSON. Absence is not a failure and is not proof that
the selected files constitute the entire account export.

### 3. Small, fail-closed ZIP32 profile

The profile is single-volume ZIP32, starting with the first local record at byte
zero. Only STORE and raw DEFLATE are supported. Only descriptor and UTF-8 flags
(plus DEFLATE level hints) are allowed. Encryption and unsupported flags, methods,
required versions, ZIP64 sentinels/extras, and Unicode-path extras are rejected.
Unknown benign extras are permitted only with exact framing and no duplicate IDs.
Unix special file types, symlinks, and DOS volume-label records are rejected.
Directory records may be present, but cannot declare expanded content.

PR1 deliberately **does not support ZIP archive comments**. It reads exactly the
last 22 bytes as EOCD, requires zero comment length, and requires the central
directory to end exactly at that EOCD. There is no backwards tail scan that could
read unrelated payload. This restriction matches all five measured exports.
Comments may be added only after separate evidence and a bounded metadata-only
discovery design. Embedded signature-like payload bytes are not scanned or treated
as records; appended/fake EOCDs, extra end records, and ZIP64 locators cannot fit
the required exact partition. Invalid inputs may cause bounded metadata probes
to land in bytes falsely advertised as metadata; the adapter cannot authenticate
the role of bytes before reading them.

The central span and record count are exact. Every central entry and local header
is checked, including names, version, method, flags, CRC/sizes, extras, and extents.
Sorted local extents must cover byte zero through the central-directory start
without overlap, prefixes, padding, gaps, or unaccounted records. Raw paths reject
absolute paths, colons (including drive/ADS forms), backslashes, NUL/control bytes,
empty interior segments, and dot/dot-dot segments. Unrelated names are used only
transiently for structural validation and duplicate detection, then discarded.

Ordinary ZIP32 descriptors are supported for synthetic compatibility coverage:
the descriptor is at the **central-size-derived** compressed end, never found by
scanning payload. The distance to the next local record determines an exact
12-byte unsigned or 16-byte signed descriptor. Its CRC and sizes must match the
central record. Descriptor-mode local CRC/sizes must be all zero or all exactly
matching; hybrid values are rejected. This also disambiguates an unsigned
descriptor whose CRC happens to equal the descriptor signature.

### 4. Budgets and streaming

| Bound                                            |            Hard maximum |
| ------------------------------------------------ | ----------------------: |
| Archive                                          |      `0xffffffff` bytes |
| Entries                                          |                  50,000 |
| Central directory                                |                  32 MiB |
| Raw filename                                     |             1,024 bytes |
| Cumulative metadata reads                        |                  64 MiB |
| Selected compressed total                        |           2 GiB + 2 MiB |
| Selected expanded total                          |           2 GiB + 2 MiB |
| Conversation sources expanded aggregate          | Existing importer 2 GiB |
| Manifest expanded                                | Existing manifest 2 MiB |
| Selected per-entry expansion ratio               |                   200:1 |
| Each source read and exposed decompression chunk |                   1 MiB |

Callers may only lower limits. Arithmetic is safe-integer checked. Declared budgets
are checked before selected payload reads. Every selected stream enforces actual
expanded size and ratio and incremental CRC-32 before successful EOF. Native raw
DEFLATE additionally rejects malformed, truncated, and trailing compressed bytes;
there is no recovery from ZIP corruption. The importer separately retains its
2 GiB aggregate, 100,000-object, 1,000-source, and 64 MiB per-object limits.

Metadata includes the bounded central-directory allocation and bounded individual
local headers, not whole-archive buffering. Only the manifest (at most 2 MiB) is
fully buffered. Unrelated payload ranges are not requested, decompressed, or
hashed. CRC is computed only for selected JSON/manifest payloads, not as an archive
fingerprint. Native `DecompressionStream('deflate-raw')` is feature-detected at use;
absence is an explicit error. No Node module or dependency is added to production.
Native stream internal buffering is runtime-owned; 1 MiB is an API chunk bound,
not a claim about total browser process memory.

The optional inflater is a **trusted** dependency, not a recovery path. It must
consume the exact input through EOF, reject trailing/truncated raw DEFLATE, honor
cancellation, implement backpressure, and yield bounded chunks. The adapter checks
that input EOF was reached and checks output size/CRC, but those checks cannot prove
a malicious inflater's compressed-format correctness.

Each exposed output chunk is copied with `new Uint8Array(value)` before CRC and
yield, not with a potentially overridden subclass `slice()`. Consequently an
inflater may reuse Buffer/subarray backing storage without changing previously
yielded bytes; retained-chunk stability is covered by a regression test.

Abort is checked before/after awaits and between chunks; processing periodically
yields to the event loop. A pending source/inflater that ignores cancellation does
not delay the public abort result. Producers receive cancellation/return requests;
uncooperative injected cleanup is not awaited indefinitely. Native errors and
caller abort reasons never become public messages, causes, or diagnostic details.
Public failures have fixed, content-free codes. No archive names/comments/hashes,
unrelated paths, provider text, or source exception text enter results or logs.

## Verification and first-PR nonclaims

Independent synthetic fixtures use Node zlib and a separately implemented bitwise
CRC, not the production output ZIP writer. Tests exercise legacy and both shard
layouts; manifest exactness; arbitrary entry order; STORE/DEFLATE; signed/unsigned
descriptors; exact byte parity; later-source corruption after an earlier target;
read bounds, backpressure, cancellation and producer cleanup; and structural,
path, size, ratio, CRC, extra-field, flag, method, and error-sanitization failures.
Lowered limits make exact-boundary / boundary-plus-one cases inexpensive.

Composition tests also invoke the unchanged `prepareChatGptReconciliationDelivery`
with fixed canonical web bytes, capture metadata, and SHA-256. For legacy JSON,
manifest-backed shards, and manifest-absent shards, ZIP-produced sources and the
equivalent explicit uncompressed JSON sources produce identical complete delivery
objects: artifact paths and exact bytes, hashes, comparison envelopes, and official
slice/shard provenance. Both normalized delivery and a deliberate raw-only
normalization refusal are exercised. A later shard CRC failure or cancellation
after an earlier valid target produces no delivery result and no hash calls.
The adapter's declaration evidence is deliberately not added to the existing strict
delivery request or persisted provenance schema.

This PR does not enable ZIP selection in the UI, mutate provenance schemas, import
all conversations, extract media, supply an authenticated browser ZIP reader, or
claim live browser acceptance for real private exports. Node 24 native raw-DEFLATE
tests are execution evidence for that runtime, not browser compatibility proof.

Before UI wiring: review this contract and adversarial cases independently; test
the exact installed browser's raw-DEFLATE exact/trailing/truncated behavior and
cancellation/backpressure; verify range reads over an approved local File; measure
memory/responsiveness with the bounded workload; preserve manifest-absent warnings;
and run separately authorized selected-export acceptance. UI and live gates must
not reuse metadata-only measurements as proof that private conversations imported.
