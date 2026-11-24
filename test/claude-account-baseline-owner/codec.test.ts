// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_ACCOUNT_BASELINE_OWNER_MAX_BYTES,
  decodeClaudeAccountBaseline,
  prepareClaudeAccountBaseline,
} from '../../src/claude-account-baseline-owner/codec';
import {
  admitClaudeAccountCatalog,
  snapshotClaudeAccountCatalogAdmission,
} from '../../src/claude-baseline';
import {
  admitted,
  collectionA,
  conversationId,
} from '../browser/claude-account-baseline-owner/fixture';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const expectFrozen = (value: object) => {
  expect(Object.isFrozen(value)).toBe(true);
  for (const item of Object.values(value))
    if (item !== null && typeof item === 'object') expectFrozen(item);
};

describe('Claude one-shot paused owner codec', () => {
  it.each([0, 12, 30])('round trips exactly %i targets with one copy of each marker', count => {
    const input = admitted(count);
    const prepared = prepareClaudeAccountBaseline(collectionA, input);
    const restored = decodeClaudeAccountBaseline(prepared.bytes);
    expect(restored).toEqual(prepared.value);
    expect(prepared.value).toMatchObject({
      collectionId: collectionA,
      phase: 'paused',
      revision: 0,
      accountComplete: false,
      executionAuthorized: false,
    });
    expect(restored.items).toEqual(
      Array.from({ length: count }, (_, index) => ({
        conversationId: conversationId(index),
        state: 'pending',
      }))
    );
    expect(new TextDecoder().decode(prepared.bytes).match(/synthetic-marker/gu) ?? []).toHaveLength(
      count
    );
    expectFrozen(restored);
    expectFrozen(prepared.value);
    expect(Object.isFrozen(input)).toBe(false);
    expect(restored.admission).not.toBe(input);
    expect(restored.admission).not.toBe(prepared.value.admission);
  });

  it('fits the maximum shape with 30 × 256 code units each escaped to six UTF-8 bytes', () => {
    const maximallyEscaped = '\u0000'.repeat(128) + '\ud800'.repeat(128);
    expect(JSON.stringify(maximallyEscaped).length - 2).toBe(256 * 6);
    const worst = prepareClaudeAccountBaseline(collectionA, admitted(30, maximallyEscaped));
    const fixedShapeOverhead =
      prepareClaudeAccountBaseline(collectionA, admitted(30, 'x')).bytes.length - 30;
    expect(worst.bytes.length).toBe(fixedShapeOverhead + 30 * 256 * 6);
    expect(worst.bytes.length).toBe(53_291);
    expect(worst.bytes.length).toBeLessThanOrEqual(CLAUDE_ACCOUNT_BASELINE_OWNER_MAX_BYTES);
    expect(decodeClaudeAccountBaseline(worst.bytes)).toEqual(worst.value);
  });

  it('takes real ADR-081 output as is, including optional markers and deterministic order', async () => {
    const result = await admitClaudeAccountCatalog(
      {
        routeOrganization: conversationId(99),
        scopeHeaders: {
          'anthropic-organization-id': conversationId(99),
          'anthropic-workspace-id': 'synthetic',
        },
        manualAttestation: 'manual-same-visible-personal-context',
        activePage: {
          offset: 0,
          body: {
            data: [2, 1].map(uuid => ({ uuid: conversationId(uuid), is_archived: false })),
            has_more: false,
          },
        },
        archivedPage: { offset: 0, body: { data: [], has_more: false } },
      },
      () => new Uint8Array(32)
    );
    const prepared = prepareClaudeAccountBaseline(collectionA, result);
    expect(prepared.value.admission).toEqual(result);
    expect(prepared.value.admission.catalog.targets).toEqual(
      [1, 2].map(index => ({ conversationId: conversationId(index) }))
    );
  });

  it('normalizes closed own-data property order and does not mutate either input or output bytes', () => {
    const input = admitted(1);
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    const first = prepareClaudeAccountBaseline(collectionA, input);
    const second = prepareClaudeAccountBaseline(collectionA, reordered);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.bytes).not.toBe(second.bytes);
    const marker = input.catalog.targets[0].marker!;
    Object.assign(marker, { token: 'caller-changed' });
    const decoded = decodeClaudeAccountBaseline(first.bytes);
    first.bytes.fill(0);
    expect(decoded.admission.catalog.targets[0].marker?.token).toBe('synthetic-marker');
    expect(second.bytes[0]).toBe(123);
  });

  it.each([
    { maxBytes: 65537 },
    { maxBytes: 0 },
    { admissionLimits: { maxRecords: 31 } },
    { admissionLimits: { maxTokenCodeUnits: 257 } },
    { extra: 1 },
  ])('rejects invalid / raised limits (%j)', limits => {
    expect(() => prepareClaudeAccountBaseline(collectionA, admitted(), limits)).toThrow(
      'invalid-limits'
    );
  });

  it('applies lowered limits on formation and decoding', () => {
    const input = admitted(12);
    const { bytes } = prepareClaudeAccountBaseline(collectionA, input);
    for (const limits of [
      { maxBytes: bytes.length - 1 },
      { admissionLimits: { maxRecords: 11 } },
      { admissionLimits: { maxTokenCodeUnits: 1 } },
      { admissionLimits: { maxObjectKeys: 7 } },
    ]) {
      expect(() => prepareClaudeAccountBaseline(collectionA, input, limits)).toThrow(
        'limit-exceeded'
      );
      expect(() => decodeClaudeAccountBaseline(bytes, limits)).toThrow('limit-exceeded');
    }
    expect(
      prepareClaudeAccountBaseline(collectionA, input, { maxBytes: bytes.length }).bytes
    ).toEqual(bytes);
    expect(() => prepareClaudeAccountBaseline(collectionA, admitted(31))).toThrow('limit-exceeded');
    expect(() => decodeClaudeAccountBaseline(new Uint8Array(65537))).toThrow('limit-exceeded');
  });

  it.each(['', 'abc', collectionA.toUpperCase(), collectionA + '\n', collectionA.slice(1)])(
    'rejects a noncanonical collection ID %j',
    id => expect(() => prepareClaudeAccountBaseline(id, admitted())).toThrow('invalid-input')
  );

  it('rejects descriptors, symbols, sparse or exotic data without reading accessors', () => {
    let reads = 0;
    const accessor = () => {
      reads += 1;
      throw new Error('getter must not run');
    };
    const input = admitted(2);
    const getter = Object.defineProperty({ ...input }, 'catalog', { get: accessor });
    const hidden = Object.defineProperty({ ...input }, 'catalog', { enumerable: false });
    const sparse = { ...input, catalog: { ...input.catalog, targets: Array(1) } };
    const exotic = { ...input, evidence: Object.assign(Object.create({}), input.evidence) };
    const symbol = { ...input, [Symbol('opaque')]: 'unknown' };
    const marker = {
      ...input,
      catalog: {
        ...input.catalog,
        targets: [
          {
            ...input.catalog.targets[0],
            marker: Object.defineProperty({}, 'token', { get: accessor }),
          },
        ],
      },
    };
    for (const invalid of [getter, hidden, sparse, exotic, symbol, marker]) {
      expect(snapshotClaudeAccountCatalogAdmission(invalid)).toMatchObject({
        kind: 'rejected',
        reason: 'invalid-input',
      });
      expect(() => prepareClaudeAccountBaseline(collectionA, invalid)).toThrow('invalid-input');
    }
    expect(reads).toBe(0);
  });

  it('rejects malformed/foreign admissions, misplaced evidence, unsorted or duplicate targets', () => {
    const input = admitted(2);
    const withTargets = (targets: readonly unknown[]) => ({
      ...input,
      catalog: { ...input.catalog, targets },
    });
    const [left, right] = input.catalog.targets;
    for (const invalid of [
      { kind: 'rejected', reason: 'invalid-input' },
      { ...input, schema: 'foreign/1' },
      { ...input, routeOrganization: '' },
      { ...input, evidence: { ...input.evidence, executionAuthorized: true } },
      { ...input, evidence: { ...input.evidence, archived: 'unobserved' } },
      { ...input, catalog: { ...input.catalog, scopeKey: 'raw' } },
      {
        ...input,
        catalog: {
          ...input.catalog,
          coverage: { active: 'terminal-observed', archived: 'terminal-observed' },
        },
      },
      withTargets([right, left]),
      withTargets([left, left]),
      withTargets([{ ...left, conversationId: 'not-lowercase-uuid' }]),
      withTargets([{ ...left, marker: { ...left.marker, source: 'unknown' } }]),
    ])
      expect(() => prepareClaudeAccountBaseline(collectionA, invalid)).toThrow('invalid-input');
  });

  it('detects envelope corruption, mismatched items, and escalation after parse', () => {
    const { value } = prepareClaudeAccountBaseline(collectionA, admitted(2));
    const [first, second] = value.items;
    for (const patch of [
      { phase: 'active' },
      { revision: 1 },
      { revision: -0 },
      { accountComplete: true },
      { executionAuthorized: true },
      { extra: 0 },
      { operations: [] },
      { items: [second, first] },
      { items: [first] },
      { items: [first, first] },
      { items: [{ ...first, marker: 'duplicate' }, second] },
      { items: [{ ...first, state: 'done' }, second] },
    ]) {
      // JSON.stringify(-0) canonicalizes to 0, exercise the alternate raw spelling separately.
      if (Object.is(patch.revision, -0)) continue;
      expect(() => decodeClaudeAccountBaseline(encode({ ...value, ...patch }))).toThrow('corrupt');
    }
    expect(() => decodeClaudeAccountBaseline(encode({ ...value, schema: 'foreign/2' }))).toThrow(
      'unsupported'
    );
  });

  it('rejects alternate JSON spellings, bad UTF-8, and noncanonical byte containers', () => {
    const { bytes } = prepareClaudeAccountBaseline(collectionA, admitted(1));
    const json = new TextDecoder().decode(bytes);
    for (const altered of [
      ' ' + json,
      json.replace('"revision":0', '"revision":-0'),
      json.replace('"revision":0', '"revision":0,"revision":0'),
      json.replace('"paused"', '"paus\\u0065d"'),
    ])
      expect(() => decodeClaudeAccountBaseline(new TextEncoder().encode(altered))).toThrow(
        'corrupt'
      );
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes, 1);
    for (const other of [
      bytes.buffer,
      padded.subarray(1),
      Buffer.from(bytes),
      json,
      Uint8Array.of(0xff),
      Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes),
      Object.assign(bytes.slice(), { extra: true }),
    ])
      expect(() => decodeClaudeAccountBaseline(other)).toThrow('corrupt');
  });
});
