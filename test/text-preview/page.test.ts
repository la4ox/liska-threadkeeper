import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTextPreview } from '../../src/text-preview/page';
import {
  adoptArchivePresentationPreview,
  createPresentationSelection,
  presentationPreviewAsTextPreview,
} from '../../src/archive/presentation/preview';
import { renderPresentationSelection } from '../../src/archive/presentation/selected';
import { createTextPresentationSelection } from '../../src/archive/presentation/text-preview-selection';
import { renderTextSelection } from '../../src/archive/presentation/text';
import type { SelectedDocxArtifact } from '../../src/text-preview/docx-contract';
import {
  captureTrustedActions,
  checkboxes,
  deferred,
  DELIVERY,
  el,
  fixture,
  flush,
  HREF,
  loadPage,
  SESSION,
  wirePreview,
} from './helpers';
import type { PreviewRequest } from '../../src/text-preview/protocol';

let dispose: (() => void) | undefined;
function docxArtifact(ids: readonly string[] = ['row-1', 'row-3']): SelectedDocxArtifact {
  const preview = adoptArchivePresentationPreview(wirePreview());
  const selection = createPresentationSelection(preview, ids);
  const counts = Object.freeze({
    messageCount: ids.length,
    htmlChars: 100,
    tokens: 20,
    maxDepth: 3,
    maxListDepth: 1,
    blocks: 8,
    runs: 12,
    numberingDefinitions: 1,
    links: 0,
    placeholders: 0,
  });
  return Object.freeze({
    schema: 'liska-selected-docx/1',
    format: 'docx',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
    selection,
    availableMessageCount: preview.rows.length,
    renderedMessageCount: ids.length,
    receipt: Object.freeze({
      schema: 'liska-docx-render-receipt/1',
      rendererVersion: 'liska-selected-docx/1',
      requestSchema: 'liska-docx-request/1',
      sourceCanonicalSha256: preview.sourceCanonicalSha256,
      branchTargetNodeId: preview.branchTargetNodeId,
      profile: preview.profile,
      selectionSha256: 'a'.repeat(64),
      availableMessageCount: preview.rows.length,
      renderedMessageCount: ids.length,
      counts,
      diagnostics: Object.freeze([]),
      sourceDiagnostics: Object.freeze([]),
      byteLength: 4,
      sha256: 'b'.repeat(64),
    }),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  loadPage();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('one-shot Text-only preview delivery', () => {
  it.each([
    '',
    '?session=bad',
    `?session=${SESSION}&title=secret`,
    `?session=${SESSION}&session=${SESSION}`,
    `?session=${SESSION}#content`,
    `?session=${SESSION}#`,
    `?session=${SESSION.toUpperCase()}`,
    `?session=%31${SESSION.slice(1)}`,
  ])('rejects invalid query %s without runtime work', async query => {
    const request = vi.fn();
    dispose = initTextPreview({
      href: `chrome-extension://test/src/text-preview/text-preview.html${query}`,
      request,
    });
    await flush();
    expect(request).not.toHaveBeenCalled();
    expect(el('previewStatus').textContent).toContain('Invalid preview link');
    dispose();
    expect(request).not.toHaveBeenCalled();
  });
  it('polls metadata only through pending/capturing/selection, then takes once and ACKs exact delivery', async () => {
    let phase = 'pending';
    const request = vi.fn<PreviewRequest>(async message => {
      if (message.action === 'takeTextPreviewPayload')
        return { success: true, deliveryId: DELIVERY, payload: wirePreview() };
      if (message.action === 'ackTextPreviewPayload') {
        phase = 'delivered';
        return { success: true };
      }
      return { success: true, state: phase, expiresAt: Date.now() + 30_000 };
    });
    dispose = initTextPreview({ href: HREF, request });
    await flush();
    expect(el('previewStatus').textContent).toContain('Preparing');
    phase = 'capturing';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(el('previewStatus').textContent).toContain('Capturing');
    phase = 'awaiting-selection';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(el('previewStatus').textContent).toContain('Liska popup');
    expect(request.mock.calls.every(([m]) => m.action === 'getTextPreviewStatus')).toBe(true);
    phase = 'ready';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(request).toHaveBeenCalledWith({
      action: 'ackTextPreviewPayload',
      sessionId: SESSION,
      deliveryId: DELIVERY,
    });
    expect(checkboxes()).toHaveLength(4);
    expect(checkboxes().every(box => !box.checked)).toBe(true);
    expect(el<HTMLButtonElement>('previewCopy').disabled).toBe(true);
    expect(document.querySelector('#previewRows script')).toBeNull();
    expect(document.querySelector('#previewTitle img')).toBeNull();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(request.mock.calls.filter(([m]) => m.action === 'takeTextPreviewPayload')).toHaveLength(
      1
    );
    expect(request.mock.calls.filter(([m]) => m.action === 'ackTextPreviewPayload')).toHaveLength(
      1
    );
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });
  it('allows bounded not-ready registration polling but fails closed when it never registers', async () => {
    const request = vi.fn(async () => ({ success: false, error: 'text-preview-not-ready' }));
    dispose = initTextPreview({ href: HREF, request });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(el('previewStatus').textContent).toContain('unavailable or expired');
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(calls);
  });
  it('never retakes a lost delivery callback', async () => {
    const request = vi.fn<PreviewRequest>(async message => {
      if (message.action === 'takeTextPreviewPayload') throw new Error('lost');
      return { success: true, state: 'ready', expiresAt: Date.now() + 60_000 };
    });
    dispose = initTextPreview({ href: HREF, request });
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request.mock.calls.map(([m]) => m.action)).toEqual([
      'getTextPreviewStatus',
      'takeTextPreviewPayload',
    ]);
    expect(checkboxes()).toHaveLength(0);
    expect(el('previewStatus').textContent).toContain('delivery failed');
  });
  it.each(['delivered', 'taken', 'ready', 'invalidated'])(
    'reconciles a lost ACK only with delivered, not %s',
    async finalPhase => {
      let afterAck = false;
      const request = vi.fn<PreviewRequest>(async message => {
        if (message.action === 'takeTextPreviewPayload')
          return { success: true, deliveryId: DELIVERY, payload: wirePreview() };
        if (message.action === 'ackTextPreviewPayload') {
          afterAck = true;
          throw new Error('lost');
        }
        return {
          success: true,
          state: afterAck ? finalPhase : 'ready',
          expiresAt: Date.now() + 60_000,
        };
      });
      dispose = initTextPreview({ href: HREF, request });
      await flush();
      expect(checkboxes()).toHaveLength(finalPhase === 'delivered' ? 4 : 0);
      expect(request.mock.calls.map(([m]) => m.action)).toEqual([
        'getTextPreviewStatus',
        'takeTextPreviewPayload',
        'ackTextPreviewPayload',
        'getTextPreviewStatus',
      ]);
    }
  );
  it('does not render before ACK and strictly rejects malformed adopted payloads', async () => {
    const ack = deferred<unknown>();
    const request = vi.fn<PreviewRequest>(async message => {
      if (message.action === 'takeTextPreviewPayload')
        return { success: true, deliveryId: DELIVERY, payload: wirePreview() };
      if (message.action === 'ackTextPreviewPayload') return ack.promise;
      return { success: true, state: 'ready', expiresAt: Date.now() + 60_000 };
    });
    dispose = initTextPreview({ href: HREF, request });
    await flush();
    expect(checkboxes()).toHaveLength(0);
    ack.resolve({ success: true });
    await flush();
    expect(checkboxes()).toHaveLength(4);
    dispose();
    loadPage();
    request.mockImplementation(async message =>
      message.action === 'takeTextPreviewPayload'
        ? { success: true, deliveryId: DELIVERY, payload: { ...wirePreview(), extra: 'refused' } }
        : { success: true, state: 'ready', expiresAt: Date.now() + 60_000 }
    );
    request.mockClear();
    dispose = initTextPreview({ href: HREF, request });
    await flush();
    expect(el('previewStatus').textContent).toContain('delivery failed');
    expect(request.mock.calls.some(([m]) => m.action === 'ackTextPreviewPayload')).toBe(false);
  });
  it('ignores a late take reply after Clear and sends explicit clear and pagehide close', async () => {
    const trusted = captureTrustedActions();
    const take = deferred<unknown>();
    const request = vi.fn<PreviewRequest>(async message =>
      message.action === 'takeTextPreviewPayload'
        ? take.promise
        : { success: true, state: 'ready', expiresAt: Date.now() + 60_000 }
    );
    dispose = initTextPreview({ href: HREF, request });
    await flush();
    trusted(el('previewClear'));
    expect(request).toHaveBeenCalledWith({
      action: 'invalidateTextPreview',
      sessionId: SESSION,
      reason: 'clear',
    });
    take.resolve({ success: true, deliveryId: DELIVERY, payload: wirePreview() });
    await flush();
    expect(checkboxes()).toHaveLength(0);
    expect(request.mock.calls.some(([m]) => m.action === 'ackTextPreviewPayload')).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(request).toHaveBeenCalledWith({
      action: 'invalidateTextPreview',
      sessionId: SESSION,
      reason: 'close',
    });
  });
  it('does not reconcile a refused ACK or retry its take', async () => {
    const request = vi.fn<PreviewRequest>(async message => {
      if (message.action === 'takeTextPreviewPayload')
        return { success: true, deliveryId: DELIVERY, payload: wirePreview() };
      if (message.action === 'ackTextPreviewPayload') return { success: false };
      return { success: true, state: 'ready', expiresAt: Date.now() + 60_000 };
    });
    dispose = initTextPreview({ href: HREF, request });
    await flush();
    expect(request.mock.calls.map(([m]) => m.action)).toEqual([
      'getTextPreviewStatus',
      'takeTextPreviewPayload',
      'ackTextPreviewPayload',
    ]);
    expect(checkboxes()).toHaveLength(0);
  });
  it('ignores late ACK and metadata replies after the page has been cleared or closed', async () => {
    const trusted = captureTrustedActions();
    const ack = deferred<unknown>();
    const request = vi.fn<PreviewRequest>(async message => {
      if (message.action === 'takeTextPreviewPayload')
        return { success: true, deliveryId: DELIVERY, payload: wirePreview() };
      if (message.action === 'ackTextPreviewPayload') return ack.promise;
      return { success: true, state: 'ready', expiresAt: Date.now() + 60_000 };
    });
    dispose = initTextPreview({ href: HREF, request });
    await flush();
    trusted(el('previewClear'));
    ack.resolve({ success: true });
    await flush();
    expect(checkboxes()).toHaveLength(0);
    expect(el('previewStatus').textContent).toContain('cleared');
    dispose();
    loadPage();
    const status = deferred<unknown>();
    request.mockImplementation(() => status.promise);
    dispose = initTextPreview({ href: HREF, request });
    window.dispatchEvent(new Event('pagehide'));
    status.resolve({ success: true, state: 'ready', expiresAt: Date.now() + 60_000 });
    await flush();
    expect(checkboxes()).toHaveLength(0);
    expect(el('previewStatus').textContent).toBe('Preview closed.');
  });
});

describe('local selection and outputs', () => {
  it('renders and downloads one frozen DOCX selection with a visible exact receipt', async () => {
    const trusted = captureTrustedActions();
    const artifact = docxArtifact();
    const renderDocx = vi.fn(async () => artifact);
    const requireDocx = vi.fn();
    const downloadBinary = vi.fn(() => ({
      result: Promise.resolve({ outcome: 'success' as const, downloadId: 51 }),
      dispose: vi.fn(),
    }));
    const f = fixture({ renderDocx, requireDocx, downloadBinary });
    dispose = f.dispose;
    await flush();
    const boxes = checkboxes();
    for (const index of [2, 0]) {
      boxes[index].checked = true;
      trusted(boxes[index]);
    }
    expect(el<HTMLButtonElement>('previewDownloadDocx').disabled).toBe(false);
    trusted(el('previewDownloadDocx'));
    await flush();
    expect(renderDocx).toHaveBeenCalledOnce();
    expect(renderDocx.mock.calls[0][1]).toEqual(artifact.selection);
    expect(renderDocx.mock.calls[0][2]?.signal).toBeInstanceOf(AbortSignal);
    expect(requireDocx).toHaveBeenCalledExactlyOnceWith(artifact);
    expect(downloadBinary).toHaveBeenCalledExactlyOnceWith(artifact, wirePreview().title);
    expect(el('previewStatus').textContent).toContain('DOCX download completed');
    expect(el('previewStatus').textContent).toContain(artifact.receipt.sha256);
    expect(el<HTMLDetailsElement>('previewDocxReceiptPanel').hidden).toBe(false);
    expect(JSON.parse(el('previewDocxReceipt').textContent!)).toEqual({
      schema: 'liska-selected-docx-delivery-receipt/1',
      render: Object.fromEntries(
        Object.entries(artifact.receipt).filter(([key]) => key !== 'branchTargetNodeId')
      ),
      delivery: { outcome: 'success', downloadId: 51 },
    });
    expect(el('previewDocxReceipt').textContent).not.toContain(wirePreview().branchTargetNodeId);
  });

  it('aborts a live DOCX worker on Clear and ignores its late artifact', async () => {
    const trusted = captureTrustedActions();
    const pending = deferred<SelectedDocxArtifact>();
    let signal: AbortSignal | undefined;
    const renderDocx = vi.fn((_preview, _selection, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const downloadBinary = vi.fn();
    const f = fixture({ renderDocx, requireDocx: vi.fn(), downloadBinary });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewDownloadDocx'));
    await flush();
    expect(renderDocx).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    expect(el<HTMLButtonElement>('previewCopy').disabled).toBe(true);
    trusted(el('previewClear'));
    expect(signal?.aborted).toBe(true);
    pending.resolve(docxArtifact(['row-1', 'row-2', 'row-3', 'row-4']));
    await flush();
    expect(downloadBinary).not.toHaveBeenCalled();
    expect(el('previewStatus').textContent).toContain('Preview cleared');
    expect(el<HTMLDetailsElement>('previewDocxReceiptPanel').hidden).toBe(true);
  });

  it('rechecks the lease after DOCX rendering and refuses stale bytes', async () => {
    const trusted = captureTrustedActions();
    const pending = deferred<SelectedDocxArtifact>();
    const renderDocx = vi.fn(() => pending.promise);
    const downloadBinary = vi.fn();
    const f = fixture({ renderDocx, requireDocx: vi.fn(), downloadBinary });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewDownloadDocx'));
    await flush();
    expect(renderDocx).toHaveBeenCalledOnce();
    f.request.mockResolvedValue({ success: true, state: 'expired', expiresAt: Date.now() });
    pending.resolve(docxArtifact(['row-1', 'row-2', 'row-3', 'row-4']));
    await flush();
    expect(downloadBinary).not.toHaveBeenCalled();
    expect(checkboxes()).toHaveLength(0);
    expect(el('previewStatus').textContent).toContain('unavailable or expired');
  });

  it('rejects an unowned DOCX artifact before browser delivery and releases the lock', async () => {
    const trusted = captureTrustedActions();
    const artifact = docxArtifact();
    const downloadBinary = vi.fn();
    const requireDocx = vi.fn(() => {
      throw new Error('unowned');
    });
    const f = fixture({ renderDocx: vi.fn(async () => artifact), requireDocx, downloadBinary });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewDownloadDocx'));
    await flush();
    expect(requireDocx).toHaveBeenCalledExactlyOnceWith(artifact);
    expect(downloadBinary).not.toHaveBeenCalled();
    expect(el('previewStatus').textContent).toBe('DOCX rendering failed. Nothing was retried.');
    expect(el<HTMLButtonElement>('previewDownloadDocx').disabled).toBe(false);
  });

  it('disposes an active DOCX download on Clear and ignores its late receipt', async () => {
    const trusted = captureTrustedActions();
    const pending = deferred<{ outcome: 'success'; downloadId: number }>();
    const cleanup = vi.fn();
    const artifact = docxArtifact(['row-1', 'row-2', 'row-3', 'row-4']);
    const downloadBinary = vi.fn(() => ({ result: pending.promise, dispose: cleanup }));
    const f = fixture({
      renderDocx: vi.fn(async () => artifact),
      requireDocx: vi.fn(),
      downloadBinary,
    });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewDownloadDocx'));
    await flush();
    expect(downloadBinary).toHaveBeenCalledOnce();
    trusted(el('previewClear'));
    expect(cleanup).toHaveBeenCalledOnce();
    pending.resolve({ outcome: 'success', downloadId: 71 });
    await flush();
    expect(el('previewStatus').textContent).toContain('Preview cleared');
    expect(el<HTMLDetailsElement>('previewDocxReceiptPanel').hidden).toBe(true);
  });

  it.each([
    ['text', 'Text', 'txt'],
    ['markdown', 'Markdown source', 'md'],
    ['html', 'HTML source', 'html'],
  ] as const)(
    'copies and downloads the same noncontiguous selection in %s without rendering source',
    async (format, label, extension) => {
      const trusted = captureTrustedActions();
      const download = vi.fn(() => ({
        result: Promise.resolve('success' as const),
        dispose: vi.fn(),
      }));
      const f = fixture({ download });
      dispose = f.dispose;
      await flush();
      const selector = el<HTMLSelectElement>('previewFormat');
      expect(selector.value).toBe('text');
      expect([...selector.options].map(option => [option.value, option.textContent])).toEqual([
        ['text', 'Text'],
        ['markdown', 'Markdown'],
        ['html', 'HTML'],
      ]);
      expect(document.querySelector('label[for="previewFormat"]')?.textContent).toContain(
        'Output format'
      );
      const boxes = checkboxes();
      for (const index of [2, 0]) {
        boxes[index].checked = true;
        trusted(boxes[index]);
      }
      el<HTMLInputElement>('previewSearch').value = 'fox';
      trusted(el('previewSearch'), {}, 'input');
      selector.value = format;
      trusted(selector, {}, 'change');
      expect(el('previewCopy').textContent).toBe(`Copy ${label}`);
      expect(el('previewDownload').textContent).toBe(`Download .${extension}`);
      expect(boxes.map(box => box.checked)).toEqual([true, false, true, false]);
      expect(el<HTMLInputElement>('previewSearch').value).toBe('fox');
      expect(el('previewFiltered').textContent).toBe('2');
      expect(
        [...document.querySelectorAll('#previewRows pre')].map(row => row.textContent)
      ).toEqual(wirePreview().rows.map(row => row.presentedText));
      expect(document.querySelector('#previewRows strong')).toBeNull();
      expect(el('previewRows').textContent).not.toContain('literal source');
      const preview = adoptArchivePresentationPreview(wirePreview());
      const ids = ['row-1', 'row-3'];
      const artifact = renderPresentationSelection(
        preview,
        createPresentationSelection(preview, ids),
        format
      );
      expect(artifact.selection.messageNodeIds).toEqual(ids);
      if (format === 'text') {
        const textPreview = presentationPreviewAsTextPreview(preview);
        expect(artifact.content).toBe(
          renderTextSelection(textPreview, createTextPresentationSelection(textPreview, ids)).text
        );
      }
      trusted(el('previewCopy'));
      await flush();
      expect(f.copy).toHaveBeenCalledExactlyOnceWith(artifact.content);
      expect(el('previewStatus').textContent).toBe(`Selected ${label} copied.`);
      trusted(el('previewDownload'));
      await flush();
      expect(download).toHaveBeenCalledExactlyOnceWith(artifact, preview.title);
      expect(el('previewStatus').textContent).toBe(`Selected ${label} download completed.`);
      expect(checkboxes()).toEqual(boxes);
      expect(selector.disabled).toBe(false);
      trusted(el('previewClear'));
      expect(selector.disabled).toBe(true);
    }
  );

  it.each(['copy', 'download'] as const)(
    'freezes the %s artifact before awaiting a lease or output',
    async kind => {
      const trusted = captureTrustedActions();
      const copying = deferred<void>();
      const downloading = deferred<'success'>();
      const copy = vi.fn(() => copying.promise);
      const download = vi.fn(() => ({ result: downloading.promise, dispose: vi.fn() }));
      const f = fixture({ copy, download });
      dispose = f.dispose;
      await flush();
      const boxes = checkboxes();
      for (const index of [2, 0]) {
        boxes[index].checked = true;
        trusted(boxes[index]);
      }
      const selector = el<HTMLSelectElement>('previewFormat');
      selector.value = 'markdown';
      trusted(selector, {}, 'change');
      const lease = deferred<unknown>();
      f.request.mockImplementationOnce(() => lease.promise);
      trusted(el(kind === 'copy' ? 'previewCopy' : 'previewDownload'));
      expect(selector.disabled).toBe(true);
      selector.value = 'html';
      trusted(selector, {}, 'change');
      trusted(el('previewDeselect'));
      el<HTMLInputElement>('previewSearch').value = 'hidden';
      trusted(el('previewSearch'), {}, 'input');
      expect(selector.value).toBe('markdown');
      expect(boxes.map(box => box.checked)).toEqual([true, false, true, false]);
      expect(copy).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
      lease.resolve({ success: true, state: 'delivered', expiresAt: f.expiresAt });
      await flush();
      const preview = adoptArchivePresentationPreview(wirePreview());
      const artifact = renderPresentationSelection(
        preview,
        createPresentationSelection(preview, ['row-1', 'row-3']),
        'markdown'
      );
      if (kind === 'copy') expect(copy).toHaveBeenCalledExactlyOnceWith(artifact.content);
      else {
        expect(download).toHaveBeenCalledExactlyOnceWith(artifact, preview.title);
        expect(Object.isFrozen(download.mock.calls[0][0])).toBe(true);
      }
      selector.value = 'text';
      trusted(selector, {}, 'change');
      expect(selector.value).toBe('markdown');
      expect(selector.disabled).toBe(true);
      copying.resolve();
      downloading.resolve('success');
      await flush();
      expect(selector.disabled).toBe(false);
      expect(el('previewStatus').textContent).toContain('Selected Markdown source');
      expect(el<HTMLInputElement>('previewSearch').value).toBe('hidden');
      expect(boxes.map(box => box.checked)).toEqual([true, false, true, false]);
      selector.value = 'html';
      trusted(selector, {}, 'change');
      expect(el('previewCopy').textContent).toBe('Copy HTML source');
    }
  );

  it('keeps search isolated from selection, counts hidden selections, and shifts over complete order', async () => {
    const trusted = captureTrustedActions();
    const f = fixture();
    dispose = f.dispose;
    await flush();
    const boxes = checkboxes();
    boxes[0].checked = true;
    trusted(boxes[0]);
    el<HTMLInputElement>('previewSearch').value = 'fOx';
    trusted(el('previewSearch'), {}, 'input');
    expect(el('previewFiltered').textContent).toBe('2');
    boxes[2].checked = true;
    trusted(boxes[2], { shiftKey: true });
    expect(boxes.map(box => box.checked)).toEqual([true, true, true, false]);
    expect(el('previewSelected').textContent).toBe('3');
    expect(el('previewHiddenSelected').textContent).toBe('1');
    el<HTMLInputElement>('previewSearch').value = 'ASSISTANT';
    trusted(el('previewSearch'), {}, 'input');
    expect(el('previewFiltered').textContent).toBe('2');
    expect(el('previewSelected').textContent).toBe('3');
    expect(el('previewHiddenSelected').textContent).toBe('2');
    trusted(el('previewSelectAll'));
    expect(el('previewSelected').textContent).toBe('4');
    trusted(el('previewDeselect'));
    expect(el('previewSelected').textContent).toBe('0');
    expect(el<HTMLButtonElement>('previewCopy').disabled).toBe(true);
    expect(f.copy).not.toHaveBeenCalled();
  });
  it('uses trusted actions, a fresh lease and exact selected renderer bytes for each output', async () => {
    const trusted = captureTrustedActions();
    const download = vi.fn(() => ({
      result: Promise.resolve('success' as const),
      dispose: vi.fn(),
    }));
    const f = fixture({ download });
    dispose = f.dispose;
    await flush();
    el('previewCopy').click();
    el('previewDownload').click();
    expect(f.copy).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    const boxes = checkboxes();
    boxes[0].checked = true;
    trusted(boxes[0]);
    trusted(el('previewCopy'));
    await flush();
    const preview = adoptArchivePresentationPreview(wirePreview());
    const expected = renderPresentationSelection(
      preview,
      createPresentationSelection(preview, ['row-1']),
      'text'
    ).content;
    expect(f.copy).toHaveBeenCalledExactlyOnceWith(expected);
    expect(el('previewStatus').textContent).toBe('Selected Text copied.');
    expect(f.request.mock.calls.map(([m]) => m.action)).toEqual([
      'getTextPreviewStatus',
      'takeTextPreviewPayload',
      'ackTextPreviewPayload',
      'getTextPreviewStatus',
    ]);
    boxes[0].checked = false;
    trusted(boxes[0]);
    boxes[2].checked = true;
    trusted(boxes[2]);
    trusted(el('previewDownload'));
    await flush();
    const next = renderPresentationSelection(
      preview,
      createPresentationSelection(preview, ['row-3']),
      'text'
    );
    expect(download).toHaveBeenCalledExactlyOnceWith(next, preview.title);
    expect(next.content).not.toContain('│ First fox');
    expect(el('previewStatus').textContent).toContain('download completed');
  });
  it.each(['failure', 'unknown'] as const)('reports download %s without retry', async outcome => {
    const trusted = captureTrustedActions();
    const download = vi.fn(() => ({ result: Promise.resolve(outcome), dispose: vi.fn() }));
    const f = fixture({ download });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewDownload'));
    await flush();
    expect(el('previewStatus').textContent).toContain(outcome === 'unknown' ? 'unknown' : 'failed');
    expect(download).toHaveBeenCalledOnce();
  });
  it.each(['invalidated', 'taken', 'ready', 'unknown'])(
    'erases rows, filter and selection on non-delivered lease %s',
    async phase => {
      const trusted = captureTrustedActions();
      const f = fixture();
      dispose = f.dispose;
      await flush();
      trusted(el('previewSelectAll'));
      el<HTMLInputElement>('previewSearch').value = 'fox';
      f.setPhase(phase);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(checkboxes()).toHaveLength(0);
      expect(el<HTMLInputElement>('previewSearch').value).toBe('');
      expect(el('previewSelected').textContent).toBe('0');
      expect(el<HTMLButtonElement>('previewDownload').disabled).toBe(true);
      expect(el('previewTitle').textContent).toBe('');
    }
  );
  it('checks lease immediately before output and refuses a restarted worker', async () => {
    const trusted = captureTrustedActions();
    const f = fixture();
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    f.request.mockResolvedValue({ success: false, error: 'text-preview-not-ready' });
    trusted(el('previewCopy'));
    await flush();
    expect(f.copy).not.toHaveBeenCalled();
    expect(checkboxes()).toHaveLength(0);
  });
  it('erases at the exact local deadline even while a lease response is pending', async () => {
    const trusted = captureTrustedActions();
    const f = fixture();
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    const pending = deferred<unknown>();
    f.request.mockImplementation(() => pending.promise);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(checkboxes()).toHaveLength(0);
    pending.resolve({ success: true, state: 'delivered', expiresAt: Date.now() + 60_000 });
    await flush();
    expect(checkboxes()).toHaveLength(0);
  });
  it('permits only one output attempt, reports clipboard failure/unknown and ignores late success after Clear', async () => {
    const trusted = captureTrustedActions();
    const copying = deferred<void>();
    const copy = vi.fn(() => copying.promise);
    const download = vi.fn();
    const f = fixture({ copy, download });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewCopy'));
    await flush();
    trusted(el('previewCopy'));
    trusted(el('previewDownload'));
    expect(copy).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(el('previewStatus').textContent).toContain('outcome unknown');
    trusted(el('previewClear'));
    copying.resolve();
    await flush();
    expect(el('previewStatus').textContent).toContain('Preview cleared');
    expect(checkboxes()).toHaveLength(0);
  });
  it('reports clipboard rejection without retry', async () => {
    const trusted = captureTrustedActions();
    const copy = vi.fn(async () => {
      throw new Error('denied');
    });
    const f = fixture({ copy });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewCopy'));
    await flush();
    expect(el('previewStatus').textContent).toBe('Copy Text failed. Nothing was retried.');
    expect(copy).toHaveBeenCalledOnce();
  });
  it('reports a synchronous clipboard failure without retrying', async () => {
    const trusted = captureTrustedActions();
    const copy = vi.fn(() => {
      throw new Error('clipboard unavailable');
    });
    const f = fixture({ copy });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewCopy'));
    await flush();
    expect(el('previewStatus').textContent).toBe('Copy Text failed. Nothing was retried.');
    expect(copy).toHaveBeenCalledOnce();
  });
  it('reports a synchronous download-start failure and releases the output lock', async () => {
    const trusted = captureTrustedActions();
    const download = vi.fn(() => {
      throw new Error('browser download API unavailable');
    });
    const f = fixture({ download });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewDownload'));
    await flush();
    expect(el('previewStatus').textContent).toBe('Output failed. Nothing was retried.');
    expect(download).toHaveBeenCalledOnce();
    expect(el<HTMLButtonElement>('previewDownload').disabled).toBe(false);
  });
  it('cleans an active download when Clear erases the preview and ignores its late terminal reply', async () => {
    const trusted = captureTrustedActions();
    const pending = deferred<'success'>();
    const cleanup = vi.fn();
    const download = vi.fn(() => ({ result: pending.promise, dispose: cleanup }));
    const f = fixture({ download });
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    trusted(el('previewDownload'));
    await flush();
    trusted(el('previewClear'));
    expect(cleanup).toHaveBeenCalledOnce();
    pending.resolve('success');
    await flush();
    expect(el('previewStatus').textContent).toContain('Preview cleared');
    expect(el('previewSelected').textContent).toBe('0');
    expect(download).toHaveBeenCalledOnce();
  });
  it('fails closed on a lost lease response rather than using locally retained content', async () => {
    const trusted = captureTrustedActions();
    const f = fixture();
    dispose = f.dispose;
    await flush();
    trusted(el('previewSelectAll'));
    f.request.mockRejectedValue(new Error('worker stopped'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkboxes()).toHaveLength(0);
    trusted(el('previewCopy'));
    await flush();
    expect(f.copy).not.toHaveBeenCalled();
  });
});
