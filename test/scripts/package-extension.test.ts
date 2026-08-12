import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// @ts-expect-error -- plain .mjs build tooling, no type declarations
import {
  archiveName,
  readReleaseVersion,
  stageExtension,
} from '../../scripts/package-extension.mjs';

const tempDirs: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'liska-package-test-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'src'));
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('release version validation', () => {
  it('accepts matching package and manifest versions', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '3.1.0' }));
    writeFileSync(join(root, 'src', 'manifest.json'), JSON.stringify({ version: '3.1.0' }));

    expect(readReleaseVersion(root)).toBe('3.1.0');
    expect(archiveName('3.1.0')).toBe('liska-threadkeeper-3.1.0.zip');
  });

  it('accepts Chrome versions with one to four bounded integer components', () => {
    expect(archiveName('1')).toBe('liska-threadkeeper-1.zip');
    expect(archiveName('0.1.0.0')).toBe('liska-threadkeeper-0.1.0.0.zip');
    expect(archiveName('3.1.2.4567')).toBe('liska-threadkeeper-3.1.2.4567.zip');
    expect(archiveName('65535.65535.65535.65535')).toBe(
      'liska-threadkeeper-65535.65535.65535.65535.zip'
    );
  });

  it('rejects mismatched package and manifest versions', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '3.1.0' }));
    writeFileSync(join(root, 'src', 'manifest.json'), JSON.stringify({ version: '3.0.0' }));

    expect(() => readReleaseVersion(root)).toThrow(/version mismatch/i);
  });

  it('rejects versions Chrome cannot publish', () => {
    expect(() => archiveName('v3.1.0')).toThrow(/unsupported/i);
    expect(() => archiveName('3.1.0-beta.1')).toThrow(/unsupported/i);
    expect(() => archiveName('')).toThrow(/unsupported/i);
    expect(() => archiveName('0.0.0')).toThrow(/unsupported/i);
    expect(() => archiveName('03.1.0')).toThrow(/unsupported/i);
    expect(() => archiveName('99999.0.0')).toThrow(/unsupported/i);
    expect(() => archiveName('1.2.3.4.5')).toThrow(/unsupported/i);
  });
});

describe('stageExtension', () => {
  it('copies release files while excluding Vite internals and OS metadata', () => {
    const root = makeRoot();
    const source = join(root, 'dist');
    const target = join(root, 'staged');
    mkdirSync(join(source, 'assets'), { recursive: true });
    mkdirSync(join(source, '.vite'), { recursive: true });
    writeFileSync(join(source, 'manifest.json'), '{}');
    writeFileSync(join(source, 'assets', 'index.js'), 'content');
    writeFileSync(join(source, '.vite', 'manifest.json'), 'internal');
    writeFileSync(join(source, '.DS_Store'), 'junk');

    stageExtension(source, target);

    expect(readFileSync(join(target, 'manifest.json'), 'utf8')).toBe('{}');
    expect(readFileSync(join(target, 'assets', 'index.js'), 'utf8')).toBe('content');
    expect(() => readFileSync(join(target, '.vite', 'manifest.json'))).toThrow();
    expect(() => readFileSync(join(target, '.DS_Store'))).toThrow();
  });
});
