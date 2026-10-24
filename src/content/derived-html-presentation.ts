/** Optional content-side byte authorization; no work occurs until explicitly called. */
import {
  HtmlPresentationError,
  renderArchiveHtml,
  type HtmlAssetBindingSet,
} from '../archive/presentation';
import {
  buildDerivedHtmlArtifact,
  DERIVED_HTML_MAX_BYTES,
  DerivedPresentationError,
  type DerivedHtmlArtifact,
} from '../lib/derived-presentation-contract';
import { sha256Hex } from '../lib/sha256';
import type { StructuredPresentationContext } from '../lib/types';
import {
  authorizeDerivedHtmlContext,
  DerivedHtmlPreparationError,
} from './derived-html-authorization';

export {
  DerivedHtmlPreparationError,
  type DerivedHtmlPreparationErrorCode,
} from './derived-html-authorization';

/** Authorize the same exact selected view; raw/capture/transport evidence never enters HTML. */
export async function prepareDerivedHtmlArtifact(
  value: StructuredPresentationContext,
  assetBindings?: HtmlAssetBindingSet
): Promise<DerivedHtmlArtifact> {
  const { context, canonicalSha256, assetBindingSha256 } = await authorizeDerivedHtmlContext(
    value,
    assetBindings,
    'selected'
  );
  try {
    const result = renderArchiveHtml({
      archive: context.archive,
      canonicalSha256,
      targetNodeId: context.targetNodeId,
      profile: { includeToolContent: context.includeToolContent },
      limits: { maxHtmlChars: DERIVED_HTML_MAX_BYTES, maxHtmlBytes: DERIVED_HTML_MAX_BYTES },
      ...(assetBindings === undefined ? {} : { assetBindings }),
    });
    if (
      result.canonicalSha256 !== canonicalSha256 ||
      result.assetBindingSha256 !== assetBindingSha256
    )
      throw new DerivedHtmlPreparationError('derived-html-render-provenance-mismatch');
    return await buildDerivedHtmlArtifact(
      result.html,
      { sourceCanonicalSha256: canonicalSha256, assetBindingSha256 },
      sha256Hex
    );
  } catch (error) {
    if (
      error instanceof HtmlPresentationError ||
      error instanceof DerivedPresentationError ||
      error instanceof DerivedHtmlPreparationError
    )
      throw error;
    throw new DerivedHtmlPreparationError('derived-html-render-failed');
  }
}
