import { describe, expect, it, vi } from 'vitest';
import {
  snapshotSlotTarget,
  validSlotLabel,
  snapshotSlotInventory,
  slotInventory,
  snapshotAdoptionReceipt,
  adoptionReceipt,
} from '../../src/lib/account-slot-contract';
const slotId = 'account-slot/1:' + 'a'.repeat(32),
  label = '個人',
  row = { slotId, label, provider: 'claude' as const };
describe('closed slot picker and copy contracts', () => {
  it('uses exact immutable-by-copy slot targets, bounded canonical labels and no owner attributes', () => {
    const input = { kind: 'new', slotId, label },
      snap = snapshotSlotTarget(input);
    input.label = 'changed';
    expect(snap).toEqual({ kind: 'new', slotId, label });
    for (const v of ['', ' padded', 'e\u0301', '🐈'.repeat(65), 'x'.repeat(81), 'x\u202ey'])
      expect(validSlotLabel(v)).toBe(false);
    expect(validSlotLabel('🐈'.repeat(64))).toBe(true);
    const get = vi.fn();
    for (const v of [
      { kind: 'existing', slotId, label },
      { kind: 'new', slotId },
      { ...input, slotId: slotId + '\n' },
      { ...input, owner: {} },
      Object.defineProperty({ ...input }, 'label', { get }),
    ])
      expect(snapshotSlotTarget(v)).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects malformed lists, non-unique keys, oversize, holes, accessors and private extra fields', () => {
    const get = vi.fn();
    for (const slots of [
      new Array(1),
      Array(17).fill(row),
      [row, row],
      [{ ...row, scopeKey: 'private' }],
      Object.defineProperty([row], '0', { get }),
      [Object.defineProperty({ ...row }, 'slotId', { get })],
      Object.assign([row], { extra: 'private' }),
    ])
      expect(snapshotSlotInventory({ ...slotInventory('listed'), slots })).toBeUndefined();
    expect(snapshotSlotInventory(slotInventory('unavailable', [row]))).toBeUndefined();
    expect(snapshotSlotInventory({ ...slotInventory('listed'), owner: {} })).toBeUndefined();
    expect(snapshotSlotInventory(slotInventory('listed', [row]))).toEqual(
      slotInventory('listed', [row])
    );
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects forged committed/verified/cleanup truth and owner payloads', () => {
    const ok = adoptionReceipt('created', 'verified', 'closed');
    for (const change of [
      { owner: {} },
      { retention: 'owner-existing' },
      { status: 'stopped' },
      { cleanup: 'not-opened' },
      { code: 'source-cancelled' },
      { verification: 'unknown' },
      { schema: 'private' },
    ])
      expect(snapshotAdoptionReceipt({ ...ok, ...change })).toBeUndefined();
    expect(
      snapshotAdoptionReceipt(adoptionReceipt('legacy-empty', 'not-performed', 'closed'))
    ).toBeUndefined();
    expect(snapshotAdoptionReceipt(ok)).toEqual(ok);
  });
});
