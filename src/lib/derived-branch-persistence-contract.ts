/** Closed sink facts for one branch artifact; never a bundle-completeness claim. */
import { snapshotDurableWriteOutcome } from './operation-write-ledger';
import type { DurableWriteOutcome } from './types';

export const DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA =
  'liska-derived-branch-html-persist-response/1';

export interface DerivedBranchHtmlWriteResult {
  success: boolean;
  writeOutcome: DurableWriteOutcome;
}

export interface DerivedBranchHtmlPersistResponse {
  schema: typeof DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA;
  success: boolean;
  html: DerivedBranchHtmlWriteResult;
  receipt: DerivedBranchHtmlWriteResult;
}

function ownData(value: unknown, expected: readonly string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key as string)))
    return undefined;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotWrite(value: unknown): DerivedBranchHtmlWriteResult | undefined {
  const data = ownData(value, ['success', 'writeOutcome']);
  const writeOutcome = data && snapshotDurableWriteOutcome(data.writeOutcome);
  if (!data || !writeOutcome || data.success !== (writeOutcome.state === 'confirmed')) return;
  return Object.freeze({ success: data.success, writeOutcome });
}

/** Own-data copies only; malformed observations must not become positive sink evidence. */
export function snapshotDerivedBranchHtmlPersistResponse(
  value: unknown
): DerivedBranchHtmlPersistResponse | undefined {
  try {
    const data = ownData(value, ['schema', 'success', 'html', 'receipt']);
    if (!data || data.schema !== DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA) return;
    const html = snapshotWrite(data.html);
    const receipt = snapshotWrite(data.receipt);
    if (
      !html ||
      !receipt ||
      data.success !== (html.success && receipt.success) ||
      (!html.success && receipt.writeOutcome.state !== 'not-dispatched')
    )
      return;
    return Object.freeze({
      schema: DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA,
      success: data.success,
      html,
      receipt,
    });
  } catch {
    return undefined;
  }
}

export function isDerivedBranchHtmlPersistResponse(
  value: unknown
): value is DerivedBranchHtmlPersistResponse {
  return snapshotDerivedBranchHtmlPersistResponse(value) !== undefined;
}

/** Invalid state pairs fail closed, with no caller values in the exception. */
export function buildDerivedBranchHtmlPersistResponse(
  html: DurableWriteOutcome,
  receipt: DurableWriteOutcome
): DerivedBranchHtmlPersistResponse {
  const htmlOutcome = snapshotDurableWriteOutcome(html);
  const receiptOutcome = snapshotDurableWriteOutcome(receipt);
  const response =
    htmlOutcome &&
    receiptOutcome &&
    snapshotDerivedBranchHtmlPersistResponse({
      schema: DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA,
      success: htmlOutcome.state === 'confirmed' && receiptOutcome.state === 'confirmed',
      html: { success: htmlOutcome.state === 'confirmed', writeOutcome: htmlOutcome },
      receipt: { success: receiptOutcome.state === 'confirmed', writeOutcome: receiptOutcome },
    });
  if (!response) throw new Error('derived-branch-html-persist-invalid-outcome');
  return response;
}
