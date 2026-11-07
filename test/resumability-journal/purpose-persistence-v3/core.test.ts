// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  canonical,
  detach,
  MAX_RECORD_BYTES,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/data';
import {
  CHATGPT_ADAPTER_VERSION,
  CLAUDE_ADAPTER_VERSION,
  EXECUTION_INTERRUPTION_REASONS,
  RECORD_SCHEMA,
  decodeRecord,
  encodeRecord,
  revise,
  snapshotReceipts,
  snapshotRecord,
  validateObservation,
  type OperationRecord,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import {
  controlRecord,
  encodeWithControlHeadroom,
  interruptExecution,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/control';
import { adaptClaudeProducerEvidence } from '../../../src/resumability-journal/claude-producer-adapter';
import { claudeReceipts, clone, hash, observed, operation, reserved } from './fixtures';

describe.each(['chatgpt', 'claude'] as const)('journal/3 %s exact record', provider => {
  it('roundtrips reserved and observed canonical UTF8 bytes with detached frozen data', async () => {
    for (const record of [reserved(provider), await observed(provider)]) {
      const encoded = encodeRecord(record);
      const restored = decodeRecord(encoded, 'operation-1');
      expect(restored).toEqual(record);
      expect(restored).not.toBe(record);
      expect(restored.operation).not.toBe(record.operation);
      expect(Object.isFrozen(restored.operation.destinations)).toBe(true);
      expect(encodeRecord(restored)).toEqual(encoded);
      await expect(validateObservation(restored, hash)).resolves.toBeUndefined();
    }
    const record = await observed(provider);
    expect(record.observation!.provider).toBe(provider);
    expect(record.observation!.adapterVersion).toBe(
      provider === 'chatgpt' ? CHATGPT_ADAPTER_VERSION : CLAUDE_ADAPTER_VERSION
    );
    expect(record.observation!.adaptation.assessment).toEqual({ kind: 'consistent', codes: [] });
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    const input = clone(record);
    const snapshot = snapshotRecord(input);
    Object.assign(input.observation!.receipts[0].raw, { byteLength: 999 });
    expect(snapshot.observation!.receipts[0].raw.byteLength).toBe(2);
  });
  it('replays historical hash failure without consulting a new verifier', async () => {
    const record = await observed(provider, true);
    expect(record.observation!.adaptation.adapterCode).toBe('hash-failed');
    const currentHasher = vi.fn(hash);
    await expect(validateObservation(record, currentHasher)).resolves.toBeUndefined();
    expect(currentHasher).not.toHaveBeenCalled();
    const unavailable = vi.fn(() => {
      throw new Error('private unavailable');
    });
    await expect(validateObservation(await observed(provider), unavailable)).rejects.toThrow(
      'read-failed'
    );
    await expect(validateObservation(await observed(provider), () => 'malformed')).rejects.toThrow(
      'read-failed'
    );
  });
  it.each(['assessment', 'codes', 'evidence', 'adapterCode', 'conflict-without-evidence'])(
    'never trusts forged cached %s',
    async field => {
      const record = clone(await observed(provider));
      const adaptation = record.observation!.adaptation;
      if (field === 'assessment') Object.assign(adaptation.assessment, { kind: 'insufficient' });
      if (field === 'codes') Object.assign(adaptation.assessment, { codes: ['evidence-missing'] });
      if (field === 'evidence')
        Object.assign(adaptation.evidence!.binding!, { attemptId: 'forged' });
      if (field === 'adapterCode') Object.assign(adaptation, { adapterCode: 'identity-conflict' });
      if (field === 'conflict-without-evidence')
        Object.assign(record.observation!, {
          adaptation: {
            adapterCode: 'identity-conflict',
            assessment: { kind: 'conflict', codes: ['identity-conflict'] },
          },
        });
      const structural = snapshotRecord(record);
      expect(decodeRecord(encodeRecord(structural), 'operation-1')).toEqual(structural);
      await expect(validateObservation(structural, hash)).rejects.toThrow('corrupt-record');
    }
  );
  it('replays actual insufficient and conflict receipts instead of promoting cached success', async () => {
    const record = clone(await observed(provider));
    Reflect.deleteProperty(record.observation!.receipts[0], 'intent');
    await expect(validateObservation(snapshotRecord(record), hash)).rejects.toThrow(
      'corrupt-record'
    );
    Object.assign(record.observation!.receipts[0], { captureId: 'another-capture' });
    await expect(validateObservation(snapshotRecord(record), hash)).rejects.toThrow(
      'corrupt-record'
    );
  });
  it('rejects every provider/schema/adapter mismatch and mixed receipt set before replay', async () => {
    const record = await observed(provider);
    const other = await observed(provider === 'chatgpt' ? 'claude' : 'chatgpt');
    const observation = record.observation!;
    for (const changes of [
      { provider: other.observation!.provider },
      { provider: 'gemini' },
      { adapterVersion: other.observation!.adapterVersion },
      { adapterVersion: 'liska-claude-producer-adapter/2' },
      { receipts: other.observation!.receipts },
      { receipts: [observation.receipts[0], other.observation!.receipts[1]] },
      { receipts: [{ ...observation.receipts[0], provider: other.observation!.provider }] },
      { receipts: [{ ...observation.receipts[0], schema: other.observation!.receipts[0].schema }] },
      { provider: undefined },
      { hashOutcome: 'unknown' },
      { hashOutcome: 'failed' },
    ])
      expect(() =>
        snapshotRecord({ ...record, observation: { ...observation, ...changes } })
      ).toThrow('corrupt-record');
    expect(() => snapshotReceipts(provider, other.observation!.receipts)).toThrow(
      'invalid-receipts'
    );
    expect(() =>
      snapshotReceipts(provider, [...observation.receipts, observation.receipts[0]])
    ).toThrow('invalid-receipts');
    await expect(
      validateObservation({ ...record, observation: other.observation } as OperationRecord, hash)
    ).rejects.toThrow('corrupt-record');
  });
});

describe('journal/3 canonical data and lifecycle constraints', () => {
  it('rejects other providers and versions, noncanonical operation order and extra data', () => {
    const record = reserved();
    for (const provider of ['gemini', 'chatgpt-extra', 'Claude', ''])
      expect(() =>
        snapshotRecord({
          ...record,
          operation: {
            ...record.operation,
            admission: { ...record.operation.admission, provider },
          },
        })
      ).toThrow('corrupt-record');
    for (const schema of [
      'liska-resumability-journal/1',
      'liska-resumability-journal/2',
      'liska-resumability-journal/4',
    ])
      expect(() => snapshotRecord({ ...record, schema })).toThrow('corrupt-record');
    expect(() =>
      snapshotRecord({
        ...record,
        operation: {
          ...record.operation,
          destinations: [...record.operation.destinations].reverse(),
        },
      })
    ).toThrow('corrupt-record');
    expect(() => snapshotRecord({ ...record, body: 'not-allowed' })).toThrow('corrupt-record');
  });
  it('rejects descriptor/capability data, unsafe numbers and budget violations without calling getters', () => {
    const getter = vi.fn();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let deep: unknown = null;
    for (let i = 0; i < 25; i++) deep = { deep };
    for (const input of [
      Object.defineProperty({}, 'x', { get: getter, enumerable: true }),
      Object.defineProperty({}, 'x', { value: 1 }),
      { toJSON: getter },
      { [Symbol('x')]: 1 },
      cycle,
      deep,
      Array(1),
      new Uint8Array(1),
      new Date(),
      new Map(),
      -0,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      'x'.repeat(4097),
      Array(4097).fill(null),
      { ['k'.repeat(257)]: null },
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('private');
          },
        }
      ),
    ])
      expect(() => detach(input)).toThrow('corrupt-record');
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects corrupt bytes, noncanonical JSON, wrong keys, duplicate properties and replacement decoding', () => {
    const record = reserved();
    const text = canonical(record);
    const utf8 = (value: string) => new TextEncoder().encode(value);
    for (const value of [
      utf8(text + ' '),
      utf8('\uFEFF' + text),
      utf8(JSON.stringify({ schema: record.schema, ...record })),
      utf8(text.replace('"revision":0', '"revision":0,"revision":0')),
      utf8(text.replace('"revision":0', '"revision":0.0')),
      utf8(text.replace('"revision":0', '"revision":-0')),
      utf8(text.slice(1)),
      new Uint8Array([0xff]),
      new Uint8Array(MAX_RECORD_BYTES + 1),
      { ...encodeRecord(record) },
    ])
      expect(() => decodeRecord(value, 'operation-1')).toThrow('corrupt-record');
    expect(() => decodeRecord(encodeRecord(record), 'other')).toThrow('corrupt-record');
  });
  it('retains the exact lifecycle/control/disposition and interruption vocabulary', async () => {
    const record = reserved();
    for (const changes of [
      { revision: -1 },
      { revision: 0.5 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
      { phase: 'completed' },
      { control: 'running' },
      { disposition: 'settled' },
      { phase: 'in-flight', control: 'paused' },
      { phase: 'in-flight', disposition: 'abandoned' },
      { phase: 'unknown' },
      { phase: 'awaiting-resolution' },
      { interruptionReason: 'pause' },
      { phase: 'unknown', interruptionReason: 'other' },
      { observation: (await observed()).observation },
    ])
      expect(() => snapshotRecord({ ...record, ...changes })).toThrow('corrupt-record');
    for (const reason of ['pause', 'restart', 'abandon', ...EXECUTION_INTERRUPTION_REASONS]) {
      expect(
        snapshotRecord({ ...record, phase: 'unknown', interruptionReason: reason })
          .interruptionReason
      ).toBe(reason);
      expect(
        snapshotRecord({ ...(await observed()), interruptionReason: reason }).interruptionReason
      ).toBe(reason);
    }
    const last = snapshotRecord({ ...record, revision: Number.MAX_SAFE_INTEGER });
    expect(() => revise(last, { control: 'paused' })).toThrow('revision-conflict');
    expect(record.revision).toBe(0);
  });
  it('supports pure control/interruption transitions without recording success, retry or settlement', () => {
    const record = reserved();
    const inflight = snapshotRecord({ ...record, phase: 'in-flight' });
    expect(controlRecord(record, 'restart')).toBe(record);
    expect(controlRecord(record, 'pause')).toMatchObject({
      revision: 1,
      phase: 'reserved',
      control: 'paused',
    });
    for (const reason of EXECUTION_INTERRUPTION_REASONS) {
      const interrupted = interruptExecution(inflight, reason);
      expect(interrupted).toMatchObject({
        revision: 1,
        phase: 'unknown',
        interruptionReason: reason,
        disposition: 'open',
      });
      expect(() => interruptExecution(record, reason)).toThrow('transition-failed');
      expect(() => interruptExecution(interrupted, reason)).toThrow('transition-failed');
    }
    for (const action of ['pause', 'restart', 'abandon'] as const) {
      expect(controlRecord(inflight, action)).toMatchObject({
        phase: 'unknown',
        interruptionReason: action,
      });
    }
    const abandoned = controlRecord(record, 'abandon');
    expect(() => controlRecord(abandoned, 'pause')).toThrow('transition-failed');
    expect(() => interruptExecution(inflight, 'other' as never)).toThrow('transition-failed');
    expect(encodeWithControlHeadroom(inflight)).toEqual(encodeRecord(inflight));
    expect(encodeWithControlHeadroom(abandoned)).toEqual(encodeRecord(abandoned));
  });
  it('enforces the exact 64 KiB UTF8 record ceiling and real control headroom', async () => {
    expect(MAX_RECORD_BYTES).toBe(65536);
    const receipts = claudeReceipts(['file']);
    const current = operation('claude', ['file']);
    let revision = 0;
    const assets = Array.from({ length: 100 }, (_, i) => ({
      assetId: `asset-${i}-`.padEnd(256, 'x'),
      state: 'failed',
    }));
    const build = async () => ({
      ...reserved(),
      operation: current,
      revision,
      phase: 'awaiting-resolution',
      observation: {
        provider: 'claude',
        adapterVersion: CLAUDE_ADAPTER_VERSION,
        hashOutcome: 'available',
        receipts,
        adaptation: await adaptClaudeProducerEvidence(current, receipts, hash),
      },
    });
    Object.assign(receipts[0], { assets });
    let input = await build();
    const size = () => new TextEncoder().encode(JSON.stringify(input)).byteLength;
    while (size() < MAX_RECORD_BYTES) {
      assets.push({ assetId: `asset-${assets.length}-`.padEnd(256, 'x'), state: 'failed' });
      input = await build();
    }
    if ((size() - MAX_RECORD_BYTES) % 2) {
      revision = 10;
      input = await build();
    }
    let shrink = (size() - MAX_RECORD_BYTES) / 2;
    for (const asset of [...assets].reverse()) {
      const trim = Math.min(shrink, asset.assetId.length - 12);
      asset.assetId = asset.assetId.slice(0, asset.assetId.length - trim);
      shrink -= trim;
      if (!shrink) break;
    }
    input = await build();
    expect(size()).toBe(MAX_RECORD_BYTES);
    const fitted = snapshotRecord(input);
    expect(encodeRecord(fitted)).toHaveLength(MAX_RECORD_BYTES);
    expect(decodeRecord(encodeRecord(fitted), current.operationId)).toEqual(fitted);
    await expect(validateObservation(fitted, hash)).resolves.toBeUndefined();
    const oversized = { ...fitted, revision: revision === 0 ? 10 : 100 };
    expect(() => encodeRecord(oversized)).toThrow('record-too-large');
    expect(() => encodeWithControlHeadroom(fitted)).toThrow('record-too-large');
    expect(RECORD_SCHEMA).toBe('liska-resumability-journal/3');
  });
});
