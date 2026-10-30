import { describe, expect, it } from 'vitest';
import manifest from '../../src/manifest.json';

type ContentScript = {
  matches?: unknown;
  js?: unknown;
  run_at?: unknown;
  world?: unknown;
  all_frames?: unknown;
};

describe('Claude MAIN scroll-prime manifest entry', () => {
  it('declares one exact Claude-only top-frame document-start entry', () => {
    const contentScripts = manifest.content_scripts as ContentScript[];
    const entry = contentScripts.find(
      script =>
        Array.isArray(script.js) &&
        script.js.includes('src/content/capture/claude-scroll-prime-main.ts')
    );

    expect(entry).toEqual({
      matches: ['https://claude.ai/*'],
      js: ['src/content/capture/claude-scroll-prime-main.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    });
    expect(entry).not.toHaveProperty('all_frames');
    expect(
      contentScripts.filter(
        script =>
          script.run_at === 'document_start' &&
          script.world === 'MAIN' &&
          Array.isArray(script.matches) &&
          script.matches.includes('https://claude.ai/*')
      )
    ).toHaveLength(1);
  });

  it('does not broaden permissions or merge with the isolated content entry', () => {
    expect(manifest.permissions).toEqual([
      'storage',
      'downloads',
      'offscreen',
      'clipboardWrite',
      'scripting',
    ]);
    const isolated = (manifest.content_scripts as ContentScript[]).find(
      script => Array.isArray(script.js) && script.js.includes('src/content/index.ts')
    );
    expect(isolated).toMatchObject({
      run_at: 'document_idle',
      matches: expect.arrayContaining(['https://claude.ai/*']),
      js: ['src/content/index.ts'],
    });
  });
});
