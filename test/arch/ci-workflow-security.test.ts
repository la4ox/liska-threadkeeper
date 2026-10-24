import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf8'
);

describe('architecture: CI supply-chain boundary', () => {
  it('pins every remote action to an immutable full commit SHA', () => {
    const refs = [...workflow.matchAll(/^\s*uses:\s+([^\s#]+)(?:\s+#.*)?$/gm)].map(
      match => match[1]
    );

    expect(refs).toHaveLength(2);
    expect(refs).toEqual([
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
    ]);
    for (const ref of refs) expect(ref.split('@')[1]).toMatch(/^[a-f0-9]{40}$/);
  });

  it('keeps the workflow token read-only and out of the checkout', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s+read\b/);
    expect(workflow).toMatch(/persist-credentials:\s+false\b/);
    expect(workflow).not.toContain('pull_request_target:');
  });
});
