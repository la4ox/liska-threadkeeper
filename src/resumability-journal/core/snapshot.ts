import {
  JOURNAL_ADMISSION_SOURCE,
  JOURNAL_SCHEMA,
  type JournalAdmission,
  type JournalAttempt,
  type JournalEvidenceRef,
  type JournalItem,
  type JournalItemState,
  type JournalLimits,
  type JournalOutcome,
  type ResumabilityJournal,
} from './contracts';
import {
  arrayData,
  assertOutputSize,
  compare,
  digest,
  enumValue,
  fail,
  fields,
  guarded,
  identifier,
  integer,
  resolveLimits,
} from './safe-data';
import { validateMinimumRevision } from './revision';

const controls = ['paused', 'active', 'cancelled', 'completed'] as const;
const states = [
  'pending',
  'running',
  'recorded',
  'deferred',
  'failed',
  'unknown',
  'cancelled',
] as const;

export function readAdmission(value: unknown, limits: JournalLimits): JournalAdmission {
  const data = fields(value, ['provider', 'conversationId', 'conversationKey']);
  const prefix = 'liska-conversation-key/1:';
  if (typeof data.conversationKey !== 'string' || !data.conversationKey.startsWith(prefix))
    fail('invalid-journal');
  return Object.freeze({
    provider: identifier(data.provider, limits),
    conversationId: identifier(data.conversationId, limits),
    conversationKey: prefix + digest(data.conversationKey.slice(prefix.length)),
  });
}

function evidence(value: unknown, captureId: string, limits: JournalLimits): JournalEvidenceRef {
  const data = fields(value, ['kind', 'digest', 'byteLength'], ['captureId', 'destination']);
  const ref: JournalEvidenceRef = {
    kind: enumValue(data.kind, ['raw', 'manifest', 'canonical', 'binary', 'receipt']),
    digest: digest(data.digest),
    byteLength: integer(data.byteLength),
    ...('captureId' in data && { captureId: identifier(data.captureId, limits) }),
    ...('destination' in data && {
      destination: enumValue(data.destination, ['file', 'obsidian'] as const),
    }),
  };
  if (ref.captureId !== undefined && ref.captureId !== captureId) fail('invalid-journal');
  return Object.freeze(ref);
}

function evidenceRefs(value: unknown, captureId: string, limits: JournalLimits) {
  const refs = arrayData(value, limits.maxEvidenceRefs, 'invalid-journal').map(value =>
    evidence(value, captureId, limits)
  );
  refs.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  if (
    refs.some((ref, index) => index > 0 && JSON.stringify(ref) === JSON.stringify(refs[index - 1]))
  )
    fail('invalid-journal');
  return Object.freeze(refs);
}

function unknownOutcome(data: Record<string, unknown>, captureId: string, limits: JournalLimits) {
  if (data.reason !== 'missing-confirmation' && 'evidence' in data) fail('invalid-journal');
  return Object.freeze({
    kind: 'unknown' as const,
    reason: enumValue(data.reason, [
      'missing-confirmation',
      'interrupted-by-pause',
      'interrupted-by-cancel',
      'interrupted-by-restart',
    ]),
    ...('evidence' in data && { evidence: evidenceRefs(data.evidence, captureId, limits) }),
  });
}

export function readOutcome(
  value: unknown,
  captureId: string,
  limits: JournalLimits
): JournalOutcome {
  const kind = fields(value, ['kind'], ['reason', 'evidence', 'notBefore']).kind;
  if (kind === 'confirmed') {
    const data = fields(value, ['kind', 'evidence']);
    const refs = evidenceRefs(data.evidence, captureId, limits);
    if (!refs.length) fail('invalid-journal');
    return Object.freeze({ kind, evidence: refs });
  }
  if (kind === 'unknown')
    return unknownOutcome(fields(value, ['kind', 'reason'], ['evidence']), captureId, limits);
  if (kind === 'not-dispatched') {
    const data = fields(value, ['kind', 'reason']);
    return Object.freeze({ kind, reason: enumValue(data.reason, ['dispatch-not-started']) });
  }
  if (kind === 'deferred') {
    const data = fields(value, ['kind', 'reason'], ['notBefore']);
    return Object.freeze({
      kind,
      reason: enumValue(data.reason, ['user-deferred', 'rate-limited', 'provider-unavailable']),
      ...('notBefore' in data && { notBefore: integer(data.notBefore) }),
    });
  }
  const data = fields(value, ['kind', 'reason']);
  if (kind !== 'failed') fail('invalid-journal');
  return Object.freeze({
    kind,
    reason: enumValue(data.reason, [
      'invalid-capture',
      'capture-failed',
      'persistence-failed',
      'evidence-invalid',
    ]),
  });
}

function attempt(value: unknown, limits: JournalLimits): JournalAttempt {
  const data = fields(value, ['attemptId', 'captureId', 'revision', 'state'], ['outcome']);
  const attemptId = identifier(data.attemptId, limits);
  const captureId = identifier(data.captureId, limits);
  const revision = integer(data.revision);
  if (data.state === 'running' && revision === 0 && !('outcome' in data))
    return Object.freeze({ attemptId, captureId, revision, state: 'running' });
  if (data.state !== 'settled' || revision !== 1 || !('outcome' in data)) fail('invalid-journal');
  return Object.freeze({
    attemptId,
    captureId,
    revision,
    state: 'settled',
    outcome: readOutcome(data.outcome, captureId, limits),
  });
}

