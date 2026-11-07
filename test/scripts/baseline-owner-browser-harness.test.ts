// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  cpSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, posix, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import ts from 'typescript';
import {
  ROOT,
  CSP,
  INVENTORY,
  DENIED_SOURCES,
  HARNESS_ROOT,
  buildBaselineOwnerBrowser,
  inspectHarnessBuild,
  validateHarnessManifest,
  transformDeniedSource,
  validateDeniedReplacements,
  filesWithin,
  safeOutputDirectory,
  sha256,
  // @ts-expect-error -- Direct opt-in Node .mjs tooling has no declarations.
} from '../../scripts/build-baseline-owner-browser.mjs';
import {
  runBaselineOwnerScenario,
  ROW_IDS,
  type Receipt,
  type ScenarioEnvironment,
} from '../browser/baseline-owner/scenario';
import {
  installNetworkDenial,
  effectCounts,
  syntheticStagedCapabilities,
} from '../browser/baseline-owner/capabilities';
import { denyAmbientEffect, deniedAmbientCalls } from '../browser/baseline-owner/denied-effects';

const root = mkdtempSync(join(tmpdir(), 'baseline-owner-browser-test-'));
const extension = join(root, 'extension');
type BuildReceipt = {
  ok: boolean;
  deniedAmbientEffects: number;
  files: { id: string; bytes: number; sha256: string }[];
};
let built: BuildReceipt;
const snapshot = (directory: string) =>
  filesWithin(directory).map(
    (file: string) => `${file}:${sha256(readFileSync(resolve(directory, file)))}`
  );
const manifest = () => JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
const filesystemAbsolute = (reference: string) =>
  posix.isAbsolute(reference) || win32.isAbsolute(reference);
const cloneBuild = (suffix: string) => {
  const target = join(root, suffix);
  cpSync(extension, target, { recursive: true });
  return target;
};

