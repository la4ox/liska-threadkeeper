// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createJournal,
  decodeJournal,
  encodeJournal,
  JOURNAL_HARD_LIMITS,
  JOURNAL_SCHEMA,
  ResumabilityJournalError,
  snapshotJournal,
  transitionJournal,
  type CreateJournalInput,
  type JournalCode,
  type JournalCommand,
  type JournalDispatchToken,
  type JournalItem,
  type JournalOutcome,
  type ResumabilityJournal,
} from '../../src/resumability-journal/core';

const hash = 'a'.repeat(64);
const evidence = { kind: 'manifest' as const, digest: hash, byteLength: 42 };
const confirmed: JournalOutcome = { kind: 'confirmed', evidence: [evidence] };
const unknown: JournalOutcome = { kind: 'unknown', reason: 'missing-confirmation' };
const failed: JournalOutcome = { kind: 'failed', reason: 'capture-failed' };
const input: CreateJournalInput = {
  runId: 'run-1',
  catalogSha256: hash,
  items: [
    {
      itemId: 'item-1',
      provider: 'chatgpt',
      conversationId: 'conversation-1',
      conversationKey: `liska-conversation-key/1:${hash}`,
    },
  ],
};

function code(action: () => unknown, expected: JournalCode) {
  try {
    action();
    expect.fail('Expected fixed journal error');
  } catch (error) {
    expect(error).toBeInstanceOf(ResumabilityJournalError);
    expect((error as ResumabilityJournalError).code).toBe(expected);
    expect((error as Error).message).toBe(`Resumability journal failed (${expected}).`);
  }
}

function control(
  journal: ResumabilityJournal,
  type: 'activate' | 'pause' | 'cancel' | 'complete' | 'recover-after-restart'
) {
  return transitionJournal(journal, { type, expectedRunRevision: journal.revision }).journal;
}

function running(
  journal = control(createJournal(input), 'activate'),
  suffix = '1',
  itemId = 'item-1'
) {
  return transitionJournal(journal, {
    type: 'begin-attempt',
    expectedRunRevision: journal.revision,
    itemId,
    expectedItemRevision: journal.items.find(item => item.itemId === itemId)!.revision,
    attemptId: `attempt-${suffix}`,
    captureId: `capture-${suffix}`,
  }) as { journal: ResumabilityJournal; dispatchToken: JournalDispatchToken };
}

function settle(current: ReturnType<typeof running>, outcome: JournalOutcome = confirmed) {
  return transitionJournal(current.journal, {
    type: 'settle-attempt',
    token: current.dispatchToken,
    outcome,
  }).journal;
}

