import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { ARCHIVE_COMPANION_API_TIMEOUT_MS } from '../../src/lib/constants';
import { getDateVariables } from '../../src/lib/path-utils';
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

import {
  handleSaveArchiveCompanion,
  handleSaveStagedArchiveCompanion,
  handleSaveStagedBinaryAsset,
} from '../../src/background/obsidian-handlers';

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
    transport: 'inline',
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

async function stagedRequest() {
  const value = await request();
  return {
    value,
    request: {
      source: 'chatgpt' as const,
      captureId: CAPTURE_ID,
      conversationKey: CONVERSATION_KEY,
      descriptor: {
        assetId: `chatgpt-asset-${'a'.repeat(64)}`,
        byteLength: value.bytes.byteLength,
        sha256: value.artifact.sha256,
        mediaType: 'application/octet-stream',
        relativePath: `assets/${value.artifact.sha256}.bin`,
      },
      blobUrl: 'blob:chrome-extension://test/stage',
    },
  };
}

describe('Obsidian archive companion persistence', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
    expect(mocks.putBinaryFile).toHaveBeenCalledOnce();
    const putArgs = mocks.putBinaryFile.mock.calls[0];
    expect(putArgs?.[0]).toBe(path);
    expect(Array.from(putArgs?.[1] as Uint8Array)).toEqual(Array.from(value.bytes));
    expect(putArgs?.[2]).toBe('application/octet-stream');
    expect(putArgs?.[3]).toBe(ARCHIVE_COMPANION_API_TIMEOUT_MS);
    expect(mocks.getBinaryFile).toHaveBeenCalledWith(path, ARCHIVE_COMPANION_API_TIMEOUT_MS);
    expect(result).toEqual({ success: true });
  });

  it('keeps raw, binary, manifest, and canonical writes under the capture-date prefix across midnight', async () => {
    vi.useFakeTimers();
    const capturedDate = new Date(2026, 0, 31, 23, 59, 0);
    const capturedAt = capturedDate.toISOString();
    vi.setSystemTime(capturedDate);
    const datedSettings = {
      ...settings,
      vaultPath: 'AI/{platform}/{YYYY}/{MM}/{DD}',
    } as ExtensionSettings;
    const value = await request();
    mocks.getBinaryFile.mockResolvedValue(value.bytes);

    await handleSaveArchiveCompanion(datedSettings, {
      ...value,
      capturedAt,
      artifact: {
        ...value.artifact,
        kind: 'raw',
        relativePath: 'responses/conversation.json',
      },
    });

    vi.setSystemTime(new Date(2026, 1, 1, 0, 1, 0));
    const staged = await stagedRequest();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(value.bytes)));
    await handleSaveStagedBinaryAsset(datedSettings, { ...staged.request, capturedAt });
    await handleSaveArchiveCompanion(datedSettings, {
      ...value,
      capturedAt,
      artifact: { ...value.artifact, kind: 'manifest', relativePath: 'manifest.json' },
    });
    await handleSaveArchiveCompanion(datedSettings, { ...value, capturedAt });

    const tokens = getDateVariables(capturedDate);
    const prefix = `AI/chatgpt/${tokens.YYYY}/${tokens.MM}/${tokens.DD}/_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/`;
    const paths = mocks.putBinaryFile.mock.calls.map(call => call[0]);
    expect(paths).toEqual([
      `${prefix}responses/conversation.json`,
      `${prefix}${staged.request.descriptor.relativePath}`,
      `${prefix}manifest.json`,
      `${prefix}canonical/liska-thread-1.json`,
    ]);
  });

  it('resolves one legacy staged archive path before a Blob read crosses midnight', async () => {
    vi.useFakeTimers();
    const beforeMidnight = new Date(2026, 2, 31, 23, 59, 0);
    const afterMidnight = new Date(2026, 3, 1, 0, 1, 0);
    vi.setSystemTime(beforeMidnight);
    const datedSettings = {
      ...settings,
      vaultPath: 'AI/{platform}/{YYYY}/{MM}/{DD}',
    } as ExtensionSettings;
    const value = await request();
    mocks.getBinaryFile.mockResolvedValue(value.bytes);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        vi.setSystemTime(afterMidnight);
        return Promise.resolve(new Response(value.bytes));
      })
    );

    const result = await handleSaveStagedArchiveCompanion(datedSettings, {
      source: 'chatgpt',
      captureId: CAPTURE_ID,
      conversationKey: CONVERSATION_KEY,
      stageId: `archive-stage-${'A'.repeat(32)}`,
      descriptor: {
        kind: 'canonical',
        relativePath: 'canonical/liska-thread-1.json',
        mediaType: 'application/json',
        byteLength: value.bytes.byteLength,
        sha256: value.artifact.sha256,
      },
      blobUrl: 'blob:chrome-extension://test/archive-stage',
    });

    const tokens = getDateVariables(beforeMidnight);
    const path = `AI/chatgpt/${tokens.YYYY}/${tokens.MM}/${tokens.DD}/_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/canonical/liska-thread-1.json`;
    expect(result).toEqual({ success: true });
    expect(mocks.getFile).toHaveBeenCalledTimes(2);
    expect(mocks.getFile).toHaveBeenCalledWith(path);
    expect(mocks.putBinaryFile).toHaveBeenCalledWith(
      path,
      expect.any(Uint8Array),
      'application/octet-stream',
      ARCHIVE_COMPANION_API_TIMEOUT_MS
    );
  });

  it('rechecks the pinned staged path after Blob verification and never overwrites a race winner', async () => {
    const value = await request();
    const path = `AI/chatgpt/_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/canonical/liska-thread-1.json`;
    mocks.getFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('concurrent immutable snapshot');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(value.bytes)));

    const result = await handleSaveStagedArchiveCompanion(settings, {
      source: 'chatgpt',
      captureId: CAPTURE_ID,
      conversationKey: CONVERSATION_KEY,
      stageId: `archive-stage-${'B'.repeat(32)}`,
      descriptor: {
        kind: 'canonical',
        relativePath: 'canonical/liska-thread-1.json',
        mediaType: 'application/json',
        byteLength: value.bytes.byteLength,
        sha256: value.artifact.sha256,
      },
      blobUrl: 'blob:chrome-extension://test/archive-stage-race',
    });

    expect(result).toEqual({ success: false, error: 'archive-obsidian-preflight-existing' });
    expect(mocks.getFile).toHaveBeenNthCalledWith(1, path);
    expect(mocks.getFile).toHaveBeenNthCalledWith(2, path);
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });

  it('routes concurrent captures independently from their own immutable timestamps', async () => {
    const datedSettings = {
      ...settings,
      vaultPath: 'AI/{platform}/{YYYY}/{MM}/{DD}',
    } as ExtensionSettings;
    const value = await request();
    mocks.getBinaryFile.mockResolvedValue(value.bytes);
    const firstDate = new Date(2026, 4, 2, 12, 0, 0);
    const secondDate = new Date(2026, 10, 29, 12, 0, 0);
    const secondCaptureId = 'capture-chatgpt-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    await Promise.all([
      handleSaveArchiveCompanion(datedSettings, {
        ...value,
        capturedAt: firstDate.toISOString(),
      }),
      handleSaveArchiveCompanion(datedSettings, {
        ...value,
        captureId: secondCaptureId,
        capturedAt: secondDate.toISOString(),
      }),
    ]);

    const first = getDateVariables(firstDate);
    const second = getDateVariables(secondDate);
    expect(mocks.putBinaryFile.mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining([
        `AI/chatgpt/${first.YYYY}/${first.MM}/${first.DD}/_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/canonical/liska-thread-1.json`,
        `AI/chatgpt/${second.YYYY}/${second.MM}/${second.DD}/_liska-archive/${CONVERSATION_KEY}/${secondCaptureId}/canonical/liska-thread-1.json`,
      ])
    );
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

  it('preflights and readback-verifies one staged Blob asset without an overwrite', async () => {
    const value = await request();
    const descriptor = {
      assetId: `chatgpt-asset-${'a'.repeat(64)}`,
      byteLength: value.bytes.byteLength,
      sha256: value.artifact.sha256,
      mediaType: 'application/octet-stream',
      relativePath: `assets/${value.artifact.sha256}.bin`,
    };
    const fetchBlob = vi.fn().mockResolvedValue(new Response(value.bytes));
    vi.stubGlobal('fetch', fetchBlob);
    mocks.getBinaryFile.mockResolvedValue(value.bytes);

    const result = await handleSaveStagedBinaryAsset(settings, {
      source: 'chatgpt',
      captureId: CAPTURE_ID,
      conversationKey: CONVERSATION_KEY,
      descriptor,
      blobUrl: 'blob:chrome-extension://test/stage',
    });

    const path = `AI/chatgpt/_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/assets/${value.artifact.sha256}.bin`;
    expect(fetchBlob).toHaveBeenCalledWith('blob:chrome-extension://test/stage');
    expect(mocks.putBinaryFile).toHaveBeenCalledOnce();
    const putArgs = mocks.putBinaryFile.mock.calls[0];
    expect(putArgs?.[0]).toBe(path);
    expect(Array.from(putArgs?.[1] as Uint8Array)).toEqual(Array.from(value.bytes));
    expect(putArgs?.[2]).toBe('application/octet-stream');
    expect(putArgs?.[3]).toBe(ARCHIVE_COMPANION_API_TIMEOUT_MS);
    expect(result).toEqual({ success: true });
  });

  it('does not fetch or overwrite an existing staged asset path', async () => {
    const value = await request();
    const fetchBlob = vi.fn();
    vi.stubGlobal('fetch', fetchBlob);
    mocks.getFile.mockResolvedValueOnce('existing');

    await expect(
      handleSaveStagedBinaryAsset(settings, {
        source: 'chatgpt',
        captureId: CAPTURE_ID,
        conversationKey: CONVERSATION_KEY,
        descriptor: {
          assetId: `chatgpt-asset-${'a'.repeat(64)}`,
          byteLength: value.bytes.byteLength,
          sha256: value.artifact.sha256,
          mediaType: 'application/octet-stream',
          relativePath: `assets/${value.artifact.sha256}.bin`,
        },
        blobUrl: 'blob:chrome-extension://test/stage',
      })
    ).resolves.toEqual({ success: false, error: 'binary-obsidian-preflight-existing' });
    expect(fetchBlob).not.toHaveBeenCalled();
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });

  it('fails closed when staged Blob bytes do not match their descriptor', async () => {
    const staged = await stagedRequest();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([9]))));

    await expect(handleSaveStagedBinaryAsset(settings, staged.request)).resolves.toEqual({
      success: false,
      error: 'binary-obsidian-blob-integrity-failed',
    });
    expect(mocks.putBinaryFile).not.toHaveBeenCalled();
  });

  it('maps staged Blob fetch and PUT failures to fixed diagnostics', async () => {
    const staged = await stagedRequest();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(handleSaveStagedBinaryAsset(settings, staged.request)).resolves.toEqual({
      success: false,
      error: 'binary-obsidian-blob-read-failed',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(staged.value.bytes)));
    mocks.putBinaryFile.mockRejectedValueOnce(new Error('put rejected'));
    await expect(handleSaveStagedBinaryAsset(settings, staged.request)).resolves.toEqual({
      success: false,
      error: 'binary-obsidian-put-failed',
    });
  });

  it('distinguishes missing, wrong-sized, and wrong-hash staged readback', async () => {
    const staged = await stagedRequest();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(staged.value.bytes)))
    );

    mocks.getBinaryFile.mockResolvedValueOnce(null);
    await expect(handleSaveStagedBinaryAsset(settings, staged.request)).resolves.toEqual({
      success: false,
      error: 'binary-obsidian-readback-missing',
    });

    mocks.getBinaryFile.mockResolvedValueOnce(new Uint8Array([1]));
    await expect(handleSaveStagedBinaryAsset(settings, staged.request)).resolves.toEqual({
      success: false,
      error: 'binary-obsidian-readback-size-mismatch',
    });

    mocks.getBinaryFile.mockResolvedValueOnce(
      new Uint8Array(staged.request.descriptor.byteLength).fill(8)
    );
    await expect(handleSaveStagedBinaryAsset(settings, staged.request)).resolves.toEqual({
      success: false,
      error: 'binary-obsidian-readback-hash-mismatch',
    });
  });
});
