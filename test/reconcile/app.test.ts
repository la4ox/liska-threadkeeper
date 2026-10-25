import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatGptReconciliationDelivery } from '../../src/archive/reconciliation/chatgpt-delivery';
import {
  initReconciliationPage,
  type ReconciliationPageDependencies,
} from '../../src/reconcile/app';

const BYTES = new TextEncoder().encode('{}');
const HASH = 'a'.repeat(64);

function delivery(status: 'normalized' | 'raw-only' = 'normalized'): ChatGptReconciliationDelivery {
  const artifact = {
    relativePath: 'manifest.json' as const,
    mediaType: 'application/json' as const,
    byteLength: BYTES.byteLength,
    sha256: HASH,
    bytes: BYTES,
  };
  const base = {
    conversationKey: 'b'.repeat(64),
    bundleId: HASH,
    artifacts: [artifact],
    manifest: {
      schema: 'liska-chatgpt-reconciliation-bundle/1' as const,
      status,
      failureCode: status === 'normalized' ? null : ('official-normalization-failed' as const),
      webCanonical: {
        byteLength: 2,
        sha256: HASH,
        provenanceVerification: 'canonical-declarations-only' as const,
      },
      official: {
        captureId: 'capture',
        declaredManifestSha256: HASH,
        excerpt: { ...artifact, relativePath: 'official/conversation.json' as const },
        manifest: { ...artifact, relativePath: 'official/manifest.json' as const },
        provenance: {
          kind: 'official-export-slice' as const,
          fileRole: 'conversations' as const,
          conversationIndex: 0,
          byteStart: 1,
          byteEndExclusive: 2,
          sourceByteLength: 3,
        },
      },
      artifacts: [],
      warnings: [],
    },
  };
  return status === 'normalized'
    ? { ...base, status, failureCode: null }
    : { ...base, status, failureCode: 'official-normalization-failed' };
}

function buildDom(): void {
  document.head.innerHTML = '<title data-i18n="reconcile_title">Title</title>';
  document.body.innerHTML = `
    <span data-i18n="reconcile_heading">Heading</span>
    <input id="webCanonicalFile" type="file" />
    <input id="officialExportFile" type="file" />
    <button id="runBtn"></button>
    <button id="cancelBtn"></button>
    <div id="status" data-state="idle"></div>
    <div id="result" hidden></div>
  `;
}

function setFile(id: string, file: File): void {
  const input = document.getElementById(id) as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: { 0: file, length: 1, item: () => file },
  });
  input.dispatchEvent(new Event('change'));
}

function syntheticFile(bytes: Uint8Array, name: string): File {
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.slice().buffer,
  });
  Object.defineProperty(file, 'slice', {
    value: (start = 0, end = bytes.byteLength) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer,
    }),
  });
  return file;
}

function dependencies(
  prepared: ChatGptReconciliationDelivery = delivery()
): ReconciliationPageDependencies {
  return {
    prepare: vi.fn(async request => {
      for await (const _chunk of request.officialChunks) {
        // Consume the exact File stream like the real importer.
      }
      return prepared;
    }),
    createZip: vi.fn(() => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(18)])),
    download: vi.fn(async () => ({
      status: 'confirmed' as const,
      downloadId: 7,
      observedFileName: 'chosen.zip',
    })),
    sha256: vi.fn(async () => HASH),
    uuid: vi.fn(() => '00000000-0000-4000-8000-000000000000'),
    now: vi.fn(() => '2026-10-25T00:00:00.000Z'),
  };
}

async function readyRun(deps: ReconciliationPageDependencies): Promise<void> {
  await initReconciliationPage(deps);
  setFile('webCanonicalFile', syntheticFile(BYTES, 'private-web-name.json'));
  setFile(
    'officialExportFile',
    syntheticFile(new Uint8Array([1, 2, 3]), 'private-export-name.json')
  );
  (document.getElementById('runBtn') as HTMLButtonElement).click();
}

beforeEach(() => {
  buildDom();
  vi.mocked(chrome.i18n.getMessage).mockImplementation(key => key);
});

describe('reconciliation page', () => {
  it('keeps Run disabled until both read-only files are selected', async () => {
    await initReconciliationPage(dependencies());
    const run = document.getElementById('runBtn') as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    setFile('webCanonicalFile', syntheticFile(BYTES, 'web.json'));
    expect(run.disabled).toBe(true);
    setFile('officialExportFile', syntheticFile(BYTES, 'official.json'));
    expect(run.disabled).toBe(false);
  });

  it('streams sources, builds one ZIP and reports browser-confirmed completion', async () => {
    const deps = dependencies();
    await readyRun(deps);
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledOnce());
    expect(deps.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        captureId: 'official-import-00000000-0000-4000-8000-000000000000',
        importedAt: '2026-10-25T00:00:00.000Z',
        sha256: deps.sha256,
      })
    );
    expect(deps.createZip).toHaveBeenCalledWith([{ path: 'manifest.json', bytes: BYTES }]);
    expect(deps.download).toHaveBeenCalledWith({ bytes: expect.any(Uint8Array), bundleId: HASH });
    await vi.waitFor(() =>
      expect((document.getElementById('status') as HTMLDivElement).dataset.state).toBe('success')
    );
    expect(document.getElementById('result')?.textContent).toContain(HASH);
    expect(document.getElementById('result')?.textContent).toContain('chosen.zip');
    expect(document.body.textContent).not.toContain('private-web-name');
    expect(document.body.textContent).not.toContain('private-export-name');
  });

  it('labels a confirmed raw-only recovery without claiming comparison success', async () => {
    const deps = dependencies(delivery('raw-only'));
    await readyRun(deps);
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_savedRawOnly')
    );
    expect((document.getElementById('status') as HTMLDivElement).dataset.state).toBe('warning');
    expect(document.getElementById('result')?.textContent).toContain('reconcile_resultRawOnly');
  });

  it('reports uncertain completion and never retries automatically', async () => {
    const deps = dependencies();
    vi.mocked(deps.download).mockResolvedValue({
      status: 'unknown',
      downloadId: 9,
      error: 'completion-unconfirmed',
    });
    await readyRun(deps);
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_downloadUnknown')
    );
    expect(deps.download).toHaveBeenCalledOnce();
    expect((document.getElementById('status') as HTMLDivElement).dataset.state).toBe('warning');
  });

  it('distinguishes a cancelled or refused Save-As operation from interruption', async () => {
    const deps = dependencies();
    vi.mocked(deps.download).mockResolvedValue({
      status: 'failed',
      downloadId: null,
      error: 'start-failed',
    });
    await readyRun(deps);
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_downloadNotStarted')
    );
    expect(deps.download).toHaveBeenCalledOnce();
  });

  it('does not dispatch output when preparation fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.prepare).mockRejectedValue(new Error('private failure text'));
    await readyRun(deps);
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_failed')
    );
    expect(deps.createZip).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('private failure text');
  });

  it('cancels the local source stream before any output is dispatched', async () => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    setFile('webCanonicalFile', syntheticFile(BYTES, 'web.json'));
    const source = new Uint8Array([1, 2, 3]);
    const official = new File([source], 'official.json');
    let releaseRead!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    Object.defineProperty(official, 'slice', {
      value: () => ({
        arrayBuffer: async () => {
          markStarted();
          await new Promise<void>(resolve => {
            releaseRead = resolve;
          });
          return source.slice().buffer;
        },
      }),
    });
    setFile('officialExportFile', official);

    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await started;
    (document.getElementById('cancelBtn') as HTMLButtonElement).click();
    releaseRead();

    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_cancelled')
    );
    expect(deps.createZip).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });
});
