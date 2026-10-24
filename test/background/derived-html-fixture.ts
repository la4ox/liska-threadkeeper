import { buildDerivedHtmlArtifact } from '../../src/lib/derived-presentation-contract';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { sha256Hex } from '../../src/lib/sha256';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type { ExtensionMessage, ExtensionSettings } from '../../src/lib/types';

export type HtmlMessage = Extract<ExtensionMessage, { action: 'persistDerivedHtmlPresentation' }>;
export const htmlSettings = (): ExtensionSettings => ({
  ...structuredClone(DEFAULT_SYNC_SETTINGS),
  obsidianApiKey: 'not-exported',
  outputOptions: { file: true, obsidian: true, clipboard: true },
  enableHtmlExport: true,
});

export async function htmlMessage(
  source: 'chatgpt' | 'deepseek' = 'chatgpt'
): Promise<HtmlMessage> {
  return {
    action: 'persistDerivedHtmlPresentation',
    reportDurableWriteOutcome: true,
    source,
    captureId: `capture-${source}-synthetic`,
    conversationKey: 'a'.repeat(64),
    expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(htmlSettings()),
    artifact: await buildDerivedHtmlArtifact(
      '<!doctype html><p>private synthetic ♥ 字</p>',
      { sourceCanonicalSha256: 'b'.repeat(64), assetBindingSha256: 'c'.repeat(64) },
      sha256Hex
    ),
    outputs: ['file'],
  };
}
