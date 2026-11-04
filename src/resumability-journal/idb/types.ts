import type { ResumabilityJournal } from '../core';
import type { JournalSummary } from './records';

export type JournalReducer = (current: ResumabilityJournal) => ResumabilityJournal;

export interface JournalStore {
  open(): Promise<void>;
  close(): void;
  create(journal: ResumabilityJournal): Promise<ResumabilityJournal>;
  read(runId: string): Promise<ResumabilityJournal | undefined>;
  list(): Promise<JournalSummary[]>;
  mutate(
    runId: string,
    expectedRunRevision: number,
    reducer: JournalReducer
  ): Promise<ResumabilityJournal>;
  recoverAll(): Promise<ResumabilityJournal[]>;
}
