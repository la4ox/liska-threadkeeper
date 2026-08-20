import type { RawCaptureBundle } from '../../capture';
import type { ArchiveAsset, JsonValue, LiskaThreadArchive } from '../../types';

export const DEFAULT_SOURCE_FORMAT = 'chatgpt.web.history';
export const NORMALIZER_ID = 'chatgpt-web/1';
export const HASH_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_IDENTIFIER_LENGTH = 512;

export type JsonRecord = Record<string, unknown>;

export class ChatGptNormalizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChatGptNormalizationError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ChatGptNormalizationInput {
  /** Runtime-only exact raw bytes paired with their immutable manifest records. */
  bundle: RawCaptureBundle;
  manifestSha256: string;
  artifactId: string;
  /** Injected so this pure module has no Node or browser-runtime dependency. */
  sha256: (bytes: Uint8Array) => Promise<string>;
  sourceFormat?: string;
}

export interface ChatGptNormalizationResult {
  archive: LiskaThreadArchive;
  observedUnknownContentTypes: string[];
}

export interface RawEnvelope {
  conversation: JsonRecord;
  basePointer: string;
}

export interface ProviderAssetRecord {
  id: string;
  state: ArchiveAsset['acquisition']['state'];
  attemptedAt: string | null;
  relativePath: string | null;
  mediaType: string | null;
  byteLength: number | null;
  sha256: string | null;
  detail: string | null;
  sourceRefs: Array<{ artifactId: string; rawPointer: string }>;
}

export interface ProviderAssetIndex {
  byId: Map<string, ProviderAssetRecord>;
  bySourceRef: Map<string, ProviderAssetRecord>;
  records: ProviderAssetRecord[];
}

export interface PrivacyTracker {
  redactions: PrivacyRedaction[];
}

export interface PrivacyRedaction {
  code: string;
  message: string;
  pointer: string;
}

export interface AssetContext {
  assets: Record<string, ArchiveAsset>;
  assetIdsByIdentity: Map<string, string>;
  manifestAssets: ProviderAssetIndex;
  artifactId: string;
  format: string;
  privacy: PrivacyTracker;
}

export interface BlockContext extends AssetContext {
  observedUnknownContentTypes: Set<string>;
}

export interface NormalizedGraph {
  rootIds: string[];
  nodes: LiskaThreadArchive['graph']['nodes'];
  currentNodeId: string | null;
}

export interface SanitizedJson {
  value: JsonValue;
  redacted: boolean;
  truncated: boolean;
}
