import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS,
  persistDerivedBranchHtmlArtifactForFile,
} from '../../src/content/derived-branch-html-persistence';
import {
  buildDerivedBranchHtmlArtifact,
  type DerivedBranchHtmlTarget,
} from '../../src/lib/derived-branch-presentation-contract';
import { buildDerivedBranchHtmlPersistResponse } from '../../src/lib/derived-branch-persistence-contract';
import {
  buildDerivedHtmlArtifact,
  type DerivedOutputIdentity,
} from '../../src/lib/derived-presentation-contract';
import * as byteSize from '../../src/lib/byte-size';
import { MAX_EXTENSION_MESSAGE_SIZE } from '../../src/lib/constants';
import { sha256Hex } from '../../src/lib/sha256';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type { ExtensionMessage, DurableWriteState } from '../../src/lib/types';

const settingsSnapshot = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
const provenance = { sourceCanonicalSha256: 'b'.repeat(64), assetBindingSha256: 'c'.repeat(64) };
const identity = (source: 'chatgpt' | 'deepseek' = 'chatgpt'): DerivedOutputIdentity => ({
  source,
  captureId: `capture-${source}-synthetic`,
  conversationKey: 'a'.repeat(64),
});
const artifact = (target: DerivedBranchHtmlTarget = { role: 'leaf', ordinal: 1 }) =>
  buildDerivedBranchHtmlArtifact(
    '<!doctype html><p>provider-private-value ♥ 字</p>',
    target,
    provenance,
    sha256Hex
  );
const response = (
  html: DurableWriteState = 'confirmed',
  receipt: DurableWriteState = 'confirmed'
) => buildDerivedBranchHtmlPersistResponse({ state: html }, { state: receipt });
type Message = Extract<ExtensionMessage, { action: 'persistDerivedBranchHtmlPresentation' }>;

const contextFailures = [
  'chrome-missing',
  'runtime-missing',
  'runtime-throws',
  'id-missing',
  'lastError-throws',
] as const;
function disruptContext(mode: (typeof contextFailures)[number]): () => void {
  const browser = chrome;
  const runtime = browser.runtime;
  const target =
    mode === 'chrome-missing' ? globalThis : mode.startsWith('runtime-') ? browser : runtime;
  const key =
    mode === 'chrome-missing'
      ? 'chrome'
      : mode.startsWith('runtime-')
        ? 'runtime'
        : mode === 'id-missing'
          ? 'id'
          : 'lastError';
  const original = Object.getOwnPropertyDescriptor(target, key)!;
  Object.defineProperty(
    target,
    key,
    mode.endsWith('-throws')
      ? {
          configurable: true,
          get: () => {
            throw new Error('provider-private-value');
          },
        }
      : { configurable: true, value: undefined }
  );
  return () => Object.defineProperty(target, key, original);
}

