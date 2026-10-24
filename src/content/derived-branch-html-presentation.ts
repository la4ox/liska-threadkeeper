/** Authorize once, then build individual branch artifacts; never dispatch or claim delivery. */
import {
  HTML_BRANCH_SESSION_MAX_LEAVES,
  HtmlPresentationError,
  prepareArchiveHtmlBranchSession,
  type HtmlAssetBindingSet,
  type HtmlBranchRenderFact,
  type HtmlBranchSession,
  type HtmlBranchSummary,
  type HtmlPresentationLimits,
} from '../archive/presentation';
import { resolveLimits } from '../archive/presentation/safety';
import {
  buildDerivedBranchHtmlArtifact,
  DerivedBranchPresentationError,
  type DerivedBranchHtmlArtifact,
  type DerivedBranchHtmlTarget,
} from '../lib/derived-branch-presentation-contract';
import {
  DERIVED_HTML_MAX_BYTES,
  type DerivedHtmlProvenance,
} from '../lib/derived-presentation-contract';
import { sha256Hex } from '../lib/sha256';
import type { StructuredArchivePresentationContext } from '../lib/types';
import {
  authorizeDerivedHtmlContext,
  DerivedHtmlPreparationError,
} from './derived-html-authorization';

export type DerivedHtmlBranchPreparationErrorCode =
  | 'derived-branch-html-context-invalid'
  | 'derived-branch-html-options-invalid'
  | 'derived-branch-html-canonical-serialization-failed'
  | 'derived-branch-html-canonical-length-mismatch'
  | 'derived-branch-html-canonical-hash-failed'
  | 'derived-branch-html-canonical-hash-mismatch'
  | 'derived-branch-html-session-failed'
  | 'derived-branch-html-render-failed'
  | 'derived-branch-html-render-provenance-mismatch';

/** Codes only: native exceptions and provider values must not escape this adapter. */
export class DerivedHtmlBranchPreparationError extends Error {
  constructor(readonly code: DerivedHtmlBranchPreparationErrorCode) {
    super(code);
    this.name = 'DerivedHtmlBranchPreparationError';
  }
}

export interface DerivedHtmlBranchPresentationOptions {
  readonly limits?: Partial<HtmlPresentationLimits>;
  readonly maxBranches?: number;
}

export interface DerivedHtmlBranchLeafArtifact {
  readonly artifact: Readonly<DerivedBranchHtmlArtifact>;
  /** Rendering capability only, not evidence that either HTML or receipt was persisted. */
  readonly fact: HtmlBranchRenderFact;
}

export interface DerivedHtmlBranchPresentationSession {
  readonly branches: readonly HtmlBranchSummary[];
  readonly branchCount: number;
  readonly branchPointCount: number;
  buildLeaf(ordinal: number): Promise<DerivedHtmlBranchLeafArtifact>;
  buildIndex(
    orderedSameSessionFacts: readonly HtmlBranchRenderFact[]
  ): Promise<Readonly<DerivedBranchHtmlArtifact>>;
}

function optionsData(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new DerivedHtmlBranchPreparationError('derived-branch-html-options-invalid');
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor))
      throw new DerivedHtmlBranchPreparationError('derived-branch-html-options-invalid');
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function snapshotOptions(value: DerivedHtmlBranchPresentationOptions | undefined) {
  try {
    const data = value === undefined ? {} : optionsData(value);
    if (Object.keys(data).some(key => key !== 'limits' && key !== 'maxBranches'))
      throw new DerivedHtmlBranchPreparationError('derived-branch-html-options-invalid');
    const maxBranches =
      data.maxBranches === undefined ? HTML_BRANCH_SESSION_MAX_LEAVES : data.maxBranches;
    if (
      !Number.isSafeInteger(maxBranches) ||
      (maxBranches as number) < 1 ||
      (maxBranches as number) > HTML_BRANCH_SESSION_MAX_LEAVES
    )
      throw new HtmlPresentationError('html-limits-invalid');
    const limits = resolveLimits(data.limits === undefined ? undefined : optionsData(data.limits));
    // B2 artifacts have a narrower output ceiling than the pure B1 renderer.
    limits.maxHtmlChars = Math.min(limits.maxHtmlChars, DERIVED_HTML_MAX_BYTES);
    limits.maxHtmlBytes = Math.min(limits.maxHtmlBytes, DERIVED_HTML_MAX_BYTES);
    return Object.freeze({ limits: Object.freeze(limits), maxBranches: maxBranches as number });
  } catch (error) {
    if (
      error instanceof HtmlPresentationError ||
      error instanceof DerivedHtmlBranchPreparationError
    )
      throw error;
    throw new DerivedHtmlBranchPreparationError('derived-branch-html-options-invalid');
  }
}

