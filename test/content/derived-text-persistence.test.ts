import { describe, expect, it, vi } from 'vitest';
import {
  DERIVED_TEXT_PARTIAL_RECEIPT_WARNING,
  DERIVED_TEXT_PREPARATION_WARNING,
  DERIVED_TEXT_UNKNOWN_DELIVERY_WARNING,
  DERIVED_TEXT_UNAVAILABLE_WARNING,
  DERIVED_TEXT_WRITE_WARNING,
  persistDerivedTextForFile,
} from '../../src/content/derived-text-persistence';
import { buildDerivedTextArtifact } from '../../src/lib/derived-text-presentation-contract';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { sha256Hex } from '../../src/lib/sha256';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type { StructuredPresentationContext } from '../../src/lib/types';

const snapshot = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
const context = (): StructuredPresentationContext => ({
  source: 'chatgpt',
  archive: {} as StructuredPresentationContext['archive'],
  captureId: 'capture-chatgpt-safe',
  conversationKey: 'a'.repeat(64),
  manifest: {} as StructuredPresentationContext['manifest'],
  canonical: {} as StructuredPresentationContext['canonical'],
  targetNodeId: 'target',
  selectedNodeIds: ['target'],
  includeToolContent: false,
});

async function artifact() {
  return buildDerivedTextArtifact('text', { sourceCanonicalSha256: 'b'.repeat(64) }, sha256Hex);
}

describe('derived text File persistence orchestration', () => {
  it('does no work without a structured context', async () => {
    const prepare = vi.fn();
    const send = vi.fn();
    await expect(
      persistDerivedTextForFile(undefined, snapshot, { prepare, send })
    ).resolves.toEqual({
      success: false,
      warnings: [DERIVED_TEXT_UNAVAILABLE_WARNING],
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps preparation failure local', async () => {
    const send = vi.fn();
    await expect(
      persistDerivedTextForFile(context(), snapshot, {
        prepare: async () => {
          throw new Error('private');
        },
        send,
      })
    ).resolves.toEqual({ success: false, warnings: [DERIVED_TEXT_PREPARATION_WARNING] });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one exact File-only guarded message', async () => {
    const built = await artifact();
    const send = vi.fn(async () => ({
      results: [{ destination: 'file', success: true, writeOutcome: { state: 'confirmed' } }],
      allSuccessful: true,
      anySuccessful: true,
    }));
    await expect(
      persistDerivedTextForFile(context(), snapshot, { prepare: async () => built, send })
    ).resolves.toEqual({ success: true, warnings: [] });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      action: 'persistDerivedTextPresentation',
      reportDurableWriteOutcome: true,
      source: 'chatgpt',
      captureId: 'capture-chatgpt-safe',
      conversationKey: 'a'.repeat(64),
      expectedSyncSettingsSnapshot: snapshot,
      artifact: built,
      outputs: ['file'],
    });
  });

  it('keeps a confirmed text with an unconfirmed receipt distinct and never retries', async () => {
    const send = vi.fn(async () => ({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'derived-text-receipt-unconfirmed',
          writeOutcome: { state: 'confirmed' },
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    }));
    await expect(
      persistDerivedTextForFile(context(), snapshot, { prepare: artifact, send })
    ).resolves.toEqual({
      success: false,
      warnings: [DERIVED_TEXT_PARTIAL_RECEIPT_WARNING],
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('reports a valid unknown terminal outcome without retrying', async () => {
    const send = vi.fn(async () => ({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'derived-text-download-unconfirmed',
          writeOutcome: { state: 'unknown' },
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    }));
    await expect(
      persistDerivedTextForFile(context(), snapshot, { prepare: artifact, send })
    ).resolves.toEqual({
      success: false,
      warnings: [DERIVED_TEXT_UNKNOWN_DELIVERY_WARNING],
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('treats malformed and throwing post-dispatch responses as unknown without retrying', async () => {
    for (const send of [
      vi.fn(async () => ({})),
      vi.fn(async () => {
        throw new Error('runtime response unavailable');
      }),
    ]) {
      await expect(
        persistDerivedTextForFile(context(), snapshot, { prepare: artifact, send })
      ).resolves.toEqual({
        success: false,
        warnings: [DERIVED_TEXT_UNKNOWN_DELIVERY_WARNING],
      });
      expect(send).toHaveBeenCalledOnce();
    }
  });

  it('reserves the not-saved warning for pre-dispatch and explicit not-dispatched outcomes', async () => {
    const prepare = vi.fn(artifact);
    const send = vi.fn(async () => ({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'settings-changed',
          writeOutcome: { state: 'not-dispatched' },
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    }));
    await expect(persistDerivedTextForFile(context(), '{}', { prepare, send })).resolves.toEqual({
      success: false,
      warnings: [DERIVED_TEXT_WRITE_WARNING],
    });
    expect(prepare).not.toHaveBeenCalled();
    await expect(
      persistDerivedTextForFile(context(), snapshot, { prepare, send })
    ).resolves.toEqual({ success: false, warnings: [DERIVED_TEXT_WRITE_WARNING] });
    expect(send).toHaveBeenCalledOnce();
  });
});
