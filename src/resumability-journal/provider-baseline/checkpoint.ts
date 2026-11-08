import { encodeRecord, snapshotRecord } from '../purpose-persistence-v3/core/record';
import {
  PROVIDER_BASELINE_LIMITS,
  MAX_PROVIDER_OPERATIONS,
  PROVIDER_CHECKPOINT_SCHEMA,
  ProviderBaselineError,
  type AdmittedBaselinePlan,
  type ProviderBaselineCheckpoint,
  type ProviderCheckpointCommand,
  type OperationLink,
  type PlanDependencies,
} from './contracts';
import {
  check,
  decode,
  detach,
  digest,
  encode,
  exact,
  freeze,
  hashDependency,
  identifier,
  integer,
  list,
} from '../baseline-plan/data';
import { snapshotAdmittedPlan, verifyPlan } from '../baseline-plan/plan';
import {
  assertProviderFresh,
  latestProviderObservation,
  matchesProviderItem,
  providerRecordDigest,
  assertProviderPlan,
  providerOperationDigest,
} from './operation';

// eslint-disable-next-line max-lines-per-function -- One bounded envelope is parsed before its cross-history relationships are checked.
function checkpointData(input: unknown): ProviderBaselineCheckpoint {
  const data = exact(
    detach(input),
    [
      'schema',
      'planSha256',
      'revision',
      'control',
      'observedAt',
      'budget',
      'windows',
      'charges',
      'links',
      'observations',
    ],
    ['cooldown']
  );
  check(
    data.schema === PROVIDER_CHECKPOINT_SCHEMA &&
      ['paused', 'active'].includes(data.control as string)
  );
  integer(data.revision);
  integer(data.observedAt);
  digest(data.planSha256);
  const budget = exact(data.budget, ['windowId', 'maxReservationSlots']);
  identifier(budget.windowId);
  check(integer(budget.maxReservationSlots, PROVIDER_BASELINE_LIMITS.maxReservationSlots) > 0);
  const windows = list(data.windows, PROVIDER_BASELINE_LIMITS.maxWindows).map(value => {
    const budgetWindow = exact(value, ['windowId', 'openedAt']);
    return {
      windowId: identifier(budgetWindow.windowId),
      openedAt: integer(budgetWindow.openedAt),
    };
  });
  check(windows.length > 0 && windows[windows.length - 1].windowId === budget.windowId);
  const links = list(data.links, MAX_PROVIDER_OPERATIONS).map(value => {
    const link = exact(value, [
      'itemOrdinal',
      'operationId',
      'attemptId',
      'captureId',
      'operationSha256',
      'linkedAt',
      'windowId',
    ]);
    return {
      itemOrdinal: integer(link.itemOrdinal, PROVIDER_BASELINE_LIMITS.maxPlanItems - 1),
      operationId: identifier(link.operationId),
      attemptId: identifier(link.attemptId),
      captureId: identifier(link.captureId),
      operationSha256: digest(link.operationSha256),
      linkedAt: integer(link.linkedAt),
      windowId: identifier(link.windowId),
    };
  });
  const charges = list(data.charges, MAX_PROVIDER_OPERATIONS).map(value => {
    const charge = exact(value, ['windowId', 'itemOrdinal', 'operationId', 'chargedAt']);
    return {
      windowId: identifier(charge.windowId),
      itemOrdinal: integer(charge.itemOrdinal),
      operationId: identifier(charge.operationId),
      chargedAt: integer(charge.chargedAt),
    };
  });
  const observations = list(data.observations, PROVIDER_BASELINE_LIMITS.maxObservations).map(
    value => {
      const observation = exact(value, [
        'operationId',
        'recordRevision',
        'recordSha256',
        'observedAt',
      ]);
      return {
        operationId: identifier(observation.operationId),
        recordRevision: integer(observation.recordRevision),
        recordSha256: digest(observation.recordSha256),
        observedAt: integer(observation.observedAt),
      };
    }
  );
  if ('cooldown' in data) {
    const cooldown = exact(data.cooldown, ['observedAt', 'until']);
    check(integer(cooldown.observedAt) <= (data.observedAt as number));
    check(integer(cooldown.until) >= (cooldown.observedAt as number));
  }
  const result = {
    ...data,
    windows,
    links,
    charges,
    observations,
  } as unknown as ProviderBaselineCheckpoint;
  validateHistory(result);
  return freeze(result);
}
function validateHistory(checkpoint: ProviderBaselineCheckpoint): void {
  const { windows, links, charges, observations, observedAt } = checkpoint;
  check(new Set(windows.map(budgetWindow => budgetWindow.windowId)).size === windows.length);
  windows.forEach((budgetWindow, index) => {
    check(
      budgetWindow.openedAt <= observedAt &&
        (index === 0 || budgetWindow.openedAt >= windows[index - 1].openedAt)
    );
    check(
      charges.filter(charge => charge.windowId === budgetWindow.windowId).length <=
        checkpoint.budget.maxReservationSlots
    );
  });
  for (const field of ['operationId', 'attemptId', 'captureId', 'itemOrdinal'] as const)
    check(new Set(links.map(link => link[field])).size === links.length);
  check(charges.length === links.length);
  links.forEach((link, index) => {
    const windowIndex = windows.findIndex(budgetWindow => budgetWindow.windowId === link.windowId);
    check(windowIndex >= 0 && link.linkedAt >= windows[windowIndex].openedAt);
    check(link.linkedAt <= (windows[windowIndex + 1]?.openedAt ?? observedAt));
    check(index === 0 || link.linkedAt >= links[index - 1].linkedAt);
    const charge = charges[index];
    check(charge.operationId === link.operationId && charge.itemOrdinal === link.itemOrdinal);
    check(charge.windowId === link.windowId && charge.chargedAt === link.linkedAt);
    check(observations.some(observation => observation.operationId === link.operationId));
  });
  observations.forEach((observation, index) => {
    const link = links.find(link => link.operationId === observation.operationId);
    check(link && observation.observedAt >= link.linkedAt && observation.observedAt <= observedAt);
    check(index === 0 || observation.observedAt >= observations[index - 1].observedAt);
    const previous = latestProviderObservation(
      observations.slice(0, index),
      observation.operationId
    );
    check(!previous || observation.recordRevision > previous.recordRevision);
  });
}
export function snapshotProviderBaselineCheckpoint(input: unknown): ProviderBaselineCheckpoint {
  try {
    const result = checkpointData(input);
    encode(result, PROVIDER_BASELINE_LIMITS.maxCheckpointBytes);
    return result;
  } catch {
    throw new ProviderBaselineError();
  }
}
export function encodeProviderBaselineCheckpoint(input: unknown): Uint8Array {
  return encode(
    snapshotProviderBaselineCheckpoint(input),
    PROVIDER_BASELINE_LIMITS.maxCheckpointBytes
  );
}
export function decodeProviderBaselineCheckpoint(input: Uint8Array): ProviderBaselineCheckpoint {
  const { data } = decode(input, PROVIDER_BASELINE_LIMITS.maxCheckpointBytes);
  return snapshotProviderBaselineCheckpoint(data);
}
export function assertProviderCheckpointPlan(
  planInput: AdmittedBaselinePlan,
  checkpointInput: ProviderBaselineCheckpoint
) {
  const plan = snapshotAdmittedPlan(planInput);
  const checkpoint = snapshotProviderBaselineCheckpoint(checkpointInput);
  assertProviderPlan(plan);
  check(checkpoint.planSha256 === plan.planSha256, 'digest-mismatch');
  check(
    checkpoint.links.every(link => link.itemOrdinal < plan.plan.items.length),
    'operation-conflict'
  );
}
export async function createProviderBaselineCheckpoint(
  planInput: AdmittedBaselinePlan,
  input: { readonly now: number; readonly windowId: string; readonly maxReservationSlots: number },
  dependencies: PlanDependencies
): Promise<ProviderBaselineCheckpoint> {
  const plan = snapshotAdmittedPlan(planInput);
  assertProviderPlan(plan);
  const options = exact(detach(input), ['now', 'windowId', 'maxReservationSlots']);
  const checkpoint = snapshotProviderBaselineCheckpoint({
    schema: PROVIDER_CHECKPOINT_SCHEMA,
    planSha256: plan.planSha256,
    revision: 0,
    control: 'paused',
    observedAt: integer(options.now),
    budget: {
      windowId: identifier(options.windowId),
      maxReservationSlots: options.maxReservationSlots,
    },
    windows: [{ windowId: options.windowId, openedAt: options.now }],
    charges: [],
    links: [],
    observations: [],
  });
  const signal = dependencies.signal;
  const hash = hashDependency(dependencies);
  await verifyPlan(plan, hash);
  check(!signal.aborted, 'hash-failed');
  return checkpoint;
}
function commandSnapshot(input: unknown): ProviderCheckpointCommand {
  const fields = exact(
    input,
    ['kind', 'expectedRevision', 'now'],
    ['until', 'windowId', 'itemOrdinal', 'record']
  );
  const keys: Record<string, string[]> = {
    activate: [],
    pause: [],
    'recover-after-restart': [],
    'clear-cooldown': [],
    'set-cooldown': ['until'],
    'roll-budget-window': ['windowId'],
    'observe-operation': ['itemOrdinal', 'record'],
  };
  check(
    typeof fields.kind === 'string' && Object.prototype.hasOwnProperty.call(keys, fields.kind),
    'invalid-command'
  );
  exact(fields, ['kind', 'expectedRevision', 'now', ...keys[fields.kind]]);
  const base = {
    kind: fields.kind,
    expectedRevision: integer(fields.expectedRevision),
    now: integer(fields.now),
  };
  if (fields.kind === 'observe-operation') {
    const record = snapshotRecord(fields.record);
    encodeRecord(record);
    return freeze({
      ...base,
      itemOrdinal: integer(fields.itemOrdinal),
      record,
    }) as ProviderCheckpointCommand;
  }
  if (fields.kind === 'set-cooldown')
    return freeze({ ...base, until: integer(fields.until) }) as ProviderCheckpointCommand;
  if (fields.kind === 'roll-budget-window')
    return freeze({ ...base, windowId: identifier(fields.windowId) }) as ProviderCheckpointCommand;
  return freeze(base) as ProviderCheckpointCommand;
}
// eslint-disable-next-line max-lines-per-function -- Validate one detached observation, then append its inseparable link, charge and history data.
async function observe(
  plan: AdmittedBaselinePlan,
  checkpoint: ProviderBaselineCheckpoint,
  command: Extract<ProviderCheckpointCommand, { kind: 'observe-operation' }>,
  hash: (bytes: Uint8Array) => Promise<string>
): Promise<Partial<ProviderBaselineCheckpoint>> {
  const { record, itemOrdinal, now } = command;
  const item = plan.plan.items[itemOrdinal];
  check(item && matchesProviderItem(plan.plan, item, record), 'operation-conflict');
  const operation = record.operation;
  const operationSha256 = await providerOperationDigest(record, hash);
  const recordSha256 = await providerRecordDigest(record, hash);
  const existing = checkpoint.links.find(link => link.operationId === operation.operationId);
  const previous = latestProviderObservation(checkpoint.observations, operation.operationId);
  assertProviderFresh(record, recordSha256, previous);
  if (existing) {
    check(
      existing.itemOrdinal === itemOrdinal &&
        existing.operationSha256 === operationSha256 &&
        existing.attemptId === operation.attemptId &&
        existing.captureId === operation.captureId,
      'operation-conflict'
    );
    if (previous?.recordRevision === record.revision) return {};
  } else {
    check(checkpoint.links.length < MAX_PROVIDER_OPERATIONS, 'history-exhausted');
    check(
      checkpoint.charges.filter(charge => charge.windowId === checkpoint.budget.windowId).length <
        checkpoint.budget.maxReservationSlots,
      'budget-exhausted'
    );
    for (const link of checkpoint.links)
      check(
        link.itemOrdinal !== itemOrdinal &&
          link.attemptId !== operation.attemptId &&
          link.captureId !== operation.captureId,
        'operation-conflict'
      );
  }
  check(
    checkpoint.observations.length < PROVIDER_BASELINE_LIMITS.maxObservations,
    'history-exhausted'
  );
  const link: OperationLink = {
    itemOrdinal,
    operationId: operation.operationId,
    attemptId: operation.attemptId,
    captureId: operation.captureId,
    operationSha256,
    linkedAt: now,
    windowId: checkpoint.budget.windowId,
  };
  return {
    ...(!existing && {
      links: [...checkpoint.links, link],
      charges: [
        ...checkpoint.charges,
        { windowId: link.windowId, itemOrdinal, operationId: link.operationId, chargedAt: now },
      ],
    }),
    observations: [
      ...checkpoint.observations,
      {
        operationId: operation.operationId,
        recordRevision: record.revision,
        recordSha256,
        observedAt: now,
      },
    ],
  };
}
/**
 * Observes an already-existing record. This is NOT an atomic checkpoint+journal/3 reservation commit.
 * An interrupted caller must reconcile its complete detached journal/3 snapshot before choosing again.
 * No phase, assessment, dispatch authority or retry permission is copied into the checkpoint.
 */
