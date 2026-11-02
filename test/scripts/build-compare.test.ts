/**
 * Unit tests for the build-comparison helpers.
 *
 * These cover the pure / filesystem logic that powers `scripts/compare-build.mjs`:
 * path normalization, build:zip exclusion parity, per-file SHA-256 manifests,
 * and the manifest diff + report formatting.
 *
 * User journey: "As a maintainer, I want to know whether the artifact I built
 * locally has the same file contents as the artifact GitHub Actions built and
 * zipped, ignoring ZIP-container nondeterminism (entry order, timestamps, perms)."
 */

// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
// @ts-expect-error -- plain .mjs build tooling, no type declarations
import {
  toPosix,
  isExcluded,
  buildManifest,
  diffManifests,
  formatReport,
  releaseRepository,
  releaseAsset,
} from '../../scripts/lib/build-compare.mjs';
// @ts-expect-error -- Node-only plain .mjs tooling
import { parseArgs, runTwice } from '../../scripts/compare-build.mjs';

const tmpDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liska-compare-'));
  tmpDirs.push(dir);
  return dir;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('toPosix', () => {
  it('converts Windows backslashes to forward slashes', () => {
    expect(toPosix('assets\\index.js')).toBe('assets/index.js');
    expect(toPosix('a\\b\\c.txt')).toBe('a/b/c.txt');
  });

  it('leaves POSIX paths unchanged', () => {
    expect(toPosix('assets/index.js')).toBe('assets/index.js');
    expect(toPosix('manifest.json')).toBe('manifest.json');
  });
});

describe('isExcluded (build:zip parity: -x "*.DS_Store" -x ".vite/*")', () => {
  it('excludes anything inside a .vite directory', () => {
    expect(isExcluded('.vite')).toBe(true);
    expect(isExcluded('.vite/manifest.json')).toBe(true);
    expect(isExcluded('nested/.vite/chunk.js')).toBe(true);
  });

  it('excludes .DS_Store files anywhere', () => {
    expect(isExcluded('.DS_Store')).toBe(true);
    expect(isExcluded('assets/.DS_Store')).toBe(true);
    expect(isExcluded('folder.DS_Store/child.js')).toBe(true);
  });

  it('keeps regular build output files', () => {
    expect(isExcluded('manifest.json')).toBe(false);
    expect(isExcluded('assets/index-abc123.js')).toBe(false);
    expect(isExcluded('_locales/en/messages.json')).toBe(false);
  });
});

describe('buildManifest', () => {
  it('produces a posix-keyed sha256 map of all files, recursively', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'manifest.json'), '{"a":1}');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'index.js'), 'console.log(1)');

    const manifest = await buildManifest(dir);

    expect(manifest.get('manifest.json')).toBe(sha256('{"a":1}'));
    expect(manifest.get('assets/index.js')).toBe(sha256('console.log(1)'));
    expect(manifest.size).toBe(2);
  });

  it('excludes .vite/ and .DS_Store to mirror build:zip', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'manifest.json'), '{}');
    writeFileSync(join(dir, '.DS_Store'), 'junk');
    mkdirSync(join(dir, '.vite'));
    writeFileSync(join(dir, '.vite', 'manifest.json'), 'internal');
    mkdirSync(join(dir, 'folder.DS_Store'));
    writeFileSync(join(dir, 'folder.DS_Store', 'child.js'), 'also excluded');

    const manifest = await buildManifest(dir);

    expect(manifest.has('manifest.json')).toBe(true);
    expect(manifest.has('.DS_Store')).toBe(false);
    expect(manifest.has('.vite/manifest.json')).toBe(false);
    expect(manifest.size).toBe(1);
  });

  it('detects content differences via differing hashes', async () => {
    const a = makeTempDir();
    const b = makeTempDir();
    writeFileSync(join(a, 'f.txt'), 'hello');
    writeFileSync(join(b, 'f.txt'), 'world');

    expect((await buildManifest(a)).get('f.txt')).not.toBe((await buildManifest(b)).get('f.txt'));
  });

  it('hashes multi-chunk files and counts excluded files toward budgets', async () => {
    const dir = makeTempDir();
    const content = 'abc'.repeat(100_000);
    writeFileSync(join(dir, 'large.js'), content);
    expect((await buildManifest(dir)).get('large.js')).toBe(sha256(content));
    await expect(buildManifest(dir, { entryBytes: content.length - 1 })).rejects.toThrow(
      /entry bytes/
    );
    writeFileSync(join(dir, '.DS_Store'), 'x');
    await expect(buildManifest(dir, { totalBytes: content.length })).rejects.toThrow(/aggregate/);
    await expect(buildManifest(dir, { entries: 1 })).rejects.toThrow(/entries/);
  });
});

