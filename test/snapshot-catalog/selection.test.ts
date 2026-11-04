import { describe, expect, it, vi } from 'vitest';
import { CATALOG_PAGE_LIMITS as LIMITS } from '../../src/snapshot-catalog/limits';
import {
  preflightSelection,
  readSelectedManifests,
  SelectionError,
  snapshotSelectedArchive,
} from '../../src/snapshot-catalog/selection';
import { deferred, picked, CANARY } from './fixtures';

describe('catalog selected FileList boundary', () => {
  it('snapshots all metadata synchronously and binds only manifest readers', async () => {
    const manifest = picked(`${CANARY}/one/manifest.json`);
    const raw = picked(`${CANARY}/one/responses/${CANARY}.json`);
    const canonical = picked(`${CANARY}/one/canonical.json`);
    const asset = picked(`${CANARY}/one/assets/image.png`);
    const unreadable = vi.fn(() => {
      throw new Error(CANARY);
    });
    for (const source of [raw, canonical, asset])
      Object.defineProperty(source.file, 'arrayBuffer', { get: unreadable });
    const list = [manifest.file, raw.file, canonical.file, asset.file];
    const selected = snapshotSelectedArchive(list);
    const replacement = vi.fn(() => {
      throw new Error(CANARY);
    });
    Object.defineProperty(manifest.file, 'arrayBuffer', { value: replacement });
    Object.defineProperty(manifest.file, 'webkitRelativePath', { value: 'changed/bad' });
    Object.defineProperty(manifest.file, 'size', { value: Infinity });
    list.length = 0;
    const progress = vi.fn();
    const result = await readSelectedManifests(selected, new AbortController().signal, progress);
    expect(result.files).toHaveLength(4);
    expect(result.files[0]).toEqual({ relativePath: 'one/manifest.json', byteLength: 2 });
    expect(result.manifests).toEqual([
      { relativePath: 'one/manifest.json', bytes: manifest.bytes },
    ]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected.files)).toBe(true);
    expect(unreadable).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(manifest.read).toHaveBeenCalledOnce();
    expect(raw.read).not.toHaveBeenCalled();
    expect(canonical.read).not.toHaveBeenCalled();
    expect(asset.read).not.toHaveBeenCalled();
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { manifests: 0, bytes: 0, totalManifests: 1, totalBytes: 2 },
      { manifests: 1, bytes: 2, totalManifests: 1, totalBytes: 2 },
    ]);
  });

  it.each([
    'manifest.json',
    '/a/manifest.json',
    'r//manifest.json',
    'r/../manifest.json',
    'r/./manifest.json',
    'r/x\\manifest.json',
    'r/x:manifest.json',
    'r/a./manifest.json',
    'r/a /manifest.json',
    'r/a\u0000/manifest.json',
    'r/a\u202e/manifest.json',
    'r/a?/manifest.json',
    'r/a*/manifest.json',
    'r/con/manifest.json',
    'r/LPT1.txt/manifest.json',
    'r/' + 'a'.repeat(513),
  ])('rejects unsafe path %s before reads', path => {
    const source = picked(path);
    expect(() => snapshotSelectedArchive([source.file])).toThrow(SelectionError);
    expect(source.read).not.toHaveBeenCalled();
  });

  it('rejects mixed picker roots and case-folded or normalized duplicate slots', () => {
    for (const paths of [
      ['one/manifest.json', 'two/manifest.json'],
      ['r/A/manifest.json', 'r/a/MANIFEST.json'],
      ['r/A/file.txt', 'r/a/FILE.txt'],
      ['r/é/file', 'r/e\u0301/file'],
    ])
      expect(() => snapshotSelectedArchive(paths.map(value => picked(value).file))).toThrow(
        SelectionError
      );
  });

  it('fails closed on non-exact manifest casing without reading or binding it', () => {
    const source = picked('root/a/Manifest.JSON');
    const reader = vi.fn(() => {
      throw new Error(CANARY);
    });
    Object.defineProperty(source.file, 'arrayBuffer', { get: reader });
    expect(() => snapshotSelectedArchive([source.file])).toThrow('selection-invalid');
    expect(reader).not.toHaveBeenCalled();
    expect(source.read).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects hostile size %s',
    size => {
      const source = picked('r/manifest.json', '{}', size);
      expect(() => snapshotSelectedArchive([source.file])).toThrow(SelectionError);
      expect(source.read).not.toHaveBeenCalled();
    }
  );

  it('rejects hostile FileLists and getters with fixed errors', () => {
    for (const list of [
      { length: -1 },
      { length: Infinity },
      { length: 0.5 },
      { length: 1 },
      Object.defineProperty({}, 'length', {
        get() {
          throw new Error(CANARY);
        },
      }),
      {
        length: 1,
        0: Object.defineProperty({}, 'webkitRelativePath', {
          get() {
            throw new Error(CANARY);
          },
        }),
      },
    ])
      expect(() => snapshotSelectedArchive(list as FileList)).toThrow('selection-invalid');
  });

  it('enforces independent full-operation limits before any body read', async () => {
    const read = vi.fn(async () => new ArrayBuffer(2));
    const file = (relativePath: string, byteLength: number, manifest = false) => ({
      relativePath,
      byteLength,
      ...(manifest ? { readManifest: read } : {}),
    });
    const cases = [
      Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => file(`f${i}`, 0)),
      Array.from({ length: LIMITS.maxManifests + 1 }, (_, i) =>
        file(`m${i}/manifest.json`, 2, true)
      ),
      [file('manifest.json', LIMITS.maxManifestBytes + 1, true)],
      Array.from({ length: 33 }, (_, i) =>
        file(`m${i}/manifest.json`, LIMITS.maxManifestBytes, true)
      ),
      [file('manifest.json', 2, true), file('extra', LIMITS.maxFileBytes + 1)],
      Array.from({ length: 9 }, (_, i) => file(`f${i}`, LIMITS.maxFileBytes)),
      [file('manifest.json', 2, true), file('../bad', 2)],
      [file('manifest.json', 2, true), file('other', 2, true)],
    ];
    for (const files of cases) {
      await expect(
        readSelectedManifests({ files }, new AbortController().signal, vi.fn())
      ).rejects.toBeInstanceOf(SelectionError);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('reads sequentially with exact progress, never raw bytes', async () => {
    const first = picked('r/a/manifest.json', 'one');
    const second = picked('r/b/manifest.json', 'two2');
    const raw = picked('r/a/responses/raw.json');
    const pending = deferred<ArrayBuffer>();
    first.read.mockReturnValueOnce(pending.promise);
    const archive = snapshotSelectedArchive([first.file, raw.file, second.file]);
    const progress = vi.fn();
    const result = readSelectedManifests(archive, new AbortController().signal, progress);
    expect(first.read).toHaveBeenCalledOnce();
    expect(second.read).not.toHaveBeenCalled();
    pending.resolve(first.bytes.buffer);
    await expect(result).resolves.toMatchObject({
      files: expect.any(Array),
      manifests: expect.any(Array),
    });
    expect(second.read).toHaveBeenCalledOnce();
    expect(raw.read).not.toHaveBeenCalled();
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { manifests: 0, bytes: 0, totalManifests: 2, totalBytes: 7 },
      { manifests: 1, bytes: 3, totalManifests: 2, totalBytes: 7 },
      { manifests: 2, bytes: 7, totalManifests: 2, totalBytes: 7 },
    ]);
  });

  it('cancels before and between reads, dropping late resolution and progress', async () => {
    const first = picked('r/a/manifest.json');
    const second = picked('r/b/manifest.json');
    const archive = snapshotSelectedArchive([first.file, second.file]);
    const abort = new AbortController();
    abort.abort();
    await expect(readSelectedManifests(archive, abort.signal, vi.fn())).rejects.toThrow(
      'catalog-operation-cancelled'
    );
    expect(first.read).not.toHaveBeenCalled();
    const pending = deferred<ArrayBuffer>();
    first.read.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const progress = vi.fn();
    const result = readSelectedManifests(archive, controller.signal, progress);
    controller.abort();
    pending.resolve(first.bytes.buffer);
    await expect(result).rejects.toThrow('catalog-operation-cancelled');
    expect(second.read).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledOnce();
  });

  it.each(['reject', 'short', 'wrong-type'])('reports a fixed read error for %s', async mode => {
    const source = picked('r/manifest.json');
    if (mode === 'reject') source.read.mockRejectedValueOnce(new Error(CANARY));
    else
      source.read.mockResolvedValueOnce(
        mode === 'short' ? new ArrayBuffer(1) : ({} as ArrayBuffer)
      );
    await expect(
      readSelectedManifests(
        snapshotSelectedArchive([source.file]),
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toThrow('selection-read-failed');
  });

  it('accepts a metadata-only root without reading any file', async () => {
    const source = picked('r/file.bin');
    const archive = snapshotSelectedArchive([source.file]);
    expect(preflightSelection(archive)).toEqual({
      files: 1,
      bytes: 2,
      manifests: 0,
      manifestBytes: 0,
    });
    await expect(
      readSelectedManifests(archive, new AbortController().signal, vi.fn())
    ).resolves.toEqual({ files: [{ relativePath: 'file.bin', byteLength: 2 }], manifests: [] });
    expect(source.read).not.toHaveBeenCalled();
  });
});
