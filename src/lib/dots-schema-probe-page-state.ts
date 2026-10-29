/**
 * Self-contained MAIN-world reader serialized by chrome.scripting. It reads
 * only one validated nonce-scoped diagnostic slot; background independently
 * validates every returned field before accepting or persisting evidence.
 */
export function readDotsSchemaProbeState(nonce: string): unknown {
  try {
    if (typeof nonce !== 'string' || !/^[a-z0-9-]{16,128}$/i.test(nonce))
      return { kind: 'missing' };
    const result = (window as unknown as Record<string, unknown>)[
      `__liskaDotsSchemaProbe_${nonce}`
    ];
    return typeof result === 'object' && result !== null ? result : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}
