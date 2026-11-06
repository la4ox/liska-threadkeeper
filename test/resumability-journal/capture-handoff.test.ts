import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCaptureManifest } from '../../src/archive/capture';
import { buildSnapshotCatalog, encodeSnapshotCatalog } from '../../src/archive/catalog';
import { admitCanonicalCatalog } from '../../src/archive/catalog/admission';
import { conversationKeyInput } from '../../src/archive/catalog/conversation-key';
import { admitCatalog } from '../../src/resumability-journal/page/admission';
import {
  prepareChatGptNewCapture,
  type ChatGptNewCaptureRequest,
} from '../../src/resumability-journal/capture-handoff';
import { capturePreparedChatGpt } from '../../src/content/capture/chatgpt-admitted-capture';
import { ChatGptCurrentBranchError } from '../../src/content/capture/chatgpt-current-branch';
import { persistChatGptDestinationHonestAttachments } from '../../src/content/chatgpt-asset-export';
import { adaptChatGptProducerEvidence } from '../../src/resumability-journal/producer-adapter';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
  type ChatGptCaptureResponse,
} from '../../src/lib/chatgpt-capture-contract';
import type { ProducerDestination } from '../../src/lib/chatgpt-producer-evidence';
import { deferred } from '../snapshot-catalog/fixtures';

const conversationId = '11111111-2222-4333-8444-555555555555';
const captureId = 'capture-chatgpt-reserved-1';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sha256 = async (bytes: Uint8Array) => hash(bytes);
const key = `liska-conversation-key/1:${hash(conversationKeyInput('chatgpt', conversationId))}`;
const signal = () => new AbortController().signal;
const clone = <T>(input: T): T => JSON.parse(JSON.stringify(input));
function frozen(input: unknown): boolean {
  return (
    !input ||
    typeof input !== 'object' ||
    (Object.isFrozen(input) && Object.values(input).every(frozen))
  );
}
function freeze<T>(input: T): T {
  if (input && typeof input === 'object') {
    Object.values(input).forEach(freeze);
    Object.freeze(input);
  }
  return input;
}
function request(
  destinations: ProducerDestination[] = ['file', 'obsidian']
): ChatGptNewCaptureRequest {
  return {
    selection: { provider: 'chatgpt', conversationId, conversationKey: key },
    operationId: 'operation-explicit-1',
    attemptId: 'attempt-explicit-1',
    captureId,
    requiredDestinations: destinations,
  };
}
async function catalog() {
  const manifest = buildCaptureManifest({
    provider: 'chatgpt',
    conversationId,
    captureId: 'capture-chatgpt-previous',
    capturedAt: '2026-11-04T00:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: hash(new TextEncoder().encode('{}')),
        endpoint: CHATGPT_CAPTURE_ENDPOINT,
      },
    ],
    assets: [],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'complete',
    },
    warnings: [],
    observedUnknownContentTypes: [],
  });
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return buildSnapshotCatalog({
    files: [
      { relativePath: 'old/manifest.json', byteLength: bytes.length },
      { relativePath: 'old/responses/conversation.json', byteLength: 2 },
    ],
    manifests: [{ relativePath: 'old/manifest.json', bytes }],
    sha256,
  });
}
async function prepare(destinations?: ProducerDestination[]) {
  return prepareChatGptNewCapture(encodeSnapshotCatalog(await catalog()), request(destinations), {
    sha256,
    signal: signal(),
  });
}
function response(text?: string): ChatGptCaptureResponse {
  const bytes = new TextEncoder().encode(
    text ??
      JSON.stringify({
        conversation_id: conversationId,
        title: 'Synthetic',
        current_node: 'a',
        mapping: {
          a: {
            id: 'a',
            parent: null,
            children: [],
            message: {
              id: 'a',
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Synthetic content'] },
            },
          },
        },
      })
  );
  return {
    success: true,
    data: {
      transport: 'inline',
      bodyBase64: btoa(String.fromCharCode(...bytes)),
      byteLength: bytes.length,
      sha256: hash(bytes),
      mediaType: 'application/json',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      routeFamily: 'standard',
      transientAssetResolvers: [],
    },
  };
}

