import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  persistArchiveCompanions,
  persistFailedExtractionArchive,
} from '../../src/content/bootstrap';
import type { ArchiveCompanionBundle } from '../../src/lib/types';

const companion: ArchiveCompanionBundle = {
  captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
  conversationKey: 'a'.repeat(64),
  artifacts: [
    {
      kind: 'raw',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'b'.repeat(64),
      bodyBase64: 'e30=',
    },
    {
      kind: 'manifest',
      relativePath: 'manifest.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'c'.repeat(64),
      bodyBase64: 'e30=',
    },
    {
      kind: 'canonical',
      relativePath: 'canonical/liska-thread-1.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'd'.repeat(64),
      bodyBase64: 'e30=',
    },
  ],
};

describe('content archive companion persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes Clipboard and warns when it is the only selected output', async () => {
    const warnings = await persistArchiveCompanions(companion, 'note.md', 'chatgpt', ['clipboard']);

    expect(warnings).toEqual([
      'ChatGPT raw/canonical archive was not saved because only Clipboard is enabled',
    ]);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('persists only raw and manifest when canonical normalization did not complete', async () => {
    const partial: ArchiveCompanionBundle = {
      ...companion,
      artifacts: [companion.artifacts[0], companion.artifacts[1]],
    };
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (response: unknown) => void) => {
        callback?.({
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
    );

    const warnings = await persistArchiveCompanions(partial, 'note.md', 'chatgpt', ['file']);

    expect(warnings).toEqual([]);
    expect(
      vi
        .mocked(chrome.runtime.sendMessage)
        .mock.calls.map(call => (call[0] as { artifact: { kind: string } }).artifact.kind)
    ).toEqual(['raw', 'manifest']);
  });

  it('preserves raw evidence when the rendered fallback also fails', async () => {
    const partial: ArchiveCompanionBundle = {
      ...companion,
      artifacts: [companion.artifacts[0], companion.artifacts[1]],
    };
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (response: unknown) => void) => {
        callback?.({
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
    );

    const status = await persistFailedExtractionArchive(
      {
        success: false,
        error: 'Rendered fallback had no messages',
        archiveCompanion: partial,
      },
      ['file']
    );

    expect(status).toBe('Verified raw capture evidence was saved locally');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('stops later companions for a destination after its manifest write fails', async () => {
    let calls = 0;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (response: unknown) => void) => {
        calls += 1;
        callback?.({
          results: [
            {
              destination: 'file',
              success: calls !== 2,
              ...(calls === 2 && { error: 'Archive companion write failed' }),
            },
          ],
          allSuccessful: calls !== 2,
          anySuccessful: calls !== 2,
        });
      }
    );

    const warnings = await persistArchiveCompanions(companion, 'note.md', 'chatgpt', ['file']);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(chrome.runtime.sendMessage)
        .mock.calls.map(call => (call[0] as { artifact: { kind: string } }).artifact.kind)
    ).toEqual(['raw', 'manifest']);
    expect(warnings).toEqual(['archive manifest companion was not saved to file']);
  });

  it('propagates an allowlisted Obsidian archive diagnostic without arbitrary error text', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (response: unknown) => void) => {
        callback?.({
          results: [
            {
              destination: 'obsidian',
              success: false,
              error: 'archive-obsidian-readback-timeout',
            },
          ],
          allSuccessful: false,
          anySuccessful: false,
        });
      }
    );

    const warnings = await persistArchiveCompanions(companion, 'note.md', 'chatgpt', ['obsidian']);

    expect(warnings).toEqual([
      'raw archive companion was not saved to obsidian (archive-obsidian-readback-timeout)',
    ]);
  });

  it('suppresses arbitrary archive error strings from content warnings', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (response: unknown) => void) => {
        callback?.({
          results: [
            {
              destination: 'obsidian',
              success: false,
              error: 'server said C:/private/vault/secret.json',
            },
          ],
          allSuccessful: false,
          anySuccessful: false,
        });
      }
    );

    const warnings = await persistArchiveCompanions(companion, 'note.md', 'chatgpt', ['obsidian']);

    expect(warnings).toEqual(['raw archive companion was not saved to obsidian']);
  });

  it('continues File independently when Obsidian fails the raw companion', async () => {
    let calls = 0;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (response: unknown) => void) => {
        calls += 1;
        const outputs = calls === 1 ? ['file', 'obsidian'] : ['file'];
        callback?.({
          results: outputs.map(destination => ({
            destination,
            success: destination === 'file',
            ...(destination === 'obsidian' && { error: 'Archive companion write failed' }),
          })),
          allSuccessful: calls !== 1,
          anySuccessful: true,
        });
      }
    );

    const warnings = await persistArchiveCompanions(companion, 'note.md', 'chatgpt', [
      'file',
      'obsidian',
    ]);

    const requests = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(
      call =>
        call[0] as {
          artifact: { kind: string };
          outputs: string[];
        }
    );
    expect(requests).toEqual([
      expect.objectContaining({
        artifact: expect.objectContaining({ kind: 'raw' }),
        outputs: ['file', 'obsidian'],
      }),
      expect.objectContaining({
        artifact: expect.objectContaining({ kind: 'manifest' }),
        outputs: ['file'],
      }),
      expect.objectContaining({
        artifact: expect.objectContaining({ kind: 'canonical' }),
        outputs: ['file'],
      }),
    ]);
    expect(warnings).toEqual(['raw archive companion was not saved to obsidian']);
  });

  it('rejects malformed output result sets with duplicate or missing destinations', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (response: unknown) => void) => {
        callback?.({
          results: [
            { destination: 'file', success: true },
            { destination: 'file', success: true },
          ],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
    );

    const warnings = await persistArchiveCompanions(companion, 'note.md', 'chatgpt', [
      'file',
      'obsidian',
    ]);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(warnings).toEqual([
      'raw archive companion was not saved to file because the extension response was invalid',
      'raw archive companion was not saved to obsidian because the extension response was invalid',
    ]);
  });
});
