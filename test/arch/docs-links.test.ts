/**
 * Fitness function: every relative Markdown link in maintained documentation
 * resolves to a file or directory that still exists in the repository.
 *
 * This intentionally checks filesystem targets, not remote URLs or heading
 * anchors. It protects documentation pruning and renames without pretending to
 * be an Internet link checker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const rootDocs = ['README.md', 'README.ja.md', 'STATUS.md', 'CHANGELOG.md', 'NOTICE.md'];

function markdownFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.md') ? [absolute] : [];
  });
}

const maintainedMarkdown = [
  ...rootDocs.map(file => path.join(root, file)),
  ...markdownFiles(path.join(root, 'docs')),
];

function withoutCodeExamples(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function relativeTargets(markdown: string): string[] {
  const targets: string[] = [];
  const link = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/g;

  for (const match of withoutCodeExamples(markdown).matchAll(link)) {
    const raw = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(raw)) continue;

    const filePart = raw.split(/[?#]/, 1)[0];
    if (!filePart) continue;
    targets.push(decodeURIComponent(filePart));
  }

  return targets;
}

describe('architecture: maintained Markdown links resolve locally', () => {
  it.each(maintainedMarkdown.map(file => [path.relative(root, file), file] as const))(
    '%s has no dangling relative links',
    (_relative, file) => {
      const markdown = fs.readFileSync(file, 'utf-8');
      const missing = relativeTargets(markdown).filter(target => {
        const resolved = path.resolve(path.dirname(file), target);
        return !fs.existsSync(resolved);
      });

      expect(missing, `dangling links in ${path.relative(root, file)}`).toEqual([]);
    }
  );
});
