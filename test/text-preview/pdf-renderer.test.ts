// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptArchivePresentationPreview,
  createPresentationSelection,
} from '../../src/archive/presentation/preview';
import { PRESENTATION_RENDERER_VERSIONS } from '../../src/archive/presentation/presentation-contracts';
import {
  PDF_LIMITS,
  PDF_RESULT_SCHEMA,
  type PdfRenderRequest,
  type PdfWorkerSuccess,
} from '../../src/text-preview/pdf-contract';
import { renderPdfRequest } from '../../src/text-preview/pdf-core';
import {
  pdfSha256,
  renderSelectedPdf,
  requireSelectedPdfArtifact,
  type PdfWorker,
} from '../../src/text-preview/pdf-renderer';

const fixture = (inertTaggedCodeBlocks = true) => {
  const wire = {
    schema: 'liska-presentation-preview/1',
    sourceCanonicalSha256: 'a'.repeat(64),
    branchTargetNodeId: 'row-3',
    title: 'Title ♥',
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
      markdownBody: 'Must never render\n\n',
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
class FakeWorker implements PdfWorker {
  onmessage: PdfWorker['onmessage'] = null;
  onerror: PdfWorker['onerror'] = null;
  onmessageerror: PdfWorker['onmessageerror'] = null;
  request!: PdfRenderRequest;
  postMessage = vi.fn((request: PdfRenderRequest) => {
    this.request = request;
  });
  terminate = vi.fn();
  send(value: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: value }));
  }
}
const reply = (request: PdfRenderRequest): PdfWorkerSuccess => ({
  schema: PDF_RESULT_SCHEMA,
  operationToken: request.operationToken,
  ok: true,
  bytes: new Uint8Array([37, 80, 68, 70, 45, 49]).buffer,
  pageCount: 1,
  counts: {
    messageCount: request.rows.length,
    htmlChars: request.rows.reduce((s, r) => s + r.htmlBody.length, 0),
    codePoints: 100,
    tokens: request.rows.length * 3,
    maxDepth: 1,
    maxListDepth: 0,
    layoutNodes: 12,
    layoutVisits: 6,
    blocks: 2 + request.rows.length * 2,
    runs: 2 + request.rows.length * 2,
    maxPreCodePoints: 0,
    maxPreLineCodePoints: 0,
    links: 0,
    placeholders: 0,
    tabs: 0,
    emojiClusters: 0,
  },
  diagnostics: [],
});
function start(options = {}) {
  const input = fixture(),
    worker = new FakeWorker(),
    factory = vi.fn(() => worker);
  const result = renderSelectedPdf(input.preview, input.selection, {
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
describe('PDF detached selection snapshot and exact receipt', () => {
  it('synchronously snapshots only ordered selected HTML and owns the returned exact bytes', async () => {
    const input = fixture(),
      worker = new FakeWorker(),
      selection = JSON.parse(JSON.stringify(input.selection)),
      limits = { maxRows: 2 };
    const result = renderSelectedPdf(input.preview, selection, {
      workerFactory: () => worker,
      limits,
    });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.request.rows.map(r => r.htmlBody)).toEqual([
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
    for (const v of [
      worker.request,
      worker.request.rows,
      ...worker.request.rows,
      worker.request.limits,
    ])
      expect(Object.isFrozen(v)).toBe(true);
    selection.messageNodeIds.reverse();
    limits.maxRows = 1;
    input.wire.rows[0].htmlBody = 'caller changed';
    const message = reply(worker.request);
    worker.send(message);
    const artifact = await result;
    expect(artifact.selection.messageNodeIds).toEqual(['row-1', 'row-3']);
    expect(artifact.bytes).not.toBe(message.bytes);
    new Uint8Array(message.bytes).fill(0);
    expect(new Uint8Array(artifact.bytes)[0]).toBe(37);
    expect(() => requireSelectedPdfArtifact(artifact)).not.toThrow();
    expect(() => requireSelectedPdfArtifact({ ...artifact })).toThrow('pdf-result-invalid');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('binds full profile/canonical/selection/input, font hashes/layout and exact output while remaining delivery-neutral', async () => {
    const state = start();
    const packed = await renderPdfRequest(state.worker.request);
    state.worker.send(packed);
    const artifact = await state.result,
      receipt = artifact.receipt;
    expect(receipt).toMatchObject({
      sourceCanonicalSha256: state.preview.sourceCanonicalSha256,
      branchTargetNodeId: state.preview.branchTargetNodeId,
      profile: state.preview.profile,
      presentationRendererVersions: state.preview.rendererVersions,
      rendererVersion: 'liska-selected-pdf/1',
      dependencyVersion: 'pdfmake/0.3.13',
      layoutProfile: 'liska-pdf-a4-portrait/1',
      fontPolicy: 'liska-pdf-roboto-noto-emoji/1',
      availableMessageCount: 3,
      renderedMessageCount: 2,
      sourceDiagnostics: [{ code: 'attachment-unbound', count: 2 }],
      pageCount: packed.pageCount,
      counts: packed.counts,
      diagnostics: packed.diagnostics,
      byteLength: packed.bytes.byteLength,
    });
    expect(receipt.sha256).toBe(
      createHash('sha256').update(Buffer.from(artifact.bytes)).digest('hex')
    );
    expect(receipt.inputSha256).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            schema: state.worker.request.schema,
            title: state.worker.request.title,
            rows: state.worker.request.rows,
          })
        )
        .digest('hex')
    );
    expect(receipt.selectionSha256).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            selection: artifact.selection,
            profile: state.preview.profile,
            previewSchema: state.preview.schema,
            presentationRendererVersions: state.preview.rendererVersions,
          })
        )
        .digest('hex')
    );
    expect(JSON.stringify(receipt)).not.toMatch(/saved|delivered|destination|downloadId/);
    expect(Object.keys(receipt.fontSha256)).toHaveLength(5);
    const changed = fixture(false),
      worker = new FakeWorker();
    const next = renderSelectedPdf(changed.preview, changed.selection, {
      workerFactory: () => worker,
    });
    worker.send(reply(worker.request));
    expect((await next).receipt.selectionSha256).not.toBe(receipt.selectionSha256);
  });
  it('rejects invalid previews/selections/input ceilings before dispatch', async () => {
    const input = fixture(),
      workerFactory = vi.fn();
    await expect(
      renderSelectedPdf(input.wire as never, input.selection, { workerFactory })
    ).rejects.toThrow('pdf-selection-invalid');
    for (const selection of [
      { ...input.selection, messageNodeIds: [] },
      { ...input.selection, messageNodeIds: ['row-3', 'row-1'] },
      { ...input.selection, messageNodeIds: ['missing'] },
      { ...input.selection, sourceCanonicalSha256: 'b'.repeat(64) },
      { ...input.selection, branchTargetNodeId: 'row-2' },
      { ...input.selection, extra: true },
    ])
      await expect(renderSelectedPdf(input.preview, selection, { workerFactory })).rejects.toThrow(
        'pdf-selection-invalid'
      );
    await expect(
      renderSelectedPdf(input.preview, input.selection, { limits: { maxRows: 1 }, workerFactory })
    ).rejects.toThrow('pdf-row-limit');
    await expect(
      renderSelectedPdf(input.preview, input.selection, {
        limits: { maxHtmlChars: 1 },
        workerFactory,
      })
    ).rejects.toThrow('pdf-html-char-limit');
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
describe('PDF bounded worker lifetime', () => {
  it('cancels before creation or during work without retries or adopting late callbacks', async () => {
    const before = new AbortController();
    before.abort();
    const a = start({ signal: before.signal });
    await expect(a.result).rejects.toThrow('pdf-cancelled');
    expect(a.factory).not.toHaveBeenCalled();
    const current = new AbortController(),
      state = start({ signal: current.signal }),
      late = state.worker.onmessage!;
    current.abort();
    late(new MessageEvent('message', { data: reply(state.worker.request) }));
    await expect(state.result).rejects.toThrow('pdf-cancelled');
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
    expect(state.worker.postMessage).toHaveBeenCalledTimes(1);
  });
  it('ignores stale tokens and keeps one lower-only deadline', async () => {
    vi.useFakeTimers();
    const state = start({ limits: { deadlineMs: 20 } }),
      failed = expect(state.result).rejects.toThrow('pdf-deadline');
    state.worker.send({
      ...reply(state.worker.request),
      operationToken: '12345678-1234-4234-8234-123456789abc',
    });
    await vi.advanceTimersByTimeAsync(20);
    await failed;
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
    const next = start();
    next.worker.send({
      ...reply(next.worker.request),
      operationToken: '12345678-1234-4234-8234-123456789abc',
    });
    next.worker.send(reply(next.worker.request));
    expect((await next.result).format).toBe('pdf');
  });
  it('keeps deadline/cancellation during hashing and terminates the worker once', async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => new Promise(() => undefined));
    const state = start({ limits: { deadlineMs: 5 } });
    state.worker.send(reply(state.worker.request));
    expect(state.worker.terminate).toHaveBeenCalledTimes(1);
    const failed = expect(state.result).rejects.toThrow('pdf-deadline');
    await vi.advanceTimersByTimeAsync(5);
    await failed;
    const controller = new AbortController(),
      next = start({ signal: controller.signal });
    next.worker.send(reply(next.worker.request));
    controller.abort();
    await expect(next.result).rejects.toThrow('pdf-cancelled');
  });
  it.each(['error', 'messageerror', 'malformed', 'overflow', 'pages', 'worker-failure'])(
    'fails without retry on %s',
    async kind => {
      const state = start();
      if (kind === 'error') state.worker.onerror?.(new Event('error'));
      if (kind === 'messageerror') state.worker.onmessageerror?.(new MessageEvent('messageerror'));
      if (kind === 'malformed') state.worker.send({ ...reply(state.worker.request), extra: true });
      if (kind === 'overflow')
        state.worker.send({
          ...reply(state.worker.request),
          bytes: new ArrayBuffer(PDF_LIMITS.maxOutputBytes + 1),
        });
      if (kind === 'pages') state.worker.send({ ...reply(state.worker.request), pageCount: 101 });
      if (kind === 'worker-failure')
        state.worker.send({
          schema: PDF_RESULT_SCHEMA,
          operationToken: state.worker.request.operationToken,
          ok: false,
          error: 'pdf-pack-failed',
        });
      const code =
        kind === 'error'
          ? 'pdf-worker-failed'
          : kind === 'overflow'
            ? 'pdf-output-limit'
            : kind === 'pages'
              ? 'pdf-page-limit'
              : kind === 'worker-failure'
                ? 'pdf-pack-failed'
                : 'pdf-result-invalid';
      await expect(state.result).rejects.toThrow(code);
      expect(state.worker.terminate).toHaveBeenCalledTimes(1);
      expect(state.factory).toHaveBeenCalledTimes(1);
    }
  );
  it('does not retry creation/dispatch/hash failures or unavailable native worker', async () => {
    const input = fixture();
    const failed = vi.fn(() => {
      throw new Error('private');
    });
    await expect(
      renderSelectedPdf(input.preview, input.selection, { workerFactory: failed })
    ).rejects.toThrow('pdf-worker-unavailable');
    expect(failed).toHaveBeenCalledTimes(1);
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error('private');
    });
    await expect(
      renderSelectedPdf(input.preview, input.selection, { workerFactory: () => worker })
    ).rejects.toThrow('pdf-worker-failed');
    vi.stubGlobal('Worker', undefined);
    await expect(renderSelectedPdf(input.preview, input.selection)).rejects.toThrow(
      'pdf-worker-unavailable'
    );
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('private hash'));
    await expect(pdfSha256(new ArrayBuffer(1))).rejects.toThrow('pdf-hash-failed');
    const state = start();
    state.worker.send(reply(state.worker.request));
    await expect(state.result).rejects.toThrow('pdf-hash-failed');
  });
  it('terminates a factory result if construction synchronously aborted', async () => {
    const input = fixture(),
      controller = new AbortController(),
      worker = new FakeWorker();
    const result = renderSelectedPdf(input.preview, input.selection, {
      signal: controller.signal,
      workerFactory: () => {
        controller.abort();
        return worker;
      },
    });
    await expect(result).rejects.toThrow('pdf-cancelled');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});
