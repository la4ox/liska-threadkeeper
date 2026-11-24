import type { ClaudeAccountCatalogAdmissionResult } from '../claude-baseline/account-admission-contracts';
import { snapshotClaudeAccountCatalogAdmission } from '../claude-baseline/account-admission-snapshot';
import { CLAUDE_BASELINE_HARD_LIMITS } from '../claude-baseline/contracts';
import { arrayData, fields, rejectionReason, resolveLimits } from '../claude-baseline/data';
import { ClaudeAccountBaselineOwnerError } from './errors';

export const CLAUDE_ACCOUNT_BASELINE_OWNER_SCHEMA = 'liska-claude-account-baseline-owner/1';
export const CLAUDE_ACCOUNT_BASELINE_OWNER_MAX_BYTES = 64 * 1024;
export const CLAUDE_ACCOUNT_COLLECTION_ID_PREFIX = 'claude-account-collection/1:';
const collectionIdPattern = /^claude-account-collection\/1:[a-f0-9]{32}$/u;
const baselineFields = [
  'schema',
  'collectionId',
  'admission',
  'phase',
  'revision',
  'items',
  'accountComplete',
  'executionAuthorized',
] as const;

export interface ClaudeAccountBaseline {
  readonly schema: typeof CLAUDE_ACCOUNT_BASELINE_OWNER_SCHEMA;
  readonly collectionId: string;
  readonly admission: Extract<ClaudeAccountCatalogAdmissionResult, { kind: 'admitted' }>;
  readonly phase: 'paused';
  readonly revision: 0;
  readonly items: readonly { readonly conversationId: string; readonly state: 'pending' }[];
  readonly accountComplete: false;
  readonly executionAuthorized: false;
}

function codecLimits(overrides: unknown) {
  const data =
    overrides === undefined
      ? {}
      : fields(overrides, [], ['maxBytes', 'admissionLimits'], CLAUDE_BASELINE_HARD_LIMITS);
  const maxBytes = 'maxBytes' in data ? data.maxBytes : CLAUDE_ACCOUNT_BASELINE_OWNER_MAX_BYTES;
  if (
    typeof maxBytes !== 'number' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > CLAUDE_ACCOUNT_BASELINE_OWNER_MAX_BYTES
  )
    throw new ClaudeAccountBaselineOwnerError('invalid-limits');
  return { maxBytes, admissionLimits: resolveLimits(data.admissionLimits) };
}

function ownerLimits(overrides: unknown) {
  try {
    return codecLimits(overrides);
  } catch {
    throw new ClaudeAccountBaselineOwnerError('invalid-limits');
  }
}

function baseline(
  collectionId: unknown,
  input: unknown,
  limits: ReturnType<typeof ownerLimits>
): ClaudeAccountBaseline {
  if (
    typeof collectionId !== 'string' ||
    collectionId.length !== CLAUDE_ACCOUNT_COLLECTION_ID_PREFIX.length + 32 ||
    !collectionIdPattern.test(collectionId)
  )
    throw new ClaudeAccountBaselineOwnerError('invalid-input');
  const admission = snapshotClaudeAccountCatalogAdmission(input, limits.admissionLimits);
  if (admission.kind !== 'admitted')
    throw new ClaudeAccountBaselineOwnerError(
      admission.reason === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-input'
    );
  return Object.freeze({
    schema: CLAUDE_ACCOUNT_BASELINE_OWNER_SCHEMA,
    collectionId,
    admission,
    phase: 'paused',
    revision: 0,
    items: Object.freeze(
      admission.catalog.targets.map(({ conversationId }) =>
        Object.freeze({ conversationId, state: 'pending' as const })
      )
    ),
    accountComplete: false,
    executionAuthorized: false,
  });
}

function encode(value: ClaudeAccountBaseline, maxBytes: number): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > maxBytes) throw new ClaudeAccountBaselineOwnerError('limit-exceeded');
  return bytes;
}

/** The namespace is for exact-seed reconciliation only, not authentication. */
export function prepareClaudeAccountBaseline(
  collectionId: unknown,
  admittedResult: unknown,
  limitOverrides?: unknown
): { readonly value: ClaudeAccountBaseline; readonly bytes: Uint8Array } {
  const limits = ownerLimits(limitOverrides);
  const value = baseline(collectionId, admittedResult, limits);
  return { value, bytes: encode(value, limits.maxBytes) };
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function storedBytes(input: unknown, maxBytes: number): Uint8Array {
  if (
    !(input instanceof Uint8Array) ||
    !ArrayBuffer.isView(input) ||
    Object.getPrototypeOf(input) !== Uint8Array.prototype ||
    ['length', 'byteLength', 'byteOffset', 'buffer'].some(key =>
      Object.getOwnPropertyDescriptor(input, key)
    )
  )
    throw new ClaudeAccountBaselineOwnerError('corrupt');
  if (input.byteLength > maxBytes) throw new ClaudeAccountBaselineOwnerError('limit-exceeded');
  if (
    input.length === 0 ||
    input.byteOffset !== 0 ||
    !(input.buffer instanceof ArrayBuffer) ||
    input.buffer.byteLength !== input.byteLength ||
    Reflect.ownKeys(input).length !== input.length
  )
    throw new ClaudeAccountBaselineOwnerError('corrupt');
  return input;
}

function validateEnvelope(parsed: unknown, limits: ReturnType<typeof ownerLimits>) {
  const data = fields(parsed, baselineFields, [], limits.admissionLimits);
  if (data.schema !== CLAUDE_ACCOUNT_BASELINE_OWNER_SCHEMA)
    throw new ClaudeAccountBaselineOwnerError('unsupported');
  if (
    data.phase !== 'paused' ||
    !Object.is(data.revision, 0) ||
    data.accountComplete !== false ||
    data.executionAuthorized !== false
  )
    throw new ClaudeAccountBaselineOwnerError('corrupt');
  const value = baseline(data.collectionId, data.admission, limits);
  const items = arrayData(data.items, limits.admissionLimits);
  if (
    items.length !== value.items.length ||
    items.some((item, index) => {
      const row = fields(item, ['conversationId', 'state'], [], limits.admissionLimits);
      return row.state !== 'pending' || row.conversationId !== value.items[index].conversationId;
    })
  )
    throw new ClaudeAccountBaselineOwnerError('corrupt');
  return value;
}

/** Accept exactly the canonical UTF-8 bytes, not just equivalent JSON. */
export function decodeClaudeAccountBaseline(
  input: unknown,
  limitOverrides?: unknown
): ClaudeAccountBaseline {
  const limits = ownerLimits(limitOverrides);
  try {
    const bytes = storedBytes(input, limits.maxBytes);
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const value = validateEnvelope(parsed, limits);
    if (!sameBytes(bytes, encode(value, limits.maxBytes)))
      throw new ClaudeAccountBaselineOwnerError('corrupt');
    return value;
  } catch (error) {
    if (
      error instanceof ClaudeAccountBaselineOwnerError &&
      (error.code === 'unsupported' || error.code === 'limit-exceeded')
    )
      throw error;
    if (rejectionReason(error) === 'limit-exceeded')
      throw new ClaudeAccountBaselineOwnerError('limit-exceeded');
    throw new ClaudeAccountBaselineOwnerError('corrupt');
  }
}
