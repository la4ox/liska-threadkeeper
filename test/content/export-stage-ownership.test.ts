/** No messaging/persistence mocks: exercise the real pre-dispatch scope guard. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  installExportScope,
  clearExportScope,
  prepareRuntimeMessage,
  type ContentExportScope,
} from '../../src/lib/export-operation-scope';
import { sendMessage } from '../../src/lib/messaging';
import { persistVerifiedBinaryAssets } from '../../src/content/staged-binary-persistence';
import { stageArchiveArtifactBytes } from '../../src/content/archive-stage';
import { persistArchiveCompanionArtifacts } from '../../src/content/bootstrap';
import { sha256Hex } from '../../src/lib/binary-asset-contract';
import { createOperationWriteLedger } from '../../src/lib/operation-write-ledger';

let scope: ContentExportScope;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  scope = {
    id: crypto.randomUUID(),
    route: window.location.href,
    abort: new AbortController(),
    closed: false,
  };
  installExportScope(scope);
});
afterEach(() => {
  clearExportScope(scope);
});
describe('temporary-stage pre-dispatch ownership', () => {
  it('Stop after final binary append aborts the exact stage without issuing a commit', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message, callback) => {
      if (message.action === 'appendStagedBinaryAsset') scope.abort.abort();
      callback?.({ success: true });
      return Promise.resolve({ success: true });
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const ledger = createOperationWriteLedger('capture-chatgpt-test');
    await persistVerifiedBinaryAssets({
      source: 'chatgpt',
      captureId: 'capture-chatgpt-test',
      conversationKey: 'a'.repeat(64),
      outputs: ['file'],
      assets: [
        {
          assetId: `chatgpt-asset-${'a'.repeat(64)}`,
          mediaType: 'application/octet-stream',
          bytes,
          byteLength: bytes.length,
          sha256: await sha256Hex(bytes),
        },
      ],
      writeLedger: ledger,
    });
    const requests = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([message]) => message);
    expect(requests.map(message => message.action)).toEqual([
      'beginStagedBinaryAsset',
      'appendStagedBinaryAsset',
      'abortStagedBinaryAsset',
    ]);
    expect(requests[2]).toMatchObject({
      stageId: requests[0].stageId,
      exportOperationId: scope.id,
    });
    expect(ledger.snapshot().observations[0].state).toBe('not-dispatched');
  });
  it('Stop after archive seal retains ownership until the exact cleanup send', async () => {
    const stageId = `archive-stage-${'A'.repeat(32)}`;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message, callback) => {
      if (message.action === 'sealStagedArchiveArtifact') scope.abort.abort();
      const response =
        message.action === 'beginStagedArchiveArtifact'
          ? { success: true, stageId }
          : { success: true };
      callback?.(response);
      return Promise.resolve(response);
    });
    const artifact = await stageArchiveArtifactBytes('raw', new Uint8Array([123, 125]));
    const ledger = createOperationWriteLedger('capture-chatgpt-test');
    await persistArchiveCompanionArtifacts(
      { captureId: 'capture-chatgpt-test', conversationKey: 'a'.repeat(64), artifacts: [artifact] },
      'test.md',
      'chatgpt',
      ['file'],
      ['raw'],
      undefined,
      ledger
    );
    const requests = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([message]) => message);
    expect(requests.map(message => message.action)).toEqual([
      'beginStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'sealStagedArchiveArtifact',
      'abortStagedArchiveArtifact',
    ]);
    expect(requests[3]).toMatchObject({ stageId, exportOperationId: scope.id });
    expect(ledger.snapshot().observations[0].state).toBe('not-dispatched');
  });
  it('a prepared send does not repeat a throwing local guard after ownership transfer', async () => {
    const prepared = prepareRuntimeMessage({ action: 'getSettings' as const });
    scope.abort.abort();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((_message, callback) => {
      callback?.({ success: true });
      return Promise.resolve({ success: true });
    });
    await sendMessage(prepared);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ exportOperationId: scope.id }),
      expect.any(Function)
    );
  });
});
