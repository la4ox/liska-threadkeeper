import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive/capture';
import {
  acquireChatGptPageOwnedAssets,
  CHATGPT_ASSET_FETCHED_DETAIL,
  CHATGPT_ASSET_FETCH_FAILED_DETAIL,
  CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
} from '../../src/content/capture/chatgpt-asset-acquisition';

const CONVERSATION_ID = '11111111-2222-4333-8444-555555555555';

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function signedUrl(id = 'signed-id'): string {
  return (
    'https://chatgpt.com/backend-api/estuary/content?' +
    new URLSearchParams({
      cid: CONVERSATION_ID,
      id,
      p: 'p',
      sig: 'signature',
      ts: 'timestamp',
      v: '1',
    }).toString()
  );
}

function ledger(id = 'a', mediaType: string | null = 'image/png'): RawCaptureAssetRecord {
  return {
    id: `chatgpt-asset-${id.repeat(64).slice(0, 64)}`,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType,
    byteLength: null,
    sha256: null,
    detail: 'raw-inventory-not-attempted',
    sourceRefs: [{ artifactId: 'conversation', rawPointer: '/asset' }],
  };
}

function response(url: string, bytes: Uint8Array, mediaType = 'image/png'): Response {
  const value = new Response(bytes, {
    status: 200,
    headers: { 'content-type': mediaType, 'content-length': String(bytes.byteLength) },
  });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

function responseLike(
  url: string,
  options: {
    headers?: Record<string, string>;
    body?: Response['body'];
    arrayBuffer?: () => Promise<ArrayBuffer>;
  }
): Response {
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ 'content-type': 'image/png', ...(options.headers ?? {}) }),
    body: options.body ?? null,
    arrayBuffer: options.arrayBuffer ?? (() => Promise.resolve(new ArrayBuffer(0))),
  } as Response;
}

