import {
  JOURNAL_ADMISSION_SOURCE,
  JOURNAL_HARD_LIMITS,
  JOURNAL_SCHEMA,
  type CreateJournalInput,
  type JournalAttempt,
  type JournalCommand,
  type JournalDispatchToken,
  type JournalItem,
  type JournalLimits,
  type JournalTransitionResult,
  type JournalUnknownReason,
  type ResumabilityJournal,
} from './contracts';
import {
  arrayData,
  compare,
  digest,
  fail,
  fields,
  guarded,
  identifier,
  increment,
  integer,
  resolveLimits,
} from './safe-data';
import {
  admissionIdentity,
  outcomeItemState,
  readAdmission,
  readJournal,
  readOutcome,
} from './snapshot';

function createItem(value: unknown, limits: JournalLimits): JournalItem {
  const entry = fields(
    value,
    ['itemId', 'provider', 'conversationId', 'conversationKey'],
    [],
    'invalid-request'
  );
  return {
    itemId: identifier(entry.itemId, limits, 'invalid-request'),
    revision: 0,
    state: 'pending',
    admission: readAdmission(
      {
        provider: entry.provider,
        conversationId: entry.conversationId,
        conversationKey: entry.conversationKey,
      },
      limits
    ),
    attempts: [],
  };
}

function admittedItems(value: unknown, limits: JournalLimits): JournalItem[] {
  const admissions = new Map<string, JournalItem>();
  const itemOwners = new Map<string, string>();
  const keyOwners = new Map<string, string>();
  for (const valueItem of arrayData(value, JOURNAL_HARD_LIMITS.maxItems, 'invalid-request')) {
    const item = createItem(valueItem, limits);
    const { itemId, admission } = item;
    const identity = admissionIdentity(admission);
    const previous = admissions.get(identity);
    if (
      (previous && previous.admission.conversationKey !== admission.conversationKey) ||
      (itemOwners.has(itemId) && itemOwners.get(itemId) !== identity) ||
      (keyOwners.has(admission.conversationKey) &&
        keyOwners.get(admission.conversationKey) !== identity)
    )
      fail('admission-conflict');
    itemOwners.set(itemId, identity);
    keyOwners.set(admission.conversationKey, identity);
    if (!previous || compare(itemId, previous.itemId) < 0) admissions.set(identity, item);
  }
  return [...admissions.values()];
}

/** Exact admission duplicates collapse deterministically; conflicting IDs/keys fail closed. */
export function createJournal(
  input: CreateJournalInput,
  options?: Partial<JournalLimits>
): ResumabilityJournal {
  return guarded('invalid-request', () => {
    const limits = resolveLimits(options);
    const data = fields(input, ['runId', 'catalogSha256', 'items'], [], 'invalid-request');
    return readJournal(
      {
        schema: JOURNAL_SCHEMA,
        runId: identifier(data.runId, limits, 'invalid-request'),
        revision: 0,
        control: 'paused',
        admissionSource: JOURNAL_ADMISSION_SOURCE,
        catalogSha256: digest(data.catalogSha256, 'invalid-request'),
        items: admittedItems(data.items, limits),
      },
      limits
    );
  });
}

function readToken(value: unknown, limits: JournalLimits): JournalDispatchToken {
  const data = fields(
    value,
    ['runId', 'runRevision', 'itemId', 'itemRevision', 'attemptId', 'attemptRevision', 'captureId'],
    [],
    'invalid-request'
  );
  return Object.freeze({
    runId: identifier(data.runId, limits, 'invalid-request'),
    runRevision: integer(data.runRevision, 'invalid-request'),
    itemId: identifier(data.itemId, limits, 'invalid-request'),
    itemRevision: integer(data.itemRevision, 'invalid-request'),
    attemptId: identifier(data.attemptId, limits, 'invalid-request'),
    attemptRevision: integer(data.attemptRevision, 'invalid-request'),
    captureId: identifier(data.captureId, limits, 'invalid-request'),
  });
}

function changed(
  journal: ResumabilityJournal,
  patch: Partial<ResumabilityJournal>,
  limits: JournalLimits
) {
  return readJournal({ ...journal, revision: increment(journal.revision), ...patch }, limits);
}

function fenceItem(item: JournalItem, reason: JournalUnknownReason, cancel: boolean): JournalItem {
  const last = item.attempts[item.attempts.length - 1];
  if (last?.state === 'running') {
    const settled: JournalAttempt = {
      ...last,
      revision: increment(last.revision),
      state: 'settled',
      outcome: { kind: 'unknown', reason },
    };
    return {
      ...item,
      revision: increment(item.revision),
      state: cancel ? 'cancelled' : 'unknown',
      attempts: [...item.attempts.slice(0, -1), settled],
    };
  }
  return cancel && item.state !== 'recorded' && item.state !== 'cancelled'
    ? { ...item, revision: increment(item.revision), state: 'cancelled' }
    : item;
}

