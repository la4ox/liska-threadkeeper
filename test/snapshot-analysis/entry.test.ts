import { afterEach, describe, expect, it, vi } from 'vitest';
const initialize = vi.hoisted(() => vi.fn());
vi.mock('../../src/snapshot-analysis/app', () => ({ initSnapshotAnalysisPage: initialize }));
afterEach(() => {
  vi.restoreAllMocks();
});

describe('snapshot page entry shim', () => {
  it('initializes after DOM readiness once', async () => {
    vi.resetModules();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    await import('../../src/snapshot-analysis/snapshot-analysis-entry');
    expect(initialize).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(initialize).toHaveBeenCalledOnce();
  });
  it('initializes an already-ready document', async () => {
    vi.resetModules();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    await import('../../src/snapshot-analysis/snapshot-analysis-entry');
    expect(initialize).toHaveBeenCalledOnce();
  });
});