describe('ChatGPT page-owned asset acquisition', () => {
  it('performs one credentialless signed GET and returns content-addressed verified bytes', async () => {
    const record = ledger();
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);
    const url = signedUrl();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes));

    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url }],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(fetcher).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
    );
    expect(result.completeness).toBe('complete');
    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      attemptedAt: '2026-08-21T12:00:00.000Z',
      mediaType: 'image/png',
      byteLength: 6,
      detail: CHATGPT_ASSET_FETCHED_DETAIL,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.png$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.runtimeAssets).toHaveLength(1);
    expect([...result.runtimeAssets[0].bytes]).toEqual([...bytes]);
  });

  it('rejects forged URLs, active MIME, and metadata MIME disagreement without leaking URLs', async () => {
    const first = ledger('a');
    const second = ledger('b');
    const third = ledger('c', 'image/png');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(signedUrl('b'), new Uint8Array([1]), 'text/html'))
      .mockResolvedValueOnce(response(signedUrl('c'), new Uint8Array([2]), 'image/jpeg'));

    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [first, second, third],
      candidates: [
        { assetId: first.id, downloadUrl: 'https://attacker.invalid/object' },
        { assetId: second.id, downloadUrl: signedUrl('b') },
        { assetId: third.id, downloadUrl: signedUrl('c') },
      ],
      fetcher,
      sha256: digest,
    });

    expect(result.records.map(record => record.detail)).toEqual([
      CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
      CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
      CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    ]);
    expect(result.runtimeAssets).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('attacker.invalid');
    expect(JSON.stringify(result)).not.toContain('signature');
  });

  it('records ordinary network/HTTP failures as failed, not expired', async () => {
    const first = ledger('a');
    const second = ledger('b');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('missing', { status: 404 }));

    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [first, second],
      candidates: [
        { assetId: first.id, downloadUrl: signedUrl('a') },
        { assetId: second.id, downloadUrl: signedUrl('b') },
      ],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'failed', detail: CHATGPT_ASSET_FETCH_FAILED_DETAIL }),
      ])
    );
    expect(result.records.every(record => record.state !== 'expired')).toBe(true);
    expect(result.completeness).toBe('complete');
  });

  it('leaves unmatched and duplicate candidates not-attempted and reports partial completeness', async () => {
    const matched = ledger('a');
    const unmatched = ledger('b');
    const url = signedUrl();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(url, new Uint8Array([1])));

    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [matched, unmatched],
      candidates: [
        { assetId: matched.id, downloadUrl: url },
        { assetId: matched.id, downloadUrl: url },
        { assetId: 'chatgpt-asset-' + 'f'.repeat(64), downloadUrl: url },
      ],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.records.find(record => record.id === unmatched.id)?.state).toBe('not-attempted');
    expect(result.completeness).toBe('partial');
  });

  it('keeps invalid clocks and malformed or empty signed parameters fail-soft', async () => {
    const invalidClock = ledger('a');
    const emptyParameter = ledger('b');
    const malformedUrl = ledger('c');
    const fetcher = vi.fn<typeof fetch>();
    const emptySig = signedUrl('empty').replace('sig=signature', 'sig=');

    const clockResult = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [invalidClock],
      candidates: [{ assetId: invalidClock.id, downloadUrl: signedUrl() }],
      fetcher,
      now: () => {
        throw new Error('clock unavailable');
      },
      sha256: digest,
    });
    const urlResult = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [emptyParameter, malformedUrl],
      candidates: [
        { assetId: emptyParameter.id, downloadUrl: emptySig },
        { assetId: malformedUrl.id, downloadUrl: 'not a valid absolute URL' },
      ],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(clockResult.records[0].state).toBe('not-attempted');
    expect(urlResult.records.every(record => record.state === 'failed')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds declared, fallback, malformed-stream, and oversized-stream bodies', async () => {
    const declared = ledger('a');
    const fallback = ledger('b');
    const malformed = ledger('c');
    const oversized = ledger('d');
    const readFailure = ledger('e');
    const rejectingCancel = vi.fn().mockRejectedValue(new Error('cancel unavailable'));
    const successfulCancel = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responseLike(signedUrl('a'), { headers: { 'content-length': '2' } }))
      .mockResolvedValueOnce(
        responseLike(signedUrl('b'), {
          arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer),
        })
      )
      .mockResolvedValueOnce(
        responseLike(signedUrl('c'), {
          body: {
            getReader: () => ({
              read: () => Promise.resolve({ done: false, value: {} }),
              cancel: rejectingCancel,
            }),
          } as unknown as ReadableStream<Uint8Array>,
        })
      )
      .mockResolvedValueOnce(
        responseLike(signedUrl('d'), {
          body: {
            getReader: () => ({
              read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) }),
              cancel: successfulCancel,
            }),
          } as unknown as ReadableStream<Uint8Array>,
        })
      )
      .mockResolvedValueOnce(
        responseLike(signedUrl('e'), {
          body: {
            getReader: () => ({
              read: () => Promise.reject(new Error('stream failed')),
              cancel: successfulCancel,
            }),
          } as unknown as ReadableStream<Uint8Array>,
        })
      );

    for (const [index, record] of [
      declared,
      fallback,
      malformed,
      oversized,
      readFailure,
    ].entries()) {
      const result = await acquireChatGptPageOwnedAssets({
        conversationId: CONVERSATION_ID,
        assets: [record],
        candidates: [{ assetId: record.id, downloadUrl: signedUrl(String(index)) }],
        fetcher,
        now: () => new Date('2026-08-21T12:00:00.000Z'),
        sha256: digest,
        maxAssetBytes: 1,
      });
      expect(result.records[0]).toMatchObject({
        state: 'failed',
        detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
      });
    }
    expect(rejectingCancel).toHaveBeenCalled();
    expect(successfulCancel).toHaveBeenCalled();
  });

  it('rejects a non-canonical digest and a fetched asset beyond a stricter total budget', async () => {
    const invalidDigest = ledger('a');
    const overTotal = ledger('b');
    const firstUrl = signedUrl('a');
    const secondUrl = signedUrl('b');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(firstUrl, new Uint8Array([1])))
      .mockResolvedValueOnce(response(secondUrl, new Uint8Array([2])));

    const digestResult = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [invalidDigest],
      candidates: [{ assetId: invalidDigest.id, downloadUrl: firstUrl }],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: () => Promise.reject(new Error('digest unavailable')),
    });
    const totalResult = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [overTotal],
      candidates: [{ assetId: overTotal.id, downloadUrl: secondUrl }],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
      maxTotalBytes: 0,
    });

    expect(digestResult.records[0].detail).toBe(CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL);
    expect(totalResult.records[0].state).toBe('not-attempted');
    expect(totalResult.runtimeAssets).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('charges bounded response bytes even when later integrity validation rejects them', async () => {
    const first = ledger('a');
    const second = ledger('b');
    const firstUrl = signedUrl('a');
    const secondUrl = signedUrl('b');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(firstUrl, new Uint8Array([1])))
      .mockResolvedValueOnce(response(secondUrl, new Uint8Array([2])));

    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [first, second],
      candidates: [
        { assetId: first.id, downloadUrl: firstUrl },
        { assetId: second.id, downloadUrl: secondUrl },
      ],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: () => Promise.resolve('NOT-CANONICAL'),
      maxAssetBytes: 1,
      maxTotalBytes: 1,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.records.map(record => record.state)).toEqual(['failed', 'not-attempted']);
  });
});
