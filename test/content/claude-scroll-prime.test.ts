import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundedClaudeScrollPrimeDelta,
  CLAUDE_SCROLL_PRIME_EVENT,
  CLAUDE_SCROLL_PRIME_ROOT,
  isClaudeScrollPrimeDelta,
  isClaudeScrollPrimeMainContext,
} from '../../src/content/capture/claude-scroll-prime-contract';
import { installClaudeScrollPrimeMain } from '../../src/content/capture/claude-scroll-prime-main-runtime';
import { requestClaudeScrollPrime } from '../../src/content/capture/claude-scroll-prime';

function root(connected = true): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-autoscroll-container', '');
  if (connected) document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Claude scroll-prime contract', () => {
  it.each([0, -1, NaN, Infinity, '1', null, undefined, 131])(
    'rejects an invalid primitive delta (%s)',
    value => expect(isClaudeScrollPrimeDelta(value)).toBe(false)
  );

  it('bounds a valid provider step without inventing one', () => {
    expect(boundedClaudeScrollPrimeDelta(64)).toBe(64);
    expect(boundedClaudeScrollPrimeDelta(500)).toBe(130);
    expect(boundedClaudeScrollPrimeDelta(0)).toBeUndefined();
  });

  it('admits only the exact top-frame Claude origin', () => {
    expect(isClaudeScrollPrimeMainContext('https://claude.ai', true)).toBe(true);
    expect(isClaudeScrollPrimeMainContext('https://claude.ai', false)).toBe(false);
    expect(isClaudeScrollPrimeMainContext('https://example.test', true)).toBe(false);
  });
});

describe('Claude MAIN scroll-prime listener', () => {
  it('calls the page-owned scrollBy exactly once on the same semantic root', () => {
    const element = root();
    const scrollBy = vi.fn();
    element.scrollBy = scrollBy;
    const remove = installClaudeScrollPrimeMain({ document });
    const event = new CustomEvent(CLAUDE_SCROLL_PRIME_EVENT, {
      cancelable: true,
      detail: 130,
    });

    expect(element.dispatchEvent(event)).toBe(false);
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
      top: -130,
      left: 0,
      behavior: 'instant',
    });
    expect(event.defaultPrevented).toBe(true);
    remove();
  });

  it.each([
    ['disconnected', () => root(false), 10],
    ['wrong-target', () => document.body.appendChild(document.createElement('div')), 10],
    ['zero', () => root(), 0],
    ['oversize', () => root(), 131],
    ['string', () => root(), '10'],
  ] as const)('rejects %s requests without acknowledgement', (_name, create, detail) => {
    const element = create();
    const scrollBy = vi.fn();
    element.scrollBy = scrollBy;
    const remove = installClaudeScrollPrimeMain({ document });
    const event = new CustomEvent(CLAUDE_SCROLL_PRIME_EVENT, {
      cancelable: true,
      detail,
    });

    expect(element.dispatchEvent(event)).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    remove();
  });

  it('rejects an ambiguous semantic root and a throwing page method', () => {
    const first = root();
    root();
    const ambiguous = vi.fn();
    first.scrollBy = ambiguous;
    const remove = installClaudeScrollPrimeMain({ document });
    expect(
      first.dispatchEvent(
        new CustomEvent(CLAUDE_SCROLL_PRIME_EVENT, { cancelable: true, detail: 10 })
      )
    ).toBe(true);
    expect(ambiguous).not.toHaveBeenCalled();
    remove();

    document.body.innerHTML = '';
    const only = root();
    only.scrollBy = vi.fn(() => {
      throw new Error('provider failure');
    });
    const removeThrowing = installClaudeScrollPrimeMain({ document });
    expect(
      only.dispatchEvent(
        new CustomEvent(CLAUDE_SCROLL_PRIME_EVENT, { cancelable: true, detail: 10 })
      )
    ).toBe(true);
    removeThrowing();

    document.body.innerHTML = '';
    const getter = root();
    Object.defineProperty(getter, 'scrollBy', {
      get: () => {
        throw new Error('provider getter failure');
      },
      configurable: true,
    });
    const removeGetter = installClaudeScrollPrimeMain({ document });
    expect(
      getter.dispatchEvent(
        new CustomEvent(CLAUDE_SCROLL_PRIME_EVENT, { cancelable: true, detail: 10 })
      )
    ).toBe(true);
    removeGetter();
  });
});

describe('isolated Claude scroll-prime request', () => {
  it('dispatches one cancelable primitive request and ignores acknowledgement', () => {
    const element = root();
    const observed: CustomEvent<unknown>[] = [];
    element.addEventListener(CLAUDE_SCROLL_PRIME_EVENT, event => {
      observed.push(event as CustomEvent<unknown>);
      event.preventDefault();
    });

    requestClaudeScrollPrime(element, 500);

    expect(observed).toHaveLength(1);
    expect(observed[0].detail).toBe(130);
    expect(typeof observed[0].detail).toBe('number');
    expect(observed[0].cancelable).toBe(true);
  });

  it('does not dispatch for a broad fallback root or invalid step', () => {
    const fallback = document.createElement('div');
    document.body.append(fallback);
    const fallbackDispatch = vi.spyOn(fallback, 'dispatchEvent');
    requestClaudeScrollPrime(fallback, 100);
    expect(fallbackDispatch).not.toHaveBeenCalled();

    const semantic = root();
    const semanticDispatch = vi.spyOn(semantic, 'dispatchEvent');
    requestClaudeScrollPrime(semantic, NaN);
    expect(semanticDispatch).not.toHaveBeenCalled();
    expect(semantic.matches(CLAUDE_SCROLL_PRIME_ROOT)).toBe(true);
  });

  it('crosses the installed listener without a native or isolated duplicate', () => {
    const element = root();
    const scrollBy = vi.fn();
    element.scrollBy = scrollBy;
    const remove = installClaudeScrollPrimeMain({ document });

    requestClaudeScrollPrime(element, 64);

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: -64, left: 0, behavior: 'instant' });
    remove();
  });
});
