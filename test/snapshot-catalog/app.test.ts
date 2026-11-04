import { readFileSync } from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSnapshotCatalogPage } from '../../src/snapshot-catalog/app';
import { encodeSnapshotCatalog, SnapshotCatalogError } from '../../src/archive/catalog';
import { CATALOG_PAGE_LIMITS } from '../../src/snapshot-catalog/limits';
import { renderCatalog } from '../../src/snapshot-catalog/render';
import { COPY, t } from '../../src/snapshot-catalog/text';
import { catalog, picked, TRUSTED, UNTRUSTED, CANARY, deferred } from './fixtures';

const markup = readFileSync(
  path.resolve(import.meta.dirname, '../../src/snapshot-catalog/snapshot-catalog.html'),
  'utf8'
);
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const status = () => document.getElementById('catalog-status')!;
let page: ReturnType<typeof initSnapshotCatalogPage> | undefined;

function mount(supported = true, custom: Parameters<typeof initSnapshotCatalogPage>[1] = {}) {
  document.documentElement.innerHTML = markup.replace(/<!doctype html>/i, '');
  const picker = document.getElementById('catalog-picker') as HTMLInputElement;
  if (supported) Object.defineProperty(picker, 'webkitdirectory', { value: true });
  const build = vi.fn(async () => catalog());
  const save = vi.fn(async () => 'confirmed' as const);
  const reset = vi.fn();
  const late: ((outcome: 'confirmed' | 'failure' | 'unknown') => void)[] = [];
  page = initSnapshotCatalogPage(document, {
    build,
    hash: () => async () => 'a'.repeat(64),
    downloader: callback => {
      late.push(callback);
      return { save, reset };
    },
    ...custom,
  });
  return { page, picker, build, save, reset, late };
}

beforeEach(() => {
  vi.mocked(chrome.i18n.getMessage).mockImplementation(key => key);
});
afterEach(() => {
  page?.dispose();
  page = undefined;
  vi.restoreAllMocks();
});

