// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptArchivePresentationPreview,
  createPresentationSelection,
} from '../../src/archive/presentation/preview';
import { PRESENTATION_RENDERER_VERSIONS } from '../../src/archive/presentation/presentation-contracts';
import {
  DOCX_LIMITS,
  DOCX_RESULT_SCHEMA,
  type DocxRenderRequest,
  type DocxWorkerSuccess,
} from '../../src/text-preview/docx-contract';
import { renderDocxRequest } from '../../src/text-preview/docx-core';
import {
  docxSha256,
  renderSelectedDocx,
  requireSelectedDocxArtifact,
  type DocxWorker,
} from '../../src/text-preview/docx-renderer';

const fixture = (inertTaggedCodeBlocks = true) => {
  const wire = {
    schema: 'liska-presentation-preview/1',
    sourceCanonicalSha256: 'a'.repeat(64),
    branchTargetNodeId: 'row-3',
    title: 'Title 🦊',
    profile: {
      schema: 'liska-presentation-profile/1',
      includeToolContent: false,
      inertTaggedCodeBlocks,
    },
    rendererVersions: PRESENTATION_RENDERER_VERSIONS,
    rows: ['row-1', 'row-2', 'row-3'].map((nodeId, index) => ({
      nodeId,
      role: index === 1 ? 'assistant' : 'user',
      presentedText: 'Preview only',
      markdownBody: 'Markdown must never render\n\n',
      htmlBody: `<p>HTML ${nodeId}</p>`,
      diagnostics: {
        text: [],
        markdown: [],
        html: index === 0 ? [{ code: 'attachment-unbound', count: 2 }] : [],
      },
    })),
  };
  const preview = adoptArchivePresentationPreview(wire);
  return { wire, preview, selection: createPresentationSelection(preview, ['row-1', 'row-3']) };
};
class FakeWorker implements DocxWorker {
  onmessage: DocxWorker['onmessage'] = null;
  onerror: DocxWorker['onerror'] = null;
  onmessageerror: DocxWorker['onmessageerror'] = null;
  request!: DocxRenderRequest;
  postMessage = vi.fn((request: DocxRenderRequest) => {
    this.request = request;
  });
  terminate = vi.fn();
  send(value: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: value }));
  }
}
function reply(request: DocxRenderRequest): DocxWorkerSuccess {
  return {
    schema: DOCX_RESULT_SCHEMA,
    operationToken: request.operationToken,
    ok: true,
    bytes: new Uint8Array([80, 75, 3, 4, 1, 2, 3]).buffer,
    counts: {
      messageCount: request.rows.length,
      htmlChars: request.rows.reduce((sum, row) => sum + row.htmlBody.length, 0),
      tokens: request.rows.length * 3,
      maxDepth: 1,
      maxListDepth: 0,
      blocks: 2 + request.rows.length * 2,
      runs: 2 + request.rows.length * 2,
      numberingDefinitions: 0,
      links: 0,
      placeholders: 0,
    },
    diagnostics: [],
  };
}
function start(options = {}) {
  const input = fixture();
  const worker = new FakeWorker();
  const factory = vi.fn(() => worker);
  const result = renderSelectedDocx(input.preview, input.selection, {
    workerFactory: factory,
    ...options,
  });
  return { ...input, worker, factory, result };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DOCX page client snapshot, ownership and receipt', () => {
  it('posts only exact ordered noncontiguous selected HTML, synchronously frozen before any await', async () => {
    const input = fixture();
    const before = JSON.stringify(input.preview);
    const selection = JSON.parse(JSON.stringify(input.selection));
    const limits = { maxRows: 2 };
    const worker = new FakeWorker();
    const result = renderSelectedDocx(input.preview, selection, {
      workerFactory: () => worker,
      limits,
    });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.request.rows.map(row => row.htmlBody)).toEqual([
      '<p>HTML row-1</p>',
      '<p>HTML row-3</p>',
    ]);
    expect(Object.keys(worker.request)).toEqual([
      'schema',
      'operationToken',
      'title',
      'rows',
      'limits',
    ]);
    expect(Object.keys(worker.request.rows[0])).toEqual(['role', 'htmlBody']);
    for (const value of [
      worker.request,
      worker.request.rows,
      ...worker.request.rows,
      worker.request.limits,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    selection.messageNodeIds.reverse();
    limits.maxRows = 1;
    input.wire.rows[0].htmlBody = 'mutated caller wire';
    const message = reply(worker.request);
    worker.send(message);
    const artifact = await result;
    expect(artifact.selection.messageNodeIds).toEqual(['row-1', 'row-3']);
    expect(artifact.availableMessageCount).toBe(3);
    expect(artifact.renderedMessageCount).toBe(2);
    expect(artifact.bytes).not.toBe(message.bytes);
    new Uint8Array(message.bytes).fill(0);
    expect(new Uint8Array(artifact.bytes)[0]).toBe(80);
    expect(JSON.stringify(input.preview)).toBe(before);
    for (const value of [
      input.preview,
      input.preview.rows,
      ...input.preview.rows,
      input.preview.profile,
      artifact,
      artifact.receipt,
      artifact.selection,
      artifact.selection.messageNodeIds,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(() => requireSelectedDocxArtifact(artifact)).not.toThrow();
    expect(() => requireSelectedDocxArtifact({ ...artifact })).toThrow('docx-result-invalid');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });
  it('binds canonical, branch, complete profile, selection digest, renderer, counts, diagnostics and exact output hash', async () => {
    const state = start();
    const packed = await renderDocxRequest(state.worker.request);
    state.worker.send(packed);
    const artifact = await state.result;
    const receipt = artifact.receipt;
    expect(receipt).toMatchObject({
      sourceCanonicalSha256: state.preview.sourceCanonicalSha256,
      branchTargetNodeId: state.preview.branchTargetNodeId,
      profile: state.preview.profile,
      rendererVersion: 'liska-selected-docx/1',
      availableMessageCount: 3,
      renderedMessageCount: 2,
      sourceDiagnostics: [{ code: 'attachment-unbound', count: 2 }],
      counts: packed.counts,
      diagnostics: [],
      byteLength: packed.bytes.byteLength,
    });
    expect(receipt.sha256).toBe(
      createHash('sha256').update(Buffer.from(artifact.bytes)).digest('hex')
    );
    expect(receipt.selectionSha256).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            selection: artifact.selection,
            profile: state.preview.profile,
            previewSchema: state.preview.schema,
          })
        )
        .digest('hex')
    );
    expect(JSON.stringify(receipt)).not.toMatch(/saved|delivered|destination|downloadId/);
    const changed = fixture(false);
    const worker = new FakeWorker();
    const next = renderSelectedDocx(changed.preview, changed.selection, {
      workerFactory: () => worker,
    });
    worker.send(reply(worker.request));
    expect((await next).receipt.selectionSha256).not.toBe(receipt.selectionSha256);
  });
  it('rejects unadopted previews and invalid/reversed/rebound/empty selections without spawning', async () => {
    const input = fixture();
    const workerFactory = vi.fn();
    await expect(
      renderSelectedDocx(input.wire as never, input.selection, { workerFactory })
    ).rejects.toThrow('docx-selection-invalid');
    for (const value of [
      { ...input.selection, messageNodeIds: [] },
      { ...input.selection, messageNodeIds: ['row-3', 'row-1'] },
      { ...input.selection, messageNodeIds: ['missing'] },
      { ...input.selection, sourceCanonicalSha256: 'b'.repeat(64) },
      { ...input.selection, branchTargetNodeId: 'row-2' },
      { ...input.selection, extra: true },
    ])
      await expect(renderSelectedDocx(input.preview, value, { workerFactory })).rejects.toThrow(
        'docx-selection-invalid'
      );
    expect(workerFactory).not.toHaveBeenCalled();
  });
  it('checks input limits before the worker and hash errors without leaking exception content', async () => {
    const input = fixture();
    const workerFactory = vi.fn();
    await expect(
      renderSelectedDocx(input.preview, input.selection, { limits: { maxRows: 1 }, workerFactory })
    ).rejects.toThrow('docx-row-limit');
    await expect(
      renderSelectedDocx(input.preview, input.selection, {
        limits: { maxHtmlChars: 1 },
        workerFactory,
      })
    ).rejects.toThrow('docx-html-char-limit');
    expect(workerFactory).not.toHaveBeenCalled();
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('private hashing exception'));
    await expect(docxSha256(new ArrayBuffer(1))).rejects.toThrow('docx-hash-failed');
    const state = start();
    state.worker.send(reply(state.worker.request));
    await expect(state.result).rejects.toThrow('docx-hash-failed');
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('DOCX worker lifecycle, no automatic retries', () => {
  it('supports cancellation before creation and during work, ignores captured late callbacks', async () => {
    const controller = new AbortController();
    controller.abort();
    const before = start({ signal: controller.signal });
    await expect(before.result).rejects.toThrow('docx-cancelled');
    expect(before.factory).not.toHaveBeenCalled();
    const current = new AbortController();
    const state = start({ signal: current.signal });
    const late = state.worker.onmessage!;
    current.abort();
    late(new MessageEvent('message', { data: reply(state.worker.request) }));
    await expect(state.result).rejects.toThrow('docx-cancelled');
    expect(state.factory).toHaveBeenCalledTimes(1);
    expect(state.worker.postMessage).toHaveBeenCalledTimes(1);
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('terminates at a lowering-only deadline and refuses stale replies including wrong operation tokens', async () => {
    vi.useFakeTimers();
    const state = start({ limits: { deadlineMs: 20 } });
    const result = expect(state.result).rejects.toThrow('docx-deadline');
    state.worker.send({
      ...reply(state.worker.request),
      operationToken: '12345678-1234-4234-8234-123456789abc',
    });
    await vi.advanceTimersByTimeAsync(20);
    await result;
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
    expect(state.factory).toHaveBeenCalledTimes(1);
    const next = start();
    next.worker.send({
      ...reply(next.worker.request),
      operationToken: '12345678-1234-4234-8234-123456789abc',
    });
    next.worker.send(reply(next.worker.request));
    expect((await next.result).format).toBe('docx');
  });
  it('keeps cancellation/deadline active during hashing after terminating the worker', async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => new Promise(() => undefined));
    const state = start({ limits: { deadlineMs: 5 } });
    state.worker.send(reply(state.worker.request));
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
    const failed = expect(state.result).rejects.toThrow('docx-deadline');
    await vi.advanceTimersByTimeAsync(5);
    await failed;
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
  });
  it.each(['error', 'messageerror', 'malformed', 'overflow', 'worker-failure'])(
    'fails and terminates exactly once on %s',
    async kind => {
      const state = start();
      if (kind === 'error') state.worker.onerror?.(new Event('error'));
      if (kind === 'messageerror') state.worker.onmessageerror?.(new MessageEvent('messageerror'));
      if (kind === 'malformed')
        state.worker.send({ ...reply(state.worker.request), destination: 'forbidden' });
      if (kind === 'overflow')
        state.worker.send({
          ...reply(state.worker.request),
          bytes: new ArrayBuffer(DOCX_LIMITS.maxOutputBytes + 1),
        });
      if (kind === 'worker-failure')
        state.worker.send({
          schema: DOCX_RESULT_SCHEMA,
          operationToken: state.worker.request.operationToken,
          ok: false,
          error: 'docx-pack-failed',
        });
      const code =
        kind === 'error'
          ? 'docx-worker-failed'
          : kind === 'overflow'
            ? 'docx-output-limit'
            : kind === 'worker-failure'
              ? 'docx-pack-failed'
              : 'docx-result-invalid';
      await expect(state.result).rejects.toThrow(code);
      expect(state.worker.terminate).toHaveBeenCalledTimes(1);
      expect(state.factory).toHaveBeenCalledTimes(1);
      expect(state.worker.postMessage).toHaveBeenCalledTimes(1);
    }
  );
  it('does not retry factory or dispatch failures and rejects unavailable native workers', async () => {
    const input = fixture();
    const failed = vi.fn(() => {
      throw new Error('private factory failure');
    });
    await expect(
      renderSelectedDocx(input.preview, input.selection, { workerFactory: failed })
    ).rejects.toThrow('docx-worker-unavailable');
    expect(failed).toHaveBeenCalledTimes(1);
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error('private dispatch');
    });
    await expect(
      renderSelectedDocx(input.preview, input.selection, { workerFactory: () => worker })
    ).rejects.toThrow('docx-worker-failed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    vi.stubGlobal('Worker', undefined);
    await expect(renderSelectedDocx(input.preview, input.selection)).rejects.toThrow(
      'docx-worker-unavailable'
    );
  });
  it('terminates a worker constructed by a factory that aborts synchronously, without dispatch', async () => {
    const input = fixture();
    const controller = new AbortController();
    const worker = new FakeWorker();
    const result = renderSelectedDocx(input.preview, input.selection, {
      signal: controller.signal,
      workerFactory: () => {
        controller.abort();
        return worker;
      },
    });
    await expect(result).rejects.toThrow('docx-cancelled');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});
