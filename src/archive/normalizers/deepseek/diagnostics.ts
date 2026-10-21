import type { RawCaptureManifest } from '../../capture';
import type { ArchiveDiagnostic, SourceReference } from '../../types';
import { deepSeekAssetInventoryDiagnostics } from './assets';
import type { DeepSeekAssetInventory } from './inventory';
import { sourceRef, type DeepSeekPrivacyTracker } from './privacy';

export interface DeepSeekDiagnosticsInput {
  artifactId: string;
  format: string;
  unknownTypes: ReadonlySet<string>;
  privacy: DeepSeekPrivacyTracker;
  assetInventory: DeepSeekAssetInventory;
  conversationSource: SourceReference;
}

export function deepSeekDiagnostics(
  manifest: RawCaptureManifest,
  input: DeepSeekDiagnosticsInput
): ArchiveDiagnostic[] {
  const completeness = (['graph', 'messages', 'branches', 'assets'] as const)
    .filter(aspect => manifest.completeness[aspect] !== 'complete')
    .map(aspect => ({
      severity:
        manifest.completeness[aspect] === 'partial' ? ('warning' as const) : ('info' as const),
      code: `capture-${aspect}-${manifest.completeness[aspect]}`,
      message: `Raw capture marked ${aspect} as ${manifest.completeness[aspect]}.`,
      path: null,
      sourceRefs: [input.conversationSource],
      extensions: {},
    }));
  const unknown = [...input.unknownTypes].sort().map(type => ({
    severity: 'info' as const,
    code: 'unknown-content-type',
    message: `Retained DeepSeek fragment type ${type} as an unknown block.`,
    path: null,
    sourceRefs: [input.conversationSource],
    extensions: { deepseek: { contentType: type } },
  }));
  const privacy = input.privacy.redactions.map(redaction => ({
    severity: 'warning' as const,
    code: redaction.code,
    message: redaction.message,
    path: null,
    sourceRefs: [
      sourceRef(input.artifactId, 'privacy-redaction', null, redaction.pointer, input.format),
    ],
    extensions: {},
  }));
  return [
    ...completeness,
    ...deepSeekAssetInventoryDiagnostics(input.assetInventory, input.conversationSource),
    ...unknown,
    ...privacy,
  ];
}
