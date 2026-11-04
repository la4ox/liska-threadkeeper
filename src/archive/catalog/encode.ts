import type { CaptureCompleteness, CaptureMethod } from '../capture';
import {
  CONVERSATION_KEY_VERSION,
  type CatalogAssetAggregate,
  type CatalogFileAggregate,
  type SnapshotCatalog,
  type SnapshotCatalogCode,
  type SnapshotCatalogEntry,
  type SnapshotCatalogLimits,
} from './contracts';
import { CATALOG_HEADER, entrySortKey } from './format';
import { arrayData, compare, errorCode, fail, fields, resolveLimits, sum } from './safe-input';

const aggregateFields = [
  'count',
  'declaredBytes',
  'presentCount',
  'presentBytes',
  'sizeMatchCount',
  'missingCount',
  'sizeMismatchCount',
];
const entryFields = [
  'manifestValidity',
  'manifestSha256',
  'manifestByteLength',
  'provider',
  'conversationId',
  'conversationKey',
  'captureId',
  'capturedAt',
  'method',
  'declaredCompleteness',
  'artifacts',
  'assets',
  'canonical',
  'associatedFileCount',
  'extraFileCount',
  'extraFileBytes',
  'issueCodes',
  'occurrenceCount',
];
const entryCodes = [
  'invalid-json',
  'duplicate-json-key',
  'unsafe-json-key',
  'manifest-invalid',
  'manifest-unsupported',
  'artifact-missing',
  'artifact-size-mismatch',
  'asset-missing',
  'asset-size-mismatch',
  'extra-files',
  'capture-identity-conflict',
];
const invalidCodes = ['invalid-json', 'duplicate-json-key', 'unsafe-json-key', 'manifest-invalid'];
const identityFields = [
  'provider',
  'conversationId',
  'conversationKey',
  'captureId',
  'capturedAt',
  'method',
];

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    fail('invalid-catalog');
  if (value > max) fail('limit-exceeded');
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value))
    fail('invalid-catalog');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('invalid-catalog');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    fail('invalid-catalog');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail('invalid-catalog');
  return value;
}

function aggregate(
  value: unknown,
  limits: SnapshotCatalogLimits,
  assets: boolean
): CatalogAssetAggregate | CatalogFileAggregate {
  const input = fields(
    value,
    assets ? [...aggregateFields, 'recordCount'] : aggregateFields,
    [],
    'invalid-catalog'
  );
  const output: Record<string, number> = {};
  for (const name of aggregateFields) {
    output[name] = integer(
      input[name],
      name.endsWith('Bytes') ? undefined : limits.maxRecordsPerManifest
    );
  }
  if (
    output.presentCount + output.missingCount !== output.count ||
    output.sizeMatchCount + output.sizeMismatchCount !== output.presentCount
  )
    fail('invalid-catalog');
  validateAggregateBytes(output);
  if (assets) {
    output.recordCount = integer(input.recordCount, limits.maxRecordsPerManifest);
    if (output.recordCount < output.count) fail('invalid-catalog');
  }
  return output as unknown as CatalogAssetAggregate | CatalogFileAggregate;
}

function validateAggregateBytes(output: Record<string, number>): void {
  if (
    (output.count === 0 && output.declaredBytes !== 0) ||
    (output.presentCount === 0 && output.presentBytes !== 0)
  )
    fail('invalid-catalog');
  if (
    output.sizeMismatchCount === 0 &&
    (output.presentBytes > output.declaredBytes ||
      (output.missingCount === 0 && output.presentBytes !== output.declaredBytes))
  )
    fail('invalid-catalog');
  // Matched siblings cannot offset one mismatch; missing declared bytes can.
  if (
    output.missingCount === 0 &&
    output.sizeMismatchCount === 1 &&
    output.presentBytes === output.declaredBytes
  )
    fail('invalid-catalog');
  // Each nonnegative-integer size mismatch spends at least one declared/present
  // byte. Subtract only when necessary; adding safe integers could overflow.
  if (
    output.declaredBytes < output.sizeMismatchCount &&
    output.presentBytes < output.sizeMismatchCount - output.declaredBytes
  )
    fail('invalid-catalog');
}

function completeness(value: unknown): CaptureCompleteness {
  const output = fields(value, ['graph', 'messages', 'branches', 'assets'], [], 'invalid-catalog');
  if (
    Object.values(output).some(
      state => !['complete', 'partial', 'unknown', 'not-attempted'].includes(state as string)
    )
  )
    fail('invalid-catalog');
  return output as unknown as CaptureCompleteness;
}

