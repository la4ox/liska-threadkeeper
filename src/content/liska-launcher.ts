/** Local Liska launcher mark and layout; no external assets. */
export const LISKA_LAUNCHER_STYLES = `
  #g2o-launcher-shell {
    --g2o-right: max(20px, env(safe-area-inset-right, 0px));
    --g2o-left: max(20px, env(safe-area-inset-left, 0px));
    position: fixed;
    bottom: max(20px, env(safe-area-inset-bottom, 0px));
    right: var(--g2o-right);
    width: 44px;
    height: 44px;
    z-index: 10000;
    pointer-events: none;
  }

  #g2o-launcher {
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 8px;
    border: 1px solid #c4b5fd;
    border-radius: 50%;
    background: #312e51;
    color: #fff7ed;
    box-shadow: 0 3px 10px rgba(30, 20, 50, 0.25);
    cursor: pointer;
    pointer-events: auto;
    transition: background 0.15s ease;
  }

  #g2o-launcher:hover { background: #4c3d68; }
  #g2o-launcher svg { width: 28px; height: 28px; }
  #g2o-launcher:focus-visible,
  #g2o-launcher-actions button:focus-visible {
    outline: 2px solid #c4b5fd;
    outline-offset: 3px;
  }

  #g2o-launcher-actions {
    position: absolute;
    right: 100%;
    bottom: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: calc(100vw - var(--g2o-right) - var(--g2o-left) - 44px);
    min-height: 44px;
    padding-right: 8px;
    visibility: hidden;
    pointer-events: none;
  }

  #g2o-launcher-actions[hidden] { display: none; }
  #g2o-launcher-shell[data-expanded="true"] #g2o-launcher-actions,
  #g2o-launcher-shell:not([data-dismissed="true"]):focus-within #g2o-launcher-actions {
    visibility: visible;
    pointer-events: auto;
  }

  #g2o-launcher-actions button {
    box-sizing: border-box;
    min-width: 0;
    min-height: 44px;
    overflow-wrap: anywhere;
  }

  @media (max-width: 540px) {
    #g2o-launcher-actions {
      right: 0;
      bottom: 100%;
      flex-direction: column;
      align-items: stretch;
      max-width: calc(100vw - var(--g2o-right) - var(--g2o-left));
      max-height: calc(100dvh - max(20px, env(safe-area-inset-bottom, 0px)) - max(20px, env(safe-area-inset-top, 0px)) - 44px);
      overflow: auto;
      padding: 0 0 8px;
    }
  }
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

function setLauncherExpanded(
  shell: HTMLDivElement,
  launcher: HTMLButtonElement,
  actions: HTMLDivElement,
  expanded: boolean,
  dismissed: boolean
): void {
  shell.dataset.expanded = String(expanded);
  shell.dataset.dismissed = String(dismissed);
  launcher.setAttribute('aria-expanded', String(expanded));
  // hidden provides no-layout/no-tab semantics; inert also guards focus
  // if host CSS happens to override the hidden attribute's display rule.
  actions.hidden = !expanded;
  actions.inert = !expanded;
}

function bindActionCollapse(actions: HTMLDivElement, collapse: () => void): void {
  actions.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const action = event
      .composedPath()
      .find(
        (node): node is HTMLButtonElement =>
          node instanceof HTMLButtonElement &&
          (node.id === 'g2o-sync-button' || node.id === 'g2o-branch-button')
      );
    if (!action || !actions.contains(action)) return;
    // The real button listener has already started its existing callback.
    // Collapse only the presentation; never synthesize or replace the action.
    collapse();
  });
}

function bindEscape(shell: HTMLDivElement, collapse: () => void): void {
  shell.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    collapse();
  });
}

export function bindLiskaLauncherInteraction(
  shell: HTMLDivElement,
  launcher: HTMLButtonElement,
  actions: HTMLDivElement
): void {
  let pinned = false;
  let hovered = false;
  let dismissed = false;
  const update = (focused = shell.contains(document.activeElement)): void => {
    const expanded = !dismissed && (pinned || hovered || focused);
    setLauncherExpanded(shell, launcher, actions, expanded, dismissed);
  };
  const collapse = (): void => {
    pinned = false;
    hovered = false;
    dismissed = true;
    if (actions.contains(document.activeElement)) launcher.focus();
    update();
  };
  launcher.addEventListener('click', event => {
    if (!event.isTrusted) return;
    dismissed = pinned;
    pinned = !pinned;
    if (dismissed) collapse();
    else update();
  });
  shell.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    hovered = true;
    dismissed = false;
    update();
  });
  shell.addEventListener('pointerleave', () => {
    hovered = false;
    update();
  });
  bindActionCollapse(actions, collapse);
  shell.addEventListener('focusin', () => update());
  shell.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && shell.contains(event.relatedTarget)) return;
    // focusout precedes activeElement's update, so use the destination explicitly.
    pinned = false;
    dismissed = false;
    update(false);
  });
  bindEscape(shell, collapse);
  update();
}
