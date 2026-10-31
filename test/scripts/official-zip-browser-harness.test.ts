// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
// @ts-expect-error -- opt-in plain Node .mjs tooling has no declarations
import {
  CASE_IDS,
  ROOT,
  createFixtureSet,
  filesWithin,
  generateOfficialZipBrowserFixtures,
  safeOutputDirectory,
  sha256,
} from '../../scripts/generate-official-zip-browser-fixtures.mjs';
// @ts-expect-error -- opt-in plain Node .mjs tooling has no declarations
import {
  INVENTORY,
  buildOfficialZipBrowser,
  inspectHarnessBuild,
  validateHarnessManifest,
} from '../../scripts/build-official-zip-browser.mjs';
import { openOfficialExportZip, OfficialZipError } from '../../src/reconcile/official-zip';
import { createOfficialZipFileSource } from '../../src/reconcile/official-zip-file';

const root = mkdtempSync(join(tmpdir(), 'official-zip-browser-test-'));
const fixtureDir = join(root, 'fixtures');
const extensionDir = join(root, 'extension');
type FixtureSet = {
  files: Map<string, Buffer>;
  index: {
    maxReadBytes: number;
    maxArchiveBytes: number;
    cases: {
      id: string;
      bytes: number;
      sha256: string;
      expectedFailure: number;
      manifestStatus: string;
      selectedExpandedBytes: number;
      selectedCompressedBytes: number;
      outputs: { ordinal: number; shardIndex: number; bytes: number; sha256: string }[];
      payloadRanges: { start: number; end: number; method: number; deflateBytes: number }[];
    }[];
  };
};
let fixtureSet: FixtureSet;
let buildReceipt: { ok: boolean; files: { id: string; bytes: number; sha256: string }[] };

function snapshot(directory: string): string[] {
  return filesWithin(directory).map(
    (file: string) => `${file}:${sha256(readFileSync(resolve(directory, file)))}`
  );
}

beforeAll(async () => {
  fixtureSet = createFixtureSet();
  generateOfficialZipBrowserFixtures(fixtureDir);
  buildReceipt = await buildOfficialZipBrowser(
    extensionDir,
    join(fixtureDir, 'fixture-index.json')
  );
}, 30000);

