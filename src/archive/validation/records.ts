import type { AssetReference } from './blocks';
import type { ArchiveValidationIssue, UnknownRecord } from './contracts';
import {
  addIssue,
  expectExactObject,
  hasOwn,
  isNonEmptyString,
  isPlainObject,
  pointerSegment,
  validateExtensions,
  validateHash,
  validateMetadata,
  validateNullableString,
  validateSourceReferences,
  validateTimestamp,
} from './shared';

const ASSET_STATES = new Set(['fetched', 'unavailable', 'declined', 'expired', 'failed']);

const INPUT_FIELDS = [
  'captureId',
  'manifestSha256',
  'normalizer',
  'capturedAt',
  'sourceRefs',
  'extensions',
];

const CONVERSATION_FIELDS = [
  'id',
  'title',
  'provider',
  'url',
  'currentNodeId',
  'createdAt',
  'updatedAt',
  'metadata',
  'sourceRefs',
  'extensions',
];

const ASSET_FIELDS = [
  'id',
  'filename',
  'mimeType',
  'byteLength',
  'dimensions',
  'sha256',
  'localArtifactRef',
  'acquisition',
  'sourceRefs',
  'extensions',
];

export function validateInputs(value: unknown, issues: ArchiveValidationIssue[]): void {
  if (!Array.isArray(value)) {
    addIssue(issues, 'error', 'inputs-not-array', '/inputs', 'Inputs must be an array.');
    return;
  }
  value.forEach((input, index) => validateArchiveInput(input, `/inputs/${index}`, issues));
}

function validateArchiveInput(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  const input = expectExactObject(
    value,
    path,
    INPUT_FIELDS,
    INPUT_FIELDS,
    issues,
    'input-not-object'
  );
  if (!input) {
    return;
  }
  if (!isNonEmptyString(input.captureId)) {
    addIssue(
      issues,
      'error',
      'input-capture-id-invalid',
      `${path}/captureId`,
      'Capture ID must be non-empty.'
    );
  }
  validateHash(input.manifestSha256, `${path}/manifestSha256`, issues, false);
  if (!isNonEmptyString(input.normalizer)) {
    addIssue(
      issues,
      'error',
      'input-normalizer-invalid',
      `${path}/normalizer`,
      'Normalizer must be non-empty.'
    );
  }
  validateTimestamp(input.capturedAt, `${path}/capturedAt`, issues);
  validateSourceReferences(input.sourceRefs, `${path}/sourceRefs`, issues);
  validateExtensions(input.extensions, `${path}/extensions`, issues);
}

export function validateConversation(
  value: unknown,
  issues: ArchiveValidationIssue[]
): UnknownRecord | null {
  const conversation = expectExactObject(
    value,
    '/conversation',
    CONVERSATION_FIELDS,
    CONVERSATION_FIELDS,
    issues,
    'conversation-not-object'
  );
  if (!conversation) {
    return null;
  }
  validateConversationId(conversation.id, issues);
  validateNullableString(conversation.title, '/conversation/title', issues);
  validateConversationProvider(conversation.provider, issues);
  validateConversationUrl(conversation.url, issues);
  validateNullableString(conversation.currentNodeId, '/conversation/currentNodeId', issues);
  validateTimestamp(conversation.createdAt, '/conversation/createdAt', issues);
  validateTimestamp(conversation.updatedAt, '/conversation/updatedAt', issues);
  validateMetadata(conversation.metadata, '/conversation/metadata', issues);
  validateSourceReferences(conversation.sourceRefs, '/conversation/sourceRefs', issues);
  validateExtensions(conversation.extensions, '/conversation/extensions', issues);
  return conversation;
}

function validateConversationId(value: unknown, issues: ArchiveValidationIssue[]): void {
  if (!isNonEmptyString(value)) {
    addIssue(
      issues,
      'error',
      'conversation-id-invalid',
      '/conversation/id',
      'Conversation ID must be non-empty.'
    );
  }
}

function validateConversationProvider(value: unknown, issues: ArchiveValidationIssue[]): void {
  if (!isNonEmptyString(value)) {
    addIssue(
      issues,
      'error',
      'conversation-provider-invalid',
      '/conversation/provider',
      'Provider must be non-empty.'
    );
  }
}

function validateConversationUrl(value: unknown, issues: ArchiveValidationIssue[]): void {
  if (value === null) {
    return;
  }
  if (typeof value !== 'string') {
    validateNullableString(value, '/conversation/url', issues);
    return;
  }
  try {
    new URL(value);
  } catch {
    addIssue(
      issues,
      'error',
      'uri-invalid',
      '/conversation/url',
      'URL must be a valid absolute URI or null.'
    );
  }
}

export function validateAssets(
  value: unknown,
  assetReferences: AssetReference[],
  issues: ArchiveValidationIssue[]
): void {
  if (!isPlainObject(value)) {
    addIssue(issues, 'error', 'assets-not-object', '/assets', 'Assets must be a plain object map.');
    return;
  }
  Object.keys(value).forEach(key =>
    validateAsset(key, value[key], `/assets/${pointerSegment(key)}`, issues)
  );
  validateAssetReferences(value, assetReferences, issues);
}

function validateAssetReferences(
  assets: UnknownRecord,
  assetReferences: AssetReference[],
  issues: ArchiveValidationIssue[]
): void {
  assetReferences.forEach(({ assetId, path }) => {
    if (!isNonEmptyString(assetId)) {
      return;
    }
    if (!hasOwn(assets, assetId)) {
      addIssue(
        issues,
        'error',
        'attachment-asset-reference-missing',
        path,
        'Attachment refers to an asset that is not present in the asset map.'
      );
    }
  });
}

