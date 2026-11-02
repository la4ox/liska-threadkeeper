// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  cpSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { createHash } from 'node:crypto';
// @ts-expect-error -- Node-only plain .mjs tooling
import {
  extractZipManifest,
  BUILD_COMPARE_LIMITS,
  comparisonLimits,
  archiveSha256,
  downloadReleaseAsset,
} from '../../scripts/lib/build-compare-zip.mjs';
// @ts-expect-error -- Node-only plain .mjs tooling
import { buildManifest, isExcluded } from '../../scripts/lib/build-compare.mjs';
// @ts-expect-error -- Node-only plain .mjs tooling
import { downloadReleaseZip } from '../../scripts/compare-build.mjs';

const observed = vi.hoisted(() => ({ chunks: [] as number[] }));
vi.mock('node:crypto', async importOriginal => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return {
    ...original,
    createHash: (...args: Parameters<typeof original.createHash>) => {
      const hash = original.createHash(...args);
      const update = hash.update.bind(hash);
      hash.update = ((data: Buffer) => {
        observed.chunks.push(data.length);
        return update(data);
      }) as typeof hash.update;
      return hash;
    },
  };
});
vi.mock('child_process', async importOriginal => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, execFileSync: vi.fn(original.execFileSync), spawn: vi.fn(original.spawn) };
});

