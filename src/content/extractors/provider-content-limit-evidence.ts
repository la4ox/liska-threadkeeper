import { ProviderContentLimitError } from '../../archive/normalizers/provider-block-work-budget';
import type { ArchiveCompanionBundle } from '../../lib/types';

const companions = new WeakMap<ProviderContentLimitError, ArchiveCompanionBundle>();

/** Retain already-verified evidence without changing the limit error or its lifetime. */
export function registerProviderContentLimitEvidence(
  error: ProviderContentLimitError,
  companion: ArchiveCompanionBundle
): ProviderContentLimitError {
  companions.set(error, companion);
  return error;
}

/** Early limits and non-limit failures have no post-capture evidence in this sidecar. */
export function getProviderContentLimitEvidence(
  error: unknown
): ArchiveCompanionBundle | undefined {
  return error instanceof ProviderContentLimitError ? companions.get(error) : undefined;
}
