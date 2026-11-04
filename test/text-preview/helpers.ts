import { expect, vi } from 'vitest';
import fs from 'node:fs';
import { initTextPreview } from '../../src/text-preview/page';
import type { PreviewRequest } from '../../src/text-preview/protocol';
import { PRESENTATION_RENDERER_VERSIONS } from '../../src/archive/presentation/presentation-contracts';

export const SESSION = '12345678-1234-4234-8234-123456789abc';
export const DELIVERY = '12345678-1234-4234-8234-123456789abd';
export const HREF = `chrome-extension://test-extension-id/src/text-preview/text-preview.html?session=${SESSION}`;
export const wirePreview = () => ({
  schema: 'liska-presentation-preview/1',
  sourceCanonicalSha256: 'a'.repeat(64),
  branchTargetNodeId: 'row-4',
  title: '<img src=x> Sample / conversation',
  profile: {
    schema: 'liska-presentation-profile/1',
    includeToolContent: false,
    inertTaggedCodeBlocks: true,
  },
  rendererVersions: PRESENTATION_RENDERER_VERSIONS,
  rows: [
    { nodeId: 'row-1', role: 'user', presentedText: '│ First fox 🦊' },
    { nodeId: 'row-2', role: 'assistant', presentedText: '│ Hidden middle' },
    { nodeId: 'row-3', role: 'user', presentedText: '│ Last FOX <script>literal</script>' },
    { nodeId: 'row-4', role: 'assistant', presentedText: '│ Unselected tail' },
  ].map(row => ({
    ...row,
    markdownBody: `Markdown ${row.nodeId}: **literal source**\n\n`,
    htmlBody: `<p>HTML ${row.nodeId}: <strong>literal source</strong></p>`,
    diagnostics: { text: [], markdown: [], html: [] },
  })),
});

export function loadPage(): void {
  document.documentElement.innerHTML = fs.readFileSync(
    'src/text-preview/text-preview.html',
    'utf8'
  );
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}
export function captureTrustedActions() {
  const handlers = new WeakMap<EventTarget, Map<string, EventListener>>();
  const original = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options
  ) {
    if (typeof listener === 'function') {
      const events = handlers.get(this) ?? new Map();
      events.set(type, listener);
      handlers.set(this, events);
    }
    original.call(this, type, listener, options);
  });
  return (target: EventTarget, extra: Record<string, unknown> = {}, type = 'click') => {
    const handler = handlers.get(target)?.get(type);
    expect(handler).toBeDefined();
    handler!.call(target, { isTrusted: true, ...extra } as unknown as Event);
  };
}
export const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const checkboxes = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('#previewRows input'));
export async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

export function fixture(overrides: Partial<Parameters<typeof initTextPreview>[0]> = {}) {
  let phase = 'ready';
  const expiresAt = Date.now() + 15 * 60_000;
  const request = vi.fn<PreviewRequest>(async message => {
    if (message.action === 'takeTextPreviewPayload')
      return { success: true, deliveryId: DELIVERY, payload: wirePreview() };
    if (message.action === 'ackTextPreviewPayload') {
      phase = 'delivered';
      return { success: true };
    }
    if (message.action === 'invalidateTextPreview') return { success: true };
    return { success: true, state: phase, expiresAt };
  });
  const copy = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  const dispose = initTextPreview({ href: HREF, request, copy, ...overrides });
  return {
    request,
    copy,
    dispose,
    expiresAt,
    setPhase: (next: string) => {
      phase = next;
    },
  };
}