function canonical(value: unknown): SnapshotCatalogEntry['canonical'] {
  const input = fields(
    value,
    ['presence', 'byteLength', 'declaredFileRole'],
    [],
    'invalid-catalog'
  );
  if (
    input.declaredFileRole !== null &&
    !['artifact', 'asset'].includes(input.declaredFileRole as string)
  )
    fail('invalid-catalog');
  const declaredFileRole =
    input.declaredFileRole as SnapshotCatalogEntry['canonical']['declaredFileRole'];
  if (input.presence === 'absent' && input.byteLength === null)
    return { presence: 'absent', byteLength: null, declaredFileRole };
  if (input.presence !== 'present-unverified') fail('invalid-catalog');
  return {
    presence: 'present-unverified',
    byteLength: integer(input.byteLength),
    declaredFileRole,
  };
}

function issues(value: unknown): SnapshotCatalogCode[] {
  const codes = arrayData(value, entryCodes.length, 'invalid-catalog');
  if (codes.some(code => typeof code !== 'string' || !entryCodes.includes(code)))
    fail('invalid-catalog');
  if (new Set(codes).size !== codes.length) fail('invalid-catalog');
  return (codes as SnapshotCatalogCode[]).sort(compare);
}

function entry(value: unknown, limits: SnapshotCatalogLimits): SnapshotCatalogEntry {
  const input = fields(value, entryFields, [], 'invalid-catalog');
  if (!['valid', 'invalid', 'unsupported'].includes(input.manifestValidity as string))
    fail('invalid-catalog');
  const output = {
    manifestValidity: input.manifestValidity,
    manifestSha256: digest(input.manifestSha256),
    manifestByteLength: integer(input.manifestByteLength, limits.maxManifestBytes),
    provider: null,
    conversationId: null,
    conversationKey: null,
    captureId: null,
    capturedAt: null,
    method: null,
    declaredCompleteness: null,
    artifacts: null,
    assets: null,
    canonical: canonical(input.canonical),
    associatedFileCount: integer(input.associatedFileCount, limits.maxSelectedFiles),
    extraFileCount: integer(input.extraFileCount, limits.maxSelectedFiles),
    extraFileBytes: integer(input.extraFileBytes),
    issueCodes: issues(input.issueCodes),
    occurrenceCount: integer(input.occurrenceCount, limits.maxManifests),
  } as SnapshotCatalogEntry;
  if (output.occurrenceCount === 0 || (output.extraFileCount === 0 && output.extraFileBytes !== 0))
    fail('invalid-catalog');
  if (output.associatedFileCount < 1 + Number(output.canonical.presence === 'present-unverified'))
    fail('invalid-catalog');
  if (output.manifestValidity === 'valid') validEntry(input, output, limits);
  else invalidEntry(input, output);
  return output;
}

function validEntry(
  input: Record<string, unknown>,
  output: SnapshotCatalogEntry,
  limits: SnapshotCatalogLimits
): void {
  output.provider = identifier(input.provider);
  output.conversationId = identifier(input.conversationId);
  output.captureId = identifier(input.captureId);
  output.capturedAt = timestamp(input.capturedAt);
  if (!['same-origin-api', 'dom-derived', 'official-export'].includes(input.method as string))
    fail('invalid-catalog');
  output.method = input.method as CaptureMethod;
  const prefix = `${CONVERSATION_KEY_VERSION}:`;
  if (typeof input.conversationKey !== 'string' || !input.conversationKey.startsWith(prefix))
    fail('invalid-catalog');
  output.conversationKey = prefix + digest(input.conversationKey.slice(prefix.length));
  output.declaredCompleteness = completeness(input.declaredCompleteness);
  output.artifacts = aggregate(input.artifacts, limits, false);
  output.assets = aggregate(input.assets, limits, true) as CatalogAssetAggregate;
  if (output.artifacts.count + output.assets.recordCount > limits.maxRecordsPerManifest)
    fail('limit-exceeded');
  validateAssociatedFiles(output);
  const expected: SnapshotCatalogCode[] = [];
  if (output.artifacts.missingCount) expected.push('artifact-missing');
  if (output.artifacts.sizeMismatchCount) expected.push('artifact-size-mismatch');
  if (output.assets.missingCount) expected.push('asset-missing');
  if (output.assets.sizeMismatchCount) expected.push('asset-size-mismatch');
  if (output.extraFileCount) expected.push('extra-files');
  const actual = output.issueCodes.filter(code => code !== 'capture-identity-conflict');
  if (JSON.stringify(actual) !== JSON.stringify(expected.sort(compare))) fail('invalid-catalog');
}

function validateAssociatedFiles(entry: SnapshotCatalogEntry): void {
  const present = entry.canonical.presence === 'present-unverified';
  const role = entry.canonical.declaredFileRole;
  const overlap = role === 'artifact' ? entry.artifacts : role === 'asset' ? entry.assets : null;
  if (overlap) {
    if (present) {
      if (
        overlap.presentCount < 1 ||
        overlap.presentBytes < entry.canonical.byteLength! ||
        (overlap.presentCount === 1 && overlap.presentBytes !== entry.canonical.byteLength)
      )
        fail('invalid-catalog');
    } else if (overlap.missingCount < 1) fail('invalid-catalog');
  }
  const expected =
    1 +
    entry.artifacts!.presentCount +
    entry.assets!.presentCount +
    Number(present && role === null) +
    entry.extraFileCount;
  if (entry.associatedFileCount !== expected) fail('invalid-catalog');
}

