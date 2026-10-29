import { describe, expect, it, vi } from 'vitest';
import { validateNoteCaptureMetadata } from '../../src/background/note-capture-validation';
import { validateMessageContent } from '../../src/background/validation';
import type { ObsidianNote } from '../../src/lib/types';

const HISTORY_PARTIAL = 'history-load-partial';
const IMAGE_FAILED = 'image-capture-failed';

function note(frontmatter: object = {}): ObsidianNote {
  return {
    fileName: 'capture-metadata.md',
    contentHash: 'synthetic-hash',
    body: 'Synthetic note body',
    frontmatter: {
      id: 'capture-metadata',
      title: 'Synthetic capture metadata',
      source: 'gemini',
      url: 'https://gemini.google.com/app/synthetic',
      created: '2026-01-01',
      modified: '2026-01-01',
      tags: [],
      message_count: 1,
      ...frontmatter,
    },
  };
}

/** The worker must retain this helper's verdict before its JSON-size pass. */
function expectAccepted(value: ObsidianNote, expected: boolean): void {
  expect(validateNoteCaptureMetadata(value)).toBe(expected);
  expect(validateMessageContent({ action: 'saveToOutputs', data: value, outputs: ['file'] })).toBe(
    expected
  );
}

describe('note capture metadata validation', () => {
  it('accepts absent metadata and an absent field on a null-prototype note', () => {
    expectAccepted(note(), true);
    const value = note();
    Object.setPrototypeOf(value, null);
    Object.setPrototypeOf(value.frontmatter, null);
    expectAccepted(value, true);
  });

  it.each(['complete', 'partial', 'unknown'] as const)(
    'accepts an own enumerable data outcome: %s',
    domHistoryLoad => {
      const value = note();
      Object.defineProperty(value, 'domHistoryLoad', {
        value: domHistoryLoad,
        enumerable: true,
      });
      expectAccepted(value, true);
    }
  );

  it.each([undefined, null, false, 0, '', 'Complete', 'skipped', Symbol('unknown'), {}])(
    'rejects a present invalid history outcome: %s',
    domHistoryLoad => {
      const value = note();
      Object.defineProperty(value, 'domHistoryLoad', { value: domHistoryLoad, enumerable: true });
      expectAccepted(value, false);
    }
  );

  it('rejects inherited, accessor and hidden history data without invoking accessors', () => {
    const getter = vi.fn(() => 'partial');
    const setter = vi.fn();
    const inherited = note();
    Object.setPrototypeOf(inherited, { domHistoryLoad: 'complete' });
    const inheritedAccessor = note();
    Object.setPrototypeOf(
      inheritedAccessor,
      Object.defineProperty({}, 'domHistoryLoad', { get: getter })
    );
    const accessor = note();
    Object.defineProperty(accessor, 'domHistoryLoad', { enumerable: true, get: getter });
    const setterOnly = note();
    Object.defineProperty(setterOnly, 'domHistoryLoad', { enumerable: true, set: setter });
    const hidden = note();
    Object.defineProperty(hidden, 'domHistoryLoad', { value: 'complete' });

    for (const value of [inherited, inheritedAccessor, accessor, setterOnly, hidden]) {
      expectAccepted(value, false);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it.each([0, 1, Number.MAX_SAFE_INTEGER])(
    'accepts a partial history outcome with safe nonnegative message count %s',
    message_count => {
      expectAccepted({ ...note({ message_count }), domHistoryLoad: 'partial' }, true);
    }
  );

  it.each([undefined, null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'])(
    'rejects a partial history outcome with invalid message count %s',
    message_count => {
      expectAccepted({ ...note({ message_count }), domHistoryLoad: 'partial' }, false);
    }
  );

  it.each(['complete', 'unknown'] as const)(
    'preserves the existing count scope for %s outcomes',
    domHistoryLoad => {
      expectAccepted({ ...note({ message_count: -1 }), domHistoryLoad }, true);
    }
  );

  it.each(
    [[], [HISTORY_PARTIAL], [IMAGE_FAILED, HISTORY_PARTIAL], [IMAGE_FAILED, IMAGE_FAILED]].map(
      liska_loss_diagnostics => ({ liska_loss_diagnostics })
    )
  )(
    'accepts only the existing bounded runtime diagnostic arrays: %j',
    ({ liska_loss_diagnostics }) => {
      expectAccepted(note({ liska_loss_diagnostics }), true);
    }
  );

  it.each(
    [
      undefined,
      null,
      false,
      HISTORY_PARTIAL,
      ['unknown'],
      [HISTORY_PARTIAL, IMAGE_FAILED, HISTORY_PARTIAL],
    ].map(liska_loss_diagnostics => ({ liska_loss_diagnostics }))
  )('rejects a present invalid loss diagnostic field: %j', ({ liska_loss_diagnostics }) => {
    expectAccepted(note({ liska_loss_diagnostics }), false);
  });

  it('rejects inherited, accessor and hidden diagnostics before worker JSON sizing', () => {
    const getter = vi.fn(() => [IMAGE_FAILED]);
    const inherited = note();
    Object.setPrototypeOf(inherited.frontmatter, { liska_loss_diagnostics: [IMAGE_FAILED] });
    const inheritedAccessor = note();
    Object.setPrototypeOf(
      inheritedAccessor.frontmatter,
      Object.defineProperty({}, 'liska_loss_diagnostics', { get: getter })
    );
    const accessor = note();
    Object.defineProperty(accessor.frontmatter, 'liska_loss_diagnostics', {
      enumerable: true,
      get: getter,
    });
    const hidden = note();
    Object.defineProperty(hidden.frontmatter, 'liska_loss_diagnostics', { value: [IMAGE_FAILED] });

    for (const value of [inherited, inheritedAccessor, accessor, hidden]) {
      expectAccepted(value, false);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects symbolic, sparse, custom-prototype, extra and hidden diagnostic array data', () => {
    const symbolic = [IMAGE_FAILED];
    Object.defineProperty(symbolic, Symbol('extra'), { value: true });
    const sparse = new Array(1);
    const customPrototype = [IMAGE_FAILED];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
    const extra = [IMAGE_FAILED];
    Object.defineProperty(extra, 'extra', { value: true });
    const hiddenIndex = [IMAGE_FAILED];
    Object.defineProperty(hiddenIndex, '0', { value: IMAGE_FAILED, enumerable: false });

    for (const liska_loss_diagnostics of [symbolic, sparse, customPrototype, extra, hiddenIndex]) {
      expectAccepted(note({ liska_loss_diagnostics }), false);
    }
  });

  it('rejects a diagnostic index accessor without invoking it during helper or worker validation', () => {
    const getter = vi.fn(() => IMAGE_FAILED);
    const diagnostics = [IMAGE_FAILED];
    Object.defineProperty(diagnostics, '0', { enumerable: true, get: getter });
    expectAccepted(note({ liska_loss_diagnostics: diagnostics }), false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('short-circuits diagnostics inspection when history metadata is already invalid', () => {
    const descriptorTrap = vi.fn(() => {
      throw new Error('diagnostics must not be inspected');
    });
    const value = note();
    value.domHistoryLoad = 'future-outcome' as never;
    value.frontmatter = new Proxy(value.frontmatter, { getOwnPropertyDescriptor: descriptorTrap });
    expect(validateNoteCaptureMetadata(value)).toBe(false);
    expect(descriptorTrap).not.toHaveBeenCalled();
  });
});
