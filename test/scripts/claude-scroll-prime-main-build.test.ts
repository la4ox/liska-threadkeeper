import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Script } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs build tooling, no type declarations
import {
  buildClaudeScrollPrimeMain,
  CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY,
  compileClaudeScrollPrimeMain,
} from '../../scripts/build-claude-scroll-prime-main.mjs';

const root = resolve(import.meta.dirname, '../..');
const script = join(root, 'scripts/build-claude-scroll-prime-main.mjs');
const sourcePath = join(root, 'src/content/capture/claude-scroll-prime-main.ts');
const directories: string[] = [];
const LOADER = 'assets/claude-scroll-prime-main.ts-loader-Abc123.js';
const MODULE = 'assets/claude-scroll-prime-main.ts-Mod123.js';
const SHARED = 'assets/claude-scroll-prime-contract-Shared123.js';
const MINI_SOURCE = `
const eventName = 'liska:claude-scroll-prime:v1';
if (window.top === window && window.location.origin === 'https://claude.ai') {
  document.addEventListener(eventName, () => {}, true);
}
`;

function manifest() {
  return {
    permissions: ['storage'],
    background: { service_worker: 'worker.js', type: 'module' },
    content_scripts: [
      {
        js: ['assets/chatgpt-document-start.ts-loader-Other123.js'],
        matches: ['https://chatgpt.com/*'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        js: [LOADER],
        matches: ['https://claude.ai/*'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      { js: ['assets/idle.js'], matches: ['https://claude.ai/*'], run_at: 'document_idle' },
    ],
    web_accessible_resources: [
      { matches: ['https://claude.ai/*'], resources: [LOADER, MODULE, SHARED] },
    ],
  };
}

function fixture(value: unknown = manifest()) {
  const directory = mkdtempSync(join(tmpdir(), 'liska-claude-prime-build-'));
  directories.push(directory);
  const dist = join(directory, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const source = join(directory, 'prime.ts');
  writeFileSync(source, MINI_SOURCE);
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(value));
  const files = {
    [LOADER]: "(async()=>import('./claude-scroll-prime-main.ts-Mod123.js'))();",
    [MODULE]: "import './claude-scroll-prime-contract-Shared123.js';",
    [SHARED]: 'export const max = 130;',
    'assets/chatgpt-document-start.ts-loader-Other123.js': 'console.info("ordinary");',
    'assets/idle.js': 'console.info("idle");',
    'worker.js': 'export {};',
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

describe('Claude MAIN scroll-prime classic build', () => {
  it('bundles the shared contract into one self-contained classic script', async () => {
    const code = await compileClaudeScrollPrimeMain(sourcePath);
    expect(code).toContain('liska:claude-scroll-prime:v1');
    expect(code).toContain('[data-autoscroll-container]');
    expect(code).not.toMatch(/\b(?:import|export)\s*(?:\(|\{|\*)/);
    expect(code).not.toMatch(/\bchrome\s*\./);
    expect(code).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/);
    expect(() => new Script(code)).not.toThrow();
  });

  it('replaces only the exact Claude entry and prunes its generated loader/module', async () => {
    const f = fixture();
    const result = await buildClaudeScrollPrimeMain(f.dist, f.source);
    const built = JSON.parse(readFileSync(join(f.dist, 'manifest.json'), 'utf8'));
    expect(built.content_scripts[1]).toEqual({
      ...manifest().content_scripts[1],
      js: [CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY],
    });
    expect(built.content_scripts[0]).toEqual(manifest().content_scripts[0]);
    expect(built.content_scripts[2]).toEqual(manifest().content_scripts[2]);
    expect(result.removedArtifacts).toEqual([LOADER, MODULE].sort());
    expect(existsSync(join(f.dist, LOADER))).toBe(false);
    expect(existsSync(join(f.dist, MODULE))).toBe(false);
    expect(existsSync(join(f.dist, SHARED))).toBe(true);
    expect(built.web_accessible_resources[0].resources).toEqual([SHARED]);
    expect(
      () => new Script(readFileSync(join(f.dist, CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY), 'utf8'))
    ).not.toThrow();
  });

  it('is deterministic on rerun', async () => {
    const f = fixture();
    await buildClaudeScrollPrimeMain(f.dist, f.source);
    const code = readFileSync(join(f.dist, CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY), 'utf8');
    const builtManifest = readFileSync(join(f.dist, 'manifest.json'), 'utf8');
    const second = await buildClaudeScrollPrimeMain(f.dist, f.source);
    expect(second.removedArtifacts).toEqual([]);
    expect(readFileSync(join(f.dist, CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY), 'utf8')).toBe(code);
    expect(readFileSync(join(f.dist, 'manifest.json'), 'utf8')).toBe(builtManifest);
  });

  it.each(['missing', 'duplicate', 'wrong-host', 'wrong-world', 'extra-script', 'missing-file'])(
    'fails closed for malformed Claude entry: %s',
    async scenario => {
      const value = manifest();
      if (scenario === 'missing') value.content_scripts.splice(1, 1);
      if (scenario === 'duplicate') value.content_scripts.push({ ...value.content_scripts[1] });
      if (scenario === 'wrong-host') value.content_scripts[1].matches = ['https://example.test/*'];
      if (scenario === 'wrong-world') value.content_scripts[1].world = 'ISOLATED';
      if (scenario === 'extra-script') value.content_scripts[1].js.push('assets/idle.js');
      const f = fixture(value);
      if (scenario === 'missing-file') rmSync(join(f.dist, LOADER));
      const before = readFileSync(join(f.dist, 'manifest.json'), 'utf8');
      await expect(buildClaudeScrollPrimeMain(f.dist, f.source)).rejects.toThrow();
      expect(readFileSync(join(f.dist, 'manifest.json'), 'utf8')).toBe(before);
      expect(existsSync(join(f.dist, CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY))).toBe(false);
    }
  );

  it('runs the actual CLI with compact receipts', () => {
    const f = fixture();
    const result = spawnSync(process.execPath, [script, f.dist, f.source], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      entry: CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY,
    });
  });

  it('wires the classic rewrite between Dots and worker closure checks', () => {
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(scripts.build).toMatch(
      /vite build\s*&&\s*node scripts\/build-dots-document-start\.mjs\s*&&\s*node scripts\/build-claude-scroll-prime-main\.mjs\s*&&\s*node scripts\/check-service-worker-runtime\.mjs$/
    );
  });
});
