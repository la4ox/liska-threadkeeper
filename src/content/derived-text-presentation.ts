/** Optional canonical-derived plain-text preparation; no work occurs until called. */
import { renderArchiveText, TextPresentationError } from '../archive/presentation';
import {
  buildDerivedTextArtifact,
  DERIVED_TEXT_MAX_BYTES,
  DerivedTextContractError,
  type DerivedTextArtifact,
} from '../lib/derived-text-presentation-contract';
import { sha256Hex } from '../lib/sha256';
import type { StructuredPresentationContext } from '../lib/types';
import {
  authorizeDerivedHtmlContext,
  DerivedHtmlPreparationError,
} from './derived-html-authorization';

export type DerivedTextPreparationErrorCode =
  | 'derived-text-context-invalid'
  | 'derived-text-canonical-serialization-failed'
  | 'derived-text-canonical-length-mismatch'
  | 'derived-text-canonical-hash-failed'
  | 'derived-text-canonical-hash-mismatch'
  | 'derived-text-render-failed'
  | 'derived-text-render-provenance-mismatch';

export class DerivedTextPreparationError extends Error {
  constructor(readonly code: DerivedTextPreparationErrorCode) {
    super(code);
    this.name = 'DerivedTextPreparationError';
  }
}

function mapAuthorizationError(error: unknown): DerivedTextPreparationError {
  if (error instanceof DerivedHtmlPreparationError) {
    const mapped = error.code.replace('derived-html-', 'derived-text-');
    if (
      [
        'derived-text-context-invalid',
        'derived-text-canonical-serialization-failed',
        'derived-text-canonical-length-mismatch',
        'derived-text-canonical-hash-failed',
        'derived-text-canonical-hash-mismatch',
      ].includes(mapped)
    )
      return new DerivedTextPreparationError(mapped as DerivedTextPreparationErrorCode);
  }
  return new DerivedTextPreparationError('derived-text-context-invalid');
}

/** Authorizes the exact selected canonical branch; Markdown output never enters this path. */
export async function prepareDerivedTextArtifact(
  value: StructuredPresentationContext
): Promise<DerivedTextArtifact> {
  let authorized: {
    readonly context: StructuredPresentationContext;
    readonly canonicalSha256: string;
  };
  try {
    authorized = await authorizeDerivedHtmlContext(value, undefined, 'selected');
  } catch (error) {
    throw mapAuthorizationError(error);
  }
  const { context, canonicalSha256 } = authorized;
  try {
    const result = renderArchiveText({
      archive: context.archive,
      canonicalSha256,
      targetNodeId: context.targetNodeId,
      profile: { includeToolContent: context.includeToolContent },
      limits: { maxTextChars: DERIVED_TEXT_MAX_BYTES, maxTextBytes: DERIVED_TEXT_MAX_BYTES },
    });
    if (result.canonicalSha256 !== canonicalSha256)
      throw new DerivedTextPreparationError('derived-text-render-provenance-mismatch');
    return await buildDerivedTextArtifact(
      result.text,
      { sourceCanonicalSha256: canonicalSha256 },
      sha256Hex
    );
  } catch (error) {
    if (
      error instanceof TextPresentationError ||
      error instanceof DerivedTextContractError ||
      error instanceof DerivedTextPreparationError
    )
      throw error;
    throw new DerivedTextPreparationError('derived-text-render-failed');
  }
}
