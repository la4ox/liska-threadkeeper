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
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import ts from 'typescript';
import {
  ROOT,
  CSP,
  INVENTORY,
  HARNESS_ROOT,
  DEFAULT_EXTENSION,
  SOURCE_CLOSURE,
  buildProviderBaselineOwnerBrowser,
  inspectHarnessBuild,
  inspectSourceClosure,
  runtimeReferences,
  validateRuntimeModules,
  validateHarnessManifest,
  filesWithin,
  safeOutputDirectory,
  sha256,
  // @ts-expect-error -- Direct opt-in Node .mjs tooling has no declarations.
} from '../../scripts/build-provider-baseline-owner-browser.mjs';
import {
  runProviderBaselineOwnerScenario,
  ROW_IDS,
  type Receipt,
  type ScenarioEnvironment,
} from '../browser/provider-baseline-owner/scenario';
import { installNetworkDenial } from '../browser/provider-baseline-owner/capabilities';

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
    'package.json',
    'package-lock.json',
    'scripts/build-baseline-owner-browser.mjs',
    'test/browser/baseline-owner',
    'test/scripts/baseline-owner-browser-harness.test.ts',
  ].map(file =>
    file === 'dist' || file === 'test/browser/baseline-owner'
      ? snapshot(resolve(ROOT, file))
      : sha256(readFileSync(resolve(ROOT, file)))
  );
