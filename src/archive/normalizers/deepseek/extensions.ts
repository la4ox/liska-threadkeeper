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
  for (const key of Object.keys(record)) {
    if (excluded.has(key)) continue;
    Object.defineProperty(selected, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value:
        key === 'files' && degradeFiles
          ? degradedDeepSeekFilesExtension(record[key], providerIds)
          : record[key],
    });
  }
  return sanitizeJson(selected, privacy, pointer) as Record<string, JsonValue>;
}
