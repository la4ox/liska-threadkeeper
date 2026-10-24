/** Closed branch names and pure transport contracts; current-branch v1 stays unchanged. */
import {
  HTML_BRANCH_MAX_ORDINAL,
  htmlBranchRelativePath,
  snapshotHtmlBranchTarget,
  type HtmlBranchTarget,
  type HtmlBranchRelativePath,
} from '../archive/presentation/branch-paths';
import {
  DERIVED_HTML_RELATIVE_PATH,
  DERIVED_HTML_SCHEMA,
  DERIVED_OUTPUT_RECEIPT_SCHEMA,
  DerivedPresentationError,
  buildDerivedHtmlArtifact,
  buildDerivedOutputReceipt,
  snapshotDerivedHtmlArtifact,
  snapshotDerivedOutputReceipt,
  verifyDerivedHtmlArtifact,
  type DerivedHtmlArtifact,
  type DerivedHtmlDescriptor,
  type DerivedHtmlProvenance,
  type DerivedOutputIdentity,
  type DerivedOutputReceipt,
  type DerivedPresentationSha256,
} from './derived-presentation-contract';

export const DERIVED_BRANCH_HTML_SCHEMA = 'liska-derived-branch-html/1';
export const DERIVED_BRANCH_OUTPUT_RECEIPT_SCHEMA = 'liska-derived-branch-output-receipt/1';
export const DERIVED_BRANCH_HTML_MAX_ORDINAL = HTML_BRANCH_MAX_ORDINAL;

export type DerivedBranchHtmlTarget = HtmlBranchTarget;
export type DerivedBranchHtmlRelativePath = HtmlBranchRelativePath;
export type DerivedBranchHtmlReceiptRelativePath =
  | `presentation/liska-html-1.branch-${string}.receipt.json`
  | 'presentation/liska-html-1.branches.receipt.json';

export type DerivedBranchHtmlDescriptor = Omit<DerivedHtmlDescriptor, 'relativePath'> &
  DerivedBranchHtmlTarget & { relativePath: DerivedBranchHtmlRelativePath };

export type DerivedBranchHtmlArtifact = DerivedBranchHtmlDescriptor &
  DerivedHtmlProvenance & {
    schema: typeof DERIVED_BRANCH_HTML_SCHEMA;
    transport: 'inline';
    bodyBase64: string;
  };

export interface DerivedBranchOutputReceipt extends DerivedOutputIdentity, DerivedHtmlProvenance {
  schema: typeof DERIVED_BRANCH_OUTPUT_RECEIPT_SCHEMA;
  artifact: DerivedBranchHtmlDescriptor;
}

export type DerivedBranchPresentationErrorCode =
  | 'derived-branch-html-invalid-target'
  | 'derived-branch-html-invalid-input'
  | 'derived-branch-html-too-large'
  | 'derived-branch-html-encoding-failed'
  | 'derived-branch-html-hash-failed'
  | 'derived-branch-html-invalid-hash'
  | 'derived-branch-receipt-invalid-input'
  | 'derived-branch-receipt-encoding-failed';

/** Input values and native exception details never enter an error. */
export class DerivedBranchPresentationError extends Error {
  constructor(readonly code: DerivedBranchPresentationErrorCode) {
    super(code);
    this.name = 'DerivedBranchPresentationError';
  }
}

const DESCRIPTOR_KEYS = [
  'kind',
  'relativePath',
  'mediaType',
  'byteLength',
  'sha256',
  'rendererVersion',
];
const ARTIFACT_KEYS = [
  'schema',
  'transport',
  ...DESCRIPTOR_KEYS,
  'sourceCanonicalSha256',
  'assetBindingSha256',
  'bodyBase64',
];
const RECEIPT_KEYS = [
  'schema',
  'source',
  'captureId',
  'conversationKey',
  'sourceCanonicalSha256',
  'assetBindingSha256',
  'artifact',
];

/** Read own enumerable data only, then reconstruct; never retain caller objects. */
function ownPlainData(value: unknown, expected: readonly string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some(key => typeof key !== 'string' || !expected.includes(key))
  )
    return undefined;
  const data: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    data[key] = descriptor.value;
  }
  return data;
}

function ownBranchData(value: unknown, commonKeys: readonly string[]) {
  const leaf = ownPlainData(value, [...commonKeys, 'role', 'ordinal']);
  if (leaf) {
    const target = snapshotHtmlBranchTarget({ role: leaf.role, ordinal: leaf.ordinal });
    return target?.role === 'leaf' ? { data: leaf, target } : undefined;
  }
  const index = ownPlainData(value, [...commonKeys, 'role']);
  if (!index || index.role !== 'index') return undefined;
  return { data: index, target: { role: 'index' } as const };
}

