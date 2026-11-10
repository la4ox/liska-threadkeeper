// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { createProviderBaselineOwner } from '../../../src/resumability-journal/provider-baseline-owner';
import { assertProviderOwnerHeadroom } from '../../../src/resumability-journal/provider-baseline-owner/envelope';
import {
  encodeProviderBaselineCheckpoint,
  snapshotProviderBaselineCheckpoint,
} from '../../../src/resumability-journal/provider-baseline';
import * as control from '../../../src/resumability-journal/purpose-persistence-v3/core/control';
import { PurposePersistenceError } from '../../../src/resumability-journal/purpose-persistence-v3/core/errors';
import { encodeRecord } from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import { active, ids, signal } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('provider owner real checkpoint and record headroom', () => {
  it('checks the actual 64 KiB mandatory-pause projection at worst-width revision and time', () => {
    let boundary: ReturnType<typeof snapshotProviderBaselineCheckpoint> | undefined;
    for (let width = 90; width <= 130 && !boundary; width++) {
      for (let lastExtra = 0; lastExtra <= 200; lastExtra++) {
        const text = (prefix: string, index: number, extra = 0) =>
          `${prefix}-${index}-` + '界'.repeat(width + extra);
        const windows = Array.from({ length: 64 }, (_, index) => ({
          windowId: text('window', index, index === 63 ? lastExtra : 0),
          openedAt: 100,
        }));
        if (windows[63].windowId.length > 256) break;
        const links = Array.from({ length: 16 }, (_, index) => ({
          itemOrdinal: index,
          operationId: text('operation', index),
          attemptId: text('attempt', index),
          captureId: text('capture', index),
          operationSha256: 'a'.repeat(64),
          linkedAt: 100,
          windowId: windows[63].windowId,
        }));
        const candidate = {
          schema: 'liska-explicit-baseline-checkpoint/2' as const,
          planSha256: 'f'.repeat(64),
          revision: 1,
          control: 'active' as const,
          observedAt: 100,
          budget: { windowId: windows[63].windowId, maxReservationSlots: 16 },
          windows,
          links,
          charges: links.map(link => ({
            windowId: link.windowId,
            itemOrdinal: link.itemOrdinal,
            operationId: link.operationId,
            chargedAt: 100,
          })),
          observations: links.map(link => ({
            operationId: link.operationId,
            recordRevision: 0,
            recordSha256: 'b'.repeat(64),
            observedAt: 100,
          })),
        };
        const currentLength = new TextEncoder().encode(JSON.stringify(candidate)).length;
        const projectedLength = new TextEncoder().encode(
          JSON.stringify({
            ...candidate,
            control: 'paused',
            revision: Number.MAX_SAFE_INTEGER,
            observedAt: Number.MAX_SAFE_INTEGER,
          })
        ).length;
        if (currentLength <= 64 * 1024 && projectedLength > 64 * 1024)
          boundary = snapshotProviderBaselineCheckpoint(candidate);
      }
    }
    expect(boundary).toBeDefined();
    expect(encodeProviderBaselineCheckpoint(boundary).length).toBeLessThanOrEqual(64 * 1024);
    expect(() => assertProviderOwnerHeadroom(boundary!)).toThrow('headroom-exhausted');
  });

  it('validates control projections before insert and persists only current canonical bytes', async () => {
    const { owner, bytes } = await active();
    const helper = vi.spyOn(control, 'encodeWithControlHeadroom');
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    const result = await owner.reserveNext(1, bytes, ids(), 102, signal());
    expect(helper).toHaveBeenCalledWith(result.record);
    expect(add).toHaveBeenCalledExactlyOnceWith(
      encodeRecord(result.record),
      result.record.operation.operationId
    );
    expect(helper.mock.results.every(call => call.value instanceof Uint8Array)).toBe(true);
    helper.mockClear();
    expect((await owner.readSnapshot())?.operations).toEqual([result.record]);
    expect(helper).toHaveBeenCalledWith(result.record);
    owner.close();
  });

  it('rejects an operation projection before either atomic write', async () => {
    const { owner, bytes } = await active();
    const before = await owner.readSnapshot();
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    vi.spyOn(control, 'encodeWithControlHeadroom').mockImplementation(() => {
      throw new Error('synthetic-headroom');
    });
    await expect(owner.reserveNext(1, bytes, ids(), 102, signal())).rejects.toThrow(
      'synthetic-headroom'
    );
    expect(add).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await owner.readSnapshot()).toEqual(before);
    owner.close();
  });

  it('runs operation headroom on every read, recovery and inspection without writing', async () => {
    const { owner, bytes, settings, snapshot } = await active();
    const reservation = await owner.reserveNext(1, bytes, ids(), 102, signal());
    owner.close();
    const fresh = createProviderBaselineOwner(settings);
    await fresh.open();
    const helper = vi.spyOn(control, 'encodeWithControlHeadroom').mockImplementation(() => {
      throw new PurposePersistenceError('record-too-large');
    });
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    await expect(fresh.readSnapshot()).rejects.toMatchObject({ code: 'record-too-large' });
    await expect(fresh.recoverAfterRestart(2, 103, signal())).rejects.toMatchObject({
      code: 'record-too-large',
    });
    await expect(
      fresh.inspectReservation({
        ...ids(),
        planSha256: snapshot.plan.planSha256,
        item: reservation.item,
      })
    ).rejects.toMatchObject({ code: 'record-too-large' });
    expect(helper).toHaveBeenCalledTimes(3);
    expect(put).not.toHaveBeenCalled();
    fresh.close();
  });
});
