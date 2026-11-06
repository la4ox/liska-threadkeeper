import { encodeRecord, revise, type OperationRecord } from './record';
import { requireCondition } from './errors';

export type ControlAction = 'pause' | 'restart' | 'abandon';

/** Shared real transition for mutation and size projections; no approximate byte allowances. */
export function controlRecord(record: OperationRecord, action: ControlAction): OperationRecord {
  requireCondition(record.disposition === 'open', 'transition-failed');
  if (action === 'restart' && record.phase !== 'in-flight') return record;
  return revise(record, {
    ...(action === 'pause' && { control: 'paused' }),
    ...(action === 'abandon' && { disposition: 'abandoned' }),
    ...(record.phase === 'in-flight' && { phase: 'unknown', interruptionReason: action }),
  });
}

/**
 * Every retained open state must leave room for its required control/fencing paths.
 * Encode the actual transitions, including their revision increments, then reserve the
 * full safe-integer digit width so repeated pauses cannot consume a byte allowance.
 * Abandoned records need no further mutation headroom. No stored revision is inflated.
 */
export function encodeWithControlHeadroom(record: OperationRecord): Uint8Array {
  const bytes = encodeRecord(record);
  if (record.disposition === 'abandoned') return bytes;
  const paused = controlRecord(record, 'pause');
  const projections = [
    record,
    paused,
    controlRecord(record, 'abandon'),
    controlRecord(paused, 'abandon'),
  ];
  if (record.phase === 'in-flight') {
    const restarted = controlRecord(record, 'restart');
    const restartedPaused = controlRecord(restarted, 'pause');
    projections.push(
      restarted,
      restartedPaused,
      controlRecord(restarted, 'abandon'),
      controlRecord(restartedPaused, 'abandon')
    );
  }
  for (const projection of projections)
    encodeRecord({ ...projection, revision: Number.MAX_SAFE_INTEGER });
  return bytes;
}