describe('exact canonical catalog to reserved real ChatGPT capture', () => {
  it('shares the page admission and the exact catalog key recipe without changing bytes', async () => {
    const value = await catalog();
    const bytes = encodeSnapshotCatalog(value);
    const ownedHash = vi.fn(sha256);
    const admitted = await admitCanonicalCatalog(bytes, signal(), ownedHash);
    expect(await admitCatalog(bytes, signal(), sha256)).toEqual(admitted);
    expect(Array.from(ownedHash.mock.calls[0][0])).toEqual(Array.from(bytes));
    expect(admitted.identities[0].conversationKey).toBe(key);
    expect(new TextDecoder().decode(conversationKeyInput('chatgpt', conversationId))).toBe(
      JSON.stringify(['liska-conversation-key/1', 'chatgpt', conversationId])
    );
    expect(Array.from(encodeSnapshotCatalog(value))).toEqual(Array.from(bytes));
  });

  it.each(
    ([['file'], ['obsidian'], ['obsidian', 'file']] as ProducerDestination[][]).map(
      destinations => ({ destinations })
    )
  )('runs real capture, normalizer, producer and adapter for %j', async ({ destinations }) => {
    const prepared = await prepare(destinations);
    const requestCapture = vi.fn(async id => {
      expect(id).toBe(conversationId);
      expect(frozen(prepared)).toBe(true);
      expect(prepared.operation.captureId).toBe(captureId);
      expect(prepared.producerIntent.captureId).toBe(captureId);
      return response();
    });
    const result = await capturePreparedChatGpt(prepared, {
      requestCapture,
      now: () => new Date('2026-11-06T12:00:00.000Z'),
    });
    expect(requestCapture).toHaveBeenCalledExactlyOnceWith(conversationId);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(result.operation).toBe(prepared.operation);
    expect(result.producerIntent).toBe(prepared.producerIntent);
    const { archive, archiveCompanion, assetExportContext: context } = result.capture;
    expect(context!.conversationId).toBe(conversationId);
    expect(context!.rawCaptureBundle.manifest).toMatchObject({ conversationId, captureId });
    expect(archive.conversation.id).toBe(conversationId);
    expect(archive.inputs[0].captureId).toBe(captureId);
    expect(archiveCompanion.captureId).toBe(captureId);
    const manifest = archiveCompanion.artifacts.find(item => item.kind === 'manifest')!;
    expect(manifest.transport).toBe('inline');
    if (manifest.transport === 'inline')
      expect(JSON.parse(atob(manifest.bodyBase64))).toMatchObject({ conversationId, captureId });

    const produced = await persistChatGptDestinationHonestAttachments(
      context!,
      archiveCompanion,
      'synthetic.md',
      [...destinations],
      {
        producerIntent: result.producerIntent,
        persistArtifacts: async (companion, _name, _source, outputs, kinds) => ({
          activeOutputs: [...outputs] as ProducerDestination[],
          warnings: [],
          observations: outputs.flatMap(destination =>
            companion.artifacts
              .filter(item => kinds.includes(item.kind))
              .map(item => ({
                destination: destination as ProducerDestination,
                commitment: {
                  relativePath: item.relativePath,
                  byteLength: item.byteLength,
                  sha256: item.sha256,
                },
                observation:
                  destination === 'file'
                    ? {
                        kind: 'browser-download-complete-path-confirmed' as const,
                        observedRelativePath: item.relativePath,
                      }
                    : {
                        kind: 'byte-readback-sha256' as const,
                        byteLength: item.byteLength,
                        sha256: item.sha256,
                      },
              }))
          ),
        }),
      }
    );
    expect(produced.producerReceipts).toHaveLength(destinations.length);
    const adapted = await adaptChatGptProducerEvidence(
      result.operation,
      produced.producerReceipts,
      sha256
    );
    // The real inventory records discovery, not asset acquisition; even zero assets
    // retain not-attempted. This handoff must not manufacture stronger completeness.
    expect(adapted.assessment).toEqual({
      kind: 'insufficient',
      codes: ['completeness-incomplete'],
    });
    expect(adapted.evidence?.binding).toMatchObject({
      operationId: prepared.operation.operationId,
      captureId,
      admission: prepared.operation.admission,
    });
    expect(adapted.evidence?.destinations?.map(item => item.destination).sort()).toEqual(
      [...destinations].sort()
    );
    const missing = clone(produced.producerReceipts!);
    missing[0].observations.forEach(item => delete (item as { observation?: unknown }).observation);
    expect(
      (await adaptChatGptProducerEvidence(result.operation, missing, sha256)).assessment.kind
    ).toBe('insufficient');
    const partial = clone(produced.producerReceipts!);
    (partial[0].completeness as { graph: string }).graph = 'partial';
    expect(
      (await adaptChatGptProducerEvidence(result.operation, partial, sha256)).assessment.kind
    ).toBe('insufficient');
  });

  it('owns bytes, selection, IDs, destinations and dependency references before pending hashing', async () => {
    const bytes = encodeSnapshotCatalog(await catalog());
    const original = bytes.slice();
    const selected = request(['file']);
    const pending = deferred<string>();
    const originalSignal = signal();
    const callback = vi.fn(async (input: Uint8Array, receivedSignal: AbortSignal) => {
      expect(receivedSignal).toBe(originalSignal);
      return callback.mock.calls.length === 1 ? pending.promise : hash(input);
    });
    const dependencies = { sha256: callback, signal: originalSignal };
    const handoff = prepareChatGptNewCapture(bytes, selected, dependencies);
    bytes.fill(0);
    Object.assign(selected.selection, { provider: 'claude', conversationId: 'changed' });
    Object.assign(selected, { operationId: 'changed', attemptId: 'changed', captureId: 'changed' });
    (selected.requiredDestinations as ProducerDestination[]).push('obsidian');
    dependencies.sha256 = vi.fn();
    dependencies.signal = new AbortController().signal;
    pending.resolve(hash(original));
    const prepared = await handoff;
    expect(prepared.operation.operationId).toBe('operation-explicit-1');
    expect(prepared.operation.attemptId).toBe('attempt-explicit-1');
    expect(prepared.producerIntent.requiredDestinations).toEqual(['file']);
    expect(prepared.operation.sourceSelection.catalogSha256).toBe(hash(original));
    expect(callback).toHaveBeenCalledTimes(2);
    expect(dependencies.sha256).not.toHaveBeenCalled();
    const result = await capturePreparedChatGpt(prepared, {
      requestCapture: async () => response(),
    });
    expect(result.capture.archiveCompanion.captureId).toBe(captureId);
  });

  it('snapshots the mandatory request and clock, ignores unsupported capture overrides, and never uses an ID factory', async () => {
    const prepared = await prepare(['file']);
    const pending = deferred<ChatGptCaptureResponse>();
    const entered = deferred<void>();
    const fallback = vi.fn(() => 'capture-chatgpt-unexpected');
    const normalize = vi.fn();
    const requestCapture = vi.fn(async () => {
      expect(frozen(prepared)).toBe(true);
      entered.resolve();
      return pending.promise;
    });
    const dependencies = {
      requestCapture,
      now: () => new Date('2026-11-06T12:00:00.000Z'),
      createCaptureId: fallback,
      normalizeCapture: normalize,
      observeAssetResolvers: true,
    };
    const running = capturePreparedChatGpt(prepared, dependencies);
    dependencies.requestCapture = vi.fn();
    dependencies.now = () => new Date('invalid');
    await entered.promise;
    expect(() =>
      (prepared.producerIntent.requiredDestinations as string[]).push('obsidian')
    ).toThrow();
    expect(() => Object.assign(prepared.operation, { captureId: 'changed' })).toThrow();
    pending.resolve(response());
    const result = await running;
    expect(requestCapture).toHaveBeenCalledOnce();
    expect(dependencies.requestCapture).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
    expect(result.capture.archiveCompanion.capturedAt).toBe('2026-11-06T12:00:00.000Z');
    expect(result.capture.transientAssetCandidates).toEqual([]);
    expect(result.producerIntent.requiredDestinations).toEqual(['file']);
  });

  it.each(['missing', 'nonfunction'])(
    'rejects %s request dependency without runtime fallback',
    async mode => {
      const prepared = await prepare();
      await expect(
        capturePreparedChatGpt(prepared, (mode === 'missing' ? {} : { requestCapture: 1 }) as never)
      ).rejects.toMatchObject({ code: 'capture-failed' });
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('does not acquire a later destination or bound sink facts during pending producer persistence', async () => {
    const prepared = await prepare(['file']);
    const result = await capturePreparedChatGpt(prepared, {
      requestCapture: async () => response(),
    });
    const pending = deferred<void>();
    const entered = deferred<void>();
    const outputs: ProducerDestination[] = ['file'];
    const producing = persistChatGptDestinationHonestAttachments(
      result.capture.assetExportContext!,
      result.capture.archiveCompanion,
      'synthetic.md',
      outputs,
      {
        producerIntent: result.producerIntent,
        persistArtifacts: async (_companion, _name, _source, selected, kinds) => {
          if (kinds.includes('raw')) {
            entered.resolve();
            await pending.promise;
          }
          return {
            activeOutputs: [...selected] as ProducerDestination[],
            warnings: [],
            observations: [],
          };
        },
      }
    );
    await entered.promise;
    outputs.push('obsidian');
    pending.resolve();
    const produced = await producing;
    expect(produced.producerReceipts).toHaveLength(1);
    expect(produced.producerReceipts![0].requestedDestinations).toEqual(['file']);
    expect(produced.producerReceipts![0].intent?.requiredDestinations).toEqual(['file']);
    const adapted = await adaptChatGptProducerEvidence(
      result.operation,
      produced.producerReceipts,
      sha256
    );
    expect(adapted.assessment.kind).toBe('insufficient');
    expect(adapted.evidence?.destinations?.map(item => item.destination)).toEqual(['file']);
  });

  it('bounds identity-hash failure before dispatch, without runtime fallback', async () => {
    const prepared = await prepare();
    const requestCapture = vi.fn();
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      await expect(capturePreparedChatGpt(prepared, { requestCapture })).rejects.toMatchObject({
        name: 'ChatGptCurrentBranchError',
        code: 'capture-integrity-failed',
      });
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
    expect(requestCapture).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects cancellation queued after the final checked hash but before prepare resumes', async () => {
    const abort = new AbortController();
    let calls = 0;
    const callback = vi.fn(async (bytes: Uint8Array) => {
      calls++;
      if (calls === 2) queueMicrotask(() => queueMicrotask(() => abort.abort()));
      return hash(bytes);
    });
    const requestCapture = vi.fn(async () => response());
    const execute = vi.fn((prepared: Parameters<typeof capturePreparedChatGpt>[0]) =>
      capturePreparedChatGpt(prepared, { requestCapture })
    );
    await expect(
      prepareChatGptNewCapture(encodeSnapshotCatalog(await catalog()), request(), {
        sha256: callback,
        signal: abort.signal,
      }).then(execute)
    ).rejects.toMatchObject({ name: 'CaptureHandoffError', code: 'hash-failed' });
    expect(abort.signal.aborted).toBe(true);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it.each([
    ['rejection', undefined, 'runtime-message-failed'],
    ['provider-failure', createChatGptCaptureFailure('request-failed'), 'request-failed'],
    ['malformed', { success: true }, 'capture-response-invalid'],
    ['normalization', response('{'), 'normalization-failed'],
  ])(
    'preserves bounded %s errors without a second request or cleanup',
    async (_mode, value, code) => {
      const prepared = await prepare();
      const requestCapture = vi.fn(async () => {
        if (value === undefined) throw new Error('PRIVATE error');
        return value as ChatGptCaptureResponse;
      });
      const error = await capturePreparedChatGpt(prepared, { requestCapture }).catch(
        reason => reason
      );
      expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('PRIVATE');
      if (code === 'normalization-failed') {
        expect(error.archiveCompanion.captureId).toBe(captureId);
        expect(error.archiveCompanion.artifacts.map((item: { kind: string }) => item.kind)).toEqual(
          ['raw', 'manifest']
        );
      }
      expect(requestCapture).toHaveBeenCalledOnce();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('revalidates immutable operation/intent consistency and provider-aware key before any request', async () => {
    const prepared = await prepare();
    const cases = [
      clone(prepared),
      freeze({
        ...prepared,
        producerIntent: { ...prepared.producerIntent, captureId: 'capture-chatgpt-other' },
      }),
      freeze({ ...prepared, operation: { ...prepared.operation, captureId: 'invalid' } }),
    ];
    const forged = clone(prepared);
    const disguised =
      `liska-conversation-key/1:${hash(new TextEncoder().encode(conversationId))}` as const;
    Object.assign(forged.operation.admission, { conversationKey: disguised });
    Object.assign(forged.producerIntent, { conversationKey: disguised });
    cases.push(freeze(forged));
    const requestCapture = vi.fn();
    for (const value of cases)
      await expect(capturePreparedChatGpt(value, { requestCapture })).rejects.toThrow();
    expect(requestCapture).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('admission rejects before effects', () => {
  it.each([
    { operationId: '' },
    { operationId: 'unsafe operation' },
    { attemptId: '' },
    { captureId: 'capture-legacy' },
    { captureId: 'capture-chatgpt-' },
    { captureId: 'capture-chatgpt-unsafe.id' },
    { captureId: 'capture-chatgpt-' + 'a'.repeat(241) },
    { requiredDestinations: [] },
    { requiredDestinations: ['file', 'file'] },
    { requiredDestinations: ['clipboard'] },
    { selection: { provider: 'claude', conversationId, conversationKey: key } },
    { selection: { provider: 'chatgpt', conversationId: 'not-uuid', conversationKey: key } },
    { selection: { provider: 'chatgpt', conversationId } },
    { selection: { provider: 'chatgpt', conversationId, conversationKey: 'a'.repeat(64) } },
  ])('rejects invalid IDs/selection/destinations %j', async changed => {
    const requestCapture = vi.fn();
    const hashCallback = vi.fn(sha256);
    const value = { ...request(), ...changed } as ChatGptNewCaptureRequest;
    await expect(
      prepareChatGptNewCapture(encodeSnapshotCatalog(await catalog()), value, {
        sha256: hashCallback,
        signal: signal(),
      }).then(prepared => capturePreparedChatGpt(prepared, { requestCapture }))
    ).rejects.toThrow();
    expect(hashCallback).not.toHaveBeenCalled();
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it('rejects missing or mismatched full-triple membership and disguised legacy key recipes', async () => {
    const value = await catalog();
    const chosen = request();
    const legacy = hash(new TextEncoder().encode(conversationId));
    const cases = [
      {
        ...chosen,
        selection: {
          ...chosen.selection,
          conversationKey: `liska-conversation-key/1:${'f'.repeat(64)}`,
        },
      },
      {
        ...chosen,
        selection: { ...chosen.selection, conversationId: '99999999-2222-4333-8444-555555555555' },
      },
    ];
    const requestCapture = vi.fn();
    for (const changed of cases)
      await expect(
        prepareChatGptNewCapture(encodeSnapshotCatalog(value), changed, {
          sha256,
          signal: signal(),
        }).then(prepared => capturePreparedChatGpt(prepared, { requestCapture }))
      ).rejects.toMatchObject({ code: 'selection-mismatch' });
    for (const keyDigest of ['f'.repeat(64), legacy]) {
      value.entries[0].conversationKey = `liska-conversation-key/1:${keyDigest}`;
      const selected = {
        ...chosen,
        selection: { ...chosen.selection, conversationKey: value.entries[0].conversationKey },
      };
      await expect(
        prepareChatGptNewCapture(encodeSnapshotCatalog(value), selected, {
          sha256,
          signal: signal(),
        }).then(prepared => capturePreparedChatGpt(prepared, { requestCapture }))
      ).rejects.toMatchObject({ code: 'selection-mismatch' });
    }
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it('rejects invalid/noncanonical catalog bytes before hashing or requests', async () => {
    const canonical = new TextDecoder().decode(encodeSnapshotCatalog(await catalog()));
    const callback = vi.fn(sha256);
    const requestCapture = vi.fn();
    for (const text of [
      '{}',
      ' ' + canonical,
      '\uFEFF' + canonical,
      canonical.trimEnd(),
      canonical.replace('{', '{"extra":1,'),
    ])
      await expect(
        prepareChatGptNewCapture(new TextEncoder().encode(text), request(), {
          sha256: callback,
          signal: signal(),
        }).then(prepared => capturePreparedChatGpt(prepared, { requestCapture }))
      ).rejects.toMatchObject({ code: 'catalog-invalid' });
    expect(callback).not.toHaveBeenCalled();
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it.each([
    'aborted',
    'cancelled-catalog',
    'cancelled-key',
    'throwing',
    'invalid',
    'mutating-catalog',
    'mutating-key',
  ])('rejects %s hashing without requests', async mode => {
    const abort = new AbortController();
    let calls = 0;
    if (mode === 'aborted') abort.abort();
    const callback = vi.fn(async (bytes: Uint8Array) => {
      calls++;
      const digest = hash(bytes);
      if (mode === 'throwing') throw new Error('PRIVATE');
      if (mode === 'invalid') return 'INVALID';
      if (
        (mode === 'cancelled-catalog' && calls === 1) ||
        (mode === 'cancelled-key' && calls === 2)
      )
        abort.abort();
      if ((mode === 'mutating-catalog' && calls === 1) || (mode === 'mutating-key' && calls === 2))
        bytes.fill(0);
      return digest;
    });
    const requestCapture = vi.fn();
    await expect(
      prepareChatGptNewCapture(encodeSnapshotCatalog(await catalog()), request(), {
        sha256: callback,
        signal: abort.signal,
      }).then(prepared => capturePreparedChatGpt(prepared, { requestCapture }))
    ).rejects.toMatchObject({ code: 'hash-failed' });
    if (mode === 'aborted') expect(callback).not.toHaveBeenCalled();
    expect(requestCapture).not.toHaveBeenCalled();
  });
});
