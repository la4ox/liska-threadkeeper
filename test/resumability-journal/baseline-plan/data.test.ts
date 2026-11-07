// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  BASELINE_LIMITS,
  createBaselineCheckpoint,
  nextBaselineDecision,
} from '../../../src/resumability-journal/baseline-plan';
import {
  canonical,
  detach,
  encode,
  list,
} from '../../../src/resumability-journal/baseline-plan/data';
import { command, dependencies, fixture, hash } from './fixtures';

describe('bounded exact plain baseline data', () => {
  it('sorts object keys ordinally, keeps array order and accepts null-prototype plain records', () => {
    const plain = Object.assign(Object.create(null), { z: [2, 1], a: 0 });
    expect(canonical(plain)).toBe('{"a":0,"z":[2,1]}');
    expect(detach(plain)).not.toBe(plain);
    expect(encode(plain, 21)).toHaveLength(17);
  });
  it('rejects depth, node, string, aggregate-string, array-item and byte excess independently', () => {
    let deep: unknown = null;
    for (let index = 0; index <= BASELINE_LIMITS.maxDepth; index++) deep = { x: deep };
    const nodes = Array.from({ length: 100 }, () => Array.from({ length: 500 }, () => 0));
    const strings = Array.from({ length: 1025 }, () => 'x'.repeat(1024));
    for (const input of [
      deep,
      nodes,
      strings,
      'x'.repeat(BASELINE_LIMITS.maxStringCodeUnits + 1),
      Array(BASELINE_LIMITS.maxPlanItems + 1).fill(0),
    ])
      expect(() => detach(input)).toThrow('limit-exceeded');
    expect(() => encode({ x: 'a' }, 8)).toThrow('limit-exceeded');
    expect(() => list([0, 1], 1)).toThrow('limit-exceeded');
  });
  it('never invokes accessors or serializers and rejects hidden, symbolic, unsafe, cyclic and non-plain data', () => {
    const getter = vi.fn();
    const cycle: Record<string, unknown> = {};
    cycle.x = cycle;
    const array = [0];
    Object.defineProperty(array, '0', { get: getter, enumerable: true });
    for (const input of [
      Object.defineProperty({}, 'x', { get: getter, enumerable: true }),
      Object.defineProperty({}, 'x', { value: 1, enumerable: false }),
      { toJSON: getter },
      { [Symbol('x')]: 1 },
      cycle,
      array,
      Array(1),
      JSON.parse('{"__proto__":1}'),
      new Date(),
      new Map(),
      new Uint8Array(1),
      undefined,
      () => 1,
      NaN,
      Infinity,
      -0,
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => detach(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('retains the captured cancellation signal even if dependency properties change between continuations', async () => {
    const { plan, checkpoint } = await fixture();
    const cancelAfterHash = () => {
      const abort = new AbortController();
      const mutable = {
        signal: abort.signal,
        sha256: async (bytes: Uint8Array) => {
          queueMicrotask(() =>
            queueMicrotask(() => {
              mutable.signal = new AbortController().signal;
              abort.abort();
            })
          );
          return hash(bytes);
        },
      };
      return mutable;
    };
    await expect(
      createBaselineCheckpoint(
        plan,
        { now: 100, windowId: 'a', maxReservationSlots: 1 },
        cancelAfterHash()
      )
    ).rejects.toThrow('hash-failed');
    const active = await command(plan, checkpoint, { kind: 'activate' });
    expect(
      await nextBaselineDecision(plan, active, [], active.observedAt, cancelAfterHash())
    ).toMatchObject({ kind: 'stop', reason: 'conflict' });
    expect(
      await nextBaselineDecision(plan, active, [], active.observedAt, dependencies())
    ).toMatchObject({ kind: 'candidate' });
  });
});
