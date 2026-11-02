/**
 * Build-comparison helpers.
 *
 * Pure / filesystem logic shared by `scripts/compare-build.mjs`. Compares the
 * *contents* of two built artifact trees (a local `dist/` and an extracted CI
 * ZIP) rather than the ZIP container bytes — because `zip -r` records
 * filesystem entry order, per-file timestamps, and mode/uid/gid, all of which
 * differ across machines (macOS vs Linux) even when the built files are
 * byte-identical. See docs/build-reproducibility.md.
 *
 * @typedef {Map<string, string>} Manifest  posix-relative-path -> sha256 hex
 * @typedef {Object} DiffResult
 * @property {boolean} identical  true when every file matches
 * @property {string[]} onlyLocal paths present only in the local tree
 * @property {string[]} onlyCi    paths present only in the CI tree
 * @property {string[]} mismatch  paths present in both with differing content
 */

import { createReadStream } from 'node:fs';
import { Buffer } from 'node:buffer';
import { opendir, lstat } from 'node:fs/promises';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { comparisonLimits, portablePath, within } from './build-compare-zip.mjs';

/** Suffix marking macOS Finder metadata files excluded by build:zip. */
const DS_STORE_SUFFIX = '.DS_Store';
/** Directory segment for Vite's internal manifest, excluded by build:zip. */
const VITE_DIR_SEGMENT = '.vite';

/**
 * Normalize a path to use forward slashes, so comparisons are OS-independent.
 *
 * @param {string} p
 * @returns {string}
 */
export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Decide whether a posix-relative path is excluded from the comparison,
 * mirroring `build:zip`'s `-x '*.DS_Store' -x '.vite/*'` exclusions so the
 * local tree and the extracted CI ZIP are compared on equal footing.
 *
 * Note: the bare directory name `.vite` is also matched (not just `.vite/*`).
 * This is intentional and slightly stricter than zip's glob. Exclusions govern
 * manifest membership only; excluded entries still consume admission budgets.
 *
 * @param {string} posixPath
 * @returns {boolean}
 */
export function isExcluded(posixPath) {
  const segments = posixPath.split('/');
  if (segments.includes(VITE_DIR_SEGMENT)) return true;
  // The former recursive walk pruned a matching directory as well as files.
  // Keep that membership rule now that admission visits excluded descendants.
  return segments.some(segment => segment.endsWith(DS_STORE_SUFFIX));
}

/**
 * Walk a directory tree and build a manifest of `posixRelativePath -> sha256`.
 * Hash incrementally and walk iteratively. Exclusions affect manifest membership,
 * not admission: excluded files also consume the bounded local-tree budgets.
 *
 * @param {string} dir  root directory to scan
 * @returns {Promise<Manifest>}
 */
export async function buildManifest(dir, overrides = {}) {
  const limits = comparisonLimits(overrides);
  /** @type {Manifest} */
  const manifest = new Map();
  const pending = [dir];
  let count = 0;
  let declared = 0;
  let total = 0;
  let metadata = 0;
  while (pending.length) {
    const directory = await opendir(pending.pop());
    for await (const entry of directory) {
      within(++count, limits.entries, 'local entries');
      // Preserve the old behavior: never follow symlinks or special files.
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const full = join(directory.path, entry.name);
      const relPosix = portablePath(toPosix(relative(dir, full)), entry.isDirectory(), limits);
      metadata += Buffer.byteLength(relPosix, 'utf8');
      within(metadata, limits.metadataBytes, 'local path metadata bytes');
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      const info = await lstat(full);
      if (!info.isFile()) throw new Error('local file changed during traversal');
      within(info.size, limits.entryBytes, 'local entry bytes');
      declared += info.size;
      within(declared, limits.totalBytes, 'local aggregate expanded bytes');
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of createReadStream(full)) {
        bytes += chunk.length;
        total += chunk.length;
        within(bytes, limits.entryBytes, 'actual local entry bytes');
        within(total, limits.totalBytes, 'actual local aggregate expanded bytes');
        hash.update(chunk);
      }
      if (bytes !== info.size) throw new Error('local file size changed during hashing');
      if (!isExcluded(relPosix)) manifest.set(relPosix, hash.digest('hex'));
    }
  }
  return manifest;
}

