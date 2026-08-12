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

Instead, the tool extracts both archives and compares a **per-file SHA-256
manifest**, applying the same exclusions as `build:zip` (`.vite/`,
`*.DS_Store`) to both sides.

## How it works

1. **Build locally** — runs `npm run build` (`tsc --noEmit && vite build`) into
   `dist/`, exactly as the release checklist does.
2. **Fetch the release asset** — `gh release download <tag> --pattern
'liska-threadkeeper-*.zip'`, then extract it with the platform's built-in
   archive tool.
3. **Manifest + diff** — both trees become `posix-path → sha256` maps; the
   diff classifies every difference as `only-local`, `only-ci`, or
   `content-mismatch`.
4. **Report** — prints a summary and exits non-zero on any difference.

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
