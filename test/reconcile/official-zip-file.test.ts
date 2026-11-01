// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOfficialZipFileSource,
  OfficialZipFileError,
  type OfficialZipFileErrorCode,
} from '../../src/reconcile/official-zip-file';
import { OFFICIAL_ZIP_HARD_LIMITS } from '../../src/reconcile/official-zip';

const PRIVATE = 'PRIVATE_FILE_IDENTITY_NATIVE_ERROR_ABORT_REASON';
const CONTENT = [10, 20, 30, 40, 50, 60];
const signal = () => new AbortController().signal;
const file = () =>
  new File([new Uint8Array(CONTENT)], PRIVATE, { type: PRIVATE, lastModified: 123 });
const buffer = (values = CONTENT) => new Uint8Array(values).buffer;
const nativeSlice = Blob.prototype.slice;
const nativeRead = Blob.prototype.arrayBuffer;
const nativeReadDescriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer')!;

interface Faults {
  size?: () => number;
  slice?: (this: Blob, start?: number, end?: number) => unknown;
  read?: (this: Blob) => unknown;
  aborted?: () => boolean;
  add?: () => void;
  remove?: () => void;
  bufferSize?: () => number;
}

// Selected File/slice properties cannot inject native failures. An isolated import
// deliberately trusts these harness stubs as its module-initialization platform.
async function platform(faults: Faults = {}) {
  vi.resetModules();
  if (faults.size) vi.spyOn(Blob.prototype, 'size', 'get').mockImplementation(faults.size);
  const slice = vi.spyOn(Blob.prototype, 'slice').mockImplementation(function (
    this: Blob,
    start,
    end
  ) {
    return (faults.slice ?? nativeSlice).call(this, start, end) as Blob;
  });
  const read = vi.fn();
  let readImplementation = faults.read ?? nativeRead;
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    ...nativeReadDescriptor,
    value: function (this: Blob) {
      read();
      return readImplementation.call(this);
    },
  });
  if (faults.aborted)
    vi.spyOn(AbortSignal.prototype, 'aborted', 'get').mockImplementation(faults.aborted);
  if (faults.add)
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(faults.add);
  if (faults.remove)
    vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(faults.remove);
  if (faults.bufferSize)
    vi.spyOn(ArrayBuffer.prototype, 'byteLength', 'get').mockImplementation(faults.bufferSize);
  return {
    ...(await import('../../src/reconcile/official-zip-file')),
    slice,
    read,
    setRead(implementation: (this: Blob) => unknown) {
      readImplementation = implementation;
    },
  };
}

async function rejects(action: () => unknown, code: OfficialZipFileErrorCode) {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const error = caught as OfficialZipFileError;
  expect(error.name).toBe('OfficialZipFileError');
  expect(error.code).toBe(code);
  expect(error.message).toBe(`Official ZIP file failed (${code}).`);
  expect(error).not.toHaveProperty('cause');
  expect(Object.isFrozen(error)).toBe(true);
  expect(`${error.stack}${JSON.stringify(error)}`).not.toContain(PRIVATE);
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function prompt(promise: Promise<unknown>) {
  expect(
    await Promise.race([
      promise.then(() => 'settled'),
      new Promise(resolve => setImmediate(() => resolve('still-pending'))),
    ])
  ).toBe('settled');
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(Blob.prototype, 'arrayBuffer', nativeReadDescriptor);
});

