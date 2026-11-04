import {
  LISKA_PRESENTATION_SELECTION_SCHEMA,
  LISKA_READING_PROFILE_SCHEMA,
  LISKA_TEXT_PREVIEW_SCHEMA,
  TEXT_PREVIEW_LIMITS,
  TextPresentationError,
  type ArchiveTextPreview,
  type TextPresentationErrorCode,
  type TextPresentationSelection,
  type TextPreviewLimits,
  type TextPreviewRow,
  type TextReadingProfile,
} from './text-contracts';

const SHA256 = /^[a-f0-9]{64}$/;
const adoptedPreviews = new WeakSet<ArchiveTextPreview>();

function fail(code: TextPresentationErrorCode): never {
  throw new TextPresentationError(code);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function guarded<T>(action: () => T, fallback: TextPresentationErrorCode): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof TextPresentationError) throw error;
    fail(fallback);
  }
}

/** Read data descriptors only. Unknown fields, symbols and accessors are rejected. */
function dataRecord(
  value: unknown,
  keys: readonly string[],
  code: TextPresentationErrorCode,
  partial = false
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > keys.length) fail(code);
  const result: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !keys.includes(key)) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) fail(code);
    result[key] = descriptor.value;
  }
  if (!partial && keys.some(key => !hasOwn(result, key))) fail(code);
  return result;
}

function dataArray(value: unknown, maxLength: number, code: TextPresentationErrorCode): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  if (value.length > maxLength) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail(code);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) fail(code);
    result.push(descriptor.value);
  }
  return result;
}

function readingProfile(value: unknown): TextReadingProfile {
  const profile = dataRecord(value, ['schema', 'includeToolContent'], 'text-profile-invalid');
  if (
    profile.schema !== LISKA_READING_PROFILE_SCHEMA ||
    typeof profile.includeToolContent !== 'boolean'
  )
    fail('text-profile-invalid');
  return Object.freeze({
    schema: LISKA_READING_PROFILE_SCHEMA,
    includeToolContent: profile.includeToolContent,
  });
}

/** @internal Shared by canonical preparation and bounded wire adoption. */
export function resolveTextPreviewLimits(value: unknown): TextPreviewLimits {
  return guarded(() => {
    const limits: TextPreviewLimits = { ...TEXT_PREVIEW_LIMITS };
    if (value === undefined) return limits;
    const fields = dataRecord(value, Object.keys(limits), 'text-preview-limits-invalid', true);
    for (const key of Object.keys(fields) as (keyof TextPreviewLimits)[]) {
      const number = fields[key];
      if (
        !Number.isSafeInteger(number) ||
        (number as number) <= 0 ||
        (number as number) > limits[key]
      )
        fail('text-preview-limits-invalid');
      limits[key] = number as number;
    }
    return limits;
  }, 'text-preview-limits-invalid');
}

/** @internal No structural cast can introduce unvalidated rows into selection APIs. */
export function requireArchiveTextPreview(value: ArchiveTextPreview): void {
  if (!adoptedPreviews.has(value)) fail('text-preview-invalid');
}

function previewRow(value: unknown, limits: TextPreviewLimits): TextPreviewRow {
  const row = dataRecord(value, ['nodeId', 'role', 'presentedText'], 'text-preview-invalid');
  if (
    typeof row.nodeId !== 'string' ||
    row.nodeId.length === 0 ||
    (row.role !== 'user' && row.role !== 'assistant') ||
    typeof row.presentedText !== 'string'
  )
    fail('text-preview-invalid');
  if (row.presentedText.length > limits.maxRowChars) fail('text-preview-row-char-limit');
  return Object.freeze({ nodeId: row.nodeId, role: row.role, presentedText: row.presentedText });
}

function previewTitle(value: unknown, limits: TextPreviewLimits): string | null {
  if (value !== null && typeof value !== 'string') fail('text-preview-invalid');
  if (value !== null && value.length > limits.maxTitleChars) fail('text-preview-title-char-limit');
  return value;
}

/**
 * Adopt a wire copy, not canonical authority. The sender/session must establish
 * its origin. This only proves bounded shape and takes detached frozen ownership.
 */
