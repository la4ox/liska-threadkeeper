import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandChatGptInterpreterResolver,
  readChatGptInterpreterResolverState,
  resolveChatGptInterpreterAssets,
} from '../../src/background/chatgpt-interpreter-resolver';
import type {
  ChatGptInterpreterAssetCandidate,
  ChatGptInterpreterResolverDependencies,
} from '../../src/lib/chatgpt-interpreter-resolver-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const DOCUMENT_ID = 'a1b2c3d4e5f6';
const OTHER_DOCUMENT_ID = 'different-document';
const TAB_ID = 321;
const MARKER = `#liska-capture=${NONCE}&liska-interpreter-resolver=1`;
const TARGET_URL = `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`;
const CANDIDATES: ChatGptInterpreterAssetCandidate[] = [
  {
    assetId: `chatgpt-asset-${'a'.repeat(64)}`,
    messageId: 'msg_one',
    sandboxPath: '/mnt/data/one.txt',
  },
  {
    assetId: `chatgpt-asset-${'b'.repeat(64)}`,
    messageId: 'msg_two',
    sandboxPath: '/mnt/data/two.txt',
  },
];
const VALID_DOWNLOAD_URL =
  `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
  '&id=synthetic-file&p=p&sig=s&ts=t&v=v';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(sha256(bytes));
}

function captureFor(
  source: string | Uint8Array,
  overrides: Partial<{
    byteLength: number;
    sha256: string;
    mediaType: string;
    bodyBase64: string;
  }> = {}
) {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  return {
    bodyBase64:
      overrides.bodyBase64 ?? btoa(String.fromCharCode(...Array.from(new Uint8Array(bytes)))),
    byteLength: overrides.byteLength ?? bytes.byteLength,
    sha256: overrides.sha256 ?? sha256(bytes),
    mediaType: overrides.mediaType ?? 'application/json',
  };
}

function completeState(
  outcomes: unknown[],
  options: Partial<{
    conversationId: string;
    requestedCount: number;
    dispatchCount: number;
  }> = {}
) {
  return {
    kind: 'complete',
    conversationId: options.conversationId ?? CONVERSATION_ID,
    requestedCount: options.requestedCount ?? outcomes.length,
    dispatchCount: options.dispatchCount ?? outcomes.length,
    outcomes,
  };
}

function execution(result: unknown, documentId: unknown = DOCUMENT_ID): unknown[] {
  return [{ result, documentId }];
}

type FixtureOptions = {
  scriptResults?: unknown[][];
  initialResult?: unknown;
  initialDocumentId?: unknown;
  commandResult?: unknown;
  commandDocumentId?: unknown;
  finalResult?: unknown;
  finalDocumentId?: unknown;
  getResults?: unknown[];
};

function chromeFixture(options: FixtureOptions = {}) {
  const create = vi.fn().mockResolvedValue({ id: TAB_ID });
  const get = vi.fn().mockResolvedValue({ status: 'complete', url: TARGET_URL });
  for (const value of options.getResults ?? []) get.mockResolvedValueOnce(value);

  const executeScript = vi.fn();
  const scriptResults = options.scriptResults ?? [
    execution(
      options.initialResult === undefined ? { kind: 'ready' } : options.initialResult,
      options.initialDocumentId === undefined ? DOCUMENT_ID : options.initialDocumentId
    ),
    execution(
      options.commandResult === undefined ? { accepted: true } : options.commandResult,
      options.commandDocumentId === undefined ? DOCUMENT_ID : options.commandDocumentId
    ),
    execution(
      options.finalResult ?? completeState([{ state: 'http-error' }]),
      options.finalDocumentId === undefined ? DOCUMENT_ID : options.finalDocumentId
    ),
  ];
  for (const value of scriptResults) executeScript.mockResolvedValueOnce(value);

  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    create,
    get,
    executeScript,
    remove,
    api: {
      tabs: { create, get, remove },
      scripting: { executeScript },
    },
  };
}

async function resolveFixture(
  fixture: ReturnType<typeof chromeFixture>,
  candidates: readonly ChatGptInterpreterAssetCandidate[] = CANDIDATES,
  overrides: ChatGptInterpreterResolverDependencies = {}
) {
  return resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates, {
    chromeApi: fixture.api,
    createNonce: () => NONCE,
    digestSha256: digest,
    sleep: async () => undefined,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatGPT interpreter resolver coverage', () => {
  it('fails closed before browser work for invalid plans, nonce, clock, and tab creation', async () => {
    const inert = chromeFixture();
    const duplicateAssetId = [CANDIDATES[0], { ...CANDIDATES[1], assetId: CANDIDATES[0].assetId }];
    const duplicateMessagePath = [
      CANDIDATES[0],
      {
        ...CANDIDATES[1],
        messageId: CANDIDATES[0].messageId,
        sandboxPath: CANDIDATES[0].sandboxPath,
      },
    ];
    await expect(
      resolveChatGptInterpreterAssets('not-a-conversation', CANDIDATES, { chromeApi: inert.api })
    ).resolves.toEqual({ success: false, code: 'invalid-conversation-id' });
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, duplicateAssetId, { chromeApi: inert.api })
    ).resolves.toEqual({ success: false, code: 'invalid-interpreter-candidates' });
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, duplicateMessagePath, {
        chromeApi: inert.api,
      })
    ).resolves.toEqual({ success: false, code: 'invalid-interpreter-candidates' });
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, CANDIDATES, {
        chromeApi: inert.api,
        createNonce: () => 'short',
      })
    ).resolves.toEqual({ success: false, code: 'nonce-invalid' });
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, CANDIDATES, {
        chromeApi: inert.api,
        createNonce: () => {
          throw new Error('synthetic nonce failure');
        },
      })
    ).resolves.toEqual({ success: false, code: 'nonce-invalid' });
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, CANDIDATES, {
        chromeApi: inert.api,
        createNonce: () => NONCE,
        now: () => {
          throw new Error('synthetic clock failure');
        },
      })
    ).resolves.toEqual({ success: false, code: 'interpreter-result-invalid' });
    expect(inert.create).not.toHaveBeenCalled();

    const syncCreate = chromeFixture();
    syncCreate.create.mockImplementation(() => {
      throw new Error('synthetic synchronous create failure');
    });
    await expect(resolveFixture(syncCreate)).resolves.toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
    });

    const rejectedCreate = chromeFixture();
    rejectedCreate.create.mockRejectedValue(new Error('synthetic async create failure'));
    await expect(resolveFixture(rejectedCreate)).resolves.toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
    });

    const missingId = chromeFixture();
    missingId.create.mockResolvedValue({});
    await expect(resolveFixture(missingId)).resolves.toEqual({
      success: false,
      code: 'temporary-tab-missing-id',
    });
    expect(missingId.remove).not.toHaveBeenCalled();
  });

  it('cleans up an asynchronous tab that resolves after creation timed out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolveCreation: ((value: { id?: number }) => void) | undefined;
    const creation = new Promise<{ id?: number }>(resolve => {
      resolveCreation = resolve;
    });
    const late = chromeFixture();
    late.create.mockReturnValue(creation);

    const pending = resolveFixture(late, CANDIDATES, { timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
    });
    resolveCreation?.({ id: 777 });
    await vi.waitFor(() => expect(late.remove).toHaveBeenCalledWith(777));
  });

  it('keeps the terminal response when best-effort tab cleanup rejects', async () => {
    const fixture = chromeFixture();
    fixture.remove.mockRejectedValue(new Error('synthetic cleanup rejection'));
    await expect(resolveFixture(fixture, [CANDIDATES[0]])).resolves.toEqual({
      success: true,
      data: { resolved: [] },
    });
    expect(fixture.remove).toHaveBeenCalledWith(TAB_ID);
  });

  it.each([
    ['different origin', `https://example.test/c/${CONVERSATION_ID}${MARKER}`, 'unexpected-origin'],
    ['malformed URL', '%', 'unexpected-origin'],
    [
      'credentials in origin',
      `https://user:pass@chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      'unexpected-origin',
    ],
    ['different path', `https://chatgpt.com/c/other${MARKER}`, 'unexpected-path'],
    ['different query', `https://chatgpt.com/c/${CONVERSATION_ID}?x=1${MARKER}`, 'unexpected-path'],
  ] as const)('rejects a %s before MAIN injection', async (_label, url, code) => {
    const fixture = chromeFixture({ getResults: [{ status: 'complete', url }] });
    await expect(resolveFixture(fixture)).resolves.toEqual({ success: false, code });
    expect(fixture.executeScript).not.toHaveBeenCalled();
    expect(fixture.remove).toHaveBeenCalledWith(TAB_ID);
  });

  it('bounds loading, tab-read, and sleep failures while normalizing finite limits', async () => {
    let now = 0;
    const waiting = chromeFixture({ getResults: [{ status: 'loading' }] });
    const sleeps: number[] = [];
    await expect(
      resolveFixture(waiting, CANDIDATES, {
        timeoutMs: 5_000,
        pollIntervalMs: 5_000,
        now: () => now,
        sleep: async milliseconds => {
          sleeps.push(milliseconds);
          now = 5_001;
        },
      })
    ).resolves.toEqual({ success: false, code: 'temporary-tab-ready-timeout' });
    expect(sleeps).toEqual([1_000]);

    let readNow = 0;
    const readFailure = chromeFixture();
    readFailure.get.mockRejectedValue(new Error('synthetic tab read failure'));
    await expect(
      resolveFixture(readFailure, CANDIDATES, {
        timeoutMs: 1_000,
        now: () => readNow,
        sleep: () => {
          readNow = 1_001;
          return Promise.reject(new Error('synthetic sleep failure'));
        },
      })
    ).resolves.toEqual({ success: false, code: 'temporary-tab-ready-timeout' });
    expect(readFailure.remove).toHaveBeenCalledWith(TAB_ID);
  });

  it('handles missing, malformed, non-ready, and error initial MAIN snapshots', async () => {
    const missingDocument = chromeFixture({ initialDocumentId: null });
    await expect(resolveFixture(missingDocument)).resolves.toEqual({
      success: false,
      code: 'document-id-missing',
    });

    const initialError = chromeFixture({
      initialResult: { kind: 'error', code: 'source-rejected' },
    });
    await expect(resolveFixture(initialError)).resolves.toEqual({
      success: false,
      code: 'source-rejected',
    });

    const initialComplete = chromeFixture({
      initialResult: completeState([{ state: 'http-error' }], {
        requestedCount: 1,
        dispatchCount: 1,
      }),
    });
    await expect(resolveFixture(initialComplete)).resolves.toEqual({
      success: false,
      code: 'interpreter-result-invalid',
    });

    const initialInvalid = chromeFixture({ initialResult: { kind: 'not-a-hook-state' } });
    await expect(resolveFixture(initialInvalid)).resolves.toEqual({
      success: false,
      code: 'interpreter-result-invalid',
    });

    const emptyExecution = chromeFixture({
      scriptResults: [
        [],
        execution({ accepted: true }),
        execution(completeState([{ state: 'http-error' }])),
      ],
    });
    await expect(resolveFixture(emptyExecution)).resolves.toEqual({
      success: false,
      code: 'document-id-missing',
    });

    const throwingExecution = chromeFixture();
    throwingExecution.executeScript.mockReset();
    throwingExecution.executeScript.mockRejectedValue(new Error('synthetic hook read failure'));
    await expect(resolveFixture(throwingExecution)).resolves.toEqual({
      success: false,
      code: 'document-id-missing',
    });
  });

  it('guards the current route and rejects command responses outside the pinned document', async () => {
    const routeDrift = chromeFixture({
      getResults: [
        { status: 'complete', url: TARGET_URL },
        { status: 'complete', url: `https://example.test/c/${CONVERSATION_ID}${MARKER}` },
      ],
    });
    await expect(resolveFixture(routeDrift)).resolves.toEqual({
      success: false,
      code: 'unexpected-origin',
    });

    const pathDrift = chromeFixture({
      getResults: [
        { status: 'complete', url: TARGET_URL },
        { status: 'complete', url: `https://chatgpt.com/c/other${MARKER}` },
      ],
    });
    await expect(resolveFixture(pathDrift)).resolves.toEqual({
      success: false,
      code: 'unexpected-path',
    });

    const currentReadThrows = chromeFixture();
    currentReadThrows.get.mockResolvedValueOnce({ status: 'complete', url: TARGET_URL });
    currentReadThrows.get.mockRejectedValueOnce(new Error('synthetic current-route failure'));
    await expect(resolveFixture(currentReadThrows)).resolves.toEqual({
      success: false,
      code: 'interpreter-result-invalid',
    });

    const hostileCommand = new Proxy(
      { accepted: true },
      {
        ownKeys() {
          throw new Error('synthetic command ownKeys failure');
        },
      }
    );
    const commandCases = [
      chromeFixture({ commandResult: { accepted: false } }),
      chromeFixture({ commandResult: { accepted: true, extra: true } }),
      chromeFixture({ commandResult: ['accepted'] }),
      chromeFixture({ commandResult: hostileCommand }),
      chromeFixture({ commandDocumentId: OTHER_DOCUMENT_ID }),
      chromeFixture({ scriptResults: [execution({ kind: 'ready' }), []] }),
    ];
    for (const fixture of commandCases) {
      await expect(resolveFixture(fixture)).resolves.toEqual({
        success: false,
        code: 'command-rejected',
      });
    }

    const commandThrows = chromeFixture();
    commandThrows.executeScript.mockReset();
    commandThrows.executeScript.mockResolvedValueOnce(execution({ kind: 'ready' }));
    commandThrows.executeScript.mockRejectedValueOnce(new Error('synthetic command failure'));
    await expect(resolveFixture(commandThrows)).resolves.toEqual({
      success: false,
      code: 'command-rejected',
    });
  });

  it('rejects hook errors, document drift, malformed polling results, and result timeout', async () => {
    const hookError = chromeFixture({ finalResult: { kind: 'error', code: 'source-http-error' } });
    await expect(resolveFixture(hookError)).resolves.toEqual({
      success: false,
      code: 'source-http-error',
    });

    const documentDrift = chromeFixture({ finalDocumentId: OTHER_DOCUMENT_ID });
    await expect(resolveFixture(documentDrift)).resolves.toEqual({
      success: false,
      code: 'interpreter-result-invalid',
    });

    const missingPollDocument = chromeFixture({
      scriptResults: [
        execution({ kind: 'ready' }),
        execution({ accepted: true }),
        execution({ kind: 'ready' }, null),
      ],
    });
    await expect(resolveFixture(missingPollDocument)).resolves.toEqual({
      success: false,
      code: 'interpreter-result-invalid',
    });

    let now = 0;
    const malformedPoll = chromeFixture({ finalResult: { malformed: true } });
    await expect(
      resolveFixture(malformedPoll, CANDIDATES, {
        timeoutMs: 1_000,
        now: () => now,
        sleep: async () => {
          now = 1_001;
        },
      })
    ).resolves.toEqual({ success: false, code: 'interpreter-result-timeout' });

    let sleepNow = 0;
    const pendingPoll = chromeFixture({ finalResult: { kind: 'ready' } });
    await expect(
      resolveFixture(pendingPoll, CANDIDATES, {
        timeoutMs: 1_000,
        now: () => sleepNow,
        sleep: () => {
          sleepNow = 1_001;
          return Promise.reject(new Error('synthetic result polling stop'));
        },
      })
    ).resolves.toEqual({ success: false, code: 'interpreter-result-timeout' });

    const executePollThrows = chromeFixture();
    executePollThrows.executeScript.mockReset();
    executePollThrows.executeScript.mockResolvedValueOnce(execution({ kind: 'ready' }));
    executePollThrows.executeScript.mockResolvedValueOnce(execution({ accepted: true }));
    executePollThrows.executeScript.mockRejectedValueOnce(new Error('synthetic poll failure'));
    await expect(resolveFixture(executePollThrows)).resolves.toEqual({
      success: false,
      code: 'interpreter-result-invalid',
    });

    const mismatchedComplete = chromeFixture({
      finalResult: completeState([{ state: 'http-error' }], {
        requestedCount: 1,
        dispatchCount: 1,
      }),
    });
    await expect(resolveFixture(mismatchedComplete)).resolves.toEqual({
      success: false,
      code: 'interpreter-result-invalid',
    });
  });

  it('times out a hanging response digest at the resolver deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const body = captureFor(JSON.stringify({ download_url: VALID_DOWNLOAD_URL }));
    const fixture = chromeFixture({
      finalResult: completeState([{ state: 'observed', capture: body }], {
        requestedCount: 1,
        dispatchCount: 1,
      }),
    });
    const pending = resolveFixture(fixture, [CANDIDATES[0]], {
      timeoutMs: 1_000,
      digestSha256: () => new Promise<string>(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'interpreter-result-timeout',
    });
  });

  it('returns a partial or empty success while rejecting payload integrity and URL binding failures', async () => {
    const valid = captureFor(JSON.stringify({ download_url: VALID_DOWNLOAD_URL }));
    const invalidBase64 = {
      ...valid,
      bodyBase64: 'AB==',
      byteLength: 1,
      sha256: '0'.repeat(64),
    };
    const invalidUtf8 = captureFor(Uint8Array.of(0xff));
    const invalidJson = captureFor('{');
    const wrongConversation = captureFor(
      JSON.stringify({
        status: 'Success',
        download_url:
          `https://chatgpt.com/backend-api/estuary/content?cid=${OTHER_CONVERSATION_ID}` +
          '&id=synthetic-file&p=p&sig=s&ts=t&v=v',
      })
    );
    const cases: Array<{
      label: string;
      capture: ReturnType<typeof captureFor>;
      digestSha256?: (bytes: Uint8Array) => Promise<string>;
      expected: string[];
    }> = [
      {
        label: 'non-JSON media type',
        capture: { ...valid, mediaType: 'text/plain' },
        expected: [],
      },
      {
        label: 'JSON suffix media type',
        capture: { ...valid, mediaType: 'application/vnd.synthetic+json; charset=utf-8' },
        expected: [VALID_DOWNLOAD_URL],
      },
      {
        label: 'media control character',
        capture: { ...valid, mediaType: 'application/json\u0001' },
        expected: [],
      },
      { label: 'noncanonical base64', capture: invalidBase64, expected: [] },
      { label: 'invalid UTF-8 JSON', capture: invalidUtf8, expected: [] },
      { label: 'malformed JSON', capture: invalidJson, expected: [] },
      { label: 'wrong conversation URL', capture: wrongConversation, expected: [] },
      {
        label: 'digest rejection',
        capture: valid,
        digestSha256: () => Promise.reject(new Error('synthetic digest rejection')),
        expected: [],
      },
      {
        label: 'digest format rejection',
        capture: valid,
        digestSha256: () => Promise.resolve('not-a-sha256'),
        expected: [],
      },
      {
        label: 'digest mismatch',
        capture: valid,
        digestSha256: () => Promise.resolve('0'.repeat(64)),
        expected: [],
      },
    ];
    for (const testCase of cases) {
      const fixture = chromeFixture({
        finalResult: completeState([{ state: 'observed', capture: testCase.capture }], {
          requestedCount: 1,
          dispatchCount: 1,
        }),
      });
      await expect(
        resolveFixture(fixture, [CANDIDATES[0]], {
          digestSha256: testCase.digestSha256 ?? digest,
        })
      ).resolves.toEqual({
        success: true,
        data: {
          resolved: testCase.expected.map(downloadUrl => ({
            assetId: CANDIDATES[0].assetId,
            downloadUrl,
          })),
        },
      });
    }

    const originalAtob = globalThis.atob;
    const originalBtoa = globalThis.btoa;
    const rejectedAtob = chromeFixture({
      finalResult: completeState([{ state: 'observed', capture: valid }], {
        requestedCount: 1,
        dispatchCount: 1,
      }),
    });
    vi.stubGlobal('atob', undefined);
    await expect(resolveFixture(rejectedAtob, [CANDIDATES[0]])).resolves.toEqual({
      success: true,
      data: { resolved: [] },
    });
    vi.stubGlobal('atob', originalAtob);

    const rejectedBtoa = chromeFixture({
      finalResult: completeState([{ state: 'observed', capture: valid }], {
        requestedCount: 1,
        dispatchCount: 1,
      }),
    });
    vi.stubGlobal('btoa', undefined);
    await expect(resolveFixture(rejectedBtoa, [CANDIDATES[0]])).resolves.toEqual({
      success: true,
      data: { resolved: [] },
    });
    vi.stubGlobal('btoa', originalBtoa);

    const throwingAtob = chromeFixture({
      finalResult: completeState([{ state: 'observed', capture: valid }], {
        requestedCount: 1,
        dispatchCount: 1,
      }),
    });
    vi.stubGlobal('atob', () => {
      throw new Error('synthetic atob failure');
    });
    await expect(resolveFixture(throwingAtob, [CANDIDATES[0]])).resolves.toEqual({
      success: true,
      data: { resolved: [] },
    });
    vi.stubGlobal('atob', originalAtob);

    const partial = chromeFixture({
      finalResult: completeState([{ state: 'http-error' }, { state: 'not-dispatched' }], {
        requestedCount: 2,
        dispatchCount: 1,
      }),
    });
    await expect(resolveFixture(partial)).resolves.toEqual({
      success: true,
      data: { resolved: [] },
    });
  });

  it.each([
    ['only download_url', { download_url: VALID_DOWNLOAD_URL }, true],
    ['success envelope', { status: 'Success', download_url: VALID_DOWNLOAD_URL }, true],
    ['extra envelope key', { download_url: VALID_DOWNLOAD_URL, extra: true }, false],
    ['missing status', { status: 'Error', download_url: VALID_DOWNLOAD_URL }, false],
    ['missing URL', { status: 'Success' }, false],
    ['array body', [VALID_DOWNLOAD_URL], false],
    ['null body', null, false],
  ] as const)(
    'accepts only exact interpreter JSON envelopes: %s',
    async (_label, value, accepted) => {
      const body = captureFor(JSON.stringify(value));
      const fixture = chromeFixture({
        finalResult: completeState([{ state: 'observed', capture: body }], {
          requestedCount: 1,
          dispatchCount: 1,
        }),
      });
      await expect(resolveFixture(fixture, [CANDIDATES[0]])).resolves.toEqual({
        success: true,
        data: {
          resolved: accepted
            ? [{ assetId: CANDIDATES[0].assetId, downloadUrl: VALID_DOWNLOAD_URL }]
            : [],
        },
      });
    }
  );

  it('uses the default nonce, digest, timeout normalization, and bounded default sleep', async () => {
    const valid = captureFor(JSON.stringify({ download_url: VALID_DOWNLOAD_URL }));
    const create = vi.fn().mockResolvedValue({ id: TAB_ID });
    const get = vi.fn().mockResolvedValue({ status: 'complete', url: TARGET_URL });
    const remove = vi.fn().mockResolvedValue(undefined);
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce(execution({ kind: 'ready' }))
      .mockResolvedValueOnce(execution({ accepted: true }))
      .mockResolvedValueOnce(
        execution(
          completeState([{ state: 'observed', capture: valid }], {
            requestedCount: 1,
            dispatchCount: 1,
          })
        )
      );
    const subtleDigest = vi.fn(async (_algorithm: string, input: ArrayBuffer) => {
      const bytes = new Uint8Array(input);
      return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
    });
    vi.stubGlobal('crypto', {
      randomUUID: () => NONCE,
      subtle: { digest: subtleDigest },
    });
    vi.stubGlobal('chrome', {
      tabs: { create, get, remove },
      scripting: { executeScript },
    });
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, [CANDIDATES[0]])
    ).resolves.toEqual({
      success: true,
      data: {
        resolved: [{ assetId: CANDIDATES[0].assetId, downloadUrl: VALID_DOWNLOAD_URL }],
      },
    });
    expect(subtleDigest).toHaveBeenCalledWith('SHA-256', expect.any(ArrayBuffer));

    vi.useFakeTimers();
    vi.setSystemTime(0);
    const waitingCreate = vi.fn().mockResolvedValue({ id: TAB_ID });
    const waitingGet = vi.fn().mockResolvedValue({ status: 'loading' });
    const waitingRemove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      tabs: { create: waitingCreate, get: waitingGet, remove: waitingRemove },
      scripting: { executeScript: vi.fn() },
    });
    const pending = resolveChatGptInterpreterAssets(CONVERSATION_ID, [CANDIDATES[0]], {
      timeoutMs: 1_000,
      pollIntervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'temporary-tab-ready-timeout',
    });
    expect(waitingRemove).toHaveBeenCalledWith(TAB_ID);
  });

  it('reads exact ready, error, complete, and ordinal snapshots only', () => {
    const key = `__liskaChatGptInterpreterResolver_${NONCE}`;
    const commandKey = `__liskaChatGptInterpreterResolverCommand_${NONCE}`;
    const readerCapture = {
      bodyBase64: 'e30=',
      byteLength: 2,
      sha256: '0'.repeat(64),
      mediaType: 'application/json',
    };
    vi.stubGlobal('window', { [key]: { kind: 'ready' } });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'ready' });
    vi.stubGlobal('window', { [key]: { kind: 'ready', extra: true } });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', { [key]: { kind: 'error', code: 'source-non-json' } });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({
      kind: 'error',
      code: 'source-non-json',
    });
    vi.stubGlobal('window', { [key]: { kind: 'error', code: 'not-an-allowed-error' } });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'missing' });

    const complete = completeState(
      [
        { state: 'observed', capture: readerCapture },
        { state: 'http-error' },
        { state: 'not-dispatched' },
      ],
      { requestedCount: 3, dispatchCount: 2 }
    );
    vi.stubGlobal('window', { [key]: complete });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual(complete);

    const allNonObserved = [
      'http-error',
      'fetch-rejected',
      'response-processing-rejected',
      'non-json',
      'oversized',
      'timed-out',
      'not-dispatched',
    ].map(state => ({ state }));
    vi.stubGlobal('window', {
      [key]: completeState(allNonObserved, { requestedCount: 7, dispatchCount: 6 }),
    });
    expect(readChatGptInterpreterResolverState(NONCE)).toMatchObject({
      kind: 'complete',
      requestedCount: 7,
      dispatchCount: 6,
    });

    vi.stubGlobal('window', {});
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'missing' });
    expect(readChatGptInterpreterResolverState('short')).toEqual({ kind: 'missing' });
    expect(readChatGptInterpreterResolverState(null as never)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      get [key]() {
        throw new Error('synthetic snapshot getter failure');
      },
    });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [commandKey]: (candidates: unknown) => Array.isArray(candidates) && candidates.length === 1,
    });
    expect(commandChatGptInterpreterResolver(NONCE, [CANDIDATES[0]])).toEqual({ accepted: true });
    vi.stubGlobal('window', {});
    expect(commandChatGptInterpreterResolver(NONCE, [CANDIDATES[0]])).toEqual({ accepted: false });
    vi.stubGlobal('window', {
      [commandKey]: () => {
        throw new Error('synthetic command throw');
      },
    });
    expect(commandChatGptInterpreterResolver(NONCE, [CANDIDATES[0]])).toEqual({ accepted: false });
    expect(commandChatGptInterpreterResolver('short', [CANDIDATES[0]])).toEqual({
      accepted: false,
    });
  });

  it('rejects malformed complete snapshots, captures, and ordinal alignment', () => {
    const key = `__liskaChatGptInterpreterResolver_${NONCE}`;
    const capture = {
      bodyBase64: 'e30=',
      byteLength: 2,
      sha256: '0'.repeat(64),
      mediaType: 'application/json',
    };
    const base = completeState([{ state: 'http-error' }], {
      requestedCount: 1,
      dispatchCount: 1,
    });
    const cases: unknown[] = [
      { ...base, extra: true },
      { ...base, conversationId: 'not-a-conversation' },
      { ...base, requestedCount: 1.5 },
      { ...base, requestedCount: -1, outcomes: [] },
      { ...base, requestedCount: 21, outcomes: [] },
      { ...base, dispatchCount: -1 },
      { ...base, dispatchCount: 2 },
      { ...base, outcomes: 'not-an-array' },
      { ...base, outcomes: [] },
      { ...base, outcomes: [null] },
      { ...base, outcomes: [{ state: 'observed' }] },
      { ...base, outcomes: [{ state: 'observed', capture: null }] },
      { ...base, outcomes: [{ state: 'unknown-state' }] },
      { ...base, outcomes: [{ state: 'http-error', extra: true }] },
      { ...base, dispatchCount: 0, outcomes: [{ state: 'http-error' }] },
      { ...base, outcomes: [{ state: 'not-dispatched' }] },
      { ...base, outcomes: [{ state: 'observed', capture: { ...capture, extra: true } }] },
      {
        ...base,
        outcomes: [{ state: 'observed', capture: { ...capture, bodyBase64: 1 } }],
      },
      {
        ...base,
        outcomes: [
          { state: 'observed', capture: { ...capture, bodyBase64: 'A'.repeat(96 * 1024 + 4) } },
        ],
      },
      {
        ...base,
        outcomes: [{ state: 'observed', capture: { ...capture, byteLength: 1.5 } }],
      },
      {
        ...base,
        outcomes: [{ state: 'observed', capture: { ...capture, byteLength: -1 } }],
      },
      {
        ...base,
        outcomes: [{ state: 'observed', capture: { ...capture, byteLength: 65 * 1024 } }],
      },
      {
        ...base,
        outcomes: [{ state: 'observed', capture: { ...capture, sha256: 'not-a-hash' } }],
      },
      {
        ...base,
        outcomes: [{ state: 'observed', capture: { ...capture, mediaType: 1 } }],
      },
      {
        ...base,
        outcomes: [{ state: 'observed', capture: { ...capture, mediaType: '' } }],
      },
      {
        ...base,
        outcomes: [
          {
            state: 'observed',
            capture: { ...capture, mediaType: 'x'.repeat(256) },
          },
        ],
      },
    ];
    for (const value of cases) {
      vi.stubGlobal('window', { [key]: value });
      expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'missing' });
    }

    const hostile = new Proxy(
      { kind: 'complete' },
      {
        ownKeys() {
          throw new Error('synthetic state ownKeys failure');
        },
      }
    );
    vi.stubGlobal('window', { [key]: hostile });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'missing' });
  });
});
