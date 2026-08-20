import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { ARCHIVE_COMPANION_API_TIMEOUT_MS } from '../../src/lib/constants';
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
    expect(mocks.putBinaryFile).toHaveBeenCalledWith(
      path,
      value.bytes,
      'application/octet-stream',
      ARCHIVE_COMPANION_API_TIMEOUT_MS
    );
    expect(mocks.getBinaryFile).toHaveBeenCalledWith(path, ARCHIVE_COMPANION_API_TIMEOUT_MS);
    expect(result).toEqual({ success: true });
  });

  it('never overwrites an existing snapshot', async () => {
    mocks.getFile.mockResolvedValueOnce('existing private archive');
    const result = await handleSaveArchiveCompanion(settings, await request());

    expect(result).toEqual({ success: false, error: 'archive-obsidian-preflight-existing' });
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });

  it('reports a fixed preflight code when the existence check fails', async () => {
    mocks.getFile.mockRejectedValueOnce(new Error('private vault path must not escape'));

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-preflight-failed',
    });
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });

  it('reports a fixed preflight timeout code', async () => {
    mocks.getFile.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-preflight-timeout',
    });
  });

  it('reports a fixed put code when the vault write fails', async () => {
    mocks.putBinaryFile.mockRejectedValueOnce(new Error('private vault path must not escape'));

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-put-failed',
    });
    expect(mocks.getBinaryFile).not.toHaveBeenCalled();
  });

  it('reports a fixed put timeout code', async () => {
    mocks.putBinaryFile.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-put-timeout',
    });
  });

  it('reports when archive readback is missing', async () => {
    mocks.getBinaryFile.mockResolvedValueOnce(null);

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-readback-missing',
    });
  });

  it('reports when archive readback has a different byte length', async () => {
    mocks.getBinaryFile.mockResolvedValueOnce(new Uint8Array([0]));

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-readback-size-mismatch',
    });
  });

  it('does not claim success when the vault readback hash does not match', async () => {
    const value = await request();
    const mismatched = new Uint8Array(value.bytes);
    mismatched[0] ^= 1;
    mocks.getBinaryFile.mockResolvedValue(mismatched);

    const result = await handleSaveArchiveCompanion(settings, value);

    expect(result).toEqual({ success: false, error: 'archive-obsidian-readback-hash-mismatch' });
  });

  it('reports when archive readback hashing itself fails', async () => {
    const value = await request();
    mocks.getBinaryFile.mockResolvedValue(value.bytes);
    const digest = vi
      .spyOn(globalThis.crypto.subtle, 'digest')
      .mockRejectedValueOnce(new Error('nope'));

    await expect(handleSaveArchiveCompanion(settings, value)).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-readback-hash-failed',
    });
    digest.mockRestore();
  });

  it('reports a fixed readback code when the vault readback fails', async () => {
    mocks.getBinaryFile.mockRejectedValueOnce(new Error('private vault path must not escape'));

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-readback-failed',
    });
  });

  it('reports a fixed readback timeout code', async () => {
    mocks.getBinaryFile.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

    await expect(handleSaveArchiveCompanion(settings, await request())).resolves.toEqual({
      success: false,
      error: 'archive-obsidian-readback-timeout',
    });
  });

  it('fails closed when the Obsidian API key is missing', async () => {
    const result = await handleSaveArchiveCompanion(
      { ...settings, obsidianApiKey: '' },
      await request()
    );

    expect(result).toEqual({ success: false, error: 'archive-obsidian-preflight-failed' });
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });
});
