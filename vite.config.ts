import { defineConfig, normalizePath } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { cp, rm } from 'node:fs/promises';
import { resolve } from 'path';
import manifest from './src/manifest.json' with { type: 'json' };

const outDir = 'dist';
const localesDir = resolve(import.meta.dirname, 'src/_locales');

export default defineConfig(({ command }) => {
  let localesOutDir: string;
  let pendingCopy = Promise.resolve();
  let stopWatching: (() => void) | undefined;

  function copyLocales() {
    // Serialize watcher events; a later edit can recover after a reported error.
    pendingCopy = pendingCopy
      .catch(() => {})
      .then(async () => {
        await rm(localesOutDir, { recursive: true, force: true });
        await cp(localesDir, localesOutDir, { recursive: true, force: true });
      });
    return pendingCopy;
  }

  return {
    plugins: [
      crx({ manifest }),
      {
        name: 'liska-copy-locales',
        configResolved(config) {
          localesOutDir = resolve(config.root, config.build.outDir, '_locales');
        },
        async configureServer(server) {
          // CRXJS empties outDir in configResolved. Await this before listening,
          // not closeBundle, which only runs when the dev server shuts down.
          const sourcePath = normalizePath(localesDir);
          const onLocaleChange = (_event: string, file: string) => {
            const filePath = normalizePath(file);
            if (filePath === sourcePath || filePath.startsWith(`${sourcePath}/`)) {
              void copyLocales().catch((error: unknown) => {
                server.config.logger.error(`Could not copy extension locales: ${String(error)}`);
              });
            }
          };
          server.watcher.add(localesDir);
          server.watcher.on('all', onLocaleChange);
          stopWatching = () => server.watcher.off('all', onLocaleChange);
          await copyLocales();
        },
        async closeBundle() {
          stopWatching?.();
          if (command === 'build') await copyLocales();
          else await pendingCopy;
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      // Comet reports Vite's speculative extension-URL preloads as cross-world
      // mismatches. Native module imports still load the same local chunks.
      modulePreload: false,
      rollupOptions: {
        input: {
          offscreen: resolve(import.meta.dirname, 'src/offscreen/offscreen.html'),
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
