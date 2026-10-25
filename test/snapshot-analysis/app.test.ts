import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSnapshotAnalysisPage } from '../../src/snapshot-analysis/app';
import { encodeSnapshotAnalysisPlan } from '../../src/archive/snapshots';
import {
  SnapshotAnalysisError,
  SNAPSHOT_PRESERVATION_REASONS,
  SNAPSHOT_RELATION_CLASSES,
} from '../../src/archive/snapshots/contracts';
import { renderPlan } from '../../src/snapshot-analysis/render';
import { COPY, t } from '../../src/snapshot-analysis/text';
import { plan, picked, TRUSTED, UNTRUSTED, CANARY, deferred } from './fixtures';

const markup = readFileSync(
  path.resolve(import.meta.dirname, '../../src/snapshot-analysis/snapshot-analysis.html'),
  'utf8'
);
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const status = () => document.getElementById('analysis-status')!;
let page: ReturnType<typeof initSnapshotAnalysisPage> | undefined;

function mount(supported = true, custom: Parameters<typeof initSnapshotAnalysisPage>[1] = {}) {
  document.documentElement.innerHTML = markup.replace(/<!doctype html>/i, '');
  const picker = document.getElementById('snapshot-picker') as HTMLInputElement;
  if (supported) Object.defineProperty(picker, 'webkitdirectory', { value: true });
  const analyze = vi.fn(async () => plan());
  const save = vi.fn(async () => 'confirmed' as const);
  const reset = vi.fn();
  let late: (outcome: 'confirmed' | 'failure' | 'unknown') => void = () => {};
  page = initSnapshotAnalysisPage(document, {
    analyze,
    hash: () => async () => 'a'.repeat(64),
    downloader: callback => {
      late = callback;
      return { save, reset };
    },
    ...custom,
  });
  return {
    page,
    picker,
    analyze,
    save,
    reset,
    late: (value: 'confirmed' | 'failure' | 'unknown') => late(value),
  };
}

function addPair(controller: NonNullable<typeof page>) {
  controller.add(TRUSTED, [picked(`${CANARY}-one/manifest.json`, CANARY).file]);
  controller.add(TRUSTED, [picked(`${CANARY}-two/manifest.json`, CANARY).file]);
}

beforeEach(() => {
  vi.mocked(chrome.i18n.getMessage).mockImplementation(key => key);
});
afterEach(() => {
  page?.dispose();
  page = undefined;
  vi.restoreAllMocks();
});