afterAll(() => {
  // The only recursive cleanup target is the exact mkdtemp-owned test directory.
  expect(root.startsWith(join(tmpdir(), 'official-zip-browser-test-'))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

describe('independent deterministic synthetic ZIP32 generator', () => {
  it('is byte deterministic, bounded, indexed by hashes/lengths and content free', () => {
    const second = join(root, 'second');
    const receiptA = generateOfficialZipBrowserFixtures(fixtureDir);
    const receiptB = generateOfficialZipBrowserFixtures(second);
    expect(receiptA).toEqual(receiptB);
    expect(snapshot(fixtureDir)).toEqual(snapshot(second));
    expect(fixtureSet.index.cases.map(c => c.id)).toEqual(CASE_IDS);
    expect(filesWithin(fixtureDir)).toHaveLength(9);
    for (const fixture of fixtureSet.index.cases) {
      const bytes = readFileSync(join(fixtureDir, `${fixture.id}.zip`));
      expect(bytes.length).toBe(fixture.bytes);
      expect(sha256(bytes)).toBe(fixture.sha256);
      expect(fixture.bytes).toBeLessThanOrEqual(fixtureSet.index.maxArchiveBytes);
      expect(fixture.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const index = readFileSync(join(fixtureDir, 'fixture-index.json'), 'utf8');
    expect(index).not.toMatch(/\.zip|filename|absolute|[A-Z]:\\|https?:\/\//i);
    expect(index).not.toContain(root);
  });

  it('records malformed compressed lengths in both local and central records', () => {
    for (const fixture of fixtureSet.index.cases) {
      const zip = fixtureSet.files.get(`${fixture.id}.zip`)!;
      const eocd = zip.length - 22;
      expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
      let central = zip.readUInt32LE(eocd + 16);
      for (const range of fixture.payloadRanges) {
        const local = zip.readUInt32LE(central + 42);
        expect(zip.readUInt32LE(local)).toBe(0x04034b50);
        expect(zip.readUInt32LE(local + 18)).toBe(range.end - range.start);
        expect(zip.readUInt32LE(central + 20)).toBe(range.end - range.start);
        expect(local + 30 + zip.readUInt16LE(local + 26)).toBe(range.start);
        central += 46 + zip.readUInt16LE(central + 28);
      }
      expect(central).toBe(eocd);
    }
  });

  it('puts truncation and trailing bytes at actual raw-stream EOF, including a separate 1 MiB read', () => {
    for (const fixture of fixtureSet.index.cases.filter(c => c.expectedFailure)) {
      const range = fixture.payloadRanges[0];
      const zip = fixtureSet.files.get(`${fixture.id}.zip`)!;
      const packed = zip.subarray(range.start, range.end);
      if (fixture.id === 'malformed-truncated') {
        expect(packed.length).toBe(range.deflateBytes - 1);
        expect(() => inflateRawSync(packed)).toThrow();
      } else {
        const inflated = inflateRawSync(packed, { info: true });
        expect(inflated.engine.bytesWritten).toBe(range.deflateBytes);
        expect(inflated.engine.bytesWritten).toBeLessThan(packed.length);
        expect(sha256(inflated.buffer)).toBe(fixture.outputs[0].sha256);
        if (fixture.id === 'malformed-trailing-boundary') {
          expect(range.deflateBytes).toBe(1024 * 1024);
          expect(packed.length).toBe(1024 * 1024 + 37);
          expect(sha256(inflateRawSync(packed.subarray(0, 1024 * 1024)))).toBe(
            fixture.outputs[0].sha256
          );
        } else expect(packed.length).toBeLessThan(1024 * 1024);
      }
    }
  });

  it('uses valid low-compressibility JSON sufficiently larger than native input buffers', () => {
    const fixture = fixtureSet.index.cases.find(c => c.id === 'large-deflate')!;
    const range = fixture.payloadRanges[0];
    const zip = fixtureSet.files.get(`${fixture.id}.zip`)!;
    const plain = inflateRawSync(zip.subarray(range.start, range.end));
    expect(plain.length).toBe(16 * 1024 * 1024);
    expect(range.end - range.start).toBeGreaterThan(10 * 1024 * 1024);
    expect(JSON.parse(plain.toString('utf8'))).toHaveLength(1);
    expect(sha256(plain)).toBe(fixture.outputs[0].sha256);
  });

  it('fails closed on production paths, unrelated existing data, symlinks and junction ancestors', () => {
    for (const path of [
      ROOT,
      resolve(ROOT, '..'),
      resolve(ROOT, 'dist'),
      resolve(ROOT, 'src/harness'),
    ]) {
      expect(() => safeOutputDirectory(path)).toThrow('output-containment');
    }
    const unrelated = join(root, 'unrelated');
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, 'keep.txt'), 'keep');
    expect(() => generateOfficialZipBrowserFixtures(unrelated)).toThrow('non-fixture-output');
    expect(readFileSync(join(unrelated, 'keep.txt'), 'utf8')).toBe('keep');
    const link = join(root, 'linked');
    symlinkSync(unrelated, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => safeOutputDirectory(join(link, 'child'))).toThrow('unsafe-output-path');
    const childLink = join(unrelated, 'child-link');
    symlinkSync(fixtureDir, childLink, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => filesWithin(unrelated)).toThrow('symlink-output');
  });
});

describe('isolated opt-in MV3 build', () => {
  it('has the exact content-hashed inventory and no ZIPs, maps, remote or extension authority', () => {
    expect(buildReceipt.ok).toBe(true);
    expect(buildReceipt.files.map(f => f.id)).toEqual(INVENTORY);
    for (const file of buildReceipt.files) {
      const bytes = readFileSync(join(extensionDir, file.id));
      expect(file.bytes).toBe(bytes.length);
      expect(file.sha256).toBe(sha256(bytes));
    }
    expect(filesWithin(extensionDir)).not.toContain('legacy-deflate.zip');
    const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toEqual([]);
    expect(manifest.host_permissions).toEqual([]);
    for (const key of [
      'background',
      'content_scripts',
      'web_accessible_resources',
      'externally_connectable',
    ])
      expect(manifest).not.toHaveProperty(key);
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
    for (const mutate of [
      { permissions: ['storage'] },
      { host_permissions: ['<all_urls>'] },
      { background: { service_worker: 'worker.js' } },
      { content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" } },
    ])
      expect(() => validateHarnessManifest({ ...manifest, ...mutate })).toThrow(
        'unsafe-harness-manifest'
      );
    expect(JSON.stringify(buildReceipt)).not.toContain(root);
  });

  it('rejects unexpected output and index mutation before building', async () => {
    const unsafe = join(root, 'unsafe-build');
    mkdirSync(unsafe);
    writeFileSync(join(unsafe, 'sentinel.txt'), 'untouched');
    await expect(
      buildOfficialZipBrowser(unsafe, join(fixtureDir, 'fixture-index.json'))
    ).rejects.toThrow('unexpected-build-inventory');
    expect(readFileSync(join(unsafe, 'sentinel.txt'), 'utf8')).toBe('untouched');
    const invalidIndex = join(root, 'invalid-index');
    mkdirSync(invalidIndex);
    writeFileSync(join(invalidIndex, 'fixture-index.json'), '{}');
    await expect(
      buildOfficialZipBrowser(join(root, 'not-built'), join(invalidIndex, 'fixture-index.json'))
    ).rejects.toThrow('fixture-index-mismatch');
    const manifest = join(extensionDir, 'manifest.json');
    const original = readFileSync(manifest);
    writeFileSync(manifest, '{}');
    expect(() =>
      inspectHarnessBuild(extensionDir, fixtureSet.files.get('fixture-index.json'))
    ).toThrow('unsafe-harness-manifest');
    writeFileSync(manifest, original);
  });

  it('runs the exact Node CLI boundary into caller-owned temp without touching production dist/config', () => {
    const watched = [
      'dist',
      'src/manifest.json',
      'vite.config.ts',
      'package.json',
      'package-lock.json',
    ];
    const before = watched.map(path =>
      path === 'dist' ? snapshot(resolve(ROOT, path)) : sha256(readFileSync(resolve(ROOT, path)))
    );
    const generated = spawnSync(
      process.execPath,
      [
        resolve(ROOT, 'scripts/generate-official-zip-browser-fixtures.mjs'),
        join(root, 'cli-fixtures'),
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(generated.status, generated.stderr).toBe(0);
    expect(JSON.parse(generated.stdout).ok).toBe(true);
    const built = spawnSync(
      process.execPath,
      [
        resolve(ROOT, 'scripts/build-official-zip-browser.mjs'),
        join(root, 'cli-extension'),
        join(root, 'cli-fixtures/fixture-index.json'),
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(built.status, built.stderr).toBe(0);
    expect(JSON.parse(built.stdout).files.map((f: { id: string }) => f.id)).toEqual(INVENTORY);
    const after = watched.map(path =>
      path === 'dist' ? snapshot(resolve(ROOT, path)) : sha256(readFileSync(resolve(ROOT, path)))
    );
    expect(after).toEqual(before);
  });
});

describe('production imports and runner privacy/acceptance guards', () => {
  it('rejects missing, duplicate and unknown picker inputs without starting the measured phase', async () => {
    const html = readFileSync(join(extensionDir, 'index.html'), 'utf8');
    const code = readFileSync(join(extensionDir, 'assets/runner.js'), 'utf8');
    const valid = fixtureSet.index.cases.map(
      fixture =>
        new File(
          [new Uint8Array(fixtureSet.files.get(`${fixture.id}.zip`)!)],
          'PRIVATE-REJECT-SENTINEL.zip'
        )
    );
    const unknown = new File([new Uint8Array(valid[0].size)], 'PRIVATE-REJECT-SENTINEL.zip');
    for (const files of [
      valid.slice(1),
      [valid[1], ...valid.slice(1)],
      [unknown, ...valid.slice(1)],
    ]) {
      const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
      try {
        for (const [key, value] of Object.entries({
          File,
          Blob,
          Uint8Array,
          ArrayBuffer,
          crypto: webcrypto,
        }))
          Object.defineProperty(dom.window, key, { value, configurable: true });
        dom.window.eval(code);
        const picker = dom.window.document.querySelector<HTMLInputElement>('#files')!;
        Object.defineProperty(picker, 'files', { value: files, configurable: true });
        picker.dispatchEvent(new dom.window.Event('change'));
        const started = Date.now();
        while (
          dom.window.document.querySelector('#overall')!.textContent === 'NOT RUN' &&
          Date.now() - started < 2000
        )
          await new Promise(resolve => setTimeout(resolve, 10));
        const text = dom.window.document.querySelector('#receipt')!.textContent!;
        const receipt = JSON.parse(text);
        expect(receipt.status).toBe('FAIL');
        expect(receipt.measuredMs).toBe(0);
        expect(receipt.rows).toEqual([
          { id: 'preflight-size-sha256-original-files', status: 'FAIL', metrics: [] },
        ]);
        expect(text).not.toContain('PRIVATE-');
      } finally {
        dom.window.close();
      }
    }
  });

  it('executes the built UI with synthetic Node Files (DOM simulation, not picker/browser evidence)', async () => {
    const html = readFileSync(join(extensionDir, 'index.html'), 'utf8');
    const code = readFileSync(join(extensionDir, 'assets/runner.js'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      // Use actual Node File/Web Stream implementations; no network/resource loader is enabled.
      for (const [key, value] of Object.entries({
        File,
        Blob,
        AbortController,
        AbortSignal,
        EventTarget,
        ReadableStream,
        DecompressionStream,
        TextDecoder,
        TextEncoder,
        Uint8Array,
        ArrayBuffer,
        DataView,
        crypto: webcrypto,
      }))
        Object.defineProperty(dom.window, key, { value, configurable: true });
      dom.window.eval(code);
      const picker = dom.window.document.querySelector<HTMLInputElement>('#files')!;
      const files = fixtureSet.index.cases
        .map(
          fixture =>
            new File(
              [new Uint8Array(fixtureSet.files.get(`${fixture.id}.zip`)!)],
              'PRIVATE-FILENAME-SENTINEL.zip',
              { type: 'private/mime-sentinel' }
            )
        )
        .reverse();
      Object.defineProperty(picker, 'files', { value: files, configurable: true });
      picker.dispatchEvent(new dom.window.Event('change'));
      const started = Date.now();
      const overall = dom.window.document.querySelector('#overall')!;
      while (overall.textContent === 'NOT RUN' && Date.now() - started < 25000) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(overall.textContent).not.toBe('NOT RUN');
      const text = dom.window.document.querySelector('#receipt')!.textContent!;
      expect(text).not.toMatch(
        /PRIVATE-|mime-sentinel|synthetic-reason|synthetic-check|native error/i
      );
      const result = JSON.parse(text) as {
        rows: { id: string; status: string; metrics: number[] }[];
        indexedFixtureHashes: { id: string; sha256: string }[];
      };
      expect(result.rows).toHaveLength(16);
      for (const row of result.rows) {
        if (row.id === 'measured-timer-animation-heartbeat') continue;
        if (row.id === 'native-paused-consumer-resumed') {
          expect(['PASS', 'INCONCLUSIVE']).toContain(row.status);
        } else expect(row.status, row.id).toBe('PASS');
        expect(row.metrics.every(n => Number.isFinite(n) && n >= 0 && n <= 0xffffffff)).toBe(true);
      }
      expect(result.indexedFixtureHashes).toEqual(
        fixtureSet.index.cases.map(({ id, sha256: hash }) => ({ id, sha256: hash }))
      );
    } finally {
      dom.window.close();
    }
  });

  it('fully drains actual native raw-DEFLATE and STORE via original synthetic Node Files (not browser proof)', async () => {
    for (const fixture of fixtureSet.index.cases) {
      const file = new File(
        [new Uint8Array(fixtureSet.files.get(`${fixture.id}.zip`)!)],
        'PRIVATE-SENTINEL.zip'
      );
      const adapter = createOfficialZipFileSource(file);
      let maxRead = 0;
      const source = {
        size: adapter.size,
        readRange(start: number, end: number, signal: AbortSignal) {
          maxRead = Math.max(maxRead, end - start);
          return adapter.readRange(start, end, signal);
        },
      };
      try {
        const selection = await openOfficialExportZip({
          source,
          signal: new AbortController().signal,
        });
        expect(selection.evidence.manifestStatus).toBe(fixture.manifestStatus);
        const sources = selection.officialChunks
          ? [{ shardIndex: -1, chunks: selection.officialChunks }]
          : selection.officialSources;
        for (let ordinal = 0; ordinal < sources.length; ordinal++) {
          expect(sources[ordinal].shardIndex).toBe(fixture.outputs[ordinal].shardIndex);
          const parts: Buffer[] = [];
          for await (const part of sources[ordinal].chunks) {
            expect(part.length).toBeLessThanOrEqual(fixtureSet.index.maxReadBytes);
            parts.push(Buffer.from(part));
          }
          expect(sha256(Buffer.concat(parts))).toBe(fixture.outputs[ordinal].sha256);
        }
        expect(fixture.expectedFailure).toBe(0);
      } catch (error) {
        expect(fixture.expectedFailure).toBe(1);
        expect(error).toBeInstanceOf(OfficialZipError);
        expect((error as OfficialZipError).code).toBe('inflate-failed');
        expect((error as Error).message).toBe('Official ZIP source failed (inflate-failed).');
      }
      expect(maxRead).toBeLessThanOrEqual(fixtureSet.index.maxReadBytes);
    }
  });

  it('keeps UI identity, output, cancellation and heartbeat boundaries explicit', () => {
    const runner = readFileSync(resolve(ROOT, 'test/browser/official-zip/runner.ts'), 'utf8');
    expect(runner).toContain("from '../../../src/reconcile/official-zip-file'");
    expect(runner).toContain("from '../../../src/reconcile/official-zip'");
    expect(runner).toContain('createOfficialZipFileSource(file)');
    expect(runner).toContain('c.bytes === file.size');
    expect(runner).toContain('c.sha256 === hash');
    expect(runner).not.toMatch(/file\.(?:name|type|lastModified)|new File\(|\.innerHTML\s*=/);
    expect(runner).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|console|localStorage|sessionStorage|indexedDB)\b|chrome\./
    );
    for (const guard of [
      "'direct-ranges-owned-buffers'",
      "'pre-abort-zero-source-reads'",
      "'native-active-abort-no-growth'",
      "'synthetic-delayed-source-pending-abort'",
      "'measured-timer-animation-heartbeat'",
      "'postflight-all-file-hashes-unchanged'",
      "'INCONCLUSIVE'",
      'plateau && beforeEof',
      'requestAnimationFrame',
      'ledger.starts === startsAtAbort',
      'ledger.lateStarts === 0',
      'parts.push(next.value)',
      'part.original.every',
      'indexedFixtureHashes',
    ])
      expect(runner).toContain(guard);
    expect(runner).not.toMatch(/textContent\s*=\s*(?:error|file|bytes)|\.message\s*\)/);
    const buildScript = readFileSync(
      resolve(ROOT, 'scripts/build-official-zip-browser.mjs'),
      'utf8'
    );
    expect(buildScript).toContain('configFile: false');
    expect(buildScript).toContain('publicDir: false');
    expect(buildScript).toContain('modulePreload: false');
    expect(buildScript).not.toMatch(/@crxjs|from ['"].*vite\.config|emptyOutDir: true/);
  });
});
