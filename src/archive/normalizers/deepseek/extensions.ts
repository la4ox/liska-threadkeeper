import type { JsonValue } from '../../types';
import { type DeepSeekPrivacyTracker, sanitizeJson } from './privacy';
import { degradedDeepSeekFilesExtension } from './assets';
import type { DeepSeekJsonRecord } from './contracts';

export function deepSeekResidualFields(
  record: DeepSeekJsonRecord,
  excluded: ReadonlySet<string>,
  privacy: DeepSeekPrivacyTracker,
  degradeFiles: boolean,
  pointer: string,
  providerIds: readonly string[] = []
): Record<string, JsonValue> {
  const selected: DeepSeekJsonRecord = {};
  const keys = Object.keys(record);
  privacy.contentBudget?.spendWork(keys.length);
  for (const key of keys) {
    if (excluded.has(key)) continue;
    Object.defineProperty(selected, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value:
        key === 'files' && degradeFiles
          ? degradedDeepSeekFilesExtension(record[key], providerIds, privacy.contentBudget)
          : record[key],
    });
  }
  return sanitizeJson(selected, privacy, pointer) as Record<string, JsonValue>;
}
