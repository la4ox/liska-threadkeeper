// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ResolvedConfig, ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import viteConfig from '../../vite.config';

const root = resolve(import.meta.dirname, '../..');
const localesDir = join(root, 'src/_locales');
const tempDirs: string[] = [];

interface LocalePlugin {
  name: string;
  configResolved(config: ResolvedConfig): void;
  configureServer(server: ViteDevServer): Promise<void>;
  closeBundle(): Promise<void>;
}

async function makeOutput() {
  const output = await mkdtemp(join(tmpdir(), 'liska-vite-locales-'));
  tempDirs.push(output);
  return output;
}

function localePlugin(command: 'build' | 'serve', output: string) {
  const config = viteConfig({ command, mode: 'test', isSsrBuild: false, isPreview: false });
  // This plugin is deliberately outside CRXJS's private serve-only Rollup pass.
  const plugin = config.plugins[1] as LocalePlugin;
  expect(plugin.name).toBe('liska-copy-locales');
  plugin.configResolved({ root, build: { outDir: output } } as ResolvedConfig);
  return plugin;
}

async function expectExactLocales(output: string) {
  const sourceEntries = (await readdir(localesDir, { recursive: true })).sort();
  expect((await readdir(join(output, '_locales'), { recursive: true })).sort()).toEqual(
    sourceEntries
  );
  for (const locale of ['en', 'ja']) {
    expect(await readFile(join(output, '_locales', locale, 'messages.json'))).toEqual(
      await readFile(join(localesDir, locale, 'messages.json'))
    );
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('Vite extension locale output', () => {
  it('populates serve output before listening and serializes exact watcher refreshes', async () => {
    const output = await makeOutput();
    const plugin = localePlugin('serve', output);
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const logger = { error: vi.fn() };
    await mkdir(join(output, '_locales/stale'), { recursive: true });
    await writeFile(join(output, '_locales/stale/messages.json'), '{}');

    await plugin.configureServer({ watcher, config: { logger } } as unknown as ViteDevServer);
    await expectExactLocales(output);
    expect(watcher.add).toHaveBeenCalledExactlyOnceWith(localesDir);

    await writeFile(join(output, '_locales/en/messages.json'), '{}');
    await writeFile(join(output, '_locales/stale.json'), '{}');
    watcher.emit('all', 'change', join(localesDir, 'en/messages.json'));
    watcher.emit('all', 'unlink', join(localesDir, 'removed/messages.json'));
    // Closing drains the copy queue and removes the watcher listener.
    await plugin.closeBundle();
    await expectExactLocales(output);
    expect(watcher.listenerCount('all')).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('copies production locales only after bundle completion using the resolved output', async () => {
    const output = await makeOutput();
    const plugin = localePlugin('build', output);
    expect(await readdir(output)).toEqual([]);
    await plugin.closeBundle();
    await expectExactLocales(output);
  });
});