describe('snapshot analysis local page', () => {
  it('starts inert and never reads, analyzes or saves without trusted actions', async () => {
    const { page, picker, analyze, save } = mount();
    const source = picked(`${CANARY}/manifest.json`);
    const click = vi.spyOn(picker, 'click').mockImplementation(() => {});
    page.pick(UNTRUSTED);
    page.add(UNTRUSTED, [source.file]);
    await page.analyze(UNTRUSTED);
    await page.save(UNTRUSTED);
    button('add-snapshot').click();
    button('analyze-snapshots').click();
    button('save-report').click();
    expect(click).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(source.read).not.toHaveBeenCalled();
    expect(button('analyze-snapshots').disabled).toBe(true);
    expect(button('save-report').disabled).toBe(true);
    page.pick(TRUSTED);
    expect(click).toHaveBeenCalledOnce();
  });

  it('refuses unsupported directory selection without a flat-file fallback', () => {
    const { page } = mount(false);
    page.add(TRUSTED, [picked('root/file').file]);
    expect(button('add-snapshot').disabled).toBe(true);
    expect(status().textContent).toBe(COPY.snapshot_directory_unavailable);
    expect(document.querySelectorAll('.snapshot-row')).toHaveLength(0);
  });

  it('renders only ordinal metadata, produces a report, then saves only exact encoder bytes on explicit Save', async () => {
    const { page, analyze, save } = mount();
    const consoleSpy = vi.spyOn(console, 'error');
    addPair(page);
    expect(document.body.textContent).not.toContain(CANARY);
    expect(document.querySelectorAll('.snapshot-row')).toHaveLength(2);
    await page.analyze(TRUSTED);
    expect(analyze).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(status().dataset.state).toBe('ready');
    expect(document.getElementById('analysis-report')!.textContent).toContain(
      COPY.snapshot_keepBoth
    );
    expect(document.body.textContent).not.toContain(CANARY);
    expect(consoleSpy).not.toHaveBeenCalled();
    await page.save(TRUSTED);
    expect(save).toHaveBeenCalledExactlyOnceWith(encodeSnapshotAnalysisPlan(plan()));
    expect(document.getElementById('download-status')!.textContent).toBe(COPY.snapshot_confirmed);
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps a ready unknown-download report when picker is cancelled or a folder is rejected', async () => {
    const save = vi.fn(async () => 'unknown' as const);
    const reset = vi.fn();
    let late: (value: 'confirmed') => void = () => {};
    const { page, picker } = mount(true, {
      downloader: callback => {
        late = callback;
        return { save, reset };
      },
    });
    const click = vi.spyOn(picker, 'click').mockImplementation(() => {});
    addPair(page);
    await page.analyze(TRUSTED);
    await page.save(TRUSTED);
    const report = document.getElementById('analysis-report')!.textContent;
    const resetCalls = reset.mock.calls.length;

    page.pick(TRUSTED);
    page.add(TRUSTED, []);
    const rejected = picked('invalid-rootless-file');
    page.add(TRUSTED, [rejected.file]);

    expect(click).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledTimes(resetCalls);
    expect(rejected.read).not.toHaveBeenCalled();
    expect(document.getElementById('analysis-report')!.textContent).toBe(report);
    expect(document.getElementById('download-status')!.textContent).toBe(COPY.snapshot_unknown);
    late('confirmed');
    expect(document.getElementById('download-status')!.textContent).toBe(COPY.snapshot_confirmed);
  });

  it('preserves extra nested slots in the analyzer input without displaying them', async () => {
    const { page, analyze } = mount();
    page.add(TRUSTED, [
      picked(`${CANARY}/responses/conversation.json`).file,
      picked(`${CANARY}/nested/${CANARY}.bin`).file,
    ]);
    page.add(TRUSTED, [picked('second/manifest.json').file]);
    await page.analyze(TRUSTED);
    expect(analyze.mock.calls[0][0].snapshots[0].files.map(item => item.relativePath)).toEqual([
      'responses/conversation.json',
      `nested/${CANARY}.bin`,
    ]);
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it('invalidates reports on any new selection or removal and rejects extra folders before reads', async () => {
    const { page, save } = mount();
    addPair(page);
    await page.analyze(TRUSTED);
    page.remove(UNTRUSTED, 0);
    expect(button('save-report').disabled).toBe(false);
    page.remove(TRUSTED, 0);
    expect(button('save-report').disabled).toBe(true);
    expect(document.querySelectorAll('.evidence-card')).toHaveLength(0);
    for (let i = 1; i < 16; i++) page.add(TRUSTED, [picked(`root${i}/f.json`).file]);
    expect(button('add-snapshot').disabled).toBe(true);
    const extra = picked('too-many/f.json');
    page.add(TRUSTED, [extra.file]);
    expect(status().textContent).toBe(COPY.snapshot_selection_limit);
    expect(extra.read).not.toHaveBeenCalled();
    page.remove(TRUSTED, -1);
    page.remove(TRUSTED, 99);
    page.remove(TRUSTED, 0.5);
    page.clear(UNTRUSTED);
    expect(document.querySelectorAll('.snapshot-row')).toHaveLength(16);
    page.clear(TRUSTED);
    expect(document.querySelectorAll('.snapshot-row')).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  it('sanitizes invalid selection and read errors without displaying native text', async () => {
    const { page } = mount();
    page.add(TRUSTED, [picked(`${CANARY}//bad`).file]);
    expect(status().textContent).toBe(COPY.snapshot_selection_invalid);
    const first = picked(`${CANARY}/x`);
    first.read.mockRejectedValueOnce(new Error(CANARY));
    page.add(TRUSTED, [first.file]);
    page.add(TRUSTED, [picked('root/x').file]);
    await page.analyze(TRUSTED);
    expect(status().textContent).toBe(COPY.snapshot_selection_read_failed);
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it.each(['native', 'fixed', 'accessor', 'forged-plan'])(
    'sanitizes analyzer %s failure',
    async mode => {
      const analyze = vi.fn(async () => {
        if (mode === 'fixed') throw new SnapshotAnalysisError('limit-exceeded');
        if (mode === 'accessor')
          throw Object.defineProperty({}, 'code', {
            get() {
              throw new Error(CANARY);
            },
          });
        if (mode === 'forged-plan') return { ...plan(), private: CANARY };
        throw new Error(CANARY);
      });
      const { page } = mount(true, { analyze });
      addPair(page);
      await page.analyze(TRUSTED);
      expect(status().dataset.state).toBe('error');
      expect(status().textContent).toContain(COPY.snapshot_error);
      expect(document.body.textContent).not.toContain(CANARY);
      expect(button('save-report').disabled).toBe(true);
    }
  );

  it('cancels during a read and discards late resolution without analysis or save', async () => {
    const { page, analyze, save } = mount();
    const first = picked('root/x');
    const pending = deferred<ArrayBuffer>();
    first.read.mockReturnValueOnce(pending.promise);
    page.add(TRUSTED, [first.file]);
    page.add(TRUSTED, [picked('other/x').file]);
    const operation = page.analyze(TRUSTED);
    page.cancel(UNTRUSTED);
    expect(button('cancel-analysis').disabled).toBe(false);
    page.cancel(TRUSTED);
    expect(status().dataset.state).toBe('cancelled');
    pending.resolve(first.bytes.buffer);
    await operation;
    expect(analyze).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(button('save-report').disabled).toBe(true);
  });

  it.each(['cancel', 'remove', 'clear', 'dispose'])(
    'discards a late analyzer result after %s',
    async action => {
      const pending = deferred<ReturnType<typeof plan>>();
      const analyze = vi.fn(() => pending.promise);
      const { page } = mount(true, { analyze });
      addPair(page);
      const operation = page.analyze(TRUSTED);
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledOnce());
      if (action === 'cancel') page.cancel(TRUSTED);
      if (action === 'remove') page.remove(TRUSTED, 0);
      if (action === 'clear') page.clear(TRUSTED);
      if (action === 'dispose') page.dispose();
      pending.resolve(plan());
      await operation;
      expect(button('save-report').disabled).toBe(true);
      expect(document.querySelectorAll('.evidence-card')).toHaveLength(0);
    }
  );

  it('blocks unknown download retry until reset/new analysis and accepts late terminal status', async () => {
    const save = vi.fn(async () => 'unknown' as const);
    let late: (value: 'confirmed') => void = () => {};
    const { page } = mount(true, {
      downloader: callback => {
        late = callback;
        return { save, reset: vi.fn() };
      },
    });
    addPair(page);
    await page.analyze(TRUSTED);
    await page.save(TRUSTED);
    await page.save(TRUSTED);
    expect(save).toHaveBeenCalledOnce();
    expect(button('save-report').disabled).toBe(true);
    expect(document.getElementById('download-status')!.textContent).toBe(COPY.snapshot_unknown);
    late('confirmed');
    expect(button('save-report').disabled).toBe(false);
    await page.analyze(TRUSTED);
    expect(button('save-report').disabled).toBe(false);
  });

  it('serializes double-click saves and ignores stale saving completion', async () => {
    const pending = deferred<'confirmed'>();
    const save = vi.fn(() => pending.promise);
    const { page } = mount(true, { downloader: () => ({ save, reset: vi.fn() }) });
    addPair(page);
    await page.analyze(TRUSTED);
    const operation = page.save(TRUSTED);
    await page.save(TRUSTED);
    expect(save).toHaveBeenCalledOnce();
    page.clear(TRUSTED);
    pending.resolve('confirmed');
    await operation;
    expect(document.getElementById('download-status')!.textContent).toBe('');
  });

  it('maps unexpected saving failure to uncertainty, not a retry or native error', async () => {
    const { page } = mount(true, {
      downloader: () => ({
        save: async () => {
          throw Error(CANARY);
        },
        reset: vi.fn(),
      }),
    });
    addPair(page);
    await page.analyze(TRUSTED);
    await page.save(TRUSTED);
    expect(button('save-report').disabled).toBe(true);
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it('shows exact read progress then indeterminate analysis', async () => {
    const pending = deferred<ReturnType<typeof plan>>();
    const analyze = vi.fn(() => pending.promise);
    const { page } = mount(true, { analyze });
    addPair(page);
    const operation = page.analyze(TRUSTED);
    await vi.waitFor(() => expect(analyze).toHaveBeenCalled());
    expect(status().dataset.state).toBe('analyzing');
    expect(status().textContent).toBe(COPY.snapshot_analyzing);
    pending.resolve(plan());
    await operation;
  });

  it('renders every fixed preservation label and relation without unsafe markup', () => {
    const { page } = mount();
    const candidate = plan();
    candidate.snapshots[0].preserveReasons = [...SNAPSHOT_PRESERVATION_REASONS];
    candidate.snapshots[0].verification = 'unverifiable';
    candidate.snapshots[0].code = 'missing-evidence';
    const container = document.getElementById('analysis-report')!;
    for (const classification of SNAPSHOT_RELATION_CLASSES) {
      candidate.relations[0].classification = classification;
      renderPlan(container, candidate);
      expect(container.textContent).toContain(COPY.snapshot_keepBoth);
    }
    candidate.relations = [];
    renderPlan(container, candidate);
    expect(container.textContent).toContain(COPY.snapshot_noRelations);
    expect(container.querySelectorAll('script,img,iframe')).toHaveLength(0);
    page.clear(TRUSTED);
  });

  it('falls back to fixed English when localization fails', () => {
    vi.mocked(chrome.i18n.getMessage).mockImplementation(() => {
      throw Error(CANARY);
    });
    expect(t('snapshot_title')).toBe(COPY.snapshot_title);
    vi.mocked(chrome.i18n.getMessage).mockReturnValue('ローカル比較');
    expect(t('snapshot_title')).toBe('ローカル比較');
  });

  it('sets a validated browser UI language on the localized document', () => {
    const original = Object.getOwnPropertyDescriptor(chrome.i18n, 'getUILanguage');
    const language = vi.fn(() => 'ja-JP');
    Object.defineProperty(chrome.i18n, 'getUILanguage', {
      configurable: true,
      value: language,
    });
    try {
      const first = mount();
      expect(document.documentElement.lang).toBe('ja');
      expect(document.getElementById('analysis-heading')!.textContent).toBe(COPY.snapshot_analysis);
      first.page.dispose();
      language.mockReturnValue('ru');
      const fallback = mount();
      expect(document.documentElement.lang).toBe('en');
      fallback.page.clear(TRUSTED);
    } finally {
      if (original) Object.defineProperty(chrome.i18n, 'getUILanguage', original);
      else delete (chrome.i18n as { getUILanguage?: unknown }).getUILanguage;
    }
  });

  it('keeps all installed DOM listeners inert for untrusted selection/actions', async () => {
    const { page, picker, analyze, save } = mount();
    addPair(page);
    Object.defineProperty(picker, 'files', { value: [picked('third/x').file], configurable: true });
    picker.dispatchEvent(new Event('change'));
    for (const id of ['analyze-snapshots', 'cancel-analysis', 'clear-snapshots', 'save-report'])
      button(id).dispatchEvent(new MouseEvent('click'));
    document.querySelector<HTMLButtonElement>('.snapshot-row button')!.click();
    expect(document.querySelectorAll('.snapshot-row')).toHaveLength(2);
    expect(analyze).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    Object.defineProperty(picker, 'files', { value: null });
    picker.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('pagehide'));
    page.add(TRUSTED, [picked('third/x').file]);
    await page.analyze(TRUSTED);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('rejects an incomplete page without reaching storage or downloads', () => {
    document.body.replaceChildren();
    expect(() => initSnapshotAnalysisPage(document)).toThrow('snapshot-page-incomplete');
  });

  it('handles a late download after dispose and a stale rejected save without changing the page', async () => {
    const pending = deferred<'confirmed'>();
    const { page, late } = mount(true, {
      downloader: () => ({ save: () => pending.promise, reset: vi.fn() }),
    });
    addPair(page);
    await page.analyze(TRUSTED);
    const operation = page.save(TRUSTED);
    page.dispose();
    pending.reject(new Error(CANARY));
    await operation;
    late('confirmed');
    expect(document.body.textContent).not.toContain(CANARY);
  });
});
