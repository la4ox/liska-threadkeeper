import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandChatGptActiveResolver,
  probeChatGptActiveAssetResolvers,
  readChatGptActiveResolverState,
} from '../../src/background/chatgpt-active-resolver';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const DOCUMENT_ID = 'a1b2c3d4e5f6';
const PROVIDER_ID = 'file_abc-123';
const MARKER = `#liska-capture=${NONCE}&liska-active-resolver=1`;

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function observedState(bodyBase64: string, byteLength: number, sha256: string) {
  return {
    kind: 'complete',
    conversationId: CONVERSATION_ID,
    requestedCount: 1,
    dispatchCount: 1,
    outcomes: [
      {
        state: 'observed',
        capture: { bodyBase64, byteLength, sha256, mediaType: 'application/json' },
      },
    ],
  };
}

function chromeApi(result: unknown) {
  const executeScript = vi
    .fn()
    .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
    .mockResolvedValueOnce([{ result: { accepted: true }, documentId: DOCUMENT_ID }])
    .mockResolvedValueOnce([{ result, documentId: DOCUMENT_ID }]);
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    executeScript,
    remove,
    api: {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        get: vi.fn().mockResolvedValue({
          status: 'complete',
          url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
        }),
        remove,
      },
      scripting: { executeScript },
    },
  };
}

