import { admitCanonicalCatalog, MAX_CATALOG_BYTES } from '../../archive/catalog/admission';
import { admitNewCaptureOperation } from '../purpose';
import { OPERATION_SCHEMA } from '../purpose/contracts';
import {
  BASELINE_LIMITS,
  PLAN_SCHEMA,
  BaselinePlanError,
  type AdmittedBaselinePlan,
  type BaselinePlan,
  type BaselinePlanRequest,
  type Identity,
  type PlanDependencies,
} from './contracts';
import {
  canonical,
  check,
  decode,
  detach,
  digest,
  encode,
  exact,
  freeze,
  hashDependency,
  integer,
  list,
  readBytes,
} from './data';

/** Ordinal code-unit comparison, never locale, title, catalog position or legacy routing keys. */
export function compareIdentity(left: Identity, right: Identity): number {
  for (const field of ['provider', 'conversationId', 'conversationKey'] as const) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  return 0;
}
export function sameIdentity(left: Identity, right: Identity): boolean {
  return compareIdentity(left, right) === 0;
}
function requirements(input: Record<string, unknown>, identity: unknown) {
  // Reuse the exact purpose contract, including strict policy, triple and assurance validation.
  return admitNewCaptureOperation({
    schema: OPERATION_SCHEMA,
    purpose: input.purpose,
    operationId: 'plan-validation',
    attemptId: 'plan-validation',
    captureId: 'plan-validation',
    admission: identity,
    sourceSelection: { catalogSha256: '0'.repeat(64) },
    destinations: input.destinations,
    completenessPolicy: input.completenessPolicy,
  });
}
function requestSnapshot(input: unknown): BaselinePlanRequest {
  const data = exact(detach(input), ['selection', 'purpose', 'destinations', 'completenessPolicy']);
  const selection = list(data.selection);
  check(selection.length > 0, 'invalid-plan');
  const operations = selection.map(identity => requirements(data, identity));
  const sorted = operations.map(operation => operation.admission).sort(compareIdentity);
  const keys = new Set<string>();
  for (let index = 0; index < sorted.length; index++) {
    check(index === 0 || compareIdentity(sorted[index - 1], sorted[index]) < 0, 'invalid-plan');
    check(!keys.has(sorted[index].conversationKey), 'invalid-plan');
    keys.add(sorted[index].conversationKey);
    if (index)
      check(
        sorted[index - 1].provider !== sorted[index].provider ||
          sorted[index - 1].conversationId !== sorted[index].conversationId,
        'invalid-plan'
      );
  }
  return freeze({
    selection: sorted,
    purpose: 'new-capture',
    destinations: operations[0].destinations,
    completenessPolicy: operations[0].completenessPolicy,
  });
}
export function snapshotPlan(input: unknown): BaselinePlan {
  try {
    const data = exact(detach(input), [
      'schema',
      'coverage',
      'purpose',
      'executionAuthorized',
      'catalogSha256',
      'destinations',
      'completenessPolicy',
      'items',
    ]);
    check(data.schema === PLAN_SCHEMA && data.coverage === 'explicit-selected-inputs-only');
    check(data.executionAuthorized === false);
    const items = list(data.items).map((value, ordinal) => {
      const item = exact(value, ['ordinal', 'provider', 'conversationId', 'conversationKey']);
      check(integer(item.ordinal) === ordinal);
      return {
        provider: item.provider,
        conversationId: item.conversationId,
        conversationKey: item.conversationKey,
      };
    });
    const request = requestSnapshot({
      selection: items,
      purpose: data.purpose,
      destinations: data.destinations,
      completenessPolicy: data.completenessPolicy,
    });
    check(canonical(items) === canonical(request.selection));
    check(canonical(data.destinations) === canonical(request.destinations));
    return freeze({
      schema: PLAN_SCHEMA,
      coverage: 'explicit-selected-inputs-only',
      purpose: request.purpose,
      executionAuthorized: false,
      catalogSha256: digest(data.catalogSha256),
      destinations: request.destinations,
      completenessPolicy: request.completenessPolicy,
      items: request.selection.map((identity, ordinal) => ({ ordinal, ...identity })),
    });
  } catch (error) {
    if (error instanceof BaselinePlanError && error.code === 'limit-exceeded') throw error;
    throw new BaselinePlanError('invalid-plan');
  }
}
export function encodeBaselinePlan(input: unknown): Uint8Array {
  return encode(snapshotPlan(input), BASELINE_LIMITS.maxPlanBytes);
}
/** Snapshots all caller data before yielding to the injected hash. No catalog loading side effect. */
export async function createBaselinePlan(
  catalogInput: Uint8Array,
  requestInput: BaselinePlanRequest,
  dependencies: PlanDependencies
): Promise<AdmittedBaselinePlan> {
  const bytes = readBytes(catalogInput, MAX_CATALOG_BYTES);
  const request = requestSnapshot(requestInput);
  const hash = hashDependency(dependencies);
  const signal = dependencies.signal;
  let catalog;
  try {
    catalog = await admitCanonicalCatalog(bytes, signal, input => hash(input));
  } catch (error) {
    if (error instanceof BaselinePlanError && error.code === 'hash-failed') throw error;
    throw new BaselinePlanError('invalid-catalog');
  }
  for (const selected of request.selection)
    check(
      catalog.identities.some(identity => sameIdentity(selected, identity as Identity)),
      'selection-mismatch'
    );
  const plan = snapshotPlan({
    schema: PLAN_SCHEMA,
    coverage: 'explicit-selected-inputs-only',
    executionAuthorized: false,
    catalogSha256: catalog.catalogSha256,
    purpose: request.purpose,
    destinations: request.destinations,
    completenessPolicy: request.completenessPolicy,
    items: request.selection.map((identity, ordinal) => ({ ordinal, ...identity })),
  });
  const planSha256 = await hash(encodeBaselinePlan(plan));
  check(!signal.aborted, 'hash-failed');
  return freeze({ plan, planSha256 });
}
/** Exact canonical byte admission; the caller supplies the expected separate digest. */
export async function admitBaselinePlan(
  input: Uint8Array,
  expectedSha256: string,
  dependencies: PlanDependencies
): Promise<AdmittedBaselinePlan> {
  const { bytes, data } = decode(input, BASELINE_LIMITS.maxPlanBytes);
  const plan = snapshotPlan(data);
  const expected = digest(expectedSha256);
  check(canonical(plan) === canonical(data), 'invalid-plan');
  const signal = dependencies.signal;
  const hash = hashDependency(dependencies);
  check((await hash(bytes)) === expected, 'digest-mismatch');
  check(!signal.aborted, 'hash-failed');
  return freeze({ plan, planSha256: expected });
}
/** Internal synchronous snapshot permits callers to detach their other inputs before any await. */
export function snapshotAdmittedPlan(input: unknown): AdmittedBaselinePlan {
  const data = exact(detach(input), ['plan', 'planSha256']);
  return freeze({ plan: snapshotPlan(data.plan), planSha256: digest(data.planSha256) });
}
export async function verifyPlan(
  input: AdmittedBaselinePlan,
  hash: (bytes: Uint8Array) => Promise<string>
) {
  check((await hash(encodeBaselinePlan(input.plan))) === input.planSha256, 'digest-mismatch');
}