function invalidEntry(input: Record<string, unknown>, output: SnapshotCatalogEntry): void {
  if (
    [...identityFields, 'declaredCompleteness', 'artifacts', 'assets'].some(
      key => input[key] !== null
    )
  )
    fail('invalid-catalog');
  if (output.extraFileCount !== 0 || output.extraFileBytes !== 0 || output.issueCodes.length !== 1)
    fail('invalid-catalog');
  if (output.canonical.declaredFileRole !== null) fail('invalid-catalog');
  const code = output.issueCodes[0];
  if (
    output.manifestValidity === 'unsupported'
      ? code !== 'manifest-unsupported'
      : !invalidCodes.includes(code)
  )
    fail('invalid-catalog');
}

function validateGroups(entries: SnapshotCatalogEntry[]): void {
  const identities = new Map<string, Set<string>>();
  const keys = new Map<string, string>();
  const keyOwners = new Map<string, string>();
  const seen = new Set<string>();
  for (const item of entries) {
    const duplicate = entrySortKey(item);
    if (seen.has(duplicate)) fail('invalid-catalog');
    seen.add(duplicate);
    if (item.manifestValidity !== 'valid') continue;
    const identity = JSON.stringify([item.provider, item.conversationId]);
    if (
      (keys.has(identity) && keys.get(identity) !== item.conversationKey) ||
      (keyOwners.has(item.conversationKey!) && keyOwners.get(item.conversationKey!) !== identity)
    )
      fail('invalid-catalog');
    keys.set(identity, item.conversationKey!);
    keyOwners.set(item.conversationKey!, identity);
    const capture = JSON.stringify([item.provider, item.conversationId, item.captureId]);
    const digests = identities.get(capture) ?? new Set<string>();
    digests.add(item.manifestSha256);
    identities.set(capture, digests);
  }
  for (const item of entries) {
    if (item.manifestValidity !== 'valid') continue;
    const capture = JSON.stringify([item.provider, item.conversationId, item.captureId]);
    if (identities.get(capture)!.size > 1 !== item.issueCodes.includes('capture-identity-conflict'))
      fail('invalid-catalog');
  }
}

function catalog(value: unknown, limits: SnapshotCatalogLimits): SnapshotCatalog {
  const constants = CATALOG_HEADER;
  const input = fields(
    value,
    [
      ...Object.keys(constants),
      'selectedFileCount',
      'selectedManifestCount',
      'unassociatedFileCount',
      'entries',
    ],
    [],
    'invalid-catalog'
  );
  for (const [key, expected] of Object.entries(constants))
    if (input[key] !== expected) fail('invalid-catalog');
  const output: SnapshotCatalog = {
    ...constants,
    selectedFileCount: integer(input.selectedFileCount, limits.maxSelectedFiles),
    selectedManifestCount: integer(input.selectedManifestCount, limits.maxManifests),
    unassociatedFileCount: integer(input.unassociatedFileCount, limits.maxSelectedFiles),
    entries: arrayData(input.entries, limits.maxManifests, 'invalid-catalog').map(value =>
      entry(value, limits)
    ),
  };
  let occurrences = 0;
  let manifestBytes = 0;
  let records = 0;
  let selectedFiles = output.unassociatedFileCount;
  for (const item of output.entries) {
    occurrences = sum(occurrences, item.occurrenceCount);
    manifestBytes = sum(manifestBytes, item.manifestByteLength * item.occurrenceCount);
    records = sum(
      records,
      ((item.artifacts?.count ?? 0) + (item.assets?.recordCount ?? 0)) * item.occurrenceCount
    );
    selectedFiles = sum(selectedFiles, item.associatedFileCount * item.occurrenceCount);
  }
  if (manifestBytes > limits.maxTotalManifestBytes || records > limits.maxTotalRecords)
    fail('limit-exceeded');
  if (occurrences !== output.selectedManifestCount || selectedFiles !== output.selectedFileCount)
    fail('invalid-catalog');
  validateGroups(output.entries);
  output.entries.sort((a, b) => compare(entrySortKey(a), entrySortKey(b)));
  return output;
}

/** Revalidates/rebuilds all fixed fields; never serializes caller-owned objects. */
export function encodeSnapshotCatalog(
  value: SnapshotCatalog,
  options?: Partial<SnapshotCatalogLimits>
): Uint8Array {
  try {
    const limits = resolveLimits(options);
    const checked = catalog(value, limits);
    const text = JSON.stringify(checked) + '\n';
    // UTF-8 cannot be shorter than UTF-16 code-unit length for this fixed schema.
    if (text.length > limits.maxOutputBytes) fail('limit-exceeded');
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > limits.maxOutputBytes) fail('limit-exceeded');
    return bytes;
  } catch (error) {
    fail(errorCode(error, 'invalid-catalog'));
  }
}
