// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBObjectStore, IDBDatabase, IDBTransaction } from 'fake-indexeddb';
import ts from 'typescript';
import {
  ROOT,
  CSP,
  INVENTORY,
  HARNESS_ROOT,
  DEFAULT_EXTENSION,
  SOURCE_CLOSURE,
  buildProviderBaselineOwnerLifecycleBrowser,
  inspectHarnessBuild,
  inspectSourceClosure,
  runtimeReferences,
  validateRuntimeModules,
  validateHarnessManifest,
  filesWithin,
  safeOutputDirectory,
  sha256,
  // @ts-expect-error -- Direct opt-in Node .mjs tooling has no declarations.
} from '../../scripts/build-provider-baseline-owner-lifecycle-browser.mjs';
import {
  runProviderBaselineOwnerLifecycleScenario,
  ROW_IDS,
  type Receipt,
  type ScenarioEnvironment,
} from '../browser/provider-baseline-owner-lifecycle/scenario';
import { installNetworkDenial } from '../browser/provider-baseline-owner-lifecycle/capabilities';

const root = mkdtempSync(join(tmpdir(), 'provider-owner-browser-test-'));
const extension = join(root, 'extension');
type BuildReceipt = {
  ok: boolean;
  sourceModules: number;
  runtimeModules: number;
  files: { id: string; bytes: number; sha256: string }[];
};
let built: BuildReceipt;
const snapshot = (directory: string) =>
  filesWithin(directory).map(
    (file: string) => `${file}:${sha256(readFileSync(resolve(directory, file)))}`
  );
const manifest = () => JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
const cloneBuild = (suffix: string) => {
  const target = join(root, 'mutation-' + suffix);
  cpSync(extension, target, { recursive: true });
  return target;
};
const protectedState = () =>
  [
    'dist',
    'src/manifest.json',
    'vite.config.ts',
    'vitest.config.ts',
    'tsconfig.json',
    'eslint.config.js',
    'package.json',
    'package-lock.json',
    'scripts/build-baseline-owner-browser.mjs',
    'scripts/build-provider-baseline-owner-browser.mjs',
    'test/browser/provider-baseline-owner',
    'test/scripts/provider-baseline-owner-browser-harness.test.ts',
    'test/browser/baseline-owner',
    'test/scripts/baseline-owner-browser-harness.test.ts',
  ].map(file =>
    file === 'dist' || file.startsWith('test/browser/')
      ? snapshot(resolve(ROOT, file))
      : sha256(readFileSync(resolve(ROOT, file)))
  );
