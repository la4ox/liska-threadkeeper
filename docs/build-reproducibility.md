# Build Reproducibility — Comparing Local vs CI Builds

This guide explains how to verify that the extension ZIP you build locally has
the same file contents as a ZIP attached to a GitHub release.

For the design rationale, see
[ADR-013](adr/013-build-reproducibility-comparison.md).

## TL;DR

```bash
# Compare your local build against the latest release zip
npm run compare-build

# Compare against a specific release tag
npm run compare-build -- --tag v3.0.0

# Compare against a zip you already downloaded
npm run compare-build -- --ci-zip ./liska-threadkeeper-3.0.0.zip

# Just check that your own build is deterministic (no network)
npm run compare-build -- --twice
```

Exit code: `0` = identical, `1` = builds differ, `2` = operational error.

## Why we compare contents, not the ZIP file

You cannot simply compare `sha256` of the two `.zip` files. ZIP archives store,
per entry, the filesystem **order**
(differs macOS vs Linux), **timestamps**, and **file mode / uid / gid**. Two
zips of byte-identical `dist/` trees will therefore differ in their container
bytes for reasons that have nothing to do with the build output.

Instead, the tool compares **per-file SHA-256 manifests** of the local build
tree and the release ZIP contents, applying the same exclusions as `build:zip`
(`.vite/`, `*.DS_Store`) to both sides.

## How it works

1. **Build locally** — runs `npm run build` (`tsc --noEmit && vite build`) into
   `dist/`, exactly as the release checklist does.
2. **Admit the release asset** — query `gh release view <tag> --json assets`,
   require exactly one `liska-threadkeeper-*.zip` asset within the archive limit,
   and require its numeric API identity to match the exact product repository.
   Metadata retrieval uses an explicit `--repo` derived from `package.json`'s
   repository (homepage fallback), not GitHub CLI's inferred upstream. Download
   the pinned `repos/<owner>/<repo>/releases/assets/<id>` endpoint with
   `gh api --hostname github.com -H 'Accept: application/octet-stream'`; do not
   re-resolve a mutable tag/name. Pipe stdout to a create-only file, aborting
   before any byte beyond the admitted size (and never beyond 64 MiB) is written.
   Capture at most 8 KiB of stderr, require successful child exit and exact size,
   and check the optional SHA-256 digest in that same stream. A ten-minute
   timeout kills stalled transfers. Every transfer failure removes the partial
   file. Older releases without a digest remain supported. `--ci-zip` skips
   GitHub retrieval but receives the same actual-file size and ZIP admission checks.
3. **Inventory, stream + diff** — the Node-only `yauzl` reader inventories the
   entire central directory and validates local metadata before any extraction
   write. It then extracts one entry at a time with backpressure, checking actual
   byte counts and CRC-32 while computing SHA-256. The ZIP manifest is returned
   directly, without rereading extracted files. The local tree is traversed
   iteratively and hashed in chunks. Both become `posix-path → sha256` maps; the
   diff classifies every difference as `only-local`, `only-ci`, or
   `content-mismatch`.
4. **Report** — prints a summary and exits non-zero on any difference.

`--twice` takes precedence over `--ci-zip` and `--tag`; otherwise `--ci-zip`
takes precedence over `--tag`. `--keep` retains temporary files on success or
content mismatch only. Operational failures always remove partial extraction
trees and run-owned temporary directories, even with `--keep`; a caller-supplied
ZIP is never removed or modified.

## Archive support and resource limits

ZIP input is untrusted. No external `tar` or `unzip` is used for comparison.
The production ceilings are fixed; there is no CLI bypass. Unit tests may lower
them, but cannot raise them.

| Resource                                          |     Ceiling |
| ------------------------------------------------- | ----------: |
| ZIP file / aggregate declared compressed bytes    |      64 MiB |
| Explicit archive entries (including directories)  |       4,096 |
| Expanded bytes per file                           |      32 MiB |
| Aggregate expanded bytes                          |     128 MiB |
| Expanded/compressed ratio per entry and aggregate |       200:1 |
| Decoded UTF-8 path                                | 1,024 bytes |
| Path depth                                        | 32 segments |
| Aggregate path/central/local metadata admission   |       1 MiB |

All entries count, **including excluded `.vite/` and `*.DS_Store` entries**.
Declared sizes/ratios are checked before extraction, and actual expanded bytes,
declared length and CRC are checked while streaming. Local manifests also bound
entry count, per-file/aggregate bytes and path work, and continue skipping
symlinks. Excluded ZIP files are still extracted within these budgets so retained
diagnostic trees remain useful, but do not enter either manifest.

Supported entries are ordinary files and empty directories using STORE or
DEFLATE, including native packaging's single leading `./` and data descriptors.
Safe Unicode names and spaces are preserved. Non-ASCII names require valid
UTF-8 metadata (the UTF-8 flag or a CRC-bound Info-ZIP Unicode path field);
ambiguous unflagged legacy codepages are rejected, not guessed. Windows `tar`
can produce such legacy names and can itself lose characters on round-trip;
the current ASCII-named build output is covered by a real native-producer test.

Encryption, symlinks/special entries, traversal, absolute/drive/UNC paths,
backslashes, controls, Windows device/stream syntax, trailing dots/spaces,
segments over 255 UTF-8 bytes, duplicate Unicode/case-equivalent names and
file/directory ancestor conflicts are rejected on every OS. Rejection is an
operational error (`2`), not a content mismatch.

## When builds differ

The tool prints a drill-down hint:

```text
Investigate with:
  diffoscope dist /tmp/liska-extract-XXXX
```

Run with `--keep` first so the extracted CI dir is retained, then run the
`diffoscope` command to see exactly which bytes differ.
[diffoscope](https://reproducible-builds.org/tools/) recursively unpacks and
diffs archives and binaries in human-readable form. It is an optional external
diagnostic tool, not required for the pass/fail comparison.

### Common causes of a real mismatch

- **Node version drift** — the release build and your local build must use the
  same Node major (both Node 24; see
  [ADR-013](adr/013-build-reproducibility-comparison.md) "Prerequisite"). Do
  not compare against releases built on an older Node.
- **Different commit** — the report prints your local `HEAD` sha. Make sure it
  matches the commit the release tag points at; otherwise a content difference
  is expected.
- **Dependency drift** — `package-lock.json` must be identical on both sides
  (CI runs `npm ci` against the tag's lockfile).
- **Toolchain nondeterminism** — run `--twice` first. If your local build is
  not even identical to itself, the cause is local (e.g. a Vite/Rollup
  nondeterminism issue), not CI.

## Limitations

- This verifies **content parity**, not byte-identical zips. Making the ZIP
  container itself reproducible (`SOURCE_DATE_EPOCH` + `zip -X -D` or
  `strip-nondeterminism`) is a possible future enhancement; see ADR-013's
  rejected-alternatives table.
- The exclusion list (`.vite/`, `*.DS_Store`) is defined once in `isExcluded`
  in `scripts/lib/build-compare.mjs` and is reused by the packaging script.
