// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createPurposePersistenceStore,
  JOURNAL_DATABASE_NAME,
  JOURNAL_STORE_NAME,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import {
  controlRecord,
  encodeWithControlHeadroom,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/control';
import * as records from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import {
  canonical,
  MAX_RECORD_BYTES,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/data';
import { adaptChatGptProducerEvidence } from '../../../src/resumability-journal/producer-adapter';
import type { PreparedChatGptCapture } from '../../../src/resumability-journal/capture-handoff';
import { clone, receipts, reserve, sha256 } from './fixtures';

afterEach(() => vi.restoreAllMocks());
const byteLength = (input: unknown) => new TextEncoder().encode(canonical(input)).byteLength;

/** Real accepted receipts; tune independent path fields in exact UTF8 bytes, not a mocked encoder. */
async function boundaryObservation(
  prepared: PreparedChatGptCapture,
  current: records.OperationRecord,
  targetBytes: number
) {
  const factual = [clone(receipts(prepared)[0]), clone(receipts(prepared)[0])];
  for (const receipt of factual)
    Object.assign(receipt, {
      observations: Array.from({ length: 700 }, () => ({
        destination: 'file',
        commitment: { ...receipt.raw, relativePath: '中'.repeat(900) },
        observation: {
          kind: 'browser-download-complete-path-confirmed',
          observedRelativePath: '中'.repeat(900),
        },
      })),
    });
  const adaptation = await adaptChatGptProducerEvidence(current.operation, factual, sha256);
  // Each receipt is valid; their combined adapter traversal conservatively rejects its own budget.
  expect(adaptation.adapterCode).toBe('invalid-producer-evidence');
  expect(adaptation).not.toHaveProperty('evidence');
  const candidate = () =>
    records.revise(current, {
      phase: 'awaiting-resolution',
      observation: {
        adapterVersion: records.ADAPTER_VERSION,
        hashOutcome: 'available',
        receipts: factual,
        adaptation,
      },
    });
  let remaining = targetBytes - byteLength(candidate());
  expect(remaining).toBeGreaterThanOrEqual(0);
  for (const receipt of factual)
    for (const item of receipt.observations) {
      for (const [object, key] of [
        [item.commitment, 'relativePath'],
        [item.observation!, 'observedRelativePath'],
      ] as const) {
        const chinese = Math.min(123, Math.floor(remaining / 3));
        const ascii = Math.min(124 - chinese, remaining - chinese * 3);
        Object.assign(object, { [key]: '中'.repeat(900 + chinese) + 'a'.repeat(ascii) });
        remaining -= chinese * 3 + ascii;
      }
    }
  expect(remaining).toBe(0);
  const record = candidate();
  expect(byteLength(record)).toBe(targetBytes);
  await records.validateObservation(record, sha256);
  return { record, factual };
}

async function replaceRevision(
  factory: IDBFactory,
  record: records.OperationRecord,
  revision: number
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open(JOURNAL_DATABASE_NAME, 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(JOURNAL_STORE_NAME, 'readwrite');
      tx.objectStore(JOURNAL_STORE_NAME).put(
        records.encodeRecord({ ...record, revision }),
        record.operation.operationId
      );
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

it('rejects a valid MAX-2 observation before committing, preserving the exact in-flight record and current token', async () => {
  const value = createPurposePersistenceStore({ indexedDB: new IDBFactory(), sha256 });
  await value.open();
  try {
    const { prepared } = await reserve(value);
    const { record: current, token } = await value.claimDispatch('operation-1', 0);
    const { record, factual } = await boundaryObservation(prepared, current, MAX_RECORD_BYTES - 2);
    expect(records.encodeRecord(record).length).toBe(8_388_606);
    expect(() => records.encodeRecord(controlRecord(record, 'abandon'))).toThrow(
      'record-too-large'
    );
    expect(() => encodeWithControlHeadroom(record)).toThrow('record-too-large');
    await expect(value.recordProducerReceipts('operation-1', 1, factual)).rejects.toMatchObject({
      code: 'record-too-large',
    });
    expect(await value.read('operation-1')).toEqual(current);
    expect(await value.checkCurrent(token)).toBe(true);
  } finally {
    value.close();
  }
});

it('accepts the exact projected byte boundary, accounts for 9 -> 10 revision growth, and retains bytes through pause then abandon', async () => {
  const factory = new IDBFactory();
  const value = createPurposePersistenceStore({
    indexedDB: factory,
    sha256,
    transactionTimeoutMs: 30000,
  });
  await value.open();
  try {
    const { prepared, record: reserved } = await reserve(value);
    await replaceRevision(factory, reserved, 7);
    const { record: current } = await value.claimDispatch('operation-1', 7);
    const small = records.revise(current, {
      phase: 'awaiting-resolution',
      observation: {
        adapterVersion: records.ADAPTER_VERSION,
        hashOutcome: 'available',
        receipts: [],
        adaptation: await adaptChatGptProducerEvidence(current.operation, [], sha256),
      },
    });
    const widest = {
      ...controlRecord(controlRecord(small, 'pause'), 'abandon'),
      revision: Number.MAX_SAFE_INTEGER,
    };
    const requiredHeadroom = byteLength(widest) - byteLength(small);
    const { record, factual } = await boundaryObservation(
      prepared,
      current,
      MAX_RECORD_BYTES - requiredHeadroom
    );
    const projected = {
      ...controlRecord(controlRecord(record, 'pause'), 'abandon'),
      revision: Number.MAX_SAFE_INTEGER,
    };
    expect(records.encodeRecord(projected).length).toBe(MAX_RECORD_BYTES);
    expect(encodeWithControlHeadroom(record).length).toBe(MAX_RECORD_BYTES - requiredHeadroom);
    const oneByteLarger = await boundaryObservation(
      prepared,
      current,
      MAX_RECORD_BYTES - requiredHeadroom + 1
    );
    expect(() => encodeWithControlHeadroom(oneByteLarger.record)).toThrow('record-too-large');
    const observed = await value.recordProducerReceipts('operation-1', 8, factual);
    expect(observed.revision).toBe(9);
    const paused = await value.pause('operation-1', 9);
    expect(paused.revision).toBe(10);
    expect(records.encodeRecord(paused).length).toBe(records.encodeRecord(observed).length + 1);
    const abandoned = await value.abandon('operation-1', 10);
    expect(abandoned.revision).toBe(11);
    expect(abandoned.observation).toEqual(observed.observation);
    expect(records.encodeRecord(abandoned).length).toBeLessThanOrEqual(MAX_RECORD_BYTES);
    expect(await value.read('operation-1')).toEqual(abandoned);
  } finally {
    value.close();
  }
});

it('projects all actual in-flight fencing paths before token admission, at full revision width', async () => {
  const value = createPurposePersistenceStore({ indexedDB: new IDBFactory(), sha256 });
  await value.open();
  try {
    const { record: reserved } = await reserve(value);
    const current = records.revise({ ...reserved, revision: 8 }, { phase: 'in-flight' });
    const encode = vi.spyOn(records, 'encodeRecord');
    encodeWithControlHeadroom(current);
    const projected = encode.mock.calls
      .slice(1)
      .map(([record]) => record as records.OperationRecord);
    for (const reason of ['pause', 'restart', 'abandon', ...records.EXECUTION_INTERRUPTION_REASONS])
      expect(
        projected.some(record => record.phase === 'unknown' && record.interruptionReason === reason)
      ).toBe(true);
    expect(
      projected.some(
        record =>
          record.interruptionReason === 'restart' &&
          record.control === 'paused' &&
          record.disposition === 'abandoned'
      )
    ).toBe(true);
    expect(
      projected.some(
        record => record.interruptionReason === 'pause' && record.disposition === 'abandoned'
      )
    ).toBe(true);
    expect(projected.every(record => record.revision === Number.MAX_SAFE_INTEGER)).toBe(true);
    const paused = controlRecord(current, 'pause');
    expect(paused.revision).toBe(10);
    expect(controlRecord(paused, 'abandon').revision).toBe(11);
    encode.mockRestore();
    expect(() =>
      encodeWithControlHeadroom({ ...current, revision: Number.MAX_SAFE_INTEGER - 2 })
    ).toThrow('revision-conflict');
    const before = await value.read('operation-1');
    expect(before).toEqual(reserved);
  } finally {
    value.close();
  }
});
