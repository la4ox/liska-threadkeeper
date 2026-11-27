import type { ClaudeAccountCatalogAdmissionResult } from '../claude-baseline/account-admission-contracts';
import { snapshotClaudeAccountCatalogAdmission } from '../claude-baseline/account-admission-snapshot';
import { CLAUDE_BASELINE_HARD_LIMITS } from '../claude-baseline/contracts';
import { fields, isScopeKey } from '../claude-baseline/data';
import { AccountCatalogError } from './errors';

export const ACCOUNT_SLOT_SCHEMA = 'liska-account-catalog-slot/1';
export const ACCOUNT_OWNER_SCHEMA = 'liska-account-catalog-owner/1';
// At most about 4 MiB of record payload at capacity, excluding IndexedDB overhead.
export const MAX_SLOTS = 16;
export const MAX_OWNERS = 64;
export const MAX_SLOT_BYTES = 512;
export const MAX_OWNER_BYTES = 64 * 1024;
export const MAX_LABEL_SCALARS = 80;
export const MAX_LABEL_BYTES = 256;

type Admitted = Extract<ClaudeAccountCatalogAdmissionResult, { kind: 'admitted' }>;

export interface AccountCatalogSlot {
  readonly schema: typeof ACCOUNT_SLOT_SCHEMA;
  readonly slotId: string;
  readonly provider: 'claude';
  readonly label: string;
}

export interface AccountCatalogOwnerLocator {
  readonly provider: 'claude';
  readonly slotId: string;
  readonly scopeKey: string;
}

export interface AccountCatalogOwnerRef extends AccountCatalogOwnerLocator {
  readonly collectionId: string;
}

export interface AccountCatalogOwner extends AccountCatalogOwnerRef {
  readonly schema: typeof ACCOUNT_OWNER_SCHEMA;
  readonly admission: Admitted;
  readonly phase: 'paused';
  readonly revision: 0;
  readonly accountComplete: false;
  readonly executionAuthorized: false;
}

export interface CreatePausedClaudeInput {
  readonly slotId: string;
  readonly label: string;
  readonly collectionId: string;
  readonly admission: unknown;
}

type Encoded<Value> = { readonly value: Value; readonly bytes: Uint8Array };
type OwnerKey = ['claude', string, string];
const slotFields = ['schema', 'slotId', 'provider', 'label'] as const;
const ownerFields = [
  'schema',
  'provider',
  'slotId',
  'scopeKey',
  'collectionId',
  'admission',
  'phase',
  'revision',
  'accountComplete',
  'executionAuthorized',
] as const;

function encode(value: unknown, maxBytes: number): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > maxBytes) throw new AccountCatalogError('limit-exceeded');
  return bytes;
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function isSlotId(value: unknown): value is string {
  return typeof value === 'string' && /^account-slot\/1:[a-f0-9]{32}$/u.test(value);
}

function isCollectionId(value: unknown): value is string {
  return typeof value === 'string' && /^claude-account-collection\/1:[a-f0-9]{32}$/u.test(value);
}

export function demandSlotId(value: unknown): string {
  if (!isSlotId(value)) throw new AccountCatalogError('invalid-input');
  return value;
}

/** Display-only, exact NFC; no surrounding whitespace, controls, format or line breaks. */
function label(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_LABEL_SCALARS * 2 ||
    value !== value.trim() ||
    value !== value.normalize('NFC') ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) ||
    [...value].length > MAX_LABEL_SCALARS ||
    new TextEncoder().encode(value).length > MAX_LABEL_BYTES
  )
    throw new AccountCatalogError('invalid-input');
  return value;
}

function slot(slotId: unknown, displayLabel: unknown): AccountCatalogSlot {
  return Object.freeze({
    schema: ACCOUNT_SLOT_SCHEMA,
    slotId: demandSlotId(slotId),
    provider: 'claude',
    label: label(displayLabel),
  });
}

function owner(slotId: string, collectionId: unknown, input: unknown): AccountCatalogOwner {
  if (!isCollectionId(collectionId)) throw new AccountCatalogError('invalid-input');
  const admission = snapshotClaudeAccountCatalogAdmission(input);
  if (admission.kind !== 'admitted')
    throw new AccountCatalogError(
      admission.reason === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-input'
    );
  return Object.freeze({
    schema: ACCOUNT_OWNER_SCHEMA,
    provider: 'claude',
    slotId,
    scopeKey: admission.catalog.scopeKey,
    collectionId,
    admission,
    phase: 'paused',
    revision: 0,
    accountComplete: false,
    executionAuthorized: false,
  });
}