export const snapshotDerivedBranchHtmlTarget = snapshotHtmlBranchTarget;

function requireTarget(value: unknown): DerivedBranchHtmlTarget {
  const target = snapshotDerivedBranchHtmlTarget(value);
  if (!target) throw new DerivedBranchPresentationError('derived-branch-html-invalid-target');
  return target;
}

/** No caller-provided path is accepted, even if it would otherwise look safe. */
export function deriveBranchHtmlRelativePath(
  value: DerivedBranchHtmlTarget
): DerivedBranchHtmlRelativePath {
  return htmlBranchRelativePath(requireTarget(value))!;
}

export function deriveBranchHtmlReceiptRelativePath(
  value: DerivedBranchHtmlTarget
): DerivedBranchHtmlReceiptRelativePath {
  const stem = deriveBranchHtmlRelativePath(value).slice(0, -5);
  return `presentation/liska-html-1.${stem}.receipt.json` as DerivedBranchHtmlReceiptRelativePath;
}

function currentDescriptor(data: Record<string, unknown> | DerivedBranchHtmlDescriptor) {
  return {
    kind: data.kind,
    relativePath: DERIVED_HTML_RELATIVE_PATH,
    mediaType: data.mediaType,
    byteLength: data.byteLength,
    sha256: data.sha256,
    rendererVersion: data.rendererVersion,
  };
}

function currentArtifact(data: Record<string, unknown> | DerivedBranchHtmlArtifact) {
  return {
    schema: DERIVED_HTML_SCHEMA,
    transport: data.transport,
    ...currentDescriptor(data),
    sourceCanonicalSha256: data.sourceCanonicalSha256,
    assetBindingSha256: data.assetBindingSha256,
    bodyBase64: data.bodyBase64,
  };
}

function branchDescriptor(
  descriptor: DerivedHtmlDescriptor,
  target: DerivedBranchHtmlTarget
): DerivedBranchHtmlDescriptor {
  return {
    ...target,
    kind: descriptor.kind,
    relativePath: deriveBranchHtmlRelativePath(target),
    mediaType: descriptor.mediaType,
    byteLength: descriptor.byteLength,
    sha256: descriptor.sha256,
    rendererVersion: descriptor.rendererVersion,
  };
}

function artifactTarget(artifact: DerivedBranchHtmlArtifact): DerivedBranchHtmlTarget {
  return artifact.role === 'leaf' ? { role: 'leaf', ordinal: artifact.ordinal } : { role: 'index' };
}

function branchArtifact(
  artifact: DerivedHtmlArtifact,
  target: DerivedBranchHtmlTarget
): DerivedBranchHtmlArtifact {
  return {
    schema: DERIVED_BRANCH_HTML_SCHEMA,
    transport: artifact.transport,
    ...branchDescriptor(artifact, target),
    sourceCanonicalSha256: artifact.sourceCanonicalSha256,
    assetBindingSha256: artifact.assetBindingSha256,
    bodyBase64: artifact.bodyBase64,
  };
}

/** Shape-only validation reuses v1's bounded canonical-base64 and provenance rules. */
export function snapshotDerivedBranchHtmlArtifact(
  value: unknown
): DerivedBranchHtmlArtifact | undefined {
  try {
    const branch = ownBranchData(value, ARTIFACT_KEYS);
    if (
      !branch ||
      branch.data.schema !== DERIVED_BRANCH_HTML_SCHEMA ||
      branch.data.relativePath !== deriveBranchHtmlRelativePath(branch.target)
    )
      return undefined;
    const artifact = snapshotDerivedHtmlArtifact(currentArtifact(branch.data));
    return artifact && branchArtifact(artifact, branch.target);
  } catch {
    return undefined;
  }
}

export function isDerivedBranchHtmlArtifact(value: unknown): value is DerivedBranchHtmlArtifact {
  return snapshotDerivedBranchHtmlArtifact(value) !== undefined;
}

function htmlBuildError(error: unknown): DerivedBranchPresentationError {
  if (error instanceof DerivedPresentationError) {
    const codes = {
      'derived-html-too-large': 'derived-branch-html-too-large',
      'derived-html-encoding-failed': 'derived-branch-html-encoding-failed',
      'derived-html-hash-failed': 'derived-branch-html-hash-failed',
      'derived-html-invalid-hash': 'derived-branch-html-invalid-hash',
    } as const;
    if (error.code in codes)
      return new DerivedBranchPresentationError(codes[error.code as keyof typeof codes]);
  }
  return new DerivedBranchPresentationError('derived-branch-html-invalid-input');
}

