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

/** Only an exact empty inventory can safely skip the established attachment path. */
function hasPotentialAssets(context: unknown): boolean {
  try {
    if (typeof context !== 'object' || context === null) return true;
    const rawCaptureBundle = (context as { rawCaptureBundle?: unknown }).rawCaptureBundle;
    if (typeof rawCaptureBundle !== 'object' || rawCaptureBundle === null) return true;
    const manifest = (rawCaptureBundle as { manifest?: unknown }).manifest;
    if (typeof manifest !== 'object' || manifest === null) return true;
    const assets = (manifest as { assets?: unknown }).assets;
    return !Array.isArray(assets) || assets.length > 0;
  } catch {
    return true;
  }
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
    hasPotentialAssets(result.chatGptAssetExportContext) &&
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
    hasPotentialAssets(result.deepSeekAssetExportContext) &&
    result.data?.source === 'deepseek' &&
    result.data.capture?.mode === 'structured-api'
  );
}
