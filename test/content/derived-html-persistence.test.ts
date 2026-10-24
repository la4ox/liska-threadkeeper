import { describe, expect, it, vi } from 'vitest';
import {
  DERIVED_HTML_CLEANUP_WARNING,
  DERIVED_HTML_PARTIAL_RECEIPT_WARNING,
  DERIVED_HTML_PREPARATION_WARNING,
  DERIVED_HTML_UNAVAILABLE_WARNING,
  DERIVED_HTML_WRITE_WARNING,
  persistDerivedHtmlForFile,
} from '../../src/content/derived-html-persistence';
import {
  DERIVED_HTML_RENDERER_VERSION,
  DERIVED_HTML_SCHEMA,
  type DerivedHtmlArtifact,
} from '../../src/lib/derived-presentation-contract';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type {
  DurableMultiOutputResponse,
  StructuredPresentationContext,
} from '../../src/lib/types';

const snapshot = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);

function context(): StructuredPresentationContext {
  return {
    source: 'chatgpt',
    archive: {} as StructuredPresentationContext['archive'],
    captureId: 'capture-chatgpt-safe',
    conversationKey: 'a'.repeat(64),
    manifest: {} as StructuredPresentationContext['manifest'],
    canonical: {} as StructuredPresentationContext['canonical'],
    targetNodeId: 'target',
    selectedNodeIds: ['target'],
    includeToolContent: false,
  };
}

function artifact(overrides: Partial<DerivedHtmlArtifact> = {}): DerivedHtmlArtifact {
  return {
    schema: DERIVED_HTML_SCHEMA,
    transport: 'inline',
    kind: 'html',
    relativePath: 'index.html',
    mediaType: 'text/html',
    byteLength: 1,
    sha256: 'b'.repeat(64),
    rendererVersion: DERIVED_HTML_RENDERER_VERSION,
    sourceCanonicalSha256: 'c'.repeat(64),
    assetBindingSha256: null,
    bodyBase64: 'eA==',
    ...overrides,
  };
}

function response(
  success: boolean,
  options: {
    state?: 'confirmed' | 'unknown' | 'not-dispatched';
    error?: string;
    warning?: string;
    cleanupDeferred?: true;
  } = {}
): DurableMultiOutputResponse {
  return {
    results: [
      {
        destination: 'file',
        success,
        ...(options.error && { error: options.error }),
        ...(options.warning && { warning: options.warning }),
        writeOutcome: {
          state: options.state ?? (success ? 'confirmed' : 'not-dispatched'),
          ...(options.cleanupDeferred && { cleanupDeferred: true }),
        },
      },
    ],
    allSuccessful: success,
    anySuccessful: success,
  };
}

describe('derived HTML File persistence orchestration', () => {
  it('does no preparation or write without a structured context', async () => {
    const prepare = vi.fn();
    const send = vi.fn();
    await expect(
      persistDerivedHtmlForFile(undefined, snapshot, undefined, { prepare, send })
    ).resolves.toEqual({ success: false, warnings: [DERIVED_HTML_UNAVAILABLE_WARNING] });
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('fails before preparation when the settings snapshot is invalid', async () => {
    const prepare = vi.fn();
    const send = vi.fn();
    await expect(
      persistDerivedHtmlForFile(context(), '{}', undefined, { prepare, send })
    ).resolves.toEqual({ success: false, warnings: [DERIVED_HTML_WRITE_WARNING] });
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps preparation failure local and value-free', async () => {
    const send = vi.fn();
    const prepare = vi.fn(async () => {
      throw new Error('private-provider-value');
    });
    const result = await persistDerivedHtmlForFile(context(), snapshot, undefined, {
      prepare,
      send,
    });
    expect(result).toEqual({ success: false, warnings: [DERIVED_HTML_PREPARATION_WARNING] });
    expect(JSON.stringify(result)).not.toContain('private-provider-value');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one exact File-only guarded message after preparation', async () => {
    const built = artifact();
    const prepare = vi.fn(async () => built);
    const send = vi.fn(async () => response(true));
    await expect(
      persistDerivedHtmlForFile(context(), snapshot, undefined, { prepare, send })
    ).resolves.toEqual({ success: true, warnings: [] });
    expect(send).toHaveBeenCalledWith({
      action: 'persistDerivedHtmlPresentation',
      reportDurableWriteOutcome: true,
      source: 'chatgpt',
      captureId: 'capture-chatgpt-safe',
      conversationKey: 'a'.repeat(64),
      expectedSyncSettingsSnapshot: snapshot,
      artifact: built,
      outputs: ['file'],
    });
  });

  it.each([
    undefined,
    {},
    { ...response(true), allSuccessful: false },
    response(true, { state: 'unknown' }),
    { ...response(true), results: [{ ...response(true).results[0], destination: 'obsidian' }] },
  ])('fails closed on an invalid worker response', async workerResponse => {
    const send = vi.fn(async () => workerResponse);
    await expect(
      persistDerivedHtmlForFile(context(), snapshot, undefined, {
        prepare: async () => artifact(),
        send,
      })
    ).resolves.toEqual({ success: false, warnings: [DERIVED_HTML_WRITE_WARNING] });
  });

  it('surfaces confirmed cleanup uncertainty without failing the HTML', async () => {
    const send = vi.fn(async () => response(true, { cleanupDeferred: true }));
    await expect(
      persistDerivedHtmlForFile(context(), snapshot, undefined, {
        prepare: async () => artifact(),
        send,
      })
    ).resolves.toEqual({ success: true, warnings: [DERIVED_HTML_CLEANUP_WARNING] });
  });

  it('reports a confirmed HTML with missing receipt as partial and never retries', async () => {
    const send = vi.fn(async () =>
      response(false, {
        state: 'confirmed',
        error: 'derived-html-receipt-unconfirmed',
        warning: 'private worker wording is not forwarded',
      })
    );
    await expect(
      persistDerivedHtmlForFile(context(), snapshot, undefined, {
        prepare: async () => artifact(),
        send,
      })
    ).resolves.toEqual({ success: false, warnings: [DERIVED_HTML_PARTIAL_RECEIPT_WARNING] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('maps worker failure and thrown transport details to one fixed warning', async () => {
    for (const send of [
      vi.fn(async () => response(false, { error: 'private-background-detail' })),
      vi.fn(async () => {
        throw new Error('private-runtime-detail');
      }),
    ]) {
      const result = await persistDerivedHtmlForFile(context(), snapshot, undefined, {
        prepare: async () => artifact(),
        send,
      });
      expect(result).toEqual({ success: false, warnings: [DERIVED_HTML_WRITE_WARNING] });
      expect(JSON.stringify(result)).not.toContain('private');
    }
  });
});
