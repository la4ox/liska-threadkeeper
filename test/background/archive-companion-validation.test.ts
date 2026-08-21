import { describe, expect, it } from 'vitest';
import {
  validateChatGptCaptureSender,
  validateMessageContent,
  validateStagedBinaryAssetSender,
} from '../../src/background/validation';
import { BINARY_STAGE_CHUNK_BYTES } from '../../src/lib/constants';
import { bytesToBase64 } from '../../src/lib/image-utils';

function archiveMessage() {
  return {
    action: 'persistArchiveCompanion' as const,
    noteFileName: 'safe-note.md',
    source: 'chatgpt' as const,
    captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
    conversationKey: 'a'.repeat(64),
    artifact: {
      kind: 'raw' as const,
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json' as const,
      byteLength: 2,
      sha256: 'b'.repeat(64),
      bodyBase64: 'e30=',
    },
    outputs: ['file' as const, 'obsidian' as const],
  };
}

describe('structured archive companion message validation', () => {
  const stagedDescriptor = {
    assetId: `chatgpt-asset-${'a'.repeat(64)}`,
    byteLength: 0,
    sha256: 'b'.repeat(64),
    mediaType: 'application/octet-stream',
    relativePath: `assets/${'b'.repeat(64)}.bin`,
  };

  function stagedBegin() {
    return {
      action: 'beginStagedBinaryAsset' as const,
      source: 'chatgpt' as const,
      stageId: `stage-${'A'.repeat(32)}`,
      descriptor: stagedDescriptor,
    };
  }

  it('accepts an exact output-options update and rejects malformed values', () => {
    expect(
      validateMessageContent({
        action: 'updateOutputOptions',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'updateOutputOptions',
        outputOptions: { obsidian: 'false', file: true, clipboard: false },
      })
    ).toBe(false);
    expect(
      validateMessageContent({
        action: 'updateOutputOptions',
        outputOptions: { obsidian: false, file: true, clipboard: false },
        extra: true,
      })
    ).toBe(false);
  });

  it('accepts the exact one-artifact durable-output contract', () => {
    expect(validateMessageContent(archiveMessage())).toBe(true);
  });

  it('accepts exact staged binary messages and rejects oversized or extra chunks', () => {
    expect(validateMessageContent(stagedBegin())).toBe(true);
    expect(
      validateMessageContent({
        action: 'appendStagedBinaryAsset',
        source: 'chatgpt',
        stageId: `stage-${'A'.repeat(32)}`,
        offset: 0,
        chunkBase64: bytesToBase64(new Uint8Array(BINARY_STAGE_CHUNK_BYTES)),
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'appendStagedBinaryAsset',
        source: 'chatgpt',
        stageId: `stage-${'A'.repeat(32)}`,
        offset: 0,
        chunkBase64: bytesToBase64(new Uint8Array(BINARY_STAGE_CHUNK_BYTES + 1)),
      })
    ).toBe(false);
    expect(validateMessageContent({ ...stagedBegin(), rawProviderId: 'must-not-cross' })).toBe(
      false
    );
  });

  it('validates staged commit and abort outputs without allowing Clipboard or duplicates', () => {
    const commit = {
      action: 'commitStagedBinaryAsset' as const,
      source: 'chatgpt' as const,
      stageId: `stage-${'A'.repeat(32)}`,
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'a'.repeat(64),
      descriptor: stagedDescriptor,
      outputs: ['file' as const, 'obsidian' as const],
    };
    expect(validateMessageContent(commit)).toBe(true);
    expect(validateMessageContent({ ...commit, outputs: ['clipboard'] })).toBe(false);
    expect(validateMessageContent({ ...commit, outputs: ['file', 'file'] })).toBe(false);
    expect(
      validateMessageContent({
        action: 'abortStagedBinaryAsset',
        source: 'chatgpt',
        stageId: `stage-${'A'.repeat(32)}`,
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'abortStagedBinaryAsset',
        source: 'chatgpt',
        stageId: 'unsafe',
      })
    ).toBe(false);
  });

  it('binds every staged action source to its exact ChatGPT sender origin', () => {
    const sender = {
      tab: { url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd' },
    } as chrome.runtime.MessageSender;
    expect(validateStagedBinaryAssetSender(sender, 'chatgpt')).toBe(true);
    expect(validateStagedBinaryAssetSender(sender, 'gemini')).toBe(false);
    expect(
      validateStagedBinaryAssetSender(
        { tab: { url: 'https://chatgpt.com.evil.test/' } } as chrome.runtime.MessageSender,
        'chatgpt'
      )
    ).toBe(false);
    expect(validateStagedBinaryAssetSender({} as chrome.runtime.MessageSender, 'chatgpt')).toBe(
      false
    );
    expect(
      validateStagedBinaryAssetSender(
        { tab: { url: 'not a URL' } } as chrome.runtime.MessageSender,
        'chatgpt'
      )
    ).toBe(false);
  });

  it.each([
    [
      'a traversal note name',
      (message: ReturnType<typeof archiveMessage>) => (message.noteFileName = '../note.md'),
    ],
    [
      'a mismatched kind/path pair',
      (message: ReturnType<typeof archiveMessage>) =>
        (message.artifact.relativePath = 'manifest.json'),
    ],
    [
      'a non-canonical base64 payload',
      (message: ReturnType<typeof archiveMessage>) => (message.artifact.bodyBase64 = 'e30'),
    ],
    [
      'a clipboard destination',
      (message: ReturnType<typeof archiveMessage>) =>
        ((message.outputs as unknown as string[]) = ['clipboard']),
    ],
    [
      'a Windows-unsafe capture id',
      (message: ReturnType<typeof archiveMessage>) => (message.captureId = 'capture:unsafe'),
    ],
  ])('rejects %s', (_label, mutate) => {
    const message = archiveMessage();
    mutate(message);
    expect(validateMessageContent(message)).toBe(false);
  });

  it('rejects extra fields and a raw conversation identifier in the opaque path key', () => {
    const withExtra = { ...archiveMessage(), rawConversationId: 'must-not-cross' };
    expect(validateMessageContent(withExtra)).toBe(false);

    const withRawId = archiveMessage();
    withRawId.conversationKey = '01234567-89ab-4cde-8f01-23456789abcd' as never;
    expect(validateMessageContent(withRawId)).toBe(false);
  });

  it('rejects an archive artifact carrying an unexpected field', () => {
    const message = archiveMessage();
    message.artifact = { ...message.artifact, leakedField: 'must-not-cross' } as never;

    expect(validateMessageContent(message)).toBe(false);
  });

  it('rejects malformed messages before action dispatch', () => {
    expect(validateMessageContent(null)).toBe(false);
    expect(validateMessageContent([])).toBe(false);
    expect(validateMessageContent({ action: 'unknown-action' })).toBe(false);
  });

  it('keeps image fetches on the allow-listed CDN route', () => {
    expect(
      validateMessageContent({ action: 'fetchImage', url: 'https://example.com/image.png' })
    ).toBe(false);
  });

  it('rejects malformed ChatGPT tab and sender URLs', () => {
    const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';

    expect(
      validateChatGptCaptureSender(
        { tab: { url: 'not a URL' } } as chrome.runtime.MessageSender,
        conversationId
      )
    ).toBe(false);
    expect(
      validateChatGptCaptureSender(
        {
          tab: { url: `https://chatgpt.com/c/${conversationId}` },
          url: 'not a URL',
        } as chrome.runtime.MessageSender,
        conversationId
      )
    ).toBe(false);
  });
});