describe('one branch HTML File transport seam', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  for (const source of ['chatgpt', 'deepseek'] as const) {
    it.each([{ role: 'leaf', ordinal: 1 }, { role: 'index' }] as const)(
      `sends one detached exact ${source} %s envelope`,
      async target => {
        const expectedIdentity = identity(source);
        const built = await artifact(target);
        const send = vi.fn(async () => response());
        expect(
          await persistDerivedBranchHtmlArtifactForFile(
            expectedIdentity,
            built,
            settingsSnapshot,
            send
          )
        ).toEqual({ state: 'observed', response: response() });
        expect(send).toHaveBeenCalledExactlyOnceWith({
          action: 'persistDerivedBranchHtmlPresentation',
          reportDurableWriteOutcome: true,
          ...expectedIdentity,
          expectedSyncSettingsSnapshot: settingsSnapshot,
          artifact: built,
          outputs: ['file'],
        });
        const sent = send.mock.calls[0][0] as Message;
        expect(sent.artifact).not.toBe(built);
        const { artifact: _artifact, ...envelope } = sent;
        expect(JSON.stringify(envelope)).not.toContain('provider-private-value');
        expect(Object.keys(sent).sort()).toEqual(
          [
            'action',
            'reportDurableWriteOutcome',
            'source',
            'captureId',
            'conversationKey',
            'expectedSyncSettingsSnapshot',
            'artifact',
            'outputs',
          ].sort()
        );
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      }
    );
  }

  it('uses the real Chrome sender once by default and snapshots its closed response', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (value: unknown) => void) => {
        callback?.(response());
      }
    );
    expect(
      await persistDerivedBranchHtmlArtifactForFile(identity(), await artifact(), settingsSnapshot)
    ).toEqual({ state: 'observed', response: response() });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(chrome.runtime.sendMessage.mock.calls[0][0]).toMatchObject({
      action: 'persistDerivedBranchHtmlPresentation',
      outputs: ['file'],
    });
  });

  it('treats a Chrome callback error as attempted but unconfirmed, without forwarding details or retrying', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, callback?: (value: unknown) => void) => {
        chrome.runtime.lastError = { message: 'provider-private-value' };
        callback?.(undefined);
      }
    );
    expect(
      await persistDerivedBranchHtmlArtifactForFile(identity(), await artifact(), settingsSnapshot)
    ).toEqual({ state: 'unconfirmed' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });

  it.each(contextFailures)(
    'settles promptly as unconfirmed when %s appears before the asynchronous callback',
    async mode => {
      const runtime = chrome.runtime;
      const nativeSend = vi.mocked(runtime.sendMessage);
      let callback!: (value: unknown) => void;
      nativeSend.mockImplementation((_message: unknown, done?: (value: unknown) => void) => {
        callback = done!;
      });
      const pending = persistDerivedBranchHtmlArtifactForFile(
        identity(),
        await artifact(),
        settingsSnapshot
      );
      const settled = vi.fn();
      void pending.then(settled);
      expect(nativeSend).toHaveBeenCalledOnce();
      const restore = disruptContext(mode);
      try {
        expect(() => callback(response())).not.toThrow();
        await vi.waitFor(
          () => expect(settled).toHaveBeenCalledExactlyOnceWith({ state: 'unconfirmed' }),
          { timeout: 100 }
        );
        expect(await pending).toEqual({ state: 'unconfirmed' });
        expect(nativeSend).toHaveBeenCalledOnce();
      } finally {
        restore();
      }
    }
  );

  it.each(['chrome-missing', 'runtime-missing', 'runtime-throws', 'id-missing'] as const)(
    'fails closed before the native send when context is %s',
    async mode => {
      const built = await artifact();
      const nativeSend = vi.mocked(chrome.runtime.sendMessage);
      const restore = disruptContext(mode);
      try {
        expect(
          await persistDerivedBranchHtmlArtifactForFile(identity(), built, settingsSnapshot)
        ).toEqual({ state: 'unconfirmed' });
        expect(nativeSend).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    }
  );

  it('normalizes a synchronous native send throw without retaining its message or retrying', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => {
      throw new Error('provider-private-value');
    });
    expect(
      await persistDerivedBranchHtmlArtifactForFile(identity(), await artifact(), settingsSnapshot)
    ).toEqual({ state: 'unconfirmed' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });

  it('settles once when a successful native callback repeats', async () => {
    let callback!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, done?: (value: unknown) => void) => {
        callback = done!;
      }
    );
    const pending = persistDerivedBranchHtmlArtifactForFile(
      identity(),
      await artifact(),
      settingsSnapshot
    );
    const settled = vi.fn();
    void pending.then(settled);
    callback(response());
    callback(undefined);
    expect(await pending).toEqual({ state: 'observed', response: response() });
    await Promise.resolve();
    expect(settled).toHaveBeenCalledOnce();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });

  it('waits until the exact default deadline for a missing callback, then becomes unconfirmed once', async () => {
    const built = await artifact();
    vi.useFakeTimers();
    expect(DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS).toBe(120_000);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => undefined);
    const pending = persistDerivedBranchHtmlArtifactForFile(identity(), built, settingsSnapshot);
    const settled = vi.fn();
    void pending.then(settled);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ state: 'unconfirmed' });
    expect(settled).toHaveBeenCalledExactlyOnceWith({ state: 'unconfirmed' });
    expect(vi.getTimerCount()).toBe(0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(chrome.downloads.cancel).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'] as const)(
    'ignores a late %s callback after expiry without rereading context or sending again',
    async late => {
      const built = await artifact();
      vi.useFakeTimers();
      const runtime = chrome.runtime;
      let callback!: (value: unknown) => void;
      vi.mocked(runtime.sendMessage).mockImplementation(
        (_message: unknown, done?: (value: unknown) => void) => {
          callback = done!;
        }
      );
      const pending = persistDerivedBranchHtmlArtifactForFile(identity(), built, settingsSnapshot);
      const settled = vi.fn();
      void pending.then(settled);
      await vi.advanceTimersByTimeAsync(DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS);
      expect(await pending).toEqual({ state: 'unconfirmed' });
      const original = Object.getOwnPropertyDescriptor(runtime, 'lastError')!;
      const contextRead = vi.fn(() => {
        throw new Error('provider-private-value');
      });
      Object.defineProperty(runtime, 'lastError', { configurable: true, get: contextRead });
      try {
        expect(() => callback(late === 'success' ? response() : undefined)).not.toThrow();
        await vi.advanceTimersByTimeAsync(DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS);
        expect(await pending).toEqual({ state: 'unconfirmed' });
        expect(settled).toHaveBeenCalledExactlyOnceWith({ state: 'unconfirmed' });
        expect(contextRead).not.toHaveBeenCalled();
        expect(runtime.sendMessage).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(chrome.downloads.cancel).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(runtime, 'lastError', original);
      }
    }
  );

  it('clears the default deadline after a normal callback and settles only once', async () => {
    const built = await artifact();
    vi.useFakeTimers();
    let callback!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (_message: unknown, done?: (value: unknown) => void) => {
        callback = done!;
      }
    );
    const pending = persistDerivedBranchHtmlArtifactForFile(identity(), built, settingsSnapshot);
    const settled = vi.fn();
    void pending.then(settled);
    expect(vi.getTimerCount()).toBe(1);
    callback(response());
    expect(await pending).toEqual({ state: 'observed', response: response() });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS);
    expect(settled).toHaveBeenCalledOnce();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });

  it('leaves an injected custom send promise caller-controlled beyond the default deadline', async () => {
    const built = await artifact();
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const pending = persistDerivedBranchHtmlArtifactForFile(
      identity(),
      built,
      settingsSnapshot,
      send
    );
    const settled = vi.fn();
    void pending.then(settled);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS);
    expect(settled).not.toHaveBeenCalled();
    resolve(response());
    expect(await pending).toEqual({ state: 'observed', response: response() });
    expect(send).toHaveBeenCalledOnce();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['source', 'claude'],
    ['captureId', 'provider-private-value'],
    ['captureId', 'capture-deepseek-mismatch'],
    ['conversationKey', 'provider-private-value'],
    ['conversationKey', 'A'.repeat(64)],
  ])('rejects invalid identity %s before send', async (key, value) => {
    const send = vi.fn();
    expect(
      await persistDerivedBranchHtmlArtifactForFile(
        { ...identity(), [key]: value },
        await artifact(),
        settingsSnapshot,
        send
      )
    ).toEqual({ state: 'not-dispatched' });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects identity extras, custom prototypes, accessors and hooks without ordinary reads', async () => {
    const built = await artifact();
    const hook = vi.fn(() => 'provider-private-value');
    const send = vi.fn();
    const candidates = [
      { ...identity(), receipt: 'provider-private-value' },
      { ...identity(), path: 'provider-private-value' },
      { ...identity(), toJSON: hook },
      { ...identity(), [Symbol('extra')]: true },
      Object.assign(Object.create({ inherited: true }), identity()),
      Object.defineProperty(identity(), 'captureId', { enumerable: true, get: hook }),
    ];
    for (const candidate of candidates)
      expect(
        await persistDerivedBranchHtmlArtifactForFile(candidate, built, settingsSnapshot, send)
      ).toEqual({ state: 'not-dispatched' });
    expect(send).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it('snapshots a stateful identity once and does not reread it while matching the local receipt', async () => {
    const original = identity();
    const expected = structuredClone(original);
    const get = vi.fn(() => {
      throw new Error('provider-private-value');
    });
    const reads = new Map<PropertyKey, number>();
    const proxy = new Proxy(original, {
      get,
      getOwnPropertyDescriptor(target, key) {
        const count = (reads.get(key) ?? 0) + 1;
        reads.set(key, count);
        if (count > 1) throw new Error('provider-private-value');
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (key === 'captureId') target.captureId = 'capture-chatgpt-provider-private-value';
        return descriptor;
      },
    });
    const send = vi.fn(async () => response());
    expect(
      await persistDerivedBranchHtmlArtifactForFile(proxy, await artifact(), settingsSnapshot, send)
    ).toMatchObject({ state: 'observed' });
    expect(send.mock.calls[0][0]).toMatchObject(expected);
    expect([...reads.values()]).toEqual([1, 1, 1]);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ['schema', 'liska-derived-html/1'],
    ['role', 'other'],
    ['ordinal', 0],
    ['relativePath', '../provider-private-value'],
    ['bodyBase64', 'AB=='],
    ['byteLength', -1],
    ['sha256', 'private'],
    ['sourceCanonicalSha256', 'private'],
    ['assetBindingSha256', 'private'],
    ['receipt', 'private'],
    ['complete', true],
  ])('rejects invalid or expanded artifact %s before send', async (key, value) => {
    const send = vi.fn();
    expect(
      await persistDerivedBranchHtmlArtifactForFile(
        identity(),
        { ...(await artifact()), [key]: value },
        settingsSnapshot,
        send
      )
    ).toEqual({ state: 'not-dispatched' });
    expect(send).not.toHaveBeenCalled();
  });

  it('cross-rejects a current-v1 artifact', async () => {
    const current = await buildDerivedHtmlArtifact('<p>test</p>', provenance, sha256Hex);
    const send = vi.fn();
    expect(
      await persistDerivedBranchHtmlArtifactForFile(identity(), current, settingsSnapshot, send)
    ).toEqual({ state: 'not-dispatched' });
    expect(send).not.toHaveBeenCalled();
  });

  it('detaches stateful artifact descriptors without invoking get/toJSON or retaining the Proxy', async () => {
    const built = await artifact();
    const expected = structuredClone(built);
    const get = vi.fn(() => {
      throw new Error('provider-private-value');
    });
    const reads = new Map<PropertyKey, number>();
    const proxy = new Proxy(built, {
      get,
      getOwnPropertyDescriptor(target, key) {
        const count = (reads.get(key) ?? 0) + 1;
        reads.set(key, count);
        if (count > 1) throw new Error('provider-private-value');
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (key === 'bodyBase64') target.bodyBase64 = 'provider-private-value';
        return descriptor;
      },
    });
    const send = vi.fn(async () => response());
    expect(
      await persistDerivedBranchHtmlArtifactForFile(identity(), proxy, settingsSnapshot, send)
    ).toMatchObject({ state: 'observed' });
    expect((send.mock.calls[0][0] as Message).artifact).toEqual(expected);
    expect([...reads.values()].every(count => count === 1)).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects artifact accessors without invoking them', async () => {
    const hook = vi.fn(() => 'provider-private-value');
    const built = Object.defineProperty(await artifact(), 'bodyBase64', {
      enumerable: true,
      get: hook,
    });
    const send = vi.fn();
    expect(
      await persistDerivedBranchHtmlArtifactForFile(identity(), built, settingsSnapshot, send)
    ).toEqual({ state: 'not-dispatched' });
    expect(send).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it.each(['{}', '', null, 'provider-private-value', `${settingsSnapshot} `])(
    'rejects an invalid settings snapshot %s',
    async snapshot => {
      const send = vi.fn();
      expect(
        await persistDerivedBranchHtmlArtifactForFile(
          identity(),
          await artifact(),
          snapshot as string,
          send
        )
      ).toEqual({ state: 'not-dispatched' });
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('does not coerce a hostile settings value', async () => {
    const hook = vi.fn(() => settingsSnapshot);
    const send = vi.fn();
    expect(
      await persistDerivedBranchHtmlArtifactForFile(
        identity(),
        await artifact(),
        { toString: hook, toJSON: hook } as unknown as string,
        send
      )
    ).toEqual({ state: 'not-dispatched' });
    expect(hook).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([MAX_EXTENSION_MESSAGE_SIZE, MAX_EXTENSION_MESSAGE_SIZE + 1])(
    'enforces the exact serialized-size comparison at %s bytes',
    async wireBytes => {
      // The artifact's separate 32 MiB bound makes a natural valid 60 MiB message unreachable.
      // Stub only the measuring function to exercise both exact gate endpoints.
      const measure = vi.spyOn(byteSize, 'jsonUtf8ByteLength').mockReturnValue(wireBytes);
      const send = vi.fn(async () => response());
      const result = await persistDerivedBranchHtmlArtifactForFile(
        identity(),
        await artifact(),
        settingsSnapshot,
        send
      );
      expect(measure).toHaveBeenCalledOnce();
      expect(result).toEqual(
        wireBytes === MAX_EXTENSION_MESSAGE_SIZE
          ? { state: 'observed', response: response() }
          : { state: 'not-dispatched' }
      );
      expect(send).toHaveBeenCalledTimes(wireBytes === MAX_EXTENSION_MESSAGE_SIZE ? 1 : 0);
    }
  );

  it('reports measurement/preflight exceptions as not-dispatched', async () => {
    vi.spyOn(byteSize, 'jsonUtf8ByteLength').mockImplementation(() => {
      throw new Error('provider-private-value');
    });
    const send = vi.fn();
    expect(
      await persistDerivedBranchHtmlArtifactForFile(
        identity(),
        await artifact(),
        settingsSnapshot,
        send
      )
    ).toEqual({ state: 'not-dispatched' });
    expect(send).not.toHaveBeenCalled();
  });

  it('caller mutation during the one pending send cannot change the detached request', async () => {
    const expectedIdentity = identity();
    const built = await artifact();
    const originalIdentity = structuredClone(expectedIdentity);
    const originalArtifact = structuredClone(built);
    let resolve!: (value: unknown) => void;
    const send = vi.fn(
      (_message: Message) =>
        new Promise(done => {
          resolve = done;
        })
    );
    const pending = persistDerivedBranchHtmlArtifactForFile(
      expectedIdentity,
      built,
      settingsSnapshot,
      send
    );
    expect(send).toHaveBeenCalledOnce();
    expectedIdentity.captureId = 'capture-chatgpt-provider-private-value';
    expectedIdentity.conversationKey = 'provider-private-value';
    Object.assign(built, {
      ordinal: 2,
      relativePath: 'provider-private-value.html',
      bodyBase64: 'provider-private-value',
    });
    const request = send.mock.calls[0][0];
    expect(request).toMatchObject({
      ...originalIdentity,
      artifact: originalArtifact,
      outputs: ['file'],
    });
    resolve(response());
    expect(await pending).toEqual({ state: 'observed', response: response() });
    expect(send).toHaveBeenCalledOnce();
  });

  it.each(['throw', 'reject'] as const)(
    'reports %s after one attempt as unconfirmed and never forwards exception text',
    async mode => {
      const send = vi.fn(() => {
        if (mode === 'throw') throw new Error('provider-private-value');
        return Promise.reject(new Error('provider-private-value'));
      });
      expect(
        await persistDerivedBranchHtmlArtifactForFile(
          identity(),
          await artifact(),
          settingsSnapshot,
          send
        )
      ).toEqual({ state: 'unconfirmed' });
      expect(send).toHaveBeenCalledOnce();
    }
  );

  it.each([
    undefined,
    null,
    {},
    [],
    { success: true },
    { ...response(), error: 'provider-private-value' },
    { ...response(), success: false },
  ])('treats malformed response %s as attempted but unconfirmed', async value => {
    const send = vi.fn(async () => value);
    expect(
      await persistDerivedBranchHtmlArtifactForFile(
        identity(),
        await artifact(),
        settingsSnapshot,
        send
      )
    ).toEqual({ state: 'unconfirmed' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('treats hostile response accessors/traps as unconfirmed, without invoking getters or retrying', async () => {
    const hook = vi.fn(() => 'provider-private-value');
    const candidates = [
      Object.defineProperty(structuredClone(response()), 'html', { enumerable: true, get: hook }),
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('provider-private-value');
          },
        }
      ),
      { ...response(), toJSON: hook },
    ];
    for (const value of candidates) {
      const send = vi.fn(async () => value);
      expect(
        await persistDerivedBranchHtmlArtifactForFile(
          identity(),
          await artifact(),
          settingsSnapshot,
          send
        )
      ).toEqual({ state: 'unconfirmed' });
      expect(send).toHaveBeenCalledOnce();
    }
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmed', 'confirmed'],
    ['confirmed', 'unknown'],
    ['confirmed', 'not-dispatched'],
    ['unknown', 'not-dispatched'],
    ['not-dispatched', 'not-dispatched'],
  ] as const)(
    'observes and detaches independent HTML=%s / receipt=%s facts without flattening',
    async (html, receipt) => {
      const value = structuredClone(response(html, receipt));
      value.html.writeOutcome.cleanupDeferred = true;
      const send = vi.fn(async () => value);
      const result = await persistDerivedBranchHtmlArtifactForFile(
        identity(),
        await artifact(),
        settingsSnapshot,
        send
      );
      expect(result).toEqual({ state: 'observed', response: value });
      if (result.state !== 'observed') throw new Error('Expected an observation');
      expect(result.response).not.toBe(value);
      expect(result.response.html).not.toBe(value.html);
      expect(result.response.html.writeOutcome).not.toBe(value.html.writeOutcome);
      const expected = structuredClone(value);
      value.html.writeOutcome.state = 'unknown';
      value.receipt.writeOutcome.state = 'confirmed';
      expect(result.response).toEqual(expected);
      expect(JSON.stringify(result)).not.toContain('provider-private-value');
      expect(send).toHaveBeenCalledOnce();
    }
  );
});