export function outcomeItemState(outcome: JournalOutcome): JournalItemState {
  if (outcome.kind === 'confirmed') return 'recorded';
  if (outcome.kind === 'not-dispatched') return 'pending';
  return outcome.kind;
}

function cancellationAttempt(attempt: JournalAttempt | undefined): boolean {
  return (
    attempt?.state === 'settled' &&
    attempt.outcome.kind === 'unknown' &&
    attempt.outcome.reason === 'interrupted-by-cancel'
  );
}

function validateItem(item: JournalItem): void {
  const last = item.attempts[item.attempts.length - 1];
  const expectedState = !last
    ? 'pending'
    : last.state === 'running'
      ? 'running'
      : outcomeItemState(last.outcome);
  const baseRevision = item.attempts.reduce((sum, attempt) => sum + 1 + attempt.revision, 0);
  const cancelledRunning = cancellationAttempt(last);
  const expectedRevision = baseRevision + (item.state === 'cancelled' && !cancelledRunning ? 1 : 0);
  if (
    item.revision !== expectedRevision ||
    (item.state !== 'cancelled' && item.state !== expectedState) ||
    (item.state === 'cancelled' && ['running', 'recorded'].includes(expectedState)) ||
    (cancelledRunning && item.state !== 'cancelled') ||
    item.attempts
      .slice(0, -1)
      .some(
        attempt =>
          attempt.state === 'running' ||
          attempt.outcome.kind === 'confirmed' ||
          cancellationAttempt(attempt)
      )
  )
    fail('invalid-journal');
}

function item(value: unknown, limits: JournalLimits): JournalItem {
  const data = fields(value, ['itemId', 'revision', 'state', 'admission', 'attempts']);
  const output: JournalItem = Object.freeze({
    itemId: identifier(data.itemId, limits),
    revision: integer(data.revision),
    state: enumValue(data.state, states),
    admission: readAdmission(data.admission, limits),
    attempts: Object.freeze(
      arrayData(data.attempts, limits.maxAttemptsPerItem, 'invalid-journal').map(value =>
        attempt(value, limits)
      )
    ),
  });
  validateItem(output);
  return output;
}

export function admissionIdentity(admission: JournalAdmission): string {
  return JSON.stringify([admission.provider, admission.conversationId]);
}

export function compareItems(left: JournalItem, right: JournalItem): number {
  return compare(admissionIdentity(left.admission), admissionIdentity(right.admission));
}

function validateUnique(items: readonly JournalItem[], limits: JournalLimits): void {
  const identities = new Set<string>();
  const keys = new Set<string>();
  const itemIds = new Set<string>();
  const attemptIds = new Set<string>();
  const captureIds = new Set<string>();
  let total = 0;
  for (const item of items) {
    const identity = admissionIdentity(item.admission);
    if (
      identities.has(identity) ||
      keys.has(item.admission.conversationKey) ||
      itemIds.has(item.itemId)
    )
      fail('identity-conflict');
    identities.add(identity);
    keys.add(item.admission.conversationKey);
    itemIds.add(item.itemId);
    for (const attempt of item.attempts) {
      if (attemptIds.has(attempt.attemptId) || captureIds.has(attempt.captureId))
        fail('identity-conflict');
      attemptIds.add(attempt.attemptId);
      captureIds.add(attempt.captureId);
      total += 1;
      if (total > limits.maxTotalAttempts) fail('limit-exceeded');
    }
  }
}

function validateControl(journal: ResumabilityJournal): void {
  const running = journal.items.filter(item => item.state === 'running').length;
  if (running > 1) fail('attempt-already-running');
  if (
    (running > 0 && journal.control !== 'active') ||
    journal.items.some(item => item.revision > journal.revision) ||
    (journal.revision === 0 && journal.control !== 'paused') ||
    (journal.control === 'cancelled' &&
      journal.items.some(item => !['recorded', 'cancelled'].includes(item.state))) ||
    (journal.control === 'completed' &&
      journal.items.some(item => !['recorded', 'failed', 'cancelled'].includes(item.state)))
  )
    fail('invalid-journal');
}

/** Detached deeply frozen canonical snapshot. History arrays retain their semantic order. */
export function readJournal(value: unknown, limits: JournalLimits): ResumabilityJournal {
  const data = fields(value, [
    'schema',
    'runId',
    'revision',
    'control',
    'admissionSource',
    'catalogSha256',
    'items',
  ]);
  if (data.schema !== JOURNAL_SCHEMA || data.admissionSource !== JOURNAL_ADMISSION_SOURCE)
    fail('invalid-journal');
  const items = arrayData(data.items, limits.maxItems, 'invalid-journal').map(value =>
    item(value, limits)
  );
  if (!items.length) fail('invalid-journal');
  validateUnique(items, limits);
  items.sort(compareItems);
  const output: ResumabilityJournal = Object.freeze({
    schema: JOURNAL_SCHEMA,
    runId: identifier(data.runId, limits),
    revision: integer(data.revision),
    control: enumValue(data.control, controls),
    admissionSource: JOURNAL_ADMISSION_SOURCE,
    catalogSha256: digest(data.catalogSha256),
    items: Object.freeze(items),
  });
  validateControl(output);
  validateMinimumRevision(output);
  assertOutputSize(output, limits);
  return output;
}

export function snapshotJournal(
  value: unknown,
  options?: Partial<JournalLimits>
): ResumabilityJournal {
  return guarded('invalid-journal', () => readJournal(value, resolveLimits(options)));
}
