/** Local, launch-only fox. Provider CSS may redress it, but it can only open trusted UI. */
export const LISKA_LAUNCHER_STYLES = `
#g2o-launcher-shell { position: fixed; bottom: 20px; right: 20px; z-index: 10000; }
#g2o-launcher { display: grid; place-items: center; width: 44px; height: 44px; padding: 8px; border: 1px solid #c4b5fd; border-radius: 50%; background: #312e51; color: #fff7ed; cursor: pointer; }
#g2o-launcher svg { width: 28px; height: 28px; }
#g2o-launcher:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 3px; }
`;
/** A self-contained decorative fox; no asset request or page-supplied markup. */
export function createLiskaMark(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shapes = [
    ['M4 3 13 9 19 9 28 3 26 21 16 29 6 21Z', '#e8a26b'],
    ['M7 7 12 11 7 13Z M25 7 20 11 25 13Z', '#70415c'],
    ['M6 16 13 18 16 24 19 18 26 16 24 23 16 29 8 23Z', '#fff1dc'],
    ['M10 16 12 17 M20 16 22 15', 'none'],
    ['M13 23 19 23 16 26Z', '#312e51'],
  ];
  for (const [d, fill] of shapes) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', fill);
    if (fill === 'none') {
      path.setAttribute('stroke', '#312e51');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
    }
    svg.appendChild(path);
  }
  return svg;
}

export function bindLiskaLauncherInteraction(
  launcher: HTMLButtonElement,
  openSurface: () => void
): void {
  launcher.addEventListener('click', event => {
    if (event.isTrusted) openSurface();
  });
}
