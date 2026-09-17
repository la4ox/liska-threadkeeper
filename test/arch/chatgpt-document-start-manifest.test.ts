import { describe, expect, it } from 'vitest';
import manifest from '../../src/manifest.json';

type ContentScript = {
  matches?: unknown;
  js?: unknown;
  run_at?: unknown;
  world?: unknown;
  all_frames?: unknown;
};

describe('ChatGPT document-start manifest entry', () => {
  it('declares a MAIN-world document-start script and requires Chrome 111+', () => {
    const contentScripts = manifest.content_scripts as ContentScript[];
    const entry = contentScripts.find(
      script =>
        Array.isArray(script.js) &&
        script.js.includes('src/content/capture/chatgpt-document-start.ts')
    );

    expect(manifest.minimum_chrome_version).toBe('111');
    expect(entry).toEqual({
      matches: ['https://chatgpt.com/*'],
      js: ['src/content/capture/chatgpt-document-start.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    });
    expect(entry).not.toHaveProperty('all_frames');
  });

  it('retains the established normal content-script entry separately', () => {
    const contentScripts = manifest.content_scripts as ContentScript[];
    const normalEntry = contentScripts.find(
      script => Array.isArray(script.js) && script.js.includes('src/content/index.ts')
    );

    expect(normalEntry).toMatchObject({
      run_at: 'document_idle',
      matches: expect.arrayContaining(['https://chatgpt.com/*']),
      js: ['src/content/index.ts'],
    });
  });
});
