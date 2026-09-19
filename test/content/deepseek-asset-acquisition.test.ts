import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive/capture';
import {
  acquireDeepSeekSignedAssets,
  DEEPSEEK_ASSET_FETCHED_DETAIL,
  DEEPSEEK_ASSET_HTTP_FAILED_DETAIL,
  DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL,
  DEEPSEEK_ASSET_SIZE_MISMATCH_DETAIL,
  DEEPSEEK_ASSET_TIMEOUT_DETAIL,
} from '../../src/content/capture/deepseek-asset-acquisition';
import type { DeepSeekSignedAssetCandidate } from '../../src/content/capture/deepseek-asset-resolver';

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function ledger(character = 'a'): RawCaptureAssetRecord {
  return {
    id: `deepseek-asset-${character.repeat(64).slice(0, 64)}`,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: null,
    byteLength: null,
    sha256: null,
    detail: 'metadata-only',
    sourceRefs: [{ artifactId: 'conversation', rawPointer: `/files/${character}` }],
  };
}

function candidate(
  record: RawCaptureAssetRecord,
  declaredByteLength: number | null = null,
  fileId = record.id.slice(-64)
): DeepSeekSignedAssetCandidate {
  return {
    assetId: record.id,
    declaredByteLength,
    downloadUrl:
      'https://files.deepseeksvc.com/api/file?' +
      new URLSearchParams({ file_id: fileId, state: `state-${fileId}`, ty: 'r' }).toString(),
  };
}

