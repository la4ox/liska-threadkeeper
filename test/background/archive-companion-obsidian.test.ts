import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../../src/lib/image-utils';
import type { ArchiveCompanionArtifact, ExtensionSettings } from '../../src/lib/types';

const mocks = vi.hoisted(() => ({
  getFile: vi.fn(),
  putBinaryFile: vi.fn(),
  getBinaryFile: vi.fn(),
  client: vi.fn(),
}));

vi.mock('../../src/lib/obsidian-api', () => ({
  ObsidianApiClient: mocks.client,
}));

import { handleSaveArchiveCompanion } from '../../src/background/obsidian-handlers';

const CAPTURE_ID = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const CONVERSATION_KEY = 'a'.repeat(64);
const settings = {
  obsidianApiKey: 'a'.repeat(32),
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/{platform}',
} as ExtensionSettings;

async function request() {
  const bytes = new TextEncoder().encode('{"archive":true}');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), value =>
    value.toString(16).padStart(2, '0')
  ).join('');
  const artifact: ArchiveCompanionArtifact = {
    kind: 'canonical',
    relativePath: 'canonical/liska-thread-1.json',
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256,
    bodyBase64: bytesToBase64(bytes),
  };
  return {
    source: 'chatgpt' as const,
    captureId: CAPTURE_ID,
    conversationKey: CONVERSATION_KEY,
    artifact,
    bytes,
  };
}

describe('Obsidian archive companion persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.mockImplementation(function () {
      return {
        getFile: mocks.getFile,
        putBinaryFile: mocks.putBinaryFile,
        getBinaryFile: mocks.getBinaryFile,
      };
    });
    mocks.getFile.mockResolvedValue(null);
    mocks.putBinaryFile.mockResolvedValue(undefined);
  });

  it('writes beside the resolved note folder and verifies a binary readback hash', async () => {
    const value = await request();
    mocks.getBinaryFile.mockResolvedValue(value.bytes);

    const result = await handleSaveArchiveCompanion(settings, value);

    const path = `AI/chatgpt/_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/canonical/liska-thread-1.json`;
    expect(mocks.putBinaryFile).toHaveBeenCalledWith(path, value.bytes, 'application/json');
    expect(mocks.getBinaryFile).toHaveBeenCalledWith(path);
    expect(result).toEqual({ success: true });
  });

  it('never overwrites an existing snapshot', async () => {
    mocks.getFile.mockResolvedValueOnce('existing private archive');
    const result = await handleSaveArchiveCompanion(settings, await request());

    expect(result).toEqual({ success: false, error: 'Archive companion already exists' });
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });

  it('does not claim success when the vault readback does not match', async () => {
    const value = await request();
    mocks.getBinaryFile.mockResolvedValue(new TextEncoder().encode('{"wrong":true}'));

    const result = await handleSaveArchiveCompanion(settings, value);

    expect(result).toEqual({ success: false, error: 'Archive companion verification failed' });
  });

  it('fails closed when the Obsidian API key is missing', async () => {
    const result = await handleSaveArchiveCompanion(
      { ...settings, obsidianApiKey: '' },
      await request()
    );

    expect(result).toEqual({ success: false, error: 'Archive companion write failed' });
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });

  it('does not report success when the vault write throws', async () => {
    mocks.putBinaryFile.mockRejectedValueOnce(new Error('vault write failed'));

    const result = await handleSaveArchiveCompanion(settings, await request());

    expect(result).toEqual({ success: false, error: 'Archive companion write failed' });
    expect(mocks.getBinaryFile).not.toHaveBeenCalled();
  });
});