export function adoptArchiveTextPreview(
  value: unknown,
  limitOverrides?: Partial<TextPreviewLimits>
): ArchiveTextPreview {
  return guarded(() => {
    const limits = resolveTextPreviewLimits(limitOverrides);
    const input = dataRecord(
      value,
      ['schema', 'sourceCanonicalSha256', 'branchTargetNodeId', 'title', 'profile', 'rows'],
      'text-preview-invalid'
    );
    if (input.schema !== LISKA_TEXT_PREVIEW_SCHEMA) fail('text-preview-invalid');
    if (
      typeof input.sourceCanonicalSha256 !== 'string' ||
      !SHA256.test(input.sourceCanonicalSha256)
    )
      fail('text-canonical-digest-invalid');
    if (typeof input.branchTargetNodeId !== 'string' || input.branchTargetNodeId.length === 0)
      fail('text-target-invalid');
    const title = previewTitle(input.title, limits);
    const profile = readingProfile(input.profile);
    const rows = dataArray(input.rows, limits.maxRows, 'text-preview-row-limit').map(row =>
      previewRow(row, limits)
    );
    const seen = new Set<string>();
    // IDs and provenance also count: a tiny body cannot smuggle unbounded wire metadata.
    let chars =
      input.branchTargetNodeId.length + input.sourceCanonicalSha256.length + (title?.length ?? 0);
    for (const row of rows) {
      if (seen.has(row.nodeId)) fail('text-preview-invalid');
      seen.add(row.nodeId);
      chars += row.nodeId.length + row.presentedText.length;
      if (chars > limits.maxTotalChars) fail('text-preview-total-char-limit');
    }
    if (chars > limits.maxTotalChars) fail('text-preview-total-char-limit');
    const preview: ArchiveTextPreview = Object.freeze({
      schema: LISKA_TEXT_PREVIEW_SCHEMA,
      sourceCanonicalSha256: input.sourceCanonicalSha256,
      branchTargetNodeId: input.branchTargetNodeId,
      title,
      profile,
      rows: Object.freeze(rows),
    });
    adoptedPreviews.add(preview);
    return preview;
  }, 'text-preview-invalid');
}

function selectionIds(preview: ArchiveTextPreview, value: unknown): readonly string[] {
  const ids = dataArray(value, preview.rows.length, 'text-selection-invalid');
  if (ids.length === 0) fail('text-selection-empty');
  const positions = new Map(preview.rows.map((row, index) => [row.nodeId, index]));
  const seen = new Set<string>();
  let previous = -1;
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id) || !positions.has(id))
      fail('text-selection-node-invalid');
    const position = positions.get(id)!;
    if (position <= previous) fail('text-selection-order-invalid');
    previous = position;
    seen.add(id);
    result.push(id);
  }
  return Object.freeze(result);
}

/** Validate binding, eligibility and branch order, then take immutable ownership. */
export function snapshotTextPresentationSelection(
  preview: ArchiveTextPreview,
  value: unknown
): TextPresentationSelection {
  return guarded(() => {
    requireArchiveTextPreview(preview);
    const input = dataRecord(
      value,
      ['schema', 'sourceCanonicalSha256', 'branchTargetNodeId', 'profile', 'messageNodeIds'],
      'text-selection-invalid'
    );
    if (input.schema !== LISKA_PRESENTATION_SELECTION_SCHEMA) fail('text-selection-invalid');
    if (
      typeof input.sourceCanonicalSha256 !== 'string' ||
      !SHA256.test(input.sourceCanonicalSha256)
    )
      fail('text-canonical-digest-invalid');
    const profile = readingProfile(input.profile);
    if (
      input.sourceCanonicalSha256 !== preview.sourceCanonicalSha256 ||
      input.branchTargetNodeId !== preview.branchTargetNodeId ||
      profile.includeToolContent !== preview.profile.includeToolContent
    )
      fail('text-selection-binding-mismatch');
    return Object.freeze({
      schema: LISKA_PRESENTATION_SELECTION_SCHEMA,
      sourceCanonicalSha256: preview.sourceCanonicalSha256,
      branchTargetNodeId: preview.branchTargetNodeId,
      profile,
      messageNodeIds: selectionIds(preview, input.messageNodeIds),
    });
  }, 'text-selection-invalid');
}

export function createTextPresentationSelection(
  preview: ArchiveTextPreview,
  messageNodeIds: readonly string[]
): TextPresentationSelection {
  requireArchiveTextPreview(preview);
  return snapshotTextPresentationSelection(preview, {
    schema: LISKA_PRESENTATION_SELECTION_SCHEMA,
    sourceCanonicalSha256: preview.sourceCanonicalSha256,
    branchTargetNodeId: preview.branchTargetNodeId,
    profile: preview.profile,
    messageNodeIds,
  });
}

export function resolveTextPresentationSelection(
  preview: ArchiveTextPreview,
  value: unknown
): readonly TextPreviewRow[] {
  const selection = snapshotTextPresentationSelection(preview, value);
  const ids = new Set(selection.messageNodeIds);
  return Object.freeze(preview.rows.filter(row => ids.has(row.nodeId)));
}

/** Inclusive 1-based ordinals refer to complete preview order, never search order. */
export function resolveTextPreviewRange(
  preview: ArchiveTextPreview,
  startOrdinal: number,
  endOrdinal: number
): readonly string[] {
  requireArchiveTextPreview(preview);
  if (
    !Number.isSafeInteger(startOrdinal) ||
    !Number.isSafeInteger(endOrdinal) ||
    startOrdinal < 1 ||
    endOrdinal < startOrdinal ||
    endOrdinal > preview.rows.length
  )
    fail('text-range-invalid');
  return Object.freeze(preview.rows.slice(startOrdinal - 1, endOrdinal).map(row => row.nodeId));
}
