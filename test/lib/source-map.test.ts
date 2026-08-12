/**
 * Tests for source-map utility
 *
 * Tests the buildSourceMap function that converts a 0-based source array
 * to a 1-based Map for DOM attribute lookup.
 */

import { describe, it, expect } from 'vitest';
import { buildSourceMap } from '../../src/lib/source-map';
import { DeepResearchSource } from '../../src/lib/types';

describe('buildSourceMap', () => {
  it('creates 1-based index map from sources array', () => {
    const sources: DeepResearchSource[] = [
      {
        index: 0,
        url: 'https://example.com/page1',
        title: 'Example Page 1',
        domain: 'example.com',
      },
      { index: 1, url: 'https://test.com/article', title: 'Test Article', domain: 'test.com' },
      { index: 2, url: 'https://docs.org/guide', title: 'Documentation Guide', domain: 'docs.org' },
    ];

    const map = buildSourceMap(sources);

    // Map should use 1-based indexing (matching data-turn-source-index)
    expect(map.get(1)?.url).toBe('https://example.com/page1');
    expect(map.get(1)?.title).toBe('Example Page 1');
    expect(map.get(2)?.url).toBe('https://test.com/article');
    expect(map.get(3)?.url).toBe('https://docs.org/guide');

    // 0-based index should not exist
    expect(map.get(0)).toBeUndefined();

    // Index beyond array should not exist
    expect(map.get(4)).toBeUndefined();
  });

  it('returns empty map for empty sources array', () => {
    const sources: DeepResearchSource[] = [];
    const map = buildSourceMap(sources);

    expect(map.size).toBe(0);
    expect(map.get(1)).toBeUndefined();
  });

  it('handles single source correctly', () => {
    const sources: DeepResearchSource[] = [
      { index: 0, url: 'https://single.com', title: 'Single Source', domain: 'single.com' },
    ];

    const map = buildSourceMap(sources);

    expect(map.size).toBe(1);
    expect(map.get(1)?.url).toBe('https://single.com');
    expect(map.get(0)).toBeUndefined();
    expect(map.get(2)).toBeUndefined();
  });

  it('preserves all source properties', () => {
    const sources: DeepResearchSource[] = [
      { index: 0, url: 'https://full.com/path', title: 'Full Title', domain: 'full.com' },
    ];

    const map = buildSourceMap(sources);
    const source = map.get(1);

    expect(source).toBeDefined();
    expect(source?.index).toBe(0);
    expect(source?.url).toBe('https://full.com/path');
    expect(source?.title).toBe('Full Title');
    expect(source?.domain).toBe('full.com');
  });

  it('maintains correct mapping for large arrays', () => {
    const sources: DeepResearchSource[] = Array.from({ length: 100 }, (_, i) => ({
      index: i,
      url: `https://source${i}.com`,
      title: `Source ${i}`,
      domain: `source${i}.com`,
    }));

    const map = buildSourceMap(sources);

    expect(map.size).toBe(100);
    // First element: array[0] → map.get(1)
    expect(map.get(1)?.url).toBe('https://source0.com');
    // Last element: array[99] → map.get(100)
    expect(map.get(100)?.url).toBe('https://source99.com');
    // Index 0 should not exist (1-based)
    expect(map.get(0)).toBeUndefined();
    // Index 101 should not exist
    expect(map.get(101)).toBeUndefined();
  });
});
