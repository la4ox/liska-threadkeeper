import { describe, expect, it } from 'vitest';
import {
  TEXT_PREVIEW_CAPTURE_ACTIONS,
  TEXT_PREVIEW_CONTROL_ACTIONS,
  isTextPreviewStartFailureStep,
  sameTextPreviewPageUrl,
  snapshotTextPreviewControlMessage,
  textPreviewPageUrl,
} from '../../src/lib/text-preview-contract';

const id = '11111111-1111-4111-8111-111111111111';

describe('text preview protocol contracts', () => {
  it('snapshots exact own-data start and source/page commands', () => {
    expect(
      snapshotTextPreviewControlMessage({
        action: 'startTextPreview',
        expectedTarget: { tabId: 7, route: 'https://chatgpt.com/c/thread' },
        branchMode: 'current',
      })
    ).toEqual({
      action: 'startTextPreview',
      expectedTarget: { tabId: 7, route: 'https://chatgpt.com/c/thread' },
      branchMode: 'current',
    });
    expect(
      snapshotTextPreviewControlMessage({
        action: 'ackTextPreviewPayload',
        sessionId: id,
        deliveryId: id,
      })
    ).toEqual({ action: 'ackTextPreviewPayload', sessionId: id, deliveryId: id });
  });

  it.each([
    null,
    { action: 'getTextPreviewStatus', sessionId: id, extra: true },
    Object.assign(Object.create({ inherited: true }), {
      action: 'getTextPreviewStatus',
      sessionId: id,
    }),
    Object.defineProperty({ action: 'getTextPreviewStatus' }, 'sessionId', {
      enumerable: true,
      get: () => id,
    }),
    { action: 'chooseTextPreviewBranch', sessionId: id, selectionId: id, choice: 'all' },
    {
      action: 'startTextPreview',
      expectedTarget: { tabId: 7, route: 'https://chatgpt.com/c/thread', title: 'private' },
      branchMode: 'current',
    },
    {
      action: 'awaitTextPreviewSelection',
      sessionId: id,
      selectionId: id,
      options: [
        {
          ordinal: 1,
          messageCount: 1,
          uniqueMessageCount: 1,
          isCurrent: true,
          privateExtra: 'not admitted',
        },
      ],
    },
  ])('rejects malformed, inherited, accessor, all-branch, or over-keyed command %#', value => {
    expect(snapshotTextPreviewControlMessage(value)).toBeUndefined();
  });

  it('keeps preview action families disjoint and excludes every durable/probe/asset sink', () => {
    expect(
      [...TEXT_PREVIEW_CONTROL_ACTIONS].some(action => TEXT_PREVIEW_CAPTURE_ACTIONS.has(action))
    ).toBe(false);
    expect([...TEXT_PREVIEW_CAPTURE_ACTIONS]).toEqual([
      'captureChatGptConversation',
      'captureChatGptConversationViaOpaqueReplay',
      'beginStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'sealStagedArchiveArtifact',
      'readStagedArchiveArtifact',
      'abortStagedArchiveArtifact',
    ]);
    expect(TEXT_PREVIEW_CAPTURE_ACTIONS.has('probeChatGptOpaqueRequest')).toBe(false);
    expect(TEXT_PREVIEW_CAPTURE_ACTIONS.has('resolveChatGptActiveAsset')).toBe(false);
    expect(TEXT_PREVIEW_CAPTURE_ACTIONS.has('fetchImage')).toBe(false);
    expect(TEXT_PREVIEW_CAPTURE_ACTIONS.has('testConnection')).toBe(false);
    expect(TEXT_PREVIEW_CAPTURE_ACTIONS.has('saveToOutputs')).toBe(false);
    expect(TEXT_PREVIEW_CAPTURE_ACTIONS.has('persistArchiveCompanion')).toBe(false);
    expect(TEXT_PREVIEW_CAPTURE_ACTIONS.has('commitStagedArchiveCompanion')).toBe(false);
  });

  it('admits only fixed value-free startup diagnostic stages', () => {
    expect(isTextPreviewStartFailureStep('navigation-current')).toBe(true);
    expect(isTextPreviewStartFailureStep('private browser detail')).toBe(false);
    expect(isTextPreviewStartFailureStep(undefined)).toBe(false);
  });

  it('puts only the random session ID on the fixed preview URL', () => {
    const runtime = {
      getURL: (path: string) => `chrome-extension://extension/${path}`,
    } as Pick<typeof chrome.runtime, 'getURL'>;
    expect(textPreviewPageUrl(runtime, id)).toBe(
      `chrome-extension://extension/src/text-preview/text-preview.html?session=${id}`
    );
  });

  it('admits only the exact Comet scheme alias for the same preview capability', () => {
    const expected = `chrome-extension://extension/src/text-preview/text-preview.html?session=${id}`;
    const comet = `comet-extension://extension/src/text-preview/text-preview.html?session=${id}`;
    expect(sameTextPreviewPageUrl(expected, expected)).toBe(true);
    expect(sameTextPreviewPageUrl(comet, expected)).toBe(true);
    expect(sameTextPreviewPageUrl(expected, comet)).toBe(true);
  });

  it.each([
    `comet-extension://other/src/text-preview/text-preview.html?session=${id}`,
    `comet-extension://extension/src/text-preview/other.html?session=${id}`,
    `comet-extension://extension/src/text-preview/text-preview.html?session=${id}&extra=1`,
    `comet-extension://extension/src/text-preview/text-preview.html?session=${id}#fragment`,
    `http://extension/src/text-preview/text-preview.html?session=${id}`,
    `other-extension://extension/src/text-preview/text-preview.html?session=${id}`,
    undefined,
  ])('rejects a non-identical preview capability %#', actual => {
    const expected = `chrome-extension://extension/src/text-preview/text-preview.html?session=${id}`;
    expect(sameTextPreviewPageUrl(actual, expected)).toBe(false);
  });
});
