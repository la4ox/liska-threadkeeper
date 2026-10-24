import { describe, expect, it, vi } from 'vitest';
import { MAX_EXTENSION_MESSAGE_SIZE } from '../../src/lib/constants';
import { validateMessageContent } from '../../src/background/validation';
import { htmlMessage } from './derived-html-fixture';

describe('derived HTML exact message admission', () => {
  it.each(['chatgpt', 'deepseek'] as const)('accepts the exact %s contract', async source => {
    expect(validateMessageContent(await htmlMessage(source))).toBe(true);
    expect(MAX_EXTENSION_MESSAGE_SIZE).toBe(60 * 1024 * 1024);
  });

  it.each([
    ['source', 'claude'],
    ['captureId', 'capture-plain'],
    ['captureId', 'capture-deepseek-mismatch'],
    ['captureId', 'capture-chatgpt-../escape'],
    ['captureId', `capture-chatgpt-${'a'.repeat(241)}`],
    ['captureId', 1],
    ['conversationKey', 'provider-id'],
    ['conversationKey', 'A'.repeat(64)],
    ['conversationKey', 5],
    ['outputs', []],
    ['outputs', ['file', 'file']],
    ['outputs', ['obsidian']],
    ['outputs', ['clipboard']],
    ['outputs', ['file', 'obsidian']],
    ['outputs', ['file', 'clipboard']],
    ['expectedSyncSettingsSnapshot', '{}'],
    ['expectedSyncSettingsSnapshot', null],
    ['reportDurableWriteOutcome', false],
    ['reportDurableWriteOutcome', undefined],
    ['artifact', null],
  ])('rejects invalid %s=%s', async (key, value) => {
    expect(validateMessageContent({ ...(await htmlMessage()), [key]: value })).toBe(false);
  });

  it.each([
    ['schema', 'unknown'],
    ['transport', 'staged'],
    ['relativePath', 'other.html'],
    ['mediaType', 'text/plain'],
    ['sha256', 'bad'],
    ['byteLength', -1],
    ['bodyBase64', 'AB=='],
    ['rendererVersion', 'other'],
    ['sourceCanonicalSha256', 'bad'],
    ['assetBindingSha256', 'bad'],
  ])('rejects malformed artifact %s', async (key, value) => {
    const message = await htmlMessage();
    expect(
      validateMessageContent({ ...message, artifact: { ...message.artifact, [key]: value } })
    ).toBe(false);
  });

  it.each([
    'action',
    'source',
    'captureId',
    'conversationKey',
    'expectedSyncSettingsSnapshot',
    'artifact',
    'outputs',
    'reportDurableWriteOutcome',
  ])('rejects an accessor %s without invoking it', async key => {
    const message = await htmlMessage();
    const getter = vi.fn(() => 'private getter output');
    Object.defineProperty(message, key, { get: getter, enumerable: true });
    expect(validateMessageContent(message)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects artifact and output accessors before JSON serialization', async () => {
    const message = await htmlMessage();
    const getter = vi.fn();
    const artifact = Object.defineProperty({ ...message.artifact }, 'bodyBase64', {
      get: getter,
      enumerable: true,
    });
    expect(validateMessageContent({ ...message, artifact })).toBe(false);
    const outputs = Object.defineProperty(['file'], '0', { get: getter, enumerable: true });
    expect(validateMessageContent({ ...message, outputs })).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects inherited data, omitted fields, toJSON and symbols without executing hooks', async () => {
    const message = await htmlMessage();
    const hook = vi.fn();
    expect(validateMessageContent(Object.assign(Object.create({ inherited: true }), message))).toBe(
      false
    );
    for (const key of Object.keys(message)) {
      const missing = { ...message } as Record<string, unknown>;
      delete missing[key];
      expect(validateMessageContent(missing)).toBe(false);
    }
    expect(validateMessageContent({ ...message, toJSON: hook })).toBe(false);
    expect(validateMessageContent({ ...message, [Symbol('extra')]: true })).toBe(false);
    expect(validateMessageContent({ ...message, capturedAt: '2026-10-24T00:00:00.000Z' })).toBe(
      false
    );
    expect(
      validateMessageContent({ ...message, outputs: Object.assign(['file'], { toJSON: hook }) })
    ).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });
});
