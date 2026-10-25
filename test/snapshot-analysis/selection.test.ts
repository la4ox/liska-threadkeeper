import { describe, expect, it, vi } from 'vitest';
import {
  snapshotSelectedFiles,
  preflightSelection,
  readSelectedSnapshots,
} from '../../src/snapshot-analysis/selection';
import { CANARY, picked, deferred } from './fixtures';

const folder = (root = 'snapshot', count = 1) =>
  snapshotSelectedFiles(Array.from({ length: count }, (_, i) => picked(`${root}/f${i}.json`).file));

describe('snapshot directory selection', () => {
  it('sanitizes native File metadata failures and revalidates operation descriptors', () => {
    const item = picked('a/x');
    Object.defineProperty(item.file, 'webkitRelativePath', {
      get() {
        throw new Error(CANARY);
      },
    });
    expect(() => snapshotSelectedFiles([item.file])).toThrow('selection-invalid');
    const selected = folder();
    expect(() => preflightSelection([{ files: [], byteLength: 0 }, selected])).toThrow(
      'selection-invalid'
    );
    expect(() =>
      preflightSelection([
        { files: Array.from({ length: 257 }, () => selected.files[0]), byteLength: 0 },
        selected,
      ])
    ).toThrow('selection-limit');
    expect(() =>
      preflightSelection([
        { files: [selected.files[0], selected.files[0]], byteLength: 0 },
        selected,
      ])
    ).toThrow('selection-invalid');
    expect(() =>
      preflightSelection([{ files: [{ ...selected.files[0], size: -1 }], byteLength: 0 }, selected])
    ).toThrow('selection-invalid');
  });
  it('strips only the common root, preserves nested slots and opaque files, and detaches FileList', async () => {
    const raw = picked(`${CANARY}/responses/conversation.json`);
    const extra = picked(`${CANARY}/nested/opaque.bin`, CANARY);
    const list = [raw.file, extra.file];
    const selected = snapshotSelectedFiles(list);
    list.splice(0, 2, picked('different/root.json').file);
    Object.defineProperty(raw.file, 'arrayBuffer', {
      value: vi.fn(() => {
        throw new Error(CANARY);
      }),
    });
    const result = await readSelectedSnapshots(
      [selected, folder()],
      new AbortController().signal,
      vi.fn()
    );
    expect(result[0].files.map(file => file.relativePath)).toEqual([
      'responses/conversation.json',
      'nested/opaque.bin',
    ]);
    expect(new TextDecoder().decode(result[0].files[1].bytes)).toBe(CANARY);
    expect(raw.read).toHaveBeenCalledOnce();
  });

  it.each([
    '',
    'file.json',
    'root//x',
    'root/./x',
    'root/../x',
    'root/x\\y',
    'root/x:y',
    'root/x\u0000y',
    'root/x\u007fy',
    'root/x ',
    'root/x.',
    'root./x',
    '/root/x',
    `${'r'.repeat(508)}/f.json`,
  ])('rejects malformed directory metadata before reading: %j', path => {
    const item = picked(path);
    expect(() => snapshotSelectedFiles([item.file])).toThrow('selection-invalid');
    expect(item.read).not.toHaveBeenCalled();
  });

  it('rejects mixed roots, duplicate slots and case aliases', () => {
    for (const paths of [
      ['a/x', 'b/y'],
      ['a/x', 'a/x'],
      ['a/X', 'a/x'],
    ])
      expect(() => snapshotSelectedFiles(paths.map(path => picked(path).file))).toThrow(
        'selection-invalid'
      );
  });

  it.each([-1, 1.5, Infinity, NaN])('rejects invalid File.size %s', size => {
    expect(() => snapshotSelectedFiles([picked('a/x', '', size).file])).toThrow(
      'selection-invalid'
    );
  });

  it('checks exact per-file, file-count, snapshot-count and total ceilings without reads', () => {
    const mib = 1024 * 1024;
    const max = picked('a/x', '', 64 * mib);
    expect(snapshotSelectedFiles([max.file]).byteLength).toBe(64 * mib);
    expect(() => snapshotSelectedFiles([picked('a/x', '', 64 * mib + 1).file])).toThrow(
      'selection-limit'
    );
    expect(folder('a', 256).files).toHaveLength(256);
    expect(() => folder('a', 257)).toThrow('selection-limit');
    expect(preflightSelection(Array.from({ length: 16 }, () => folder())).totalFiles).toBe(16);
    expect(() => preflightSelection(Array.from({ length: 17 }, () => folder()))).toThrow(
      'selection-limit'
    );
    expect(() => preflightSelection([folder()])).toThrow('selection-invalid');
    expect(
      preflightSelection(Array.from({ length: 4 }, () => snapshotSelectedFiles([max.file])))
        .totalBytes
    ).toBe(256 * mib);
    expect(() =>
      preflightSelection([
        ...Array.from({ length: 4 }, () => snapshotSelectedFiles([max.file])),
        folder(),
      ])
    ).toThrow('selection-limit');
    expect(preflightSelection(Array.from({ length: 4 }, () => folder('a', 256))).totalFiles).toBe(
      1024
    );
    expect(() =>
      preflightSelection([...Array.from({ length: 4 }, () => folder('a', 256)), folder()])
    ).toThrow('selection-limit');
    expect(max.read).not.toHaveBeenCalled();
  });

  it('preflights the entire batch before its first read', async () => {
    const item = picked('a/x');
    const selected = snapshotSelectedFiles([item.file]);
    await expect(
      readSelectedSnapshots([selected], new AbortController().signal, vi.fn())
    ).rejects.toThrow('selection-invalid');
    expect(item.read).not.toHaveBeenCalled();
  });

  it('reads sequentially and reports only completed files/bytes', async () => {
    const first = picked('a/x');
    const second = picked('a/y');
    const third = picked('b/z');
    const pending = deferred<ArrayBuffer>();
    first.read.mockReturnValueOnce(pending.promise);
    const progress = vi.fn();
    const operation = readSelectedSnapshots(
      [snapshotSelectedFiles([first.file, second.file]), snapshotSelectedFiles([third.file])],
      new AbortController().signal,
      progress
    );
    expect(second.read).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    pending.resolve(first.bytes.buffer);
    await operation;
    expect(progress.mock.calls.map(([value]) => value.files)).toEqual([1, 2, 3]);
    expect(progress).toHaveBeenLastCalledWith({ files: 3, bytes: 6, totalFiles: 3, totalBytes: 6 });
    expect(first.read.mock.invocationCallOrder[0]).toBeLessThan(
      second.read.mock.invocationCallOrder[0]
    );
  });

  it.each(['reject', 'length'])('sanitizes read %s errors', async kind => {
    const item = picked('a/x');
    if (kind === 'reject') item.read.mockRejectedValueOnce(new Error(CANARY));
    else item.read.mockResolvedValueOnce(new ArrayBuffer(1));
    const operation = readSelectedSnapshots(
      [snapshotSelectedFiles([item.file]), folder()],
      new AbortController().signal,
      vi.fn()
    );
    await expect(operation).rejects.toThrow('selection-read-failed');
    await expect(operation).rejects.not.toThrow(CANARY);
  });

  it('cancels before read and discards a late read without starting another', async () => {
    const first = picked('a/x');
    const second = picked('b/y');
    const controller = new AbortController();
    const pending = deferred<ArrayBuffer>();
    first.read.mockReturnValueOnce(pending.promise);
    const progress = vi.fn();
    const operation = readSelectedSnapshots(
      [snapshotSelectedFiles([first.file]), snapshotSelectedFiles([second.file])],
      controller.signal,
      progress
    );
    controller.abort();
    pending.resolve(first.bytes.buffer);
    await expect(operation).rejects.toThrow('snapshot-operation-cancelled');
    expect(second.read).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    await expect(
      readSelectedSnapshots([folder(), folder()], controller.signal, progress)
    ).rejects.toThrow('snapshot-operation-cancelled');
  });
});