export function prepareClaude(input: unknown): {
  readonly slot: Encoded<AccountCatalogSlot>;
  readonly owner: Encoded<AccountCatalogOwner>;
} {
  try {
    const data = fields(
      input,
      ['slotId', 'label', 'collectionId', 'admission'],
      [],
      CLAUDE_BASELINE_HARD_LIMITS
    );
    const knownSlot = slot(data.slotId, data.label);
    const knownOwner = owner(knownSlot.slotId, data.collectionId, data.admission);
    return {
      slot: { value: knownSlot, bytes: encode(knownSlot, MAX_SLOT_BYTES) },
      owner: { value: knownOwner, bytes: encode(knownOwner, MAX_OWNER_BYTES) },
    };
  } catch (error) {
    if (error instanceof AccountCatalogError) throw error;
    throw new AccountCatalogError(error === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-input');
  }
}

function locator(
  provider: unknown,
  slotId: unknown,
  scopeKey: unknown
): AccountCatalogOwnerLocator {
  if (provider !== 'claude' || typeof scopeKey !== 'string' || !isScopeKey(scopeKey))
    throw new AccountCatalogError('invalid-input');
  return { provider, slotId: demandSlotId(slotId), scopeKey };
}

export function demandLocator(value: unknown): AccountCatalogOwnerLocator {
  try {
    const data = fields(value, ['provider', 'slotId', 'scopeKey'], [], CLAUDE_BASELINE_HARD_LIMITS);
    return locator(data.provider, data.slotId, data.scopeKey);
  } catch {
    throw new AccountCatalogError('invalid-input');
  }
}

export function ownerKey(value: AccountCatalogOwnerLocator): OwnerKey {
  return [value.provider, value.slotId, value.scopeKey];
}

/** One baseline per provider, local slot and observed scope; collection ID is immutable seed data. */
export function decodeOwnerKey(key: IDBValidKey): AccountCatalogOwnerLocator {
  if (!Array.isArray(key) || key.length !== 3) throw new AccountCatalogError('corrupt');
  try {
    return locator(key[0], key[1], key[2]);
  } catch {
    throw new AccountCatalogError('corrupt');
  }
}

function decode<Value>(
  input: unknown,
  maxBytes: number,
  validate: (parsed: unknown) => Value
): Encoded<Value> {
  try {
    if (
      !(input instanceof Uint8Array) ||
      !ArrayBuffer.isView(input) ||
      Object.getPrototypeOf(input) !== Uint8Array.prototype ||
      input.length === 0 ||
      input.length > maxBytes ||
      input.byteOffset !== 0 ||
      input.length !== input.buffer.byteLength
    )
      throw new AccountCatalogError('corrupt');
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input));
    const value = validate(parsed);
    if (!sameBytes(input, encode(value, maxBytes))) throw new AccountCatalogError('corrupt');
    return { value, bytes: input };
  } catch (error) {
    if (error instanceof AccountCatalogError && error.code === 'unsupported') throw error;
    throw new AccountCatalogError('corrupt');
  }
}

export function decodeSlot(input: unknown, slotId: string): Encoded<AccountCatalogSlot> {
  return decode(input, MAX_SLOT_BYTES, parsed => {
    const data = fields(parsed, slotFields, [], CLAUDE_BASELINE_HARD_LIMITS);
    if (data.schema !== ACCOUNT_SLOT_SCHEMA || data.provider !== 'claude')
      throw new AccountCatalogError('unsupported');
    if (data.slotId !== slotId) throw new AccountCatalogError('corrupt');
    return slot(data.slotId, data.label);
  });
}

export function decodeOwner(
  input: unknown,
  key: AccountCatalogOwnerLocator
): Encoded<AccountCatalogOwner> {
  return decode(input, MAX_OWNER_BYTES, parsed => {
    const data = fields(parsed, ownerFields, [], CLAUDE_BASELINE_HARD_LIMITS);
    if (data.schema !== ACCOUNT_OWNER_SCHEMA || data.provider !== 'claude')
      throw new AccountCatalogError('unsupported');
    if (
      data.phase !== 'paused' ||
      !Object.is(data.revision, 0) ||
      data.accountComplete !== false ||
      data.executionAuthorized !== false ||
      data.slotId !== key.slotId ||
      data.scopeKey !== key.scopeKey ||
      data.provider !== key.provider
    )
      throw new AccountCatalogError('corrupt');
    const value = owner(key.slotId, data.collectionId, data.admission);
    if (value.scopeKey !== key.scopeKey) throw new AccountCatalogError('corrupt');
    return value;
  });
}