describe('catalog page local authority and lifecycle', () => {
  it('starts inert and gates every action on trusted events', async () => {
    const { page, picker, build, save } = mount();
    const source = picked(`${CANARY}/manifest.json`);
    const click = vi.spyOn(picker, 'click').mockImplementation(() => {});
    page.pick(UNTRUSTED);
    page.select(UNTRUSTED, [source.file]);
    await page.build(UNTRUSTED);
    await page.save(UNTRUSTED);
    button('choose-archive').click();
    button('build-catalog').click();
    button('save-catalog').click();
    picker.dispatchEvent(new Event('change'));
    expect(click).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(source.read).not.toHaveBeenCalled();
    expect(button('build-catalog').disabled).toBe(true);
    page.pick(TRUSTED);
    expect(click).toHaveBeenCalledOnce();
    page.select(TRUSTED, [source.file]);
    page.clear(UNTRUSTED);
    page.cancel(UNTRUSTED);
    expect(button('build-catalog').disabled).toBe(false);
  });

  it('fails closed when directory selection is unavailable', async () => {
    const { page, build } = mount(false);
    const source = picked('root/manifest.json');
    page.select(TRUSTED, [source.file]);
    await page.build(TRUSTED);
    expect(button('choose-archive').disabled).toBe(true);
    expect(status().textContent).toBe(COPY.catalog_directory_unavailable);
    expect(build).not.toHaveBeenCalled();
    expect(source.read).not.toHaveBeenCalled();
  });

  it('captures all FileList metadata synchronously but reads only manifests on explicit Build', async () => {
    const { page, build, save } = mount();
    const source = picked(`${CANARY}/snap/manifest.json`);
    const raw = picked(`${CANARY}/snap/responses/${CANARY}.json`);
    const files = [source.file, raw.file];
    page.select(TRUSTED, files);
    files.length = 0;
    expect(source.read).not.toHaveBeenCalled();
    expect(raw.read).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(CANARY);
    await page.build(TRUSTED);
    expect(status().textContent).toBe(COPY.catalog_ready);
    expect(build).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        files: [
          { relativePath: 'snap/manifest.json', byteLength: 2 },
          { relativePath: `snap/responses/${CANARY}.json`, byteLength: 2 },
        ],
        manifests: [{ relativePath: 'snap/manifest.json', bytes: source.bytes }],
        limits: expect.objectContaining({ maxSelectedFiles: CATALOG_PAGE_LIMITS.maxFiles }),
      })
    );
    expect(raw.read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(status().dataset.state).toBe('ready');
    expect(document.querySelectorAll('.evidence-card')).toHaveLength(1);
    expect(document.body.textContent).not.toContain(CANARY);
    await page.save(TRUSTED);
    expect(save).toHaveBeenCalledOnce();
    expect(Array.from(save.mock.calls[0][0])).toEqual(Array.from(encodeSnapshotCatalog(catalog())));
    const json = new TextDecoder().decode(save.mock.calls[0][0]);
    expect(JSON.parse(json).entries[0].conversationId).toBe(CANARY);
    expect(json).not.toMatch(/relativePath|snap\/|responses\/|rootLocator|archiveRoot/u);
    expect(document.getElementById('download-status')!.textContent).toBe(COPY.catalog_confirmed);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('uses the real core builder and encoder for a selected invalid manifest without reading raw files', async () => {
    const { buildSnapshotCatalog } = await import('../../src/archive/catalog');
    const { page } = mount(true, {
      build: buildSnapshotCatalog,
      hash: () => async bytes =>
        Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)), byte =>
          byte.toString(16).padStart(2, '0')
        ).join(''),
    });
    const manifest = picked(`${CANARY}/snap/manifest.json`, '{');
    const raw = picked(`${CANARY}/snap/responses/${CANARY}.json`);
    page.select(TRUSTED, [manifest.file, raw.file]);
    await page.build(TRUSTED);
    expect(status().dataset.state).toBe('ready');
    expect(document.getElementById('catalog-report')!.textContent).toContain(COPY.catalog_invalid);
    expect(raw.read).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it('shows exact sequential read progress and cancels before the next manifest', async () => {
    const { page, build } = mount();
    const one = picked('r/a/manifest.json', '123');
    const two = picked('r/b/manifest.json', '4567');
    const pendingOne = deferred<ArrayBuffer>();
    const pendingTwo = deferred<ArrayBuffer>();
    one.read.mockReturnValueOnce(pendingOne.promise);
    two.read.mockReturnValueOnce(pendingTwo.promise);
    page.select(TRUSTED, [one.file, two.file]);
    const operation = page.build(TRUSTED);
    expect(status().textContent).toContain('0/2');
    expect(status().textContent).toContain('0/7');
    expect(two.read).not.toHaveBeenCalled();
    pendingOne.resolve(one.bytes.buffer);
    await vi.waitFor(() => expect(two.read).toHaveBeenCalledOnce());
    expect(status().textContent).toContain('1/2');
    expect(status().textContent).toContain('3/7');
    page.cancel(TRUSTED);
    pendingTwo.resolve(two.bytes.buffer);
    await operation;
    expect(status().dataset.state).toBe('cancelled');
    expect(build).not.toHaveBeenCalled();
    expect(button('save-catalog').disabled).toBe(true);
  });

  it.each(['cancel', 'clear', 'select', 'dispose', 'pagehide'])(
    'discards late core completion after %s',
    async action => {
      const pending = deferred<ReturnType<typeof catalog>>();
      const build = vi.fn(() => pending.promise);
      const { page } = mount(true, { build });
      page.select(TRUSTED, [picked('r/manifest.json').file]);
      const operation = page.build(TRUSTED);
      await vi.waitFor(() => expect(build).toHaveBeenCalledOnce());
      if (action === 'cancel') page.cancel(TRUSTED);
      if (action === 'clear') page.clear(TRUSTED);
      if (action === 'select') page.select(TRUSTED, [picked('new/manifest.json').file]);
      if (action === 'dispose') page.dispose();
      if (action === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      pending.resolve(catalog());
      await operation;
      expect(button('save-catalog').disabled).toBe(true);
      expect(document.querySelectorAll('.evidence-card')).toHaveLength(0);
    }
  );

  it.each(['clear', 'select', 'dispose'])(
    'drops a late manifest read after %s without reading the next file',
    async action => {
      const { page, build } = mount();
      const first = picked('r/a/manifest.json');
      const next = picked('r/b/manifest.json');
      const pending = deferred<ArrayBuffer>();
      first.read.mockReturnValueOnce(pending.promise);
      page.select(TRUSTED, [first.file, next.file]);
      const operation = page.build(TRUSTED);
      if (action === 'clear') page.clear(TRUSTED);
      if (action === 'select') page.select(TRUSTED, [picked('new/manifest.json').file]);
      if (action === 'dispose') page.dispose();
      pending.resolve(first.bytes.buffer);
      await operation;
      expect(next.read).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
      expect(button('save-catalog').disabled).toBe(true);
    }
  );

  it.each(['clear', 'select', 'dispose'])(
    'drops a pending download completion after %s',
    async action => {
      const pending = deferred<'confirmed'>();
      const { page } = mount(true, {
        downloader: () => ({ save: () => pending.promise, reset: vi.fn() }),
      });
      page.select(TRUSTED, [picked('r/manifest.json').file]);
      await page.build(TRUSTED);
      const operation = page.save(TRUSTED);
      if (action === 'clear') page.clear(TRUSTED);
      if (action === 'select') page.select(TRUSTED, [picked('new/manifest.json').file]);
      if (action === 'dispose') page.dispose();
      pending.resolve('confirmed');
      await operation;
      expect(document.getElementById('download-status')!.textContent).toBe('');
      expect(button('save-catalog').disabled).toBe(true);
    }
  );

  it.each(['native', 'fixed', 'accessor', 'unknown-code', 'forged-catalog'])(
    'renders only fixed failure text for %s core errors',
    async mode => {
      const build = vi.fn(async () => {
        if (mode === 'fixed') throw new SnapshotCatalogError('limit-exceeded');
        if (mode === 'accessor')
          throw Object.defineProperty({}, 'code', {
            get() {
              throw new Error(CANARY);
            },
          });
        if (mode === 'unknown-code') throw { code: CANARY };
        if (mode === 'forged-catalog') return { ...catalog(), title: CANARY };
        throw new Error(CANARY);
      });
      const { page } = mount(true, { build });
      page.select(TRUSTED, [picked('root/manifest.json').file]);
      await page.build(TRUSTED);
      expect(status().dataset.state).toBe('error');
      expect(status().textContent).toContain(COPY.catalog_error);
      if (mode === 'fixed') expect(status().textContent).toContain('(limit-exceeded)');
      expect(document.body.textContent).not.toContain(CANARY);
      expect(button('save-catalog').disabled).toBe(true);
    }
  );

  it('keeps the current report and observer when the picker is cancelled or rejects a new folder', async () => {
    const { page, reset } = mount();
    page.select(TRUSTED, [picked('r/manifest.json').file]);
    await page.build(TRUSTED);
    await page.save(TRUSTED);
    const content = document.getElementById('catalog-report')!.textContent;
    page.select(TRUSTED, []);
    page.select(TRUSTED, [picked('bad').file]);
    expect(document.getElementById('catalog-report')!.textContent).toBe(content);
    expect(reset).not.toHaveBeenCalled();
    page.select(TRUSTED, [picked('new/manifest.json').file]);
    expect(reset).toHaveBeenCalledOnce();
    expect(button('save-catalog').disabled).toBe(true);
  });

  it('sanitizes hostile selection failures, manifest read failures, and encoder failures', async () => {
    const { page } = mount();
    page.select(
      TRUSTED,
      Object.defineProperty({}, 'length', {
        get() {
          throw new Error(CANARY);
        },
      }) as FileList
    );
    expect(status().textContent).toBe(COPY.catalog_error);
    page.select(TRUSTED, [picked(`${CANARY}//manifest.json`).file]);
    expect(status().textContent).toBe(COPY.catalog_selection_invalid);
    const manifest = picked('r/manifest.json');
    manifest.read.mockRejectedValueOnce(new Error(CANARY));
    page.select(TRUSTED, [manifest.file]);
    await page.build(TRUSTED);
    expect(status().textContent).toBe(COPY.catalog_selection_read_failed);
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it.each(['missing-associated-count', 'missing-canonical-role', 'incorrect-total'])(
    'fails closed on current core schema mismatch: %s',
    async mode => {
      const build = vi.fn(async () => {
        const value = catalog();
        const entry = value.entries[0];
        if (mode === 'missing-associated-count')
          delete (entry as Partial<typeof entry>).associatedFileCount;
        if (mode === 'missing-canonical-role')
          delete (entry.canonical as Partial<typeof entry.canonical>).declaredFileRole;
        if (mode === 'incorrect-total') value.selectedFileCount += 1;
        return value;
      });
      const { page, save } = mount(true, { build });
      page.select(TRUSTED, [picked('root/manifest.json').file]);
      await page.build(TRUSTED);
      expect(status().dataset.state).toBe('error');
      expect(status().textContent).toContain('(invalid-catalog)');
      expect(button('save-catalog').disabled).toBe(true);
      expect(document.querySelectorAll('.evidence-card')).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
    }
  );

  it.each(['unknown', 'failure', 'throw'] as const)(
    'blocks repeated %s Save and old late callbacks after clear/new selection',
    async outcome => {
      const save = vi.fn(async () => {
        if (outcome === 'throw') throw new Error(CANARY);
        return outcome;
      });
      const { page, late } = mount(true, {
        downloader: callback => {
          late.push(callback);
          return { save, reset: vi.fn() };
        },
      });
      page.select(TRUSTED, [picked('r/manifest.json').file]);
      await page.build(TRUSTED);
      await page.save(TRUSTED);
      await page.save(TRUSTED);
      await page.build(TRUSTED);
      expect(save).toHaveBeenCalledOnce();
      expect(button('save-catalog').disabled).toBe(true);
      const oldLate = late[0];
      page.clear(TRUSTED);
      page.select(TRUSTED, [picked('n/manifest.json').file]);
      await page.build(TRUSTED);
      await page.save(TRUSTED);
      oldLate('confirmed');
      expect(document.getElementById('download-status')!.textContent).toBe(
        outcome === 'failure' ? COPY.catalog_failure : COPY.catalog_unknown
      );
      expect(document.body.textContent).not.toContain(CANARY);
    }
  );

  it('serializes double-click saves, updates late terminal state and drops stale Save completion', async () => {
    const pending = deferred<'unknown'>();
    const save = vi.fn(() => pending.promise);
    const { page, late } = mount(true, {
      downloader: callback => {
        late.push(callback);
        return { save, reset: vi.fn() };
      },
    });
    page.select(TRUSTED, [picked('r/manifest.json').file]);
    await page.build(TRUSTED);
    const operation = page.save(TRUSTED);
    await page.save(TRUSTED);
    expect(save).toHaveBeenCalledOnce();
    pending.resolve('unknown');
    await operation;
    late[0]('confirmed');
    expect(document.getElementById('download-status')!.textContent).toBe(COPY.catalog_confirmed);
    expect(button('save-catalog').disabled).toBe(true);
    page.clear(TRUSTED);
    late[0]('failure');
    expect(document.getElementById('download-status')!.textContent).toBe('');
    page.dispose();
    page.pick(TRUSTED);
    page.select(TRUSTED, [picked('x/manifest.json').file]);
    await page.build(TRUSTED);
    await page.save(TRUSTED);
    expect(save).toHaveBeenCalledOnce();
  });

  it('renders only ordinal and fixed enum/count fields, including unsupported/invalid/empty entries', () => {
    mount();
    const report = document.getElementById('catalog-report')!;
    const value = catalog();
    renderCatalog(report, value);
    expect(report.textContent).not.toContain(CANARY);
    expect(report.textContent).not.toContain(value.entries[0].conversationKey!);
    expect(report.querySelector('.evidence-card')!.textContent).toContain(
      `${value.entries[0].associatedFileCount} ${COPY.catalog_files}`
    );
    const encoded = JSON.parse(new TextDecoder().decode(encodeSnapshotCatalog(value)));
    expect(encoded.entries[0].associatedFileCount).toBe(3);
    expect(encoded.entries[0].canonical.declaredFileRole).toBeNull();
    expect(encoded.selectedFileCount).toBe(
      encoded.unassociatedFileCount +
        encoded.entries[0].associatedFileCount * encoded.entries[0].occurrenceCount
    );
    for (const validity of ['invalid', 'unsupported'] as const) {
      value.entries[0].manifestValidity = validity;
      value.entries[0].declaredCompleteness = null;
      value.entries[0].artifacts = null;
      value.entries[0].assets = null;
      value.entries[0].canonical = { presence: 'absent', byteLength: null, declaredFileRole: null };
      renderCatalog(report, value);
      expect(report.textContent).toContain(COPY[`catalog_${validity}`]);
    }
    renderCatalog(report, { ...value, entries: [] });
    expect(report.textContent).toContain(COPY.catalog_noEntries);
  });

  it('localizes fixed copy with fallback and no source-dependent labels', () => {
    const { page } = mount();
    vi.mocked(chrome.i18n.getMessage).mockImplementation(() => {
      throw new Error(CANARY);
    });
    expect(t('catalog_title')).toBe(COPY.catalog_title);
    page.dispose();
    Object.assign(chrome.i18n, { getUILanguage: () => 'ja-JP' });
    mount();
    expect(document.documentElement.lang).toBe('ja');
    delete (chrome.i18n as { getUILanguage?: unknown }).getUILanguage;
  });
});
