/** Fixed, credential-free resolver reasons kept separate from binary acquisition. */

import type { RawCaptureAssetRecord } from '../../archive';
import { isSafeStagedBinaryAssetId } from '../../lib/binary-asset-contract';
import {
  CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT,
  CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES,
  CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES,
  isChatGptInterpreterResolverDiagnostic,
  type ChatGptInterpreterAssetCandidate,
  type ChatGptInterpreterResolverDiagnostic,
  type ChatGptInterpreterResolverErrorCode,
} from '../../lib/chatgpt-interpreter-resolver-contract';

const DETAIL_PREFIX = 'interpreter-resolver-';
const RUN_PREFIX = `${DETAIL_PREFIX}run-`;
const ITEM_DETAILS = new Set<string>(
  CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES.filter(code => code !== 'resolved').map(
    code => `${DETAIL_PREFIX}${code}`
  )
);
const RUN_DETAILS = new Set<string>(
  CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES.map(code => `${RUN_PREFIX}${code}`)
);

export const CHATGPT_INTERPRETER_DIAGNOSTIC_WARNING =
  'ChatGPT interpreter attachment resolution was incomplete; per-asset reason codes are recorded in the archive manifest.';

export interface ChatGptInterpreterAssetDetail {
  assetId: string;
  detail: string;
}

export function isChatGptInterpreterFailureDetail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (ITEM_DETAILS.has(value) || RUN_DETAILS.has(value)) return true;
  const match = /^interpreter-resolver-http-([1-5][0-9]{2})$/.exec(value);
  return match !== null && match[0] === value && match[1] !== '200';
}

/** Never persist success URLs, provider error strings, or binary-attempt claims. */
export function interpreterResolverFailureDetails(
  diagnostics: readonly ChatGptInterpreterResolverDiagnostic[]
): ChatGptInterpreterAssetDetail[] {
  const details: ChatGptInterpreterAssetDetail[] = [];
  for (const diagnostic of diagnostics) {
    if (!isChatGptInterpreterResolverDiagnostic(diagnostic)) {
      throw new Error('Invalid interpreter resolver diagnostic.');
    }
    if (diagnostic.code === 'resolved') continue;
    details.push({
      assetId: diagnostic.assetId,
      detail:
        diagnostic.code === 'http-error' && diagnostic.httpStatus !== undefined
          ? `${DETAIL_PREFIX}http-${diagnostic.httpStatus}`
          : `${DETAIL_PREFIX}${diagnostic.code}`,
    });
  }
  return details;
}

/** A failed run does not establish which individual requests were dispatched. */
export function interpreterResolverRunFailureDetails(
  plan: readonly ChatGptInterpreterAssetCandidate[],
  code: ChatGptInterpreterResolverErrorCode
): ChatGptInterpreterAssetDetail[] {
  const detail = `${RUN_PREFIX}${code}`;
  if (!RUN_DETAILS.has(detail)) throw new Error('Invalid interpreter resolver run reason.');
  return plan.map(candidate => ({ assetId: candidate.assetId, detail }));
}

function readDetail(value: unknown): ChatGptInterpreterAssetDetail | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('assetId') || !keys.includes('detail')) return undefined;
  const asset = Object.getOwnPropertyDescriptor(value, 'assetId');
  const detail = Object.getOwnPropertyDescriptor(value, 'detail');
  if (
    !asset?.enumerable ||
    !('value' in asset) ||
    !detail?.enumerable ||
    !('value' in detail) ||
    !isSafeStagedBinaryAssetId(asset.value) ||
    !isChatGptInterpreterFailureDetail(detail.value)
  )
    return undefined;
  return { assetId: asset.value, detail: detail.value };
}

function validatedDetails(
  value: unknown,
  allowedAssetIds: ReadonlySet<string>
): Map<string, string> | undefined {
  try {
    if (!Array.isArray(value) || value.length > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT) {
      return undefined;
    }
    const result = new Map<string, string>();
    for (const item of value) {
      const diagnostic = readDetail(item);
      if (
        !diagnostic ||
        !allowedAssetIds.has(diagnostic.assetId) ||
        result.has(diagnostic.assetId)
      ) {
        return undefined;
      }
      result.set(diagnostic.assetId, diagnostic.detail);
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Later acquisition outcomes always take precedence over earlier resolver failures. */
export function applyInterpreterResolverDetails(
  records: readonly RawCaptureAssetRecord[],
  details: unknown
): RawCaptureAssetRecord[] {
  const reasons = validatedDetails(details, new Set(records.map(record => record.id)));
  return records.map(record => ({
    ...record,
    ...(record.state === 'not-attempted' && reasons?.has(record.id)
      ? { detail: reasons.get(record.id)! }
      : {}),
    sourceRefs: record.sourceRefs.map(ref => ({ ...ref })),
  }));
}

export function hasInterpreterResolverFailure(records: readonly RawCaptureAssetRecord[]): boolean {
  return records.some(
    record => record.state === 'not-attempted' && isChatGptInterpreterFailureDetail(record.detail)
  );
}