/** Product release authority, independent of gh's inferred upstream remote. */
export function releaseRepository(pkg) {
  const source = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match =
    /^(?:git\+)?https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(
      source ?? pkg.homepage ?? ''
    );
  if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..') {
    throw new Error('package.json must identify an HTTPS GitHub release repository');
  }
  return `${match[1]}/${match[2]}`;
}

/** Validate untrusted release metadata before gh is allowed to download bytes. */
export function releaseAsset(metadata, repository) {
  const matches = Array.isArray(metadata.assets)
    ? metadata.assets.filter(
        asset =>
          typeof asset.name === 'string' && /^liska-threadkeeper-[^/\\]+\.zip$/u.test(asset.name)
      )
    : [];
  if (matches.length !== 1)
    throw new Error(`expected exactly one release ZIP asset, found ${matches.length}`);
  const asset = matches[0];
  if (/\p{Cc}/u.test(asset.name) || ['*', '?', '[', ']'].some(char => asset.name.includes(char)))
    throw new Error('unsafe release ZIP basename');
  within(asset.size, comparisonLimits().archiveBytes, 'release archive bytes');
  const prefix = `https://api.github.com/repos/${repository}/releases/assets/`;
  const identity =
    typeof asset.apiUrl === 'string' && asset.apiUrl.startsWith(prefix)
      ? asset.apiUrl.slice(prefix.length)
      : '';
  if (!/^[1-9]/u.test(identity) || identity.length > 20 || /[^0-9]/u.test(identity)) {
    throw new Error('release ZIP API identity must match the exact product repository');
  }
  const digest = asset.digest;
  if (
    digest != null &&
    digest !== '' &&
    (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(digest))
  ) {
    throw new Error('unsupported release ZIP digest');
  }
  return {
    name: asset.name,
    size: asset.size,
    digest: digest || null,
    endpoint: `repos/${repository}/releases/assets/${identity}`,
  };
}

/**
 * Compare two manifests, classifying every difference.
 *
 * @param {Manifest} local
 * @param {Manifest} ci
 * @returns {DiffResult}
 */
export function diffManifests(local, ci) {
  /** @type {string[]} */
  const onlyLocal = [];
  /** @type {string[]} */
  const onlyCi = [];
  /** @type {string[]} */
  const mismatch = [];

  for (const [path, hash] of local) {
    if (!ci.has(path)) {
      onlyLocal.push(path);
    } else if (ci.get(path) !== hash) {
      mismatch.push(path);
    }
  }
  for (const path of ci.keys()) {
    if (!local.has(path)) onlyCi.push(path);
  }

  onlyLocal.sort();
  onlyCi.sort();
  mismatch.sort();

  const identical = onlyLocal.length === 0 && onlyCi.length === 0 && mismatch.length === 0;
  return { identical, onlyLocal, onlyCi, mismatch };
}

/**
 * Render a human-readable summary of a diff result.
 *
 * @param {DiffResult} diff
 * @param {{ localLabel?: string, ciLabel?: string }} [labels]
 * @returns {string}
 */
export function formatReport(diff, labels = {}) {
  const { localLabel = 'local', ciLabel = 'CI' } = labels;
  if (diff.identical) {
    return '✅ Builds are identical — every file content matches.';
  }

  const lines = ['❌ Builds differ:'];
  if (diff.mismatch.length > 0) {
    lines.push(`  content mismatch (${diff.mismatch.length}): ${diff.mismatch.join(', ')}`);
  }
  if (diff.onlyLocal.length > 0) {
    lines.push(`  only in ${localLabel} (${diff.onlyLocal.length}): ${diff.onlyLocal.join(', ')}`);
  }
  if (diff.onlyCi.length > 0) {
    lines.push(`  only in ${ciLabel} (${diff.onlyCi.length}): ${diff.onlyCi.join(', ')}`);
  }
  return lines.join('\n');
}