const temps: string[] = [];
function temp() {
  const path = mkdtempSync(join(tmpdir(), 'liska-zip-test-'));
  temps.push(path);
  return path;
}
afterEach(() => {
  vi.clearAllMocks();
  observed.chunks.length = 0;
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

// Independent, deterministic ZIP producer and CRC (not yauzl or production CRC).
function checksum(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}
interface Spec {
  name: string;
  text?: string;
  method?: number;
  flags?: number;
  attributes?: number;
  expanded?: number;
  crc?: number;
  nameBytes?: Buffer;
  extra?: Buffer;
  descriptor?: boolean;
}
function fixture(specs: Spec[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const records: { local: number; central: number; payload: number }[] = [];
  let offset = 0;
  for (const spec of specs) {
    const name = spec.nameBytes ?? Buffer.from(spec.name);
    const plain = Buffer.from(spec.text ?? '');
    const method = spec.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(plain) : plain;
    const crc = spec.crc ?? checksum(plain);
    const flags = (spec.flags ?? 0x800) | (spec.descriptor ? 8 : 0);
    const extra = spec.extra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!spec.descriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(spec.expanded ?? plain.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(spec.expanded ?? plain.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE((spec.attributes ?? 0) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    const descriptor = Buffer.alloc(spec.descriptor ? 16 : 0);
    if (spec.descriptor) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(spec.expanded ?? plain.length, 12);
    }
    records.push({ local: offset, central: 0, payload: offset + 30 + name.length + extra.length });
    locals.push(local, name, extra, compressed, descriptor);
    centrals.push(Buffer.concat([central, name, extra]));
    offset += 30 + name.length + extra.length + compressed.length + descriptor.length;
  }
  const centralStart = offset;
  centrals.forEach((central, index) => {
    records[index].central = offset;
    offset += central.length;
  });
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(specs.length, 8);
  end.writeUInt16LE(specs.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  return { zip: Buffer.concat([...locals, ...centrals, end]), records };
}
function input(bytes: Buffer) {
  const root = temp();
  const zip = join(root, 'input.zip');
  writeFileSync(zip, bytes);
  return { zip, destination: join(root, 'extracted') };
}
async function extract(bytes: Buffer, limits = {}) {
  const { zip, destination } = input(bytes);
  return extractZipManifest(zip, destination, { limits, isExcluded });
}

describe('bounded ZIP extraction', () => {
  it('accepts STORE/DEFLATE, native ./ root, Unicode/spaces, descriptors and empty directories', async () => {
    const specs: Spec[] = [
      { name: './', attributes: 0x41ed0010 },
      { name: './assets/', attributes: 0x41ed0010 },
      { name: './assets/Лиса café.js', text: 'hello π', method: 8, descriptor: true },
      { name: './manifest.json', text: '{}' },
      { name: './empty/', attributes: 0x41ed0010, method: 8 },
      { name: './.vite/internal', text: 'metadata' },
      { name: './nested/.DS_Store', text: 'finder' },
      { name: './folder.DS_Store/child.js', text: 'excluded descendant' },
    ];
    const { zip, destination } = input(fixture(specs).zip);
    const manifest = await extractZipManifest(zip, destination, { isExcluded });
    expect(manifest).toEqual(await buildManifest(destination));
    expect([...manifest.keys()]).toEqual(['assets/Лиса café.js', 'manifest.json']);
    expect(existsSync(join(destination, 'empty'))).toBe(true);
    expect(readFileSync(join(destination, '.vite', 'internal'), 'utf8')).toBe('metadata');
    expect(readFileSync(zip)).toEqual(fixture(specs).zip);
  });

  it('rejects even an excluded high-ratio bomb before creating the destination', async () => {
    const { zip, destination } = input(
      fixture([{ name: '.vite/bomb', text: 'x'.repeat(100_000), method: 8 }]).zip
    );
    await expect(extractZipManifest(zip, destination, { isExcluded })).rejects.toThrow(/ratio/);
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(zip)).toBe(true);
  });

  it('accepts CRC-bound Unicode path metadata but rejects ambiguous legacy names', async () => {
    const raw = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    const name = Buffer.from('café');
    const extra = Buffer.alloc(9 + name.length);
    extra.writeUInt16LE(0x7075);
    extra.writeUInt16LE(5 + name.length, 2);
    extra[4] = 1;
    extra.writeUInt32LE(checksum(raw), 5);
    name.copy(extra, 9);
    expect([
      ...(await extract(fixture([{ name: '', nameBytes: raw, flags: 0, extra }]).zip)).keys(),
    ]).toEqual(['café']);
    await expect(extract(fixture([{ name: '', nameBytes: raw, flags: 0 }]).zip)).rejects.toThrow(
      /ambiguous/
    );
    extra.writeUInt32LE(0, 5);
    await expect(
      extract(fixture([{ name: '', nameBytes: raw, flags: 0, extra }]).zip)
    ).rejects.toThrow(/ambiguous/);
  });

  it.each([
    ['archiveBytes', [{ name: 'a', text: 'abc' }], 103],
    ['entries', [{ name: 'a' }, { name: 'b' }], 2],
    ['entryBytes', [{ name: 'a', text: 'abc' }], 3],
    [
      'totalBytes',
      [
        { name: 'a', text: 'ab' },
        { name: 'b', text: 'cd' },
      ],
      4,
    ],
    ['pathBytes', [{ name: 'a/b' }], 3],
    ['depth', [{ name: 'a/b/c' }], 3],
    ['metadataBytes', [{ name: 'a/b' }], 107],
    ['metadataBytes', [], 22],
  ] as [string, Spec[], number][])(
    'enforces exact and +1 %s ceilings',
    async (limit, specs, ceiling) => {
      const data = fixture(specs).zip;
      if (limit === 'archiveBytes') ceiling = data.length;
      await expect(extract(data, { [limit]: ceiling })).resolves.toBeInstanceOf(Map);
      await expect(extract(data, { [limit]: ceiling - 1 })).rejects.toThrow(/limit/);
    }
  );

  it('enforces an exact ratio ceiling and validates every lower-only override', async () => {
    const text = 'a'.repeat(120);
    const compressed = deflateRawSync(Buffer.from(text)).length;
    expect(text.length % compressed).toBe(0);
    const ratio = text.length / compressed;
    await expect(
      extract(fixture([{ name: 'a', text, method: 8 }]).zip, { ratio })
    ).resolves.toBeInstanceOf(Map);
    await expect(
      extract(fixture([{ name: 'a', text, method: 8 }]).zip, { ratio: ratio - 1 })
    ).rejects.toThrow(/ratio/);
    for (const [name, value] of Object.entries(BUILD_COMPARE_LIMITS)) {
      expect(() => comparisonLimits({ [name]: (value as number) + 1 })).toThrow();
    }
    for (const limits of [
      { entries: 0 },
      { entries: 1.1 },
      { entries: NaN },
      { unknown: 1 },
      null,
      [],
    ]) {
      expect(() => comparisonLimits(limits)).toThrow();
    }
  });

  it.each([
    '../escape',
    'a/../escape',
    '/absolute',
    'C:/drive',
    '//server/share',
    '\\\\server\\share',
    'a\\b',
    'C:relative',
    'a:stream',
    'a\0b',
    'a\nb',
    'a//b',
    'a/./b',
    '././b',
    'trailing.',
    'trailing ',
    'a /file',
    'CON',
    'CONIN$',
    'CONOUT$.txt',
    'CLOCK$',
    'nul.txt',
    'COM1.txt',
    'LPT¹.log',
    'CON .txt',
    'a'.repeat(256),
  ])('rejects unsafe path %j', async name => {
    await expect(extract(fixture([{ name }]).zip)).rejects.toThrow();
  });

  it.each([
    [{ name: 'a' }, { name: './a' }],
    [{ name: 'A' }, { name: 'a' }],
    [{ name: 'café' }, { name: 'cafe\u0301' }],
    [{ name: 'a' }, { name: 'a/b' }],
    [{ name: 'a/b' }, { name: 'a' }],
    [{ name: 'A/b' }, { name: 'a/c' }],
    [{ name: 'A/' }, { name: 'a/b' }],
    [{ name: './' }, { name: './' }],
  ] as Spec[][])('rejects duplicate, Unicode/case and ancestor aliases %#', async (...specs) => {
    await expect(extract(fixture(specs).zip)).rejects.toThrow(/conflict|duplicate|alias/);
  });

  it.each([
    { name: 'link', attributes: 0xa1ff0000 },
    { name: 'fifo', attributes: 0x11ff0000 },
    { name: 'socket', attributes: 0xc1ff0000 },
    { name: 'volume', attributes: 0x08 },
    { name: 'device', attributes: 0x40 },
    { name: 'reparse', attributes: 0x400 },
    { name: 'dir', attributes: 0x41ed0010 },
    { name: 'regular/', attributes: 0x81a40000 },
    { name: 'dir/', text: 'nonempty' },
    { name: 'encrypted', flags: 1 },
    { name: 'unknown', method: 12 },
    { name: 'bad-utf8', nameBytes: Buffer.from([0xc3, 0x28]) },
    { name: '/' },
  ])('rejects special/unsupported/undecodable entry %#', async spec => {
    await expect(extract(fixture([spec]).zip)).rejects.toThrow();
  });

  it('removes partially written trees on CRC/runtime length errors, keeping input ZIPs', async () => {
    for (const malformed of [
      { name: 'bad', text: 'data', crc: 1 },
      { name: 'bad', text: 'runtime length', method: 8, expanded: 1 },
      { name: 'bad', text: 'short', method: 8, expanded: 20 },
    ]) {
      const { zip, destination } = input(
        fixture([{ name: 'first', text: 'written first' }, malformed]).zip
      );
      await expect(extractZipManifest(zip, destination)).rejects.toThrow();
      expect(existsSync(destination)).toBe(false);
      expect(existsSync(zip)).toBe(true);
    }
  });

  it('rejects truncation and central/local disagreement before writing', async () => {
    const data = fixture([{ name: 'a', text: 'abc' }]);
    await expect(extract(data.zip.subarray(0, data.zip.length - 5))).rejects.toThrow();
    const damaged = Buffer.from(data.zip);
    damaged.writeUInt32LE(2, data.records[0].local + 22);
    await expect(extract(damaged)).rejects.toThrow(/mismatch/);
    const badName = Buffer.from(data.zip);
    badName[data.records[0].local + 30] = 0x62;
    await expect(extract(badName)).rejects.toThrow(/metadata mismatch/);
  });

  it('streams large STORE payloads through multiple hash updates and checks archive digests', async () => {
    const text = 'not compressing this STORE payload '.repeat(10_000);
    const expected = createHash('sha256').update(text).digest('hex');
    const { zip, destination } = input(fixture([{ name: 'large', text }]).zip);
    observed.chunks.length = 0;
    expect((await extractZipManifest(zip, destination)).get('large')).toBe(expected);
    expect(observed.chunks.length).toBeGreaterThan(1);
    expect(Math.max(...observed.chunks)).toBeLessThan(Buffer.byteLength(text));
    expect(await archiveSha256(zip)).toBe(
      createHash('sha256').update(readFileSync(zip)).digest('hex')
    );
  });

  it('does not overwrite an existing destination', async () => {
    const { zip, destination } = input(fixture([{ name: 'a' }]).zip);
    mkdirSync(destination);
    writeFileSync(join(destination, 'sentinel'), 'keep');
    await expect(extractZipManifest(zip, destination)).rejects.toThrow();
    expect(readFileSync(join(destination, 'sentinel'), 'utf8')).toBe('keep');
  });

  it('continues skipping local symlinks rather than hashing their targets', async () => {
    const root = temp();
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'regular'), 'kept');
    // Junctions are available without Windows symlink privilege.
    symlinkSync(source, join(source, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
    expect([...(await buildManifest(source)).keys()]).toEqual(['regular']);
    await expect(buildManifest(source, { entries: 1 })).rejects.toThrow(/entries/);
  });

  it('accepts the ordinary native producer archive without external extraction', async () => {
    const root = temp();
    const staged = join(root, 'staged');
    mkdirSync(staged);
    mkdirSync(join(staged, 'empty'));
    writeFileSync(join(staged, 'manifest.json'), '{}');
    writeFileSync(join(staged, 'content.js'), 'hello');
    const zip = join(root, 'native.zip');
    const { execFileSync: nativeExec } =
      await vi.importActual<typeof import('child_process')>('child_process');
    if (process.platform === 'win32')
      nativeExec('tar.exe', ['-a', '-c', '-f', zip, '.'], { cwd: staged });
    else nativeExec('zip', ['-q', '-r', zip, '.'], { cwd: staged });
    expect(await extractZipManifest(zip, join(root, 'extracted'))).toEqual(
      await buildManifest(staged)
    );
  });
});

describe('actual CLI lifecycle', () => {
  function project() {
    const root = temp();
    cpSync(resolve('scripts', 'compare-build.mjs'), join(root, 'scripts', 'compare-build.mjs'), {
      recursive: true,
    });
    mkdirSync(join(root, 'scripts', 'lib'));
    for (const name of ['build-compare.mjs', 'build-compare-zip.mjs'])
      cpSync(resolve('scripts', 'lib', name), join(root, 'scripts', 'lib', name));
    symlinkSync(
      resolve('node_modules'),
      join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        type: 'module',
        version: '0.0.1',
        repository: 'https://github.com/la4ox/liska-threadkeeper',
        scripts: { build: 'node build.mjs' },
      })
    );
    writeFileSync(
      join(root, 'build.mjs'),
      "import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'; mkdirSync('dist',{recursive:true}); writeFileSync('dist/manifest.json','{}'); writeFileSync('counter',String(existsSync('counter')?Number(readFileSync('counter','utf8'))+1:1));"
    );
    const scratch = join(root, 'scratch');
    mkdirSync(scratch);
    return {
      root,
      scratch,
      env: {
        ...process.env,
        TEMP: scratch,
        TMP: scratch,
        TMPDIR: scratch,
        NODE_DISABLE_COMPILE_CACHE: '1',
      },
    };
  }

  it.each([
    ['identical', '{}', undefined, 0],
    ['mismatch', '{"different":true}', undefined, 1],
    ['operational', '{}', 1, 2],
  ] as const)(
    'preserves %s exit and --keep behavior through the real shell/build boundary',
    async (_label, text, crc, status) => {
      const { root, scratch, env } = project();
      const bytes = fixture([{ name: 'manifest.json', text, crc }]).zip;
      const zip = join(root, 'comparison.zip');
      writeFileSync(zip, bytes);
      const { spawnSync } = await vi.importActual<typeof import('child_process')>('child_process');
      const result = spawnSync(
        process.execPath,
        [
          join(root, 'scripts', 'compare-build.mjs'),
          '--ci-zip',
          zip,
          '--tag',
          'unused-tag',
          '--keep',
        ],
        { cwd: root, env, encoding: 'utf8' }
      );
      expect(result.stderr).not.toMatch(/gh release|not recognized/);
      expect(result.status, result.stdout + result.stderr).toBe(status);
      expect(readFileSync(zip)).toEqual(bytes);
      if (status === 2) {
        expect(readdirSync(scratch)).toEqual([]);
        expect(result.stdout).not.toContain('kept temp dirs');
      } else {
        expect(result.stdout).toContain('kept temp dirs');
        expect(readdirSync(scratch)).toHaveLength(1);
        expect(
          readFileSync(join(scratch, readdirSync(scratch)[0], 'contents', 'manifest.json'), 'utf8')
        ).toBe(text);
      }
    }
  );

  it('--twice wins over --ci-zip/--tag and builds exactly twice', async () => {
    const { root, scratch, env } = project();
    const { spawnSync } = await vi.importActual<typeof import('child_process')>('child_process');
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'scripts', 'compare-build.mjs'),
        '--twice',
        '--ci-zip',
        'missing.zip',
        '--tag',
        'unused',
      ],
      { cwd: root, env, encoding: 'utf8' }
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(join(root, 'counter'), 'utf8')).toBe('2');
    expect(readdirSync(scratch)).toEqual([]);
  });
});

