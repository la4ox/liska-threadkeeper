/** Shared only by the popup and worker: never import the private catalog codec here. */
export function collectorFields(
  value: unknown,
  keys: readonly string[],
  entryDescriptor?: PropertyDescriptor,
  entryKey = 'action'
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some(key => !ownKeys.includes(key))) return;
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor =
      key === entryKey && entryDescriptor
        ? entryDescriptor
        : Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

export interface NewSlotTarget {
  readonly kind: 'new';
  readonly slotId: string;
  readonly label: string;
}
export type SlotTarget = NewSlotTarget | { readonly kind: 'existing'; readonly slotId: string };
export interface PickerSlot {
  readonly provider: 'claude';
  readonly slotId: string;
  readonly label: string;
}
function isSlotId(v: unknown): v is string {
  return typeof v === 'string' && /^account-slot\/1:[0-9a-f]{32}$/u.test(v);
}
export function validSlotLabel(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= 160 &&
    v === v.trim() &&
    v === v.normalize('NFC') &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(v) &&
    [...v].length <= 80 &&
    new TextEncoder().encode(v).length <= 256
  );
}
export function newSlotId(): string {
  return (
    'account-slot/1:' +
    Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
      b.toString(16).padStart(2, '0')
    ).join('')
  );
}
export function snapshotSlotTarget(v: unknown): SlotTarget | undefined {
  try {
    if (!v || typeof v !== 'object') return;
    const kind = Object.getOwnPropertyDescriptor(v, 'kind');
    if (!kind || !('value' in kind)) return;
    const d = collectorFields(
      v,
      kind.value === 'new' ? ['kind', 'slotId', 'label'] : ['kind', 'slotId'],
      kind,
      'kind'
    );
    if (!d || !isSlotId(d.slotId)) return;
    if (d.kind === 'existing' && !('label' in d)) return { kind: 'existing', slotId: d.slotId };
    if (d.kind === 'new' && validSlotLabel(d.label))
      return { kind: 'new', slotId: d.slotId, label: d.label };
  } catch {
    /* reject non-data input */
  }
}
export type SlotRequest =
  | { action: 'listAccountCatalogSlots' }
  | { action: 'adoptLegacyClaudeCatalog'; slot: NewSlotTarget };
export function snapshotSlotRequest(
  value: unknown,
  action: PropertyDescriptor
): SlotRequest | undefined {
  try {
    if (action.value === 'listAccountCatalogSlots') {
      if (collectorFields(value, ['action'], action)) return { action: 'listAccountCatalogSlots' };
    } else if (action.value === 'adoptLegacyClaudeCatalog') {
      const data = collectorFields(value, ['action', 'slot'], action);
      const slot = snapshotSlotTarget(data?.slot);
      if (slot?.kind === 'new') return { action: 'adoptLegacyClaudeCatalog', slot };
    }
  } catch {
    /* reject non-data input */
  }
}

const inventoryCodes = [
  'listed',
  'unavailable',
  'invalid-sender',
  'invalid-message',
  'result-invalid',
] as const;
type InventoryCode = (typeof inventoryCodes)[number];
export function slotInventory(code: InventoryCode, slots: readonly PickerSlot[] = []) {
  return { schema: 'liska-account-slot-picker/1' as const, code, slots };
}
export type SlotInventory = ReturnType<typeof slotInventory>;
function pickerRow(array: unknown[], index: number): PickerSlot | undefined {
  const desc = Object.getOwnPropertyDescriptor(array, String(index));
  if (!desc?.enumerable || !('value' in desc)) return;
  const row = collectorFields(desc.value, ['provider', 'slotId', 'label']);
  if (row?.provider === 'claude' && isSlotId(row.slotId) && validSlotLabel(row.label))
    return { provider: 'claude', slotId: row.slotId, label: row.label };
}
function pickerRows(array: unknown): PickerSlot[] | undefined {
  if (!Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype) return;
  const length = Object.getOwnPropertyDescriptor(array, 'length')?.value as number;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > 16 ||
    Reflect.ownKeys(array).length !== length + 1
  )
    return;
  const slots: PickerSlot[] = [];
  for (let i = 0; i < length; i++) {
    const row = pickerRow(array, i);
    if (!row || slots.some(s => s.slotId === row.slotId)) return;
    slots.push(row);
  }
  return slots;
}
export function snapshotSlotInventory(value: unknown): SlotInventory | undefined {
  try {
    const d = collectorFields(value, ['schema', 'code', 'slots']);
    if (
      !d ||
      d.schema !== 'liska-account-slot-picker/1' ||
      !inventoryCodes.includes(d.code as InventoryCode)
    )
      return;
    const slots = pickerRows(d.slots);
    if (slots && (d.code === 'listed' || slots.length === 0))
      return slotInventory(d.code as InventoryCode, slots);
  } catch {
    return;
  }
}
const adoptionCodes = [
  'created',
  'already-created',
  'legacy-absent',
  'legacy-empty',
  'invalid-sender',
  'invalid-message',
  'source-cancelled',
  'source-unsupported',
  'source-unavailable',
  'source-read-unknown',
  'source-corrupt',
  'destination-conflict',
  'destination-capacity',
  'destination-quota',
  'destination-corrupt',
  'destination-unsupported',
  'destination-cancelled',
  'destination-unavailable',
  'destination-outcome-unknown',
  'result-invalid',
] as const;
export type AdoptionCode = (typeof adoptionCodes)[number];
export type CopyVerification =
  | 'not-performed'
  | 'verified'
  | 'owner-mismatch'
  | 'readback-unavailable';
export type CopyCleanup = 'not-opened' | 'closed' | 'close-failed';
export function adoptionReceipt(
  code: AdoptionCode,
  verification: CopyVerification = 'not-performed',
  cleanup: CopyCleanup = 'not-opened'
) {
  const copied = code === 'created' || code === 'already-created';
  return {
    schema: 'liska-legacy-catalog-copy/1' as const,
    status: copied ? ('copied' as const) : ('stopped' as const),
    code,
    retention: copied ? ('owner-committed' as const) : ('not-confirmed' as const),
    verification,
    cleanup,
  };
}
export type AdoptionReceipt = ReturnType<typeof adoptionReceipt>;
export function snapshotAdoptionReceipt(value: unknown): AdoptionReceipt | undefined {
  try {
    const data = collectorFields(value, Object.keys(adoptionReceipt('result-invalid')));
    if (!data || !adoptionCodes.includes(data.code as AdoptionCode)) return;
    const code = data.code as AdoptionCode;
    if (!['not-opened', 'closed', 'close-failed'].includes(data.cleanup as string)) return;
    if (code === 'created' || code === 'already-created') {
      if (
        !['verified', 'owner-mismatch', 'readback-unavailable'].includes(
          data.verification as string
        ) ||
        data.cleanup === 'not-opened'
      )
        return;
    } else if (
      data.verification !== 'not-performed' ||
      (!code.startsWith('destination-') && data.cleanup !== 'not-opened')
    )
      return;
    const receipt = adoptionReceipt(
      code,
      data.verification as CopyVerification,
      data.cleanup as CopyCleanup
    );
    if (Object.entries(receipt).every(([key, val]) => data[key] === val)) return receipt;
  } catch {
    /* reject non-data input */
  }
}