function response(
  url: string,
  bytes: Uint8Array,
  mediaType = 'application/octet-stream'
): Response {
  const value = new Response(bytes, {
    status: 200,
    headers: { 'content-type': mediaType, 'content-length': String(bytes.byteLength) },
  });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

describe('DeepSeek signed asset acquisition', () => {
  it('gets exact bytes without credentials and emits a content-addressed .bin record', async () => {
    const record = ledger();
    const bytes = new TextEncoder().encode('x'.repeat(93));
    const resolved = candidate(record, 93);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(resolved.downloadUrl, bytes));

    const result = await acquireDeepSeekSignedAssets({
      assets: [record],
      candidates: [resolved],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      sha256: digest,
    });

    expect(fetcher).toHaveBeenCalledWith(
      resolved.downloadUrl,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
    );
    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      attemptedAt: '2026-09-19T10:00:00.000Z',
      mediaType: 'application/octet-stream',
      byteLength: 93,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.bin$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      detail: DEEPSEEK_ASSET_FETCHED_DETAIL,
    });
    expect([...result.runtimeAssets[0].bytes]).toEqual([...bytes]);
    expect(result.completeness).toBe('complete');
  });

  it.each([
    ['status', () => new Response('no', { status: 403 }), DEEPSEEK_ASSET_HTTP_FAILED_DETAIL],
    [
      'active MIME',
      (url: string) => response(url, new Uint8Array([1]), 'text/html'),
      DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL,
    ],
    [
      'redirected URL',
      () =>
        response(
          'https://files.deepseeksvc.com/api/file?file_id=other&state=x&ty=r',
          new Uint8Array([1])
        ),
      DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL,
    ],
    [
      'empty response URL',
      () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL,
    ],
  ])('fails closed for %s without returning bytes', async (_label, makeResponse, detail) => {
    const record = ledger();
    const resolved = candidate(record, 1);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(makeResponse(resolved.downloadUrl) as Response);
    const result = await acquireDeepSeekSignedAssets({
      assets: [record],
      candidates: [resolved],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      sha256: digest,
    });
    expect(result.records[0]).toMatchObject({ state: 'failed', detail });
    expect(result.runtimeAssets).toEqual([]);
  });

  it('rejects a declared file_size mismatch after bounded reading', async () => {
    const record = ledger();
    const resolved = candidate(record, 93);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(resolved.downloadUrl, new Uint8Array(92)));
    const result = await acquireDeepSeekSignedAssets({
      assets: [record],
      candidates: [resolved],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      sha256: digest,
    });
    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: DEEPSEEK_ASSET_SIZE_MISMATCH_DETAIL,
    });
  });

  it('rejects a forged runtime URL before network access', async () => {
    const record = ledger();
    const forged = { ...candidate(record), downloadUrl: 'https://evil.example/file?x=1' };
    const fetcher = vi.fn<typeof fetch>();
    const result = await acquireDeepSeekSignedAssets({
      assets: [record],
      candidates: [forged],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL,
    });
  });

  it.each([
    [
      'oversized content-length',
      (url: string) => {
        const value = response(url, new Uint8Array([1]));
        value.headers.set('content-length', '5');
        return value;
      },
    ],
    [
      'missing body',
      (url: string) =>
        ({
          ok: true,
          status: 200,
          url,
          headers: new Headers({ 'content-type': 'application/octet-stream' }),
          body: null,
        }) as Response,
    ],
    [
      'missing MIME',
      (url: string) => {
        const value = new Response(new Uint8Array([1]), { status: 200 });
        Object.defineProperty(value, 'url', { value: url });
        return value;
      },
    ],
  ])('rejects %s without a fetched claim', async (_label, makeResponse) => {
    const record = ledger();
    const resolved = candidate(record);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(makeResponse(resolved.downloadUrl));
    const result = await acquireDeepSeekSignedAssets({
      assets: [record],
      candidates: [resolved],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      maxAssetBytes: 4,
    });
    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL,
    });
  });

  it('cancels a stream as soon as its bytes exceed the per-asset bound', async () => {
    const record = ledger();
    const resolved = candidate(record);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(5) })
      .mockResolvedValueOnce({ done: true });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      url: resolved.downloadUrl,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      body: { getReader: () => ({ read, cancel }) } as unknown as ReadableStream<Uint8Array>,
    } as Response);
    const result = await acquireDeepSeekSignedAssets({
      assets: [record],
      candidates: [resolved],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      maxAssetBytes: 4,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.records[0].state).toBe('failed');
  });

  it('fails closed when byte hashing or the attempt clock is unavailable', async () => {
    const hashRecord = ledger('a');
    const hashCandidate = candidate(hashRecord, 1);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(hashCandidate.downloadUrl, new Uint8Array([1])));
    const hashFailure = await acquireDeepSeekSignedAssets({
      assets: [hashRecord],
      candidates: [hashCandidate],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      sha256: () => Promise.reject(new Error('synthetic hash failure')),
    });
    expect(hashFailure.records[0].state).toBe('failed');

    const clockRecord = ledger('b');
    const clockFailure = await acquireDeepSeekSignedAssets({
      assets: [clockRecord],
      candidates: [candidate(clockRecord)],
      fetcher,
      now: () => new Date(Number.NaN),
    });
    expect(clockFailure.records[0].state).toBe('not-attempted');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps an empty unresolved ledger honestly not-attempted', async () => {
    const record = ledger();
    await expect(
      acquireDeepSeekSignedAssets({ assets: [record], candidates: [] })
    ).resolves.toMatchObject({ completeness: 'not-attempted', runtimeAssets: [] });
  });

  it('enforces per-asset and total byte limits without attempting later assets', async () => {
    const first = ledger('a');
    const second = ledger('b');
    const firstCandidate = candidate(first, null);
    const secondCandidate = candidate(second, null);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(firstCandidate.downloadUrl, new Uint8Array(4)))
      .mockResolvedValueOnce(response(secondCandidate.downloadUrl, new Uint8Array(1)));

    const result = await acquireDeepSeekSignedAssets({
      assets: [first, second],
      candidates: [firstCandidate, secondCandidate],
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      sha256: digest,
      maxAssetBytes: 4,
      maxTotalBytes: 4,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.records[0]).toMatchObject({ state: 'fetched' });
    expect(result.records[1].state).toBe('not-attempted');
  });

  it('caps sequential network attempts at twenty', async () => {
    const characters = 'abcdefghijklmnopqrstz'.split('');
    const records = characters.map(ledger);
    const candidates = records.map(record => candidate(record, 1));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(url => Promise.resolve(response(String(url), new Uint8Array([1]))));
    const result = await acquireDeepSeekSignedAssets({
      assets: records,
      candidates,
      fetcher,
      now: () => new Date('2026-09-19T10:00:00.000Z'),
      sha256: digest,
    });
    expect(fetcher).toHaveBeenCalledTimes(20);
    expect(result.records.filter(record => record.state === 'not-attempted')).toHaveLength(1);
  });

  it('aborts a stalled request and records a stable timeout state', async () => {
    vi.useFakeTimers();
    try {
      const record = ledger();
      const resolved = candidate(record, null);
      const fetcher = vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          })
      );
      const pending = acquireDeepSeekSignedAssets({
        assets: [record],
        candidates: [resolved],
        fetcher,
        now: () => new Date('2026-09-19T10:00:00.000Z'),
        timeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await pending;
      expect(result.records[0]).toMatchObject({
        state: 'failed',
        detail: DEEPSEEK_ASSET_TIMEOUT_DETAIL,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
