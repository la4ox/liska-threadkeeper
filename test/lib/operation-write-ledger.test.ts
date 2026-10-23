import { describe, expect, it, vi } from 'vitest';
import {
  createOperationWriteLedger,
  durableWriteOutcomeFromResult,
  OPERATION_WRITE_LEDGER_MAX_ATTEMPTS,
  snapshotDurableWriteOutcome,
  snapshotOperationWriteLedger,
} from '../../src/lib/operation-write-ledger';

const operationId = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';

describe('operation-local durable write facts', () => {
  it('retains distinct equal-byte attempts per destination, with detached frozen snapshots', () => {
    const ledger = createOperationWriteLedger(operationId);
    const outcome = { state: 'confirmed', cleanupDeferred: true };
    for (const destination of ['file', 'file', 'obsidian'] as const) {
      const attempt = ledger.begin(destination, 'binary', 12);
      attempt.issue();
      attempt.observe(outcome);
      attempt.observe(outcome);
    }
    const before = ledger.snapshot();
    outcome.state = 'unknown';
    ledger.begin('file', 'manifest', 4).observe();
    expect(before.observations).toHaveLength(3);
    expect(before.observations.map(entry => entry.attempt)).toEqual([1, 2, 3]);
    expect(before.observations.every(entry => entry.state === 'confirmed')).toBe(true);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.observations)).toBe(true);
    expect(before.observations.every(Object.isFrozen)).toBe(true);
    expect(snapshotOperationWriteLedger(before, operationId)).toEqual(before);
    expect(JSON.stringify(before)).not.toMatch(/sha256|assetId|relativePath|filename|https|error/);
  });

  it('conservatively snapshots issued attempts without a usable response and local pre-issue failures', () => {
    const ledger = createOperationWriteLedger(operationId);
    ledger.begin('file', 'raw', 10).issue();
    const malformed = ledger.begin('obsidian', 'raw', 10);
    malformed.issue();
    malformed.observe({ state: 'confirmed', private: 'no' });
    ledger.begin('file', 'canonical', 30).observe();
    expect(ledger.snapshot().observations.map(entry => entry.state)).toEqual([
      'unknown',
      'unknown',
      'not-dispatched',
    ]);
  });

  it('invalidates conflicting observations and cannot reuse an issued attempt', () => {
    const ledger = createOperationWriteLedger(operationId);
    const attempt = ledger.begin('file', 'raw', 10);
    attempt.issue();
    attempt.observe({ state: 'confirmed' });
    attempt.observe({ state: 'unknown' });
    expect(snapshotOperationWriteLedger(ledger.snapshot(), operationId)).toBeUndefined();
    const other = createOperationWriteLedger(operationId);
    const repeated = other.begin('file', 'raw', 10);
    repeated.issue();
    repeated.issue();
    expect(snapshotOperationWriteLedger(other.snapshot(), operationId)).toBeUndefined();
  });

  it('rejects foreign operations, unknown metadata, gaps, conflicts and aggregate overflow', () => {
    const ledger = createOperationWriteLedger(operationId);
    const attempt = ledger.begin('file', 'raw', Number.MAX_SAFE_INTEGER);
    attempt.issue();
    attempt.observe({ state: 'confirmed' });
    const snapshot = ledger.snapshot();
    expect(
      snapshotOperationWriteLedger(snapshot, operationId.replace('1111', '2222'))
    ).toBeUndefined();
    expect(
      snapshotOperationWriteLedger({ ...snapshot, sha256: 'no' }, operationId)
    ).toBeUndefined();
    const observation = snapshot.observations[0];
    expect(
      snapshotOperationWriteLedger(
        { ...snapshot, observations: [observation, { ...observation }] },
        operationId
      )?.observations
    ).toHaveLength(1);
    for (const observations of [
      [{ ...observation, attempt: 2 }],
      [observation, { ...observation, state: 'unknown' }],
      [observation, { ...observation, attempt: 2, byteLength: 1 }],
      [observation, { ...observation, attempt: 2, destination: 'obsidian', byteLength: 1 }],
    ])
      expect(
        snapshotOperationWriteLedger({ ...snapshot, observations }, operationId)
      ).toBeUndefined();
  });

  it('does not invoke accessors on outcomes, envelopes, observations or arrays', () => {
    const getter = vi.fn(() => 'confirmed');
    const outcome = Object.defineProperty({}, 'state', { enumerable: true, get: getter });
    expect(snapshotDurableWriteOutcome(outcome)).toBeUndefined();
    const ledger = createOperationWriteLedger(operationId);
    ledger.begin('file', 'raw', 1).issue();
    const snapshot = ledger.snapshot();
    const observations = [snapshot.observations[0]];
    Object.defineProperty(observations, '0', { enumerable: true, get: getter });
    expect(
      snapshotOperationWriteLedger({ ...snapshot, observations }, operationId)
    ).toBeUndefined();
    const envelope = Object.defineProperty({ ...snapshot }, 'valid', {
      enumerable: true,
      get: getter,
    });
    expect(snapshotOperationWriteLedger(envelope, operationId)).toBeUndefined();
    expect(
      durableWriteOutcomeFromResult(
        Object.defineProperty({ success: true }, 'writeOutcome', { enumerable: true, get: getter })
      )
    ).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'invalidates unsafe request bytes %s',
    byteLength => {
      const ledger = createOperationWriteLedger(operationId);
      ledger.begin('file', 'raw', byteLength).issue();
      expect(snapshotOperationWriteLedger(ledger.snapshot(), operationId)).toBeUndefined();
    }
  );

  it('bounds attempts and rejects inherited or symbolic evidence', () => {
    const ledger = createOperationWriteLedger(operationId);
    for (let index = 0; index <= OPERATION_WRITE_LEDGER_MAX_ATTEMPTS; index += 1)
      ledger.begin('file', 'raw', 0);
    expect(ledger.snapshot().observations).toHaveLength(OPERATION_WRITE_LEDGER_MAX_ATTEMPTS);
    expect(snapshotOperationWriteLedger(ledger.snapshot(), operationId)).toBeUndefined();
    expect(snapshotDurableWriteOutcome(Object.create({ state: 'confirmed' }))).toBeUndefined();
    expect(
      snapshotDurableWriteOutcome({ state: 'confirmed', [Symbol('private')]: true })
    ).toBeUndefined();
    expect(
      durableWriteOutcomeFromResult({ success: true, writeOutcome: { state: 'unknown' } })
    ).toBeUndefined();
    expect(
      durableWriteOutcomeFromResult({ success: false, writeOutcome: { state: 'confirmed' } })
    ).toBeUndefined();
    expect(
      snapshotDurableWriteOutcome({ state: 'unknown', cleanupDeferred: false })
    ).toBeUndefined();
  });
});
