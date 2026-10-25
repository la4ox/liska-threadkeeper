import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../src/archive/snapshots');

describe('snapshot analysis: pure selected-byte boundary', () => {
  it('has no Node, browser runtime, filesystem, network or mutation adapter imports', () => {
    const files = readdirSync(root).filter(name => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(path.join(root, name), 'utf8');
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/gu)].map(
        match => match[2]
      );
      expect(imports.every(value => value.startsWith('./') || value.startsWith('../'))).toBe(true);
      expect(source).not.toMatch(
        /\b(?:chrome|browser|window|document|fetch|localStorage|sessionStorage|indexedDB)\s*[.(]/u
      );
      expect(source).not.toMatch(
        /\b(?:readFile|writeFile|unlink|rename|readdir|mkdir|rmSync|require)\s*\(/u
      );
    }
  });
});
