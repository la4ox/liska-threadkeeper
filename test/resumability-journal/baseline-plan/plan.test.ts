// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { admitCanonicalCatalog } from '../../../src/archive/catalog/admission';
import {
  admitBaselinePlan,
  createBaselinePlan,
  encodeBaselinePlan,
  BASELINE_LIMITS,
  createBaselineCheckpoint,
  nextBaselineDecision,
} from '../../../src/resumability-journal/baseline-plan';
import {
  bothDestinations,
  catalogBytes,
  clone,
  dependencies,
  fixture,
  hash,
  identity,
  requirements,
} from './fixtures';

describe('explicit-catalog baseline plan', () => {
  it('catalog admission alone creates no plan and requires a nonempty exact new-capture subset', async () => {
    const selection = [identity(0), identity(1), identity(2)];
    const bytes = await catalogBytes(selection);
    const admitted = await admitCanonicalCatalog(
      bytes,
      dependencies().signal,
      dependencies().sha256
    );
    expect(Object.keys(admitted).sort()).toEqual(['catalogSha256', 'counts', 'identities']);
    const plan = await createBaselinePlan(
      bytes,
      { ...requirements, selection: [selection[1]] },
      dependencies()
    );
    expect(plan.plan.items).toEqual([{ ordinal: 0, ...selection[1] }]);
    expect(plan.plan.coverage).toBe('explicit-selected-inputs-only');
    expect(plan.plan.executionAuthorized).toBe(false);
    expect(plan.plan.catalogSha256).toBe(hash(bytes));
    await expect(
      createBaselinePlan(bytes, { ...requirements, selection: [] }, dependencies())
    ).rejects.toThrow();
    for (const changes of [
      { purpose: 'backup' },
      { completenessPolicy: 'partial' },
      { destinations: [] },
    ])
      await expect(
        createBaselinePlan(
          bytes,
          { ...requirements, selection, ...changes } as never,
          dependencies()
        )
      ).rejects.toThrow();
  });
  it('orders exact triples ordinally independent of permutations, locale or catalog positions', async () => {
    const selection = [identity(3, 'claude'), identity(1), identity(0), identity(3, 'gemini')];
    const bytes = await catalogBytes(selection);
    const variants = [
      selection,
      [...selection].reverse(),
      [selection[2], selection[0], selection[3], selection[1]],
    ];
    const results = await Promise.all(
      variants.map(selection =>
        createBaselinePlan(
          bytes,
          { ...requirements, selection, destinations: [...bothDestinations].reverse() },
          dependencies()
        )
      )
    );
    for (const result of results) {
      expect(encodeBaselinePlan(result.plan)).toEqual(encodeBaselinePlan(results[0].plan));
      expect(result.planSha256).toBe(results[0].planSha256);
      expect(result.plan.destinations).toEqual(bothDestinations);
      expect(result.plan.items.map(item => item.ordinal)).toEqual([0, 1, 2, 3]);
      expect(result.plan.items.map(item => item.provider)).toEqual([
        'chatgpt',
        'chatgpt',
        'claude',
        'gemini',
      ]);
    }
  });
  it('roundtrips exact immutable canonical plan bytes with a separately verified digest', async () => {
    const { plan } = await fixture();
    const bytes = encodeBaselinePlan(plan.plan);
    const restored = await admitBaselinePlan(bytes, plan.planSha256, dependencies());
    expect(restored).toEqual(plan);
    expect(restored).not.toBe(plan);
    expect(Object.isFrozen(restored.plan.items[0])).toBe(true);
    expect(encodeBaselinePlan(restored.plan)).toEqual(bytes);
    expect(plan.planSha256).toBe(hash(bytes));
    await expect(admitBaselinePlan(bytes, 'f'.repeat(64), dependencies())).rejects.toThrow(
      'digest-mismatch'
    );
    const altered = clone(plan.plan);
    altered.items[2] = { ...altered.items[2], conversationId: 'zz-other' };
    const mutated = encodeBaselinePlan(altered);
    await expect(admitBaselinePlan(mutated, plan.planSha256, dependencies())).rejects.toThrow(
      'digest-mismatch'
    );
  });
  it('rejects nonmembers, full-triple mismatches, duplicate/conflicting selections and legacy key substitution', async () => {
    const { bytes, selection } = await fixture();
    for (const selected of [
      [identity(99)],
      [selection[0], selection[0]],
      [{ ...selection[0], provider: 'claude' }],
      [{ ...selection[0], conversationKey: identity(1).conversationKey }],
      [{ ...selection[0], conversationKey: 'legacy-routing-digest' }],
      [{ ...selection[0], title: 'same title' }],
      [selection[0], { ...selection[0], conversationKey: identity(99).conversationKey }],
      [selection[0], { ...selection[1], conversationKey: selection[0].conversationKey }],
    ])
      await expect(
        createBaselinePlan(bytes, { ...requirements, selection: selected } as never, dependencies())
      ).rejects.toThrow();
  });
  it('keeps same conversation IDs across providers distinct and rejects catalog key collisions', async () => {
    const selection = [identity(1, 'chatgpt'), identity(1, 'claude')];
    const plan = await createBaselinePlan(
      await catalogBytes(selection),
      { ...requirements, selection },
      dependencies()
    );
    expect(plan.plan.items).toHaveLength(2);
    expect(plan.plan.items[0].conversationKey).not.toBe(plan.plan.items[1].conversationKey);
    await expect(
      catalogBytes([
        selection[0],
        { ...selection[1], conversationKey: selection[0].conversationKey },
      ])
    ).rejects.toThrow();
  });
  it.each([
    'prefix',
    'whitespace',
    'duplicate-json',
    'extra',
    'schema',
    'ordinal',
    'policy',
    'empty',
  ])('rejects noncanonical or malformed plan bytes: %s', async kind => {
    const { plan } = await fixture();
    let text = new TextDecoder().decode(encodeBaselinePlan(plan.plan));
    if (kind === 'prefix') text = '\ufeff' + text;
    if (kind === 'whitespace') text += '\n';
    if (kind === 'duplicate-json')
      text = text.replace(
        '"purpose":"new-capture"',
        '"purpose":"new-capture","purpose":"new-capture"'
      );
    const input = clone(plan.plan) as Record<string, unknown>;
    if (kind === 'extra') input.extra = true;
    if (kind === 'schema') input.schema = 'liska-explicit-baseline-plan/2';
    if (kind === 'ordinal') (input.items as { ordinal: number }[])[0].ordinal = 1;
    if (kind === 'policy') input.completenessPolicy = 'not-strict';
    if (kind === 'empty') input.items = [];
    if (['extra', 'schema', 'ordinal', 'policy', 'empty'].includes(kind))
      text = JSON.stringify(input);
    const bytes = new TextEncoder().encode(text);
    await expect(admitBaselinePlan(bytes, hash(bytes), dependencies())).rejects.toThrow();
  });
  it('rejects accessors, unsafe extra data, sparse arrays, symbols, cycles and bounded limit excess', async () => {
    const { bytes, selection, plan } = await fixture();
    const getter = vi.fn();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const selectionValue of [
      Array(1),
      [cyclic],
      [{ ...selection[0], [Symbol('x')]: 1 }],
      [Object.defineProperty({}, 'provider', { enumerable: true, get: getter })],
      Array(BASELINE_LIMITS.maxPlanItems + 1).fill(selection[0]),
      [{ ...selection[0], conversationId: 'x'.repeat(1025) }],
    ])
      await expect(
        createBaselinePlan(
          bytes,
          { ...requirements, selection: selectionValue } as never,
          dependencies()
        )
      ).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => encodeBaselinePlan({ ...plan.plan, toJSON: getter })).toThrow();
    await expect(
      admitBaselinePlan(
        new Uint8Array(BASELINE_LIMITS.maxPlanBytes + 1),
        plan.planSha256,
        dependencies()
      )
    ).rejects.toThrow();
    for (const bytesValue of [
      new Uint8Array(),
      new Uint8Array([255]),
      new TextEncoder().encode('{}'),
    ])
      await expect(
        createBaselinePlan(bytesValue, { ...requirements, selection }, dependencies())
      ).rejects.toThrow();
  });
  it('fails closed on malformed, throwing, mutating and cancelled injected hashing', async () => {
    const { bytes, selection } = await fixture();
    const request = { ...requirements, selection };
    for (const sha256 of [
      async () => 'X'.repeat(64),
      async () => {
        throw new Error('private');
      },
      async (bytes: Uint8Array) => {
        bytes[0] ^= 1;
        return hash(bytes);
      },
    ])
      await expect(
        createBaselinePlan(bytes, request, { ...dependencies(), sha256 })
      ).rejects.toThrow('hash-failed');
    const abort = new AbortController();
    abort.abort();
    const hashFn = vi.fn(dependencies().sha256);
    await expect(
      createBaselinePlan(bytes, request, { signal: abort.signal, sha256: hashFn })
    ).rejects.toThrow('hash-failed');
    expect(hashFn).not.toHaveBeenCalled();
    const later = new AbortController();
    await expect(
      createBaselinePlan(bytes, request, {
        signal: later.signal,
        sha256: async bytes => {
          later.abort();
          return hash(bytes);
        },
      })
    ).rejects.toThrow('hash-failed');
  });
  it('detaches caller data before hashing and rechecks exact plan digest at every use', async () => {
    const { bytes, selection, plan } = await fixture();
    const mutable = clone({ ...requirements, selection });
    const expected = encodeBaselinePlan(plan.plan);
    const result = await createBaselinePlan(bytes, mutable, {
      ...dependencies(),
      sha256: async supplied => {
        mutable.selection[0] = identity(99);
        bytes[0] = 0;
        return hash(supplied);
      },
    });
    expect(encodeBaselinePlan(result.plan)).toEqual(expected);
    const forged = { ...plan, planSha256: 'f'.repeat(64) };
    await expect(
      createBaselineCheckpoint(
        forged,
        { now: 0, windowId: 'a', maxReservationSlots: 1 },
        dependencies()
      )
    ).rejects.toThrow('digest-mismatch');
    const { checkpoint } = await fixture();
    expect(await nextBaselineDecision(forged, checkpoint, [], 101, dependencies())).toEqual({
      executionAuthorized: false,
      kind: 'stop',
      reason: 'conflict',
    });
  });
});