describe('release metadata/download transition', () => {
  const endpoint = 'repos/la4ox/liska-threadkeeper/releases/assets/123';
  const apiUrl = `https://api.github.com/${endpoint}`;
  function producer(chunks: Buffer[], code = 0, diagnostic = '') {
    let produced = 0;
    const stdout = Readable.from(
      (async function* () {
        for (const chunk of chunks) {
          produced++;
          yield chunk;
        }
      })(),
      { highWaterMark: 1 }
    );
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    child.kill.mockImplementation(() => {
      stdout.destroy();
      child.stderr.destroy();
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
      return true;
    });
    stdout.once('end', () => {
      child.stderr.end(diagnostic);
      queueMicrotask(() => child.emit('close', code, null));
    });
    vi.mocked(spawn).mockImplementation((command, args, options) => {
      expect(command).toBe('gh');
      expect(args).toEqual([
        'api',
        endpoint,
        '--hostname',
        'github.com',
        '-H',
        'Accept: application/octet-stream',
      ]);
      expect(options).toMatchObject({ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      return child as unknown as ChildProcess;
    });
    return { child, produced: () => produced };
  }

  it.each([null, `sha256:${'0'.repeat(64)}`, 'matching'])(
    'pins the admitted API identity and checks streamed bytes/digest %s',
    async digest => {
      const bytes = fixture([{ name: 'manifest.json', text: '{}' }]).zip;
      const name = 'liska-threadkeeper-test.zip';
      const sha = createHash('sha256').update(bytes).digest('hex');
      vi.mocked(execFileSync).mockImplementation((command, args) => {
        expect(command).toBe('gh');
        expect(args).toContain('--repo');
        expect(args).toContain('la4ox/liska-threadkeeper');
        expect(args?.[1]).toBe('view');
        return Buffer.from(
          JSON.stringify({
            assets: [
              {
                name,
                size: bytes.length,
                digest: digest === 'matching' ? `sha256:${sha}` : digest,
                apiUrl,
              },
            ],
          })
        );
      });
      producer([bytes.subarray(0, 10), bytes.subarray(10)]);
      if (digest && digest !== 'matching')
        await expect(downloadReleaseZip('vtest')).rejects.toThrow(/SHA-256/);
      else {
        const zip = await downloadReleaseZip('vtest');
        temps.push(dirname(zip));
        expect(readFileSync(zip)).toEqual(bytes);
      }
      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects a truncated transfer against the expected size', async () => {
    const bytes = fixture([{ name: 'a' }]).zip;
    const name = 'liska-threadkeeper-test.zip';
    vi.mocked(execFileSync).mockReturnValue(
      Buffer.from(JSON.stringify({ assets: [{ name, size: bytes.length, apiUrl }] }))
    );
    producer([bytes.subarray(1)]);
    await expect(downloadReleaseZip('vtest')).rejects.toThrow(/metadata/);
  });

  it('aborts a replacement stream before retaining ceiling+1, without consuming its remaining chunks', async () => {
    const destination = join(temp(), 'download.zip');
    const limit = 16 * 1024;
    const stream = producer(Array.from({ length: 1000 }, () => Buffer.alloc(4096)));
    let retainedAtKill = -1;
    const kill = stream.child.kill.getMockImplementation()!;
    stream.child.kill.mockImplementation(() => {
      retainedAtKill = statSync(destination).size;
      return kill();
    });
    await expect(
      downloadReleaseAsset({ endpoint, size: limit, digest: null }, destination, {
        limits: { archiveBytes: limit },
      })
    ).rejects.toThrow(/byte limit/);
    expect(stream.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(retainedAtKill).toBeGreaterThanOrEqual(0);
    expect(retainedAtKill).toBeLessThanOrEqual(limit);
    expect(stream.produced()).toBeLessThan(1000);
    expect(existsSync(destination)).toBe(false);
  });

  it('caps at advertised size even below the production transfer ceiling', async () => {
    const destination = join(temp(), 'download.zip');
    const stream = producer([Buffer.from('1234'), Buffer.from('replacement')]);
    await expect(downloadReleaseAsset({ endpoint, size: 4 }, destination)).rejects.toThrow(
      /byte limit/
    );
    expect(stream.child.kill).toHaveBeenCalled();
    expect(existsSync(destination)).toBe(false);
  });

  it('requires a successful child exit and bounds captured stderr', async () => {
    const destination = join(temp(), 'download.zip');
    producer([Buffer.from('abcd')], 1, 'x'.repeat(100_000));
    const error = await downloadReleaseAsset({ endpoint, size: 4 }, destination).catch(
      (error: Error) => error
    );
    expect(error.message).toMatch(/gh api download failed/);
    expect(error.message.length).toBeLessThan(8400);
    expect(existsSync(destination)).toBe(false);
  });

  it('settles a spawn error even if the child never emits close', async () => {
    const destination = join(temp(), 'download.zip');
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn failed')));
      return child as unknown as ChildProcess;
    });
    await expect(downloadReleaseAsset({ endpoint, size: 4 }, destination)).rejects.toThrow(
      /spawn failed/
    );
    expect(child.kill).toHaveBeenCalled();
    expect(existsSync(destination)).toBe(false);
  });

  it('kills and cleans up a stalled transfer on its finite timeout', async () => {
    const destination = join(temp(), 'download.zip');
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    await expect(
      downloadReleaseAsset({ endpoint, size: 4 }, destination, { timeoutMs: 20 })
    ).rejects.toThrow(/timed out/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(existsSync(destination)).toBe(false);
  });

  it.each(['stdout', 'stderr'] as const)(
    'settles a %s error without waiting for child close',
    async pipe => {
      const destination = join(temp(), 'download.zip');
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });
      vi.mocked(spawn).mockImplementation(() => {
        queueMicrotask(() => child[pipe].destroy(new Error('pipe failed')));
        return child as unknown as ChildProcess;
      });
      await expect(downloadReleaseAsset({ endpoint, size: 4 }, destination)).rejects.toThrow(
        /pipe failed/
      );
      expect(child.kill).toHaveBeenCalled();
      expect(existsSync(destination)).toBe(false);
    }
  );

  it('does not overwrite or remove a pre-existing download path', async () => {
    const destination = join(temp(), 'download.zip');
    writeFileSync(destination, 'sentinel');
    await expect(downloadReleaseAsset({ endpoint, size: 4 }, destination)).rejects.toThrow();
    expect(readFileSync(destination, 'utf8')).toBe('sentinel');
    expect(spawn).not.toHaveBeenCalled();
  });
});
