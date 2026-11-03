import { buildDerivedTextArtifact } from '../../src/lib/derived-text-presentation-contract';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { sha256Hex } from '../../src/lib/sha256';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type { ExtensionMessage, ExtensionSettings } from '../../src/lib/types';

export type TextMessage = Extract<ExtensionMessage, { action: 'persistDerivedTextPresentation' }>;

export const textSettings = (): ExtensionSettings => ({
  ...structuredClone(DEFAULT_SYNC_SETTINGS),
  obsidianApiKey: 'not-exported',
  outputOptions: { file: true, obsidian: true, clipboard: true },
  enableTextExport: true,
});

export async function textMessage(
  source: 'chatgpt' | 'deepseek' = 'chatgpt'
): Promise<TextMessage> {
  return {
    action: 'persistDerivedTextPresentation',
    reportDurableWriteOutcome: true,
    source,
    captureId: `capture-${source}-synthetic`,
    conversationKey: 'a'.repeat(64),
    expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(textSettings()),
    artifact: await buildDerivedTextArtifact(
      'private synthetic plain text ♥ 字\n',
      { sourceCanonicalSha256: 'b'.repeat(64) },
      sha256Hex
    ),
    outputs: ['file'],
  };
}