function decodeText(text: string) {
  return decodeJournal(new TextEncoder().encode(text));
}
function text(value: unknown) {
  return new TextDecoder().decode(encodeJournal(value));
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('inert resumability journal core', () => {
  it('creates only paused detached frozen plain data without runtime authorities', () => {
    const mutable = clone(input);
    const journal = createJournal(mutable);
    (mutable.items[0] as { provider: string }).provider = 'changed';
    expect(journal).toEqual({
      schema: JOURNAL_SCHEMA,
      runId: 'run-1',
      revision: 0,
      control: 'paused',
      admissionSource: 'explicit-catalog-selection',
      catalogSha256: hash,
      items: [
        {
          itemId: 'item-1',
          revision: 0,
          state: 'pending',
          admission: input.items[0] && {
            provider: 'chatgpt',
            conversationId: 'conversation-1',
            conversationKey: `liska-conversation-key/1:${hash}`,
          },
          attempts: [],
        },
      ],
    });
    for (const value of [
      journal,
      journal.items,
      journal.items[0],
      journal.items[0].admission,
      journal.items[0].attempts,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(text(journal)).not.toMatch(
      /accountBinding|title|https|path|cursor|timestamp|schedule|endpoint/
    );
    code(() => running(journal), 'invalid-transition');
  });

  it('advances exact run/item/attempt revisions and returns the token only with a valid next journal', () => {
    const paused = createJournal(input);
    const active = control(paused, 'activate');
    expect(active.revision).toBe(1);
    expect(active.items[0].revision).toBe(0);
    const result = running(active);
    expect(result.journal.revision).toBe(2);
    expect(result.journal.items[0]).toMatchObject({
      revision: 1,
      state: 'running',
      attempts: [{ revision: 0, state: 'running' }],
    });
    expect(result.dispatchToken).toEqual({
      runId: 'run-1',
      runRevision: 2,
      itemId: 'item-1',
      itemRevision: 1,
      attemptId: 'attempt-1',
      attemptRevision: 0,
      captureId: 'capture-1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.dispatchToken)).toBe(true);
    const recorded = settle(result);
    expect(recorded).toMatchObject({
      revision: 3,
      control: 'active',
      items: [
        {
          revision: 2,
          state: 'recorded',
          attempts: [{ revision: 1, state: 'settled', outcome: confirmed }],
        },
      ],
    });
    expect(control(recorded, 'complete')).toMatchObject({ revision: 4, control: 'completed' });
    expect(
      transitionJournal(recorded, { type: 'pause', expectedRunRevision: 3 })
    ).not.toHaveProperty('dispatchToken');
    expect(paused.items[0].attempts).toHaveLength(0);
  });

  it.each([
    'runId',
    'runRevision',
    'itemId',
    'itemRevision',
    'attemptId',
    'attemptRevision',
    'captureId',
  ] as const)('fences exact token field %s', field => {
    const result = running();
    const token = {
      ...result.dispatchToken,
      [field]: typeof result.dispatchToken[field] === 'number' ? 99 : 'foreign',
    };
    code(
      () =>
        transitionJournal(result.journal, {
          type: 'settle-attempt',
          token,
          outcome: confirmed,
        } as JournalCommand),
      'revision-conflict'
    );
    expect(result.journal.items[0].state).toBe('running');
  });

  it('rejects stale run/item revisions before beginning and exact stale control revisions', () => {
    const active = control(createJournal(input), 'activate');
    const base = {
      type: 'begin-attempt' as const,
      expectedRunRevision: 1,
      itemId: 'item-1',
      expectedItemRevision: 0,
      attemptId: 'a',
      captureId: 'c',
    };
    code(() => transitionJournal(active, { ...base, expectedRunRevision: 0 }), 'revision-conflict');
    code(
      () => transitionJournal(active, { ...base, expectedItemRevision: 1 }),
      'revision-conflict'
    );
    code(() => transitionJournal(active, { ...base, itemId: 'missing' }), 'revision-conflict');
    code(
      () => transitionJournal(active, { type: 'pause', expectedRunRevision: 0 }),
      'revision-conflict'
    );
    code(
      () => transitionJournal(active, { type: 'activate', expectedRunRevision: 1 }),
      'invalid-transition'
    );
  });

  it('does not let a settled callback settle a newer explicit attempt', () => {
    const first = running();
    const journal = settle(first, unknown);
    code(
      () =>
        transitionJournal(journal, {
          type: 'settle-attempt',
          token: first.dispatchToken,
          outcome: confirmed,
        }),
      'revision-conflict'
    );
    const second = running(journal, '2');
    code(
      () =>
        transitionJournal(second.journal, {
          type: 'settle-attempt',
          token: first.dispatchToken,
          outcome: confirmed,
        }),
      'revision-conflict'
    );
    expect(second.journal.items[0].attempts).toHaveLength(2);
    expect(second.journal.items[0].attempts[0]).toEqual(journal.items[0].attempts[0]);
    expect(
      settle(second).items[0].attempts.map(
        attempt => attempt.state === 'settled' && attempt.outcome.kind
      )
    ).toEqual(['unknown', 'confirmed']);
  });

  it.each(['pause', 'cancel', 'recover-after-restart'] as const)(
    'fences unfinished callbacks on %s without dispatch/retry',
    type => {
      const result = running();
      const journal = control(result.journal, type);
      const reason = {
        pause: 'interrupted-by-pause',
        cancel: 'interrupted-by-cancel',
        'recover-after-restart': 'interrupted-by-restart',
      }[type];
      expect(journal).toMatchObject({
        revision: 3,
        control: type === 'cancel' ? 'cancelled' : 'paused',
        items: [
          {
            revision: 2,
            state: type === 'cancel' ? 'cancelled' : 'unknown',
            attempts: [{ revision: 1, state: 'settled', outcome: { kind: 'unknown', reason } }],
          },
        ],
      });
      code(
        () =>
          transitionJournal(journal, {
            type: 'settle-attempt',
            token: result.dispatchToken,
            outcome: confirmed,
          }),
        'revision-conflict'
      );
      const reopened = control(journal, 'recover-after-restart');
      const active = control(reopened, 'activate');
      // Updating only the run revision cannot resurrect the changed item/attempt token.
      code(
        () =>
          transitionJournal(active, {
            type: 'settle-attempt',
            token: { ...result.dispatchToken, runRevision: active.revision },
            outcome: confirmed,
          }),
        'revision-conflict'
      );
      expect(active.items[0].attempts).toHaveLength(1);
      expect(reopened.control).toBe('paused');
      if (type === 'cancel') code(() => running(active, '2'), 'invalid-transition');
      else expect(running(active, '2').journal.items[0].attempts).toHaveLength(2);
    }
  );

  it('preserves settled evidence on pause/cancel/restart and makes paused recovery idempotent', () => {
    const journal = settle(running(), {
      kind: 'unknown',
      reason: 'missing-confirmation',
      evidence: [evidence],
    });
    const paused = control(journal, 'pause');
    expect(paused.items).toEqual(journal.items);
    const recovered = control(paused, 'recover-after-restart');
    expect(recovered.revision).toBe(paused.revision);
    expect(text(recovered)).toBe(text(paused));
    expect(control(paused, 'pause')).toEqual(paused);
    const cancelled = control(paused, 'cancel');
    expect(cancelled.items[0]).toMatchObject({ revision: 3, state: 'cancelled' });
    expect(cancelled.items[0].attempts).toEqual(journal.items[0].attempts);
    code(() => control(cancelled, 'activate'), 'invalid-transition');
    code(() => control(cancelled, 'cancel'), 'invalid-transition');
    code(() => control(cancelled, 'pause'), 'invalid-transition');
    expect(control(cancelled, 'recover-after-restart')).toMatchObject({
      control: 'paused',
      revision: cancelled.revision + 1,
    });
  });

  it('preserves confirmed items on cancellation and refuses retry of recorded items', () => {
    const recorded = settle(running());
    const cancelled = control(recorded, 'cancel');
    expect(cancelled.items[0]).toEqual(recorded.items[0]);
    const reopened = control(control(cancelled, 'recover-after-restart'), 'activate');
    code(() => running(reopened, '2'), 'invalid-transition');
    const completed = control(recorded, 'complete');
    code(() => control(completed, 'activate'), 'invalid-transition');
    expect(control(completed, 'recover-after-restart').control).toBe('paused');
  });

  it('supports pending cancellation and only explicitly completes terminal items', () => {
    const pending = createJournal(input);
    code(() => control(pending, 'complete'), 'invalid-transition');
    expect(control(pending, 'cancel').items[0]).toMatchObject({
      revision: 1,
      state: 'cancelled',
      attempts: [],
    });
    expect(control(settle(running(), failed), 'complete').control).toBe('completed');
    code(() => control(settle(running(), unknown), 'complete'), 'invalid-transition');
    code(() => control(running().journal, 'complete'), 'invalid-transition');
  });

  it('enforces the sequential run invariant before a second begin can invalidate the live token', () => {
    const two = createJournal({
      ...input,
      items: [
        ...input.items,
        {
          ...input.items[0],
          itemId: 'item-2',
          conversationId: 'conversation-2',
          conversationKey: `liska-conversation-key/1:${'b'.repeat(64)}`,
        },
      ],
    });
    const first = running(control(two, 'activate'));
    code(() => running(first.journal, '2', 'item-2'), 'attempt-already-running');
    expect(settle(first).items.find(item => item.itemId === 'item-1')!.state).toBe('recorded');
    const forged = clone(first.journal);
    const other = running(
      control(
        createJournal({
          ...input,
          items: [two.items[1] && { ...two.items[1].admission, itemId: 'item-2' }],
        }),
        'activate'
      ),
      '2',
      'item-2'
    ).journal.items[0];
    (forged.items as JournalItem[])[1] = other;
    code(() => snapshotJournal(forged), 'attempt-already-running');
  });

  it.each([
    [{ kind: 'confirmed', evidence: [evidence] }, 'recorded'],
    [{ kind: 'unknown', reason: 'missing-confirmation', evidence: [evidence] }, 'unknown'],
    [{ kind: 'unknown', reason: 'missing-confirmation' }, 'unknown'],
    [{ kind: 'not-dispatched', reason: 'dispatch-not-started' }, 'pending'],
    [{ kind: 'deferred', reason: 'rate-limited', notBefore: 1234 }, 'deferred'],
    [{ kind: 'deferred', reason: 'user-deferred' }, 'deferred'],
    [{ kind: 'deferred', reason: 'provider-unavailable' }, 'deferred'],
    [{ kind: 'failed', reason: 'invalid-capture' }, 'failed'],
    [failed, 'failed'],
    [{ kind: 'failed', reason: 'persistence-failed' }, 'failed'],
    [{ kind: 'failed', reason: 'evidence-invalid' }, 'failed'],
  ] as const)('accepts strict outcome %j and derives item state %s', (outcome, state) => {
    const journal = settle(running(), outcome);
    expect(journal.items[0].state).toBe(state);
    expect(journal.items[0].attempts[0]).toMatchObject({ outcome });
    expect(decodeJournal(encodeJournal(journal))).toEqual(journal);
  });

  it('never schedules or auto-retries deferred, failed, not-dispatched or unknown attempts', () => {
    for (const outcome of [
      unknown,
      failed,
      { kind: 'not-dispatched', reason: 'dispatch-not-started' },
      { kind: 'deferred', reason: 'rate-limited', notBefore: Number.MAX_SAFE_INTEGER },
    ] as JournalOutcome[]) {
      const settled = settle(running(), outcome);
      const recovered = control(settled, 'recover-after-restart');
      expect(recovered.control).toBe('paused');
      expect(recovered.items[0].attempts).toHaveLength(1);
      expect(recovered.items[0].attempts[0]).toEqual(settled.items[0].attempts[0]);
      expect(running(control(recovered, 'activate'), '2').journal.items[0].attempts).toHaveLength(
        2
      );
    }
  });

  it.each([
    { kind: 'confirmed' },
    { kind: 'confirmed', evidence: [] },
    { kind: 'confirmed', evidence: [evidence], reason: 'capture-failed' },
    { kind: 'unknown', reason: 'native private error' },
    { kind: 'unknown', reason: 'missing-confirmation', notBefore: 1 },
    { kind: 'not-dispatched', reason: 'dispatch-not-started', evidence: [] },
    { kind: 'not-dispatched', reason: 'commit-not-authorized' },
    { kind: 'deferred', reason: 'rate-limited', evidence: [] },
    { kind: 'deferred', reason: 'rate-limited', notBefore: -1 },
    { kind: 'deferred', reason: 'rate-limited', notBefore: '2026-01-01' },
    { kind: 'failed', reason: 'capture-failed', evidence: [] },
    { kind: 'failed', reason: 'capture-failed', error: 'native private error' },
    { kind: 'invented', reason: 'capture-failed' },
  ])('rejects outcome/evidence matrix violation %j', outcome => {
    const result = running();
    code(
      () =>
        transitionJournal(result.journal, {
          type: 'settle-attempt',
          token: result.dispatchToken,
          outcome,
        } as JournalCommand),
      'invalid-journal'
    );
  });

  it.each(['interrupted-by-pause', 'interrupted-by-cancel', 'interrupted-by-restart'] as const)(
    'reserves %s for pure interruption transitions',
    reason => {
      const result = running();
      code(
        () =>
          transitionJournal(result.journal, {
            type: 'settle-attempt',
            token: result.dispatchToken,
            outcome: { kind: 'unknown', reason },
          }),
        'invalid-request'
      );
    }
  );

  it.each([
    { ...evidence, kind: 'verified-archive' },
    { ...evidence, digest: hash.toUpperCase() },
    { ...evidence, byteLength: -1 },
    { ...evidence, byteLength: 1.5 },
    { ...evidence, byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { ...evidence, captureId: 'different-capture' },
    { ...evidence, destination: 'network' },
    { ...evidence, path: 'private' },
    { ...evidence, url: 'https://private' },
    { ...evidence, byteLength: -0 },
  ])('rejects malformed evidence %j', ref => {
    const result = running();
    code(
      () =>
        transitionJournal(result.journal, {
          type: 'settle-attempt',
          token: result.dispatchToken,
          outcome: { kind: 'confirmed', evidence: [ref] },
        } as JournalCommand),
      'invalid-journal'
    );
  });

  it('accepts all typed kinds/destinations, exact capture references and safe integer byte boundaries', () => {
    const refs = ['raw', 'manifest', 'canonical', 'binary', 'receipt'].map((kind, index) => ({
      kind,
      digest: hash,
      byteLength: index ? Number.MAX_SAFE_INTEGER : 0,
      captureId: 'capture-1',
      destination: index % 2 ? 'file' : 'obsidian',
    }));
    const result = running();
    const journal = settle(result, { kind: 'confirmed', evidence: refs } as JournalOutcome);
    expect(snapshotJournal(journal)).toEqual(journal);
    expect(
      Object.isFrozen(
        (journal.items[0].attempts[0] as { outcome: { evidence: unknown[] } }).outcome.evidence
      )
    ).toBe(true);
    code(
      () => settle(running(), { kind: 'confirmed', evidence: [evidence, evidence] }),
      'invalid-journal'
    );
  });

  it('deduplicates exact admissions deterministically and rejects identity/key/ID conflicts', () => {
    const duplicate = { ...input.items[0], itemId: 'item-0' };
    const first = createJournal({ ...input, items: [input.items[0], duplicate] });
    expect(first.items).toHaveLength(1);
    expect(first.items[0].itemId).toBe('item-0');
    expect(text(first)).toBe(text(createJournal({ ...input, items: [duplicate, input.items[0]] })));
    expect(
      createJournal({ ...input, items: [input.items[0], duplicate] }, { maxItems: 1 }).items
    ).toHaveLength(1);
    for (const conflict of [
      { ...duplicate, conversationKey: `liska-conversation-key/1:${'b'.repeat(64)}` },
      { ...duplicate, conversationId: 'different' },
      { ...duplicate, provider: 'claude' },
      {
        ...duplicate,
        itemId: 'item-1',
        conversationId: 'different',
        conversationKey: `liska-conversation-key/1:${'b'.repeat(64)}`,
      },
    ])
      code(
        () => createJournal({ ...input, items: [input.items[0], conflict] }),
        'admission-conflict'
      );
  });

  it('allows caller-supplied IDs only once per run, preserving distinct append-only attempts', () => {
    const first = settle(running(), unknown);
    for (const [attemptId, captureId] of [
      ['attempt-1', 'capture-2'],
      ['attempt-2', 'capture-1'],
    ])
      code(
        () =>
          transitionJournal(first, {
            type: 'begin-attempt',
            expectedRunRevision: first.revision,
            itemId: 'item-1',
            expectedItemRevision: first.items[0].revision,
            attemptId,
            captureId,
          }),
        'identity-conflict'
      );
    const second = running(first, '2');
    expect(second.journal.items[0].attempts[0]).toEqual(first.items[0].attempts[0]);
  });
});

describe('journal strict data and deterministic encoding', () => {
  it('canonicalizes field/item/evidence permutations but preserves ordered attempt histories', () => {
    const second = {
      ...input.items[0],
      itemId: 'item-2',
      provider: 'claude',
      conversationKey: `liska-conversation-key/1:${'b'.repeat(64)}`,
    };
    const a = createJournal({ ...input, items: [...input.items, second] });
    const b = createJournal({
      items: [second, ...input.items],
      catalogSha256: hash,
      runId: 'run-1',
    });
    expect(text(a)).toBe(text(b));
    const reverseFields = (value: object) => Object.fromEntries(Object.entries(value).reverse());
    expect(text(reverseFields(a))).toBe(text(a));
    expect(decodeText(JSON.stringify(reverseFields(a), null, 2))).toEqual(a);
    const refs = [evidence, { ...evidence, kind: 'raw' as const }];
    expect(text(settle(running(), { kind: 'confirmed', evidence: refs }))).toBe(
      text(settle(running(), { kind: 'confirmed', evidence: [...refs].reverse() }))
    );
    expect(text(a).endsWith('\n')).toBe(true);
    expect(decodeJournal(encodeJournal(a))).toEqual(a);
  });

  it('rejects getters, hooks, symbols, nonenumerable fields, sparse/exotic arrays and inherited data without invoking hooks', () => {
    const journal = createJournal(input);
    const hook = vi.fn(() => {
      throw new Error('private');
    });
    const getter = Object.defineProperty({ ...journal }, 'revision', {
      enumerable: true,
      get: hook,
    });
    const arrayGetter = [journal.items[0]];
    Object.defineProperty(arrayGetter, '0', { enumerable: true, get: hook });
    const hidden = Object.defineProperty({ ...journal }, 'revision', {
      enumerable: false,
      value: 0,
    });
    const exotic = Object.setPrototypeOf([journal.items[0]], null);
    const sparse = new Array(1);
    for (const value of [
      getter,
      hidden,
      { ...journal, toJSON: hook },
      { ...journal, [Symbol('x')]: 1 },
      { ...journal, items: arrayGetter },
      { ...journal, items: sparse },
      { ...journal, items: exotic },
      Object.create(journal),
      new Date(),
      { ...journal, items: Object.assign([journal.items[0]], { extra: true }) },
    ])
      code(() => encodeJournal(value), 'invalid-journal');
    expect(hook).not.toHaveBeenCalled();
    const command = Object.defineProperty({}, 'type', { enumerable: true, get: hook });
    code(() => transitionJournal(journal, command as JournalCommand), 'invalid-request');
    code(
      () =>
        createJournal({
          ...input,
          items: Object.defineProperty([...input.items], '0', { enumerable: true, get: hook }),
        }),
      'invalid-request'
    );
    expect(hook).not.toHaveBeenCalled();
  });

  it('rejects exotic nested outcomes/evidence and never serializes encoder forgeries', () => {
    const current = running();
    const hook = vi.fn(() => 'private');
    const withOutcome = clone(settle(current));
    const attempt = withOutcome.items[0].attempts[0] as unknown as { outcome: unknown };
    attempt.outcome = Object.defineProperty({}, 'kind', { enumerable: true, get: hook });
    code(() => encodeJournal(withOutcome), 'invalid-journal');
    const forged = { ...createJournal(input), schema: 'liska-resumability-journal/2' };
    code(() => encodeJournal(forged), 'invalid-journal');
    code(
      () => encodeJournal({ ...createJournal(input), admissionSource: 'account-enumeration' }),
      'invalid-journal'
    );
    expect(hook).not.toHaveBeenCalled();
  });

  it('sanitizes thrown proxy traps and forged errors while documenting transparent proxies', () => {
    const privateError = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw { code: 'limit-exceeded', message: 'private' };
        },
      }
    );
    code(() => snapshotJournal(privateError), 'invalid-journal');
    const journal = createJournal(input);
    expect(snapshotJournal(new Proxy(journal, {}))).toEqual(journal);
    expect(createJournal(Object.assign(Object.create(null), input))).toEqual(journal);
    code(
      () =>
        transitionJournal(
          journal,
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('private');
              },
            }
          ) as JournalCommand
        ),
      'invalid-request'
    );
  });

  it.each([
    ['{"schema":1,"schema":2}', 'duplicate-json-key'],
    ['{"schema":1,"\\u0073chema":2}', 'duplicate-json-key'],
    ['{"__proto__":{}}', 'unsafe-json-key'],
    ['{"constructor":{}}', 'unsafe-json-key'],
    ['{"prototype":{}}', 'unsafe-json-key'],
    ['{"revision":01}', 'invalid-json'],
    ['{"revision":1e999}', 'invalid-json'],
    ['{"schema":"\\x00"}', 'invalid-json'],
    ['{"schema":"\u0001"}', 'invalid-json'],
    ['{"schema":"unterminated}', 'invalid-json'],
    ['[] trailing', 'invalid-json'],
    ['[1,]', 'invalid-json'],
    ['{"x":1,}', 'invalid-json'],
    ['true', 'invalid-journal'],
    ['{"x" 1}', 'invalid-json'],
    ['{"x":}', 'invalid-json'],
    ['[tru]', 'invalid-json'],
  ] as const)('strictly rejects JSON %s', (source, expected) =>
    code(() => decodeText(source), expected)
  );

  it('rejects malformed UTF-8, BOM, shared/resizable/forged/decorated byte views and byte ceilings', () => {
    code(() => decodeJournal(new Uint8Array([0xff])), 'invalid-json');
    code(() => decodeJournal(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 'invalid-json');
    code(() => decodeJournal({ byteLength: 1 } as Uint8Array), 'invalid-request');
    code(
      () => decodeJournal(Object.assign(encodeJournal(createJournal(input)), { extra: 1 })),
      'invalid-request'
    );
    code(
      () => decodeJournal(new Proxy(encodeJournal(createJournal(input)), {})),
      'invalid-request'
    );
    code(() => decodeJournal(new Uint8Array(new SharedArrayBuffer(2))), 'invalid-json');
    code(
      () => decodeJournal(encodeJournal(createJournal(input)), { maxOutputBytes: 1 }),
      'limit-exceeded'
    );
    code(() => decodeText('['.repeat(14) + '0' + ']'.repeat(14)), 'limit-exceeded');
  });

  it('rejects unsafe numeric values and impossible state/revision/history combinations', () => {
    const journal = createJournal(input);
    for (const revision of [-1, -0, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
      code(() => snapshotJournal({ ...journal, revision }), 'invalid-journal');
    for (const patch of [
      { control: 'active' },
      { control: 'invented' },
      { revision: 1, control: 'completed' },
      { revision: 1, control: 'cancelled' },
      { items: [] },
    ])
      code(() => snapshotJournal({ ...journal, ...patch }), 'invalid-journal');
    const current = running();
    const first = current.journal.items[0];
    for (const attempt of [
      { ...first.attempts[0], revision: 1 },
      { ...first.attempts[0], outcome: unknown },
      { ...first.attempts[0], state: 'settled' },
    ])
      code(
        () => snapshotJournal({ ...current.journal, items: [{ ...first, attempts: [attempt] }] }),
        'invalid-journal'
      );
    code(() => snapshotJournal({ ...current.journal, control: 'paused' }), 'invalid-journal');
    code(
      () => snapshotJournal({ ...current.journal, items: [{ ...first, revision: 0 }] }),
      'invalid-journal'
    );
    const recorded = settle(current);
    const recordItem = recorded.items[0];
    code(
      () =>
        snapshotJournal({
          ...recorded,
          revision: 4,
          items: [
            {
              ...recordItem,
              revision: 3,
              state: 'running',
              attempts: [
                ...recordItem.attempts,
                { attemptId: 'a2', captureId: 'c2', revision: 0, state: 'running' },
              ],
            },
          ],
        }),
      'invalid-journal'
    );
    code(
      () =>
        transitionJournal(
          { ...journal, revision: Number.MAX_SAFE_INTEGER },
          { type: 'activate', expectedRunRevision: Number.MAX_SAFE_INTEGER }
        ),
      'limit-exceeded'
    );
  });

  it('rejects persisted duplicate identities/items/attempts/capture reservations rather than merging history', () => {
    const journal = createJournal(input);
    code(
      () => snapshotJournal({ ...journal, items: [...journal.items, ...journal.items] }),
      'identity-conflict'
    );
    const once = settle(running(), unknown);
    const current = running(once, '2');
    const item = current.journal.items[0];
    for (const collision of [{ attemptId: 'attempt-1' }, { captureId: 'capture-1' }])
      code(
        () =>
          snapshotJournal({
            ...current.journal,
            items: [
              { ...item, attempts: [item.attempts[0], { ...item.attempts[1], ...collision }] },
            ],
          }),
        'identity-conflict'
      );
  });

  it('rejects impossible persisted cancellation histories and run revision undercounts', () => {
    const recorded = settle(running());
    code(
      () =>
        snapshotJournal({
          ...recorded,
          revision: 4,
          items: [{ ...recorded.items[0], state: 'cancelled', revision: 3 }],
        }),
      'invalid-journal'
    );
    const cancelled = control(running().journal, 'cancel');
    code(
      () =>
        snapshotJournal({
          ...cancelled,
          control: 'paused',
          items: [{ ...cancelled.items[0], state: 'unknown' }],
        }),
      'invalid-journal'
    );
    const last = cancelled.items[0].attempts[0];
    code(
      () =>
        snapshotJournal({
          ...cancelled,
          items: [
            {
              ...cancelled.items[0],
              attempts: [
                {
                  ...last,
                  outcome: {
                    kind: 'unknown',
                    reason: 'interrupted-by-cancel',
                    evidence: [evidence],
                  },
                },
              ],
            },
          ],
        }),
      'invalid-journal'
    );
    const continued = {
      ...cancelled.items[0],
      state: 'failed',
      revision: 4,
      attempts: [
        last,
        { attemptId: 'a2', captureId: 'c2', revision: 1, state: 'settled', outcome: failed },
      ],
    };
    code(
      () => snapshotJournal({ ...cancelled, revision: 5, control: 'active', items: [continued] }),
      'invalid-journal'
    );
    code(() => snapshotJournal({ ...recorded, revision: 2 }), 'invalid-journal');
  });
});

describe('minimum run revisions include control history', () => {
  const interrupted = (type: 'pause' | 'cancel' | 'recover-after-restart') =>
    control(running().journal, type);
  const normal = () => settle(running(), unknown);
  const continued = () => running(control(interrupted('pause'), 'activate'), '2');
  const cancelled = () => control(normal(), 'cancel');
  const cancelledPending = () => control(createJournal(input), 'cancel');
  const cases: readonly [string, () => ResumabilityJournal, number][] = [
    ['completed after ordinary settlement', () => control(settle(running()), 'complete'), 4],
    ['paused after ordinary settlement', () => control(normal(), 'pause'), 4],
    ['active after paused interruption', () => control(interrupted('pause'), 'activate'), 4],
    [
      'active after restart interruption',
      () => control(interrupted('recover-after-restart'), 'activate'),
      4,
    ],
    ['cancelled after ordinary settlement', cancelled, 4],
    ['paused after ordinary cancellation', () => control(cancelled(), 'recover-after-restart'), 5],
    [
      'active after ordinary cancellation',
      () => control(control(cancelled(), 'recover-after-restart'), 'activate'),
      6,
    ],
    [
      'completed after ordinary cancellation',
      () => control(control(cancelled(), 'recover-after-restart'), 'complete'),
      6,
    ],
    ['paused interruption', () => interrupted('pause'), 3],
    ['restart interruption', () => interrupted('recover-after-restart'), 3],
    ['cancelled interruption', () => interrupted('cancel'), 3],
    [
      'paused after interrupted cancellation',
      () => control(interrupted('cancel'), 'recover-after-restart'),
      4,
    ],
    [
      'active after interrupted cancellation',
      () => control(control(interrupted('cancel'), 'recover-after-restart'), 'activate'),
      5,
    ],
    [
      'completed after interrupted cancellation',
      () => control(control(interrupted('cancel'), 'recover-after-restart'), 'complete'),
      5,
    ],
    ['running continuation after interruption', () => continued().journal, 5],
    ['settled active continuation after interruption', () => settle(continued(), failed), 6],
    [
      'paused ordinary continuation after interruption',
      () => control(settle(continued(), failed), 'pause'),
      7,
    ],
    [
      'completed continuation after interruption',
      () => control(settle(continued()), 'complete'),
      7,
    ],
    [
      'second interruption after reactivation',
      () => control(continued().journal, 'recover-after-restart'),
      6,
    ],
    ['cancelled continuation after interruption', () => control(continued().journal, 'cancel'), 6],
    ['pending cancellation', cancelledPending, 1],
    [
      'paused after pending cancellation',
      () => control(cancelledPending(), 'recover-after-restart'),
      2,
    ],
    [
      'active after pending cancellation',
      () => control(control(cancelledPending(), 'recover-after-restart'), 'activate'),
      3,
    ],
    [
      'completed after pending cancellation',
      () => control(control(cancelledPending(), 'recover-after-restart'), 'complete'),
      3,
    ],
  ];

  it.each(cases)(
    'accepts the exact minimum for %s through all codec boundaries',
    (_name, make, minimum) => {
      const journal = make();
      expect(journal.revision).toBe(minimum);
      expect(snapshotJournal(journal)).toEqual(journal);
      expect(decodeJournal(encodeJournal(journal))).toEqual(journal);
      if (journal.control === 'paused')
        expect(control(journal, 'recover-after-restart')).toEqual(journal);
    }
  );

  it.each(cases)(
    'rejects undercounted %s through snapshot, encode and decode',
    (_name, make, minimum) => {
      const forged = { ...make(), revision: minimum - 1 };
      code(() => snapshotJournal(forged), 'invalid-journal');
      code(() => encodeJournal(forged), 'invalid-journal');
      code(() => decodeText(JSON.stringify(forged)), 'invalid-journal');
    }
  );

  it('does not invent cross-item ordering when a last-in-item interruption can be globally last', () => {
    const two = createJournal({
      ...input,
      items: [
        ...input.items,
        {
          ...input.items[0],
          itemId: 'item-2',
          conversationId: 'conversation-2',
          conversationKey: `liska-conversation-key/1:${'b'.repeat(64)}`,
        },
      ],
    });
    const recorded = settle(running(control(two, 'activate'), '2', 'item-2'));
    const paused = control(running(recorded).journal, 'pause');
    expect(paused.revision).toBe(5);
    expect(snapshotJournal(paused)).toEqual(paused);
    const cancellation = control(paused, 'cancel');
    expect(cancellation.revision).toBe(6);
    expect(decodeJournal(encodeJournal(cancellation))).toEqual(cancellation);
    code(() => snapshotJournal({ ...paused, revision: 4 }), 'invalid-journal');
    code(() => snapshotJournal({ ...cancellation, revision: 5 }), 'invalid-journal');
  });

  it('rejects histories that resume eligible work or interrupt twice after global cancellation', () => {
    const first = interrupted('cancel');
    const another = {
      ...first.items[0],
      itemId: 'item-2',
      admission: {
        ...first.items[0].admission,
        conversationId: 'conversation-2',
        conversationKey: `liska-conversation-key/1:${'b'.repeat(64)}`,
      },
      attempts: first.items[0].attempts.map(attempt => ({
        ...attempt,
        attemptId: 'attempt-2',
        captureId: 'capture-2',
      })),
    };
    const duplicateCancellation = { ...first, revision: 20, items: [...first.items, another] };
    code(() => snapshotJournal(duplicateCancellation), 'invalid-journal');
    const stillPending = { ...another, revision: 0, state: 'pending', attempts: [] };
    const mixed = {
      ...first,
      revision: 20,
      control: 'paused',
      items: [...first.items, stillPending],
    };
    code(() => snapshotJournal(mixed), 'invalid-journal');
    code(() => encodeJournal(mixed), 'invalid-journal');
    code(() => decodeText(JSON.stringify(mixed)), 'invalid-journal');
  });
});

describe('journal independent lowering-only ceilings', () => {
  it.each(Object.entries(JOURNAL_HARD_LIMITS))(
    'rejects raised, fractional, negative and exotic %s limits',
    (name, hard) => {
      for (const value of [hard + 1, -1, 0.5, NaN, Infinity])
        code(() => createJournal(input, { [name]: value }), 'invalid-limits');
      code(() => snapshotJournal(createJournal(input), { [name]: hard + 1 }), 'invalid-limits');
    }
  );

  it('checks lowered identifiers/items/output and exact byte ceiling', () => {
    const journal = createJournal(input);
    const encoded = encodeJournal(journal);
    expect(encodeJournal(journal, { maxOutputBytes: encoded.length })).toEqual(encoded);
    code(() => encodeJournal(journal, { maxOutputBytes: encoded.length - 1 }), 'limit-exceeded');
    code(() => createJournal(input, { maxOutputBytes: encoded.length - 1 }), 'limit-exceeded');
    code(() => createJournal(input, { maxItems: 0 }), 'limit-exceeded');
    code(() => createJournal(input, { maxIdentifierCodeUnits: 3 }), 'limit-exceeded');
    expect(createJournal({ ...input, runId: 'a'.repeat(256) }).runId).toHaveLength(256);
    code(() => createJournal({ ...input, runId: 'a'.repeat(257) }), 'limit-exceeded');
    for (const runId of ['', 'https://private', 'with space', 'русский', '_private'])
      code(() => createJournal({ ...input, runId }), 'invalid-request');
    code(() => createJournal({ ...input, catalogSha256: hash.toUpperCase() }), 'invalid-request');
    code(
      () => createJournal({ ...input, items: [{ ...input.items[0], conversationKey: hash }] }),
      'invalid-journal'
    );
    code(() => createJournal({ ...input, items: [] }), 'invalid-journal');
    code(() => createJournal(input, { unrecognized: 1 } as never), 'invalid-limits');
    code(
      () =>
        createJournal(
          input,
          Object.defineProperty({}, 'maxItems', { get: () => 1, enumerable: true })
        ),
      'invalid-limits'
    );
  });

  it('enforces item, per-item attempts and total attempt boundaries without issuing a token', () => {
    let journal = control(createJournal(input), 'activate');
    for (let index = 0; index < 8; index += 1)
      journal = settle(running(journal, String(index)), unknown);
    expect(journal.items[0].attempts).toHaveLength(8);
    code(() => running(journal, '9'), 'limit-exceeded');
    code(
      () =>
        running(control(createJournal(input), 'activate'), 'x') &&
        transitionJournal(
          control(createJournal(input), 'activate'),
          {
            type: 'begin-attempt',
            expectedRunRevision: 1,
            itemId: 'item-1',
            expectedItemRevision: 0,
            attemptId: 'a',
            captureId: 'c',
          },
          { maxAttemptsPerItem: 0 }
        ),
      'limit-exceeded'
    );
    const current = running();
    code(() => snapshotJournal(current.journal, { maxTotalAttempts: 0 }), 'limit-exceeded');
    code(
      () =>
        settle(current, {
          kind: 'confirmed',
          evidence: Array.from({ length: 17 }, (_, index) => ({ ...evidence, byteLength: index })),
        }),
      'limit-exceeded'
    );
    code(
      () =>
        transitionJournal(
          current.journal,
          { type: 'settle-attempt', token: current.dispatchToken, outcome: confirmed },
          { maxEvidenceRefs: 0 }
        ),
      'limit-exceeded'
    );
    const items = Array.from({ length: 2048 }, (_, index) => ({
      ...input.items[0],
      itemId: `item-${index}`,
      conversationId: `conversation-${index}`,
      conversationKey: `liska-conversation-key/1:${index.toString(16).padStart(64, '0')}`,
    }));
    expect(createJournal({ ...input, items }).items).toHaveLength(2048);
    code(() => createJournal({ ...input, items: [...items, items[0]] }), 'limit-exceeded');
  });

  it('enforces the hard aggregate attempt and 8 MiB encoded-record ceilings on forged encoders', () => {
    const items: JournalItem[] = Array.from({ length: 1024 }, (_, index) => ({
      itemId: `item-${index}`,
      revision: 16,
      state: 'failed',
      admission: {
        provider: 'chatgpt',
        conversationId: `conversation-${index}`,
        conversationKey: `liska-conversation-key/1:${index.toString(16).padStart(64, '0')}`,
      },
      attempts: Array.from({ length: 8 }, (_, attempt) => ({
        attemptId: `attempt-${index}-${attempt}`,
        captureId: `capture-${index}-${attempt}`,
        revision: 1,
        state: 'settled',
        outcome: failed,
      })),
    }));
    const journal = { ...createJournal(input), revision: 16386, items };
    expect(snapshotJournal(journal).items.flatMap(item => item.attempts)).toHaveLength(8192);
    const extra = {
      ...items[0],
      itemId: 'extra',
      revision: 2,
      admission: {
        ...items[0].admission,
        conversationId: 'extra',
        conversationKey: `liska-conversation-key/1:${'f'.repeat(64)}`,
      },
      attempts: [
        { attemptId: 'extra', captureId: 'extra', revision: 1, state: 'settled', outcome: failed },
      ],
    };
    code(() => snapshotJournal({ ...journal, items: [...items, extra] }), 'limit-exceeded');
    const refs = Array.from({ length: 16 }, (_, index) => ({
      ...evidence,
      byteLength: index,
      destination: 'obsidian' as const,
    }));
    const large = items.map(item => ({
      ...item,
      state: 'unknown',
      attempts: item.attempts.map(attempt => ({
        ...attempt,
        outcome: { kind: 'unknown', reason: 'missing-confirmation', evidence: refs },
      })),
    }));
    expect(JSON.stringify({ ...journal, items: large }).length).toBeGreaterThan(8 * 1024 * 1024);
    code(() => encodeJournal({ ...journal, items: large }), 'limit-exceeded');
  });
});
