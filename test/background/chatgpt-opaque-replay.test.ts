import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptConversationViaOpaqueReplay as captureReplay,
  parseChatGptOpaqueReplayStateWire,
  readChatGptOpaqueReplayChunkState,
  readChatGptOpaqueReplayState as readStateWire,
  releaseChatGptOpaqueReplayChunkState,
} from '../../src/background/chatgpt-opaque-replay';
import {
  isChatGptOpaqueReplayHookResult,
  CHATGPT_OPAQUE_REPLAY_ERROR_CODES,
} from '../../src/lib/chatgpt-opaque-replay-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const TARGET = {
  conversationId: CONVERSATION_ID,
  pathname: `/c/${CONVERSATION_ID}`,
  routeFamily: 'standard' as const,
};
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const MARKER = `#liska-capture=${NONCE}&liska-opaque-replay=1`;
const SHA256 = '0'.repeat(64);
const STAGE_ID = `archive-stage-${'A'.repeat(32)}`;
const STAGED_MARKER = `#liska-capture=${NONCE}&liska-opaque-replay=2`;

const WIRE_PREFIX = 'liska-opaque-replay-wire:1:';
const MISSING_WIRE = 'liska-opaque-replay-wire:missing';

function poisonedPageRealm(wire: string, chunks: string[] = []) {
  const realm = createContext({ initialWire: wire, chunks, nonce: NONCE });
  runInContext(
    `
    globalThis.window = globalThis;
    let stateWire = initialWire;
    let released = false;
    let poisonCalls = 0;
    const poison = () => { poisonCalls += 1; throw new Error('page poison executed'); };
    Object.defineProperty(window, '__liskaChatGptOpaqueReplay_' + nonce, {
      configurable: false, get: () => stateWire,
    });
    Object.defineProperty(window, '__liskaChatGptOpaqueReplayChunkReader_' + nonce, {
      configurable: false, writable: false,
      value: index => released ? '${MISSING_WIRE}' : chunks[index] ?? '${MISSING_WIRE}',
    });
    Object.defineProperty(window, '__liskaChatGptOpaqueReplayChunkRelease_' + nonce, {
      configurable: false, writable: false,
      value: () => { const owned = !released; released = true; return owned; },
    });
    Object.defineProperty(Object.prototype, 'then', { get: poison });
    Object.defineProperty(Object.prototype, 'toJSON', { get: poison });
    Object.defineProperty(Promise, Symbol.species, { get: poison });
    Promise.prototype.then = poison;
    Promise.prototype.constructor = poison;
    Promise.resolve = poison;
    globalThis.Promise = poison;
    JSON.stringify = poison;
    JSON.parse = poison;
    Object.getPrototypeOf = poison;
    Object.getOwnPropertyDescriptor = poison;
    Object.create = poison;
    Object.defineProperty = poison;
    Reflect.ownKeys = poison;
    Reflect.apply = poison;
    Array.isArray = poison;
    Number.isSafeInteger = poison;
    RegExp.prototype.test = poison;
    Function.prototype.call = poison;
    Function.prototype.apply = poison;
    globalThis.atob = poison;
    globalThis.btoa = poison;
  `,
    realm
  );
  const execute = (func: (...args: never[]) => unknown, args: unknown[]) =>
    runInContext(
      `(${func.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`,
      realm
    );
  return { realm, execute, poisonCalls: () => runInContext('poisonCalls', realm) as number };
}

// Legacy lifecycle fixtures describe the unchanged public contract. Encode at
// their mock extension-transfer boundary; the separate VM tests below execute
// the actual serialized MAIN thunks in a poisoned, independent page realm.
function fixtureWire(value: unknown, nonce = NONCE, mode = 'legacy-inline'): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const state = value as Record<string, unknown>;
  const kind =
    state.kind === 'captured'
      ? 'transport' in (state.capture as object)
        ? 'staged'
        : 'inline'
      : state.kind;
  return (
    WIRE_PREFIX +
    kind +
    ':' +
    JSON.stringify(kind === 'chunk' ? { nonce, ...state } : { nonce, mode, ...state, kind })
  );
}

async function captureChatGptConversationViaOpaqueReplay(
  ...args: Parameters<typeof captureReplay>
): ReturnType<typeof captureReplay> {
  const overrides = args[1];
  if (!overrides?.chromeApi) return captureReplay(...args);
  const api = overrides.chromeApi;
  return captureReplay(args[0], {
    ...overrides,
    chromeApi: {
      ...api,
      scripting: {
        executeScript: async injection => {
          const entries = await api.scripting.executeScript(injection);
          return entries.map(entry => ({
            ...entry,
            result: fixtureWire(
              entry.result,
              injection.args[0] as string,
              overrides.transportMode ?? 'legacy-inline'
            ),
          }));
        },
      },
    },
  });
}

// These compatibility assertions validate the public fixture contract, not a
// browser transfer. Objects are never returned by the production MAIN reader.
function readChatGptOpaqueReplayState(nonce: string) {
  const value = (window as unknown as Record<string, unknown>)[
    `__liskaChatGptOpaqueReplay_${nonce}`
  ];
  if (typeof value !== 'string') {
    if (!isChatGptOpaqueReplayHookResult(value)) return { kind: 'missing' };
    return parseChatGptOpaqueReplayStateWire(fixtureWire(value, nonce), nonce, 'legacy-inline');
  }
  return parseChatGptOpaqueReplayStateWire(readStateWire(nonce), nonce, 'legacy-inline');
}

