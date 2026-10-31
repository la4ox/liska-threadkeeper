import { OFFICIAL_ZIP_HARD_LIMITS, type OfficialZipSource } from './official-zip';

// Trust the platform realm at module initialization, never properties supplied by a
// selected File, its subclasses, a returned slice, or later prototype replacements.
const native = (() => {
  try {
    return Object.freeze({
      filePrototype: File.prototype,
      isPrototypeOf: Object.prototype.isPrototypeOf,
      blobSize: Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get,
      slice: Blob.prototype.slice,
      arrayBuffer: Blob.prototype.arrayBuffer,
      bufferSize: Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get,
      bytes: Uint8Array,
      aborted: Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get,
      add: EventTarget.prototype.addEventListener,
      remove: EventTarget.prototype.removeEventListener,
      then: Promise.prototype.then,
    });
  } catch {
    return undefined;
  }
})();

export type OfficialZipFileErrorCode =
  | 'invalid-file'
  | 'resource-limit'
  | 'invalid-range'
  | 'invalid-signal'
  | 'aborted'
  | 'file-read-failed';

/** Contains no File identity, native exception, or caller-supplied abort reason. */
export class OfficialZipFileError extends Error {
  constructor(readonly code: OfficialZipFileErrorCode) {
    super(`Official ZIP file failed (${code}).`);
    this.name = 'OfficialZipFileError';
    Object.freeze(this);
  }
}

function fail(code: OfficialZipFileErrorCode): never {
  throw new OfficialZipFileError(code);
}

function inspectFile(file: File): number {
  let size: number;
  try {
    if (
      !native?.blobSize ||
      typeof native.slice !== 'function' ||
      typeof native.arrayBuffer !== 'function' ||
      !Reflect.apply(native.isPrototypeOf, native.filePrototype, [file])
    )
      fail('invalid-file');
    size = Reflect.apply(native.blobSize, file, []) as number;
  } catch {
    fail('invalid-file');
  }
  if (!Number.isSafeInteger(size) || size < 0) fail('invalid-file');
  if (size > OFFICIAL_ZIP_HARD_LIMITS.maxArchiveBytes) fail('resource-limit');
  return size;
}

interface SignalAccess {
  aborted(): boolean;
  add(listener: () => void): void;
  remove(listener: () => void): void;
}

function inspectSignal(signal: AbortSignal): SignalAccess {
  try {
    const getter = native?.aborted;
    if (!getter) fail('invalid-signal');
    const aborted = () => Reflect.apply(getter, signal, []) as boolean;
    if (typeof aborted() !== 'boolean') fail('invalid-signal');
    const add = native!.add;
    const remove = native!.remove;
    return {
      aborted,
      add: listener => Reflect.apply(add, signal, ['abort', listener, { once: true }]),
      remove: listener => Reflect.apply(remove, signal, ['abort', listener]),
    };
  } catch {
    fail('invalid-signal');
  }
}

function check(signal: SignalAccess): void {
  let aborted: boolean;
  try {
    aborted = signal.aborted();
  } catch {
    fail('invalid-signal');
  }
  if (aborted) fail('aborted');
}

function validateRange(start: number, end: number, size: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > size
  )
    fail('invalid-range');
}

function startRead(file: File, start: number, end: number, signal: SignalAccess) {
  const part = Reflect.apply(native!.slice, file, [start, end]) as Blob;
  check(signal);
  if (Reflect.apply(native!.blobSize!, part, []) !== end - start) fail('file-read-failed');
  check(signal);
  return Promise.resolve(Reflect.apply(native!.arrayBuffer, part, [])) as Promise<unknown>;
}

/** Observe both outcomes even after cancellation; a native File read cannot be stopped. */
function abortableRead(pending: Promise<unknown>, signal: SignalAccess): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: unknown, code?: OfficialZipFileErrorCode) => {
      if (settled) return;
      settled = true;
      try {
        signal.remove(onAbort);
      } catch {
        code = 'invalid-signal';
      }
      if (code) reject(new OfficialZipFileError(code));
      else resolve(value);
    };
    const onAbort = () => finish(undefined, 'aborted');
    const receive = (value: unknown, failed = false) => {
      try {
        if (signal.aborted()) onAbort();
        else finish(value, failed ? 'file-read-failed' : undefined);
      } catch {
        finish(undefined, 'invalid-signal');
      }
    };
    try {
      Reflect.apply(native!.then, pending, [receive, () => receive(undefined, true)]);
    } catch {
      finish(undefined, 'file-read-failed');
      return;
    }
    try {
      signal.add(onAbort);
      if (signal.aborted()) onAbort();
    } catch {
      finish(undefined, 'invalid-signal');
    }
  });
}

function ownBytes(value: unknown, length: number): Uint8Array {
  // A native brand check accepts genuine cross-realm ArrayBuffers, not tag/length spoofs,
  // typed arrays, SharedArrayBuffers, or overridable subclass accessors/iterators.
  const getter = native?.bufferSize;
  if (!getter || Reflect.apply(getter, value, []) !== length) fail('file-read-failed');
  return new native!.bytes(new native!.bytes(value as ArrayBuffer));
}

/** Adapt one explicitly selected File without reading its name, type, or timestamps. */
export function createOfficialZipFileSource(file: File): OfficialZipSource {
  const size = inspectFile(file);
  const readRange: OfficialZipSource['readRange'] = async (start, end, signal) => {
    validateRange(start, end, size);
    const access = inspectSignal(signal);
    check(access);
    if (start === end) {
      try {
        return new native!.bytes(0);
      } catch {
        fail('file-read-failed');
      }
    }
    let pending: Promise<unknown>;
    try {
      pending = startRead(file, start, end, access);
    } catch {
      check(access);
      fail('file-read-failed');
    }
    const value = await abortableRead(pending, access);
    check(access);
    try {
      return ownBytes(value, end - start);
    } catch {
      fail('file-read-failed');
    }
  };
  return Object.freeze({ size, readRange: Object.freeze(readRange) });
}
