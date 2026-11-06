// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { prepareChatGptNewCapture } from '../../../src/resumability-journal/capture-handoff';
import { encodeSnapshotCatalog } from '../../../src/archive/catalog';
import {
  canonical,
  detach,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/data';
import {
  RECORD_SCHEMA,
  snapshotRecord,
  encodeRecord,
  decodeRecord,
  revise,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { catalog, request, sha256, signal } from './fixtures';

async function fixture() {
  const prepared = await prepareChatGptNewCapture(
    encodeSnapshotCatalog(await catalog()),
    request(),
    { sha256, signal: signal() }
  );
  return snapshotRecord({
    schema: RECORD_SCHEMA,
    revision: 0,
    operation: prepared.operation,
    phase: 'reserved',
    control: 'active',
    disposition: 'open',
  });
}
describe('v2 canonical detached envelope', () => {
  it('roundtrips exact UTF8 bytes, sorted keys and detached immutable operation', async () => {
    const record = await fixture();
    const bytes = encodeRecord(record);
    const restored = decodeRecord(bytes, 'operation-1');
    expect(restored).toEqual(record);
    expect(restored).not.toBe(record);
    expect(restored.operation).not.toBe(record.operation);
    expect(encodeRecord(restored)).toEqual(bytes);
    expect(Object.isFrozen(restored.operation.destinations)).toBe(true);
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('rejects getter, toJSON, cycles, symbol keys, sparse arrays and browser objects without calling capabilities', () => {
    const getter = vi.fn();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const values = [
      Object.defineProperty({}, 'x', { get: getter, enumerable: true }),
      { toJSON: getter },
      cyclic,
      { [Symbol('x')]: 1 },
      Array(1),
      new Date(),
      new Uint8Array(1),
      new Map(),
      -0,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    for (const value of values) expect(() => detach(value)).toThrow('corrupt-record');
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects inconsistent states, extra sections, unsafe revisions and overflow without producing replacement bytes', async () => {
    const record = await fixture();
    for (const changes of [
      { schema: 'liska-resumability-journal/1' },
      { revision: -1 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
      { revision: 0.5 },
      { phase: 'completed' },
      { phase: 'in-flight', control: 'paused' },
      { phase: 'in-flight', disposition: 'abandoned' },
      { phase: 'unknown' },
      { phase: 'awaiting-resolution' },
      { interruptionReason: 'pause' },
      { body: 'private' },
    ])
      expect(() => snapshotRecord({ ...record, ...changes })).toThrow('corrupt-record');
    const last = snapshotRecord({ ...record, revision: Number.MAX_SAFE_INTEGER });
    expect(() => revise(last, { control: 'paused' })).toThrow('revision-conflict');
    expect(last.revision).toBe(Number.MAX_SAFE_INTEGER);
  });
});
