import {
  decodeJournal,
  encodeJournal,
  type JournalItemState,
  type ResumabilityJournal,
} from '../core';
import { JOURNAL_MAX_RECORD_BYTES, JOURNAL_MAX_RUNS } from './database';
import { JournalStorageError } from './errors';
import type { JournalTransaction } from './transaction';

export interface JournalSummary {
  runId: string;
  revision: number;
  control: ResumabilityJournal['control'];
  itemCount: number;
  attemptCount: number;
  itemStates: Record<JournalItemState, number>;
}

export interface PreparedJournal {
  journal: ResumabilityJournal;
  bytes: Uint8Array;
}

export function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

export function prepareJournal(value: ResumabilityJournal): PreparedJournal {
  const bytes = encodeJournal(value).slice();
  if (bytes.byteLength > JOURNAL_MAX_RECORD_BYTES)
    throw new JournalStorageError('record-too-large');
  return { journal: decodeJournal(bytes), bytes };
}

/** Canonical bytes and the out-of-line primary key are validated together on every read. */
export function storedJournal(key: IDBValidKey, value: unknown): PreparedJournal {
  try {
    if (typeof key !== 'string' || !(value instanceof Uint8Array)) throw new Error();
    if (value.byteLength > JOURNAL_MAX_RECORD_BYTES) throw new Error();
    const prepared = prepareJournal(decodeJournal(value.slice()));
    if (prepared.journal.runId !== key || !sameBytes(prepared.bytes, value)) throw new Error();
    return prepared;
  } catch {
    throw new JournalStorageError('corrupt-record');
  }
}

export function collectJournals<Output>(
  context: JournalTransaction<Output>,
  onCollected: (records: PreparedJournal[]) => void
): void {
  const records: PreparedJournal[] = [];
  const request = context.store.openCursor();
  context.request(request, cursor => {
    if (!cursor) return onCollected(records);
    if (records.length >= JOURNAL_MAX_RUNS) throw new JournalStorageError('run-limit');
    records.push(storedJournal(cursor.key, cursor.value));
    cursor.continue();
  });
}

export function summarizeJournal(journal: ResumabilityJournal): JournalSummary {
  const itemStates: Record<JournalItemState, number> = {
    pending: 0,
    running: 0,
    recorded: 0,
    deferred: 0,
    failed: 0,
    unknown: 0,
    cancelled: 0,
  };
  let attemptCount = 0;
  for (const item of journal.items) {
    itemStates[item.state]++;
    attemptCount += item.attempts.length;
  }
  return {
    runId: journal.runId,
    revision: journal.revision,
    control: journal.control,
    itemCount: journal.items.length,
    attemptCount,
    itemStates,
  };
}
