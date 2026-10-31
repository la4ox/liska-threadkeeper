import { describe, expect, it, vi } from 'vitest';
import {
  isChatGptActiveAssetPlanItem,
  isChatGptActiveAssetResponse,
  isBoundChatGptActiveAssetResponse,
  activeAssetFailure,
} from '../../src/lib/chatgpt-active-asset-contract';
import { isChatGptActiveResolverResponse } from '../../src/lib/chatgpt-active-resolver-contract';
import {
  activeItem,
  activeSuccess,
  ACTIVE_CONVERSATION_ID,
} from '../fixtures/chatgpt-active-asset';

describe('one-item active asset contract', () => {
  it.each([400, 403, 404, 429, 499])(
    'inherits exact source 4xx status %s',
    async sourceHttpStatus => {
      const response = activeAssetFailure('source-http-4xx', sourceHttpStatus);
      expect(response).toEqual({ success: false, code: 'source-http-4xx', sourceHttpStatus });
      expect(isChatGptActiveAssetResponse(response)).toBe(true);
      expect(
        await isBoundChatGptActiveAssetResponse(response, activeItem(), ACTIVE_CONVERSATION_ID)
      ).toBe(true);
    }
  );

  it('rejects invalid, accessor and smuggled source statuses at the asset boundary', () => {
    const getter = vi.fn(() => 403);
    const accessor = { success: false, code: 'source-http-4xx' };
    Object.defineProperty(accessor, 'sourceHttpStatus', { get: getter });
    const inheritedPrototype = Object.create(null);
    Object.defineProperty(inheritedPrototype, 'sourceHttpStatus', { get: getter });
    const dataGetter = vi.fn(() => activeSuccess().data);
    const ownDataAccessor = { success: true };
    Object.defineProperty(ownDataAccessor, 'data', { get: dataGetter, enumerable: true });
    const inheritedDataPrototype = Object.create(null);
    Object.defineProperty(inheritedDataPrototype, 'data', { get: dataGetter });
    for (const response of [
      accessor,
      Object.assign(Object.create({ sourceHttpStatus: 403 }), {
        success: false,
        code: 'source-http-4xx',
      }),
      ...[399, 500, '403', 403.5, NaN, Infinity, -Infinity, null, undefined].map(
        sourceHttpStatus => ({ success: false, code: 'source-http-4xx', sourceHttpStatus })
      ),
      ...['source-http-error', 'source-http-5xx', 'source-rejected'].map(code => ({
        success: false,
        code,
        sourceHttpStatus: 403,
      })),
      { success: false, code: 'source-http-4xx', sourceHttpStatus: 403, extra: true },
      { success: false, code: 'source-http-4xx', sourceHttpStatus: 403, [Symbol('private')]: true },
      { ...activeSuccess(), sourceHttpStatus: 403 },
      Object.assign(Object.create({ sourceHttpStatus: 403 }), activeSuccess()),
      Object.assign(Object.create(inheritedPrototype), activeSuccess()),
      ownDataAccessor,
      Object.assign(Object.create(inheritedDataPrototype), { success: true }),
      { ...activeSuccess(), data: { ...activeSuccess().data, sourceHttpStatus: 403 } },
    ])
      expect(isChatGptActiveAssetResponse(response)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(dataGetter).not.toHaveBeenCalled();
    expect(() => activeAssetFailure('source-http-error', 403)).toThrow(
      'invalid active resolver source status'
    );
  });
  it.each([
    'source-http-4xx',
    'source-http-5xx',
    'source-http-other',
    'source-response-processing-rejected',
    'source-http-error',
  ] as const)('inherits exact fixed source failures including legacy %s', async code => {
    const response = { success: false, code };
    expect(isChatGptActiveAssetResponse(response)).toBe(true);
    expect(
      await isBoundChatGptActiveAssetResponse(response, activeItem(), ACTIVE_CONVERSATION_ID)
    ).toBe(true);
    for (const extra of [
      { status: 500 },
      { statusText: 'private' },
      { error: 'private' },
      { url: 'https://private.invalid/' },
      { headers: 'private' },
      { body: 'private' },
    ])
      expect(isChatGptActiveAssetResponse({ ...response, ...extra })).toBe(false);
  });

  it('keeps data success separate from the immutable metric contract', async () => {
    const response = activeSuccess();
    expect(isChatGptActiveAssetResponse(response)).toBe(true);
    expect(isChatGptActiveResolverResponse(response)).toBe(false);
    expect(
      await isBoundChatGptActiveAssetResponse(response, activeItem(), ACTIVE_CONVERSATION_ID)
    ).toBe(true);
    expect(isChatGptActiveAssetResponse({ success: true, data: response.data.metrics })).toBe(
      false
    );
  });
  it.each([
    null,
    [],
    {},
    { assetId: 'unsafe', providerFileId: 'file_a' },
    { ...activeItem(), providerFileId: '../file' },
    { ...activeItem(), extra: true },
    [activeItem()],
  ])('rejects invalid item %#', item => expect(isChatGptActiveAssetPlanItem(item)).toBe(false));
  it('requires own data keys without invoking accessors', () => {
    const getter = vi.fn(() => 'private');
    const item = { ...activeItem() };
    Object.defineProperty(item, 'providerFileId', { get: getter });
    expect(isChatGptActiveAssetPlanItem(item)).toBe(false);
    const response = activeSuccess();
    Object.defineProperty(response.data.metrics, 'dispatchCount', { get: getter });
    expect(isChatGptActiveAssetResponse(response)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects hidden data or accessors on the single ordinal array', () => {
    const extra = activeSuccess();
    Object.defineProperty(extra.data.metrics.outcomes, 'private', { value: 'hidden' });
    expect(isChatGptActiveAssetResponse(extra)).toBe(false);
    const accessor = activeSuccess();
    const getter = vi.fn(() => 'observed');
    Object.defineProperty(accessor.data.metrics.outcomes, '0', { get: getter });
    expect(isChatGptActiveAssetResponse(accessor)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects extra keys and ordinal/opaque identity mismatches', () => {
    const valid = activeSuccess();
    for (const value of [
      { ...valid, providerFileId: 'private' },
      { ...valid, data: { ...valid.data, rawBody: 'private' } },
      { ...valid, data: { ...valid.data, assetId: activeItem('b').assetId } },
      {
        ...valid,
        data: { ...valid.data, candidate: { ...valid.data.candidate, secret: 'private' } },
      },
      { ...valid, data: { ...valid.data, candidate: null } },
      { ...valid, data: { ...valid.data, metrics: { ...valid.data.metrics, requestedCount: 2 } } },
    ])
      expect(isChatGptActiveAssetResponse(value)).toBe(false);
  });
  it.each(['different provider', 'different key', 'foreign URL', 'different asset'])(
    'rebinds %s before acquisition',
    async mode => {
      const response = activeSuccess();
      if (mode === 'different provider')
        response.data.candidate!.downloadUrl = activeSuccess(
          activeItem('b')
        ).data.candidate!.downloadUrl;
      if (mode === 'different key') response.data.candidate!.resolverKey = 'b'.repeat(64);
      if (mode === 'foreign URL')
        response.data.candidate!.downloadUrl = 'https://example.invalid/private';
      if (mode === 'different asset') response.data.assetId = activeItem('b').assetId;
      expect(
        await isBoundChatGptActiveAssetResponse(response, activeItem(), ACTIVE_CONVERSATION_ID)
      ).toBe(false);
    }
  );
  it('admits terminal zero-candidate metrics but rejects claimed success without a candidate', () => {
    const response = activeSuccess();
    response.data.candidate = null;
    response.data.metrics.observedCount = 0;
    response.data.metrics.outcomes = ['file-expired'];
    expect(isChatGptActiveAssetResponse(response)).toBe(true);
    expect(JSON.stringify(response)).not.toContain('https://');
    expect(JSON.stringify(response)).not.toContain(activeItem().providerFileId);
  });
});