function controlTransition(
  journal: ResumabilityJournal,
  command: Record<string, unknown>,
  limits: JournalLimits
): ResumabilityJournal {
  const data = fields(command, ['type', 'expectedRunRevision'], [], 'invalid-request');
  if (integer(data.expectedRunRevision, 'invalid-request') !== journal.revision)
    fail('revision-conflict');
  if (data.type === 'recover-after-restart' || data.type === 'pause') {
    if (data.type === 'pause' && !['active', 'paused'].includes(journal.control))
      fail('invalid-transition');
    if (journal.control === 'paused') return journal;
    const reason = data.type === 'pause' ? 'interrupted-by-pause' : 'interrupted-by-restart';
    return changed(
      journal,
      { control: 'paused', items: journal.items.map(item => fenceItem(item, reason, false)) },
      limits
    );
  }
  if (data.type === 'activate') {
    if (journal.control !== 'paused') fail('invalid-transition');
    return changed(journal, { control: 'active' }, limits);
  }
  if (data.type === 'cancel') {
    if (!['active', 'paused'].includes(journal.control)) fail('invalid-transition');
    return changed(
      journal,
      {
        control: 'cancelled',
        items: journal.items.map(item => fenceItem(item, 'interrupted-by-cancel', true)),
      },
      limits
    );
  }
  if (data.type !== 'complete') fail('invalid-request');
  if (
    !['active', 'paused'].includes(journal.control) ||
    journal.items.some(item => !['recorded', 'failed', 'cancelled'].includes(item.state))
  )
    fail('invalid-transition');
  return changed(journal, { control: 'completed' }, limits);
}

function begin(
  journal: ResumabilityJournal,
  command: Record<string, unknown>,
  limits: JournalLimits
): JournalTransitionResult {
  const data = fields(
    command,
    ['type', 'expectedRunRevision', 'itemId', 'expectedItemRevision', 'attemptId', 'captureId'],
    [],
    'invalid-request'
  );
  if (integer(data.expectedRunRevision, 'invalid-request') !== journal.revision)
    fail('revision-conflict');
  const itemId = identifier(data.itemId, limits, 'invalid-request');
  const item = journal.items.find(item => item.itemId === itemId);
  if (!item || integer(data.expectedItemRevision, 'invalid-request') !== item.revision)
    fail('revision-conflict');
  if (journal.control !== 'active' || ['recorded', 'cancelled'].includes(item.state))
    fail('invalid-transition');
  // V1 is sequential: a second begin must not knowingly invalidate a live token.
  if (journal.items.some(item => item.state === 'running')) fail('attempt-already-running');
  const attemptId = identifier(data.attemptId, limits, 'invalid-request');
  const captureId = identifier(data.captureId, limits, 'invalid-request');
  if (
    journal.items.some(item =>
      item.attempts.some(
        attempt => attempt.attemptId === attemptId || attempt.captureId === captureId
      )
    )
  )
    fail('identity-conflict');
  const attempt: JournalAttempt = { attemptId, captureId, revision: 0, state: 'running' };
  const nextItem: JournalItem = {
    ...item,
    revision: increment(item.revision),
    state: 'running',
    attempts: [...item.attempts, attempt],
  };
  const next = changed(
    journal,
    { items: journal.items.map(item => (item.itemId === itemId ? nextItem : item)) },
    limits
  );
  return Object.freeze({ journal: next, dispatchToken: dispatchToken(next, nextItem, attempt) });
}

function dispatchToken(
  journal: ResumabilityJournal,
  item: JournalItem,
  attempt: JournalAttempt
): JournalDispatchToken {
  return Object.freeze({
    runId: journal.runId,
    runRevision: journal.revision,
    itemId: item.itemId,
    itemRevision: item.revision,
    attemptId: attempt.attemptId,
    attemptRevision: attempt.revision,
    captureId: attempt.captureId,
  });
}

function settle(
  journal: ResumabilityJournal,
  command: Record<string, unknown>,
  limits: JournalLimits
): ResumabilityJournal {
  const data = fields(command, ['type', 'token', 'outcome'], [], 'invalid-request');
  const token = readToken(data.token, limits);
  const item = journal.items.find(item => item.itemId === token.itemId);
  const attempt = item?.attempts[item.attempts.length - 1];
  if (
    token.runId !== journal.runId ||
    token.runRevision !== journal.revision ||
    !item ||
    token.itemRevision !== item.revision ||
    !attempt ||
    token.attemptId !== attempt.attemptId ||
    token.attemptRevision !== attempt.revision ||
    token.captureId !== attempt.captureId ||
    attempt.state !== 'running'
  )
    fail('revision-conflict');
  if (journal.control !== 'active') fail('invalid-transition');
  const outcome = readOutcome(data.outcome, attempt.captureId, limits);
  // Interruption reasons belong to control transitions, not arbitrary observations.
  if (outcome.kind === 'unknown' && outcome.reason !== 'missing-confirmation')
    fail('invalid-request');
  const settled: JournalAttempt = {
    ...attempt,
    revision: increment(attempt.revision),
    state: 'settled',
    outcome,
  };
  const nextItem: JournalItem = {
    ...item,
    revision: increment(item.revision),
    state: outcomeItemState(outcome),
    attempts: [...item.attempts.slice(0, -1), settled],
  };
  return changed(
    journal,
    { items: journal.items.map(item => (item.itemId === token.itemId ? nextItem : item)) },
    limits
  );
}

/**
 * Synchronous plain-data snapshot before any caller await. Pure construction only:
 * the caller must atomically persist `journal` before using a returned dispatch token.
 */
export function transitionJournal(
  value: unknown,
  command: JournalCommand,
  options?: Partial<JournalLimits>
): JournalTransitionResult {
  return guarded('invalid-request', () => {
    const limits = resolveLimits(options);
    const journal = readJournal(value, limits);
    const data = fields(
      command,
      ['type'],
      [
        'expectedRunRevision',
        'itemId',
        'expectedItemRevision',
        'attemptId',
        'captureId',
        'token',
        'outcome',
      ],
      'invalid-request'
    );
    if (data.type === 'begin-attempt') return begin(journal, data, limits);
    const next =
      data.type === 'settle-attempt'
        ? settle(journal, data, limits)
        : controlTransition(journal, data, limits);
    return Object.freeze({ journal: next });
  });
}
