// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  projectProviderBaselineProgress,
  nextProviderBaselineDecision,
  createProviderBaselineCheckpoint,
  encodeProviderBaselineCheckpoint,
  decodeProviderBaselineCheckpoint,
} from '../../../src/resumability-journal/provider-baseline';
import {
  snapshotRecord,
  type OperationRecord,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import {
  bothDestinations,
  clone,
  command,
  dependencies,
  fixture as providerFixture,
  identity,
  linked,
  observed,
  reserved,
} from './fixtures';

describe.each(['chatgpt', 'claude'] as const)(
  '%s conservative journal/3 progress and deterministic next decision',
  provider => {
    const fixture = (count = 3, slots = 16, selected?: Parameters<typeof providerFixture>[2]) =>
      providerFixture(count, slots, selected, provider);
    it('starts untouched despite old catalog captures; a candidate never authorizes execution', async () => {
      const { plan, checkpoint } = await fixture();
      const progress = await projectProviderBaselineProgress(
        plan,
        checkpoint,
        [],
        100,
        dependencies()
      );
      expect(progress.items.map(item => item.category)).toEqual([
        'untouched',
        'untouched',
        'untouched',
      ]);
      expect(progress.items.every(item => !item.resolutionRequired)).toBe(true);
      expect(await nextProviderBaselineDecision(plan, checkpoint, [], 100, dependencies())).toEqual(
        {
          executionAuthorized: false,
          kind: 'stop',
          reason: 'paused',
        }
      );
      const active = await command(plan, checkpoint, { kind: 'activate' });
      expect(await nextProviderBaselineDecision(plan, active, [], 101, dependencies())).toEqual({
        executionAuthorized: false,
        kind: 'candidate',
        item: plan.plan.items[0],
      });
      const later = await nextProviderBaselineDecision(
        plan,
        active,
        [],
        Number.MAX_SAFE_INTEGER,
        dependencies()
      );
      expect(later).toEqual(
        await nextProviderBaselineDecision(plan, active, [], 101, dependencies())
      );
    });
    it.each([
      ['reserved', 'active', 'open', 'reserved', 'linked-operation-pending'],
      ['reserved', 'paused', 'open', 'paused-or-abandoned', 'candidate'],
      ['reserved', 'active', 'abandoned', 'paused-or-abandoned', 'candidate'],
      ['reserved', 'paused', 'abandoned', 'paused-or-abandoned', 'candidate'],
      ['in-flight', 'active', 'open', 'in-flight-or-unknown', 'unresolved-effect'],
      ['unknown', 'active', 'open', 'in-flight-or-unknown', 'unresolved-effect'],
      ['unknown', 'paused', 'open', 'in-flight-or-unknown', 'unresolved-effect'],
      ['unknown', 'active', 'abandoned', 'in-flight-or-unknown', 'unresolved-effect'],
      ['unknown', 'paused', 'abandoned', 'in-flight-or-unknown', 'unresolved-effect'],
    ] as const)(
      'projects %s/%s/%s conservatively and never retries touched work',
      async (phase, control, disposition, category, result) => {
        const { plan, checkpoint } = await fixture();
        const record = snapshotRecord({
          ...reserved(plan),
          phase,
          control,
          disposition,
          ...(phase === 'unknown' && { interruptionReason: 'restart' }),
        });
        const state = await linked(
          plan,
          await command(plan, checkpoint, { kind: 'activate' }),
          record
        );
        const progress = await projectProviderBaselineProgress(
          plan,
          state,
          [record],
          state.observedAt,
          dependencies()
        );
        expect(progress.items[0]).toMatchObject({ category, resolutionRequired: true });
        const decision = await nextProviderBaselineDecision(
          plan,
          state,
          [record],
          state.observedAt,
          dependencies()
        );
        expect(decision.executionAuthorized).toBe(false);
        if (result === 'candidate')
          expect(decision).toMatchObject({ kind: 'candidate', item: { ordinal: 1 } });
        else expect(decision).toMatchObject({ kind: 'stop', reason: result });
      }
    );
    it.each(['consistent', 'insufficient', 'conflict', 'rejected'] as const)(
      'keeps an observation with assessment %s awaiting resolution, never backed up or settled',
      async kind => {
        const { plan, checkpoint } = await fixture();
        const record = await observed(reserved(plan), kind);
        expect(record.observation?.adaptation.assessment.kind).toBe(kind);
        for (const control of ['active', 'paused'] as const)
          for (const disposition of ['open', 'abandoned'] as const) {
            const current = snapshotRecord({ ...record, control, disposition });
            const state = await linked(
              plan,
              await command(plan, checkpoint, { kind: 'activate' }),
              current
            );
            const progress = await projectProviderBaselineProgress(
              plan,
              state,
              [current],
              state.observedAt,
              dependencies()
            );
            expect(progress.items[0]).toMatchObject({
              category: 'awaiting-resolution',
              resolutionRequired: true,
            });
            expect(
              await nextProviderBaselineDecision(
                plan,
                state,
                [current],
                state.observedAt,
                dependencies()
              )
            ).toMatchObject({
              executionAuthorized: false,
              kind: 'candidate',
              item: { ordinal: 1 },
            });
            expect(JSON.stringify(progress)).not.toMatch(/backed-up|"complete"|settled/u);
          }
      }
    );
    it('retains fences across create -> activate -> reserve observation -> restart -> explicit activation -> resolution observation', async () => {
      const { plan, checkpoint } = await fixture();
      const active = await command(plan, checkpoint, { kind: 'activate' });
      const record = reserved(plan);
      const attached = await linked(plan, active, record);
      const recovered = await command(
        plan,
        decodeProviderBaselineCheckpoint(encodeProviderBaselineCheckpoint(attached)),
        { kind: 'recover-after-restart' }
      );
      expect(
        await nextProviderBaselineDecision(
          plan,
          recovered,
          [record],
          recovered.observedAt,
          dependencies()
        )
      ).toMatchObject({ reason: 'paused', executionAuthorized: false });
      const activeAgain = await command(plan, recovered, { kind: 'activate' });
      expect(
        await nextProviderBaselineDecision(
          plan,
          activeAgain,
          [record],
          activeAgain.observedAt,
          dependencies()
        )
      ).toMatchObject({ reason: 'linked-operation-pending', executionAuthorized: false });
      const resolution = await observed(record, 'consistent');
      const next = await nextProviderBaselineDecision(
        plan,
        activeAgain,
        [resolution],
        activeAgain.observedAt,
        dependencies()
      );
      expect(next).toEqual({
        executionAuthorized: false,
        kind: 'candidate',
        item: plan.plan.items[1],
      });
      expect(activeAgain.charges).toHaveLength(1);
      expect(activeAgain.links).toEqual(attached.links);
    });
    it('stops on missing links and partially reconciled snapshots, never treating missing as untouched', async () => {
      const { plan, checkpoint } = await fixture();
      const records = [await observed(reserved(plan, 0)), await observed(reserved(plan, 1))];
      let state = await command(plan, checkpoint, { kind: 'activate' });
      state = await linked(plan, state, records[0], 0);
      state = await linked(plan, state, records[1], 1);
      for (const snapshot of [[], [records[0]], [records[1]]]) {
        const progress = await projectProviderBaselineProgress(
          plan,
          state,
          snapshot,
          state.observedAt,
          dependencies()
        );
        expect(progress.conflict).toBe(true);
        expect(progress.items.some(item => item.category === 'conflict')).toBe(true);
        expect(
          await nextProviderBaselineDecision(
            plan,
            state,
            snapshot,
            state.observedAt,
            dependencies()
          )
        ).toMatchObject({ reason: 'conflict' });
      }
    });
    it('fences an unlinked existing operation as an unresolved effect until explicit observation links it', async () => {
      const { plan, checkpoint } = await fixture();
      const active = await command(plan, checkpoint, { kind: 'activate' });
      for (const record of [reserved(plan), await observed(reserved(plan))])
        expect(
          await nextProviderBaselineDecision(
            plan,
            active,
            [record],
            active.observedAt,
            dependencies()
          )
        ).toMatchObject({ reason: 'unresolved-effect' });
      const record = await observed(reserved(plan));
      const reconciled = await linked(plan, active, record);
      expect(
        await nextProviderBaselineDecision(
          plan,
          reconciled,
          [record],
          reconciled.observedAt,
          dependencies()
        )
      ).toMatchObject({ kind: 'candidate', item: { ordinal: 1 } });
    });
    it('rejects stale records, same-revision mutation and changed immutable operation bindings', async () => {
      const { plan, checkpoint } = await fixture();
      const record = reserved(plan);
      const resolution = await observed(record);
      let state = await linked(plan, await command(plan, checkpoint, { kind: 'activate' }), record);
      state = await linked(plan, state, resolution);
      for (const stale of [
        record,
        snapshotRecord({ ...resolution, control: 'paused' }),
        snapshotRecord({
          ...resolution,
          revision: 2,
          operation: { ...resolution.operation, captureId: 'different' },
        }),
      ])
        expect(
          await nextProviderBaselineDecision(plan, state, [stale], state.observedAt, dependencies())
        ).toMatchObject({ reason: 'conflict' });
      const changedLink = {
        ...state,
        links: [{ ...state.links[0], operationSha256: 'f'.repeat(64) }],
      };
      expect(
        await nextProviderBaselineDecision(
          plan,
          changedLink,
          [resolution],
          state.observedAt,
          dependencies()
        )
      ).toMatchObject({ reason: 'conflict' });
    });
    it.each(['operationId', 'attemptId', 'captureId'] as const)(
      'detects duplicate global %s across supplied operation snapshots',
      async field => {
        const { plan, checkpoint } = await fixture();
        const a = await observed(reserved(plan, 0));
        const b = reserved(plan, 1);
        const duplicate = snapshotRecord({
          ...b,
          operation: { ...b.operation, [field]: a.operation[field] },
        });
        const active = await command(plan, checkpoint, { kind: 'activate' });
        for (const snapshot of [
          [a, duplicate],
          [a, a],
        ])
          expect(
            await nextProviderBaselineDecision(
              plan,
              active,
              snapshot,
              active.observedAt,
              dependencies()
            )
          ).toMatchObject({ reason: 'conflict' });
      }
    );
    it('detects foreign catalog, destination, item, cross-provider and duplicate-item conflicts', async () => {
      const { plan, checkpoint } = await fixture();
      const record = reserved(plan);
      const alternatives = [
        { ...record.operation, sourceSelection: { catalogSha256: 'f'.repeat(64) } },
        { ...record.operation, admission: { ...record.operation.admission, ...identity(99) } },
        { ...record.operation, destinations: bothDestinations },
        {
          ...record.operation,
          admission: {
            ...record.operation.admission,
            provider: provider === 'chatgpt' ? 'claude' : 'chatgpt',
          },
        },
      ];
      const active = await command(plan, checkpoint, { kind: 'activate' });
      for (const operation of alternatives)
        expect(
          await nextProviderBaselineDecision(
            plan,
            active,
            [{ ...record, operation } as never],
            active.observedAt,
            dependencies()
          )
        ).toMatchObject({ reason: 'conflict' });
      const duplicateItem = reserved(plan, 0, 'different');
      const progress = await projectProviderBaselineProgress(
        plan,
        active,
        [record, duplicateItem],
        active.observedAt,
        dependencies()
      );
      expect(progress.items[0].category).toBe('conflict');
      expect(progress.conflict).toBe(true);
    });
    it('replays observations and rejects a forged cached verdict, malformed evidence or invalid snapshot instead of trusting assessment', async () => {
      const { plan, checkpoint } = await fixture();
      const record = await observed(reserved(plan));
      const active = await command(plan, checkpoint, { kind: 'activate' });
      const forged = clone(record);
      (forged.observation!.adaptation.assessment as { kind: string }).kind = 'consistent';
      const malformed = {
        ...record,
        observation: { ...record.observation, receipts: [{ schema: 'unknown' }] },
      };
      for (const bad of [
        forged,
        malformed,
        { ...record, schema: 'wrong' },
        { ...record, phase: 'completed' },
        { ...record, extra: true },
      ])
        expect(
          await nextProviderBaselineDecision(
            plan,
            active,
            [bad as OperationRecord],
            active.observedAt,
            dependencies()
          )
        ).toMatchObject({ executionAuthorized: false, reason: 'conflict' });
    });
    it('has exact current journal/3 capacity 16; explicit window rollover cannot increase lifetime capacity', async () => {
      const { plan, checkpoint } = await fixture(17);
      const records: OperationRecord[] = [];
      let state = await command(plan, checkpoint, { kind: 'activate' });
      for (let index = 0; index < 16; index++) {
        const record = await observed(reserved(plan, index));
        records.push(record);
        state = await linked(plan, state, record, index);
      }
      expect(
        await nextProviderBaselineDecision(plan, state, records, state.observedAt, dependencies())
      ).toMatchObject({ reason: 'budget-exhausted' });
      state = await command(plan, state, { kind: 'roll-budget-window', windowId: 'new-window' });
      const progress = await projectProviderBaselineProgress(
        plan,
        state,
        records,
        state.observedAt,
        dependencies()
      );
      expect(progress.recordCount).toBe(16);
      expect(progress.items[16].category).toBe('untouched');
      expect(
        await nextProviderBaselineDecision(
          plan,
          state,
          [...records].reverse(),
          state.observedAt,
          dependencies()
        )
      ).toEqual({ executionAuthorized: false, kind: 'stop', reason: 'capacity-unavailable' });
      expect(
        await nextProviderBaselineDecision(
          plan,
          state,
          [...records, reserved(plan, 16)],
          state.observedAt,
          dependencies()
        )
      ).toMatchObject({ reason: 'conflict' });
    });
    it('no unattempted items is not a completed baseline, including consistent observations', async () => {
      const { plan, checkpoint } = await fixture(1);
      const record = await observed(reserved(plan), 'consistent');
      const state = await linked(
        plan,
        await command(plan, checkpoint, { kind: 'activate' }),
        record
      );
      expect(
        await nextProviderBaselineDecision(plan, state, [record], state.observedAt, dependencies())
      ).toEqual({ executionAuthorized: false, kind: 'stop', reason: 'no-unattempted-items' });
      const rolled = await command(plan, state, { kind: 'roll-budget-window', windowId: 'next' });
      expect(
        await nextProviderBaselineDecision(
          plan,
          rolled,
          [record],
          rolled.observedAt,
          dependencies()
        )
      ).toMatchObject({ reason: 'no-unattempted-items' });
    });
    it('uses explicit monotonic now and fixed stop reasons, and rejects a mismatched checkpoint or plan digest', async () => {
      const { plan, checkpoint } = await fixture();
      const state = await command(plan, checkpoint, { kind: 'activate' });
      expect(await nextProviderBaselineDecision(plan, state, [], 100, dependencies())).toEqual({
        executionAuthorized: false,
        kind: 'stop',
        reason: 'clock-regressed',
      });
      const progress = await projectProviderBaselineProgress(plan, state, [], 100, dependencies());
      expect(progress.clockRegressed).toBe(true);
      for (const digestField of ['checkpoint', 'plan']) {
        const planInput = digestField === 'plan' ? { ...plan, planSha256: 'f'.repeat(64) } : plan;
        const checkpointInput =
          digestField === 'checkpoint' ? { ...state, planSha256: 'f'.repeat(64) } : state;
        expect(
          await nextProviderBaselineDecision(planInput, checkpointInput, [], 1000, dependencies())
        ).toMatchObject({ reason: 'conflict' });
      }
      const other = await fixture(1);
      await expect(
        createProviderBaselineCheckpoint(
          { ...plan, plan: other.plan.plan },
          { now: 100, windowId: 'a', maxReservationSlots: 1 },
          dependencies()
        )
      ).rejects.toThrow('digest-mismatch');
    });
    it('detaches the full records snapshot before hashing; permutations never change the next untouched item', async () => {
      const { plan, checkpoint } = await fixture();
      const a = await observed(reserved(plan, 0));
      const b = await observed(reserved(plan, 1));
      let state = await command(plan, checkpoint, { kind: 'activate' });
      state = await linked(plan, state, a, 0);
      state = await linked(plan, state, b, 1);
      const snapshot = clone([a, b]);
      const first = await nextProviderBaselineDecision(plan, state, snapshot, state.observedAt, {
        ...dependencies(),
        sha256: async bytes => {
          snapshot.length = 0;
          return dependencies().sha256(bytes);
        },
      });
      const reversed = await nextProviderBaselineDecision(
        plan,
        state,
        [b, a],
        state.observedAt,
        dependencies()
      );
      expect(first).toEqual(reversed);
      expect(first).toMatchObject({ kind: 'candidate', item: { ordinal: 2 } });
    });
  }
);