beforeAll(async () => {
  built = await buildBaselineOwnerBrowser(extension);
}, 30000);
afterAll(() => {
  expect(root.startsWith(join(tmpdir(), 'baseline-owner-browser-test-'))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

describe('opt-in isolated baseline owner MV3 build', () => {
  it('has an exact deterministic inventory, SHA receipt and repeatable build', async () => {
    expect(built.ok).toBe(true);
    expect(built.deniedAmbientEffects).toBe(4);
    expect(built.files.map(file => file.id)).toEqual(INVENTORY);
    for (const file of built.files) {
      const bytes = readFileSync(join(extension, file.id));
      expect(file.bytes).toBe(bytes.length);
      expect(file.sha256).toBe(sha256(bytes));
    }
    expect(await buildBaselineOwnerBrowser(extension)).toEqual(built);
    expect(await buildBaselineOwnerBrowser(join(root, 'repeat'))).toEqual(built);
    expect(snapshot(join(root, 'repeat'))).toEqual(snapshot(extension));
    expect(JSON.stringify(built)).not.toContain(root);
  });
  it('rejects every manifest authority/CSP mutation and extra nested field', () => {
    const original = manifest();
    expect(original.content_security_policy).toEqual({ extension_pages: CSP });
    for (const mutation of [
      { permissions: ['storage'] },
      { host_permissions: ['<all_urls>'] },
      { background: { service_worker: 'worker.js' } },
      { content_scripts: [] },
      { web_accessible_resources: [] },
      { externally_connectable: {} },
      { options_ui: { ...original.options_ui, browser_style: true } },
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
    expect(() => validateHarnessManifest(original)).not.toThrow();
  });
  it('rejects unexpected chunks/maps, ambient APIs, remote imports and inline HTML', () => {
    for (const [suffix, file, content, code] of [
      ['map', 'assets/runner.js.map', '{}', 'unexpected-build-inventory'],
      ['chunk', 'assets/unexpected.js', '', 'unexpected-build-inventory'],
      [
        'chrome',
        'assets/runner.js',
        'globalThis.chrome.runtime.sendMessage({});',
        'unexpected-runtime-authority',
      ],
      ['storage', 'assets/runner.js', 'localStorage.clear();', 'unexpected-runtime-authority'],
      ['eval', 'assets/runner.js', 'new Function("return 1")();', 'unexpected-runtime-authority'],
      [
        'remote',
        'assets/runner.js',
        'import "https://example.invalid/a.js";',
        'unexpected-runtime-authority',
      ],
      ['html', 'index.html', '<script>void 0</script>', 'unexpected-html-authority'],
      [
        'extra-script',
        'index.html',
        '<script src="./assets/runner.js"></script>',
        'unexpected-html-authority',
      ],
      ['inline-style', 'index.html', '<p style="color:red">test</p>', 'unexpected-html-authority'],
    ]) {
      const target = cloneBuild(suffix);
      if (file === 'index.html')
        writeFileSync(join(target, file), readFileSync(join(target, file), 'utf8') + content);
      else writeFileSync(join(target, file), content);
      expect(() => inspectHarnessBuild(target), suffix).toThrow(code);
    }
  });
  it('protects production paths, unrelated output, symlink ancestors and children', async () => {
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
    await expect(buildBaselineOwnerBrowser(unrelated)).rejects.toThrow(
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
    await expect(buildBaselineOwnerBrowser(wrongManifest)).rejects.toThrow(
      'unsafe-harness-manifest'
    );
  });
  it('runs the exact CLI without changing production dist/manifest/Vite/package/lock', () => {
    const watched = [
      'dist',
      'src/manifest.json',
      'vite.config.ts',
      'package.json',
      'package-lock.json',
    ];
    const state = () =>
      watched.map(file =>
        file === 'dist' ? snapshot(resolve(ROOT, file)) : sha256(readFileSync(resolve(ROOT, file)))
      );
    const before = state();
    const result = spawnSync(
      process.execPath,
      [resolve(ROOT, 'scripts/build-baseline-owner-browser.mjs'), join(root, 'cli-extension')],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(built);
    expect(state()).toEqual(before);
  });
  it('pins exact ambient module IDs/context and fails on unknown or drifted replacements', () => {
    expect(Object.keys(DENIED_SOURCES)).toEqual([
      'src/lib/messaging.ts',
      'src/lib/export-operation-scope.ts',
      'src/content/capture/chatgpt-current-branch.ts',
      'src/content/staged-binary-persistence.ts',
    ]);
    for (const source of Object.keys(DENIED_SOURCES)) {
      const original = readFileSync(resolve(ROOT, source), 'utf8');
      expect(transformDeniedSource(source, original)).toContain('denyAmbientEffect');
      expect(() => transformDeniedSource(source, original + '\n')).toThrow('denied-source-drift');
    }
    expect(() => transformDeniedSource('src/unknown.ts', '')).toThrow('denied-source-drift');
    expect(() => validateDeniedReplacements(new Set(Object.keys(DENIED_SOURCES)))).not.toThrow();
    expect(() => validateDeniedReplacements(new Set(Object.keys(DENIED_SOURCES).slice(1)))).toThrow(
      'unexpected-denied-replacements'
    );
    expect(() =>
      validateDeniedReplacements(new Set([...Object.keys(DENIED_SOURCES), 'src/extra.ts']))
    ).toThrow('unexpected-denied-replacements');
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
    ambientCalls: () => 0,
  };
}
function checkReceipt(receipt: Receipt) {
  expect(receipt.status, JSON.stringify(receipt)).toBe('PASS');
  expect(receipt.code).toBe('none');
  expect(receipt.rows.map(row => row.id)).toEqual(ROW_IDS);
  expect(receipt.rows.every(row => row.status === 'PASS')).toBe(true);
  expect(receipt.rows.find(row => row.id === 'staged-execution')?.metrics).toEqual([
    1, 1, 3, 1, 0, 34, 0, 1, 5,
  ]);
  expect(receipt.rows.find(row => row.id === 'cleanup')?.metrics).toEqual([4, 2, 3]);
  expect(receipt.rows.find(row => row.id === 'network-denial')?.metrics).toEqual([0]);
  expect(receipt.rows.find(row => row.id === 'denied-ambient-effects')?.metrics).toEqual([0]);
  for (const id of ['reopen-recovery', 'inflight-recovery'])
    expect(receipt.rows.find(row => row.id === id)?.metrics.slice(-3)).toEqual([0, 0, 1]);
  const serialized = JSON.stringify(receipt);
  expect(serialized).not.toMatch(
    /00000000|native-acceptance-|operation-|capture-chatgpt-|\.json|\.md|[a-f0-9]{64}|https?:|conversationId|recordSha256|databaseName|PRIVATE/i
  );
  for (const row of receipt.rows)
    for (const number of row.metrics)
      expect(Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000).toBe(true);
}

describe('real compiled scenario under JSDOM/native WebCrypto with fake IDB', () => {
  it('passes all rows, verifies actual selected bytes, recovers both cases and deletes only one exact DB', async () => {
    const dom = new JSDOM(readFileSync(join(extension, 'index.html'), 'utf8'), {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    const remove = vi.spyOn(factory, 'deleteDatabase');
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
        Blob,
        File,
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
      const text = dom.window.document.querySelector('#receipt')!.textContent!;
      const receipt = JSON.parse(text) as Receipt;
      checkReceipt(receipt);
      expect(dom.window.document.querySelector('#overall')!.textContent).toBe('PASS');
      for (const id of ROW_IDS)
        expect(dom.window.document.getElementById(id)?.lastElementChild?.textContent).toBe('PASS');
      const names = [
        ...open.mock.calls.map(call => call[0]),
        ...remove.mock.calls.map(call => call[0]),
      ];
      expect(new Set(names).size).toBe(1);
      expect(names[0]).toMatch(/^liska-baseline-owner-v1-native-acceptance-[a-f0-9]{24}$/);
      expect(open.mock.calls.every(call => call[1] === 1)).toBe(true);
      expect(open).toHaveBeenCalledTimes(4);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(await factory.databases()).toEqual([]);
    } finally {
      dom.window.close();
    }
  });
  it('runs browser-safe source without DOM, Node test helpers or a PurposePersistenceStore', async () => {
    vi.stubGlobal('crypto', webcrypto);
    try {
      checkReceipt(await runBaselineOwnerScenario(environment()));
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('fails closed on native DB errors without exposing exception prose or unsafe names', async () => {
    const factory = new IDBFactory();
    vi.spyOn(factory, 'open').mockImplementation(() => {
      throw new Error('PRIVATE raw conversation body');
    });
    const receipt = await runBaselineOwnerScenario(environment(factory));
    expect(receipt.status).toBe('FAIL');
    expect(receipt.code).toBe('acceptance-failed');
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE');
    expect(await factory.databases()).toEqual([]);
  });
  it.each(['hidden', 'late', 'regressed'] as const)(
    'reports %s scheduling as INCONCLUSIVE, never PASS',
    async kind => {
      const env = environment();
      let clock = 0;
      const receipt = await runBaselineOwnerScenario({
        ...env,
        remainedVisible: () => kind !== 'hidden',
        monotonicNow:
          kind === 'late'
            ? () => (clock += 2000)
            : kind === 'regressed'
              ? () => --clock
              : env.monotonicNow,
      });
      expect(receipt.status).toBe('INCONCLUSIVE');
      expect(receipt.rows.find(row => row.id === 'visibility-deadline')?.status).toBe(
        'INCONCLUSIVE'
      );
    }
  );
  it.each(['network', 'ambient'] as const)('cannot PASS after a forbidden %s call', async kind => {
    const env = environment();
    const receipt = await runBaselineOwnerScenario({
      ...env,
      networkCalls: () => Number(kind === 'network'),
      ambientCalls: () => Number(kind === 'ambient'),
    });
    expect(receipt.status).toBe('FAIL');
    expect(
      receipt.rows.find(
        row => row.id === (kind === 'network' ? 'network-denial' : 'denied-ambient-effects')
      )?.metrics
    ).toEqual([1]);
  });
  it('installs throwing sentinels for all five network transports and restores exact descriptors', () => {
    const target = { navigator: {}, fetch: () => 2 } as unknown as typeof globalThis;
    const before = Object.getOwnPropertyDescriptor(target, 'fetch');
    const denial = installNetworkDenial(target);
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
      const value = Reflect.get(target, name);
      expect(() => value()).toThrow('synthetic-network-denied');
    }
    expect(() => target.navigator.sendBeacon('')).toThrow('synthetic-network-denied');
    expect(denial.calls()).toBe(5);
    denial.restore();
    expect(Object.getOwnPropertyDescriptor(target, 'fetch')).toEqual(before);
    expect(target.navigator).not.toHaveProperty('sendBeacon');
    const count = deniedAmbientCalls();
    expect(() => denyAmbientEffect()).toThrow('synthetic-ambient-effect-denied');
    expect(deniedAmbientCalls()).toBe(count + 1);
  });
  it('independently rejects selected byte-length/SHA mutations before issuing synthetic sink observations', async () => {
    const hash = async (bytes: Uint8Array) => sha256(bytes);
    for (const mutation of ['length', 'sha256'] as const) {
      const counts = effectCounts();
      const capabilities = syntheticStagedCapabilities(hash, counts, () => undefined);
      const binding = Object.freeze({
        operationId: 'operation-synthetic',
        captureId: 'capture-chatgpt-synthetic',
      });
      const captured = await capabilities.requestCapture(
        '00000000-0000-4000-8000-000000000001',
        binding
      );
      const lease = captured.lease!;
      const artifact = {
        ...lease.artifact,
        ...(mutation === 'length'
          ? { byteLength: lease.artifact.byteLength + 1 }
          : { sha256: '0'.repeat(64) }),
      };
      await expect(
        capabilities.persistSelectedArtifacts({
          binding,
          conversationKey: 'synthetic',
          noteFileName: 'synthetic.md',
          destinations: ['file', 'obsidian'],
          artifacts: [artifact],
          leases: [lease],
        })
      ).rejects.toThrow('synthetic-check-failed');
      expect(counts.verifiedArtifacts).toBe(0);
      expect(counts.stageTransfer).toBe(1);
      expect(counts.stageRead).toBe(1);
    }
  });
});

describe('test-only import/authority boundaries', () => {
  it('pins exact direct production imports and keeps scenario free of DOM/test/ambient effects', () => {
    const imports: Record<string, string[]> = {
      'scenario.ts': [
        '../../../src/archive/catalog/encode',
        '../../../src/archive/catalog/conversation-key',
        '../../../src/archive/catalog/contracts',
        '../../../src/resumability-journal/baseline-owner',
        '../../../src/resumability-journal/execution-coordinator',
        '../../../src/resumability-journal/purpose-persistence-v2/core/record',
        '../../../src/resumability-journal/purpose/contracts',
        './capabilities',
      ],
      'capabilities.ts': [
        '../../../src/resumability-journal/execution-coordinator/stages',
        '../../../src/lib/chatgpt-capture-contract',
        '../../../src/lib/types',
      ],
      'runner.ts': ['./style.css', './capabilities', './denied-effects', './scenario'],
      'denied-effects.ts': [],
    };
    for (const [file, expected] of Object.entries(imports)) {
      const text = readFileSync(join(HARNESS_ROOT, file), 'utf8');
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const references = parsed.statements
        .filter(ts.isImportDeclaration)
        .map(node => (node.moduleSpecifier as ts.StringLiteral).text);
      expect(references).toEqual(expected);
      expect(text).not.toMatch(
        /['"]node:|vitest|fake-indexeddb|PurposePersistenceStore|createPurposePersistenceStore|\b(?:chrome|localStorage|sessionStorage|clipboard|eval)\s*[.(]/
      );
      expect(text).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|console\.|\bimport\s*\(/);
      if (file === 'scenario.ts')
        expect(text).not.toMatch(/\b(?:window|document|navigator|globalThis)\s*[.[(]/);
    }
  });
  it('pins the exact transformed production import closure and excludes extension entrypoints', () => {
    expect(filesystemAbsolute('/workspace/liska/test/sentinel.ts')).toBe(true);
    expect(filesystemAbsolute('C:\\workspace\\liska\\test\\sentinel.ts')).toBe(true);
    expect(filesystemAbsolute('dompurify')).toBe(false);
    const pending = [join(HARNESS_ROOT, 'runner.ts')];
    const seen = new Set<string>();
    const external = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file) || file.endsWith('.css')) continue;
      seen.add(file);
      let text = readFileSync(file, 'utf8');
      const local = relative(ROOT, file).replaceAll('\\', '/');
      if (Object.hasOwn(DENIED_SOURCES, local)) text = transformDeniedSource(local, text);
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      for (const node of parsed.statements) {
        if (
          (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
          !node.moduleSpecifier ||
          !ts.isStringLiteral(node.moduleSpecifier)
        )
          continue;
        if (
          ts.isImportDeclaration(node) &&
          (node.importClause?.isTypeOnly ||
            (node.importClause?.namedBindings &&
              ts.isNamedImports(node.importClause.namedBindings) &&
              node.importClause.namedBindings.elements.every(element => element.isTypeOnly)))
        )
          continue;
        if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
        const reference = node.moduleSpecifier.text;
        const absolute = filesystemAbsolute(reference);
        if (!reference.startsWith('.') && !absolute) {
          external.add(reference);
          continue;
        }
        const base = absolute ? reference : resolve(dirname(file), reference);
        const target = [base + '.ts', join(base, 'index.ts'), base].find(candidate =>
          existsSync(candidate)
        );
        expect(target, reference).toBeDefined();
        if (target) pending.push(target);
      }
    }
    const paths = [...seen].map(file => relative(ROOT, file).replaceAll('\\', '/')).sort();
    expect(
      paths.some(file =>
        /src\/(?:background|popup|options|platforms)\/|src\/content\/(?:index|bootstrap)\.ts/.test(
          file
        )
      )
    ).toBe(false);
    expect([...external].sort()).toEqual(['dompurify', 'mdast-util-from-markdown', 'turndown']);
    expect({ count: paths.length, sha256: sha256(paths.join('\n')) }).toEqual({
      count: 158,
      sha256: 'f96bfbd9921bd34a2bf530ddc4d2c05011e53f4bf95e0ad4976bc08c9fca2345',
    });
  });
});
