import { canonical, MAX_RECORDS } from '../core/data';
import { decodeRecord, validateObservation, type OperationRecord } from '../core/record';
import { requireCondition } from '../core/errors';
import type { ProducerSha256 } from '../../producer-adapter';
import type { JournalTransaction, JournalTransactionRunner } from './transaction';

export interface StoredRecord {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly record: OperationRecord;
}

/** Bounded full scan also validates global reservations; never silently skips a corrupt entry. */
export function scan<Output>(
  context: JournalTransaction<Output>,
  done: (records: StoredRecord[]) => void
): void {
  const records: StoredRecord[] = [];
  const identities = {
    operationId: new Set<string>(),
    attemptId: new Set<string>(),
    captureId: new Set<string>(),
  };
  const request = context.store.openCursor();
  context.request(request, cursor => {
    if (!cursor) return done(records);
    requireCondition(records.length < MAX_RECORDS);
    const record = decodeRecord(cursor.value, cursor.key);
    for (const field of ['operationId', 'attemptId', 'captureId'] as const) {
      requireCondition(!identities[field].has(record.operation[field]));
      identities[field].add(record.operation[field]);
    }
    records.push({ key: record.operation.operationId, bytes: cursor.value as Uint8Array, record });
    cursor.continue();
  });
}

export async function validatedSnapshot(
  run: JournalTransactionRunner,
  sha256: ProducerSha256
): Promise<StoredRecord[]> {
  const records = await run<StoredRecord[]>('readonly', context => scan(context, context.finish));
  for (const { record } of records) await validateObservation(record, sha256);
  return records;
}

/** Exact full-set CAS closes the async replay / write gap. No retry on concurrent changes. */
export function assertUnchanged(
  expected: readonly StoredRecord[],
  actual: readonly StoredRecord[]
): void {
  requireCondition(
    expected.length === actual.length &&
      expected.every(
        (item, index) =>
          item.key === actual[index].key &&
          canonical(item.record) === canonical(actual[index].record)
      ),
    'revision-conflict'
  );
}

export function selected(
  records: readonly StoredRecord[],
  id: string,
  revision: number
): OperationRecord {
  const record = records.find(value => value.key === id)?.record;
  requireCondition(record, 'operation-not-found');
  requireCondition(
    Number.isSafeInteger(revision) && revision === record.revision,
    'revision-conflict'
  );
  return record;
}
