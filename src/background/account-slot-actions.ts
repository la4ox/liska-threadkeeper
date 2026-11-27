import { openAccountCatalog } from '../account-catalog-owner';
import {
  adoptLegacyClaudeCatalog,
  type AdoptLegacyClaudeCatalogResult,
} from '../account-catalog-adoption';
import {
  adoptionReceipt,
  snapshotAdoptionReceipt,
  snapshotSlotInventory,
  slotInventory,
  type AdoptionCode,
  type NewSlotTarget,
} from '../lib/account-slot-contract';

/** Inventory may initialize the fixed empty DB. It never creates a slot or reads owner values. */
export async function listPickerSlots(open = openAccountCatalog) {
  try {
    const catalog = await open();
    try {
      const receipt = slotInventory(
        'listed',
        (await catalog.listSlots()).map(({ slotId, provider, label }) => ({
          slotId,
          provider,
          label,
        }))
      );
      return snapshotSlotInventory(receipt) ?? slotInventory('result-invalid');
    } finally {
      await catalog.close();
    }
  } catch {
    return slotInventory('unavailable');
  }
}

function copyFailure(
  result: Extract<AdoptLegacyClaudeCatalogResult, { kind: 'failed' }>
): AdoptionCode {
  if (result.stage === 'input') return 'invalid-message';
  if (result.stage === 'source') {
    if (result.code === 'cancelled') return 'source-cancelled';
    if (result.code === 'unsupported') return 'source-unsupported';
    if (result.code === 'corrupt') return 'source-corrupt';
    if (result.code === 'transaction-outcome-unknown') return 'source-read-unknown';
    return 'source-unavailable';
  }
  switch (result.code) {
    case 'conflict':
      return 'destination-conflict';
    case 'capacity':
      return 'destination-capacity';
    case 'quota-exceeded':
      return 'destination-quota';
    case 'corrupt':
      return 'destination-corrupt';
    case 'unsupported':
      return 'destination-unsupported';
    case 'cancelled':
      return 'destination-cancelled';
    case 'transaction-outcome-unknown':
    case 'unexpected-failure':
      return 'destination-outcome-unknown';
    default:
      return 'destination-unavailable';
  }
}
function projectCopy(result: AdoptLegacyClaudeCatalogResult) {
  if (result.kind === 'created' || result.kind === 'already-created')
    return adoptionReceipt(result.kind, result.verification, result.cleanup);
  if (result.kind === 'failed')
    return adoptionReceipt(
      copyFailure(result),
      'not-performed',
      result.stage === 'destination' ? result.cleanup : 'not-opened'
    );
  if (result.kind === 'legacy-absent' || result.kind === 'legacy-empty')
    return adoptionReceipt(result.kind);
  return adoptionReceipt('result-invalid');
}
/** Offline copy: never ask for a source tab and never forward a private owner or exception. */
export async function copyLegacySlot(slot: NewSlotTarget, adopt = adoptLegacyClaudeCatalog) {
  try {
    // Verification and cleanup refer to the destination; no source value crosses this adapter.
    const result = await adopt({ slotId: slot.slotId, label: slot.label });
    return snapshotAdoptionReceipt(projectCopy(result)) ?? adoptionReceipt('result-invalid');
  } catch {
    return adoptionReceipt('result-invalid');
  }
}
