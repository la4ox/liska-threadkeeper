/** Bootstrap's UI-readiness hint must come from the extractor selector SSOT. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import * as readiness from '../../src/content/extractors/selectors/ready';

const root = path.resolve(import.meta.dirname, '../..');
const bootstrapPath = path.join(root, 'src/content/bootstrap.ts');

/** Inspect executable code only; explanatory prose may name an old selector. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('architecture: bootstrap readiness selector is derived, not duplicated', () => {
  const code = stripComments(fs.readFileSync(bootstrapPath, 'utf-8'));

  it('imports CONVERSATION_READY_SELECTORS from selectors/ready', () => {
    expect(code).toMatch(
      /import\s*\{[^}]*\bCONVERSATION_READY_SELECTORS\b[^}]*\}\s*from\s*'\.\/extractors\/selectors\/ready'/
    );
  });

  it('does not declare its own readiness map or use a joined cross-platform selector', () => {
    expect(code).not.toMatch(/\b(?:const|let|var)\s+CONVERSATION_READY_SELECTORS\b/);
    expect(code).not.toContain('CONVERSATION_CONTAINER_SELECTOR');
    expect(code).not.toMatch(/Object\.(?:values|entries)\(\s*CONVERSATION_READY_SELECTORS\s*\)/);
  });

  it('exports only per-platform hints, not a joined cross-platform runtime selector', () => {
    expect(Object.keys(readiness)).toEqual(['CONVERSATION_READY_SELECTORS']);
  });

  it('selects only the current extractor platform hint before waiting', () => {
    expect(code).toMatch(
      /await\s+waitForConversationContainer\(\s*CONVERSATION_READY_SELECTORS\[extractor\.platform\]\s*\)/
    );
  });

  it('uses the complete selected hint for both immediate and observer readiness checks', () => {
    expect(code).toMatch(/function\s+waitForConversationContainer\(readinessSelector:\s*string\)/);
    expect(code.match(/document\.querySelector\(readinessSelector\)/g)).toHaveLength(2);
    expect(code.match(/querySelector(?:All)?\(\s*['"`]/g) ?? []).toEqual([]);
  });

  it('does not retain broad or dead readiness literals', () => {
    expect(code).not.toContain('[class*="conversation"]');
    expect(code).not.toContain('article[data-turn-id]');
    expect(code).not.toContain('threadContentWidth');
  });
});
