import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDotsSchemaProbeState } from '../../src/lib/dots-schema-probe-page-state';

const NONCE = '01234567-89ab-4cde-8f01-23456789abcd';
const SLOT = `__liskaDotsSchemaProbe_${NONCE}`;

afterEach(() => vi.unstubAllGlobals());

describe('nonce-scoped Dots page-state reader', () => {
  it('reads only the exact validated nonce slot', () => {
    const state = { kind: 'ready' };
    const unrelated = vi.fn(() => {
      throw new Error('unrelated state must not be read');
    });
    const page = Object.defineProperty({ [SLOT]: state }, 'unrelated', { get: unrelated });
    vi.stubGlobal('window', page);

    expect(readDotsSchemaProbeState(NONCE)).toBe(state);
    expect(unrelated).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    false,
    17,
    '',
    'a'.repeat(15),
    'a'.repeat(129),
    `${NONCE}/other`,
    `${NONCE}#other`,
    `${NONCE}?other`,
    '__proto__',
    { toString: () => NONCE },
  ])('rejects an unsafe nonce without reading window: %s', nonce => {
    const get = vi.fn(() => {
      throw new Error('no page read before nonce validation');
    });
    vi.stubGlobal('window', new Proxy({}, { get }));

    expect(readDotsSchemaProbeState(nonce as string)).toEqual({ kind: 'missing' });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([16, 128])('accepts the exact safe nonce length boundary %s', length => {
    const nonce = 'A'.repeat(length);
    const state = { kind: 'ready' };
    vi.stubGlobal('window', { [`__liskaDotsSchemaProbe_${nonce}`]: state });

    expect(readDotsSchemaProbeState(nonce)).toBe(state);
  });

  it.each([undefined, null, false, 0, 'ready', () => ({ kind: 'ready' })])(
    'reports missing for a nonobject slot: %s',
    value => {
      vi.stubGlobal('window', { [SLOT]: value });

      expect(readDotsSchemaProbeState(NONCE)).toEqual({ kind: 'missing' });
    }
  );

  it('suppresses page getter failures into a fixed missing state', () => {
    vi.stubGlobal(
      'window',
      Object.defineProperty({}, SLOT, {
        get() {
          throw new Error('private page failure');
        },
      })
    );

    expect(readDotsSchemaProbeState(NONCE)).toEqual({ kind: 'missing' });
  });

  it('survives scripting serialization without module-scope dependencies', () => {
    const state = { kind: 'error', code: 'target-not-observed' };
    vi.stubGlobal('window', { [SLOT]: state });
    const serializedReader = new Function(`return (${readDotsSchemaProbeState.toString()})`)() as (
      nonce: string
    ) => unknown;

    expect(serializedReader(NONCE)).toBe(state);
    expect(serializedReader('bad')).toEqual({ kind: 'missing' });
  });
});
