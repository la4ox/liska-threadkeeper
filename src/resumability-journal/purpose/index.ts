import {
  type EvidenceAssessment,
  type NewCaptureEvidence,
  type NewCaptureOperation,
} from './contracts';
import { detach, freeze, limitsFrom, rejectionCode } from './data';
import { validator } from './validation';
import { relate } from './relations';
export * from './contracts';

/** Validates, detaches and deeply freezes an explicit operation; no inferred fields or migrations. */
export function admitNewCaptureOperation(input: unknown, limits?: unknown): NewCaptureOperation {
  const budget = limitsFrom(limits);
  const detached = detach(input, budget);
  validator(budget, 'invalid-operation').operation(detached);
  return freeze(detached) as unknown as NewCaptureOperation;
}

/** Deterministic JSON snapshot only, not an authenticated record or a decoding/migration API. */
export function snapshotNewCaptureOperation(input: unknown, limits?: unknown): string {
  return JSON.stringify(admitNewCaptureOperation(input, limits));
}

/**
 * `consistent` means schema/identity/relation consistency of supplied evidence ONLY.
 * Detached data cannot authenticate producer provenance, current durable existence,
 * provider freshness, manifest contents or account completeness. Completeness refers
 * only to the declared capture inventory. No verdict settles work, completes an
 * operation, authorizes dispatch/retry, or records anything. No producer is wired here.
 * File path confirmation is deliberately NOT byte readback. All destinations are required.
 * Transparent Proxy traps remain outside the descriptor-safe data guarantee.
 */
export function assessNewCaptureEvidence(
  operation: unknown,
  evidence?: unknown,
  limits?: unknown
): EvidenceAssessment {
  try {
    const budget = limitsFrom(limits);
    const admitted = admitNewCaptureOperation(operation, budget);
    if (evidence === undefined) return relate(admitted);
    const detached = detach(evidence, budget);
    validator(budget, 'invalid-evidence').evidence(detached);
    return relate(admitted, detached as unknown as NewCaptureEvidence);
  } catch (error) {
    const code = rejectionCode(error);
    return freeze({ kind: 'rejected', codes: [code] });
  }
}
