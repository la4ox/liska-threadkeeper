/** Pure bootstrap gates for optional provider binary acquisition. */

import type {
  ArchiveCompanionBundle,
  ContentScriptSettings,
  ExtractionResult,
  OutputDestination,
} from '../lib/types';

function hasDurableOutput(outputs: readonly OutputDestination[]): boolean {
  return outputs.some(output => output === 'file' || output === 'obsidian');
}

export function canExportChatGptAttachments(
  result: ExtractionResult,
  settings: ContentScriptSettings,
  outputs: readonly OutputDestination[]
): result is ExtractionResult & {
  archiveCompanion: ArchiveCompanionBundle;
  chatGptAssetExportContext: NonNullable<ExtractionResult['chatGptAssetExportContext']>;
} {
  return (
    settings.enableImageExport === true &&
    hasDurableOutput(outputs) &&
    result.archiveCompanion !== undefined &&
    result.chatGptAssetExportContext !== undefined &&
    (result.allBranches !== undefined || result.data?.source === 'chatgpt')
  );
}

export function canExportDeepSeekAttachments(
  result: ExtractionResult,
  settings: ContentScriptSettings,
  outputs: readonly OutputDestination[]
): result is ExtractionResult & {
  archiveCompanion: ArchiveCompanionBundle;
  deepSeekAssetExportContext: NonNullable<ExtractionResult['deepSeekAssetExportContext']>;
} {
  return (
    settings.enableImageExport === true &&
    hasDurableOutput(outputs) &&
    result.archiveCompanion !== undefined &&
    result.deepSeekAssetExportContext !== undefined &&
    result.data?.source === 'deepseek' &&
    result.data.capture?.mode === 'structured-api'
  );
}
