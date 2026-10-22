import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { cp } from 'node:fs/promises';
import { resolve } from 'path';
import manifest from './src/manifest.json' with { type: 'json' };

const outDir = 'dist';

export default defineConfig({
  plugins: [
    crx({ manifest }),
    {
      name: 'liska-copy-locales',
      apply: 'build',
      async closeBundle() {
        await cp(
          resolve(import.meta.dirname, 'src/_locales'),
          resolve(import.meta.dirname, outDir, '_locales'),
          {
            recursive: true,
            force: true,
          }
        );
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
});
