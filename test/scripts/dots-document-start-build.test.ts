import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { URL as NodeURL } from 'node:url';
import { TextDecoder, TextEncoder } from 'node:util';
import { Script } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- plain .mjs build tooling, no type declarations
import {
  buildDotsDocumentStart,
  compileDotsDocumentStart,
  DOTS_CLASSIC_ENTRY,
} from '../../scripts/build-dots-document-start.mjs';

const root = resolve(import.meta.dirname, '../..');
const script = join(root, 'scripts/build-dots-document-start.mjs');
const sourcePath = join(root, 'src/content/capture/dots-schema-document-start.ts');
const directories: string[] = [];
const LOADER = 'assets/dots-schema-document-start.ts-loader-Abc123.js';
const MODULE = 'assets/dots-schema-document-start.ts-Mod123.js';
const SHARED = 'assets/dots-schema-document-start-Shared123.js';
const CHATGPT = 'assets/chatgpt-document-start.ts-loader-Other123.js';
const MINI_SOURCE = `
export type DotsSchemaDocumentStartResult = { kind: 'ready' };
export function startDotsSchemaDocumentStartProbe(page = window): DotsSchemaDocumentStartResult {
  page.fetch = () => Promise.resolve('observed');
  return { kind: 'ready' };
}
if (typeof window !== 'undefined') startDotsSchemaDocumentStartProbe();
`;

