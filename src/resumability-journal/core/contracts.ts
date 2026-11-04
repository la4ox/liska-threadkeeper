/** Inert local bookkeeping, not account binding, dispatch authority or archive verification. */
export const JOURNAL_SCHEMA = 'liska-resumability-journal/1' as const;
export const JOURNAL_ADMISSION_SOURCE = 'explicit-catalog-selection' as const;
export const JOURNAL_HARD_LIMITS = Object.freeze({
  maxItems: 2048,
  maxAttemptsPerItem: 8,
  maxTotalAttempts: 8192,
  maxEvidenceRefs: 16,
  maxIdentifierCodeUnits: 256,
  maxOutputBytes: 8 * 1024 * 1024,
});
export type JournalLimits = { -readonly [K in keyof typeof JOURNAL_HARD_LIMITS]: number };

export const JOURNAL_CODES = [
  'invalid-request',
  'invalid-journal',
  'invalid-json',
  'duplicate-json-key',
  'unsafe-json-key',
  'invalid-limits',
  'limit-exceeded',
  'admission-conflict',
  'revision-conflict',
  'invalid-transition',
  'attempt-already-running',
  'identity-conflict',
] as const;
export type JournalCode = (typeof JOURNAL_CODES)[number];

export class ResumabilityJournalError extends Error {
  readonly code: JournalCode;

  constructor(code: JournalCode) {
    super(`Resumability journal failed (${code}).`);
    this.name = 'ResumabilityJournalError';
    this.code = code;
  }
}

export type JournalControl = 'paused' | 'active' | 'cancelled' | 'completed';
export type JournalItemState =
  | 'pending'
  | 'running'
  | 'recorded'
  | 'deferred'
  | 'failed'
  | 'unknown'
  | 'cancelled';
export interface JournalAdmission {
  readonly provider: string;
  readonly conversationId: string;
  readonly conversationKey: string;
}
export interface CreateJournalItem extends JournalAdmission {
  readonly itemId: string;
}
export interface CreateJournalInput {
  readonly runId: string;
  readonly catalogSha256: string;
  readonly items: readonly CreateJournalItem[];
}

/** A typed reference only. No reference independently proves archive integrity. */
export interface JournalEvidenceRef {
  readonly kind: 'raw' | 'manifest' | 'canonical' | 'binary' | 'receipt';
  readonly digest: string;
  readonly byteLength: number;
  readonly captureId?: string;
  readonly destination?: 'file' | 'obsidian';
}
export type JournalUnknownReason =
  | 'missing-confirmation'
  | 'interrupted-by-pause'
  | 'interrupted-by-cancel'
  | 'interrupted-by-restart';
export type JournalOutcome =
  | { readonly kind: 'confirmed'; readonly evidence: readonly JournalEvidenceRef[] }
  | {
      readonly kind: 'unknown';
      readonly reason: JournalUnknownReason;
      readonly evidence?: readonly JournalEvidenceRef[];
    }
  | { readonly kind: 'not-dispatched'; readonly reason: 'dispatch-not-started' }
  | {
      readonly kind: 'deferred';
      readonly reason: 'user-deferred' | 'rate-limited' | 'provider-unavailable';
      /** Explicit caller observation (epoch milliseconds), never read or acted on by the core. */
      readonly notBefore?: number;
    }
  | {
      readonly kind: 'failed';
      readonly reason:
        | 'invalid-capture'
        | 'capture-failed'
        | 'persistence-failed'
        | 'evidence-invalid';
    };
export type JournalAttempt =
  | {
      readonly attemptId: string;
      readonly captureId: string;
      readonly revision: number;
      readonly state: 'running';
    }
  | {
      readonly attemptId: string;
      readonly captureId: string;
      readonly revision: number;
      readonly state: 'settled';
      readonly outcome: JournalOutcome;
    };
export interface JournalItem {
  readonly itemId: string;
  readonly revision: number;
  readonly state: JournalItemState;
  readonly admission: JournalAdmission;
  readonly attempts: readonly JournalAttempt[];
}
export interface ResumabilityJournal {
  readonly schema: typeof JOURNAL_SCHEMA;
  readonly runId: string;
  readonly revision: number;
  readonly control: JournalControl;
  readonly admissionSource: typeof JOURNAL_ADMISSION_SOURCE;
  readonly catalogSha256: string;
  readonly items: readonly JournalItem[];
}
export interface JournalDispatchToken {
  readonly runId: string;
  readonly runRevision: number;
  readonly itemId: string;
  readonly itemRevision: number;
  readonly attemptId: string;
  readonly attemptRevision: number;
  readonly captureId: string;
}
export type JournalCommand =
  | {
      readonly type: 'activate' | 'pause' | 'cancel' | 'complete' | 'recover-after-restart';
      readonly expectedRunRevision: number;
    }
  | {
      readonly type: 'begin-attempt';
      readonly expectedRunRevision: number;
      readonly itemId: string;
      readonly expectedItemRevision: number;
      readonly attemptId: string;
      readonly captureId: string;
    }
  | {
      readonly type: 'settle-attempt';
      readonly token: JournalDispatchToken;
      readonly outcome: JournalOutcome;
    };
export interface JournalTransitionResult {
  readonly journal: ResumabilityJournal;
  /** Returned only after the detached next journal exists. Persistence must precede dispatch. */
  readonly dispatchToken?: JournalDispatchToken;
}
