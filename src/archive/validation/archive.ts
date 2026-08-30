import { LISKA_THREAD_SCHEMA, type LiskaThreadArchive } from '../types';
import type { AssetReference } from './blocks';
import type { ArchiveValidationIssue, ArchiveValidationResult } from './contracts';
import { validateGraph } from './graph';
import {
  validateAssets,
  validateConversation,
  validateDiagnostics,
  validateInputs,
} from './records';
import { addIssue, expectExactObject, isNonEmptyString, validateExtensions } from './shared';

const ARCHIVE_FIELDS = [
  'schema',
  'archiveId',
  'inputs',
  'conversation',
  'graph',
  'assets',
  'diagnostics',
  'extensions',
];

/**
 * Validates an untrusted archive without browser APIs or a JSON Schema runtime.
 * The result is deterministic and ordinary malformed values never escape as
 * exceptions, which makes it suitable for downloaded archive files.
 */
export function validateLiskaThreadArchive(input: unknown): ArchiveValidationResult {
  const issues: ArchiveValidationIssue[] = [];
  const archive = expectExactObject(
    input,
    '',
    ARCHIVE_FIELDS,
    ARCHIVE_FIELDS,
    issues,
    'archive-not-object'
  );
  if (!archive) {
    return { valid: false, issues };
  }
  validateArchiveHeader(archive, issues);
  validateInputs(archive.inputs, issues);
  const conversation = validateConversation(archive.conversation, issues);
  const assetReferences = validateArchiveGraph(
    archive,
    conversation?.currentNodeId,
    Boolean(conversation),
    issues
  );
  validateAssets(archive.assets, assetReferences, issues);
  validateDiagnostics(archive.diagnostics, issues);
  return { valid: !issues.some(issue => issue.severity === 'error'), issues };
}

function validateArchiveHeader(
  archive: Record<string, unknown>,
  issues: ArchiveValidationIssue[]
): void {
  if (archive.schema !== LISKA_THREAD_SCHEMA) {
    addIssue(
      issues,
      'error',
      'schema-tag-invalid',
      '/schema',
      `Schema must equal ${LISKA_THREAD_SCHEMA}.`
    );
  }
  if (!isNonEmptyString(archive.archiveId)) {
    addIssue(issues, 'error', 'archive-id-invalid', '/archiveId', 'Archive ID must be non-empty.');
  }
  validateExtensions(archive.extensions, '/extensions', issues);
}

function validateArchiveGraph(
  archive: Record<string, unknown>,
  currentNodeId: unknown,
  hasConversation: boolean,
  issues: ArchiveValidationIssue[]
): AssetReference[] {
  const messageIds = new Set<string>();
  const assetReferences: AssetReference[] = [];
  validateGraph(archive.graph, currentNodeId, hasConversation, issues, messageIds, assetReferences);
  return assetReferences;
}

export function isLiskaThreadArchive(input: unknown): input is LiskaThreadArchive {
  return validateLiskaThreadArchive(input).valid;
}
