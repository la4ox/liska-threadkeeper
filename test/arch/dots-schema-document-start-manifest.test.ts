import { describe, expect, it } from 'vitest';
import manifest from '../../src/manifest.json';

type ContentScript = {
  matches?: unknown;
  js?: unknown;
  run_at?: unknown;
  world?: unknown;
  all_frames?: unknown;
};

describe('Dots schema document-start manifest entry', () => {
  it('is a separate MAIN-world document-start entry on ChatGPT only', () => {
    const contentScripts = manifest.content_scripts as ContentScript[];
    const entry = contentScripts.find(
      script =>
        Array.isArray(script.js) &&
        script.js.includes('src/content/capture/dots-schema-document-start.ts')
    );

    expect(entry).toEqual({
      matches: ['https://chatgpt.com/*'],
      js: ['src/content/capture/dots-schema-document-start.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    });
    expect(entry).not.toHaveProperty('all_frames');
  });

  it('does not widen or replace the ordinary ChatGPT capture entry', () => {
    const contentScripts = manifest.content_scripts as ContentScript[];
    const ordinary = contentScripts.find(
      script =>
        Array.isArray(script.js) &&
        script.js.includes('src/content/capture/chatgpt-document-start.ts')
    );

    expect(ordinary).toEqual({
      matches: ['https://chatgpt.com/*'],
      js: ['src/content/capture/chatgpt-document-start.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    });
  });
});
