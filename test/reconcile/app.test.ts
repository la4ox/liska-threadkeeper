import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatGptReconciliationDelivery } from '../../src/archive/reconciliation/chatgpt-delivery';
import {
  initReconciliationPage,
  type ReconciliationPageDependencies,
} from '../../src/reconcile/app';
import { OFFICIAL_MANIFEST_LIMITS } from '../../src/reconcile/official-manifest';

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
    <input id="officialManifestFile" type="file" />
    <button id="clearOfficialManifestBtn" disabled></button>
    <input id="reconcileOutputFile" type="checkbox" checked />
    <input id="reconcileOutputObsidian" type="checkbox" />
    <button id="runBtn"></button>
    <button id="cancelBtn"></button>
    <div id="status" data-state="idle"></div>
    <div id="result" hidden></div>
  `;
}

function setFile(id: string, file: File): void {
  setFiles(id, [file]);
}

function setFiles(id: string, files: File[]): void {
  const input = document.getElementById(id) as HTMLInputElement;
  let selected = [...files];
  Object.defineProperty(input, 'files', {
    configurable: true,
    get: () => ({
      length: selected.length,
      item: (index: number) => selected[index] ?? null,
    }),
  });
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => (selected.length ? `C:\\fakepath\\${selected[0]!.name}` : ''),
    set: value => {
      if (value === '') selected = [];
    },
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

function manifestBytes(files = ['conversations-000.json']): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      manifest_file: 'export_manifest.json',
      logical_files: { 'conversations.json': { files, shard_count: files.length, sharded: true } },
      export_files: ['PRIVATE_UNRELATED_MANIFEST_CANARY'],
    })
  );
}

function trackedFile(name: string, source = BYTES) {
  const file = new File([source], name);
  const read = vi.fn(async () => source.slice().buffer);
  const slice = vi.fn(() => ({ arrayBuffer: read }));
  Object.defineProperties(file, { arrayBuffer: { value: read }, slice: { value: slice } });
  return { file, read, slice };
}

function expectNoWork(deps: ReconciliationPageDependencies): void {
  for (const key of [
    'prepare',
    'createZip',
    'download',
    'getSettings',
    'writeObsidian',
    'sha256',
  ] as const)
    expect(deps[key]).not.toHaveBeenCalled();
}

function dependencies(
  prepared: ChatGptReconciliationDelivery = delivery()
): ReconciliationPageDependencies {
  return {
    prepare: vi.fn(async request => {
      const sources = request.officialSources ?? [
        { shardIndex: -1, chunks: request.officialChunks },
      ];
      for (const source of sources) {
        for await (const chunk of source.chunks) {
          // Consume every selected File stream like the real importer.
          void chunk;
        }
      }
      return prepared;
    }),
    createZip: vi.fn(() => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(18)])),
    download: vi.fn(async () => ({
      status: 'confirmed' as const,
      downloadId: 7,
      observedFileName: 'chosen.zip',
    })),
    getSettings: vi.fn(async () => ({
      obsidianUrl: 'http://127.0.0.1:27123',
      obsidianApiKey: 'private-key',
      vaultPath: 'AI/{platform}',
    })) as never,
    writeObsidian: vi.fn(async request => ({
      status: 'confirmed' as const,
      failureCode: null,
      attemptId: request.attemptId,
      bundleId: request.delivery.bundleId,
      conversationKey: request.delivery.conversationKey,
      receipts: [],
    })),
    sha256: vi.fn(async () => HASH),
    uuid: vi.fn(() => '00000000-0000-4000-8000-000000000000'),
    now: vi.fn(() => '2026-10-25T00:00:00.000Z'),
  };
}

async function readyRun(deps: ReconciliationPageDependencies): Promise<void> {
  await initReconciliationPage(deps);
  setFile('webCanonicalFile', syntheticFile(BYTES, 'private-web-name.json'));
  setFile('officialExportFile', syntheticFile(new Uint8Array([1, 2, 3]), 'conversations-000.json'));
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
    setFile('officialExportFile', syntheticFile(BYTES, 'conversations.json'));
    expect(run.disabled).toBe(false);
    const file = document.getElementById('reconcileOutputFile') as HTMLInputElement;
    file.checked = false;
    file.dispatchEvent(new Event('change'));
    expect(run.disabled).toBe(true);
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
    expect(deps.getSettings).not.toHaveBeenCalled();
    expect(deps.writeObsidian).not.toHaveBeenCalled();
  });

  it('snapshots, numerically sorts and consumes every selected conversation shard', async () => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    setFile('webCanonicalFile', syntheticFile(BYTES, 'web.json'));
    setFiles('officialExportFile', [
      syntheticFile(new Uint8Array([5]), 'conversations-005.json'),
      syntheticFile(new Uint8Array([0]), 'conversations-000.json'),
      syntheticFile(new Uint8Array([2]), 'conversations-002.json'),
    ]);
    (document.getElementById('runBtn') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(deps.prepare).toHaveBeenCalledOnce());
    const request = vi.mocked(deps.prepare).mock.calls[0][0];
    expect(request).not.toHaveProperty('officialChunks');
    expect(request.officialSources?.map(source => source.shardIndex)).toEqual([0, 2, 5]);
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledOnce());
  });

  it('admits a separately selected manifest before reading either source and strips its data', async () => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    const web = trackedFile('web.json');
    const shard = trackedFile('conversations-000.json');
    const laterShard = trackedFile('conversations-002.json');
    const manifest = trackedFile(
      'export_manifest.json',
      manifestBytes(['conversations-000.json', 'conversations-002.json'])
    );
    setFile('webCanonicalFile', web.file);
    setFiles('officialExportFile', [laterShard.file, shard.file]);
    setFile('officialManifestFile', manifest.file);
    (document.getElementById('reconcileOutputObsidian') as HTMLInputElement).checked = true;
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledOnce());
    expect(manifest.read).toHaveBeenCalledOnce();
    expect(manifest.read.mock.invocationCallOrder[0]).toBeLessThan(
      web.read.mock.invocationCallOrder[0]
    );
    expect(manifest.read.mock.invocationCallOrder[0]).toBeLessThan(
      shard.slice.mock.invocationCallOrder[0]
    );
    expect(laterShard.slice).toHaveBeenCalledOnce();
    expect(
      vi.mocked(deps.prepare).mock.calls[0][0].officialSources?.map(source => source.shardIndex)
    ).toEqual([0, 2]);
    expect(JSON.stringify(vi.mocked(deps.prepare).mock.calls)).not.toMatch(
      /manifest|PRIVATE_UNRELATED/
    );
    expect(JSON.stringify(vi.mocked(deps.createZip).mock.calls)).not.toContain('PRIVATE_UNRELATED');
    expect(document.body.textContent).not.toContain('PRIVATE_UNRELATED');
    await vi.waitFor(() => expect(deps.writeObsidian).toHaveBeenCalledOnce());
  });

  it('clears the optional manifest and returns to the legacy flow without a reload', async () => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    const web = trackedFile('web.json');
    const legacy = trackedFile('conversations.json');
    const manifest = trackedFile('export_manifest.json', manifestBytes());
    setFile('webCanonicalFile', web.file);
    setFile('officialExportFile', syntheticFile(BYTES, 'conversations-000.json'));
    setFile('officialManifestFile', manifest.file);
    const clear = document.getElementById('clearOfficialManifestBtn') as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(
      (document.getElementById('officialManifestFile') as HTMLInputElement).files
    ).toHaveLength(0);
    expect(clear.disabled).toBe(true);
    setFile('officialExportFile', legacy.file);
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledOnce());
    expect(manifest.read).not.toHaveBeenCalled();
    expect(legacy.slice).toHaveBeenCalled();
    expect(vi.mocked(deps.prepare).mock.calls[0][0].officialSources).toBeUndefined();
  });

  it.each([
    [
      'missing non-target shard',
      () =>
        trackedFile(
          'export_manifest.json',
          manifestBytes(['conversations-000.json', 'conversations-001.json'])
        ),
    ],
    [
      'unexpected selected shard',
      () => trackedFile('export_manifest.json', manifestBytes(['conversations-001.json'])),
    ],
    [
      'invalid JSON',
      () =>
        trackedFile(
          'export_manifest.json',
          new TextEncoder().encode('PRIVATE_UNRELATED_MANIFEST_CANARY')
        ),
    ],
    ['wrong filename', () => trackedFile('private-export_manifest.json', manifestBytes())],
    [
      'oversized metadata',
      () => {
        const result = trackedFile('export_manifest.json', manifestBytes());
        Object.defineProperty(result.file, 'size', {
          value: OFFICIAL_MANIFEST_LIMITS.maxBytes + 1,
        });
        return result;
      },
    ],
    [
      'oversized read',
      () => {
        const result = trackedFile(
          'export_manifest.json',
          new Uint8Array(OFFICIAL_MANIFEST_LIMITS.maxBytes + 1)
        );
        Object.defineProperty(result.file, 'size', { value: 2 });
        return result;
      },
    ],
    [
      'unreadable file',
      () => {
        const result = trackedFile('export_manifest.json', manifestBytes());
        result.read.mockRejectedValue(new Error('PRIVATE_UNRELATED_MANIFEST_CANARY'));
        return result;
      },
    ],
  ] as const)('rejects %s before any source read or output', async (_label, createManifest) => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    const web = trackedFile('web.json');
    const shard = trackedFile('conversations-000.json');
    const manifest = createManifest();
    setFile('webCanonicalFile', web.file);
    setFile('officialExportFile', shard.file);
    setFile('officialManifestFile', manifest.file);
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_failed')
    );
    expect(web.read).not.toHaveBeenCalled();
    expect(shard.slice).not.toHaveBeenCalled();
    expectNoWork(deps);
    expect(document.body.textContent).not.toContain('PRIVATE_UNRELATED');
    expect((document.getElementById('officialManifestFile') as HTMLInputElement).disabled).toBe(
      false
    );
    expect((document.getElementById('result') as HTMLDivElement).hidden).toBe(true);
  });

  it('rejects a manifest with legacy input or multiple manifest files before reading', async () => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    const web = trackedFile('web.json');
    const manifest = trackedFile('export_manifest.json', manifestBytes());
    setFile('webCanonicalFile', web.file);
    setFile('officialExportFile', syntheticFile(BYTES, 'conversations.json'));
    setFile('officialManifestFile', manifest.file);
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_failed')
    );
    setFile('officialExportFile', syntheticFile(BYTES, 'conversations-000.json'));
    setFiles('officialManifestFile', [manifest.file, manifest.file]);
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect((document.getElementById('runBtn') as HTMLButtonElement).disabled).toBe(false)
    );
    expect(manifest.read).not.toHaveBeenCalled();
    expect(web.read).not.toHaveBeenCalled();
    expectNoWork(deps);
  });

  it.each(['cancel', 'web-change', 'shard-change', 'manifest-change'] as const)(
    'stops a pending manifest read after %s with no later work',
    async action => {
      const deps = dependencies();
      await initReconciliationPage(deps);
      const web = trackedFile('web.json');
      const shard = trackedFile('conversations-000.json');
      const manifest = trackedFile('export_manifest.json', manifestBytes());
      let release!: (buffer: ArrayBuffer) => void;
      manifest.read.mockImplementation(
        () =>
          new Promise<ArrayBuffer>(resolve => {
            release = resolve;
          })
      );
      setFile('webCanonicalFile', web.file);
      setFile('officialExportFile', shard.file);
      setFile('officialManifestFile', manifest.file);
      (document.getElementById('runBtn') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(manifest.read).toHaveBeenCalledOnce());
      expect((document.getElementById('officialManifestFile') as HTMLInputElement).disabled).toBe(
        true
      );
      if (action === 'cancel') (document.getElementById('cancelBtn') as HTMLButtonElement).click();
      else if (action === 'web-change')
        setFile('webCanonicalFile', syntheticFile(BYTES, 'new-web.json'));
      else if (action === 'manifest-change')
        setFile('officialManifestFile', syntheticFile(manifestBytes(), 'export_manifest.json'));
      else setFile('officialExportFile', syntheticFile(BYTES, 'conversations-001.json'));
      release(manifestBytes().buffer as ArrayBuffer);
      await vi.waitFor(() =>
        expect(document.getElementById('status')?.textContent).toBe('reconcile_cancelled')
      );
      expect((document.getElementById('officialManifestFile') as HTMLInputElement).disabled).toBe(
        false
      );
      expect(web.read).not.toHaveBeenCalled();
      expect(shard.slice).not.toHaveBeenCalled();
      expectNoWork(deps);
    }
  );

  it.each([
    ['mixed legacy and shards', ['conversations.json', 'conversations-000.json']],
    ['an unrelated manifest', ['export_manifest.json']],
    ['duplicate shard indices', ['conversations-000.json', 'conversations-000.json']],
    ['a noncanonical shard name', ['conversations-0.json']],
  ] as const)('rejects %s before preparing or dispatching output', async (_label, names) => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    setFile('webCanonicalFile', syntheticFile(BYTES, 'web.json'));
    setFiles(
      'officialExportFile',
      names.map(name => syntheticFile(BYTES, name))
    );
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_failed')
    );
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.writeObsidian).not.toHaveBeenCalled();
  });

  it('writes an Obsidian-only snapshot without creating or downloading a ZIP', async () => {
    const deps = dependencies();
    await initReconciliationPage(deps);
    const file = document.getElementById('reconcileOutputFile') as HTMLInputElement;
    const obsidian = document.getElementById('reconcileOutputObsidian') as HTMLInputElement;
    file.checked = false;
    obsidian.checked = true;
    file.dispatchEvent(new Event('change'));
    setFile('webCanonicalFile', syntheticFile(BYTES, 'web.json'));
    setFile('officialExportFile', syntheticFile(BYTES, 'conversations.json'));
    (document.getElementById('runBtn') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(deps.writeObsidian).toHaveBeenCalledOnce());
    expect(deps.createZip).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.writeObsidian).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: expect.any(Object),
        operationAt: '2026-10-25T00:00:00.000Z',
        attemptId: 'obsidian-00000000-0000-4000-8000-000000000000',
        sha256: deps.sha256,
        signal: expect.any(AbortSignal),
      })
    );
    expect(document.getElementById('status')?.textContent).toBe('reconcile_outputsConfirmed');
  });

  it('reports the 5.5+ requirement without changing the File result', async () => {
    const deps = dependencies();
    vi.mocked(deps.writeObsidian).mockResolvedValue({
      status: 'refused',
      failureCode: 'server-unsupported',
      attemptId: 'attempt',
      bundleId: HASH,
      conversationKey: 'b'.repeat(64),
      receipts: [],
    });
    const obsidian = document.getElementById('reconcileOutputObsidian') as HTMLInputElement;
    obsidian.checked = true;
    await readyRun(deps);
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_outputsPartial')
    );
    expect(deps.download).toHaveBeenCalledOnce();
    expect(deps.writeObsidian).toHaveBeenCalledOnce();
    expect(document.getElementById('result')?.textContent).toContain(
      'reconcile_resultObsidianUpgrade'
    );
  });

  it('uses a dedicated upgrade warning when Obsidian is the only destination', async () => {
    const deps = dependencies();
    vi.mocked(deps.writeObsidian).mockResolvedValue({
      status: 'refused',
      failureCode: 'server-unsupported',
      attemptId: 'attempt',
      bundleId: HASH,
      conversationKey: 'b'.repeat(64),
      receipts: [],
    });
    await initReconciliationPage(deps);
    const file = document.getElementById('reconcileOutputFile') as HTMLInputElement;
    const obsidian = document.getElementById('reconcileOutputObsidian') as HTMLInputElement;
    file.checked = false;
    obsidian.checked = true;
    file.dispatchEvent(new Event('change'));
    setFile('webCanonicalFile', syntheticFile(BYTES, 'web.json'));
    setFile('officialExportFile', syntheticFile(BYTES, 'conversations.json'));
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_obsidianUpgrade')
    );
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('keeps a confirmed File result when strict Obsidian settings cannot be read', async () => {
    const deps = dependencies();
    vi.mocked(deps.getSettings).mockRejectedValue(new Error('private settings failure'));
    (document.getElementById('reconcileOutputObsidian') as HTMLInputElement).checked = true;
    await readyRun(deps);
    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('reconcile_outputsPartial')
    );
    expect(deps.download).toHaveBeenCalledOnce();
    expect(deps.writeObsidian).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('private settings failure');
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
    const official = new File([source], 'conversations.json');
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
