import { describe, expect, it, vi } from 'vitest';
import {
  isLiskaLossDiagnosticCode,
  isLiskaLossDiagnostics,
  LISKA_LOSS_DIAGNOSTICS_SCHEMA,
  LiskaLossDiagnosticsBoundaryError,
  mergeLiskaLossDiagnostics,
  mergeRawLiskaLossDiagnostics,
  normalizeLiskaLossDiagnostics,
} from '../../src/lib/loss-diagnostics';
import { validateMessageContent } from '../../src/background/validation';
import type { LiskaLossDiagnosticCode, ObsidianNote } from '../../src/lib/types';

const first = 'history-load-partial';
const second = 'image-capture-failed';
const artifactOmitted = 'claude-artifact-content-omitted';

function raw(extra = ''): string {
  return `---\nid: example\n# User formatting stays\ntitle: "A : title"\n${extra}tags:\n  - mine\n---`;
}

function note(frontmatter: object = {}): ObsidianNote {
  return {
    fileName: 'example.md',
    contentHash: 'hash',
    body: 'Body',
    frontmatter: {
      id: 'example',
      title: 'Example',
      source: 'gemini',
      url: 'https://gemini.google.com/app/example',
      created: '2026-01-01',
      modified: '2026-01-01',
      tags: [],
      message_count: 1,
      ...frontmatter,
    },
  };
}

function accepts(value: ObsidianNote): boolean {
  return validateMessageContent({ action: 'saveToOutputs', data: value, outputs: ['file'] });
}

