import { describe, expect, it, vi } from 'vitest';
import { validateMessageContent } from '../../src/background/validation';
import { textMessage } from './derived-text-fixture';

describe('derived text exact message admission', () => {
  it.each(['chatgpt', 'deepseek'] as const)('accepts the exact %s contract', async source => {
    expect(validateMessageContent(await textMessage(source))).toBe(true);
  });

  it.each([
    ['source', 'claude'],
    ['captureId', 'capture-plain'],
    ['conversationKey', 'A'.repeat(64)],
    ['expectedSyncSettingsSnapshot', '{}'],
    ['outputs', ['obsidian']],
    ['reportDurableWriteOutcome', false],
    ['artifact', null],
  ])('rejects invalid %s', async (key, value) => {
    expect(validateMessageContent({ ...(await textMessage()), [key]: value })).toBe(false);
  });

  it.each([
    ['schema', 'unknown'],
    ['relativePath', 'other.txt'],
    ['mediaType', 'text/html'],
    ['rendererVersion', 'other'],
    ['sourceCanonicalSha256', 'bad'],
    ['sha256', 'bad'],
    ['bodyBase64', 'AB=='],
  ])('rejects malformed artifact %s', async (key, value) => {
    const message = await textMessage();
    expect(
      validateMessageContent({ ...message, artifact: { ...message.artifact, [key]: value } })
    ).toBe(false);
  });

  it('rejects accessors and extra keys without invoking hooks', async () => {
    const message = await textMessage();
    const getter = vi.fn();
    Object.defineProperty(message, 'artifact', { get: getter, enumerable: true });
    expect(validateMessageContent(message)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(validateMessageContent({ ...(await textMessage()), extra: true })).toBe(false);
  });
});
