// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  snapshotClaudeProducerIntent,
  snapshotClaudeProducerReceipt,
} from '../../src/lib/claude-producer-evidence';
import {
  claudeIntent,
  claudeReceipts,
  clone,
  commitment,
} from '../resumability-journal/purpose-persistence-v3/fixtures';

describe('strict Claude factual metadata contract', () => {
  it('detaches, canonically orders keys/destinations and deeply freezes without changing caller data', () => {
    const input = clone(claudeReceipts()[0]);
    Object.assign(input, { requestedDestinations: ['obsidian', 'file'] });
    Object.assign(input.intent!, { requiredDestinations: ['obsidian', 'file'] });
    const receipt = snapshotClaudeProducerReceipt(input);
    expect(receipt).not.toBe(input);
    expect(receipt.raw).not.toBe(input.raw);
    expect(receipt.requestedDestinations).toEqual(['file', 'obsidian']);
    expect(input.requestedDestinations).toEqual(['obsidian', 'file']);
    expect(Object.keys(receipt)).toEqual(Object.keys(receipt).sort());
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.intent!.requiredDestinations)).toBe(true);
    expect(Object.isFrozen(receipt.observations[0].commitment)).toBe(true);
    Object.assign(input.raw, { byteLength: 999 });
    expect(receipt.raw.byteLength).toBe(2);
    const intent = snapshotClaudeProducerIntent(claudeIntent());
    expect(intent.provider).toBe('claude');
    expect(Object.isFrozen(intent)).toBe(true);
  });
  it.each([
    { provider: 'chatgpt' },
    { schema: 'liska-chatgpt-producer-evidence/1' },
    { schema: 'liska-claude-producer-evidence/2' },
    { bodyBase64: 'bytes-are-not-metadata' },
    { requestedDestinations: [] },
    { requestedDestinations: ['file', 'file'] },
    { requestedDestinations: ['file', 'obsidian', 'other'] },
    { destination: 'other' },
    { legacyRoutingDigest: 'A'.repeat(64) },
    { conversationId: 'has spaces' },
    { completeness: { graph: 'complete' } },
    { assets: [{ assetId: 'a', state: 'other' }] },
    { assets: [{ assetId: 'a', state: 'fetched', bytes: [1] }] },
    {
      assets: [
        { assetId: 'a', state: 'failed' },
        { assetId: 'a', state: 'failed' },
      ],
    },
  ])('rejects an inexact receipt %j', changes => {
    expect(() => snapshotClaudeProducerReceipt({ ...claudeReceipts()[0], ...changes })).toThrow(
      'invalid-producer-evidence'
    );
  });
  it.each([
    { provider: 'chatgpt' },
    { provider: 'gemini' },
    { operationId: '' },
    { captureId: 'x'.repeat(257) },
    { conversationKey: 'liska-conversation-key/1:wrong' },
    { catalogSha256: 'a'.repeat(63) },
    { requiredDestinations: [] },
    { requiredDestinations: ['file', 'file'] },
    { inferred: true },
  ])('rejects an inexact pre-write intent %j', changes => {
    const input = { ...claudeIntent(), ...changes };
    expect(() => snapshotClaudeProducerIntent(input)).toThrow('invalid-producer-evidence');
    expect(() => snapshotClaudeProducerReceipt({ ...claudeReceipts()[0], intent: input })).toThrow(
      'invalid-producer-evidence'
    );
  });
  it('rejects missing mandatory fields and exact commitment/observation shape violations', () => {
    const receipt = claudeReceipts()[0];
    for (const field of Object.keys(receipt).filter(key => key !== 'intent')) {
      const input = { ...receipt };
      Reflect.deleteProperty(input, field);
      expect(() => snapshotClaudeProducerReceipt(input)).toThrow('invalid-producer-evidence');
    }
    for (const changes of [
      { relativePath: '../raw.json' },
      { relativePath: '/raw.json' },
      { relativePath: 'C:/raw.json' },
      { relativePath: 'raw\\x.json' },
      { relativePath: 'raw /x.json' },
      { relativePath: 'raw\u0000.json' },
      { byteLength: -1 },
      { byteLength: Number.MAX_SAFE_INTEGER + 1 },
      { byteLength: 0.5 },
      { sha256: 'bad' },
      { body: 'not-metadata' },
    ])
      expect(() =>
        snapshotClaudeProducerReceipt({ ...receipt, raw: { ...receipt.raw, ...changes } })
      ).toThrow('invalid-producer-evidence');
    for (const observation of [
      { kind: 'success' },
      { kind: 'byte-readback-sha256', byteLength: 2, sha256: 'a'.repeat(64), extra: true },
      { kind: 'browser-download-complete-path-confirmed', observedRelativePath: 'x', sha256: 'a' },
    ])
      expect(() =>
        snapshotClaudeProducerReceipt({
          ...receipt,
          observations: [{ ...receipt.observations[0], observation }],
        })
      ).toThrow('invalid-producer-evidence');
  });
  it('rejects getters, descriptors, prototypes, symbols, sparse/cyclic/capability data without invoking accessors', () => {
    const getter = vi.fn();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const malformed = [
      Object.defineProperty({}, 'raw', { get: getter, enumerable: true }),
      Object.defineProperty({}, 'raw', { value: 1 }),
      { toJSON: getter },
      { [Symbol('private')]: 1 },
      Object.create({ inherited: 1 }),
      cycle,
      Array(1),
      new Date(),
      new Uint8Array(1),
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('private');
          },
        }
      ),
    ];
    for (const value of malformed) {
      expect(() => snapshotClaudeProducerReceipt(value)).toThrow('invalid-producer-evidence');
      expect(() => snapshotClaudeProducerIntent(value)).toThrow('invalid-producer-evidence');
    }
    expect(() =>
      snapshotClaudeProducerReceipt({
        ...claudeReceipts()[0],
        raw: Object.defineProperty({}, 'relativePath', { get: getter, enumerable: true }),
      })
    ).toThrow('invalid-producer-evidence');
    expect(getter).not.toHaveBeenCalled();
  });
  it('enforces exact identifier, path, asset, observation and safe-byte limits', () => {
    const base = claudeReceipts()[0];
    const assets = Array.from({ length: 1024 }, (_, i) => ({
      assetId: `asset-${i}`,
      state: 'failed',
    }));
    const observations = Array.from({ length: 1027 }, () => base.observations[0]);
    expect(() =>
      snapshotClaudeProducerReceipt({
        ...base,
        conversationId: 'a'.repeat(256),
        raw: { ...commitment('a'.repeat(1024)), byteLength: Number.MAX_SAFE_INTEGER },
        assets,
        observations,
      })
    ).not.toThrow();
    for (const changes of [
      { conversationId: 'a'.repeat(257) },
      { raw: commitment('a'.repeat(1025)) },
      { assets: [...assets, { assetId: 'overflow', state: 'failed' }] },
      { observations: [...observations, base.observations[0]] },
    ])
      expect(() => snapshotClaudeProducerReceipt({ ...base, ...changes })).toThrow(
        'invalid-producer-evidence'
      );
  });
  it.each(['not-attempted', 'fetched', 'unavailable', 'declined', 'expired', 'failed'])(
    'retains the metadata-only %s asset state without manufacturing a commitment',
    state => {
      const receipt = snapshotClaudeProducerReceipt({
        ...claudeReceipts()[0],
        assets: [{ assetId: 'asset-1', state }],
      });
      expect(receipt.assets).toEqual([{ assetId: 'asset-1', state }]);
      expect(Object.isFrozen(receipt.assets[0])).toBe(true);
    }
  );
});
