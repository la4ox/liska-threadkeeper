import {
  CONVERSATION_KEY_VERSION,
  SNAPSHOT_CATALOG_SCHEMA,
  SNAPSHOT_CATALOG_VERSION,
  type SnapshotCatalogEntry,
} from './contracts';

export const CATALOG_HEADER = Object.freeze({
  schema: SNAPSHOT_CATALOG_SCHEMA,
  algorithmVersion: SNAPSHOT_CATALOG_VERSION,
  conversationKeyVersion: CONVERSATION_KEY_VERSION,
  analysisOnly: true,
  mutationAuthorized: false,
  referenceCoverage: 'selected-inputs-only',
  fileEvidence: 'metadata-only-not-content-verified',
  accountBinding: 'not-recorded-in-liska-capture-1',
} as const);

export function entrySortKey(entry: SnapshotCatalogEntry): string {
  return JSON.stringify([
    entry.provider,
    entry.conversationId,
    entry.capturedAt,
    entry.captureId,
    entry.manifestSha256,
    { ...entry, occurrenceCount: 1 },
  ]);
}
