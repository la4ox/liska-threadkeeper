import { describe, expect, it } from 'vitest';
import {
  guardTruncatedOverwrite,
  TRUNCATED_OVERWRITE_ERROR,
  TRUNCATION_PROTECTION_UNAVAILABLE_WARNING,
} from '../../src/lib/truncation-guard';
import type { NoteProbe } from '../../src/lib/note-identity';

const prior: NoteProbe = { state: 'same-conversation', messageCount: 446 };

describe('detected DOM truncation overwrite guard', () => {
  it.each([undefined, false])('does not guard an unmarked capture (%s)', truncated => {
    expect(guardTruncatedOverwrite(truncated, 27, prior)).toEqual({ allowed: true });
  });

  it('refuses a smaller detected-truncated replacement', () => {
    expect(guardTruncatedOverwrite(true, 27, prior)).toEqual({
      allowed: false,
      error: TRUNCATED_OVERWRITE_ERROR,
    });
    expect(TRUNCATED_OVERWRITE_ERROR).toContain('Load earlier messages and retry');
  });

  it.each([446, 447])('allows equal or larger detected-truncated count %i', count => {
    expect(guardTruncatedOverwrite(true, count, prior)).toEqual({ allowed: true });
  });

  it.each<NoteProbe>([
    { state: 'absent' },
    { state: 'empty' },
    { state: 'unparseable' },
    { state: 'no-id' },
    { state: 'different-id', messageCount: 446 },
    { ...prior, immutableArchivePresentation: true },
  ])('leaves target $state / immutable $immutableArchivePresentation unchanged', probe => {
    expect(guardTruncatedOverwrite(true, 27, probe)).toEqual({ allowed: true });
  });

  it('honestly warns when prior count is unavailable on a proven mutable target', () => {
    expect(guardTruncatedOverwrite(true, 27, { state: 'same-conversation' })).toEqual({
      allowed: true,
      warning: TRUNCATION_PROTECTION_UNAVAILABLE_WARNING,
    });
  });
});