describe('createOfficialZipFileSource', () => {
  it('reads exact native File/Blob ranges and exposes only anonymous immutable fields', async () => {
    const adapter = await platform();
    const source = adapter.createOfficialZipFileSource(file());
    expect(Reflect.ownKeys(source)).toEqual(['size', 'readRange']);
    expect(source.size).toBe(6);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.readRange)).toBe(true);
    expect(JSON.stringify(source)).toBe('{"size":6}');
    expect(await source.readRange(1, 4, signal())).toEqual(new Uint8Array([20, 30, 40]));
    expect(await source.readRange(4, 6, signal())).toEqual(new Uint8Array([50, 60]));
    expect(adapter.slice.mock.calls).toEqual([
      [1, 4],
      [4, 6],
    ]);
    expect(adapter.read).toHaveBeenCalledTimes(2);
    for (const key of ['name', 'path', 'type', 'lastModified', 'webkitRelativePath', 'file'])
      expect(source).not.toHaveProperty(key);
  });

  it('never reads File identity or overridable size/slice/arrayBuffer properties', async () => {
    const input = file();
    const forbidden = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    for (const key of [
      'name',
      'type',
      'lastModified',
      'webkitRelativePath',
      'size',
      'slice',
      'arrayBuffer',
      'stream',
      'text',
    ])
      Object.defineProperty(input, key, { get: forbidden });
    const source = createOfficialZipFileSource(input);
    expect(source.size).toBe(6);
    expect(await source.readRange(2, 5, signal())).toEqual(new Uint8Array([30, 40, 50]));
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('cannot be falsified by a same-length File instance or subclass slice override', async () => {
    const falsify = vi.fn(() => new Blob([new Uint8Array(6).fill(99)]));
    class HostileFile extends File {
      override get size() {
        return 99;
      }
      override slice() {
        return falsify();
      }
      override arrayBuffer() {
        return Promise.resolve(buffer([99, 99, 99, 99, 99, 99]));
      }
    }
    const instance = file();
    Object.defineProperty(instance, 'slice', { value: falsify });
    for (const input of [instance, new HostileFile([new Uint8Array(CONTENT)], PRIVATE)]) {
      const source = createOfficialZipFileSource(input);
      expect(source.size).toBe(6);
      expect(await source.readRange(0, 6, signal())).toEqual(new Uint8Array(CONTENT));
    }
    expect(falsify).not.toHaveBeenCalled();
  });

  it('bypasses same-length replacements and throwing accessors on later native prototypes', async () => {
    const input = file();
    const existing = createOfficialZipFileSource(input);
    const forbidden = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    vi.spyOn(Blob.prototype, 'slice').mockImplementation(
      () => new Blob([new Uint8Array(6).fill(99)])
    );
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(() =>
      Promise.resolve(buffer([99, 99, 99, 99, 99, 99]))
    );
    vi.spyOn(Blob.prototype, 'size', 'get').mockImplementation(forbidden);
    vi.spyOn(ArrayBuffer.prototype, 'byteLength', 'get').mockImplementation(forbidden);
    const later = createOfficialZipFileSource(input);
    const first = await existing.readRange(0, 6, signal());
    const second = await later.readRange(0, 6, signal());
    vi.restoreAllMocks();
    expect(first).toEqual(new Uint8Array(CONTENT));
    expect(second).toEqual(new Uint8Array(CONTENT));
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('ignores hostile getters on a genuine native slice and reads its actual storage', async () => {
    const forbidden = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    const adapter = await platform({
      slice(start, end) {
        const selected = nativeSlice.call(this, start, end);
        Object.defineProperties(selected, {
          size: { get: forbidden },
          arrayBuffer: { get: forbidden },
        });
        return selected;
      },
    });
    expect(await adapter.createOfficialZipFileSource(file()).readRange(1, 4, signal())).toEqual(
      new Uint8Array([20, 30, 40])
    );
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('accepts empty files and zero-length ranges including the exact exclusive end without I/O', async () => {
    const adapter = await platform();
    expect(
      await adapter.createOfficialZipFileSource(new File([], PRIVATE)).readRange(0, 0, signal())
    ).toEqual(new Uint8Array(0));
    const source = adapter.createOfficialZipFileSource(file());
    const first = await source.readRange(0, 0, signal());
    const last = await source.readRange(6, 6, signal());
    expect(first).toEqual(new Uint8Array(0));
    expect(last).toEqual(new Uint8Array(0));
    expect(last).not.toBe(first);
    expect(adapter.slice).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it('returns independent exact owned bytes across retained and repeated native reads', async () => {
    const retained = buffer();
    const adapter = await platform({ read: () => retained });
    const source = adapter.createOfficialZipFileSource(file());
    const first = await source.readRange(0, 6, signal());
    const second = await source.readRange(0, 6, signal());
    expect(first.buffer).not.toBe(retained);
    expect(second.buffer).not.toBe(retained);
    expect(second.buffer).not.toBe(first.buffer);
    expect(first.byteOffset).toBe(0);
    expect(first.buffer.byteLength).toBe(6);
    new Uint8Array(retained).fill(99);
    first[0] = 77;
    expect(second).toEqual(new Uint8Array(CONTENT));
    expect(first[1]).toBe(20);
    expect(await source.readRange(0, 6, signal())).toEqual(new Uint8Array(6).fill(99));
  });

  it.each([
    [-1, 1],
    [0, -1],
    [0.5, 2],
    [0, 1.5],
    [4, 3],
    [0, 7],
    [7, 7],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
    [0, Number.MAX_SAFE_INTEGER + 1],
    [NaN, 1],
    [0, NaN],
    [-Infinity, 1],
    [0, Infinity],
    ['0', 1],
    [0, '1'],
    [null, 1],
    [0n, 1n],
  ])('rejects invalid range [%s, %s) without native I/O', async (start, end) => {
    const adapter = await platform();
    const source = adapter.createOfficialZipFileSource(file());
    await rejects(
      () => source.readRange(start as number, end as number, signal()),
      'invalid-range'
    );
    expect(adapter.slice).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    PRIVATE,
    6,
    {},
    [],
    new Blob([new Uint8Array(CONTENT)]),
    { size: 6, slice: nativeSlice },
    Object.create(File.prototype),
  ])('rejects non-Files or forged native storage', async value => {
    await rejects(() => createOfficialZipFileSource(value as File), 'invalid-file');
  });

  it('sanitizes proxy brand/prototype failures', async () => {
    const proxy = new Proxy(file(), {
      getPrototypeOf() {
        throw new Error(PRIVATE);
      },
    });
    await rejects(() => createOfficialZipFileSource(proxy), 'invalid-file');
    const readingProxy = new Proxy(file(), {
      get() {
        throw new Error(PRIVATE);
      },
    });
    await rejects(() => createOfficialZipFileSource(readingProxy), 'invalid-file');
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid native size %s',
    async size => {
      const adapter = await platform({ size: () => size });
      await rejects(() => adapter.createOfficialZipFileSource(file()), 'invalid-file');
      expect(adapter.read).not.toHaveBeenCalled();
    }
  );

  it.each([OFFICIAL_ZIP_HARD_LIMITS.maxArchiveBytes, OFFICIAL_ZIP_HARD_LIMITS.maxArchiveBytes + 1])(
    'enforces the exact shared archive maximum at native size %s',
    async size => {
      const adapter = await platform({ size: () => size });
      if (size === OFFICIAL_ZIP_HARD_LIMITS.maxArchiveBytes)
        expect(adapter.createOfficialZipFileSource(file()).size).toBe(size);
      else await rejects(() => adapter.createOfficialZipFileSource(file()), 'resource-limit');
      expect(adapter.read).not.toHaveBeenCalled();
    }
  );

  it('sanitizes failure of the captured native size getter', async () => {
    const adapter = await platform({
      size: () => {
        throw new Error(PRIVATE);
      },
    });
    await rejects(() => adapter.createOfficialZipFileSource(file()), 'invalid-file');
  });

  it.each([undefined, null, {}, { aborted: false }, Object.create(AbortSignal.prototype)])(
    'requires a genuine supplied signal even for empty reads',
    async value => {
      const adapter = await platform();
      const source = adapter.createOfficialZipFileSource(file());
      await rejects(() => source.readRange(0, 0, value as AbortSignal), 'invalid-signal');
      expect(adapter.slice).not.toHaveBeenCalled();
    }
  );

  it('never starts an already-aborted read or discloses the caller reason', async () => {
    const adapter = await platform();
    const source = adapter.createOfficialZipFileSource(file());
    const controller = new AbortController();
    controller.abort(new Error(PRIVATE));
    await rejects(() => source.readRange(0, 6, controller.signal), 'aborted');
    await rejects(() => source.readRange(6, 6, controller.signal), 'aborted');
    expect(adapter.slice).not.toHaveBeenCalled();
  });

  it('bypasses later signal instance/prototype replacements and never reads reason', async () => {
    const controller = new AbortController();
    const forbidden = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    Object.defineProperties(controller.signal, {
      aborted: { get: forbidden },
      reason: { get: forbidden },
      addEventListener: { value: forbidden },
      removeEventListener: { value: forbidden },
    });
    vi.spyOn(AbortSignal.prototype, 'aborted', 'get').mockImplementation(forbidden);
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(forbidden);
    vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(forbidden);
    const source = createOfficialZipFileSource(file());
    expect(await source.readRange(0, 6, controller.signal)).toEqual(new Uint8Array(CONTENT));
    controller.abort(PRIVATE);
    await rejects(() => source.readRange(0, 6, controller.signal), 'aborted');
    expect(forbidden).not.toHaveBeenCalled();
  });

  it.each(['add', 'remove', 'aborted'] as const)(
    'sanitizes failure of captured native signal %s',
    async key => {
      const adapter = await platform({
        [key]: () => {
          throw new Error(PRIVATE);
        },
      });
      await rejects(
        () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal()),
        'invalid-signal'
      );
    }
  );

  it.each([
    null,
    undefined,
    {},
    { size: 6, arrayBuffer: buffer },
    new Blob([new Uint8Array(5)]),
    new Blob([new Uint8Array(7)]),
  ])('rejects fake, short or long native slices before reading bytes', async value => {
    const adapter = await platform({ slice: () => value });
    await rejects(
      () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal()),
      'file-read-failed'
    );
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it.each([
    buffer(CONTENT.slice(0, 5)),
    buffer([...CONTENT, 70]),
    new Uint8Array(CONTENT),
    new DataView(buffer()),
    new SharedArrayBuffer(6),
    { byteLength: 6, [Symbol.toStringTag]: 'ArrayBuffer' },
    Object.create(ArrayBuffer.prototype),
    null,
    undefined,
  ])(
    'rejects malformed, short, long, typed, shared or foreign-realm-like native buffer returns',
    async value => {
      const adapter = await platform({ read: () => value });
      await rejects(
        () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal()),
        'file-read-failed'
      );
    }
  );

  it('accepts and owns a genuine cross-realm ArrayBuffer via the native brand check', async () => {
    const foreign = runInNewContext('new Uint8Array([10, 20, 30, 40, 50, 60]).buffer');
    expect(foreign).not.toBeInstanceOf(ArrayBuffer);
    const adapter = await platform({ read: () => foreign });
    const bytes = await adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal());
    expect(bytes).toEqual(new Uint8Array(CONTENT));
    expect(bytes.buffer).not.toBe(foreign);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('bypasses hostile ArrayBuffer subclass and typed-array copy hooks', async () => {
    class HostileBuffer extends ArrayBuffer {
      override get byteLength(): number {
        throw new Error(PRIVATE);
      }
      override slice(): ArrayBuffer {
        throw new Error(PRIVATE);
      }
    }
    const backing = new HostileBuffer(6);
    new Uint8Array(backing).set(CONTENT);
    const adapter = await platform({ read: () => backing });
    const input = file();
    const forbidden = () => {
      throw new Error(PRIVATE);
    };
    vi.spyOn(Uint8Array.prototype, 'slice').mockImplementation(forbidden);
    vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(forbidden);
    vi.spyOn(Uint8Array.prototype, Symbol.iterator).mockImplementation(forbidden);
    const bytes = await adapter.createOfficialZipFileSource(input).readRange(0, 6, signal());
    vi.restoreAllMocks();
    expect(bytes).toEqual(new Uint8Array(CONTENT));
    expect(bytes.buffer).not.toBe(backing);
  });

  it('rejects a hostile typed-array subclass without invoking its hooks', async () => {
    const forbidden = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    class HostileBytes extends Uint8Array {
      override get byteLength(): number {
        return 6;
      }
      override slice() {
        return forbidden();
      }
      override [Symbol.iterator](): ArrayIterator<number> {
        return forbidden();
      }
    }
    const adapter = await platform({ read: () => new HostileBytes(CONTENT) });
    await rejects(
      () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal()),
      'file-read-failed'
    );
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('sanitizes detached native buffers', async () => {
    const detached = buffer();
    structuredClone(detached, { transfer: [detached] });
    const adapter = await platform({ read: () => detached });
    await rejects(
      () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal()),
      'file-read-failed'
    );
  });

  it.each([
    new Error(PRIVATE),
    new DOMException(PRIVATE, 'NotReadableError'),
    PRIVATE,
    new OfficialZipFileError('aborted'),
  ])('sanitizes native sync/async failures without trusting forged codes', async native => {
    const adapter = await platform({
      read: () => {
        throw native;
      },
    });
    const source = adapter.createOfficialZipFileSource(file());
    await rejects(() => source.readRange(0, 6, signal()), 'file-read-failed');
    adapter.setRead(() => Promise.reject(native));
    await rejects(() => source.readRange(0, 6, signal()), 'file-read-failed');
    adapter.slice.mockImplementation(() => {
      throw native;
    });
    await rejects(() => source.readRange(0, 6, signal()), 'file-read-failed');
  });

  it('sanitizes captured native buffer getter and thenable failures', async () => {
    const adapter = await platform({
      bufferSize: () => {
        throw new Error(PRIVATE);
      },
    });
    await rejects(
      () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal()),
      'file-read-failed'
    );
    const thenable = Object.defineProperty({}, 'then', {
      get() {
        throw new Error(PRIVATE);
      },
    });
    adapter.setRead(() => thenable);
    await rejects(
      () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal()),
      'file-read-failed'
    );
  });

  it.each(['resolve', 'reject'] as const)(
    'settles abort promptly while native read later %ss, without unhandled rejection',
    async outcome => {
      const late = deferred();
      const adapter = await platform({ read: () => late.promise });
      const controller = new AbortController();
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const reading = adapter
          .createOfficialZipFileSource(file())
          .readRange(0, 6, controller.signal);
        const failure = rejects(() => reading, 'aborted');
        controller.abort(new Error(PRIVATE));
        await prompt(failure);
        if (outcome === 'resolve') late.resolve(buffer());
        else late.reject(new Error(PRIVATE));
        await new Promise(resolve => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        late.resolve(buffer());
        process.removeListener('unhandledRejection', unhandled);
      }
    }
  );

  it('handles synchronous native-read abort with an already-rejected promise', async () => {
    const controller = new AbortController();
    const adapter = await platform({
      read: () => {
        controller.abort(PRIVATE);
        return Promise.reject(new Error(PRIVATE));
      },
    });
    await rejects(
      () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, controller.signal),
      'aborted'
    );
    await new Promise(resolve => setImmediate(resolve));
  });

  it('does not read bytes after captured native slice synchronously aborts', async () => {
    const controller = new AbortController();
    const adapter = await platform({
      slice(start, end) {
        controller.abort(PRIVATE);
        return nativeSlice.call(this, start, end);
      },
    });
    await rejects(
      () => adapter.createOfficialZipFileSource(file()).readRange(0, 6, controller.signal),
      'aborted'
    );
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'observes native promise %s despite its overridden then getter',
    async outcome => {
      const pending = deferred();
      const forbidden = vi.fn(() => {
        throw new Error(PRIVATE);
      });
      Object.defineProperty(pending.promise, 'then', { get: forbidden });
      const adapter = await platform({ read: () => pending.promise });
      const reading = adapter.createOfficialZipFileSource(file()).readRange(0, 6, signal());
      if (outcome === 'resolve') {
        pending.resolve(buffer());
        expect(await reading).toEqual(new Uint8Array(CONTENT));
      } else {
        const failure = rejects(() => reading, 'file-read-failed');
        pending.reject(new Error(PRIVATE));
        await failure;
      }
      expect(forbidden).not.toHaveBeenCalled();
    }
  );

  it.each(['success', 'failure', 'abort'] as const)(
    'removes the exact registered native abort listener after %s',
    async outcome => {
      const pending = deferred();
      const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
      const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
      const adapter = await platform({ read: () => pending.promise });
      const controller = new AbortController();
      const reading = adapter
        .createOfficialZipFileSource(file())
        .readRange(0, 6, controller.signal);
      if (outcome === 'success') {
        pending.resolve(buffer());
        await reading;
      } else {
        const failure = rejects(
          () => reading,
          outcome === 'abort' ? 'aborted' : 'file-read-failed'
        );
        if (outcome === 'abort') controller.abort(PRIVATE);
        else pending.reject(new Error(PRIVATE));
        await failure;
      }
      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      expect(remove.mock.calls[0]).toEqual(['abort', add.mock.calls[0][1]]);
      pending.resolve(buffer());
    }
  );
});
