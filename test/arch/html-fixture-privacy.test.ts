import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE_ROOT = resolve(import.meta.dirname, '../fixtures/html');

function htmlFixtures(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return htmlFixtures(path);
    return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
  });
}

const fixtures = htmlFixtures(FIXTURE_ROOT).map(
  path => [relative(FIXTURE_ROOT, path), path] as const
);

describe('architecture: captured HTML fixture privacy', () => {
  it.each(fixtures)('%s contains no live Google account-avatar URL', (_label, path) => {
    const html = readFileSync(path, 'utf8');

    // Generated Gemini images legitimately use /gg/ and /rd-gg/. The /a/
    // namespace is an account-profile artifact and is never extractor evidence.
    expect(html).not.toMatch(/https:\/\/lh\d+\.googleusercontent\.com\/a\//i);
  });
});
