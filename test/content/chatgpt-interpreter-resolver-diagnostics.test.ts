import { describe, expect, it, vi } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive';
import {
  applyInterpreterResolverDetails,
  hasInterpreterResolverFailure,
  interpreterResolverFailureDetails,
  interpreterResolverRunFailureDetails,
  isChatGptInterpreterFailureDetail,
} from '../../src/content/capture/chatgpt-interpreter-resolver-diagnostics';
import {
  CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES,
  CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES,
  type ChatGptInterpreterResolverDiagnostic,
  type ChatGptInterpreterResolverErrorCode,
} from '../../src/lib/chatgpt-interpreter-resolver-contract';

const ASSET_ID = `chatgpt-asset-${'a'.repeat(64)}`;
const OTHER_ID = `chatgpt-asset-${'b'.repeat(64)}`;

function record(): RawCaptureAssetRecord {
  return {
    id: ASSET_ID,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: null,
    byteLength: null,
    sha256: null,
    detail: 'raw-inventory-not-attempted',
    sourceRefs: [{ artifactId: 'conversation', rawPointer: '/mapping/message/content/parts/0' }],
  };
}

describe('interpreter resolver archive reason codes', () => {
  it('formats only fixed item reasons and preserves an explicit HTTP status', () => {
    const diagnostics = CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES.map(code => ({
      assetId: ASSET_ID,
      code,
    }));
    const details = interpreterResolverFailureDetails(diagnostics);
    expect(details).toHaveLength(diagnostics.length - 1);
    expect(details.every(item => isChatGptInterpreterFailureDetail(item.detail))).toBe(true);
    expect(details.map(item => item.detail)).not.toContain('interpreter-resolver-resolved');
    expect(
      interpreterResolverFailureDetails([
        { assetId: ASSET_ID, code: 'http-error', httpStatus: 404 },
      ])
    ).toEqual([{ assetId: ASSET_ID, detail: 'interpreter-resolver-http-404' }]);
  });

  it('keeps batch failure distinct from an individual dispatched request', () => {
    const plan = [
      { assetId: ASSET_ID, messageId: 'raw-only-message', sandboxPath: '/mnt/data/private.docx' },
    ];
    for (const code of CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES) {
      const details = interpreterResolverRunFailureDetails(plan, code);
      expect(details).toEqual([{ assetId: ASSET_ID, detail: `interpreter-resolver-run-${code}` }]);
      expect(isChatGptInterpreterFailureDetail(details[0].detail)).toBe(true);
      expect(JSON.stringify(details)).not.toMatch(/raw-only-message|\/mnt\/data\/|private\.docx/);
    }
    expect(() =>
      interpreterResolverRunFailureDetails(
        plan,
        'private provider error' as ChatGptInterpreterResolverErrorCode
      )
    ).toThrow('Invalid interpreter resolver run reason.');
  });

  it('rejects unknown item fields instead of copying a provider body or URL', () => {
    expect(() =>
      interpreterResolverFailureDetails([
        { assetId: ASSET_ID, code: 'http-error', httpStatus: 404, body: 'private response' },
      ] as unknown as ChatGptInterpreterResolverDiagnostic[])
    ).toThrow('Invalid interpreter resolver diagnostic.');
  });

  it.each([
    'interpreter-resolver-resolved',
    'interpreter-resolver-http-0',
    'interpreter-resolver-http-99',
    'interpreter-resolver-http-200',
    'interpreter-resolver-http-600',
    'interpreter-resolver-http-404.5',
    'interpreter-resolver-http-0404',
    'interpreter-resolver-http-404\n',
    'interpreter-resolver-http-404\r\n',
    'interpreter-resolver-http-404\nprivate',
    'interpreter-resolver-run-unknown',
    'interpreter-resolver-file-expired',
    'https://chatgpt.com/backend-api/estuary/content?sig=private',
    null,
  ])('rejects non-contract durable detail %j', detail => {
    expect(isChatGptInterpreterFailureDetail(detail)).toBe(false);
  });

  it('annotates only unresolved ledger records without mutation or fake acquisition evidence', () => {
    const original = record();
    const details = [{ assetId: ASSET_ID, detail: 'interpreter-resolver-http-404' }];
    const result = applyInterpreterResolverDetails([original], details);
    expect(result[0]).toEqual({ ...original, detail: 'interpreter-resolver-http-404' });
    expect(result[0]).toMatchObject({
      state: 'not-attempted',
      attemptedAt: null,
      relativePath: null,
      sha256: null,
    });
    expect(original.detail).toBe('raw-inventory-not-attempted');
    expect(result[0].sourceRefs).not.toBe(original.sourceRefs);
    expect(hasInterpreterResolverFailure(result)).toBe(true);
    expect(hasInterpreterResolverFailure([original])).toBe(false);
  });

  it.each(['fetched', 'failed', 'expired', 'declined'] as const)(
    'never overwrites later %s acquisition evidence',
    state => {
      const acquired = { ...record(), state, detail: 'binary-stage-outcome' };
      expect(
        applyInterpreterResolverDetails(
          [acquired],
          [{ assetId: ASSET_ID, detail: 'interpreter-resolver-http-404' }]
        )
      ).toEqual([acquired]);
      expect(
        hasInterpreterResolverFailure([{ ...acquired, detail: 'interpreter-resolver-http-404' }])
      ).toBe(false);
    }
  );

  it('discards malformed, conflicting, unbound, or excessive diagnostic batches', () => {
    const original = record();
    const valid = { assetId: ASSET_ID, detail: 'interpreter-resolver-http-404' };
    const getter = vi.fn(() => 'private text');
    const withGetter = Object.defineProperty({ assetId: ASSET_ID }, 'detail', {
      get: getter,
      enumerable: true,
    });
    const extra = Object.defineProperty({ ...valid }, 'hidden', { value: 'private text' });
    const symbol = { ...valid, [Symbol('secret')]: 'private text' };
    const batches: unknown[] = [
      undefined,
      {},
      [null],
      [[valid]],
      [valid, { ...valid, detail: 'interpreter-resolver-timed-out' }],
      [{ ...valid, assetId: OTHER_ID }],
      [{ ...valid, assetId: '../private' }],
      [{ ...valid, detail: '/mnt/data/private.docx' }],
      [{ ...valid, providerFileId: 'private' }],
      [withGetter],
      [extra],
      [symbol],
      new Array(21).fill(valid),
      new Proxy([], {
        get() {
          throw new Error('private proxy error');
        },
      }),
    ];
    for (const batch of batches) {
      expect(applyInterpreterResolverDetails([original], batch)).toEqual([original]);
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
