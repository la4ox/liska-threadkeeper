# ADR-013: Build Reproducibility — Compare Contents, Not ZIP Bytes

## Status

Accepted (2026-06-20). Release mechanics updated by ADR-029 (2026-08-12).

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
2. Obtains the release artifact with `gh release download`, using the pattern
   `liska-threadkeeper-*.zip` (or an explicit `--ci-zip <path>`), and extracts it
   with the platform archive tool.
3. Builds a `posix-path → sha256` manifest of each tree, applying the **same
   exclusions as `build:zip`** (`.vite/`, `*.DS_Store`) to both sides.
4. Diffs the manifests, classifying every difference as `only-local`,
   `only-ci`, or `content-mismatch`. Exits non-zero on any difference.
5. On mismatch, prints a `diffoscope <local> <ci>` hint for human drill-down.

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
- GitHub Releases are the supported retrieval path, via `gh release download`.
- The exclusion list lives in one place (`isExcluded` in
  `scripts/lib/build-compare.mjs`) and must be kept in sync with `build:zip`
  if the packaging rules change.

## References

- Reproducible Builds — Tools (diffoscope, strip-nondeterminism, reprotest):
  <https://reproducible-builds.org/tools/>
- `SOURCE_DATE_EPOCH` specification:
  <https://reproducible-builds.org/docs/source-date-epoch/>
- Vite non-deterministic build reports: vitejs/vite#13071, vitejs/vite#13672