// eslint-disable-next-line max-lines-per-function -- Explicit closed command set with a shared revision, monotonic-time and digest fence.
export async function reduceProviderBaselineCheckpoint(
  planInput: AdmittedBaselinePlan,
  checkpointInput: ProviderBaselineCheckpoint,
  commandInput: ProviderCheckpointCommand,
  dependencies: PlanDependencies
): Promise<ProviderBaselineCheckpoint> {
  const plan = snapshotAdmittedPlan(planInput);
  const checkpoint = snapshotProviderBaselineCheckpoint(checkpointInput);
  const command = commandSnapshot(commandInput);
  assertProviderCheckpointPlan(plan, checkpoint);
  check(
    command.expectedRevision === checkpoint.revision &&
      checkpoint.revision < Number.MAX_SAFE_INTEGER,
    'revision-conflict'
  );
  check(command.now >= checkpoint.observedAt, 'clock-regressed');
  const signal = dependencies.signal;
  const hash = hashDependency(dependencies);
  await verifyPlan(plan, hash);
  let changes: Partial<ProviderBaselineCheckpoint> = {};
  switch (command.kind) {
    case 'activate':
      changes = { control: 'active' };
      break;
    case 'pause':
    case 'recover-after-restart':
      changes = { control: 'paused' };
      break;
    case 'set-cooldown':
      check(command.until >= command.now, 'invalid-command');
      changes = { cooldown: { observedAt: command.now, until: command.until } };
      break;
    case 'clear-cooldown':
      break;
    case 'roll-budget-window':
      check(
        !checkpoint.windows.some(budgetWindow => budgetWindow.windowId === command.windowId),
        'invalid-command'
      );
      check(checkpoint.windows.length < PROVIDER_BASELINE_LIMITS.maxWindows, 'history-exhausted');
      changes = {
        budget: { ...checkpoint.budget, windowId: command.windowId },
        windows: [...checkpoint.windows, { windowId: command.windowId, openedAt: command.now }],
      };
      break;
    case 'observe-operation':
      changes = await observe(plan, checkpoint, command, hash);
      break;
  }
  check(!signal.aborted, 'hash-failed');
  const next = {
    ...checkpoint,
    ...changes,
    revision: checkpoint.revision + 1,
    observedAt: command.now,
  };
  if (command.kind === 'clear-cooldown') delete next.cooldown;
  return snapshotProviderBaselineCheckpoint(next);
}
