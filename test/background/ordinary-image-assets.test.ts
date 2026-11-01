import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/lib/sha256';
import { resolveImagesToConfirmedPaths } from '../../src/lib/image-output';
import { prepareOrdinaryImagePlan } from '../../src/background/ordinary-image-assets';
import { handleSave } from '../../src/background/obsidian-handlers';
import { handleMultiOutput } from '../../src/background/output-handlers';
import type { ExtensionSettings, ExtractedImage, ObsidianNote } from '../../src/lib/types';

const api = vi.hoisted(() => ({
  getFile: vi.fn(),
  putFile: vi.fn(),
  getServerVersions: vi.fn(),
  getBinaryFileBounded: vi.fn(),
  putBinaryFileIfAbsent: vi.fn(),
  putBinaryFile: vi.fn(),
}));
vi.mock('../../src/lib/obsidian-api', () => ({
  ObsidianApiClient: class {
    getFile = api.getFile;
    putFile = api.putFile;
    getServerVersions = api.getServerVersions;
    getBinaryFileBounded = api.getBinaryFileBounded;
    putBinaryFileIfAbsent = api.putBinaryFileIfAbsent;
    putBinaryFile = api.putBinaryFile;
  },
  isObsidianApiError: () => false,
}));

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const otherBytes = new Uint8Array([9, 8, 7]);
const image = (id = 'img-1', data = bytes, mimeType = 'image/png'): ExtractedImage => ({
  id,
  mimeType,
  data: bytesToBase64(data),
  alt: 'synthetic',
});
const placeholder = (id = 'img-1') => `![synthetic](g2o-image://${id})`;
const settings: ExtensionSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  obsidianApiKey: 'synthetic-test-key',
  enableAppendMode: false,
  enableImageExport: true,
  vaultPath: 'Notes/Nested',
  imageVaultPath: 'Images/{platform}',
};
const note = (images = [image()]): ObsidianNote => ({
  fileName: 'ordinary.md',
  body: images.map(value => placeholder(value.id)).join('\n\n'),
  images,
  contentHash: 'synthetic',
  frontmatter: {
    id: 'ordinary',
    title: 'Ordinary',
    source: 'gemini',
    url: 'https://gemini.google.com/app/ordinary',
    created: '2026-01-01',
    modified: '2026-01-01',
    tags: [],
    message_count: 1,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  api.getFile.mockResolvedValue(null);
  api.putFile.mockResolvedValue(undefined);
  api.getServerVersions.mockResolvedValue({ self: '5.5.2', obsidian: '1.14.5' });
  const retained = new Map<string, Uint8Array>();
  api.getBinaryFileBounded.mockImplementation(async path => retained.get(path) ?? null);
  api.putBinaryFileIfAbsent.mockImplementation(async (path, data) => {
    retained.set(path, data);
  });
});

describe('ordinary exact-byte planning and rendering', () => {
  it('uses full hashes independent of title, source-array order, IDs and repeated occurrences', async () => {
    const first = image();
    const second = image('img-2');
    const input = `${placeholder()}\n${placeholder('img-2')}\n${placeholder()}`;
    const a = await prepareOrdinaryImagePlan(input, [first, second]);
    const b = await prepareOrdinaryImagePlan(input, [second, first]);
    expect(a.assets).toHaveLength(1);
    expect(a.assets).toEqual(b.assets);
    expect(a.namesById).toEqual(b.namesById);
    expect(a.assets[0].fileName).toBe(`sha256-${await sha256Hex(bytes)}.png`);
    const renamed = {
      ...note(),
      fileName: 'renamed.md',
      frontmatter: { ...note().frontmatter, title: 'Other' },
    };
    await handleSave(settings, renamed);
    expect(api.putBinaryFileIfAbsent.mock.calls[0][0]).not.toMatch(/ordinary|renamed|Other/);
  });

  it('rejects duplicate IDs while retaining other valid assets', async () => {
    const plan = await prepareOrdinaryImagePlan(`${placeholder()}\n${placeholder('img-2')}`, [
      image(),
      image('img-1', otherBytes),
      image('img-2', otherBytes),
    ]);
    expect(plan.failedImageCount).toBe(1);
    expect([...plan.namesById.keys()]).toEqual(['img-2']);
    expect(plan.assets).toHaveLength(1);
  });

  it.each([
    { ...image(), data: 'AB==' },
    { ...image(), data: 'not-base64' },
    { ...image(), data: '' },
    image('img-1', bytes, 'image/svg+xml'),
  ])('rejects invalid bytes/MIME without a planned filename', async invalid => {
    const plan = await prepareOrdinaryImagePlan(placeholder(), [invalid]);
    expect(plan.assets).toEqual([]);
    expect(plan.namesById.size).toBe(0);
    expect(plan.failedImageCount).toBe(1);
  });

  it('normalizes MIME aliases and deduplicates identical bytes', async () => {
    const plan = await prepareOrdinaryImagePlan(`${placeholder()}\n${placeholder('img-2')}`, [
      image('img-1', bytes, 'image/jpg'),
      image('img-2', bytes, ' IMAGE/JPEG; charset=binary'),
    ]);
    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0]).toMatchObject({ mediaType: 'image/jpeg' });
    expect(plan.assets[0].fileName).toMatch(/\.jpg$/);
  });

  it('does not promote protected, neutralized or missing placeholders', async () => {
    const body = [
      '```md',
      placeholder(),
      '```',
      `\`${placeholder()}\``,
      '&#33;&#91;synthetic](g2o-image://img-1)',
      placeholder('missing'),
    ].join('\n');
    const plan = await prepareOrdinaryImagePlan(body, [image()]);
    expect(plan.assets).toEqual([]);
    const rendered = resolveImagesToConfirmedPaths(
      body,
      [image()],
      new Map([['img-1', 'Images/a.png']])
    );
    expect(rendered.body).not.toContain('Images/a.png');
    expect(rendered.body).toContain('&#33;&#91;synthetic]');
  });

  it('encodes vault folder delimiters instead of creating headings, aliases or Markdown titles', () => {
    const path = 'Images # [draft] (a) | % !/日本語/x.png';
    const rendered = resolveImagesToConfirmedPaths(
      placeholder(),
      [image()],
      new Map([['img-1', path]])
    );
    expect(rendered.body).toContain('Images%20%23%20%5Bdraft%5D%20%28a%29%20%7C%20%25%20%21/');
    const paragraph = fromMarkdown(rendered.body).children[0];
    expect(paragraph).toMatchObject({ type: 'paragraph', children: [{ type: 'image' }] });
    expect(rendered.body).not.toContain('![[');
  });
});

