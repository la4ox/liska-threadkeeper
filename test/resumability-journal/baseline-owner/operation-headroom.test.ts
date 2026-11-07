// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import * as control from '../../../src/resumability-journal/purpose-persistence-v2/core/control';
import { encodeRecord } from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { PurposePersistenceError } from '../../../src/resumability-journal/purpose-persistence-v2/core/errors';
import { createBaselineOwner } from '../../../src/resumability-journal/baseline-owner';
import { active, ids, signal } from './fixtures';

afterEach(() => vi.restoreAllMocks());
describe('existing v2 operation control headroom boundary', () => {
  it('validates projected controls before insert and persists only canonical current reservation bytes', async () => {
    const { owner, data } = await active();
    const helper = vi.spyOn(control, 'encodeWithControlHeadroom');
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    const result = await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    expect(helper).toHaveBeenCalledExactlyOnceWith(result.record);
    expect(add).toHaveBeenCalledExactlyOnceWith(encodeRecord(result.record), ids().operationId);
    expect(helper.mock.results[0].value).toEqual(encodeRecord(result.record));
    helper.mockClear();
    expect((await owner.readSnapshot())?.operations).toEqual([result.record]);
    expect(helper).toHaveBeenCalledExactlyOnceWith(result.record);
    owner.close();
  });
  it('rejects an operation projection before either atomic write', async () => {
    const { owner, data } = await active(),
      before = await owner.readSnapshot();
    const add = vi.spyOn(IDBObjectStore.prototype, 'add'),
      put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const helper = vi.spyOn(control, 'encodeWithControlHeadroom').mockImplementation(() => {
      throw new PurposePersistenceError('record-too-large');
    });
    await expect(
      owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal())
    ).rejects.toMatchObject({ code: 'record-too-large' });
    expect(helper).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    helper.mockRestore();
    expect(await owner.readSnapshot()).toEqual(before);
    owner.close();
  });
  it('rejects a retained operation whose control projection cannot be admitted, including recovery and inspection', async () => {
    const { owner, data, settings } = await active();
    const result = await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    owner.close();
    const fresh = createBaselineOwner(settings);
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
        planSha256: result.snapshot.plan.planSha256,
        item: result.item,
      })
    ).rejects.toMatchObject({ code: 'record-too-large' });
    expect(helper).toHaveBeenCalledTimes(3);
    expect(put).not.toHaveBeenCalled();
    helper.mockRestore();
    expect((await fresh.readSnapshot())?.ownerBytes).toEqual(result.snapshot.ownerBytes);
    fresh.close();
  });
});
