import { readFileSync } from 'node:fs';
import path from 'node:path';
import { File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSnapshotCatalog } from '../../../src/archive/catalog';
import {
  createJournal,
  encodeJournal,
  transitionJournal,
  type ResumabilityJournal,
} from '../../../src/resumability-journal/core';
import { initJournalPage, type Dependencies } from '../../../src/resumability-journal/page/app';
import { COPY } from '../../../src/resumability-journal/page/text';
import { catalog, CANARY, deferred, TRUSTED, UNTRUSTED } from '../../snapshot-catalog/fixtures';

const html = readFileSync(
  path.resolve(import.meta.dirname, '../../../src/resumability-journal/page/journal.html'),
  'utf8'
);
const pages: ReturnType<typeof initJournalPage>[] = [];
afterEach(() => {
  for (const page of pages.splice(0)) page.dispose();
  vi.restoreAllMocks();
});
function journal(runId = 'private-run'): ResumabilityJournal {
  return createJournal({
    runId,
    catalogSha256: 'c'.repeat(64),
    items: [
      {
        itemId: 'private-item',
        provider: 'chatgpt',
        conversationId: CANARY,
        conversationKey: catalog().entries[0].conversationKey!,
      },
    ],
  });
}
function store(records: ResumabilityJournal[] = []) {
  const values = new Map(records.map(record => [record.runId, record]));
  return {
    open: vi.fn(async () => {}),
    close: vi.fn(),
    create: vi.fn(async (record: ResumabilityJournal) => {
      values.set(record.runId, record);
      return record;
    }),
    read: vi.fn(async (id: string) => values.get(id)),
    list: vi.fn(async () =>
      [...values.values()].map(({ runId, revision, control }) => ({ runId, revision, control }))
    ),
    recoverAll: vi.fn(async () => {
      for (const [key, value] of values)
        values.set(
          key,
          transitionJournal(value, {
            type: 'recover-after-restart',
            expectedRunRevision: value.revision,
          }).journal
        );
      return [...values.values()];
    }),
  };
}
function file(bytes = encodeSnapshotCatalog(catalog())): File {
  return new NodeFile([new Uint8Array(bytes)], CANARY + '.json') as unknown as File;
}
function mount(options: Partial<Dependencies> = {}, records: ResumabilityJournal[] = []) {
  document.documentElement.innerHTML = html;
  let sequence = 0;
  const storage = store(records);
  const uuid = vi.fn(() => `local-${++sequence}`);
  const save = vi.fn(async () => 'confirmed' as const);
  const reset = vi.fn();
  const page = initJournalPage(document, {
    store: storage,
    uuid,
    hash: async () => 'c'.repeat(64),
    downloader: () => ({ save, reset }),
    ...options,
  });
  pages.push(page);
  return { page, storage, uuid, save, reset };
}
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;

