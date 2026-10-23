/** Bootstrap's UI-readiness hint must come from the extractor selector SSOT. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const bootstrapPath = path.join(root, 'src/content/bootstrap.ts');

/** Inspect executable code only; explanatory prose may name an old selector. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('architecture: bootstrap readiness selector is derived, not duplicated', () => {
  const code = stripComments(fs.readFileSync(bootstrapPath, 'utf-8'));

  it('imports CONVERSATION_CONTAINER_SELECTOR from selectors/ready', () => {
    expect(code).toMatch(
      /import\s*\{[^}]*\bCONVERSATION_CONTAINER_SELECTOR\b[^}]*\}\s*from\s*'\.\/extractors\/selectors\/ready'/
    );
  });

  it('does not declare its own readiness selector', () => {
    expect(code).not.toMatch(/\b(?:const|let|var)\s+CONVERSATION_CONTAINER_SELECTOR\b/);
  });

  it('uses the shared hint for both immediate and observer readiness checks', () => {
    expect(code.match(/document\.querySelector\(CONVERSATION_CONTAINER_SELECTOR\)/g)).toHaveLength(
      2
    );
    expect(code.match(/querySelector(?:All)?\(\s*['"`]/g) ?? []).toEqual([]);
  });

  it('does not retain broad or dead readiness literals', () => {
    expect(code).not.toContain('[class*="conversation"]');
    expect(code).not.toContain('article[data-turn-id]');
    expect(code).not.toContain('threadContentWidth');
  });
});
