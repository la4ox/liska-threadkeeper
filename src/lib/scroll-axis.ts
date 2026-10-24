/** Direction-independent view of a vertical conversation scroller. */
export interface ScrollAxis {
  /** Distance from the oldest/top edge: zero at the oldest content. */
  distanceFromTop(): number;
  /** Scroll to a distance from the oldest/top edge. */
  scrollToDistance(distance: number): void;
  /** Pin the newest/bottom window before harvesting. */
  pinBottom(): void;
}

function scrollRange(container: HTMLElement, scrollTop: number): number {
  const measured = container.scrollHeight - container.clientHeight;
  return Math.max(Number.isFinite(measured) ? measured : 0, Math.abs(scrollTop), 0);
}

/**
 * Normalize ordinary and column-reverse scroll origins.
 *
 * Ordinary containers report zero at the oldest/top edge. A column-reverse
 * ChatGPT timeline reports zero at the newest/bottom edge and negative values
 * toward older content. A negative reading latches reversed mode even if the
 * flex-direction style later moves to a nested element.
 */
export function createScrollAxis(container: HTMLElement): ScrollAxis {
  let reversed = getComputedStyle(container).flexDirection === 'column-reverse';

  const readScrollTop = (): number => {
    const top = Number.isFinite(container.scrollTop) ? container.scrollTop : 0;
    if (top < 0) reversed = true;
    return top;
  };

  return {
    distanceFromTop: () => {
      const top = readScrollTop();
      const range = scrollRange(container, top);
      const distance = reversed ? top + range : top;
      return Math.max(0, Math.min(range, distance));
    },
    scrollToDistance: distance => {
      const top = readScrollTop();
      const range = scrollRange(container, top);
      const bounded = Math.max(0, Math.min(range, distance));
      container.scrollTop = reversed ? bounded - range : bounded;
    },
    pinBottom: () => {
      readScrollTop();
      container.scrollTop = reversed ? 0 : container.scrollHeight;
    },
  };
}
