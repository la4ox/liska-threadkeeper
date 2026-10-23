// @vitest-environment node
/** Fitness function: tracked source text must not contain hidden control bytes. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const sourceRoots = ['src', 'test', 'scripts'];
const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.html',
  '.md',
  '.snap',
  '.txt',
  '.svg',
  '.yml',
  '.yaml',
]);

/** Diagnostics deliberately contain no source content, only a byte location. */
function controlBytes(file: string, bytes: Uint8Array): string[] {
  const violations: string[] = [];
  bytes.forEach((byte, offset) => {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      violations.push(`${file}:${offset} 0x${byte.toString(16).padStart(2, '0').toUpperCase()}`);
    }
  });
  return violations;
}

/** The Git inventory is the only discovery input; there is no directory walk. */
function scanTrackedText(listing: string, read: (file: string) => Uint8Array) {
  const files = listing
    .split('\0')
    .filter(
      file =>
        sourceRoots.some(directory => file.startsWith(`${directory}/`)) &&
        textExtensions.has(path.posix.extname(file).toLowerCase())
    );
  return { files, violations: files.flatMap(file => controlBytes(file, read(file))) };
}

type PathKind = {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

/** Refuse links/reparse points before opening a tracked working-tree file. */
function readTrackedRegularFile(
  file: string,
  lstat: (file: string) => PathKind = fs.lstatSync,
  read: (file: string) => Uint8Array = fs.readFileSync
): Uint8Array {
  const components = file.split('/');
  let candidate = root;

  for (const [index, component] of components.entries()) {
    candidate = path.join(candidate, component);
    const kind = lstat(candidate);
    if (kind.isSymbolicLink()) {
      throw new Error(`Refusing linked tracked path: ${file}`);
    }
    const isLeaf = index === components.length - 1;
    if ((!isLeaf && !kind.isDirectory()) || (isLeaf && !kind.isFile())) {
      throw new Error(`Refusing non-regular tracked path: ${file}`);
    }
  }

  return read(candidate);
}

describe('architecture: tracked source is text', () => {
  it('allows TAB, LF, CR, printable text and UTF-8 bytes without changing them', () => {
    const bytes = Buffer.from('text\tLF\nCRLF\r\nbackslash \\ café 中文 💙');
    expect(controlBytes('src/allowed.ts', bytes)).toEqual([]);
  });

  it('rejects every other byte below 0x20 with content-free byte offsets', () => {
    const disallowed = Array.from({ length: 0x20 }, (_, byte) => byte).filter(
      byte => ![0x09, 0x0a, 0x0d].includes(byte)
    );
    expect(disallowed).toHaveLength(29);
    for (const byte of disallowed) {
      // The UTF-8 prefix occupies two bytes, not one character.
      const bytes = Buffer.concat([Buffer.from('é'), Buffer.from([byte])]);
      expect(controlBytes('test/bad.test.ts', bytes)).toEqual([
        `test/bad.test.ts:2 0x${byte.toString(16).padStart(2, '0').toUpperCase()}`,
      ]);
    }
    expect(controlBytes('scripts/two.mjs', Uint8Array.of(0x00, 0x41, 0x1b))).toEqual([
      'scripts/two.mjs:0 0x00',
      'scripts/two.mjs:2 0x1B',
    ]);
  });

  it('propagates tracked-file violations without including surrounding content', () => {
    const bytes = Buffer.from('private prefix\0private suffix');
    const { files, violations } = scanTrackedText('src/bad.ts\0', () => bytes);

    expect(files).toEqual(['src/bad.ts']);
    expect(violations).toEqual(['src/bad.ts:14 0x00']);
    expect(bytes).toEqual(Buffer.from('private prefix\0private suffix'));
  });

  it('reads only NUL-listed tracked text, not untracked, private or binary artifacts', () => {
    const trackedText = [
      'src/public.ts',
      'test/with spaces\nand newline.test.ts',
      'scripts/check.mjs',
    ];
    const excluded = [
      'src/untracked-private.ts',
      'test/untracked-private.test.ts',
      'src/icon.png',
      'e2e/auth.json',
      'downloads/private.txt',
      'auth/session.json',
      'baseline/private.json',
    ];
    const disk = new Map<string, Uint8Array>([
      ...trackedText.map(file => [file, Buffer.from('safe\r\n')] as const),
      ...excluded.map(file => [file, Uint8Array.of(0x00)] as const),
    ]);
    const read = vi.fn((file: string) => disk.get(file)!);
    // The first two excluded files exist on disk but are not in Git's inventory.
    const listing = [...trackedText, ...excluded.slice(2)].join('\0') + '\0';
    const result = scanTrackedText(listing, read);

    expect(result.files).toEqual(trackedText);
    expect(result.violations).toEqual([]);
    expect(read.mock.calls.map(([file]) => file)).toEqual(trackedText);
    expect(read).toHaveBeenCalledTimes(3);
    expect(disk.size).toBe(10);
  });

  it('rejects a linked path component before reading its target', () => {
    const linkSuffix = path.join('src', 'linked');
    const lstat = vi.fn(
      (candidate: string): PathKind => ({
        isDirectory: () => candidate.endsWith(`${path.sep}src`),
        isFile: () => candidate.endsWith('private.ts'),
        isSymbolicLink: () => candidate.endsWith(linkSuffix),
      })
    );
    const read = vi.fn(() => Buffer.from('private target'));

    expect(() => readTrackedRegularFile('src/linked/private.ts', lstat, read)).toThrow(
      'Refusing linked tracked path: src/linked/private.ts'
    );
    expect(read).not.toHaveBeenCalled();
    expect(lstat).toHaveBeenCalledTimes(2);
  });

  it('checks the non-empty tracked src/test/scripts inventory', () => {
    const listing = execFileSync('git', ['ls-files', '-z', '--', ...sourceRoots], {
      cwd: root,
      encoding: 'utf8',
    });
    const { files, violations } = scanTrackedText(listing, readTrackedRegularFile);

    expect(files.length).toBeGreaterThan(0);
    expect(new Set(files).size).toBe(files.length);
    for (const directory of sourceRoots) {
      expect(
        files.some(file => file.startsWith(`${directory}/`)),
        directory
      ).toBe(true);
    }
    expect(files).toContain('src/content/markdown.ts');
    expect(files).toContain('test/lib/message-count-flatten-seam.test.ts');
    expect(violations).toEqual([]);
  });
});