const originalProtected = protectedState();
beforeAll(async () => {
  built = await buildProviderBaselineOwnerLifecycleBrowser(extension);
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  expect(protectedState()).toEqual(originalProtected);
  expect(root.startsWith(join(tmpdir(), 'provider-owner-browser-test-'))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

describe('separate opt-in provider owner MV3 build', () => {
  it('builds exactly four deterministic files with checked content hashes', async () => {
    expect(DEFAULT_EXTENSION).toBe(
      resolve(ROOT, 'test-results/provider-baseline-owner-lifecycle-browser/extension')
    );
    expect(built.ok).toBe(true);
    expect(built.sourceModules).toBe(39);
    expect(built.runtimeModules).toBe(40);
    expect(built.files.map(file => file.id)).toEqual(INVENTORY);
    for (const file of built.files) {
      const bytes = readFileSync(join(extension, file.id));
      expect(file.bytes).toBe(bytes.length);
      expect(file.sha256).toBe(sha256(bytes));
    }
    expect(await buildProviderBaselineOwnerLifecycleBrowser(extension)).toEqual(built);
    expect(await buildProviderBaselineOwnerLifecycleBrowser(join(root, 'repeat'))).toEqual(built);
    expect(snapshot(join(root, 'repeat'))).toEqual(snapshot(extension));
    expect(JSON.stringify(built)).not.toContain(root);
  });
  it('rejects all manifest authority mutations, missing fields and nested extras', () => {
    const original = manifest();
    expect(original.content_security_policy).toEqual({ extension_pages: CSP });
    for (const mutation of [
      { manifest_version: 2 },
      { permissions: ['storage'] },
      { host_permissions: ['<all_urls>'] },
      { background: { service_worker: 'worker.js' } },
      { content_scripts: [] },
      { web_accessible_resources: [] },
      { externally_connectable: {} },
      { options_ui: { ...original.options_ui, browser_style: true } },
      { options_ui: { page: 'other.html', open_in_tab: true } },
      {
        content_security_policy: {
          extension_pages: CSP.replace("connect-src 'none'", "connect-src 'self'"),
        },
      },
      { content_security_policy: { extension_pages: CSP + "; worker-src 'self'" } },
      {
        content_security_policy: {
          extension_pages: CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
        },
      },
    ])
      expect(() => validateHarnessManifest({ ...original, ...mutation })).toThrow(
        'unsafe-harness-manifest'
      );
    for (const key of Object.keys(original)) {
      const missing = { ...original };
      delete missing[key];
      expect(() => validateHarnessManifest(missing)).toThrow('unsafe-harness-manifest');
    }
    expect(() => validateHarnessManifest(original)).not.toThrow();
  });
  it.each([
    ['map', 'assets/runner.js.map', '{}', 'unexpected-build-inventory'],
    ['chunk', 'assets/extra.js', '', 'unexpected-build-inventory'],
    [
      'extension',
      'assets/runner.js',
      'globalThis.chrome.runtime.sendMessage({});',
      'unexpected-runtime-authority',
    ],
    ['web-storage', 'assets/runner.js', 'localStorage.clear();', 'unexpected-runtime-authority'],
    [
      'session-storage',
      'assets/runner.js',
      'globalThis["sessionStorage"].clear();',
      'unexpected-runtime-authority',
    ],
    [
      'clipboard',
      'assets/runner.js',
      'navigator.clipboard.readText();',
      'unexpected-runtime-authority',
    ],
    ['worker', 'assets/runner.js', 'new Worker("./worker.js");', 'unexpected-runtime-authority'],
    [
      'shared-worker',
      'assets/runner.js',
      'new SharedWorker("./worker.js");',
      'unexpected-runtime-authority',
    ],
    [
      'service-worker',
      'assets/runner.js',
      'navigator.serviceWorker.register("./worker.js");',
      'unexpected-runtime-authority',
    ],
    ['eval', 'assets/runner.js', 'eval("1");', 'unexpected-runtime-authority'],
    ['function', 'assets/runner.js', 'new Function("return 1")();', 'unexpected-runtime-authority'],
    ['dynamic', 'assets/runner.js', 'import("./other.js");', 'unexpected-runtime-authority'],
    ['static', 'assets/runner.js', 'import "./other.js";', 'unexpected-runtime-authority'],
    [
      'remote',
      'assets/runner.js',
      'const endpoint = "https://example.invalid";',
      'unexpected-runtime-authority',
    ],
    [
      'protocol-relative',
      'assets/runner.js',
      'const endpoint = "//example.invalid";',
      'unexpected-runtime-authority',
    ],
    [
      'remote-css',
      'assets/style.css',
      'body{background:url(//example.invalid/a)}',
      'unexpected-runtime-authority',
    ],
    ['css-import', 'assets/style.css', '@import "./other.css";', 'unexpected-runtime-authority'],
    ['html', 'index.html', '<script>void 0</script>', 'unexpected-html-authority'],
    [
      'extra-script',
      'index.html',
      '<script src="./assets/runner.js"></script>',
      'unexpected-html-authority',
    ],
    ['inline-style', 'index.html', '<p style="color:red">test</p>', 'unexpected-html-authority'],
  ])('rejects generated %s authority', (suffix, file, content, code) => {
    const target = cloneBuild(suffix);
    writeFileSync(
      join(target, file),
      (file === 'index.html' ? readFileSync(join(target, file), 'utf8') : '') + content
    );
    expect(() => inspectHarnessBuild(target)).toThrow(code);
  });
  it('protects production, unrelated directories and symlink ancestors/children', async () => {
    for (const target of [
      ROOT,
      resolve(ROOT, '..'),
      resolve(ROOT, 'dist'),
      resolve(ROOT, 'src/harness'),
      resolve(ROOT, 'test-results'),
    ])
      expect(() => safeOutputDirectory(target)).toThrow('output-containment');
    const unrelated = join(root, 'unrelated');
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, 'keep.txt'), 'keep');
    await expect(buildProviderBaselineOwnerLifecycleBrowser(unrelated)).rejects.toThrow(
      'unexpected-build-inventory'
    );
    expect(readFileSync(join(unrelated, 'keep.txt'), 'utf8')).toBe('keep');
    const link = join(root, 'linked');
    symlinkSync(unrelated, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => safeOutputDirectory(join(link, 'child'))).toThrow('unsafe-output-path');
    const child = join(root, 'with-link');
    mkdirSync(child);
    symlinkSync(
      extension,
      join(child, 'nested'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect(() => filesWithin(child)).toThrow('symlink-output');
    const wrongManifest = cloneBuild('wrong-manifest');
    writeFileSync(join(wrongManifest, 'manifest.json'), '{}');
    await expect(buildProviderBaselineOwnerLifecycleBrowser(wrongManifest)).rejects.toThrow(
      'unsafe-harness-manifest'
    );
  });
  it('runs the exact CLI and preserves production and every old harness byte', () => {
    const before = protectedState();
    const result = spawnSync(
      process.execPath,
      [
        resolve(ROOT, 'scripts/build-provider-baseline-owner-lifecycle-browser.mjs'),
        join(root, 'cli-extension'),
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(built);
    const denied = spawnSync(
      process.execPath,
      [
        resolve(ROOT, 'scripts/build-provider-baseline-owner-lifecycle-browser.mjs'),
        resolve(ROOT, 'dist'),
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(denied.status).toBe(1);
    expect(JSON.parse(denied.stderr)).toEqual({ ok: false, code: 'output-containment' });
    expect(protectedState()).toEqual(before);
    const scripts = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts;
    expect(JSON.stringify(scripts)).not.toContain('provider-baseline-owner');
  });
});

function environment(factory: IDBFactory = new IDBFactory()): ScenarioEnvironment {
  return {
    indexedDB: factory,
    crypto: webcrypto as unknown as Crypto,
    timers: {
      setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    monotonicNow: () => performance.now(),
    remainedVisible: () => true,
    networkCalls: () => 0,
  };
}
function contentFree(receipt: Receipt) {
  expect(Object.keys(receipt).sort()).toEqual(
    ['schema', 'status', 'code', 'rows', 'elapsedMs', 'maxGapMs'].sort()
  );
  expect(receipt.schema).toBe('liska-provider-owner-lifecycle-native-receipt/1');
  expect(receipt.rows.map(row => row.id)).toEqual(ROW_IDS);
  expect(JSON.stringify(receipt)).not.toMatch(
    /00000000|native-acceptance-|operation-|capture-|\.json|\.md|[a-f0-9]{64}|https?:|conversationId|recordSha256|databaseName|PRIVATE/iu
  );
  for (const row of receipt.rows) {
    expect(Object.keys(row).sort()).toEqual(['id', 'metrics', 'status']);
    for (const number of row.metrics)
      expect(Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000).toBe(true);
  }
  for (const number of [receipt.elapsedMs, receipt.maxGapMs])
    expect(Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000).toBe(true);
}
function checkReceipt(receipt: Receipt) {
  contentFree(receipt);
  expect(receipt.status, JSON.stringify(receipt)).toBe('PASS');
  expect(receipt.code).toBe('none');
  expect(receipt.rows.every(row => row.status === 'PASS')).toBe(true);
  const row = (id: string) => receipt.rows.find(row => row.id === id)!.metrics;
  expect(row('guarded-database')).toEqual([7, 0, 0]);
  expect(row('claim-consume-once')).toEqual([0, 1, 1, 1]);
  expect(row('pause-late-evidence')).toEqual([1, 2, 3, 1, 1]);
  expect(row('restart-late-evidence')).toEqual([1, 2, 3, 1, 1]);
  expect(row('claim-committed-revoked')).toEqual([1, 1, 0, 2]);
  expect(row('consume-final-fence')).toEqual([1, 1, 1, 0]);
  expect(row('two-handle-claim-cas')).toEqual([1, 1, 1, 1, 1]);
  expect(row('consume-inventory-fence')).toEqual([4, 1, 0, 1]);
  expect(row('interruption-observation')).toEqual([2, 5, 1, 0]);
  expect(row('evidence-atomic-abort')).toEqual([1, 1, 1, 1]);
  expect(row('cleanup').slice(1)).toEqual([9, 9, 7]);
  expect(row('network-denial')).toEqual([0]);
}
function compiledWindow(factory: IDBFactory) {
  const dom = new JSDOM(readFileSync(join(extension, 'index.html'), 'utf8'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries({
    indexedDB: factory,
    crypto: webcrypto,
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    DOMException,
  }))
    Object.defineProperty(dom.window, key, { configurable: true, value });
  dom.window.eval(readFileSync(join(extension, 'assets/runner.js'), 'utf8'));
  return dom;
}
async function runCompiled(dom: JSDOM) {
  dom.window.document.querySelector<HTMLButtonElement>('#run')!.click();
  const start = performance.now();
  while (
    dom.window.document.querySelector('#overall')!.textContent === 'NOT RUN' &&
    performance.now() - start < 5000
  )
    await new Promise(resolve => setTimeout(resolve, 10));
  return JSON.parse(dom.window.document.querySelector('#receipt')!.textContent!) as Receipt;
}

describe('compiled lifecycle runner with native WebCrypto and fake IDB', () => {
  it.each(['later-observer', 'missing-observer', 'operations-differ', 'owner-differ'] as const)(
    'requires the real terminal observation and exact both-store rollback: %s',
    async mode => {
      const factory = new IDBFactory(),
        nativePut = IDBObjectStore.prototype.put;
      const nativeListen = IDBTransaction.prototype.addEventListener;
      let target: IDBTransaction | undefined,
        registrations = 0,
        observed = 0;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value,
        key
      ) {
        const request = nativePut.call(this, value, key);
        if (this.name === 'operations' && key === 'operation-synthetic' && value.byteLength > 1) {
          const record = JSON.parse(new TextDecoder().decode(value));
          if (record.phase === 'awaiting-resolution' && record.revision === 2)
            target = this.transaction;
        }
        return request;
      });
      vi.spyOn(IDBTransaction.prototype, 'addEventListener').mockImplementation(function (
        this: IDBTransaction,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) {
        if (
          this === target &&
          type === 'abort' &&
          listener &&
          typeof options === 'object' &&
          options.once
        ) {
          registrations++;
          return nativeListen.call(
            this,
            type,
            event => {
              // Preserve the real event/transaction. Only the harness observer is delivered
              // after native handler promise continuations; no terminal event is fabricated.
              setTimeout(() => {
                if (mode === 'missing-observer') return;
                const deliver = () => {
                  observed++;
                  if (typeof listener === 'function') listener.call(this, event);
                  else listener.handleEvent(event);
                };
                if (mode === 'operations-differ' || mode === 'owner-differ') {
                  // A separate real write deliberately violates one half of rollback equality.
                  // Await its real commit before releasing the harness's abort observation.
                  const store = mode === 'operations-differ' ? 'operations' : 'owner';
                  const change = this.db.transaction(store, 'readwrite');
                  change
                    .objectStore(store)
                    .put(
                      new Uint8Array([0]),
                      store === 'owner' ? 'baseline' : 'operation-synthetic'
                    );
                  change.oncomplete = deliver;
                } else deliver();
              }, 0);
            },
            options
          );
        }
        return nativeListen.call(this, type, listener, options);
      });
      const dom = compiledWindow(factory);
      try {
        const receipt = await runCompiled(dom);
        contentFree(receipt);
        if (mode === 'later-observer') checkReceipt(receipt);
        else {
          expect(receipt.status).toBe('FAIL');
          expect(receipt.rows.find(row => row.id === 'evidence-atomic-abort')?.status).toBe('FAIL');
          expect(
            receipt.rows
              .filter(row => row.id !== 'evidence-atomic-abort')
              .every(row => row.status === 'PASS')
          ).toBe(true);
        }
        expect(registrations).toBe(1);
        expect(observed).toBe(mode === 'missing-observer' ? 0 : 1);
        expect(await factory.databases()).toEqual([]);
      } finally {
        dom.window.close();
      }
    }
  );
  it('delegates exact native PUTs and observes request success before real complete/abort terminals', async () => {
    const factory = new IDBFactory(),
      nativePut = IDBObjectStore.prototype.put;
    const nativeRemove = factory.deleteDatabase.bind(factory),
      nativeTransaction = IDBDatabase.prototype.transaction;
    let lifecycle = 1;
    const writes: { lifecycle: number; phase: string; revision: number; events: string[] }[] = [];
    const transactions: { lifecycle: number; mode: string; complete: boolean; stores: string[] }[] =
      [];
    vi.spyOn(factory, 'deleteDatabase').mockImplementation(name => {
      const request = nativeRemove(name);
      request.addEventListener('success', () => {
        lifecycle++;
      });
      return request;
    });
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      ...args
    ) {
      const transaction = nativeTransaction.apply(this, args);
      const entry = {
        lifecycle,
        mode: transaction.mode,
        complete: false,
        stores: [...transaction.objectStoreNames],
      };
      transactions.push(entry);
      transaction.addEventListener('complete', () => {
        entry.complete = true;
      });
      return transaction;
    });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key
    ) {
      const request = nativePut.call(this, value, key);
      if (this.name === 'operations') {
        expect(key).toBe('operation-synthetic');
        expect(this.transaction.mode).toBe('readwrite');
        expect(this.transaction.db.name).toMatch(
          /^liska-baseline-owner-v2-lifecycle-acceptance-[a-f0-9]{24}$/u
        );
        expect([...this.transaction.objectStoreNames]).toEqual(['operations', 'owner']);
        const record = JSON.parse(new TextDecoder().decode(value));
        const entry = {
          lifecycle,
          phase: record.phase,
          revision: record.revision,
          events: ['native-put'],
        };
        writes.push(entry);
        request.addEventListener('success', () => {
          entry.events.push('native-success');
        });
        for (const event of ['complete', 'abort'])
          this.transaction.addEventListener(event, () => {
            entry.events.push('native-' + event);
          });
      }
      return request;
    });
    const dom = compiledWindow(factory);
    try {
      checkReceipt(await runCompiled(dom));
      expect(writes.map(({ lifecycle, phase, revision }) => [lifecycle, phase, revision])).toEqual([
        [1, 'in-flight', 1],
        [2, 'in-flight', 1],
        [2, 'unknown', 2],
        [2, 'awaiting-resolution', 3],
        [3, 'in-flight', 1],
        [3, 'unknown', 2],
        [3, 'awaiting-resolution', 3],
        [4, 'in-flight', 1],
        [4, 'unknown', 2],
        [5, 'in-flight', 1],
        [6, 'in-flight', 1],
        [7, 'in-flight', 1],
        [8, 'in-flight', 1],
        [8, 'unknown', 2],
        [9, 'in-flight', 1],
        [9, 'awaiting-resolution', 2],
      ]);
      expect(
        writes
          .slice(0, -1)
          .every(
            entry =>
              JSON.stringify(entry.events) ===
              JSON.stringify(['native-put', 'native-success', 'native-complete'])
          )
      ).toBe(true);
      expect(writes.at(-1)?.events).toEqual(['native-put', 'native-success', 'native-abort']);
      expect(
        transactions
          .filter(item => item.lifecycle === 5 && item.mode === 'readwrite')
          .every(item => item.complete)
      ).toBe(true);
      expect(
        transactions
          .filter(item => item.mode !== 'versionchange')
          .every(item => JSON.stringify(item.stores) === JSON.stringify(['operations', 'owner']))
      ).toBe(true);
      expect(await factory.databases()).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
  it('runs all exact interleavings and installs denial before any IDB with complete native cleanup', async () => {
    const factory = new IDBFactory();
    const dom = compiledWindow(factory);
    const nativeOpen = factory.open.bind(factory);
    const open = vi.spyOn(factory, 'open'),
      remove = vi.spyOn(factory, 'deleteDatabase');
    const denialReady: boolean[] = [];
    const before = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map(key =>
      Object.getOwnPropertyDescriptor(dom.window, key)
    );
    open.mockImplementation((name, version) => {
      denialReady.push(
        ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].every(
          key => Reflect.get(dom.window, key)?.name === 'deny'
        ) && dom.window.navigator.sendBeacon.name === 'deny'
      );
      return nativeOpen(name, version);
    });
    const putDescriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put');
    const transactionDescriptor = Object.getOwnPropertyDescriptor(
      IDBDatabase.prototype,
      'transaction'
    );
    try {
      const receipt = await runCompiled(dom);
      checkReceipt(receipt);
      expect(denialReady.length).toBeGreaterThan(0);
      expect(denialReady.every(Boolean)).toBe(true);
      for (const id of ROW_IDS)
        expect(dom.window.document.getElementById(id)?.lastElementChild?.textContent).toBe('PASS');
      const names = [
        ...open.mock.calls.map(call => call[0]),
        ...remove.mock.calls.map(call => call[0]),
      ];
      expect(new Set(names).size).toBe(1);
      expect(names[0]).toMatch(/^liska-baseline-owner-v2-lifecycle-acceptance-[a-f0-9]{24}$/u);
      expect(open.mock.calls.every(call => call[1] === 1)).toBe(true);
      expect(remove).toHaveBeenCalledTimes(9);
      expect(await factory.databases()).toEqual([]);
      const finalDelete = remove.mock.invocationCallOrder.at(-1)!;
      expect(open.mock.invocationCallOrder.every(order => order < finalDelete)).toBe(true);
      expect(
        ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map(key =>
          Object.getOwnPropertyDescriptor(dom.window, key)
        )
      ).toEqual(before);
      expect(Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')).toEqual(
        putDescriptor
      );
      expect(Object.getOwnPropertyDescriptor(IDBDatabase.prototype, 'transaction')).toEqual(
        transactionDescriptor
      );
    } finally {
      dom.window.close();
    }
  });
  it('runs the same browser-safe source without DOM or test-helper dependencies', async () => {
    checkReceipt(await runProviderBaselineOwnerLifecycleScenario(environment()));
  });
  it('latches transient hidden visibility in the compiled runner and restores descriptors', async () => {
    const factory = new IDBFactory(),
      nativeOpen = factory.open.bind(factory);
    const dom = compiledWindow(factory);
    const before = Object.getOwnPropertyDescriptor(dom.window, 'fetch');
    let first = true;
    vi.spyOn(factory, 'open').mockImplementation((name, version) => {
      if (first) {
        first = false;
        for (const state of ['hidden', 'visible']) {
          Object.defineProperty(dom.window.document, 'visibilityState', {
            configurable: true,
            value: state,
          });
          dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
        }
      }
      return nativeOpen(name, version);
    });
    try {
      const receipt = await runCompiled(dom);
      contentFree(receipt);
      expect(receipt.status).toBe('INCONCLUSIVE');
      expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.metrics[0]).toBe(0);
      expect(dom.window.document.visibilityState).toBe('visible');
      expect(Object.getOwnPropertyDescriptor(dom.window, 'fetch')).toEqual(before);
      expect(await factory.databases()).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
  it.each(['late', 'regressed'] as const)(
    'marks compiled %s monotonic time INCONCLUSIVE',
    async kind => {
      const factory = new IDBFactory(),
        dom = compiledWindow(factory);
      let now = 0;
      vi.spyOn(dom.window.performance, 'now').mockImplementation(() =>
        kind === 'late' ? (now += 2000) : --now
      );
      try {
        const receipt = await runCompiled(dom);
        contentFree(receipt);
        expect(receipt.status).toBe('INCONCLUSIVE');
        expect(await factory.databases()).toEqual([]);
      } finally {
        dom.window.close();
      }
    }
  );
  it.each([0, 1001])('marks compiled final probe %s INCONCLUSIVE', async probe => {
    const factory = new IDBFactory(),
      dom = compiledWindow(factory);
    let now = 0;
    vi.spyOn(dom.window.performance, 'now').mockImplementation(() => now);
    const timer = dom.window.setTimeout.bind(dom.window);
    vi.spyOn(dom.window, 'setTimeout').mockImplementation((callback, delay, ...args) =>
      timer(() => {
        if (delay === 10) now += probe;
        if (typeof callback === 'function') callback(...args);
      }, delay)
    );
    try {
      const receipt = await runCompiled(dom);
      contentFree(receipt);
      expect(receipt.status).toBe('INCONCLUSIVE');
      expect(receipt.rows.find(row => row.id === 'evidence-atomic-abort')?.status).toBe('PASS');
      expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.metrics[1]).toBe(probe);
      expect(await factory.databases()).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
  it('fails denial installation before any compiled native open and rolls back partial descriptors', async () => {
    const factory = new IDBFactory(),
      open = vi.spyOn(factory, 'open'),
      dom = compiledWindow(factory);
    const before = Object.getOwnPropertyDescriptor(dom.window, 'XMLHttpRequest');
    Object.defineProperty(dom.window, 'WebSocket', { configurable: false, value: 3 });
    try {
      const receipt = await runCompiled(dom);
      contentFree(receipt);
      expect(receipt.status).toBe('FAIL');
      expect(receipt.rows.every(row => row.status === 'FAIL')).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(Object.getOwnPropertyDescriptor(dom.window, 'XMLHttpRequest')).toEqual(before);
    } finally {
      dom.window.close();
    }
  });
  it('reports a counted compiled transport call as FAIL and restores the exact descriptors', async () => {
    const factory = new IDBFactory(),
      nativeOpen = factory.open.bind(factory),
      dom = compiledWindow(factory);
    const before = Object.getOwnPropertyDescriptor(dom.window, 'fetch');
    vi.spyOn(factory, 'open').mockImplementation((name, version) => {
      expect(() => dom.window.fetch('')).toThrow('synthetic-network-denied');
      return nativeOpen(name, version);
    });
    try {
      const receipt = await runCompiled(dom);
      contentFree(receipt);
      expect(receipt.status).toBe('FAIL');
      expect(receipt.rows.find(row => row.id === 'network-denial')?.status).toBe('FAIL');
      expect(receipt.rows.find(row => row.id === 'evidence-atomic-abort')?.status).toBe('PASS');
      expect(Object.getOwnPropertyDescriptor(dom.window, 'fetch')).toEqual(before);
      expect(await factory.databases()).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
  it('keeps cleanup failure FAIL even if visibility is INCONCLUSIVE', async () => {
    const factory = new IDBFactory(),
      dom = compiledWindow(factory);
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    vi.spyOn(factory, 'deleteDatabase').mockImplementation(() => {
      throw new Error('PRIVATE cleanup');
    });
    try {
      const receipt = await runCompiled(dom);
      contentFree(receipt);
      expect(receipt.status).toBe('FAIL');
      expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('FAIL');
      expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.status).toBe(
        'INCONCLUSIVE'
      );
    } finally {
      dom.window.close();
    }
  });
  it('does not relabel a failed deletion PASS after a later completed delete', async () => {
    const factory = new IDBFactory(),
      nativeRemove = factory.deleteDatabase.bind(factory);
    let first = true;
    vi.spyOn(factory, 'deleteDatabase').mockImplementation(name => {
      if (first) {
        first = false;
        throw new Error('PRIVATE first delete');
      }
      return nativeRemove(name);
    });
    const receipt = await runProviderBaselineOwnerLifecycleScenario(environment(factory));
    contentFree(receipt);
    expect(receipt.status).toBe('FAIL');
    expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('FAIL');
    expect(await factory.databases()).toEqual([]);
  });
  it('sanitizes compiled native open exceptions without retaining exception prose', async () => {
    const factory = new IDBFactory(),
      dom = compiledWindow(factory);
    vi.spyOn(factory, 'open').mockImplementation(() => {
      throw new Error('PRIVATE operation-body');
    });
    try {
      const receipt = await runCompiled(dom);
      contentFree(receipt);
      expect(receipt.status).toBe('FAIL');
      expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('PASS');
      expect(await factory.databases()).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
  it('sanitizes native IndexedDB failure and still confirms deletion', async () => {
    const factory = new IDBFactory();
    vi.spyOn(factory, 'open').mockImplementation(() => {
      throw new Error('PRIVATE body');
    });
    const receipt = await runProviderBaselineOwnerLifecycleScenario(environment(factory));
    contentFree(receipt);
    expect(receipt.status).toBe('FAIL');
    expect(receipt.code).toBe('acceptance-failed');
    expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('PASS');
    expect(await factory.databases()).toEqual([]);
  });
  it.each(['advanced', 'regressed', 'hidden', 'responsive'] as const)(
    'classifies a bounded deadline with %s timing without exposing error prose',
    async kind => {
      const factory = new IDBFactory(),
        env = environment(factory);
      let now = 1000,
        visible = true,
        expiries = 0;
      const receipt = await runProviderBaselineOwnerLifecycleScenario({
        ...env,
        monotonicNow: () => now,
        remainedVisible: () => visible,
        timers: {
          ...env.timers,
          setTimeout: (callback, milliseconds) => {
            // Deterministically expire the first bounded wait before its fulfilled work
            // continuation. Native IDB/open/transaction deadlines remain untouched.
            if (callback.name === 'boundedDeadline' && expiries === 0) {
              expect(milliseconds).toBe(1500);
              expiries++;
              if (kind === 'advanced') now += 1501;
              if (kind === 'regressed') now--;
              if (kind === 'hidden') visible = false;
              callback();
              return env.timers.setTimeout(() => {}, 0);
            }
            return env.timers.setTimeout(() => {
              if (milliseconds === 10) now += 10;
              callback();
            }, milliseconds);
          },
        },
      });
      contentFree(receipt);
      expect(expiries).toBe(1);
      const expected = kind === 'responsive' ? 'FAIL' : 'INCONCLUSIVE';
      expect(receipt.status).toBe(expected);
      expect(receipt.rows.find(row => row.id === 'claim-consume-once')?.status).toBe(expected);
      expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('PASS');
      expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.status).toBe(
        kind === 'responsive' ? 'PASS' : 'INCONCLUSIVE'
      );
      expect(await factory.databases()).toEqual([]);
    }
  );
  it('preserves a typed bounded work rejection as FAIL when scheduling is already uncertain', async () => {
    const factory = new IDBFactory(),
      env = environment(factory);
    const nativeRemove = factory.deleteDatabase.bind(factory),
      nativePut = IDBObjectStore.prototype.put;
    let lifecycle = 1,
      now = 1000,
      faults = 0;
    let heartbeat: (() => void) | undefined, heartbeatHandle: unknown;
    vi.spyOn(factory, 'deleteDatabase').mockImplementation(name => {
      const request = nativeRemove(name);
      request.addEventListener('success', () => {
        lifecycle++;
      });
      return request;
    });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key
    ) {
      const request = nativePut.call(this, value, key);
      if (lifecycle === 4 && this.name === 'operations' && key === 'operation-synthetic') {
        const record = JSON.parse(new TextDecoder().decode(value));
        if (record.phase === 'unknown' && record.interruptionReason === 'pause') {
          faults++;
          now += 1501;
          expect(heartbeat).toBeTypeOf('function');
          env.timers.clearTimeout(heartbeatHandle);
          heartbeat!(); // Latch uncertainty before the awaited real owner mutation rejects.
          throw new DOMException('PRIVATE bounded write', 'QuotaExceededError');
        }
      }
      return request;
    });
    const receipt = await runProviderBaselineOwnerLifecycleScenario({
      ...env,
      monotonicNow: () => now,
      timers: {
        ...env.timers,
        setTimeout: (callback, milliseconds) => {
          const handle = env.timers.setTimeout(() => {
            if (milliseconds === 10) now += 10;
            callback();
          }, milliseconds);
          if (callback.name === 'pulse') {
            heartbeat = callback;
            heartbeatHandle = handle;
          }
          return handle;
        },
      },
    });
    contentFree(receipt);
    expect(faults).toBe(1);
    expect(receipt.status).toBe('FAIL');
    expect(receipt.rows.find(row => row.id === 'claim-committed-revoked')?.status).toBe('FAIL');
    expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.status).toBe('INCONCLUSIVE');
    expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('PASS');
    expect(await factory.databases()).toEqual([]);
    const source = readFileSync(join(HARNESS_ROOT, 'scenario.ts'), 'utf8');
    expect(source).toMatch(
      /error\s*=>\s*\{\s*env\.timers\.clearTimeout\(timer\);\s*reject\(error\);/u
    );
  });
  it.each(['hidden', 'late', 'regressed'] as const)(
    'reports %s timing as INCONCLUSIVE',
    async kind => {
      const env = environment();
      let clock = 0;
      const receipt = await runProviderBaselineOwnerLifecycleScenario({
        ...env,
        remainedVisible: () => kind !== 'hidden',
        monotonicNow:
          kind === 'late'
            ? () => (clock += 2000)
            : kind === 'regressed'
              ? () => --clock
              : env.monotonicNow,
      });
      contentFree(receipt);
      expect(receipt.status).toBe('INCONCLUSIVE');
      expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.status).toBe(
        'INCONCLUSIVE'
      );
    }
  );
  it.each([0, 1001])('requires a final native probe between 5 and 1000 ms (%s)', async probe => {
    const env = environment();
    let clock = 0;
    const receipt = await runProviderBaselineOwnerLifecycleScenario({
      ...env,
      monotonicNow: () => clock,
      timers: {
        ...env.timers,
        setTimeout: (callback, milliseconds) =>
          env.timers.setTimeout(() => {
            if (milliseconds === 10) clock += probe;
            callback();
          }, milliseconds),
      },
    });
    contentFree(receipt);
    expect(receipt.status).toBe('INCONCLUSIVE');
  });
  it('cannot PASS after a forbidden network call', async () => {
    const receipt = await runProviderBaselineOwnerLifecycleScenario({
      ...environment(),
      networkCalls: () => 1,
    });
    contentFree(receipt);
    expect(receipt.status).toBe('FAIL');
    expect(receipt.rows.find(row => row.id === 'network-denial')?.metrics).toEqual([1]);
  });
  it('requires successful cleanup and does not expose native deletion prose', async () => {
    const factory = new IDBFactory(),
      remove = factory.deleteDatabase.bind(factory);
    const spy = vi.spyOn(factory, 'deleteDatabase').mockImplementation(() => {
      throw new Error('PRIVATE delete');
    });
    try {
      const receipt = await runProviderBaselineOwnerLifecycleScenario(environment(factory));
      contentFree(receipt);
      expect(receipt.status).toBe('FAIL');
      expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('FAIL');
    } finally {
      spy.mockRestore();
      for (const { name } of await factory.databases())
        await new Promise<void>((resolve, reject) => {
          const request = remove(name!);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
    }
  });
  it('installs five counted throwing transports and restores every exact descriptor idempotently', () => {
    const target = { navigator: {}, fetch: () => 2 } as unknown as typeof globalThis;
    const keys = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
    const before = keys.map(key => Object.getOwnPropertyDescriptor(target, key));
    const beaconBefore = Object.getOwnPropertyDescriptor(target.navigator, 'sendBeacon');
    const denial = installNetworkDenial(target);
    for (const key of keys) {
      expect(() => Reflect.get(target, key)()).toThrow('synthetic-network-denied');
      expect(() => new (Reflect.get(target, key))()).toThrow('synthetic-network-denied');
    }
    expect(() => target.navigator.sendBeacon('')).toThrow('synthetic-network-denied');
    expect(denial.calls()).toBe(9);
    denial.restore();
    denial.restore();
    expect(keys.map(key => Object.getOwnPropertyDescriptor(target, key))).toEqual(before);
    expect(Object.getOwnPropertyDescriptor(target.navigator, 'sendBeacon')).toEqual(beaconBefore);
  });
  it('rolls back partially installed denials if one descriptor cannot be replaced', () => {
    const target = { navigator: {}, fetch: () => 2 } as unknown as typeof globalThis;
    Object.defineProperty(target, 'WebSocket', { configurable: false, value: 3 });
    const before = Object.getOwnPropertyDescriptors(target);
    expect(() => installNetworkDenial(target)).toThrow('synthetic-network-denial-unavailable');
    expect(Object.getOwnPropertyDescriptors(target)).toEqual(before);
  });
});

describe('source and runtime authority closure', () => {
  it('pins every production module to real v2 owner and pure journal/3 dependencies', () => {
    expect(inspectSourceClosure()).toEqual(SOURCE_CLOSURE);
    expect(SOURCE_CLOSURE).toHaveLength(39);
    expect(SOURCE_CLOSURE.filter((file: string) => file.startsWith('src/'))).toHaveLength(35);
    expect(SOURCE_CLOSURE.join('\n')).not.toMatch(
      /(?:^|\/)baseline-owner\/|execution-coordinator|capture-handoff|purpose-persistence-v2|messaging|destination|node_modules/u
    );
    const ids = [
      ...SOURCE_CLOSURE,
      'test/browser/provider-baseline-owner-lifecycle/index.html',
    ].map((file: string) => resolve(ROOT, file));
    expect(() => validateRuntimeModules(ids)).not.toThrow();
    expect(() => validateRuntimeModules(ids.slice(1))).toThrow('unexpected-runtime-closure');
    expect(() => validateRuntimeModules([...ids, resolve(ROOT, 'src/lib/messaging.ts')])).toThrow(
      'unexpected-runtime-closure'
    );
    expect(() => validateRuntimeModules([...ids, '\0external'])).toThrow(
      'unexpected-runtime-closure'
    );
  });
  it.each(['import("./other")', 'require("other")', 'import value = require("other")'])(
    'rejects source dynamic/CommonJS import %s',
    code => {
      expect(() => runtimeReferences('input.ts', code)).toThrow('unexpected-source-import');
    }
  );
  it.each([
    'import "dompurify";',
    'import "../../../src/resumability-journal/baseline-owner";',
    'import "../../../src/lib/messaging";',
  ])('rejects widened source closure %s', extra => {
    expect(() =>
      inspectSourceClosure(
        (file: string) =>
          readFileSync(file, 'utf8') +
          (file === resolve(HARNESS_ROOT, 'runner.ts') ? '\n' + extra : '')
      )
    ).toThrow(/unexpected-source-(?:closure|import)/u);
  });
  it('pins the exact direct harness imports and prohibits transforms, provider effects and ambient source effects', () => {
    const imports: Record<string, string[]> = {
      'scenario.ts': [
        '../../../src/archive/catalog/encode',
        '../../../src/archive/catalog/conversation-key',
        '../../../src/archive/catalog/contracts',
        '../../../src/resumability-journal/provider-baseline-owner',
        '../../../src/resumability-journal/provider-baseline-owner/port',
        '../../../src/resumability-journal/purpose-persistence-v3/core/record',
        '../../../src/resumability-journal/purpose/contracts',
      ],
      'capabilities.ts': [],
      'runner.ts': ['./style.css', './capabilities', './scenario'],
    };
    for (const [file, expected] of Object.entries(imports)) {
      const text = readFileSync(join(HARNESS_ROOT, file), 'utf8');
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      expect(
        parsed.statements
          .filter(ts.isImportDeclaration)
          .map(node => (node.moduleSpecifier as ts.StringLiteral).text)
      ).toEqual(expected);
      expect(text).not.toMatch(
        /['"]node:|vitest|fake-indexeddb|PurposePersistenceStore|requestCapture|persistSelectedArtifacts|innerHTML|outerHTML|insertAdjacentHTML|console\.|\bimport\s*\(/u
      );
      if (file === 'scenario.ts')
        expect(text).not.toMatch(/\b(?:window|document|navigator|globalThis)\s*[.[(]/u);
    }
    const builder = readFileSync(
      resolve(ROOT, 'scripts/build-provider-baseline-owner-lifecycle-browser.mjs'),
      'utf8'
    );
    expect(builder).toContain('configFile: false');
    expect(builder).not.toMatch(
      /transform\s*\(|from ['"].*build-(?:provider-)?baseline-owner-browser|@crxjs|DENIED_SOURCES/u
    );
    expect(
      existsSync(resolve(ROOT, 'test/browser/provider-baseline-owner-lifecycle/denied-effects.ts'))
    ).toBe(false);
    expect(relative(ROOT, HARNESS_ROOT).replaceAll('\\', '/')).toBe(
      'test/browser/provider-baseline-owner-lifecycle'
    );
  });
  it('pins one-shot scoped native instrumentation and forbids synthetic terminal events or owner replacements', () => {
    const source = readFileSync(join(HARNESS_ROOT, 'scenario.ts'), 'utf8');
    expect(source).toMatch(/replace\(\s*prototype,\s*'put'/u);
    expect(source).toMatch(/replace\(\s*prototype,\s*'transaction'/u);
    expect(source).toContain('original.call(this, value, key)');
    expect(source).toContain('original.apply(this, args)');
    expect(source).toContain('transaction.db.name === databaseName');
    expect(source).toContain("transaction.mode === 'readwrite'");
    expect(source).toContain("this.name === 'operations'");
    expect(source).toContain("key === 'operation-synthetic'");
    expect(source).toContain("transaction.objectStore('operations').get('operation-synthetic')");
    expect(source).toMatch(/if\s*\(\s*!hits\s*&&/u);
    expect(source).toContain('Object.getOwnPropertyDescriptor(object, key)');
    expect(source).toContain('Object.defineProperty(object, key, descriptor!)');
    expect(source).toContain('transaction.abort()');
    expect(source).not.toMatch(
      /dispatchEvent|new\s+Event\b|\.oncomplete\s*=\s*(?:null|undefined)|(?:owner|port)\.(?:close|applyControl|claimDispatch|consumeDispatch|recordProducerReceipts)\s*=/u
    );
    const scenario = ts.createSourceFile('scenario.ts', source, ts.ScriptTarget.Latest, true);
    const replacements: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'replace'
      ) {
        expect(node.arguments).toHaveLength(3);
        expect(ts.isStringLiteral(node.arguments[1])).toBe(true);
        replacements.push((node.arguments[1] as ts.StringLiteral).text);
      }
      ts.forEachChild(node, visit);
    };
    visit(scenario);
    expect(replacements).toEqual(['put', 'transaction']);
  });
});