describe('closed historical capture-loss code contract', () => {
  it('normalizes only the bounded allowlist and does not mutate inputs', () => {
    expect(LISKA_LOSS_DIAGNOSTICS_SCHEMA).toBe(1);
    const values: LiskaLossDiagnosticCode[] = [second, first, artifactOmitted];
    expect(normalizeLiskaLossDiagnostics(values)).toEqual([artifactOmitted, first, second]);
    expect(values).toEqual([second, first, artifactOmitted]);
    expect(normalizeLiskaLossDiagnostics([first, first])).toEqual([first]);
    expect(normalizeLiskaLossDiagnostics(undefined)).toEqual([]);
    expect(
      mergeLiskaLossDiagnostics(
        [second],
        undefined,
        [first, second],
        [artifactOmitted, artifactOmitted]
      )
    ).toEqual([artifactOmitted, first, second]);
    expect(isLiskaLossDiagnosticCode(first)).toBe(true);
    expect(isLiskaLossDiagnosticCode(artifactOmitted)).toBe(true);
    expect(isLiskaLossDiagnosticCode('https://private.invalid/error')).toBe(false);
  });

  it.each([null, {}, '', [first, second, first, second], ['unknown'], [1], [undefined]])(
    'rejects invalid runtime values without serializing them (%j)',
    value => {
      expect(isLiskaLossDiagnostics(value)).toBe(false);
      expect(() => normalizeLiskaLossDiagnostics(value as LiskaLossDiagnosticCode[])).toThrow(
        LiskaLossDiagnosticsBoundaryError
      );
    }
  );

  it('rejects sparse, accessor, hidden, symbolic, extra, and inherited array data', () => {
    const getter = vi.fn(() => first);
    const accessor = [] as LiskaLossDiagnosticCode[];
    Object.defineProperty(accessor, '0', { enumerable: true, get: getter });
    const hidden = [first];
    Object.defineProperty(hidden, '0', { enumerable: false, value: first });
    const symbolic = [first];
    Object.defineProperty(symbolic, Symbol('private'), { value: second });
    const extra = Object.assign([first], { private: 'value' });
    const inherited = [first];
    Object.setPrototypeOf(inherited, Object.create(Array.prototype));
    for (const value of [new Array(1), accessor, hidden, symbolic, extra, inherited]) {
      expect(isLiskaLossDiagnostics(value)).toBe(false);
    }
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('narrow owned frontmatter merge', () => {
  it('adds missing fields while preserving every unrelated line', () => {
    const initial = raw();
    const merged = mergeRawLiskaLossDiagnostics(initial, [second, first]);
    expect(merged).toEqual({
      changed: true,
      raw: initial.replace(
        /\n---$/,
        `\nliska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - ${first}\n  - ${second}\n---`
      ),
    });
    expect(mergeRawLiskaLossDiagnostics(merged.raw, [first])).toEqual({
      changed: false,
      raw: merged.raw,
    });
  });

  it('merges the Claude omission code without clearing earlier capture losses', () => {
    const initial = raw(
      `liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - ${first}\n  - ${second}\n`
    );
    const merged = mergeRawLiskaLossDiagnostics(initial, [artifactOmitted, artifactOmitted]);
    expect(merged.raw).toBe(
      initial.replace(
        `liska_loss_diagnostics:\n  - ${first}`,
        `liska_loss_diagnostics:\n  - ${artifactOmitted}\n  - ${first}`
      )
    );
    expect(merged.changed).toBe(true);
    expect(mergeRawLiskaLossDiagnostics(merged.raw, undefined)).toEqual({
      raw: merged.raw,
      changed: false,
    });
  });

  it('unions an existing block and replaces only its exact list lines', () => {
    const initial = raw(
      `liska_loss_diagnostics:\n  - "${second}"\n# kept\nliska_loss_diagnostics_schema: 1\n`
    );
    const merged = mergeRawLiskaLossDiagnostics(initial, [first]);
    expect(merged.changed).toBe(true);
    expect(merged.raw).toBe(
      initial.replace(
        `liska_loss_diagnostics:\n  - "${second}"`,
        `liska_loss_diagnostics:\n  - ${first}\n  - ${second}`
      )
    );
  });

  it('does not rewrite an equivalent unsorted/quoted historical set', () => {
    const initial = raw(
      `liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - '${second}'\n  - "${first}"\n`
    );
    expect(mergeRawLiskaLossDiagnostics(initial, [first])).toEqual({
      raw: initial,
      changed: false,
    });
  });

  it('leaves absent diagnostics absent and does not take ownership of unrelated values', () => {
    const initial = raw('description: liska-loss-diagnostics is ordinary prose\n');
    expect(mergeRawLiskaLossDiagnostics(initial, undefined)).toEqual({
      raw: initial,
      changed: false,
    });
  });

  it.each([
    'liska_loss_diagnostics_schema: 2\nliska_loss_diagnostics:\n  - history-load-partial\n',
    'liska_loss_diagnostics_schema: 1\n',
    'liska_loss_diagnostics:\n  - history-load-partial\n',
    'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics: []\n',
    'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n',
    'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - unknown\n',
    'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - history-load-partial\n  - history-load-partial\n',
    'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - history-load-partial\n',
    'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - history-load-partial\nliska_loss_diagnostics:\n  - image-capture-failed\n',
    '"liska_loss_diagnostics_schema": 1\nliska_loss_diagnostics:\n  - history-load-partial\n',
    '"liska_loss_diagnostics\\u005fschema": 99\nliska_loss_diagnostics:\n  - history-load-partial\n',
    'liska_loss_diagnostics_schema: 1\n"liska_loss\\u005fdiagnostics": [future-evidence]\n',
    '"liska_loss\\x5fdiagnostics_schema": 99\nliska_loss_diagnostics:\n  - history-load-partial\n',
    'liska_loss_diagnostics_schema: 1\n"liska_loss\\U0000005fdiagnostics": [future-evidence]\n',
    '"\\U0000006Ciska_loss_diagnostics_schema": 99\n"\\U0000006Ciska_loss_diagnostics": [future-evidence]\n',
    '? liska_loss_diagnostics_schema\n: 99\n? liska_loss_diagnostics\n: [future-evidence]\n',
    '? "liska_loss\\u005fdiagnostics_schema"\n: 99\n? "liska_loss\\u005fdiagnostics"\n: [future-evidence]\n',
    '? liska_loss_diagnostics_schema # version\n: 99\n? liska_loss_diagnostics # observations\n: [future-evidence]\n',
    '? "liska_loss\\u005fdiagnostics_schema" # version\n: 99\n? "liska_loss\\u005fdiagnostics" # observations\n: [future-evidence]\n',
    '!!str liska_loss_diagnostics_schema: 99\n!!str liska_loss_diagnostics: [future-evidence]\n',
    '&schema liska_loss_diagnostics_schema: 99\n&diagnostics liska_loss_diagnostics: [future-evidence]\n',
    '{liska_loss_diagnostics_schema: 99, liska_loss_diagnostics: [future-evidence]}\n',
    '? >-\n  liska_loss_diagnostics_schema\n: 99\n? >-\n  liska_loss_diagnostics\n: [future-evidence]\n',
    '? "liska_loss_diag\\\n  nostics_schema"\n: 99\n? "liska_loss_diag\\\n  nostics"\n: [future-evidence]\n',
    'description: liska_loss_diagnostics is ambiguous owned-key prose\n',
    'liska_loss_diagnostics_schema: 1\n liska_loss_diagnostics:\n  - history-load-partial\n',
    'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - history-load-partial\n\n  - image-capture-failed\n',
  ])('refuses malformed, duplicate, ambiguous, or future owned blocks (%s)', block => {
    expect(() => mergeRawLiskaLossDiagnostics(raw(block), [second])).toThrow(
      'liska-loss-diagnostics-untrusted'
    );
  });
});

describe('background diagnostic boundary', () => {
  it('accepts absent, empty, and bounded exact-code arrays', () => {
    expect(accepts(note())).toBe(true);
    expect(accepts(note({ liska_loss_diagnostics: [] }))).toBe(true);
    expect(accepts(note({ liska_loss_diagnostics: [second, first] }))).toBe(true);
    expect(accepts(note({ liska_loss_diagnostics: [second, artifactOmitted, first] }))).toBe(true);
  });

  it.each([null, undefined, 'image-capture-failed', ['unknown'], [first, second, first, second]])(
    'rejects present invalid diagnostic data (%j)',
    value => {
      expect(accepts(note({ liska_loss_diagnostics: value }))).toBe(false);
    }
  );

  it('rejects inherited, accessor, hidden, and symbolic-array diagnostics without invoking getters', () => {
    const inherited = note();
    Object.setPrototypeOf(inherited.frontmatter, { liska_loss_diagnostics: [first] });
    const accessor = note();
    const getter = vi.fn(() => [first]);
    Object.defineProperty(accessor.frontmatter, 'liska_loss_diagnostics', {
      enumerable: true,
      get: getter,
    });
    const hidden = note();
    Object.defineProperty(hidden.frontmatter, 'liska_loss_diagnostics', { value: [first] });
    const symbolicArray = [first];
    Object.defineProperty(symbolicArray, Symbol('private'), { value: true });
    for (const value of [
      inherited,
      accessor,
      hidden,
      note({ liska_loss_diagnostics: symbolicArray }),
    ]) {
      expect(accepts(value)).toBe(false);
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