function validateAsset(
  key: string,
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  const asset = expectExactObject(
    value,
    path,
    ASSET_FIELDS,
    ASSET_FIELDS,
    issues,
    'asset-not-object'
  );
  if (!asset) {
    return;
  }
  validateAssetIdentity(asset, key, path, issues);
  validateAssetMetadata(asset, path, issues);
  validateAssetDimensions(asset.dimensions, path, issues);
  validateHash(asset.sha256, `${path}/sha256`, issues, true);
  validateAcquisition(asset.acquisition, path, issues);
  validateSourceReferences(asset.sourceRefs, `${path}/sourceRefs`, issues);
  validateExtensions(asset.extensions, `${path}/extensions`, issues);
}

function validateAssetIdentity(
  asset: UnknownRecord,
  key: string,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isNonEmptyString(asset.id)) {
    addIssue(issues, 'error', 'asset-id-invalid', `${path}/id`, 'Asset ID must be non-empty.');
  } else if (asset.id !== key) {
    addIssue(
      issues,
      'error',
      'asset-key-id-mismatch',
      `${path}/id`,
      'Asset map key must equal asset ID.'
    );
  }
}

function validateAssetMetadata(
  asset: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  ['filename', 'mimeType', 'localArtifactRef'].forEach(field => {
    validateNullableString(asset[field], `${path}/${field}`, issues);
  });
  if (
    asset.byteLength !== null &&
    (typeof asset.byteLength !== 'number' ||
      !Number.isFinite(asset.byteLength) ||
      asset.byteLength < 0)
  ) {
    addIssue(
      issues,
      'error',
      'asset-byte-length-invalid',
      `${path}/byteLength`,
      'Byte length must be a finite non-negative number or null.'
    );
  }
}

function validateAssetDimensions(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (value === null) {
    return;
  }
  const dimensions = expectExactObject(
    value,
    `${path}/dimensions`,
    ['width', 'height'],
    ['width', 'height'],
    issues,
    'asset-dimensions-invalid'
  );
  if (dimensions) {
    validateDimension(dimensions.width, 'width', path, issues);
    validateDimension(dimensions.height, 'height', path, issues);
  }
}

function validateDimension(
  value: unknown,
  name: string,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    addIssue(
      issues,
      'error',
      'asset-dimension-invalid',
      `${path}/dimensions/${name}`,
      'Dimensions must be finite non-negative numbers.'
    );
  }
}

function validateAcquisition(value: unknown, path: string, issues: ArchiveValidationIssue[]): void {
  const acquisition = expectExactObject(
    value,
    `${path}/acquisition`,
    ['state', 'attemptedAt', 'detail'],
    ['state', 'attemptedAt', 'detail'],
    issues,
    'asset-acquisition-invalid'
  );
  if (!acquisition) {
    return;
  }
  if (typeof acquisition.state !== 'string' || !ASSET_STATES.has(acquisition.state)) {
    addIssue(
      issues,
      'error',
      'asset-acquisition-state-invalid',
      `${path}/acquisition/state`,
      'Asset acquisition state must be explicit and recognised.'
    );
  }
  validateTimestamp(acquisition.attemptedAt, `${path}/acquisition/attemptedAt`, issues);
  validateNullableString(acquisition.detail, `${path}/acquisition/detail`, issues);
}

export function validateDiagnostics(value: unknown, issues: ArchiveValidationIssue[]): void {
  const diagnostics = expectExactObject(
    value,
    '/diagnostics',
    ['entries', 'extensions'],
    ['entries', 'extensions'],
    issues,
    'diagnostics-not-object'
  );
  if (!diagnostics) {
    return;
  }
  if (!Array.isArray(diagnostics.entries)) {
    addIssue(
      issues,
      'error',
      'diagnostic-entries-not-array',
      '/diagnostics/entries',
      'Diagnostic entries must be an array.'
    );
  } else {
    diagnostics.entries.forEach((entry, index) => {
      validateDiagnostic(entry, `/diagnostics/entries/${index}`, issues);
    });
  }
  validateExtensions(diagnostics.extensions, '/diagnostics/extensions', issues);
}

function validateDiagnostic(value: unknown, path: string, issues: ArchiveValidationIssue[]): void {
  const fields = ['severity', 'code', 'message', 'path', 'sourceRefs', 'extensions'];
  const diagnostic = expectExactObject(
    value,
    path,
    fields,
    fields,
    issues,
    'diagnostic-not-object'
  );
  if (!diagnostic) {
    return;
  }
  validateDiagnosticIdentity(diagnostic, path, issues);
  validateNullableString(diagnostic.path, `${path}/path`, issues);
  validateSourceReferences(diagnostic.sourceRefs, `${path}/sourceRefs`, issues);
  validateExtensions(diagnostic.extensions, `${path}/extensions`, issues);
}

function validateDiagnosticIdentity(
  diagnostic: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!['info', 'warning', 'error'].includes(diagnostic.severity as string)) {
    addIssue(
      issues,
      'error',
      'diagnostic-severity-invalid',
      `${path}/severity`,
      'Diagnostic severity must be info, warning, or error.'
    );
  }
  if (!isNonEmptyString(diagnostic.code)) {
    addIssue(
      issues,
      'error',
      'diagnostic-code-invalid',
      `${path}/code`,
      'Diagnostic code must be non-empty.'
    );
  }
  if (!isNonEmptyString(diagnostic.message)) {
    addIssue(
      issues,
      'error',
      'diagnostic-message-invalid',
      `${path}/message`,
      'Diagnostic message must be non-empty.'
    );
  }
}