function manifest() {
  return {
    background: { service_worker: 'worker.js', type: 'module' },
    content_scripts: [
      {
        js: [CHATGPT, LOADER],
        matches: ['https://chatgpt.com/*'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      { js: ['assets/idle.js'], matches: ['https://chatgpt.com/*'], run_at: 'document_idle' },
    ],
    web_accessible_resources: [
      { matches: ['https://chatgpt.com/*'], resources: [LOADER, MODULE, SHARED, CHATGPT] },
    ],
  };
}

function fixture(options: { source?: string; sharedFromWorker?: boolean; value?: unknown } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'liska-dots-build-'));
  directories.push(directory);
  const dist = join(directory, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const source = join(directory, 'dots.ts');
  writeFileSync(source, options.source ?? MINI_SOURCE);
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(options.value ?? manifest()));
  const files = {
    [LOADER]: "(async () => { await import('./dots-schema-document-start.ts-Mod123.js'); })();",
    [MODULE]: "export { read } from './dots-schema-document-start-Shared123.js';",
    [SHARED]: 'export function read() { return true; }',
    [CHATGPT]: "import('./chatgpt-document-start.ts-Other.js');",
    'assets/chatgpt-document-start.ts-Other.js': 'console.info("ordinary");',
    'assets/idle.js': 'console.info("idle");',
    'worker.js': options.sharedFromWorker === false ? 'export {};' : `import './${SHARED}';`,
  };
  for (const [file, code] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, file)), { recursive: true });
    writeFileSync(join(dist, file), code);
  }
  return { directory, dist, source };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('synchronous Dots document-start build', () => {
  it('emits one classic IIFE whose startup runs before the earliest following page request', async () => {
    const code = compileDotsDocumentStart(MINI_SOURCE);
    expect(code).not.toMatch(/\b(?:import|export)\s*(?:\(|\{|\*)/);
    const original = vi.fn();
    const page = { fetch: original };
    new Script(code).runInNewContext({ window: page });
    // No await or microtask boundary between injected script completion and page code.
    const firstPageRequest = page.fetch();
    expect(original).not.toHaveBeenCalled();
    await expect(firstPageRequest).resolves.toBe('observed');
    expect(code.trimStart()).toMatch(/^\(function \(\) \{/);
  });

  it('replaces only Dots in the combined ordered entry and prunes only unreferenced Dots assets', () => {
    const f = fixture();
    const result = buildDotsDocumentStart(f.dist, f.source);
    const built = JSON.parse(readFileSync(join(f.dist, 'manifest.json'), 'utf8'));
    expect(built.content_scripts[0]).toEqual({
      ...manifest().content_scripts[0],
      js: [CHATGPT, DOTS_CLASSIC_ENTRY],
    });
    expect(built.content_scripts[1]).toEqual(manifest().content_scripts[1]);
    expect(
      built.content_scripts.filter(
        (entry: { run_at?: string; world?: string }) =>
          entry.run_at === 'document_start' && entry.world === 'MAIN'
      )
    ).toHaveLength(1);
    expect(result.removedArtifacts).toEqual([MODULE, LOADER].sort());
    expect(result.retainedArtifacts).toEqual([SHARED]);
    expect(existsSync(join(f.dist, LOADER))).toBe(false);
    expect(existsSync(join(f.dist, MODULE))).toBe(false);
    expect(existsSync(join(f.dist, SHARED))).toBe(true);
    expect(existsSync(join(f.dist, CHATGPT))).toBe(true);
    expect(built.web_accessible_resources[0].resources).toEqual([SHARED, CHATGPT]);
    expect(() => new Script(readFileSync(join(f.dist, DOTS_CLASSIC_ENTRY), 'utf8'))).not.toThrow();
  });

  it('removes the complete unused Dots import closure and is deterministic on rerun', () => {
    const f = fixture({ sharedFromWorker: false });
    const first = buildDotsDocumentStart(f.dist, f.source);
    expect(first.removedArtifacts).toEqual([LOADER, MODULE, SHARED].sort());
    const code = readFileSync(join(f.dist, DOTS_CLASSIC_ENTRY), 'utf8');
    const builtManifest = readFileSync(join(f.dist, 'manifest.json'), 'utf8');
    const second = buildDotsDocumentStart(f.dist, f.source);
    expect(second.removedArtifacts).toEqual([]);
    expect(readFileSync(join(f.dist, DOTS_CLASSIC_ENTRY), 'utf8')).toBe(code);
    expect(readFileSync(join(f.dist, 'manifest.json'), 'utf8')).toBe(builtManifest);
  });

  it('retains Dots assets conservatively when an emitted dynamic dependency is not inspectable', () => {
    const f = fixture();
    writeFileSync(join(f.dist, 'worker.js'), 'export const lazy = path => import(path);');
    const result = buildDotsDocumentStart(f.dist, f.source);
    expect(result.removedArtifacts).toEqual([]);
    expect(result.retainedArtifacts).toEqual([LOADER, MODULE, SHARED].sort());
  });

  it('understands the exact CRXJS getURL literal without treating it as an unknown dynamic import', () => {
    const f = fixture();
    writeFileSync(
      join(f.dist, 'assets/idle.js'),
      "import(chrome.runtime.getURL('assets/ordinary.js')); "
    );
    const result = buildDotsDocumentStart(f.dist, f.source);
    expect(result.removedArtifacts).toEqual([LOADER, MODULE].sort());
    expect(result.retainedArtifacts).toEqual([SHARED]);
  });

  it.each([
    ["import './elsewhere';", 'module-dependency'],
    ["const pending = import('./elsewhere');", 'module-dependency'],
    ["type Deferred = import('./elsewhere').Value;", 'module-dependency'],
    ["export { other } from './elsewhere';", 'module-dependency'],
    ['export default 1;', 'module-dependency'],
    ['export const extra = 1;', 'unexpected-export'],
    ['namespace Extra { export const value = 1; }', 'unexpected-export'],
    ['const broken = ;', 'invalid-source'],
  ])(
    'fails closed before writing for source dependency/export/parse drift: %s',
    (addition, code) => {
      const f = fixture({ source: `${addition}\n${MINI_SOURCE}` });
      const before = readFileSync(join(f.dist, 'manifest.json'), 'utf8');
      expect(() => buildDotsDocumentStart(f.dist, f.source)).toThrow(code);
      expect(readFileSync(join(f.dist, 'manifest.json'), 'utf8')).toBe(before);
      expect(existsSync(join(f.dist, DOTS_CLASSIC_ENTRY))).toBe(false);
    }
  );

  it('requires the exact known exported API and synchronous final startup', () => {
    expect(() => compileDotsDocumentStart(MINI_SOURCE.replace('export type', 'type'))).toThrow(
      'missing-export'
    );
    expect(() =>
      compileDotsDocumentStart(
        MINI_SOURCE.replace('export function start', 'export async function start')
      )
    ).toThrow('unexpected-export');
    expect(() =>
      compileDotsDocumentStart(
        MINI_SOURCE.replace(
          "if (typeof window !== 'undefined') startDotsSchemaDocumentStartProbe();",
          ''
        )
      )
    ).toThrow('missing-synchronous-startup');
    expect(() =>
      compileDotsDocumentStart(
        `${MINI_SOURCE}\nPromise.resolve().then(startDotsSchemaDocumentStartProbe);`
      )
    ).toThrow('missing-synchronous-startup');
  });

  it.each([
    'missing',
    'duplicate',
    'split',
    'reordered',
    'extra-main-entry',
    'wrong-chatgpt-loader',
    'wrong-dots-loader',
    'wrong-world',
    'extra-script',
    'wrong-host',
    'missing-file',
    'missing-chatgpt-file',
  ])('rejects malformed built entry: %s', scenario => {
    const value = manifest();
    if (scenario === 'missing') value.content_scripts.splice(0, 1);
    if (scenario === 'duplicate') value.content_scripts.push({ ...value.content_scripts[0] });
    if (scenario === 'split') {
      value.content_scripts[0].js = [CHATGPT];
      value.content_scripts.push({ ...value.content_scripts[0], js: [LOADER] });
    }
    if (scenario === 'reordered') value.content_scripts[0].js.reverse();
    if (scenario === 'extra-main-entry')
      value.content_scripts.push({ ...value.content_scripts[0], js: ['assets/extra.js'] });
    if (scenario === 'wrong-chatgpt-loader')
      value.content_scripts[0].js[0] = 'assets/chatgpt-document-start.ts-Other123.js';
    if (scenario === 'wrong-dots-loader') value.content_scripts[0].js[1] = SHARED;
    if (scenario === 'wrong-world') value.content_scripts[0].world = 'ISOLATED';
    if (scenario === 'extra-script') value.content_scripts[0].js.push('assets/idle.js');
    if (scenario === 'wrong-host') value.content_scripts[0].matches = ['https://example.test/*'];
    const f = fixture({ value });
    if (scenario === 'missing-file') rmSync(join(f.dist, LOADER));
    if (scenario === 'missing-chatgpt-file') rmSync(join(f.dist, CHATGPT));
    expect(() => buildDotsDocumentStart(f.dist, f.source)).toThrow();
    expect(existsSync(join(f.dist, DOTS_CLASSIC_ENTRY))).toBe(false);
  });

  it('runs the actual CLI and reports only compact build receipts', () => {
    const f = fixture();
    const result = spawnSync(process.execPath, [script, f.dist, f.source], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, entry: DOTS_CLASSIC_ENTRY });
    writeFileSync(f.source, `export const privateSource = 'do-not-print';`);
    const failed = spawnSync(process.execPath, [script, f.dist, f.source], { encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stderr)).toEqual({ ok: false, code: 'unexpected-export' });
    expect(failed.stderr).not.toContain('do-not-print');
  });

  it('wires the synchronous rewrite between Vite and the worker closure check', () => {
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(scripts.build).toMatch(
      /vite build\s*&&\s*node scripts\/build-dots-document-start\.mjs\s*&&\s*node scripts\/build-claude-scroll-prime-main\.mjs\s*&&\s*node scripts\/check-service-worker-runtime\.mjs$/
    );
  });
});

describe('actual emitted observer startup ordering', () => {
  it('wraps fetch synchronously and captures the earliest inline page-owned pair', async () => {
    const nonce = '01234567-89ab-4cde-8f01-23456789abcd';
    const href = `https://chatgpt.com/dots/home#liska-dots-schema=${nonce}`;
    const room = '/backend-api/messaging/rooms/room_one';
    const messages = `${room}/messages?limit=100`;
    const responses: ProbeResponse[] = [];
    const timers = new Map<number, () => void>();
    class ProbeRequest {
      get url() {
        return '';
      }
      get method() {
        return 'GET';
      }
    }
    class ProbeNode {
      get baseURI() {
        return href;
      }
    }
    class ProbeResponse {
      readonly bytes = new TextEncoder().encode('{"messages":[]}');
      clones = 0;
      constructor(readonly target: string) {}
      get status() {
        return 200;
      }
      get url() {
        return this.target;
      }
      get redirected() {
        return false;
      }
      get headers() {
        return new Headers({ 'content-type': 'application/json' });
      }
      get body() {
        const bytes = this.bytes;
        return new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      }
      clone() {
        this.clones += 1;
        return new ProbeResponse(this.target);
      }
    }
    const original = vi.fn(async (input: string) => {
      const response = new ProbeResponse(new NodeURL(input, 'https://chatgpt.com').href);
      responses.push(response);
      return response;
    });
    const page = {
      location: { href },
      document: new ProbeNode(),
      fetch: original,
      Object,
      Reflect,
      Array,
      JSON,
      URL: NodeURL,
      TextDecoder,
      Uint8Array,
      RegExp,
      Symbol,
      Promise,
      Request: ProbeRequest,
      Response: ProbeResponse,
      Headers,
      ReadableStream,
      ReadableStreamDefaultReader,
      Node: ProbeNode,
      setTimeout(callback: () => void, delay: number) {
        timers.set(delay, callback);
        return delay;
      },
      clearTimeout(timer: number) {
        timers.delete(timer);
      },
    };
    const f = fixture({ source: readFileSync(sourcePath, 'utf8') });
    buildDotsDocumentStart(f.dist, f.source);
    const emitted = readFileSync(join(f.dist, DOTS_CLASSIC_ENTRY), 'utf8');
    new Script(emitted).runInNewContext({ window: page, URL: NodeURL });
    expect(page.fetch).not.toBe(original);
    // This is the first page code, with no await after the classic script executes.
    const first = page.fetch(room);
    const second = page.fetch(messages);
    await Promise.all([first, second]);
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
    expect(responses.map(response => response.clones)).toEqual([1, 1]);
    timers.get(15_000)?.();
    const state = (page as unknown as Record<string, unknown>)[`__liskaDotsSchemaProbe_${nonce}`];
    expect(state).toMatchObject({
      kind: 'completed',
      projection: { schema: 'liska-dots-schema-probe/1' },
    });
    expect(page.fetch).toBe(original);
    expect(timers.size).toBe(0);
  });
});