describe('release acquisition admission', () => {
  it('uses package release authority rather than an inferred upstream', () => {
    expect(
      releaseRepository({ repository: { url: 'https://github.com/la4ox/liska-threadkeeper' } })
    ).toBe('la4ox/liska-threadkeeper');
    expect(releaseRepository({ repository: 'git+https://github.com/fork/project.git' })).toBe(
      'fork/project'
    );
    expect(releaseRepository({ homepage: 'https://github.com/fork/project/' })).toBe(
      'fork/project'
    );
    for (const repository of [
      'https://github.com.evil/a/b',
      'https://github.com/a/b?x',
      'a/b',
      'https://github.com/../x',
    ]) {
      expect(() => releaseRepository({ repository })).toThrow();
    }
  });

  it('requires one bounded basename and validates optional SHA-256 metadata', () => {
    const asset = {
      name: 'liska-threadkeeper-3.0.0.zip',
      size: 10,
      digest: `sha256:${'a'.repeat(64)}`,
      apiUrl: 'https://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/123',
    };
    const repository = 'la4ox/liska-threadkeeper';
    expect(releaseAsset({ assets: [asset] }, repository)).toEqual({
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
      endpoint: 'repos/la4ox/liska-threadkeeper/releases/assets/123',
    });
    expect(releaseAsset({ assets: [{ ...asset, digest: null }] }, repository).digest).toBeNull();
    for (const assets of [
      [],
      [asset, asset],
      [{ ...asset, size: 64 * 1024 * 1024 + 1 }],
      [{ ...asset, digest: 'sha256:BAD' }],
      [{ ...asset, name: 'liska-threadkeeper-*.zip' }],
    ]) {
      expect(() => releaseAsset({ assets }, repository)).toThrow();
    }
    for (const apiUrl of [
      undefined,
      'https://api.github.com/repos/upstream/repo/releases/assets/123',
      'https://api.github.com.evil/repos/la4ox/liska-threadkeeper/releases/assets/123',
      'http://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/123',
      'https://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/123?x=1',
      'https://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/123\n',
      'https://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/../123',
      'https://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/0',
      'https://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/0123',
      'https://api.github.com/repos/la4ox/liska-threadkeeper/releases/assets/%31',
    ])
      expect(() => releaseAsset({ assets: [{ ...asset, apiUrl }] }, repository)).toThrow(
        /identity/
      );
  });
});

describe('CLI local determinism', () => {
  it('preserves option parsing and --twice compares awaited manifest snapshots', async () => {
    expect(parseArgs(['--tag', 'v1', '--ci-zip', 'input.zip', '--twice', '--keep'])).toMatchObject({
      tag: 'v1',
      ciZip: 'input.zip',
      twice: true,
      keep: true,
    });
    const dir = makeTempDir();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(
        (
          await runTwice({
            dist: dir,
            build() {
              writeFileSync(join(dir, 'file'), 'same');
            },
          })
        ).identical
      ).toBe(true);
      let build = 0;
      expect(
        (
          await runTwice({
            dist: dir,
            build() {
              writeFileSync(join(dir, 'file'), String(++build));
            },
          })
        ).mismatch
      ).toEqual(['file']);
    } finally {
      log.mockRestore();
    }
  });
});

describe('diffManifests', () => {
  it('reports identical when both manifests match', () => {
    const local = new Map([
      ['a.js', 'h1'],
      ['b.js', 'h2'],
    ]);
    const ci = new Map([
      ['a.js', 'h1'],
      ['b.js', 'h2'],
    ]);

    const diff = diffManifests(local, ci);

    expect(diff.identical).toBe(true);
    expect(diff.onlyLocal).toEqual([]);
    expect(diff.onlyCi).toEqual([]);
    expect(diff.mismatch).toEqual([]);
  });

  it('reports files only present locally', () => {
    const local = new Map([
      ['a.js', 'h1'],
      ['extra.js', 'h9'],
    ]);
    const ci = new Map([['a.js', 'h1']]);

    const diff = diffManifests(local, ci);

    expect(diff.identical).toBe(false);
    expect(diff.onlyLocal).toEqual(['extra.js']);
    expect(diff.onlyCi).toEqual([]);
    expect(diff.mismatch).toEqual([]);
  });

  it('reports files only present in CI', () => {
    const local = new Map([['a.js', 'h1']]);
    const ci = new Map([
      ['a.js', 'h1'],
      ['only-ci.js', 'h8'],
    ]);

    const diff = diffManifests(local, ci);

    expect(diff.identical).toBe(false);
    expect(diff.onlyCi).toEqual(['only-ci.js']);
    expect(diff.onlyLocal).toEqual([]);
  });

  it('reports content mismatches (same path, different hash)', () => {
    const local = new Map([['a.js', 'h1']]);
    const ci = new Map([['a.js', 'DIFFERENT']]);

    const diff = diffManifests(local, ci);

    expect(diff.identical).toBe(false);
    expect(diff.mismatch).toEqual(['a.js']);
  });

  it('sorts each difference list for stable output', () => {
    const local = new Map([
      ['z.js', 'h'],
      ['a.js', 'h'],
    ]);
    const ci = new Map<string, string>();

    const diff = diffManifests(local, ci);

    expect(diff.onlyLocal).toEqual(['a.js', 'z.js']);
  });
});

describe('formatReport', () => {
  it('reports success when identical', () => {
    const report = formatReport({ identical: true, onlyLocal: [], onlyCi: [], mismatch: [] });
    expect(report).toMatch(/identical/i);
  });

  it('lists each difference category when builds differ', () => {
    const report = formatReport({
      identical: false,
      onlyLocal: ['extra.js'],
      onlyCi: ['only-ci.js'],
      mismatch: ['a.js'],
    });
    expect(report).toMatch(/differ/i);
    expect(report).toContain('a.js');
    expect(report).toContain('extra.js');
    expect(report).toContain('only-ci.js');
  });
});