describe('ordinary Obsidian immutable retention', () => {
  it('creates with create-only API, reads exact bytes back, and embeds the full vault-root path from a nested note', async () => {
    const result = await handleSave(settings, note());
    expect(result).toMatchObject({ success: true });
    expect(result.warning).toBeUndefined();
    const path = `Images/gemini/liska-v1/sha256-${await sha256Hex(bytes)}.png`;
    expect(api.putBinaryFileIfAbsent).toHaveBeenCalledWith(path, bytes, 'image/png');
    expect(api.getBinaryFileBounded).toHaveBeenNthCalledWith(1, path, bytes.byteLength);
    expect(api.getBinaryFileBounded).toHaveBeenNthCalledWith(2, path, bytes.byteLength);
    expect(api.putFile).toHaveBeenCalledWith(
      'Notes/Nested/ordinary.md',
      expect.stringContaining(`](<${path}>)`)
    );
    expect(api.putBinaryFile).not.toHaveBeenCalled();
    expect(api.putFile.mock.invocationCallOrder[0]).toBeGreaterThan(
      api.getBinaryFileBounded.mock.invocationCallOrder[1]
    );
  });

  it('reuses identical existing bytes without any PUT', async () => {
    api.getBinaryFileBounded.mockResolvedValue(bytes);
    expect((await handleSave(settings, note())).warning).toBeUndefined();
    expect(api.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    expect(api.putBinaryFile).not.toHaveBeenCalled();
    expect(api.putFile.mock.calls[0][1]).toContain('Images/gemini/liska-v1/sha256-');
  });

  it.each(['different', 'unknown', 'missing-readback', 'different-readback', 'failed-readback'])(
    'saves the note with no false embed for %s bytes',
    async failure => {
      if (failure === 'different') api.getBinaryFileBounded.mockResolvedValue(otherBytes);
      if (failure === 'unknown') api.getBinaryFileBounded.mockRejectedValue(new Error('private'));
      if (failure === 'missing-readback') api.getBinaryFileBounded.mockResolvedValue(null);
      if (failure === 'different-readback')
        api.getBinaryFileBounded.mockResolvedValueOnce(null).mockResolvedValue(otherBytes);
      if (failure === 'failed-readback')
        api.getBinaryFileBounded
          .mockResolvedValueOnce(null)
          .mockRejectedValue(new Error('private'));
      const result = await handleSave(settings, note());
      expect(result).toMatchObject({ success: true, warning: '1 image could not be saved' });
      expect(api.putFile.mock.calls[0][1]).not.toMatch(/sha256-|g2o-image:\/\//);
      expect(api.putBinaryFile).not.toHaveBeenCalled();
      if (failure === 'different' || failure === 'unknown')
        expect(api.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    }
  );

  it.each(['412', 'uncertain'])('reconciles %s PUT only after exact readback', async outcome => {
    api.putBinaryFileIfAbsent.mockRejectedValue(new Error(outcome));
    api.getBinaryFileBounded.mockResolvedValueOnce(null).mockResolvedValueOnce(bytes);
    expect((await handleSave(settings, note())).warning).toBeUndefined();
    expect(api.putFile.mock.calls[0][1]).toContain('Images/gemini/liska-v1/sha256-');
  });

  it.each([null, otherBytes])(
    'does not embed an uncertain PUT with nonidentical readback',
    async retained => {
      api.putBinaryFileIfAbsent.mockRejectedValue(new Error('private'));
      api.getBinaryFileBounded.mockResolvedValueOnce(null).mockResolvedValueOnce(retained);
      expect((await handleSave(settings, note())).warning).toBe('1 image could not be saved');
      expect(api.putFile.mock.calls[0][1]).not.toContain('sha256-');
    }
  );

  it('retains and embeds the first successful asset when the second asset fails', async () => {
    api.getBinaryFileBounded
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(bytes)
      .mockResolvedValueOnce(bytes);
    const result = await handleSave(settings, note([image(), image('img-2', otherBytes)]));
    expect(result).toMatchObject({ success: true, warning: '1 image could not be saved' });
    expect(api.putBinaryFileIfAbsent).toHaveBeenCalledTimes(1);
    const content = api.putFile.mock.calls[0][1] as string;
    expect(content.match(/sha256-/g)).toHaveLength(1);
    expect(content).toContain(await sha256Hex(bytes));
    expect(content).not.toContain(await sha256Hex(otherBytes));
    expect(content).not.toContain('g2o-image://');
  });

  it.each(['5.4.9', '5.5.0-beta', 'unknown'])(
    'does not write images through unsupported server %s',
    async self => {
      api.getServerVersions.mockResolvedValue({ self, obsidian: '1' });
      expect((await handleSave(settings, note())).warning).toBe('1 image could not be saved');
      expect(api.putBinaryFileIfAbsent).not.toHaveBeenCalled();
      expect(api.getBinaryFileBounded).not.toHaveBeenCalled();
    }
  );

  it('keeps disabled-image and image-free notes free of image API calls', async () => {
    await handleSave({ ...settings, enableImageExport: false }, note());
    expect(api.putFile.mock.calls[0][1]).not.toContain('g2o-image://');
    expect(api.getServerVersions).not.toHaveBeenCalled();
    expect(api.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    expect(api.putBinaryFile).not.toHaveBeenCalled();
  });
});

describe('ordinary File immutable image admission', () => {
  let listeners: Set<(delta: chrome.downloads.DownloadDelta) => void>;
  let items: Map<number, chrome.downloads.DownloadItem>;
  let nextId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = new Set();
    items = new Map();
    nextId = 1;
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(value => {
      listeners.add(value);
    });
    vi.mocked(chrome.downloads.onChanged.removeListener).mockImplementation(value => {
      listeners.delete(value);
    });
    vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
      const id = nextId++;
      items.set(id, {
        id,
        state: 'in_progress',
        exists: true,
        filename: `C:/Downloads/${options.filename}`,
      } as chrome.downloads.DownloadItem);
      callback?.(id);
      return id as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => {
      const item = items.get(id!);
      return item ? [item] : [];
    });
    vi.mocked(chrome.downloads.cancel).mockResolvedValue();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function started(count = 1) {
    // Hashing uses real WebCrypto, not a fake-timer microtask.
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledTimes(count));
    await vi.advanceTimersByTimeAsync(0);
  }
  function terminal(id: number, state: 'complete' | 'interrupted' = 'complete') {
    const item = items.get(id);
    if (item) item.state = state;
    for (const listener of [...listeners])
      listener({ id, state: { current: state } } as chrome.downloads.DownloadDelta);
  }
  function markdownCalls() {
    return vi
      .mocked(chrome.downloads.download)
      .mock.calls.filter(([options]) => options.url.startsWith('data:text/markdown'));
  }

  it('waits for exact image completion before Markdown; deduplicates identical bytes', async () => {
    const pending = handleMultiOutput(note([image(), image('img-2')]), ['file'], settings);
    await started();
    expect(markdownCalls()).toHaveLength(0);
    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: expect.stringMatching(/^liska-v1\/sha256-[a-f0-9]{64}\.png$/),
        conflictAction: 'uniquify',
      }),
      expect.any(Function)
    );
    terminal(1);
    expect((await pending).allSuccessful).toBe(true);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
    const content = new TextDecoder().decode(
      Uint8Array.from(atob(markdownCalls()[0][0].url.split(',')[1]), char => char.charCodeAt(0))
    );
    expect(content.match(/]\(<liska-v1\/sha256-/g)).toHaveLength(2);
  });

  it.each([
    'rename',
    'other-path',
    'missing-filename',
    'search-failure',
    'interrupted',
    'unknown',
    'timeout',
  ])('does not dispatch Markdown after an accepted image ID then %s', async failure => {
    const pending = handleMultiOutput(note(), ['file'], settings);
    await started();
    if (failure === 'rename')
      items.get(1)!.filename = items.get(1)!.filename.replace('.png', ' (1).png');
    if (failure === 'other-path') items.get(1)!.filename = 'C:/Downloads/unrelated.png';
    if (failure === 'missing-filename')
      delete (items.get(1) as Partial<chrome.downloads.DownloadItem>).filename;
    if (failure === 'search-failure')
      vi.mocked(chrome.downloads.search).mockRejectedValue(new Error('private'));
    if (failure === 'unknown') {
      items.delete(1);
      await vi.advanceTimersByTimeAsync(30_000);
    } else if (failure === 'timeout') await vi.advanceTimersByTimeAsync(35_000);
    else terminal(1, failure === 'interrupted' ? 'interrupted' : 'complete');
    expect((await pending).results[0]).toMatchObject({
      success: false,
      error: 'Image download failed (1 image)',
    });
    expect(markdownCalls()).toHaveLength(0);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
  });

  it('retains the first image but dispatches no Markdown when the second image fails', async () => {
    const pending = handleMultiOutput(
      note([image(), image('img-2', otherBytes)]),
      ['file'],
      settings
    );
    await started();
    terminal(1);
    await started(2);
    terminal(2, 'interrupted');
    expect((await pending).allSuccessful).toBe(false);
    expect(items.get(1)?.state).toBe('complete');
    expect(markdownCalls()).toHaveLength(0);
  });

  it.each([
    { state: 'complete', exists: false },
    { state: 'in_progress', exists: true },
    { state: 'interrupted', exists: true },
    { exists: true },
    { state: 'complete' },
  ])('rejects fresh searched item %j despite an earlier complete event', async evidence => {
    const pending = handleMultiOutput(note(), ['file'], settings, undefined, true);
    await started();
    const filename = items.get(1)!.filename;
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: 1, filename, ...evidence } as chrome.downloads.DownloadItem,
    ]);
    terminal(1);
    expect((await pending).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'unconfirmed',
      error: 'Image download failed (1 image)',
    });
    expect(markdownCalls()).toHaveLength(0);
  });

  it('never reports strict confirmed-success when an image path is unconfirmed', async () => {
    const pending = handleMultiOutput(note(), ['file'], settings, undefined, true);
    await started();
    items.delete(1);
    terminal(1);
    expect((await pending).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'unconfirmed',
    });
    expect(markdownCalls()).toHaveLength(0);
  });

  it('performs the strict Markdown terminal gate only after images are confirmed', async () => {
    const pending = handleMultiOutput(note(), ['file'], settings, undefined, true);
    await started();
    terminal(1);
    await started(2);
    terminal(2);
    expect((await pending).results[0]).toMatchObject({
      success: true,
      strictFileOutcome: 'confirmed-success',
    });
  });

  it('does not dispatch any files when a referenced image ID is ambiguous', async () => {
    const result = await handleMultiOutput(note([image(), image()]), ['file'], settings);
    expect(result.allSuccessful).toBe(false);
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('keeps assets beside a Markdown download requested in a subfolder', async () => {
    const pending = handleMultiOutput(
      { ...note(), fileName: 'Nested/ordinary.md' },
      ['file'],
      settings
    );
    await started();
    expect(vi.mocked(chrome.downloads.download).mock.calls[0][0].filename).toMatch(
      /^Nested\/liska-v1\//
    );
    terminal(1);
    expect((await pending).allSuccessful).toBe(true);
    expect(markdownCalls()[0][0].filename).toBe('Nested/ordinary.md');
  });

  it('does not dispatch Markdown after a thrown Downloads channel and exposes only a count failure', async () => {
    vi.mocked(chrome.downloads.download).mockImplementationOnce(() => {
      throw new Error('private path');
    });
    const result = await handleMultiOutput(note(), ['file'], settings, undefined, true);
    expect(result.results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'unconfirmed',
      error: 'Image download failed (1 image)',
    });
    expect(markdownCalls()).toHaveLength(0);
  });

  it('does not resume Markdown dispatch after a callback and completion arrive too late', async () => {
    let lateCallback: ((id?: number) => void) | undefined;
    vi.mocked(chrome.downloads.download).mockImplementationOnce((_options, callback) => {
      lateCallback = callback;
      return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    const pending = handleMultiOutput(note(), ['file'], settings, undefined, true);
    await started();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'unconfirmed',
    });
    items.set(55, {
      id: 55,
      state: 'complete',
      exists: true,
      filename: `C:/Downloads/${vi.mocked(chrome.downloads.download).mock.calls[0][0].filename}`,
    } as chrome.downloads.DownloadItem);
    lateCallback?.(55);
    terminal(55);
    await vi.advanceTimersByTimeAsync(0);
    expect(markdownCalls()).toHaveLength(0);
  });

  it('keeps disabled-image File behavior on the original ID-acceptance path', async () => {
    expect(
      (await handleMultiOutput(note(), ['file'], { ...settings, enableImageExport: false }))
        .allSuccessful
    ).toBe(true);
    expect(markdownCalls()).toHaveLength(1);
    expect(chrome.downloads.onChanged.addListener).not.toHaveBeenCalled();
  });

  it('keeps Clipboard text-only without any image persistence', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    expect((await handleMultiOutput(note(), ['clipboard'], settings)).allSuccessful).toBe(true);
    expect(chrome.downloads.download).not.toHaveBeenCalled();
    expect(api.getServerVersions).not.toHaveBeenCalled();
    const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
    expect(calls[0][0]).toMatchObject({
      action: 'clipboardWrite',
      content: expect.not.stringContaining('g2o-image://'),
    });
  });
});

