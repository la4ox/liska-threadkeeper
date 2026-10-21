import type { RawCaptureBundle } from '../../capture';
import type { LiskaThreadArchive } from '../../types';

export const DEEPSEEK_SOURCE_FORMAT = 'deepseek.web.history' as const;
export const DEEPSEEK_NORMALIZER_ID = 'deepseek-web/1' as const;

export type DeepSeekJsonRecord = Record<string, unknown>;

export class DeepSeekNormalizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DeepSeekNormalizationError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface DeepSeekNormalizationInput {
  bundle: RawCaptureBundle;
  manifestSha256: string;
  artifactId: string;
  sha256: (bytes: Uint8Array) => Promise<string>;
  sourceFormat?: string;
}

export interface DeepSeekNormalizationResult {
  archive: LiskaThreadArchive;
  observedUnknownContentTypes: string[];
}

export function deepSeekFail(code: string, message: string): never {
  throw new DeepSeekNormalizationError(code, message);
}
