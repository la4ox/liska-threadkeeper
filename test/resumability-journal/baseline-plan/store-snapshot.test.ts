// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { encodeSnapshotCatalog } from '../../../src/archive/catalog';
import { createPurposePersistenceStore } from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import {
  createBaselinePlan,
  createBaselineCheckpoint,
  nextBaselineDecision,
  projectBaselineProgress,
} from '../../../src/resumability-journal/baseline-plan';
import { catalog, request, reserve, sha256 } from '../purpose-persistence-v2/fixtures';
import { command, dependencies, linked, requirements } from './fixtures';

it('observes real v2 store detached read-only snapshots without any baseline store mutation or execution', async () => {
  const store = createPurposePersistenceStore({ indexedDB: new IDBFactory(), sha256 });
  await store.open();
  try {
    // Test fixture setup only; the baseline module is not involved in this reservation.
    await reserve(store);
    const bytes = encodeSnapshotCatalog(await catalog());
    const plan = await createBaselinePlan(
      bytes,
      { ...requirements, selection: [request().selection] } as never,
      dependencies()
    );
    let checkpoint = await createBaselineCheckpoint(
      plan,
      { now: 100, windowId: 'fixture-window', maxReservationSlots: 1 },
      dependencies()
    );
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const snapshot = await store.list();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0].operation)).toBe(true);
    checkpoint = await command(plan, checkpoint, { kind: 'activate' });
    expect(
      await nextBaselineDecision(plan, checkpoint, snapshot, checkpoint.observedAt, dependencies())
    ).toMatchObject({ executionAuthorized: false, reason: 'unresolved-effect' });
    checkpoint = await linked(plan, checkpoint, snapshot[0]);
    checkpoint = await command(plan, checkpoint, { kind: 'recover-after-restart' });
    expect(checkpoint.control).toBe('paused');
    checkpoint = await command(plan, checkpoint, { kind: 'activate' });
    const readBack = await store.list();
    expect(
      await nextBaselineDecision(plan, checkpoint, readBack, checkpoint.observedAt, dependencies())
    ).toMatchObject({ executionAuthorized: false, reason: 'linked-operation-pending' });
    expect(
      (
        await projectBaselineProgress(
          plan,
          checkpoint,
          readBack,
          checkpoint.observedAt,
          dependencies()
        )
      ).items[0].category
    ).toBe('reserved');
    expect(readBack).toEqual(snapshot);
    expect(put).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    store.close();
  }
});