describe('ordinary real parser-overflow loss boundary', () => {
  it('propagates the 200k-node overflow, blocks File, and warns while saving safely neutralized Obsidian text', async () => {
    // Each text/hard-break pair contributes two nodes without emphasis
    // resolution overhead, exceeding the production 200,000-node walk budget.
    const body = `${'x\\\n'.repeat(100_001)}\n${placeholder()}\n${placeholder('img-2')}`;
    const images = [image(), image('img-2', otherBytes), image()];
    const input = { ...note(images), body };
    const plan = await prepareOrdinaryImagePlan(body, images);
    expect(plan).toMatchObject({ parserFailed: true, failedImageCount: 2, assets: [] });
    expect(plan.namesById.size).toBe(0);

    const file = await handleMultiOutput(input, ['file'], settings, undefined, true);
    expect(file.results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'confirmed-failure',
    });
    expect(chrome.downloads.download).not.toHaveBeenCalled();

    const obsidian = await handleSave(settings, input);
    expect(obsidian).toMatchObject({ success: true, warning: '2 images could not be saved' });
    expect(api.getServerVersions).not.toHaveBeenCalled();
    expect(api.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    const content = api.putFile.mock.calls[0][1] as string;
    expect(content).toContain('x\\\nx\\\n');
    expect(content).toContain('&#33;&#91;synthetic](g2o-image://img-1)');
    expect(content).not.toContain('![synthetic]');
    expect(content).not.toContain('sha256-');
  });
});