function readyTabApi(executeScript: ReturnType<typeof vi.fn>) {
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    remove,
    api: {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        get: vi.fn().mockResolvedValue({
          status: 'complete',
          url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
        }),
        remove,
      },
      scripting: { executeScript },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatGPT active resolver background checkpoint', () => {
  it('uses a foreground exact marker, pins command/polls to the first document, and returns metrics only', async () => {
    const signedUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private-file&p=p&sig=s&ts=t&v=v';
    const body = new TextEncoder().encode(JSON.stringify({ download_url: signedUrl }));
    const chrome = chromeApi(
      observedState(btoa(String.fromCharCode(...body)), body.byteLength, await digest(body))
    );

    const response = await probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: digest,
    });

    expect(response).toEqual({
      success: true,
      data: {
        requestedCount: 1,
        dispatchCount: 1,
        observedCount: 1,
        outcomes: ['observed'],
        attemptedAt: expect.any(String),
      },
    });
    expect(chrome.api.tabs.create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      active: true,
    });
    const calls = chrome.executeScript.mock.calls;
    expect(calls[0][0].target).toEqual({ tabId: 123 });
    expect(calls[1][0].target).toEqual({ tabId: 123, documentIds: [DOCUMENT_ID] });
    expect(calls[2][0].target).toEqual({ tabId: 123, documentIds: [DOCUMENT_ID] });
    expect(calls[1][0].args).toEqual([NONCE, [PROVIDER_ID]]);
    expect(JSON.stringify(response)).not.toContain(PROVIDER_ID);
    expect(JSON.stringify(response)).not.toContain('sig=s');
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('downgrades hostile observed bodies without exposing them or using a fallback route', async () => {
    const chrome = chromeApi(observedState('e30=', 2, '0'.repeat(64)));
    const response = await probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: digest,
    });
    expect(response).toMatchObject({
      success: true,
      data: { outcomes: ['rejected'], observedCount: 0, dispatchCount: 1 },
    });
    expect(chrome.executeScript).toHaveBeenCalledTimes(3);
  });

  it('fails before dispatch when the first MAIN read cannot bind a document', async () => {
    const chrome = chromeApi({ kind: 'ready' });
    chrome.executeScript.mockReset().mockResolvedValue([{ result: { kind: 'ready' } }]);
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'document-id-missing' });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('fails closed for invalid IDs or a nonce failure before creating any tab', async () => {
    const create = vi.fn();
    const chromeApi = {
      tabs: { create, get: vi.fn(), remove: vi.fn() },
      scripting: { executeScript: vi.fn() },
    };
    await expect(
      probeChatGptActiveAssetResolvers('not-a-conversation-id', [PROVIDER_ID], { chromeApi })
    ).resolves.toEqual({ success: false, code: 'invalid-conversation-id' });
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, ['duplicate', 'duplicate'], { chromeApi })
    ).resolves.toEqual({ success: false, code: 'invalid-provider-file-ids' });
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi,
        createNonce: () => {
          throw new Error('synthetic nonce failure');
        },
      })
    ).resolves.toEqual({ success: false, code: 'nonce-invalid' });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['different origin', `https://example.test/c/${CONVERSATION_ID}${MARKER}`, 'unexpected-origin'],
    ['malformed URL', '%', 'unexpected-origin'],
    [
      'different marker',
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      'unexpected-path',
    ],
  ] as const)(
    'stops at readiness for a %s and removes its exact foreground tab',
    async (_label, url, code) => {
      const executeScript = vi.fn();
      const chrome = readyTabApi(executeScript);
      chrome.api.tabs.get.mockResolvedValue({ status: 'complete', url });
      await expect(
        probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
          chromeApi: chrome.api,
          createNonce: () => NONCE,
        })
      ).resolves.toEqual({ success: false, code });
      expect(executeScript).not.toHaveBeenCalled();
      expect(chrome.remove).toHaveBeenCalledWith(123);
    }
  );

  it('rejects a command response bound to a different document without polling it', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { accepted: true }, documentId: 'different-document' }]);
    const chrome = readyTabApi(executeScript);
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'command-rejected' });
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('fails closed when a pinned poll reports a different document', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { accepted: true }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: 'different-document' }]);
    const chrome = readyTabApi(executeScript);
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'resolver-result-invalid' });
    expect(executeScript.mock.calls[2]?.[0].target).toEqual({
      tabId: 123,
      documentIds: [DOCUMENT_ID],
    });
  });

  it('preserves a batch-start timestamp and metric-only partial ordinal states', async () => {
    const partial = {
      kind: 'complete',
      conversationId: CONVERSATION_ID,
      requestedCount: 3,
      dispatchCount: 1,
      outcomes: [{ state: 'http-error' }, { state: 'not-dispatched' }, { state: 'not-dispatched' }],
    };
    const chrome = chromeApi(partial);
    let calls = 0;
    const response = await probeChatGptActiveAssetResolvers(
      CONVERSATION_ID,
      ['first', 'second', 'third'],
      {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        now: () => (calls++ === 0 ? 1_000 : 2_000),
      }
    );
    expect(response).toEqual({
      success: true,
      data: {
        requestedCount: 3,
        dispatchCount: 1,
        observedCount: 0,
        outcomes: ['http-error', 'not-dispatched', 'not-dispatched'],
        attemptedAt: '1970-01-01T00:00:01.000Z',
      },
    });
  });

  it('bounds a hanging digest by the global deadline and cleans the exact tab', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const signedUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private-file&p=p&sig=s&ts=t&v=v';
    const body = new TextEncoder().encode(JSON.stringify({ download_url: signedUrl }));
    const chrome = chromeApi(
      observedState(btoa(String.fromCharCode(...body)), body.byteLength, '0'.repeat(64))
    );
    const pending = probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      digestSha256: () => new Promise<string>(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({ success: false, code: 'resolver-result-timeout' });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('bounds a hanging pre-command tab read and still closes the created tab', async () => {
    vi.useFakeTimers();
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }]);
    const chrome = readyTabApi(executeScript);
    chrome.api.tabs.get
      .mockResolvedValueOnce({
        status: 'complete',
        url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      })
      .mockImplementationOnce(() => new Promise(() => undefined));
    const pending = probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({ success: false, code: 'resolver-result-invalid' });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('uses the bounded default readiness sleep before the exact target becomes ready', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { accepted: true }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([
        {
          result: {
            kind: 'complete',
            conversationId: CONVERSATION_ID,
            requestedCount: 1,
            dispatchCount: 1,
            outcomes: [{ state: 'http-error' }],
          },
          documentId: DOCUMENT_ID,
        },
      ]);
    const chrome = readyTabApi(executeScript);
    chrome.api.tabs.get
      .mockResolvedValueOnce({ status: 'loading', url: 'about:blank' })
      .mockResolvedValue({
        status: 'complete',
        url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      });
    const pending = probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      pollIntervalMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({
      success: true,
      data: { outcomes: ['http-error'] },
    });
  });

  it('contains rejected readiness sleep and rejected MAIN injections', async () => {
    let now = 0;
    const waiting = readyTabApi(vi.fn());
    waiting.api.tabs.get.mockResolvedValue({ status: 'loading', url: 'about:blank' });
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: waiting.api,
        createNonce: () => NONCE,
        timeoutMs: 1_000,
        now: () => now,
        sleep: () => {
          now = 1_001;
          return Promise.reject(new Error('synthetic sleep rejection'));
        },
      })
    ).resolves.toEqual({ success: false, code: 'temporary-tab-ready-timeout' });

    const initialRejected = readyTabApi(vi.fn().mockRejectedValue(new Error('synthetic read')));
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: initialRejected.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'document-id-missing' });

    const commandRejected = readyTabApi(
      vi
        .fn()
        .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
        .mockRejectedValueOnce(new Error('synthetic command rejection'))
    );
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: commandRejected.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'command-rejected' });
  });

  it('rejects a hostile command result whose own keys cannot be inspected', async () => {
    const hostile = new Proxy(
      { accepted: true },
      {
        ownKeys() {
          throw new Error('synthetic ownKeys failure');
        },
      }
    );
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: hostile, documentId: DOCUMENT_ID }]);
    const chrome = readyTabApi(executeScript);
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'command-rejected' });
  });

  it('uses default nonce, digest, and browser dependencies without disclosing their transient inputs', async () => {
    const signedUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private-file&p=p&sig=s&ts=t&v=v';
    const body = new TextEncoder().encode(JSON.stringify({ download_url: signedUrl }));
    const hash = await globalThis.crypto.subtle.digest('SHA-256', body);
    const sha256 = Array.from(new Uint8Array(hash), value =>
      value.toString(16).padStart(2, '0')
    ).join('');
    let createdUrl = '';
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { accepted: true }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([
        {
          result: observedState(btoa(String.fromCharCode(...body)), body.byteLength, sha256),
          documentId: DOCUMENT_ID,
        },
      ]);
    vi.stubGlobal('chrome', {
      tabs: {
        create: vi.fn(async ({ url }: { url: string }) => {
          createdUrl = url;
          return { id: 123 };
        }),
        get: vi.fn(async () => ({ status: 'complete', url: createdUrl })),
        remove: vi.fn(async () => undefined),
      },
      scripting: { executeScript },
    });
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID])
    ).resolves.toMatchObject({
      success: true,
      data: { outcomes: ['observed'], observedCount: 1 },
    });
    expect(createdUrl).toMatch(
      new RegExp(`^https://chatgpt\\.com/c/${CONVERSATION_ID}#liska-capture=`)
    );
  });

  it('returns stable temporary-tab creation and readiness failures without a second provider request', async () => {
    const rejectedCreate = {
      tabs: {
        create: vi.fn().mockRejectedValue(new Error('synthetic create failure')),
        get: vi.fn(),
        remove: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
    };
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: rejectedCreate,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'temporary-tab-create-failed' });
    const missingId = readyTabApi(vi.fn());
    missingId.api.tabs.create.mockResolvedValue({});
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: missingId.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'temporary-tab-missing-id' });
    let now = 0;
    const waiting = readyTabApi(vi.fn());
    waiting.api.tabs.get.mockResolvedValue({ status: 'loading' });
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: waiting.api,
        createNonce: () => NONCE,
        timeoutMs: 1_000,
        now: () => now,
        sleep: async () => {
          now = 1_001;
        },
      })
    ).resolves.toEqual({ success: false, code: 'temporary-tab-ready-timeout' });
    expect(waiting.remove).toHaveBeenCalledWith(123);
  });

  it('contains invalid lifecycle clocks, synchronous creation, and a late-created tab', async () => {
    const inert = {
      tabs: { create: vi.fn(), get: vi.fn(), remove: vi.fn() },
      scripting: { executeScript: vi.fn() },
    };
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: inert,
        createNonce: () => NONCE,
        now: () => Number.NaN,
      })
    ).resolves.toEqual({ success: false, code: 'resolver-result-invalid' });
    let clockCalls = 0;
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: inert,
        createNonce: () => NONCE,
        now: () => {
          clockCalls += 1;
          if (clockCalls === 1) return 0;
          throw new Error('synthetic clock failure');
        },
      })
    ).resolves.toEqual({ success: false, code: 'resolver-result-invalid' });

    const syncCreate = {
      tabs: {
        create: vi.fn(() => {
          throw new Error('synthetic synchronous create failure');
        }),
        get: vi.fn(),
        remove: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
    };
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: syncCreate as never,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'temporary-tab-create-failed' });

    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolveCreation: ((value: { id?: number }) => void) | undefined;
    const creation = new Promise<{ id?: number }>(resolve => {
      resolveCreation = resolve;
    });
    const lateRemove = vi.fn().mockResolvedValue(undefined);
    const late = {
      tabs: {
        create: vi.fn(() => creation),
        get: vi.fn(),
        remove: lateRemove,
      },
      scripting: { executeScript: vi.fn() },
    };
    const pending = probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
      chromeApi: late,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({ success: false, code: 'temporary-tab-create-failed' });
    resolveCreation?.({ id: 777 });
    await Promise.resolve();
    await vi.waitFor(() => expect(lateRemove).toHaveBeenCalledWith(777));
  });

  it('bounds pre-command route drift and a ready-state polling failure', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }]);
    const drift = readyTabApi(executeScript);
    drift.api.tabs.get
      .mockResolvedValueOnce({
        status: 'complete',
        url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      })
      .mockResolvedValueOnce({
        status: 'complete',
        url: `https://example.test/c/${CONVERSATION_ID}${MARKER}`,
      });
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: drift.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'unexpected-origin' });

    let now = 0;
    const pollingScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { accepted: true }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }]);
    const polling = readyTabApi(pollingScript);
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: polling.api,
        createNonce: () => NONCE,
        timeoutMs: 1_000,
        now: () => now,
        sleep: () => {
          now = 1_001;
          return Promise.reject(new Error('synthetic polling stop'));
        },
      })
    ).resolves.toEqual({ success: false, code: 'resolver-result-timeout' });
  });

  it('downgrades malformed media, digest, and signed URL observations independently', async () => {
    const validUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private-file&p=p&sig=s&ts=t&v=v';
    const body = new TextEncoder().encode(JSON.stringify({ download_url: validUrl }));
    const bodyBase64 = btoa(String.fromCharCode(...body));
    const hash = await digest(body);
    const cases = [
      {
        label: 'media type',
        state: {
          ...observedState(bodyBase64, body.byteLength, hash),
          outcomes: [
            {
              state: 'observed',
              capture: {
                bodyBase64,
                byteLength: body.byteLength,
                sha256: hash,
                mediaType: 'text/plain',
              },
            },
          ],
        },
        digestSha256: digest,
      },
      {
        label: 'digest rejection',
        state: observedState(bodyBase64, body.byteLength, hash),
        digestSha256: () => Promise.reject(new Error('synthetic digest failure')),
      },
      {
        label: 'wrong conversation URL',
        state: observedState(
          btoa(
            JSON.stringify({
              download_url:
                'https://chatgpt.com/backend-api/estuary/content?cid=11111111-2222-3333-4444-555555555555&id=x&p=p&sig=s&ts=t&v=v',
            })
          ),
          130,
          '0'.repeat(64)
        ),
        digestSha256: digest,
      },
    ] as const;
    for (const testCase of cases) {
      const chrome = chromeApi(testCase.state);
      const response = await probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        digestSha256: testCase.digestSha256,
      });
      expect(response).toMatchObject({
        success: true,
        data: { outcomes: ['rejected'], observedCount: 0 },
      });
    }
  });

  it('rejects unavailable base64 primitives and malformed resolver JSON', async () => {
    const validBody = new TextEncoder().encode('{}');
    const validHash = await digest(validBody);
    const state = observedState('e30=', validBody.byteLength, validHash);
    const originalAtob = globalThis.atob;
    const originalBtoa = globalThis.btoa;
    try {
      vi.stubGlobal('atob', undefined);
      const noAtob = chromeApi(state);
      await expect(
        probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
          chromeApi: noAtob.api,
          createNonce: () => NONCE,
          digestSha256: digest,
        })
      ).resolves.toMatchObject({ success: true, data: { outcomes: ['rejected'] } });

      vi.stubGlobal('atob', originalAtob);
      vi.stubGlobal('btoa', undefined);
      const noBtoa = chromeApi(state);
      await expect(
        probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
          chromeApi: noBtoa.api,
          createNonce: () => NONCE,
          digestSha256: digest,
        })
      ).resolves.toMatchObject({ success: true, data: { outcomes: ['rejected'] } });

      vi.stubGlobal('btoa', originalBtoa);
      vi.stubGlobal('atob', () => {
        throw new Error('synthetic atob failure');
      });
      const throwingAtob = chromeApi(state);
      await expect(
        probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
          chromeApi: throwingAtob.api,
          createNonce: () => NONCE,
          digestSha256: digest,
        })
      ).resolves.toMatchObject({ success: true, data: { outcomes: ['rejected'] } });

      vi.stubGlobal('atob', originalAtob);
      const invalidJson = new TextEncoder().encode('{');
      const invalidJsonState = observedState(
        btoa('{'),
        invalidJson.byteLength,
        await digest(invalidJson)
      );
      const malformed = chromeApi(invalidJsonState);
      await expect(
        probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
          chromeApi: malformed.api,
          createNonce: () => NONCE,
          digestSha256: digest,
        })
      ).resolves.toMatchObject({ success: true, data: { outcomes: ['rejected'] } });
    } finally {
      vi.stubGlobal('atob', originalAtob);
      vi.stubGlobal('btoa', originalBtoa);
    }
  });

  it('rejects a complete MAIN state that is not bound to the requested conversation', async () => {
    const chrome = chromeApi({
      kind: 'complete',
      conversationId: '11111111-2222-3333-4444-555555555555',
      requestedCount: 1,
      dispatchCount: 1,
      outcomes: [{ state: 'http-error' }],
    });
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'resolver-result-invalid' });
  });

  it('keeps a valid metric result when best-effort tab cleanup rejects', async () => {
    const chrome = chromeApi({
      kind: 'complete',
      conversationId: CONVERSATION_ID,
      requestedCount: 1,
      dispatchCount: 1,
      outcomes: [{ state: 'http-error' }],
    });
    chrome.remove.mockRejectedValue(new Error('synthetic cleanup rejection'));
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toMatchObject({ success: true, data: { outcomes: ['http-error'] } });
  });

  it('rejects a valid JSON resolver object without a download URL', async () => {
    const body = new TextEncoder().encode('{}');
    const chrome = chromeApi(observedState(btoa('{}'), body.byteLength, await digest(body)));
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, [PROVIDER_ID], {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        digestSha256: digest,
      })
    ).resolves.toMatchObject({ success: true, data: { outcomes: ['rejected'] } });
  });

  it('reads only exact MAIN snapshots and invokes a nonce-scoped one-shot command fail closed', () => {
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: { kind: 'ready' },
      [`__liskaChatGptActiveResolverCommand_${NONCE}`]: (ids: unknown) =>
        Array.isArray(ids) && ids.length === 1,
    });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({ kind: 'ready' });
    expect(commandChatGptActiveResolver(NONCE, [PROVIDER_ID])).toEqual({ accepted: true });
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: {
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 1,
        outcomes: [{ state: 'rejected', extra: true }],
      },
      [`__liskaChatGptActiveResolverCommand_${NONCE}`]: () => {
        throw new Error('synthetic command failure');
      },
    });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({ kind: 'missing' });
    expect(commandChatGptActiveResolver('short', [PROVIDER_ID])).toEqual({ accepted: false });
    expect(commandChatGptActiveResolver(NONCE, [PROVIDER_ID])).toEqual({ accepted: false });
  });

  it('reads exact error, observed, and non-observed snapshots while containing hostile getters', () => {
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: { kind: 'error', code: 'source-non-json' },
    });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({
      kind: 'error',
      code: 'source-non-json',
    });
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: {
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 2,
        dispatchCount: 2,
        outcomes: [
          {
            state: 'observed',
            capture: {
              bodyBase64: 'e30=',
              byteLength: 2,
              sha256: '0'.repeat(64),
              mediaType: 'application/json',
            },
          },
          { state: 'http-error' },
        ],
      },
    });
    expect(readChatGptActiveResolverState(NONCE)).toMatchObject({
      kind: 'complete',
      outcomes: [{ state: 'observed' }, { state: 'http-error' }],
    });
    vi.stubGlobal('window', {
      get [`__liskaChatGptActiveResolver_${NONCE}`]() {
        throw new Error('synthetic state getter failure');
      },
    });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({ kind: 'missing' });
  });

  it('rejects invalid reader nonce, error code, complete shape, and observed capture shape', () => {
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: { kind: 'error', code: 'unknown-code' },
    });
    expect(readChatGptActiveResolverState('short')).toEqual({ kind: 'missing' });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({ kind: 'missing' });
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: {
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 1,
        outcomes: 'not-an-array',
      },
    });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({ kind: 'missing' });
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: {
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 1,
        outcomes: [{ state: 'observed', capture: null }],
      },
    });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({ kind: 'missing' });
    vi.stubGlobal('window', {
      [`__liskaChatGptActiveResolver_${NONCE}`]: {
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 1,
        outcomes: [
          {
            state: 'observed',
            capture: {
              bodyBase64: 1,
              byteLength: 2,
              sha256: '0'.repeat(64),
              mediaType: 'application/json',
            },
          },
        ],
      },
    });
    expect(readChatGptActiveResolverState(NONCE)).toEqual({ kind: 'missing' });
  });
});
