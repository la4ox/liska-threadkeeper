# ADR-013: Build Reproducibility — Compare Contents, Not ZIP Bytes

## Status

Accepted (2026-06-20). Release mechanics updated by ADR-029 (2026-08-12).
Untrusted-artifact admission updated 2026-11-02.

## Context

The released Chrome extension ZIP is built explicitly with `npm run build:zip`
and attached to a GitHub Release. Maintainers need a way to verify that a local
artifact matches the published artifact — both to catch supply-chain tampering
and to detect toolchain drift between local and CI.

The naive approach — `sha256(local.zip) == sha256(release.zip)` — does **not**
work. A ZIP archive is non-deterministic
across machines for reasons unrelated to the actual build output:

- **Entry order** follows filesystem `readdir` order, which differs between
  macOS (local) and Linux (CI runner).
- **Per-file timestamps** (mtime) are stored in each entry.
- **File mode / uid / gid / OS-creator** metadata is stored per entry.

So two ZIPs of byte-identical `dist/` trees will almost always differ in their
container bytes. (Reproducible Builds project; see References.)

### Verified facts (updated 2026-08-12)

- `build:zip` stages a filtered copy of `dist/` and writes
  `liska-threadkeeper-<version>.zip` with the platform archive tool. The archive
  root is the **contents of `dist/`**, so an extracted ZIP is directly comparable
  to a local `dist/` tree.
- `vite.config.ts` sets no `entryFileNames`/`chunkFileNames` overrides, so
  Rollup emits **content-hashed** chunk filenames. Identical content ⇒
  identical hash in the filename; a content difference surfaces as both a
  filename and a hash-manifest difference.
- A local build run twice on the same machine is byte-identical
  (verified via `--twice`); Vite/Rollup run-to-run nondeterminism
  (vitejs/vite#13071, #13672) is not currently observed here.
- The release build originally ran on **Node 20** while local/CI use **Node
  24**; this was corrected first (see "Prerequisite") because a Node/V8
  mismatch can change Rollup output and make any comparison meaningless.

## Decision

Compare the **extracted file contents**, not the ZIP container.

The tool (`scripts/compare-build.mjs` + `scripts/lib/build-compare.mjs`, exposed
as `npm run compare-build`):

1. Builds locally (`npm run build`) into `dist/`.
2. Queries release asset metadata for exactly one matching
   `liska-threadkeeper-*.zip` asset at most 64 MiB, explicitly targeting the
   product repository from `package.json`. Its API URL must identify that exact
   repository and a positive numeric asset ID. Downloads use `gh api` with the
   pinned asset endpoint, explicit `github.com` hostname and octet-stream Accept
   header; no mutable tag/name is re-resolved after admission. Stdout streams to
   a create-only file through a byte-counting/hash transform: no byte beyond the
   admitted size or 64 MiB ceiling is retained. Success requires child exit 0,
   exact size and matching advertised SHA-256 digest. Stderr capture is capped
   at 8 KiB; a ten-minute timeout kills stalled transfers. Failure aborts streams,
   kills the child and removes the partial file without waiting indefinitely for
   its close event. Missing legacy digests remain compatible. An explicit
   `--ci-zip <path>` skips retrieval, not admission.
3. Inventories the complete ZIP with pinned, Node-only `yauzl@3.4.0` before any
   write, using lazy entries, strict filenames, size validation and an explicitly
   managed open handle. Central/local metadata, portable paths, types, duplicate
   aliases, declared bytes and compression ratios are admitted under fixed
   ceilings. Extraction is sequential, create-only and backpressured; runtime
   expanded-byte/length, ratio and CRC-32 checks accompany SHA-256 hashing. The
   ZIP manifest is computed during extraction, not by whole-file rereads. Local
   manifests use bounded iterative traversal and streamed hashing.
4. Applies the **same
   exclusions as `build:zip`** (`.vite/`, `*.DS_Store`) to both sides.
   Excluded archive entries still undergo every validation and consume all
   budgets; they are extracted for retained diagnostics but omitted from the
   manifest. Local-tree budgets also count excluded files.
5. Diffs the manifests, classifying every difference as `only-local`,
   `only-ci`, or `content-mismatch`. Exits non-zero on any difference.
6. On mismatch, prints a `diffoscope <local> <ci>` hint for human drill-down.

Ceilings: 64 MiB archive/aggregate compressed bytes, 4,096 explicit entries,
32 MiB per expanded file, 128 MiB aggregate expanded bytes, 200:1 expansion,
1,024 UTF-8 bytes per decoded path, 32 path segments, 255 UTF-8 bytes per
segment and 1 MiB aggregate path/metadata admission. Validated test overrides
may only lower these limits. See the [guide](../build-reproducibility.md) for
supported input and failure behavior.

STORE, DEFLATE, empty directories, data descriptors, a single native `./`
prefix and metadata-declared UTF-8 names remain supported. Ambiguous unflagged
non-ASCII codepages are rejected rather than guessed; this includes legacy
Windows `tar` Unicode output. The current ASCII-named producer output is covered
by a native packaging smoke test. Portable-path aliases and unsafe/special
entries are rejected before writing. An operational failure discards partial
trees even with `--keep`, without modifying a caller-supplied ZIP; successful
and mismatching comparisons preserve `--keep` retention and exit codes 0/1/2.

### Rejected alternatives

| Alternative                                                                    | Why rejected                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sha256` of the whole ZIP                                                      | Container metadata (order/mtime/perms) differs across OSes; guaranteed false mismatches.                                              |
| diffoscope only                                                                | Excellent for humans, but not a scriptable pass/fail gate; kept as the drill-down step instead.                                       |
| Make `build:zip` byte-reproducible (`SOURCE_DATE_EPOCH` + normalized metadata) | Stronger guarantee, but adds release complexity. Deferred as a separate, optional future change; not required for content comparison. |

### Prerequisite

Use Node 24 locally and in CI. Without matching Node majors, comparison is
apples-to-oranges. Do not compare against releases built with a different
toolchain and expect equality.

## Consequences

- A reliable, scriptable equality gate that ignores ZIP-container noise.
- The gate itself needs no `diffoscope`; maintainers may install it separately
  for human-readable drill-down when a mismatch occurs.
- GitHub Releases are the supported retrieval path, using metadata admission
  followed by bounded, pinned-asset `gh api` streaming.
- Comparison no longer delegates untrusted extraction to platform archive
  tools or buffers artifact files for hashing. Packaging still uses native tools.
- The exclusion list lives in one place (`isExcluded` in
  `scripts/lib/build-compare.mjs`) and must be kept in sync with `build:zip`
  if the packaging rules change.

## References

- Reproducible Builds — Tools (diffoscope, strip-nondeterminism, reprotest):
  <https://reproducible-builds.org/tools/>
- `SOURCE_DATE_EPOCH` specification:
  <https://reproducible-builds.org/docs/source-date-epoch/>
- Vite non-deterministic build reports: vitejs/vite#13071, vitejs/vite#13672