function safeError(
  error: unknown,
  fallback: 'derived-branch-html-session-failed' | 'derived-branch-html-render-failed'
): Error {
  if (
    error instanceof HtmlPresentationError ||
    error instanceof DerivedBranchPresentationError ||
    error instanceof DerivedHtmlBranchPreparationError
  )
    return error;
  if (error instanceof DerivedHtmlPreparationError) {
    const codes = {
      'derived-html-context-invalid': 'derived-branch-html-context-invalid',
      'derived-html-canonical-serialization-failed':
        'derived-branch-html-canonical-serialization-failed',
      'derived-html-canonical-length-mismatch': 'derived-branch-html-canonical-length-mismatch',
      'derived-html-canonical-hash-failed': 'derived-branch-html-canonical-hash-failed',
      'derived-html-canonical-hash-mismatch': 'derived-branch-html-canonical-hash-mismatch',
      'derived-html-render-failed': 'derived-branch-html-render-failed',
      'derived-html-render-provenance-mismatch': 'derived-branch-html-render-provenance-mismatch',
    } as const;
    return new DerivedHtmlBranchPreparationError(codes[error.code]);
  }
  return new DerivedHtmlBranchPreparationError(fallback);
}

async function buildArtifact(
  presentation: { html: string; canonicalSha256: string; assetBindingSha256: string | null },
  target: DerivedBranchHtmlTarget,
  provenance: DerivedHtmlProvenance
): Promise<Readonly<DerivedBranchHtmlArtifact>> {
  if (
    presentation.canonicalSha256 !== provenance.sourceCanonicalSha256 ||
    presentation.assetBindingSha256 !== provenance.assetBindingSha256
  )
    throw new DerivedHtmlBranchPreparationError('derived-branch-html-render-provenance-mismatch');
  return Object.freeze(
    await buildDerivedBranchHtmlArtifact(presentation.html, target, provenance, sha256Hex)
  );
}

function artifactSession(
  session: HtmlBranchSession,
  provenance: DerivedHtmlProvenance
): DerivedHtmlBranchPresentationSession {
  return Object.freeze({
    branches: session.branches,
    branchCount: session.branchCount,
    branchPointCount: session.branchPointCount,
    async buildLeaf(ordinal: number) {
      try {
        const { presentation, fact } = session.renderLeaf(ordinal);
        const artifact = await buildArtifact(presentation, { role: 'leaf', ordinal }, provenance);
        // B1 facts are detached, deeply frozen, identity-bound capabilities. Never clone them.
        return Object.freeze({ artifact, fact });
      } catch (error) {
        throw safeError(error, 'derived-branch-html-render-failed');
      }
    },
    async buildIndex(facts: readonly HtmlBranchRenderFact[]) {
      try {
        return await buildArtifact(session.renderIndex(facts), { role: 'index' }, provenance);
      } catch (error) {
        throw safeError(error, 'derived-branch-html-render-failed');
      }
    },
  });
}

/**
 * One canonical authorization, one B1 preparation; no automatic branch loop or HTML cache.
 * The public closure exposes only compact counts/capabilities. Archive message bodies remain
 * closure-private and MUST NOT mutate while preparation is pending or during session lifetime.
 * Each build renders synchronously, then awaits only its already-materialized HTML hash.
 * Persistence, aggregate work/write budgets, cancellation and completion belong to B3.
 */
export async function prepareDerivedHtmlBranchPresentationSession(
  baseContext: StructuredArchivePresentationContext,
  assetBindings?: HtmlAssetBindingSet,
  options?: DerivedHtmlBranchPresentationOptions
): Promise<DerivedHtmlBranchPresentationSession> {
  try {
    const settings = snapshotOptions(options);
    const { context, canonicalSha256, assetBindingSha256 } = await authorizeDerivedHtmlContext(
      baseContext,
      assetBindings,
      'archive',
      settings.limits
    );
    const session = prepareArchiveHtmlBranchSession({
      archive: context.archive,
      canonicalSha256,
      profile: { includeToolContent: context.includeToolContent },
      limits: settings.limits,
      maxBranches: settings.maxBranches,
      ...(assetBindings === undefined ? {} : { assetBindings }),
    });
    return artifactSession(
      session,
      Object.freeze({ sourceCanonicalSha256: canonicalSha256, assetBindingSha256 })
    );
  } catch (error) {
    throw safeError(error, 'derived-branch-html-session-failed');
  }
}