describe('private inert journal page', () => {
  it.each(['uuid', 'duplicate-item-uuid', 'core'] as const)(
    'keeps the healthy store and existing journals usable after a pre-persistence %s failure',
    async failure => {
      let sequence = 0;
      const uuid = vi.fn(() => {
        const ordinal = ++sequence;
        if (failure === 'uuid') throw new Error(CANARY);
        return failure === 'duplicate-item-uuid' && ordinal > 1
          ? 'duplicate-item'
          : `local-${ordinal}`;
      });
      const create = vi.fn(createJournal);
      if (failure === 'core')
        create.mockImplementation(() => {
          throw new Error(CANARY);
        });
      const value = catalog();
      if (failure === 'duplicate-item-uuid') {
        value.entries.push({
          ...value.entries[0],
          conversationId: 'other-private-conversation',
          conversationKey: 'liska-conversation-key/1:' + 'd'.repeat(64),
          captureId: 'other-capture',
          manifestSha256: 'd'.repeat(64),
        });
        value.selectedManifestCount = 2;
        value.selectedFileCount = 7;
      }
      const selected = file(encodeSnapshotCatalog(value));
      const { page, storage, save } = mount({ uuid, create }, [journal()]);
      await page.ready;
      const existing = document.getElementById('journal-runs')!.textContent;
      await page.select(TRUSTED, [selected]);
      await page.create(TRUSTED);
      const expectedUuids = failure === 'uuid' ? 1 : failure === 'core' ? 2 : 3;
      expect(uuid).toHaveBeenCalledTimes(expectedUuids);
      expect(create).toHaveBeenCalledTimes(failure === 'uuid' ? 0 : 1);
      expect(storage.create).not.toHaveBeenCalled();
      expect(storage.close).not.toHaveBeenCalled();
      expect(storage.list).toHaveBeenCalledOnce();
      expect(document.getElementById('journal-runs')!.textContent).toBe(existing);
      expect(document.body.textContent).not.toContain(CANARY);
      expect(button('choose-catalog').disabled).toBe(false);
      expect(button('create-journal').disabled).toBe(true);
      expect(document.querySelector<HTMLButtonElement>('#journal-runs button')!.disabled).toBe(
        false
      );
      await page.create(TRUSTED);
      expect(uuid).toHaveBeenCalledTimes(expectedUuids); // No automatic or same-admission retry.
      await page.save(TRUSTED, 0);
      expect(save).toHaveBeenCalledOnce();
      page.clear(TRUSTED);
      await page.select(TRUSTED, [selected]);
      expect(button('create-journal').disabled).toBe(false);
      expect(uuid).toHaveBeenCalledTimes(expectedUuids);
      expect(storage.close).not.toHaveBeenCalled();
      expect(storage.create).not.toHaveBeenCalled();
    }
  );
  it('opens and explicitly recovers before listing; cannot create automatically or from synthetic events', async () => {
    const { page, storage, uuid } = mount();
    await page.ready;
    expect(storage.open).toHaveBeenCalledOnce();
    expect(storage.recoverAll).toHaveBeenCalledOnce();
    expect(storage.list).toHaveBeenCalledOnce();
    expect(storage.open.mock.invocationCallOrder[0]).toBeLessThan(
      storage.recoverAll.mock.invocationCallOrder[0]
    );
    expect(storage.recoverAll.mock.invocationCallOrder[0]).toBeLessThan(
      storage.list.mock.invocationCallOrder[0]
    );
    await page.select(UNTRUSTED, [file()]);
    await page.create(TRUSTED);
    button('choose-catalog').click();
    await page.create(UNTRUSTED);
    expect(uuid).not.toHaveBeenCalled();
    expect(storage.create).not.toHaveBeenCalled();
    expect(button('create-journal').disabled).toBe(true);
  });
  it('admits exact canonical bytes, discloses durable private writes and creates paused on a fresh trusted click only', async () => {
    const { page, storage, uuid } = mount();
    await page.ready;
    await page.select(TRUSTED, [file()]);
    expect(document.getElementById('selection-summary')!.textContent).toContain(
      '1 unique valid conversations'
    );
    expect(uuid).not.toHaveBeenCalled();
    expect(storage.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('writes private provider/conversation identities');
    expect(document.body.textContent).toContain('survive page and extension restarts');
    expect(document.body.textContent).not.toContain(CANARY);
    await page.create(UNTRUSTED);
    expect(storage.create).not.toHaveBeenCalled();
    await page.create(TRUSTED);
    await page.create(TRUSTED);
    expect(uuid).toHaveBeenCalledTimes(2);
    expect(storage.create).toHaveBeenCalledOnce();
    const record = storage.create.mock.calls[0][0];
    expect(record.control).toBe('paused');
    expect(record.items[0].admission.conversationId).toBe(CANARY);
    expect(record.items[0].attempts).toEqual([]);
    expect(document.getElementById('journal-status')!.textContent).toBe(COPY.journal_created);
    expect(document.getElementById('journal-runs')!.textContent).toContain('paused');
    expect(document.body.textContent).not.toContain(CANARY);
    expect(document.body.textContent).not.toContain(record.runId);
    expect(document.body.textContent).not.toContain(record.catalogSha256);
    expect(document.querySelectorAll('button')).toHaveLength(5);
    expect(
      [...document.querySelectorAll('button')].map(value => value.textContent).join(' ')
    ).not.toMatch(/activate|begin attempt|retry|schedule|delete|provider/iu);
  });
  it('recovers prior running work as unknown, never displays identities or evidence and never begins another attempt', async () => {
    let record = journal();
    record = transitionJournal(record, {
      type: 'activate',
      expectedRunRevision: record.revision,
    }).journal;
    record = transitionJournal(record, {
      type: 'begin-attempt',
      expectedRunRevision: record.revision,
      itemId: record.items[0].itemId,
      expectedItemRevision: record.items[0].revision,
      attemptId: 'private-attempt',
      captureId: 'private-capture',
    }).journal;
    const { page, storage } = mount({}, [record]);
    await page.ready;
    expect(document.getElementById('journal-runs')!.textContent).toContain('unknown: 1');
    expect(document.getElementById('journal-runs')!.textContent).toContain('running: 0');
    for (const secret of [
      CANARY,
      record.runId,
      record.catalogSha256,
      record.items[0].itemId,
      'private-attempt',
      'private-capture',
      record.items[0].admission.conversationKey,
    ])
      expect(document.body.textContent).not.toContain(secret);
    expect(storage.create).not.toHaveBeenCalled();
  });
  it.each(['{}', ' {"schema":"liska-snapshot-catalog/1"}'])(
    'refuses invalid catalog %s with no writes or IDs',
    async text => {
      const { page, storage, uuid } = mount();
      await page.ready;
      await page.select(TRUSTED, [file(new TextEncoder().encode(text))]);
      expect(button('create-journal').disabled).toBe(true);
      expect(document.body.textContent).toContain(COPY.journal_catalog_invalid);
      expect(storage.create).not.toHaveBeenCalled();
      expect(uuid).not.toHaveBeenCalled();
    }
  );
  it('owns a live native FileList before clearing the file input', async () => {
    const { page, storage } = mount();
    await page.ready;
    const input = document.getElementById('catalog-picker') as HTMLInputElement;
    const selected = file();
    let cleared = false;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: () => {
        cleared = true;
      },
    });
    const liveFiles = {
      get length() {
        return cleared ? 0 : 1;
      },
      item(index: number) {
        return !cleared && index === 0 ? selected : null;
      },
      *[Symbol.iterator]() {
        if (!cleared) yield selected;
      },
      get 0() {
        return cleared ? undefined : selected;
      },
    } as unknown as FileList;

    await page.select(TRUSTED, liveFiles);

    expect(cleared).toBe(true);
    expect(button('create-journal').disabled).toBe(false);
    expect(storage.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(COPY.journal_ready);
  });
  it('refuses oversize, multiple, unreadable and empty catalog selections without revealing native errors', async () => {
    const { page, storage } = mount();
    await page.ready;
    await page.select(TRUSTED, [{ size: 1024 * 1024 + 1 } as File]);
    expect(document.body.textContent).toContain(COPY.journal_selection_limit);
    await page.select(TRUSTED, [file(), file()]);
    expect(document.body.textContent).toContain(COPY.journal_selection_invalid);
    await page.select(TRUSTED, [
      {
        size: 1,
        slice() {
          throw new Error(CANARY);
        },
      } as unknown as File,
    ]);
    expect(document.body.textContent).not.toContain(CANARY);
    expect(storage.create).not.toHaveBeenCalled();
    await page.select(TRUSTED, []);
  });
  it.each(['open', 'recoverAll', 'list', 'read', 'create'] as const)(
    'fails closed when store %s refuses',
    async method => {
      const storage = store([journal()]);
      storage[method] = vi.fn(async () => {
        throw { code: 'quota-exceeded', message: CANARY };
      }) as never;
      const { page } = mount({ store: storage });
      await page.ready;
      if (method === 'create') {
        await page.select(TRUSTED, [file()]);
        await page.create(TRUSTED);
      }
      expect(button('create-journal').disabled).toBe(true);
      expect(button('choose-catalog').disabled).toBe(true);
      expect(document.body.textContent).toContain(COPY.journal_error);
      expect(document.body.textContent).not.toContain(CANARY);
      expect(document.getElementById('journal-runs')!.children).toHaveLength(0);
    }
  );
  it('refuses more than 16 records, changed revisions and records not recovered paused', async () => {
    const many = store(Array.from({ length: 17 }, (_, i) => journal(`run-${i}`)));
    let mounted = mount({ store: many });
    await mounted.page.ready;
    expect(document.body.textContent).toContain(COPY.journal_error);
    mounted.page.dispose();
    const changed = store([journal()]);
    changed.list.mockImplementation(async () => [
      { runId: 'private-run', revision: 999, control: 'paused' },
    ]);
    mounted = mount({ store: changed });
    await mounted.page.ready;
    expect(document.body.textContent).toContain(COPY.journal_error);
  });
  it('cancels selection reads and hashes and rejects their stale completions', async () => {
    const pending = deferred<ArrayBuffer>();
    const bytes = encodeSnapshotCatalog(catalog());
    const { page, storage } = mount();
    await page.ready;
    const operation = page.select(TRUSTED, [
      {
        size: bytes.length,
        slice: () => ({ arrayBuffer: () => pending.promise }),
      } as unknown as File,
    ]);
    page.cancel(UNTRUSTED);
    expect(button('cancel-journal').disabled).toBe(false);
    page.cancel(TRUSTED);
    pending.resolve(bytes.buffer as ArrayBuffer);
    await operation;
    expect(button('create-journal').disabled).toBe(true);
    expect(document.body.textContent).toContain(COPY.journal_cancelled);
    expect(storage.create).not.toHaveBeenCalled();
    const hashing = deferred<string>();
    const next = mount({ hash: () => hashing.promise });
    await next.page.ready;
    const selected = next.page.select(TRUSTED, [file()]);
    await vi.waitFor(() => expect(button('cancel-journal').disabled).toBe(false));
    next.page.clear(TRUSTED);
    hashing.resolve('c'.repeat(64));
    await selected;
    expect(button('create-journal').disabled).toBe(true);
  });
  it('locks uncertain load/create until reload, and never renders late writes or lists after reset/dispose', async () => {
    const pending = deferred<ResumabilityJournal>();
    const storage = store();
    storage.create.mockImplementation(() => pending.promise);
    const { page } = mount({ store: storage });
    await page.ready;
    await page.select(TRUSTED, [file()]);
    const created = page.create(TRUSTED);
    page.clear(TRUSTED);
    pending.resolve(journal());
    await created;
    expect(button('choose-catalog').disabled).toBe(true);
    expect(document.getElementById('journal-runs')!.textContent).toBe(COPY.journal_noRuns);
    const opening = deferred<void>();
    const other = store();
    other.open.mockImplementation(() => opening.promise);
    const mounted = mount({ store: other });
    mounted.page.dispose();
    opening.resolve();
    await mounted.page.ready;
    expect(other.recoverAll).not.toHaveBeenCalled();
    await mounted.page.select(TRUSTED, [file()]);
    await mounted.page.create(TRUSTED);
    await mounted.page.save(TRUSTED, 0);
    expect(other.create).not.toHaveBeenCalled();
  });
  it('exports deterministic private bytes on trusted click once; completion and late callbacks are epoch-fenced', async () => {
    const pending = deferred<'unknown'>();
    const late: ((value: 'confirmed' | 'failure' | 'unknown') => void)[] = [];
    const save = vi.fn(() => pending.promise);
    const { page } = mount(
      {
        downloader: callback => {
          late.push(callback);
          return { save, reset: vi.fn() };
        },
      },
      [journal()]
    );
    await page.ready;
    await page.save(UNTRUSTED, 0);
    expect(save).not.toHaveBeenCalled();
    const operation = page.save(TRUSTED, 0);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await page.save(TRUSTED, 0);
    expect(Array.from(save.mock.calls[0][0])).toEqual(
      Array.from(
        encodeJournal(
          transitionJournal(journal(), {
            type: 'recover-after-restart',
            expectedRunRevision: journal().revision,
          }).journal
        )
      )
    );
    pending.resolve('unknown');
    await operation;
    expect(document.body.textContent).toContain(COPY.journal_unknown);
    late[0]('confirmed');
    expect(document.body.textContent).toContain(COPY.journal_confirmed);
    await page.save(TRUSTED, 0);
    expect(save).toHaveBeenCalledOnce();
    page.clear(TRUSTED);
    late[0]('failure');
    expect(document.body.textContent).not.toContain(COPY.journal_failure);
  });
  it('drops stale export reads before dispatch and refuses concurrent revision changes', async () => {
    const storage = store([journal()]);
    const { page, save } = mount({ store: storage });
    await page.ready;
    const reading = deferred<ResumabilityJournal>();
    storage.read.mockImplementation(() => reading.promise);
    const operation = page.save(TRUSTED, 0);
    page.clear(TRUSTED);
    reading.resolve(journal());
    await operation;
    expect(save).not.toHaveBeenCalled();
    storage.read.mockImplementation(
      async () =>
        transitionJournal(journal(), { type: 'activate', expectedRunRevision: journal().revision })
          .journal
    );
    await page.save(TRUSTED, 0);
    expect(document.body.textContent).toContain(COPY.journal_error);
    expect(save).not.toHaveBeenCalled();
  });
  it('fences every parallel export when any persistence read fails closed', async () => {
    const storage = store([journal('run-one'), journal('run-two')]);
    const { page, save, reset } = mount({ store: storage });
    await page.ready;
    const reading = deferred<ResumabilityJournal>();
    storage.read.mockImplementation(id =>
      id === 'run-one' ? reading.promise : Promise.reject(new Error(CANARY))
    );
    const first = page.save(TRUSTED, 0);
    await page.save(TRUSTED, 1);
    reading.resolve(journal('run-one'));
    await first;
    expect(save).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain(COPY.journal_error);
    expect(document.body.textContent).not.toContain(CANARY);
  });
  it.each(['failure', 'reject'] as const)('does not retry a download %s', async outcome => {
    const save = vi.fn(async (_bytes: Uint8Array) => {
      if (outcome === 'reject') throw new Error(CANARY);
      return outcome;
    });
    const { page } = mount({ downloader: () => ({ save, reset: vi.fn() }) }, [journal()]);
    await page.ready;
    await page.save(TRUSTED, 0);
    await page.save(TRUSTED, 0);
    expect(save).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(
      outcome === 'reject' ? COPY.journal_unknown : COPY.journal_failure
    );
    expect(document.body.textContent).not.toContain(CANARY);
  });
  it('cancels an export view and drops an already dispatched late completion', async () => {
    const pending = deferred<'confirmed'>();
    const save = vi.fn(() => pending.promise);
    const reset = vi.fn();
    const { page } = mount({ downloader: () => ({ save, reset }) }, [journal()]);
    await page.ready;
    const operation = page.save(TRUSTED, 0);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(button('cancel-journal').disabled).toBe(false);
    page.cancel(TRUSTED);
    pending.resolve('confirmed');
    await operation;
    expect(document.body.textContent).not.toContain(COPY.journal_confirmed);
    expect(reset).toHaveBeenCalledOnce();
  });
});