export async function buildDerivedBranchHtmlArtifact(
  html: string,
  value: DerivedBranchHtmlTarget,
  provenance: DerivedHtmlProvenance,
  sha256: DerivedPresentationSha256
): Promise<DerivedBranchHtmlArtifact> {
  const target = requireTarget(value);
  let artifact: DerivedHtmlArtifact;
  try {
    artifact = await buildDerivedHtmlArtifact(html, provenance, sha256);
  } catch (error) {
    throw htmlBuildError(error);
  }
  return branchArtifact(artifact, target);
}

/** Proves bytes/hash/UTF-8; canonical and asset digests still require trusted external context. */
export async function verifyDerivedBranchHtmlArtifact(
  value: unknown,
  sha256: DerivedPresentationSha256
): Promise<{ artifact: DerivedBranchHtmlArtifact; bytes: Uint8Array } | undefined> {
  const artifact = snapshotDerivedBranchHtmlArtifact(value);
  if (!artifact) return undefined;
  const verified = await verifyDerivedHtmlArtifact(currentArtifact(artifact), sha256);
  return (
    verified && {
      artifact: branchArtifact(verified.artifact, artifactTarget(artifact)),
      bytes: verified.bytes,
    }
  );
}

function branchReceipt(
  receipt: DerivedOutputReceipt,
  target: DerivedBranchHtmlTarget
): DerivedBranchOutputReceipt {
  return {
    schema: DERIVED_BRANCH_OUTPUT_RECEIPT_SCHEMA,
    source: receipt.source,
    captureId: receipt.captureId,
    conversationKey: receipt.conversationKey,
    sourceCanonicalSha256: receipt.sourceCanonicalSha256,
    assetBindingSha256: receipt.assetBindingSha256,
    artifact: branchDescriptor(receipt.artifact, target),
  };
}

export function snapshotDerivedBranchOutputReceipt(
  value: unknown
): DerivedBranchOutputReceipt | undefined {
  try {
    const data = ownPlainData(value, RECEIPT_KEYS);
    if (!data || data.schema !== DERIVED_BRANCH_OUTPUT_RECEIPT_SCHEMA) return undefined;
    const branch = ownBranchData(data.artifact, DESCRIPTOR_KEYS);
    if (!branch || branch.data.relativePath !== deriveBranchHtmlRelativePath(branch.target))
      return undefined;
    const receipt = snapshotDerivedOutputReceipt({
      ...data,
      schema: DERIVED_OUTPUT_RECEIPT_SCHEMA,
      artifact: currentDescriptor(branch.data),
    });
    return receipt && branchReceipt(receipt, branch.target);
  } catch {
    return undefined;
  }
}

export function isDerivedBranchOutputReceipt(value: unknown): value is DerivedBranchOutputReceipt {
  return snapshotDerivedBranchOutputReceipt(value) !== undefined;
}

export function buildDerivedBranchOutputReceipt(
  identity: DerivedOutputIdentity,
  value: DerivedBranchHtmlArtifact
): DerivedBranchOutputReceipt {
  try {
    const artifact = snapshotDerivedBranchHtmlArtifact(value);
    if (artifact) {
      const current = snapshotDerivedHtmlArtifact(currentArtifact(artifact));
      if (current)
        return branchReceipt(
          buildDerivedOutputReceipt(identity, current),
          artifactTarget(artifact)
        );
    }
  } catch {
    // Caller-owned traps and native failures use the same value-free error.
  }
  throw new DerivedBranchPresentationError('derived-branch-receipt-invalid-input');
}

/** Exact association only; callers separately verify the artifact bytes before writing. */
export function matchDerivedBranchOutputReceipt(
  value: unknown,
  expectedIdentity: DerivedOutputIdentity,
  artifact: unknown
): DerivedBranchOutputReceipt | undefined {
  const receipt = snapshotDerivedBranchOutputReceipt(value);
  const html = snapshotDerivedBranchHtmlArtifact(artifact);
  if (!receipt || !html) return undefined;
  try {
    const expected = buildDerivedBranchOutputReceipt(expectedIdentity, html);
    return JSON.stringify(receipt) === JSON.stringify(expected) ? receipt : undefined;
  } catch {
    return undefined;
  }
}

/** Stable key order and one trailing LF; receipts never contain a body or private labels. */
export function buildDerivedBranchOutputReceiptBytes(value: unknown): Uint8Array {
  const receipt = snapshotDerivedBranchOutputReceipt(value);
  if (!receipt) throw new DerivedBranchPresentationError('derived-branch-receipt-invalid-input');
  try {
    return new TextEncoder().encode(`${JSON.stringify(receipt)}\n`);
  } catch {
    throw new DerivedBranchPresentationError('derived-branch-receipt-encoding-failed');
  }
}
