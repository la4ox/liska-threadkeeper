import { afterEach, describe, expect, it } from 'vitest';
import { createScrollAxis } from '../../src/lib/scroll-axis';

function scroller({ reversed = false, range = 900, top = 0 } = {}): HTMLElement {
  const element = document.createElement('div');
  element.style.display = 'flex';
  element.style.flexDirection = reversed ? 'column-reverse' : 'column';
  let scrollTop = top;
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: value => {
      scrollTop = reversed
        ? Math.max(-range, Math.min(0, Number(value)))
        : Math.max(0, Math.min(range, Number(value)));
    },
    configurable: true,
  });
  Object.defineProperty(element, 'clientHeight', { get: () => 100, configurable: true });
  Object.defineProperty(element, 'scrollHeight', {
    get: () => range + 100,
    configurable: true,
  });
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createScrollAxis', () => {
  it('normalizes an ordinary top-origin scroller', () => {
    const element = scroller({ top: 400 });
    const axis = createScrollAxis(element);

    expect(axis.distanceFromTop()).toBe(400);
    axis.scrollToDistance(100);
    expect(element.scrollTop).toBe(100);
    axis.pinBottom();
    expect(element.scrollTop).toBe(900);
  });

  it('normalizes a column-reverse bottom-origin scroller', () => {
    const element = scroller({ reversed: true, top: 0 });
    const axis = createScrollAxis(element);

    expect(axis.distanceFromTop()).toBe(900);
    axis.scrollToDistance(300);
    expect(element.scrollTop).toBe(-600);
    expect(axis.distanceFromTop()).toBe(300);
    axis.scrollToDistance(0);
    expect(element.scrollTop).toBe(-900);
    axis.pinBottom();
    expect(element.scrollTop).toBe(0);
  });

  it('latches reversed mode from a negative reading when style evidence is absent', () => {
    const element = scroller({ reversed: true, top: -500 });
    element.style.flexDirection = 'column';
    const axis = createScrollAxis(element);

    expect(axis.distanceFromTop()).toBe(400);
    axis.scrollToDistance(200);
    expect(element.scrollTop).toBe(-700);
  });

  it('clamps requested and observed distances to the current range', () => {
    const element = scroller({ range: 500, top: 200 });
    const axis = createScrollAxis(element);

    axis.scrollToDistance(10_000);
    expect(axis.distanceFromTop()).toBe(500);
    axis.scrollToDistance(-10);
    expect(axis.distanceFromTop()).toBe(0);
  });
});
