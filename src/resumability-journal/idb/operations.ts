import { transitionJournal, type ResumabilityJournal } from '../core';
import { JOURNAL_MAX_RUNS } from './database';
import { JournalStorageError, transitionError } from './errors';
import {
  collectJournals,
  prepareJournal,
  sameBytes,
  storedJournal,
  summarizeJournal,
  type PreparedJournal,
  type JournalSummary,
} from './records';
import type { JournalTransaction, JournalTransactionRunner } from './transaction';
import type { JournalReducer, JournalStore } from './types';

function nextJournal(current: PreparedJournal, reducer: JournalReducer): PreparedJournal {
  const { runId, revision } = current.journal;
  let reduced: ResumabilityJournal;
  try {
    reduced = reducer(current.journal);
  } catch (error) {
    throw transitionError(error);
  }
  const next = prepareJournal(reduced);
  const unchanged = sameBytes(current.bytes, next.bytes);
  if (
    next.journal.runId !== runId ||
    next.journal.revision !== (unchanged ? revision : revision + 1)
  ) {
    throw new JournalStorageError('transition-failed');
  }
  return next;
}

function persist<Output>(context: JournalTransaction<Output>, prepared: PreparedJournal): void {
  context.request(context.store.put(prepared.bytes, prepared.journal.runId), () => {});
}

function create(
  run: JournalTransactionRunner,
  journal: ResumabilityJournal
): Promise<ResumabilityJournal> {
  return run('readwrite', context => {
    const prepared = prepareJournal(journal);
    collectJournals(context, records => {
      if (records.some(record => record.journal.runId === prepared.journal.runId)) {
        throw new JournalStorageError('run-exists');
      }
      if (records.length >= JOURNAL_MAX_RUNS) throw new JournalStorageError('run-limit');
      context.request(context.store.add(prepared.bytes, prepared.journal.runId), () => {
        context.finish(prepared.journal);
      });
    });
  });
}

function read(
  run: JournalTransactionRunner,
  runId: string
): Promise<ResumabilityJournal | undefined> {
  return run('readonly', context => {
    context.request(context.store.openCursor(runId), cursor => {
      context.finish(cursor ? storedJournal(cursor.key, cursor.value).journal : undefined);
    });
  });
}

function list(run: JournalTransactionRunner): Promise<JournalSummary[]> {
  return run('readonly', context => {
    collectJournals(context, records =>
      context.finish(records.map(record => summarizeJournal(record.journal)))
    );
  });
}

function mutate(
  run: JournalTransactionRunner,
  runId: string,
  expectedRunRevision: number,
  reducer: JournalReducer
): Promise<ResumabilityJournal> {
  return run('readwrite', context => {
    context.request(context.store.openCursor(runId), cursor => {
      if (!cursor) throw new JournalStorageError('run-not-found');
      const current = storedJournal(cursor.key, cursor.value);
      if (current.journal.revision !== expectedRunRevision)
        throw new JournalStorageError('revision-conflict');
      const next = nextJournal(current, reducer);
      if (!sameBytes(current.bytes, next.bytes)) persist(context, next);
      context.finish(next.journal);
    });
  });
}

function recoverAll(run: JournalTransactionRunner): Promise<ResumabilityJournal[]> {
  return run('readwrite', context => {
    collectJournals(context, records => {
      const recovered = records.map(current =>
        nextJournal(
          current,
          journal =>
            transitionJournal(journal, {
              type: 'recover-after-restart',
              expectedRunRevision: journal.revision,
            }).journal
        )
      );
      for (let index = 0; index < recovered.length; index++) {
        if (!sameBytes(records[index].bytes, recovered[index].bytes))
          persist(context, recovered[index]);
      }
      context.finish(recovered.map(next => next.journal));
    });
  });
}

export function journalOperations(
  run: JournalTransactionRunner
): Omit<JournalStore, 'open' | 'close'> {
  return {
    create: journal => create(run, journal),
    read: runId => read(run, runId),
    list: () => list(run),
    mutate: (runId, expectedRunRevision, reducer) =>
      mutate(run, runId, expectedRunRevision, reducer),
    recoverAll: () => recoverAll(run),
  };
}
