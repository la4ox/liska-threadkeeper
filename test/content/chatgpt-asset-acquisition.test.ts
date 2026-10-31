import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive/capture';
import {
  acquireChatGptPageOwnedAssets,
  createChatGptPageOwnedAssetAcquisitionBudget,
  CHATGPT_ASSET_FETCHED_DETAIL,
  CHATGPT_ASSET_FETCH_FAILED_DETAIL,
  CHATGPT_ASSET_HTTP_FAILED_DETAIL,
  CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
} from '../../src/content/capture/chatgpt-asset-acquisition';
import { validChatGptJpegBytes, validChatGptPngBytes } from '../fixtures/chatgpt-image-bytes';
import { validStoredXlsxBytes } from '../fixtures/xlsx-package-bytes';

const CONVERSATION_ID = '11111111-2222-4333-8444-555555555555';
const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

function numericImageUrl(id = 'file-image_123'): string {
  return (
    'https://chatgpt.com/backend-api/estuary/content?' +
    `cid=123456&id=${id}&p=fs&sig=${'a'.repeat(64)}&ts=123456&v=1`
  );
}

function numericEightKeyUrl(id = 'file-image_123'): string {
  return (
    'https://chatgpt.com/backend-api/estuary/content?' +
    `cd=attachment&cid=123456&fn=synthetic-image.png&id=${id}` +
    `&p=fs&sig=${'a'.repeat(64)}&ts=123456&v=1`
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

function zipPrefix(third: number, fourth: number, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x50, 0x4b, third, fourth]);
  return bytes;
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
  it('preserves not-attempted completeness for an empty ledger', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [],
      candidates: [],
      fetcher,
    });
    expect(result).toEqual({ records: [], runtimeAssets: [], completeness: 'not-attempted' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['declined only', [], 'complete'],
    ['declined plus unattempted', [ledger('b')], 'not-attempted'],
    ['declined plus terminal failure', [{ ...ledger('b'), state: 'failed' as const }], 'complete'],
    [
      'declined plus mixed required',
      [ledger('b'), { ...ledger('c'), state: 'failed' as const }],
      'partial',
    ],
  ] as const)(
    'excludes policy-declined assets from %s completeness and network attempts',
    async (_label, required, completeness) => {
      const declined = {
        ...ledger(),
        state: 'declined' as const,
        detail: 'explicit-policy-skipped',
      };
      const fetcher = vi.fn<typeof fetch>();
      const result = await acquireChatGptPageOwnedAssets({
        conversationId: CONVERSATION_ID,
        assets: [declined, ...required],
        candidates: [{ assetId: declined.id, downloadUrl: signedUrl() }],
        fetcher,
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(result.records[0]).toEqual(declined);
      expect(result.runtimeAssets).toEqual([]);
      expect(result.completeness).toBe(completeness);
    }
  );

  it('performs one browser-authenticated same-origin signed GET without exposing credentials', async () => {
    const record = ledger();
    const bytes = validChatGptPngBytes();
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
        credentials: 'include',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
    );
    expect(result.completeness).toBe('complete');
    expect(result.records[0].detail).toBe(CHATGPT_ASSET_FETCHED_DETAIL);
    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      attemptedAt: '2026-08-21T12:00:00.000Z',
      mediaType: 'image/png',
      byteLength: bytes.byteLength,
      detail: CHATGPT_ASSET_FETCHED_DETAIL,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.png$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.runtimeAssets).toHaveLength(1);
    expect([...result.runtimeAssets[0].bytes]).toEqual([...bytes]);
  });

  it('persists structurally validated JPEG bytes with a content-addressed .jpg path', async () => {
    const record = ledger('d', 'image/jpeg');
    const bytes = validChatGptJpegBytes();
    const url = signedUrl();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, 'image/jpeg'));

    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url }],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(result.records[0].detail).toBe(CHATGPT_ASSET_FETCHED_DETAIL);
    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      mediaType: 'image/jpeg',
      byteLength: bytes.byteLength,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.jpg$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect([...result.runtimeAssets[0].bytes]).toEqual([...bytes]);
  });

  it('persists a header-validated passive ZIP with a content-addressed path', async () => {
    const record = ledger('e', 'application/zip');
    const bytes = zipPrefix(0x03, 0x04, 30);
    const url = signedUrl('zip');
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url }],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, 'application/zip')),
      sha256: digest,
    });

    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      mediaType: 'application/zip',
      byteLength: bytes.byteLength,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.zip$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect([...result.runtimeAssets[0].bytes]).toEqual([...bytes]);
  });

  it('persists one size-bound package-validated XLSX without relabeling it as an image', async () => {
    const record = ledger('a', XLSX_MEDIA_TYPE);
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    const url = signedUrl('xlsx');
    const validateXlsxPackage = vi.fn().mockResolvedValue({ ok: true as const });
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [
        {
          assetId: record.id,
          downloadUrl: url,
          expectedByteLength: bytes.byteLength,
          validationProfile: 'ordinary-direct-xlsx',
        },
      ],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, XLSX_MEDIA_TYPE)),
      validateXlsxPackage,
      sha256: digest,
    });

    expect(validateXlsxPackage).toHaveBeenCalledOnce();
    expect(validateXlsxPackage).toHaveBeenCalledWith(bytes);
    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      mediaType: XLSX_MEDIA_TYPE,
      byteLength: bytes.byteLength,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.xlsx$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect([...result.runtimeAssets[0].bytes]).toEqual([...bytes]);
  });

  it('runs real XLSX package admission across acquisition before hashing', async () => {
    const record = ledger('f', XLSX_MEDIA_TYPE);
    const bytes = validStoredXlsxBytes();
    const url = signedUrl('xlsx-default-validator');
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [
        {
          assetId: record.id,
          downloadUrl: url,
          expectedByteLength: bytes.byteLength,
          validationProfile: 'ordinary-direct-xlsx',
        },
      ],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, XLSX_MEDIA_TYPE)),
      sha256: digest,
    });

    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      mediaType: XLSX_MEDIA_TYPE,
      byteLength: bytes.byteLength,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.xlsx$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.runtimeAssets[0].bytes).toEqual(bytes);
  });

  it.each([
    ['missing declared size', undefined, 8],
    ['zero declared size', 0, 8],
    ['declared size mismatch', 7, 8],
    ['declared size above caller cap', 8, 8],
  ] as const)(
    'rejects XLSX with %s before hashing or durable truth',
    async (_label, expectedByteLength, actualByteLength) => {
      const record = ledger('b', XLSX_MEDIA_TYPE);
      const bytes = new Uint8Array(actualByteLength).fill(1);
      const url = signedUrl(`xlsx-${_label}`);
      const hash = vi.fn(digest);
      const validateXlsxPackage = vi.fn().mockResolvedValue({ ok: true as const });
      const result = await acquireChatGptPageOwnedAssets({
        conversationId: CONVERSATION_ID,
        assets: [record],
        candidates: [
          {
            assetId: record.id,
            downloadUrl: url,
            ...(expectedByteLength !== undefined && { expectedByteLength }),
            validationProfile: 'ordinary-direct-xlsx',
          },
        ],
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, XLSX_MEDIA_TYPE)),
        validateXlsxPackage,
        sha256: hash,
        ...(_label === 'declared size above caller cap' && { maxAssetBytes: 7 }),
      });

      expect(result.records[0]).toMatchObject({
        state: 'failed',
        detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
      });
      expect(result.runtimeAssets).toEqual([]);
      expect(hash).not.toHaveBeenCalled();
      expect(validateXlsxPackage).not.toHaveBeenCalled();
    }
  );

  it('rejects an invalid XLSX package after bounded reading and before hashing', async () => {
    const record = ledger('c', XLSX_MEDIA_TYPE);
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const url = signedUrl('invalid-xlsx');
    const hash = vi.fn(digest);
    const validateXlsxPackage = vi
      .fn()
      .mockResolvedValue({ ok: false as const, code: 'invalid-zip' as const });
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [
        {
          assetId: record.id,
          downloadUrl: url,
          expectedByteLength: bytes.byteLength,
          validationProfile: 'ordinary-direct-xlsx',
        },
      ],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, XLSX_MEDIA_TYPE)),
      validateXlsxPackage,
      sha256: hash,
    });

    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    });
    expect(result.runtimeAssets).toEqual([]);
    expect(validateXlsxPackage).toHaveBeenCalledOnce();
    expect(hash).not.toHaveBeenCalled();
  });

  it('rejects an XLSX-only declared size on every non-XLSX candidate before network work', async () => {
    const record = ledger('d', 'image/png');
    const fetcher = vi.fn<typeof fetch>();
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: signedUrl(), expectedByteLength: 123 }],
      fetcher,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    });
  });

  it('preserves legacy passive/interpreter XLSX acquisition when the ordinary profile is absent', async () => {
    const record = ledger('e', XLSX_MEDIA_TYPE);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const url = signedUrl('legacy-xlsx');
    const validateXlsxPackage = vi.fn();
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url }],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, XLSX_MEDIA_TYPE)),
      validateXlsxPackage,
      sha256: digest,
    });

    expect(validateXlsxPackage).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      mediaType: XLSX_MEDIA_TYPE,
      byteLength: bytes.byteLength,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.xlsx$/),
    });
  });

  it('rejects the ordinary XLSX profile on a non-XLSX record before network work', async () => {
    const record = ledger('f', 'image/png');
    const fetcher = vi.fn<typeof fetch>();
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [
        {
          assetId: record.id,
          downloadUrl: signedUrl(),
          expectedByteLength: 123,
          validationProfile: 'ordinary-direct-xlsx',
        },
      ],
      fetcher,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    });
  });

  it.each([
    ['ordinary', zipPrefix(0x03, 0x04, 30)],
    ['empty', zipPrefix(0x05, 0x06, 22)],
  ] as const)('accepts the standard %s ZIP prefix family', async (_family, bytes) => {
    const record = ledger('f', 'application/zip');
    const url = signedUrl(`zip-${_family}`);
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url }],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, 'application/zip')),
      sha256: digest,
    });
    expect(result.records[0].state).toBe('fetched');
  });

  it('rejects MIME-labelled arbitrary ZIP bytes before hashing', async () => {
    const record = ledger('c', 'application/zip');
    const hash = vi.fn(digest);
    const url = signedUrl('false-zip');
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url }],
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(url, new TextEncoder().encode('<html>not a zip</html>'), 'application/zip')
        ),
      sha256: hash,
    });

    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    });
    expect(result.runtimeAssets).toEqual([]);
    expect(hash).not.toHaveBeenCalled();
  });

  it.each([
    ['ordinary', zipPrefix(0x03, 0x04, 29)],
    ['empty', zipPrefix(0x05, 0x06, 21)],
  ] as const)('rejects a truncated %s ZIP-family header before hashing', async (_family, bytes) => {
    const record = ledger('b', 'application/zip');
    const hash = vi.fn(digest);
    const url = signedUrl(`truncated-${_family}-zip`);
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url }],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes, 'application/zip')),
      sha256: hash,
    });

    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    });
    expect(result.runtimeAssets).toEqual([]);
    expect(hash).not.toHaveBeenCalled();
  });

  it.each([
    ['PNG', 'image/png'],
    ['JPEG', 'image/jpeg'],
  ] as const)(
    'rejects MIME-labelled arbitrary bytes before hashing them as %s',
    async (_label, mime) => {
      const record = ledger('x', mime);
      const hash = vi.fn(digest);
      const url = signedUrl(_label.toLowerCase());
      const result = await acquireChatGptPageOwnedAssets({
        conversationId: CONVERSATION_ID,
        assets: [record],
        candidates: [{ assetId: record.id, downloadUrl: url }],
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            response(url, new TextEncoder().encode('<html>not an image</html>'), mime)
          ),
        sha256: hash,
      });

      expect(result.records[0]).toMatchObject({
        state: 'failed',
        detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
      });
      expect(result.runtimeAssets).toEqual([]);
      expect(hash).not.toHaveBeenCalled();
    }
  );

  it('fetches a strict numeric image URL only after its runtime-only opaque key verifies', async () => {
    const record = ledger();
    const bytes = validChatGptPngBytes();
    const url = numericImageUrl();
    const resolverKey = await digest(
      new TextEncoder().encode('liska-chatgpt-resolver/1\u0000file-image_123')
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes));

    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [{ assetId: record.id, downloadUrl: url, resolverKey }],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.records[0]).toMatchObject({
      state: 'fetched',
      detail: CHATGPT_ASSET_FETCHED_DETAIL,
    });
  });

  it('retains numeric eight-key identity when a resolver key is present', async () => {
    const record = ledger();
    const bytes = validChatGptPngBytes();
    const url = numericEightKeyUrl();
    const resolverKey = await digest(
      new TextEncoder().encode('liska-chatgpt-resolver/1\u0000file-image_123')
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(url, bytes));

    await expect(
      acquireChatGptPageOwnedAssets({
        conversationId: CONVERSATION_ID,
        assets: [record],
        candidates: [{ assetId: record.id, downloadUrl: url, resolverKey }],
        fetcher,
        now: () => new Date('2026-08-21T12:00:00.000Z'),
        sha256: digest,
      })
    ).resolves.toMatchObject({ records: [{ state: 'fetched' }] });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps valid unkeyed numeric eight-key URLs on the established generic route', async () => {
    const record = ledger();
    const url = numericEightKeyUrl();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(url, validChatGptPngBytes()));

    await expect(
      acquireChatGptPageOwnedAssets({
        conversationId: CONVERSATION_ID,
        assets: [record],
        candidates: [{ assetId: record.id, downloadUrl: url }],
        fetcher,
        now: () => new Date('2026-08-21T12:00:00.000Z'),
        sha256: digest,
      })
    ).resolves.toMatchObject({ records: [{ state: 'fetched' }] });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects numeric image URLs with missing or mismatched opaque keys before network fetch', async () => {
    const missingKey = ledger('a');
    const wrongKey = ledger('b');
    const fetcher = vi.fn<typeof fetch>();
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [missingKey, wrongKey],
      candidates: [
        { assetId: missingKey.id, downloadUrl: numericImageUrl('file-missing') },
        {
          assetId: wrongKey.id,
          downloadUrl: numericImageUrl('file-wrong'),
          resolverKey: 'a'.repeat(64),
        },
      ],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.records.map(record => record.detail)).toEqual([
      CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
      CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    ]);
  });

  it('rejects a keyed numeric eight-key URL when its opaque key binds another file ID', async () => {
    const record = ledger();
    const fetcher = vi.fn<typeof fetch>();
    const helperAKey = await digest(
      new TextEncoder().encode('liska-chatgpt-resolver/1\u0000file-helper-a')
    );
    const result = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [record],
      candidates: [
        {
          assetId: record.id,
          downloadUrl: numericEightKeyUrl('file-helper-b'),
          resolverKey: helperAKey,
        },
      ],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      state: 'failed',
      detail: CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL,
    });
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

    expect(result.records.map(record => record.detail)).toEqual([
      CHATGPT_ASSET_FETCH_FAILED_DETAIL,
      CHATGPT_ASSET_HTTP_FAILED_DETAIL,
    ]);
    expect(result.records.every(record => record.state !== 'expired')).toBe(true);
    expect(result.completeness).toBe('complete');
  });

  it('leaves unmatched and duplicate candidates not-attempted and reports partial completeness', async () => {
    const matched = ledger('a');
    const unmatched = ledger('b');
    const url = signedUrl();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(url, validChatGptPngBytes()));

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
      .mockResolvedValueOnce(response(firstUrl, validChatGptPngBytes()))
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
      .mockResolvedValueOnce(response(firstUrl, validChatGptPngBytes()))
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
      maxAssetBytes: validChatGptPngBytes().byteLength,
      maxTotalBytes: validChatGptPngBytes().byteLength,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.records.map(record => record.state)).toEqual(['failed', 'not-attempted']);
  });

  it('shares attempt and byte budgets across sequential resolver-family acquisitions', async () => {
    const first = ledger('a');
    const second = ledger('b');
    const firstUrl = signedUrl('a');
    const secondUrl = signedUrl('b');
    const pngBytes = validChatGptPngBytes();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(firstUrl, pngBytes));
    const budget = createChatGptPageOwnedAssetAcquisitionBudget();
    budget.attemptsRemaining = 1;
    budget.bytesRemaining = pngBytes.byteLength;

    const firstResult = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [first],
      candidates: [{ assetId: first.id, downloadUrl: firstUrl }],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
      budget,
    });
    const secondResult = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [second],
      candidates: [{ assetId: second.id, downloadUrl: secondUrl }],
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
      budget,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(firstResult.records[0].state).toBe('fetched');
    expect(secondResult.records[0].state).toBe('not-attempted');
    expect(budget).toEqual({ attemptsRemaining: 0, bytesRemaining: 0 });
  });
});
