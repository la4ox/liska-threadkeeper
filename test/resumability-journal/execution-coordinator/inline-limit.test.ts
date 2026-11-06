// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const limit = vi.hoisted(() => ({ value: Number.MAX_SAFE_INTEGER }));
vi.mock('../../../src/lib/constants', async original => ({
  ...(await original<typeof import('../../../src/lib/constants')>()),
  get MAX_CONTENT_SIZE() {
    return limit.value;
  },
}));
import * as stage from '../../../src/content/archive-stage';
import { buildChatGptBinaryAwareDestinationArchive } from '../../../src/content/capture/chatgpt-current-branch';
import { setup } from './fixtures';

afterEach(() => {
  limit.value = Number.MAX_SAFE_INTEGER;
  vi.restoreAllMocks();
});
it('inline capture fails with raw companion before automatic canonical staging can run', async () => {
  const ctx = await setup();
  try {
    const staging = vi.spyOn(stage, 'stageArchiveArtifactBytes');
    limit.value = 1;
    const result = await ctx.execute().run();
    expect(result.request).toBe('invoked');
    expect(result.captureError?.code).toBe('capture-integrity-failed');
    expect(result.captureError?.archiveCompanion?.artifacts.map(item => item.kind)).toEqual([
      'raw',
      'manifest',
    ]);
    expect(staging).not.toHaveBeenCalled();
    expect(ctx.persistArtifacts).not.toHaveBeenCalled();
  } finally {
    ctx.store.close();
  }
});
it('inline destination builder rejects oversized canonical output before stage runtime', async () => {
  const ctx = await setup();
  try {
    const result = await ctx.execute().run();
    const context = result.capture!.assetExportContext!;
    const staging = vi.spyOn(stage, 'stageArchiveArtifactBytes');
    limit.value = 1;
    await expect(
      buildChatGptBinaryAwareDestinationArchive(
        context,
        context.rawCaptureBundle.manifest.assets,
        [],
        undefined,
        [],
        true
      )
    ).rejects.toMatchObject({ code: 'capture-integrity-failed' });
    expect(staging).not.toHaveBeenCalled();
  } finally {
    ctx.store.close();
  }
});