function stagedState(byteLength = 16 * 1024 * 1024 + 1) {
  return {
    kind: 'captured' as const,
    conversationId: CONVERSATION_ID,
    capture: {
      transportVersion: 1 as const,
      transport: 'staged' as const,
      byteLength,
      sha256: SHA256,
      mediaType: 'application/json; charset=utf-8',
      chunkCount: Math.ceil(byteLength / (512 * 1024)),
    },
    singularDispatchCount: 1 as const,
  };
}

function capturedState(conversationId = CONVERSATION_ID) {
  return {
    kind: 'captured',
    conversationId,
    capture: {
      bodyBase64: 'AP8B',
      byteLength: 3,
      sha256: SHA256,
      mediaType: 'application/json; charset=utf-8',
    },
    singularDispatchCount: 1,
  };
}

function chromeApi(result: unknown, url?: string) {
  const create = vi.fn().mockResolvedValue({ id: 123 });
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    create,
    remove,
    api: {
      tabs: {
        create,
        get: vi.fn().mockResolvedValue({
          status: 'complete',
          url: url ?? `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
        }),
        remove,
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result }]) },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatGPT opaque replay temporary-tab core', () => {
  it('models inherited thenable replacement of an ordinary script return as an attack control', async () => {
    const realm = createContext({
      authentic: fixtureWire(capturedState()),
      forged: 'forged-result',
    });
    const object = runInContext(
      `
      let calls = 0;
      Object.defineProperty(Object.prototype, 'then', { value: function (resolve) {
        calls += 1; resolve(forged);
      } });
      ({ kind: 'ready' });
    `,
      realm
    );
    expect(await Promise.resolve(object)).toBe('forged-result');
    expect(runInContext('calls', realm)).toBe(1);
    const primitive = runInContext('authentic', realm);
    expect(await Promise.resolve(primitive)).toBe(primitive);
    expect(runInContext('calls', realm)).toBe(1);
  });
  it.each(['legacy-inline', 'staged-v2'] as const)(
    'transfers ready/error/inline primitives through poisoned MAIN globals in %s',
    async mode => {
      const bytes = Buffer.from('authentic replay bytes');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const captured = {
        ...capturedState(),
        capture: {
          bodyBase64: bytes.toString('base64'),
          byteLength: bytes.length,
          sha256,
          mediaType: 'application/json',
        },
      };
      for (const state of [
        { kind: 'ready' },
        { kind: 'error', code: 'replay-rejected', singularDispatchCount: 1 },
        captured,
      ]) {
        const wire = fixtureWire(state, NONCE, mode) as string;
        const page = poisonedPageRealm(wire);
        const returned = page.execute(readStateWire, [NONCE]);
        expect(typeof returned).toBe('string');
        // Models Chromium's mandatory Promise resolution separately from its
        // property converter and from clean extension-realm parsing. Primitive
        // resolution cannot inspect inherited page Object.prototype.then.
        const transferred = await Promise.resolve(returned);
        expect(transferred).toBe(wire);
        expect(parseChatGptOpaqueReplayStateWire(transferred, NONCE, mode)).toEqual(state);
        expect(page.poisonCalls()).toBe(0);
        if (state.kind === 'captured') {
          const chrome = chromeApi(
            wire,
            `https://chatgpt.com${TARGET.pathname}${mode === 'staged-v2' ? STAGED_MARKER : MARKER}`
          );
          const response = await captureReplay(TARGET, {
            chromeApi: chrome.api,
            createNonce: () => NONCE,
            transportMode: mode,
          });
          expect(response).toMatchObject({
            success: true,
            data: { sha256, bodyBase64: bytes.toString('base64') },
          });
        }
      }
    }
  );

  it('rejects ordinary object/boxed returns before any page thenable or converter copy', async () => {
    const page = poisonedPageRealm(MISSING_WIRE);
    runInContext('stateWire = { kind: "ready" }', page.realm);
    const result = page.execute(readStateWire, [NONCE]);
    expect(await Promise.resolve(result)).toBe(MISSING_WIRE);
    runInContext('stateWire = new String(initialWire)', page.realm);
    expect(page.execute(readStateWire, [NONCE])).toBe(MISSING_WIRE);
    expect(page.poisonCalls()).toBe(0);
  });

  it.each([false, true])(
    'verifies >16 MiB multi-chunks via poisoned MAIN thunks (digest mismatch %s)',
    async hashMismatch => {
      const bytes = Buffer.alloc(16 * 1024 * 1024 + 1, 0x61);
      bytes[bytes.length - 1] = 0xff;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const state = stagedState(bytes.length);
      state.capture.sha256 = sha256;
      const wire = fixtureWire(state, NONCE, 'staged-v2') as string;
      const chunks = Array.from({ length: state.capture.chunkCount }, (_, index) => {
        const offset = index * 512 * 1024;
        const chunk = Buffer.from(
          bytes.subarray(offset, Math.min(bytes.length, offset + 512 * 1024))
        );
        if (hashMismatch && index === 0) chunk[0] ^= 1;
        return fixtureWire({
          kind: 'chunk',
          index,
          offset,
          byteLength: chunk.length,
          chunkBase64: chunk.toString('base64'),
        }) as string;
      });
      const page = poisonedPageRealm(wire, chunks);
      const actualBytes = createHash('sha256');
      let actualLength = 0;
      const append = vi.fn(async (_id, offset, chunkBase64) => {
        expect(offset).toBe(actualLength);
        const chunk = Buffer.from(chunkBase64, 'base64');
        actualLength += chunk.length;
        actualBytes.update(chunk);
        return true;
      });
      const seal = vi.fn(
        async () => actualLength === bytes.length && actualBytes.digest('hex') === sha256
      );
      const abort = vi.fn();
      const executeScript = vi.fn(async injection => [
        {
          frameId: 0,
          documentId: 'pinned-document',
          result: await Promise.resolve(page.execute(injection.func, injection.args)),
        },
      ]);
      const response = await captureReplay(TARGET, {
        createNonce: () => NONCE,
        transportMode: 'staged-v2',
        chromeApi: {
          tabs: {
            create: vi.fn(async () => ({ id: 123 })),
            get: vi.fn(async () => ({
              status: 'complete',
              url: `https://chatgpt.com${TARGET.pathname}${STAGED_MARKER}`,
            })),
            remove: vi.fn(async () => undefined),
          },
          scripting: { executeScript },
        },
        archiveStage: { begin: vi.fn(async () => STAGE_ID), append, seal, abort },
      });
      expect(response).toMatchObject(
        hashMismatch
          ? { success: false, code: 'replay-result-invalid', singularDispatchCount: 1 }
          : {
              success: true,
              data: { transport: 'staged', sha256, byteLength: bytes.length, stageId: STAGE_ID },
            }
      );
      expect(append).toHaveBeenCalledTimes(33);
      expect(seal).toHaveBeenCalledOnce();
      if (hashMismatch) expect(abort).toHaveBeenCalledWith(STAGE_ID);
      else expect(abort).not.toHaveBeenCalled();
      expect(page.execute(readStateWire, [NONCE])).toBe(wire);
      expect(page.execute(readChatGptOpaqueReplayChunkState, [NONCE, 0])).toBe(MISSING_WIRE);
      expect(page.execute(releaseChatGptOpaqueReplayChunkState, [NONCE])).toBe(false);
      expect(page.poisonCalls()).toBe(0);
    }
  );

  it('bounds primitive wire before JSON.parse and rejects malformed schemas/correlation', () => {
    const inline = capturedState();
    const valid = fixtureWire(inline) as string;
    const invalid = [
      undefined,
      null,
      {},
      new String(valid),
      'wrong:' + valid,
      WIRE_PREFIX + 'inline:' + ' '.repeat(4 * Math.ceil((16 * 1024 * 1024) / 3) + 4096),
      WIRE_PREFIX + 'ready:' + ' '.repeat(4097),
      fixtureWire(inline, 'wrong-nonce'),
      fixtureWire(inline, NONCE, 'staged-v2'),
      fixtureWire({ ...inline, secret: 'no' }),
      fixtureWire({ ...inline, capture: { ...inline.capture, stageId: STAGE_ID } }),
      fixtureWire({ ...inline, capture: { ...inline.capture, byteLength: 1.5 } }),
      fixtureWire({ ...inline, capture: { ...inline.capture, byteLength: 2 ** 53 } }),
      fixtureWire({ ...inline, capture: { ...inline.capture, bodyBase64: 'AB==', byteLength: 1 } }),
      fixtureWire({ ...inline, capture: { ...inline.capture, mediaType: 'text/html' } }),
      fixtureWire({ ...inline, capture: { ...inline.capture, sha256: 'not-a-hash' } }),
      WIRE_PREFIX + 'inline:{',
      WIRE_PREFIX + 'unknown:{}',
      fixtureWire(stagedState(), NONCE, 'legacy-inline'),
    ];
    const parse = vi.spyOn(JSON, 'parse');
    for (const value of invalid.slice(0, 7)) {
      expect(parseChatGptOpaqueReplayStateWire(value, NONCE, 'legacy-inline')).toEqual({
        kind: 'missing',
      });
    }
    expect(parse).not.toHaveBeenCalled();
    for (const value of invalid.slice(7)) {
      expect(parseChatGptOpaqueReplayStateWire(value, NONCE, 'legacy-inline')).toEqual({
        kind: 'missing',
      });
    }
    expect(parseChatGptOpaqueReplayStateWire(valid, NONCE, 'legacy-inline')).toEqual(inline);
    expect(
      parseChatGptOpaqueReplayStateWire(
        fixtureWire(stagedState(64 * 1024 * 1024), NONCE, 'staged-v2'),
        NONCE,
        'staged-v2'
      )
    ).toMatchObject({ kind: 'captured', capture: { chunkCount: 128 } });
    expect(
      parseChatGptOpaqueReplayStateWire(
        fixtureWire(stagedState(64 * 1024 * 1024 + 1), NONCE, 'staged-v2'),
        NONCE,
        'staged-v2'
      )
    ).toEqual({ kind: 'missing' });
  });
  it.each([
    ['custom-gpt', 'private-owner'],
    ['project', 'g-p-private-project'],
  ] as const)('preserves exact %s paths without exposing them', async (routeFamily, slug) => {
    for (const trailing of ['', '/']) {
      const target = {
        ...TARGET,
        pathname: `/g/${slug}/c/${CONVERSATION_ID}${trailing}`,
        routeFamily,
      };
      const expectedUrl = `https://chatgpt.com${target.pathname}${MARKER}`;
      const chrome = chromeApi(capturedState(), expectedUrl);
      const result = await captureChatGptConversationViaOpaqueReplay(target, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        digestSha256: async () => SHA256,
      });
      expect(result).toMatchObject({ success: true, data: { routeFamily } });
      expect(chrome.create).toHaveBeenCalledExactlyOnceWith({ url: expectedUrl, active: false });
      expect(chrome.remove).toHaveBeenCalledExactlyOnceWith(123);
      expect(JSON.stringify(result)).not.toContain(slug);
      expect(JSON.stringify(result)).not.toContain(target.pathname);
    }
  });

  it('rejects route movement during verification without fallback', async () => {
    const target = {
      ...TARGET,
      pathname: `/g/g-p-private-project/c/${CONVERSATION_ID}/`,
      routeFamily: 'project' as const,
    };
    const chrome = chromeApi(capturedState(), `https://chatgpt.com${target.pathname}${MARKER}`);
    const result = await captureChatGptConversationViaOpaqueReplay(target, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => {
        chrome.api.tabs.get.mockResolvedValue({
          status: 'complete',
          url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
        });
        return SHA256;
      },
    });
    expect(result).toEqual({ success: false, code: 'unexpected-path', singularDispatchCount: 1 });
    expect(chrome.create).toHaveBeenCalledOnce();
    expect(chrome.remove).toHaveBeenCalledExactlyOnceWith(123);
  });

  it.each([
    ['target-not-observed', 0],
    ['target-not-observed-singular-path-seen', 0],
    ['source-response-timeout', 0],
    ['replay-response-timeout', 1],
    ['timed-out', 0],
    ['timed-out', 1],
  ] as const)('preserves the terminal %s count %s without a retry', async (code, count) => {
    const snapshot = { kind: 'error', code, singularDispatchCount: count };
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: snapshot });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual(snapshot);
    const chrome = chromeApi(snapshot);

    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
    });

    expect(response).toEqual({ success: false, code, singularDispatchCount: count });
    expect(chrome.create).toHaveBeenCalledOnce();
    expect(chrome.api.scripting.executeScript).toHaveBeenCalledOnce();
    expect(chrome.remove).toHaveBeenCalledExactlyOnceWith(123);
  });

  it.each([
    'target-not-observed-singular-path-seen',
    'source-response-timeout',
    'replay-response-timeout',
    'timed-out',
  ])('rejects suffixes and unbounded counts on %s in the serialized reader', code => {
    for (const snapshot of [
      { kind: 'error', code: `${code}:synthetic-secret`, singularDispatchCount: 0 },
      { kind: 'error', code, singularDispatchCount: 2 },
      { kind: 'error', code, singularDispatchCount: 0, url: 'synthetic-url-sentinel' },
    ]) {
      vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: snapshot });
      expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
    }
  });

  it('keeps an unobserved background deadline ambiguous and never retries', async () => {
    let now = 0;
    const chrome = chromeApi({ kind: 'ready' });
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      now: () => now,
      sleep: async () => {
        now = 1_001;
      },
    });

    // The reader never saw a terminal result: 0 is the fallback, not proof
    // that a singular request was not dispatched in the unobserved page.
    expect(response).toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 0,
    });
    expect(chrome.create).toHaveBeenCalledOnce();
    expect(chrome.api.scripting.executeScript).toHaveBeenCalledOnce();
    expect(chrome.remove).toHaveBeenCalledExactlyOnceWith(123);
  });

  it.each([
    'init-security-sensitive-headers-unbranded',
    'init-security-sensitive-headers-unbranded-synthetic-secret',
    'init-security-sensitive-headers-unbranded-entry-synthetic-secret',
    'init-security-sensitive-headers-unbranded-ENTRY',
  ])('rejects the non-allowlisted header reason %s in the serialized reader', code => {
    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: { kind: 'error', code, singularDispatchCount: 0 },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
  });

  it('keeps the serialized error-code allowlist exact and aligned with the contract', () => {
    for (const code of CHATGPT_OPAQUE_REPLAY_ERROR_CODES) {
      const snapshot = { kind: 'error', code, singularDispatchCount: 0 };
      vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: snapshot });
      expect(readChatGptOpaqueReplayState(NONCE)).toEqual(snapshot);
    }
    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        kind: 'error',
        code: 'init-security-sensitive-headers:synthetic-secret',
        singularDispatchCount: 0,
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
  });

  it('uses the bounded default nonce, sleep, and SHA-256 implementation', async () => {
    const bytes = new Uint8Array([0, 255, 1]);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    let createdUrl = '';
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' } }])
      .mockResolvedValueOnce([
        {
          result: {
            ...capturedState(),
            capture: { ...capturedState().capture, sha256 },
          },
        },
      ]);
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn(async ({ url }) => {
            createdUrl = url;
            return { id: 123 };
          }),
          get: vi.fn(async () => ({ status: 'complete', url: createdUrl })),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        scripting: { executeScript },
      },
    });

    expect(response).toMatchObject({ success: true, data: { sha256 } });
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('opens only the exact marker route, validates bytes/hash, and removes the disposable tab', async () => {
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
    });

    expect(response).toEqual({
      success: true,
      data: {
        bodyBase64: 'AP8B',
        byteLength: 3,
        sha256: SHA256,
        mediaType: 'application/json; charset=utf-8',
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
        routeFamily: 'standard',
        transientAssetResolvers: [],
      },
    });
    expect(chrome.create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      active: false,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
    expect(JSON.stringify(response)).not.toContain('synthetic-authorization-sentinel');
  });

  it('pins one top-frame document and stages exact sequential v2 chunks without whole base64', async () => {
    const fullChunkBase64 = Buffer.alloc(512 * 1024, 1).toString('base64');
    const lastChunkBase64 = Buffer.from([2]).toString('base64');
    const executeScript = vi.fn(
      async (injection: { func: (...args: never[]) => unknown; args: unknown[] }) => {
        if (injection.func === releaseChatGptOpaqueReplayChunkState) {
          return [{ frameId: 0, documentId: 'document-1', result: true }];
        }
        if (injection.func === readChatGptOpaqueReplayChunkState) {
          const index = injection.args[1] as number;
          const last = index === 32;
          return [
            {
              frameId: 0,
              documentId: 'document-1',
              result: {
                kind: 'chunk',
                index,
                offset: index * 512 * 1024,
                byteLength: last ? 1 : 512 * 1024,
                chunkBase64: last ? lastChunkBase64 : fullChunkBase64,
              },
            },
          ];
        }
        return [{ frameId: 0, documentId: 'document-1', result: stagedState() }];
      }
    );
    const create = vi.fn().mockResolvedValue({ id: 123 });
    const remove = vi.fn().mockResolvedValue(undefined);
    const begin = vi.fn(async (_descriptor, onAllocated?: (stageId: string) => void) => {
      onAllocated?.(STAGE_ID);
      return STAGE_ID;
    });
    const append = vi.fn().mockResolvedValue(true);
    const seal = vi.fn().mockResolvedValue(true);
    const abort = vi.fn().mockResolvedValue(true);

    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create,
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}${STAGED_MARKER}`,
          }),
          remove,
        },
        scripting: { executeScript },
      },
      createNonce: () => NONCE,
      transportMode: 'staged-v2',
      archiveStage: { begin, append, seal, abort },
    });

    expect(response).toEqual({
      success: true,
      data: {
        transport: 'staged',
        routeFamily: 'standard',
        stageId: STAGE_ID,
        kind: 'raw',
        relativePath: 'responses/conversation.json',
        byteLength: 16 * 1024 * 1024 + 1,
        sha256: SHA256,
        mediaType: 'application/json',
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
        transientAssetResolvers: [],
      },
    });
    expect(JSON.stringify(response)).not.toContain('bodyBase64');
    expect(create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}${STAGED_MARKER}`,
      active: false,
    });
    expect(append).toHaveBeenCalledTimes(33);
    for (let index = 0; index < 33; index += 1) {
      expect(append.mock.calls[index]?.slice(0, 2)).toEqual([STAGE_ID, index * 512 * 1024]);
    }
    expect(seal).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
    expect(
      executeScript.mock.calls
        .filter(([injection]) => injection.func === readChatGptOpaqueReplayChunkState)
        .every(([injection]) =>
          (injection as { target: { documentIds?: string[] } }).target.documentIds?.includes(
            'document-1'
          )
        )
    ).toBe(true);
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('rejects a mismatched staged conversation before allocating or reading a stage', async () => {
    const begin = vi.fn();
    const executeScript = vi.fn().mockResolvedValue([
      {
        frameId: 0,
        documentId: 'document-1',
        result: stagedState(16 * 1024 * 1024 + 1),
      },
    ]);
    const mismatched = stagedState();
    mismatched.conversationId = OTHER_CONVERSATION_ID;
    executeScript.mockResolvedValueOnce([
      { frameId: 0, documentId: 'document-1', result: mismatched },
    ]);

    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}${STAGED_MARKER}`,
          }),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        scripting: { executeScript },
      },
      createNonce: () => NONCE,
      transportMode: 'staged-v2',
      archiveStage: {
        begin,
        append: vi.fn(),
        seal: vi.fn(),
        abort: vi.fn(),
      },
    });

    expect(response).toEqual({
      success: false,
      code: 'replay-result-invalid',
      singularDispatchCount: 1,
    });
    expect(begin).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript.mock.calls[1]?.[0]).toMatchObject({
      target: { tabId: 123, documentIds: ['document-1'] },
      func: releaseChatGptOpaqueReplayChunkState,
      args: [NONCE],
    });
  });

  it.each([
    'chunk-offset',
    'base64',
    'throwing-reader',
    'document',
    'route',
    'append',
    'seal',
    'reload-after-seal',
    'wire-change-after-seal',
    'chunk-nonce',
    'chunk-index',
    'chunk-extra-key',
    'chunk-oversize',
  ] as const)(
    'aborts its extension-owned stage on %s failure without inline fallback',
    async fault => {
      const fullChunkBase64 = Buffer.alloc(512 * 1024, 3).toString('base64');
      const lastChunkBase64 = Buffer.from([4]).toString('base64');
      let reloaded = false;
      let sealed = false;
      const executeScript = vi.fn(
        async (injection: { func: (...args: never[]) => unknown; args: unknown[] }) => {
          if (injection.func === releaseChatGptOpaqueReplayChunkState) {
            if (reloaded) throw new Error('old document reader disappeared');
            return [{ frameId: 0, documentId: 'document-1', result: true }];
          }
          if (injection.func === readChatGptOpaqueReplayChunkState) {
            if (fault === 'throwing-reader') throw new Error('synthetic reader failure');
            const index = injection.args[1] as number;
            const last = index === 32;
            return [
              {
                frameId: 0,
                documentId: fault === 'document' ? 'document-2' : 'document-1',
                result:
                  fault === 'chunk-oversize'
                    ? WIRE_PREFIX + 'chunk:' + ' '.repeat(704_000)
                    : {
                        kind: 'chunk',
                        index: fault === 'chunk-index' ? index + 1 : index,
                        ...(fault === 'chunk-nonce' && { nonce: 'wrong-correlation-nonce' }),
                        ...(fault === 'chunk-extra-key' && { stageId: STAGE_ID }),
                        offset: fault === 'chunk-offset' ? 1 : index * 512 * 1024,
                        byteLength: last ? 1 : 512 * 1024,
                        chunkBase64:
                          fault === 'base64'
                            ? `${'A'.repeat(fullChunkBase64.length - 2)}B=`
                            : last
                              ? lastChunkBase64
                              : fullChunkBase64,
                      },
              },
            ];
          }
          if (reloaded) return [];
          return [
            {
              frameId: 0,
              documentId: 'document-1',
              result:
                fault === 'wire-change-after-seal' && sealed
                  ? fixtureWire(stagedState(), NONCE, 'staged-v2') + ' '
                  : stagedState(),
            },
          ];
        }
      );
      let routeReads = 0;
      const begin = vi.fn(async (_descriptor, onAllocated?: (stageId: string) => void) => {
        onAllocated?.(STAGE_ID);
        return STAGE_ID;
      });
      const append = vi.fn().mockResolvedValue(fault !== 'append');
      const seal = vi.fn(async () => {
        sealed = true;
        if (fault === 'reload-after-seal') reloaded = true;
        return fault !== 'seal';
      });
      const abort = vi.fn().mockResolvedValue(true);
      const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
        chromeApi: {
          tabs: {
            create: vi.fn().mockResolvedValue({ id: 123 }),
            get: vi.fn(async () => {
              routeReads += 1;
              return {
                status: 'complete',
                url:
                  fault === 'route' && routeReads > 2
                    ? `https://chatgpt.com/c/${OTHER_CONVERSATION_ID}${STAGED_MARKER}`
                    : `https://chatgpt.com/c/${CONVERSATION_ID}${STAGED_MARKER}`,
              };
            }),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          scripting: { executeScript },
        },
        createNonce: () => NONCE,
        transportMode: 'staged-v2',
        archiveStage: { begin, append, seal, abort },
      });

      expect(response).toEqual({
        success: false,
        code: fault === 'route' ? 'unexpected-path' : 'replay-result-invalid',
        singularDispatchCount: 1,
      });
      expect(abort).toHaveBeenCalledWith(STAGE_ID);
      expect(JSON.stringify(response)).not.toContain('bodyBase64');
      if (fault === 'reload-after-seal') {
        expect(
          executeScript.mock.calls.some(
            ([injection]) => injection.func === releaseChatGptOpaqueReplayChunkState
          )
        ).toBe(true);
      }
    }
  );

  it('reclaims both timed-out and late begin ownership by its allocated extension ID', async () => {
    vi.useFakeTimers();
    let resolveBegin: ((stageId: string) => void) | undefined;
    const begin = vi.fn((_descriptor, onAllocated?: (stageId: string) => void) => {
      onAllocated?.(STAGE_ID);
      return new Promise<string>(resolve => {
        resolveBegin = resolve;
      });
    });
    const abort = vi.fn().mockResolvedValue(true);
    const pending = captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}${STAGED_MARKER}`,
          }),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        scripting: {
          executeScript: vi.fn(async (injection: { func: (...args: never[]) => unknown }) => [
            {
              frameId: 0,
              documentId: 'document-1',
              result:
                injection.func === releaseChatGptOpaqueReplayChunkState ? true : stagedState(),
            },
          ]),
        },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      transportMode: 'staged-v2',
      archiveStage: {
        begin,
        append: vi.fn(),
        seal: vi.fn(),
        abort,
      },
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 1,
    });
    expect(abort).toHaveBeenCalledWith(STAGE_ID);
    resolveBegin?.(STAGE_ID);
    await vi.runAllTimersAsync();
    expect(abort.mock.calls.filter(([id]) => id === STAGE_ID).length).toBeGreaterThanOrEqual(2);
  });

  it('bounds a hanging owned-stage abort after begin timeout and still removes the tab', async () => {
    vi.useFakeTimers();
    const remove = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn(() => new Promise<boolean>(() => undefined));
    const pending = captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}${STAGED_MARKER}`,
          }),
          remove,
        },
        scripting: {
          executeScript: vi.fn(async (injection: { func: (...args: never[]) => unknown }) => [
            {
              frameId: 0,
              documentId: 'document-1',
              result:
                injection.func === releaseChatGptOpaqueReplayChunkState ? true : stagedState(),
            },
          ]),
        },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      transportMode: 'staged-v2',
      archiveStage: {
        begin: vi.fn((_descriptor, onAllocated?: (stageId: string) => void) => {
          onAllocated?.(STAGE_ID);
          return new Promise<string | undefined>(() => undefined);
        }),
        append: vi.fn(),
        seal: vi.fn(),
        abort,
      },
    });

    await vi.advanceTimersByTimeAsync(1_001);
    expect(abort).toHaveBeenCalledWith(STAGE_ID);
    await vi.advanceTimersByTimeAsync(501);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 1,
    });
    expect(remove).toHaveBeenCalledWith(123);
  });

  it.each(['resolve', 'reject'] as const)(
    're-aborts after an append settles with %s beyond the outer replay deadline',
    async settlement => {
      vi.useFakeTimers();
      let resolveAppend: ((value: boolean) => void) | undefined;
      let rejectAppend: ((reason: unknown) => void) | undefined;
      const append = vi.fn(
        () =>
          new Promise<boolean>((resolve, reject) => {
            resolveAppend = resolve;
            rejectAppend = reject;
          })
      );
      const abort = vi.fn().mockResolvedValue(true);
      const fullChunkBase64 = Buffer.alloc(512 * 1024, 5).toString('base64');
      const executeScript = vi.fn(
        async (injection: { func: (...args: never[]) => unknown; args: unknown[] }) => {
          if (injection.func === releaseChatGptOpaqueReplayChunkState) {
            return [{ frameId: 0, documentId: 'document-1', result: true }];
          }
          if (injection.func === readChatGptOpaqueReplayChunkState) {
            return [
              {
                frameId: 0,
                documentId: 'document-1',
                result: {
                  kind: 'chunk',
                  index: 0,
                  offset: 0,
                  byteLength: 512 * 1024,
                  chunkBase64: fullChunkBase64,
                },
              },
            ];
          }
          return [{ frameId: 0, documentId: 'document-1', result: stagedState() }];
        }
      );
      const pending = captureChatGptConversationViaOpaqueReplay(TARGET, {
        chromeApi: {
          tabs: {
            create: vi.fn().mockResolvedValue({ id: 123 }),
            get: vi.fn().mockResolvedValue({
              status: 'complete',
              url: `https://chatgpt.com/c/${CONVERSATION_ID}${STAGED_MARKER}`,
            }),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          scripting: { executeScript },
        },
        createNonce: () => NONCE,
        timeoutMs: 1_000,
        transportMode: 'staged-v2',
        archiveStage: {
          begin: vi.fn(async (_descriptor, onAllocated?: (stageId: string) => void) => {
            onAllocated?.(STAGE_ID);
            return STAGE_ID;
          }),
          append,
          seal: vi.fn(),
          abort,
        },
      });

      await vi.advanceTimersByTimeAsync(1_001);
      await expect(pending).resolves.toEqual({
        success: false,
        code: 'replay-result-timeout',
        singularDispatchCount: 1,
      });
      expect(abort.mock.calls.filter(([id]) => id === STAGE_ID)).toHaveLength(1);

      if (settlement === 'resolve') resolveAppend?.(true);
      else rejectAppend?.(new Error('late append rejection'));
      await vi.runAllTimersAsync();
      expect(abort.mock.calls.filter(([id]) => id === STAGE_ID).length).toBeGreaterThanOrEqual(2);
    }
  );

  it('clamps explicit timeout and polling bounds without changing a valid result', async () => {
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
      timeoutMs: Number.POSITIVE_INFINITY,
      pollIntervalMs: -10,
    });
    expect(response.success).toBe(true);
  });

  it.each([
    ['wrong conversation state', capturedState(OTHER_CONVERSATION_ID), 'replay-result-invalid', 1],
    [
      'noncanonical base64',
      {
        ...capturedState(),
        capture: { ...capturedState().capture, bodyBase64: 'AP8B=' },
      },
      'replay-result-timeout',
      0,
    ],
  ])('rejects %s without adapting response bytes', async (_label, result, expectedCode, count) => {
    let now = 0;
    const chrome = chromeApi(result);
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
      timeoutMs: 1_000,
      now: () => now,
      sleep: async () => {
        now = 1_001;
      },
    });

    expect(response).toEqual({
      success: false,
      code: expectedCode,
      singularDispatchCount: count,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('fails closed on marker/path mismatch before reading MAIN-world state', async () => {
    const chrome = chromeApi(
      capturedState(),
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`
    );
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
    });

    expect(response).toEqual({ success: false, code: 'unexpected-path', singularDispatchCount: 0 });
    expect(chrome.api.scripting.executeScript).not.toHaveBeenCalled();
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('returns the stable one-count failure from MAIN world without a retry', async () => {
    const chrome = chromeApi({
      kind: 'error',
      code: 'replay-rejected',
      singularDispatchCount: 1,
    });
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
    });

    expect(response).toEqual({ success: false, code: 'replay-rejected', singularDispatchCount: 1 });
    expect(chrome.api.scripting.executeScript).toHaveBeenCalledOnce();
  });

  it('bounds a hanging script read and still closes the tab', async () => {
    vi.useFakeTimers();
    const chrome = chromeApi({ kind: 'ready' });
    chrome.api.scripting.executeScript = vi.fn(() => new Promise(() => undefined));
    const pending = captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 0,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('bounds a hanging post-capture digest and still closes the tab', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const chrome = chromeApi(capturedState());
    const pending = captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: () => new Promise<string>(() => undefined),
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);

    await expect(pending).resolves.toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 1,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('cleans a late-created tab after the deadline and bounds a hanging remove', async () => {
    vi.useFakeTimers();
    let resolveCreate: ((value: { id?: number }) => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<{ id?: number }>(resolve => {
          resolveCreate = resolve;
        })
    );
    const remove = vi.fn(() => new Promise<void>(() => undefined));
    const pending = captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
      singularDispatchCount: 0,
    });
    resolveCreate?.({ id: 456 });
    await vi.advanceTimersByTimeAsync(501);
    expect(remove).toHaveBeenCalledWith(456);
  });

  it('does not create a tab for an invalid conversation identifier', async () => {
    const create = vi.fn();
    const response = await captureChatGptConversationViaOpaqueReplay('not-a-uuid', {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
    });
    expect(response).toEqual({
      success: false,
      code: 'invalid-conversation-id',
      singularDispatchCount: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid nonce', () => 'bad'],
    [
      'a throwing nonce source',
      () => {
        throw new Error('synthetic nonce failure');
      },
    ],
  ])('fails before tab creation for %s', async (_label, createNonce) => {
    const create = vi.fn();
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
      createNonce,
    });
    expect(response).toEqual({
      success: false,
      code: 'nonce-invalid',
      singularDispatchCount: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a synchronous create failure',
      () => {
        throw new Error('synthetic create failure');
      },
      'temporary-tab-create-failed',
    ],
    ['a missing tab id', () => Promise.resolve({}), 'temporary-tab-missing-id'],
  ])('fails closed for %s', async (_label, create, code) => {
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: { create: vi.fn(create), get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
    });
    expect(response).toEqual({ success: false, code, singularDispatchCount: 0 });
  });

  it('rejects a redirected temporary tab on another origin', async () => {
    const chrome = chromeApi(capturedState(), `https://evil.example/c/${CONVERSATION_ID}${MARKER}`);
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
    });
    expect(response).toEqual({
      success: false,
      code: 'unexpected-origin',
      singularDispatchCount: 0,
    });
    expect(chrome.api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('turns repeated tab-read failures into a bounded readiness timeout', async () => {
    let now = 0;
    const remove = vi.fn().mockResolvedValue(undefined);
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockRejectedValue(new Error('synthetic tab read failure')),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      now: () => now,
      sleep: async () => {
        now = 1_001;
      },
    });
    expect(response).toEqual({
      success: false,
      code: 'temporary-tab-ready-timeout',
      singularDispatchCount: 0,
    });
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('contains an unexpected lifecycle clock failure and still removes the exact tab', async () => {
    let calls = 0;
    const remove = vi.fn().mockResolvedValue(undefined);
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn(),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      now: () => {
        calls += 1;
        if (calls >= 3) throw new Error('synthetic clock failure');
        return 0;
      },
    });
    expect(response).toEqual({
      success: false,
      code: 'replay-result-invalid',
      singularDispatchCount: 0,
    });
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('bounds rejected readiness and result sleeps without leaking the tab', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const readiness = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({ status: 'loading' }),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      sleep: () => Promise.reject(new Error('synthetic sleep failure')),
    });
    expect(readiness).toEqual({
      success: false,
      code: 'temporary-tab-ready-timeout',
      singularDispatchCount: 0,
    });

    const chrome = chromeApi({ kind: 'ready' });
    const result = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      sleep: () => Promise.reject(new Error('synthetic sleep failure')),
    });
    expect(result).toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 0,
    });
    expect(remove).toHaveBeenCalledWith(123);
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it.each([
    ['a digest mismatch', async () => 'f'.repeat(64)],
    [
      'a rejected digest',
      async () => {
        throw new Error('synthetic digest failure');
      },
    ],
  ])('rejects %s after one captured dispatch and cleans the tab', async (_label, digestSha256) => {
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256,
    });
    expect(response).toEqual({
      success: false,
      code: 'replay-result-invalid',
      singularDispatchCount: 1,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it.each([
    [
      'an unavailable decoder',
      () => {
        vi.stubGlobal('atob', undefined);
      },
    ],
    [
      'a noncanonical encoder round-trip',
      () => {
        vi.stubGlobal('btoa', () => 'different');
      },
    ],
    [
      'a throwing decoder',
      () => {
        vi.stubGlobal('atob', () => {
          throw new Error('synthetic decoder failure');
        });
      },
    ],
  ])('rejects captured bytes with %s', async (_label, arrange) => {
    arrange();
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
    });
    expect(response).toEqual({
      success: false,
      code: 'replay-result-invalid',
      singularDispatchCount: 1,
    });
  });

  it('handles an asynchronously rejected tab creation without an unhandled error', async () => {
    const response = await captureChatGptConversationViaOpaqueReplay(TARGET, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockRejectedValue(new Error('synthetic async create failure')),
          get: vi.fn(),
          remove: vi.fn(),
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
    });
    expect(response).toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
      singularDispatchCount: 0,
    });
  });

  it('rejects exact-state extras including non-enumerable and symbol keys in MAIN world', () => {
    expect(readChatGptOpaqueReplayState('bad')).toEqual({ kind: 'missing' });
    const withNonEnumerableExtra = capturedState();
    Object.defineProperty(withNonEnumerableExtra, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'synthetic-secret',
    });
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: withNonEnumerableExtra });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        ...capturedState(),
        [Symbol('secret')]: true,
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
  });

  it.each([
    ['infinite byte length', Number.POSITIVE_INFINITY, 33],
    ['NaN byte length', Number.NaN, 33],
    ['infinite chunk count', 16 * 1024 * 1024 + 1, Number.POSITIVE_INFINITY],
  ])(
    'rejects %s in the extension contract without MAIN metadata traversal',
    (_label, byteLength, chunkCount) => {
      const reader = vi.fn(() => MISSING_WIRE);
      const state = {
        ...stagedState(),
        capture: { ...stagedState().capture, byteLength, chunkCount },
      };
      vi.stubGlobal('window', {
        [`__liskaChatGptOpaqueReplay_${NONCE}`]: state,
        [`__liskaChatGptOpaqueReplayChunkReader_${NONCE}`]: reader,
      });

      expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
      expect(readChatGptOpaqueReplayChunkState(NONCE, 0)).toEqual(MISSING_WIRE);
      expect(reader).toHaveBeenCalledExactlyOnceWith(0);
    }
  );

  it('rejects staged accessors before invoking a stateful byte-length getter', () => {
    const byteLength = vi
      .fn()
      .mockReturnValueOnce(16 * 1024 * 1024 + 1)
      .mockReturnValue(Number.POSITIVE_INFINITY);
    const capture = { ...stagedState().capture } as Record<string, unknown>;
    Object.defineProperty(capture, 'byteLength', {
      configurable: true,
      enumerable: true,
      get: byteLength,
    });
    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: { ...stagedState(), capture },
      [`__liskaChatGptOpaqueReplayChunkReader_${NONCE}`]: vi.fn(),
    });

    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
    expect(readChatGptOpaqueReplayChunkState(NONCE, 0)).toEqual(MISSING_WIRE);
    expect(byteLength).not.toHaveBeenCalled();
  });

  it('reads exact ready, error, and captured MAIN-world states and rejects malformed capture values', () => {
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: { kind: 'ready' } });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'ready' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        kind: 'error',
        code: 'target-not-observed',
        singularDispatchCount: 0,
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({
      kind: 'error',
      code: 'target-not-observed',
      singularDispatchCount: 0,
    });

    vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: capturedState() });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual(capturedState());

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        ...capturedState(),
        capture: { ...capturedState().capture, byteLength: '3' },
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        ...capturedState(),
        capture: { bodyBase64: 'AP8B' },
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      get [`__liskaChatGptOpaqueReplay_${NONCE}`]() {
        throw new Error('synthetic state getter failure');
      },
    });
    expect(parseChatGptOpaqueReplayStateWire(readStateWire(NONCE), NONCE, 'legacy-inline')).toEqual(
      { kind: 'missing' }
    );
  });
});
