import { describe, expect, it } from 'vitest';
import {
  canExportChatGptAttachments,
  canExportDeepSeekAttachments,
} from '../../src/content/attachment-export-gates';
import type { ContentScriptSettings, ExtractionResult } from '../../src/lib/types';

const settings = { enableImageExport: true } as ContentScriptSettings;

function result(source: 'chatgpt' | 'deepseek', assets: unknown): ExtractionResult {
  const context = assets === undefined ? {} : { rawCaptureBundle: { manifest: { assets } } };
  return {
    success: true,
    data: {
      source,
      capture: { mode: 'structured-api', completeness: 'complete' },
    } as NonNullable<ExtractionResult['data']>,
    archiveCompanion: {} as NonNullable<ExtractionResult['archiveCompanion']>,
    ...(source === 'chatgpt'
      ? {
          chatGptAssetExportContext: context as NonNullable<
            ExtractionResult['chatGptAssetExportContext']
          >,
        }
      : {
          deepSeekAssetExportContext: context as NonNullable<
            ExtractionResult['deepSeekAssetExportContext']
          >,
        }),
  };
}

describe('attachment export gates', () => {
  it.each(['chatgpt', 'deepseek'] as const)(
    'skips the %s attachment pipeline only for an exact empty inventory',
    source => {
      const empty = result(source, []);
      const one = result(source, [{}]);
      const legacyUnknown = result(source, undefined);
      const gate =
        source === 'chatgpt' ? canExportChatGptAttachments : canExportDeepSeekAttachments;

      expect(gate(empty, settings, ['file'])).toBe(false);
      expect(gate(one, settings, ['file'])).toBe(true);
      expect(gate(legacyUnknown, settings, ['file'])).toBe(true);
    }
  );

  it('still requires opt-in image export and a durable output', () => {
    const candidate = result('chatgpt', [{}]);
    expect(canExportChatGptAttachments(candidate, settings, ['clipboard'])).toBe(false);
    expect(
      canExportChatGptAttachments(candidate, { ...settings, enableImageExport: false }, ['file'])
    ).toBe(false);
  });
});