const originalProtected = protectedState();
beforeAll(async () => {
  built = await buildProviderBaselineOwnerBrowser(extension);
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
      resolve(ROOT, 'test-results/provider-baseline-owner-browser/extension')
    );
    expect(built.ok).toBe(true);
    expect(built.sourceModules).toBe(37);
    expect(built.runtimeModules).toBe(38);
    expect(built.files.map(file => file.id)).toEqual(INVENTORY);
    for (const file of built.files) {
      const bytes = readFileSync(join(extension, file.id));
      expect(file.bytes).toBe(bytes.length);
      expect(file.sha256).toBe(sha256(bytes));
    }
    expect(await buildProviderBaselineOwnerBrowser(extension)).toEqual(built);
    expect(await buildProviderBaselineOwnerBrowser(join(root, 'repeat'))).toEqual(built);
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
    await expect(buildProviderBaselineOwnerBrowser(unrelated)).rejects.toThrow(
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
    await expect(buildProviderBaselineOwnerBrowser(wrongManifest)).rejects.toThrow(
      'unsafe-harness-manifest'
    );
  });
  it('runs the exact CLI and preserves production and every old harness byte', () => {
    const before = protectedState();
    const result = spawnSync(
      process.execPath,
      [
        resolve(ROOT, 'scripts/build-provider-baseline-owner-browser.mjs'),
        join(root, 'cli-extension'),
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(built);
    const denied = spawnSync(
      process.execPath,
      [resolve(ROOT, 'scripts/build-provider-baseline-owner-browser.mjs'), resolve(ROOT, 'dist')],
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
  expect(receipt.schema).toBe('liska-provider-owner-native-receipt/1');
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
  expect(row('two-handle-cas')).toEqual([1, 2, 1, 1, 1]);
  expect(row('exact-inspection')).toEqual([1, 1, 1, 0]);
  expect(row('reopen-inspection-only')).toEqual([1, 1, 0]);
  expect(row('paused-recovery')).toEqual([3, 1, 1, 0]);
  expect(row('pending-block')).toEqual([4, 1, 0]);
  expect(row('stale-session')).toEqual([2, 0, 1, 0]);
  expect(row('claude-reservation')).toEqual([4, 0, 1, 1, 1]);
  expect(row('cleanup').slice(1)).toEqual([2, 2, 7]);
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

describe('compiled runner with native WebCrypto and fake IDB', () => {
  it('passes all 13 rows, writes only winners and uses one exact DB across two deleted lifecycles', async () => {
    const dom = new JSDOM(readFileSync(join(extension, 'index.html'), 'utf8'), {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    const factory = new IDBFactory();
    const nativeOpen = factory.open.bind(factory);
    const open = vi.spyOn(factory, 'open'),
      remove = vi.spyOn(factory, 'deleteDatabase');
    const denialReady: boolean[] = [];
    open.mockImplementation((name, version) => {
      denialReady.push(
        ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].every(
          key => Reflect.get(dom.window, key)?.name === 'deny'
        ) && dom.window.navigator.sendBeacon.name === 'deny'
      );
      return nativeOpen(name, version);
    });
    const add = vi.spyOn(IDBObjectStore.prototype, 'add'),
      put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const oldFetch = Object.getOwnPropertyDescriptor(dom.window, 'fetch');
    try {
      for (const [key, value] of Object.entries({
        indexedDB: factory,
        crypto: webcrypto,
        Uint8Array,
        ArrayBuffer,
        TextEncoder,
        TextDecoder,
        AbortController,
        AbortSignal,
      }))
        Object.defineProperty(dom.window, key, { configurable: true, value });
      dom.window.eval(readFileSync(join(extension, 'assets/runner.js'), 'utf8'));
      dom.window.document.querySelector<HTMLButtonElement>('#run')!.click();
      const start = performance.now();
      while (
        dom.window.document.querySelector('#overall')!.textContent === 'NOT RUN' &&
        performance.now() - start < 5000
      )
        await new Promise(resolve => setTimeout(resolve, 10));
      const receipt = JSON.parse(
        dom.window.document.querySelector('#receipt')!.textContent!
      ) as Receipt;
      checkReceipt(receipt);
      expect(dom.window.document.querySelector('#overall')!.textContent).toBe('PASS');
      for (const id of ROW_IDS)
        expect(dom.window.document.getElementById(id)?.lastElementChild?.textContent).toBe('PASS');
      const names = [
        ...open.mock.calls.map(call => call[0]),
        ...remove.mock.calls.map(call => call[0]),
      ];
      expect(new Set(names).size).toBe(1);
      expect(names[0]).toMatch(/^liska-baseline-owner-v2-native-acceptance-[a-f0-9]{24}$/u);
      expect(open.mock.calls.every(call => call[1] === 1)).toBe(true);
      expect(denialReady.length).toBeGreaterThan(0);
      expect(denialReady.every(Boolean)).toBe(true);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(add.mock.calls.map(call => call[1])).toEqual([
        'baseline',
        'operation-winner',
        'baseline',
        'operation-claude',
      ]);
      expect(put).toHaveBeenCalledTimes(11);
      expect(await factory.databases()).toEqual([]);
      expect(Object.getOwnPropertyDescriptor(dom.window, 'fetch')).toEqual(oldFetch);
      // No scenario-side post-delete reopen; only this offline test enumerates databases.
      expect(
        open.mock.invocationCallOrder.every(order => order < remove.mock.invocationCallOrder[1])
      ).toBe(true);
    } finally {
      dom.window.close();
    }
  });
  it('latches a transient hidden state even when the compiled Options page becomes visible again', async () => {
    const factory = new IDBFactory(),
      nativeOpen = factory.open.bind(factory);
    const dom = compiledWindow(factory);
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
      expect(dom.window.document.visibilityState).toBe('visible');
      expect(receipt.status).toBe('INCONCLUSIVE');
      expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.metrics[0]).toBe(0);
      expect(await factory.databases()).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
  it('uses the same fixed receipt if denial installation fails before any native open', async () => {
    const factory = new IDBFactory(),
      open = vi.spyOn(factory, 'open');
    const dom = compiledWindow(factory);
    Object.defineProperty(dom.window, 'WebSocket', { configurable: false, value: 3 });
    try {
      const receipt = await runCompiled(dom);
      contentFree(receipt);
      expect(receipt.status).toBe('FAIL');
      expect(receipt.rows.every(row => row.status === 'FAIL')).toBe(true);
      expect(open).not.toHaveBeenCalled();
    } finally {
      dom.window.close();
    }
  });
  it('runs the same browser-safe source without DOM or test-helper dependencies', async () => {
    checkReceipt(await runProviderBaselineOwnerScenario(environment()));
  });
  it('sanitizes native IndexedDB failure and still confirms deletion', async () => {
    const factory = new IDBFactory();
    vi.spyOn(factory, 'open').mockImplementation(() => {
      throw new Error('PRIVATE body');
    });
    const receipt = await runProviderBaselineOwnerScenario(environment(factory));
    contentFree(receipt);
    expect(receipt.status).toBe('FAIL');
    expect(receipt.code).toBe('acceptance-failed');
    expect(receipt.rows.find(row => row.id === 'cleanup')?.status).toBe('PASS');
    expect(await factory.databases()).toEqual([]);
  });
  it.each(['hidden', 'late', 'regressed'] as const)(
    'reports %s timing as INCONCLUSIVE',
    async kind => {
      const env = environment();
      let clock = 0;
      const receipt = await runProviderBaselineOwnerScenario({
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
    const receipt = await runProviderBaselineOwnerScenario({
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
    const receipt = await runProviderBaselineOwnerScenario({
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
      const receipt = await runProviderBaselineOwnerScenario(environment(factory));
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
    expect(SOURCE_CLOSURE).toHaveLength(37);
    expect(SOURCE_CLOSURE.filter((file: string) => file.startsWith('src/'))).toHaveLength(33);
    expect(SOURCE_CLOSURE.join('\n')).not.toMatch(
      /(?:^|\/)baseline-owner\/|execution-coordinator|capture-handoff|purpose-persistence-v2|messaging|destination|node_modules/u
    );
    const ids = [...SOURCE_CLOSURE, 'test/browser/provider-baseline-owner/index.html'].map(
      (file: string) => resolve(ROOT, file)
    );
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
  it('pins the exact direct harness imports and prohibits transforms, execution and ambient source effects', () => {
    const imports: Record<string, string[]> = {
      'scenario.ts': [
        '../../../src/archive/catalog/encode',
        '../../../src/archive/catalog/conversation-key',
        '../../../src/archive/catalog/contracts',
        '../../../src/resumability-journal/provider-baseline-owner',
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
        /['"]node:|vitest|fake-indexeddb|PurposePersistenceStore|createExecutionPort|claimDispatch|consumeDispatch|requestCapture|persistSelectedArtifacts|innerHTML|outerHTML|insertAdjacentHTML|console\.|\bimport\s*\(/u
      );
      if (file === 'scenario.ts')
        expect(text).not.toMatch(/\b(?:window|document|navigator|globalThis)\s*[.[(]/u);
    }
    const builder = readFileSync(
      resolve(ROOT, 'scripts/build-provider-baseline-owner-browser.mjs'),
      'utf8'
    );
    expect(builder).toContain('configFile: false');
    expect(builder).not.toMatch(
      /transform\s*\(|build-baseline-owner-browser|vite\.config|@crxjs|DENIED_SOURCES/u
    );
    expect(
      existsSync(resolve(ROOT, 'test/browser/provider-baseline-owner/denied-effects.ts'))
    ).toBe(false);
    expect(relative(ROOT, HARNESS_ROOT).replaceAll('\\', '/')).toBe(
      'test/browser/provider-baseline-owner'
    );
  });
});
