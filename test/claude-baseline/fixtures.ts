import { expect } from 'vitest';
import {
  CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA,
  enumerateClaudeBaselineCatalog,
  type ClaudeBaselineCatalog,
} from '../../src/claude-baseline';

export const scopeKey = 'claude-list-scope/1:' + 'a'.repeat(64);
export const otherScopeKey = 'claude-list-scope/1:' + 'b'.repeat(64);
export const markerSource = 'claude-chat-conversations-v2.updated_at/1' as const;
export const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export function target(n = 1) {
  return { conversationId: id(n), marker: { source: markerSource, token: `opaque-${n}` } };
}
export function page(records: unknown[] = [target()]) {
  return {
    kind: 'observed_page' as const,
    schema: 'claude-list-page-observation/1' as const,
    scopeKey,
    records,
  };
}
export function attestation() {
  return {
    schema: CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA,
    evidence: 'manual-personal-scope' as const,
    scopeKey,
    organizationBinding: 'resolved' as const,
    workspaceBinding: 'resolved' as const,
  };
}
export function catalog(
  value: unknown = page(),
  evidence: unknown = attestation(),
  limits?: unknown
): ClaudeBaselineCatalog {
  const result = enumerateClaudeBaselineCatalog(value, evidence, limits);
  expect(result.kind).toBe('catalog');
  if (result.kind !== 'catalog') throw new Error('Expected a catalog');
  return result;
}
export function rejected(value: unknown, reason = 'invalid-input', limits?: unknown) {
  const result = enumerateClaudeBaselineCatalog(value, attestation(), limits);
  expect(result).toEqual({ kind: 'rejected', reason });
  expect(Object.isFrozen(result)).toBe(true);
}
export function unsupported(value: unknown, evidence: unknown, reason: string) {
  const result = enumerateClaudeBaselineCatalog(value, evidence);
  expect(result).toEqual({ kind: 'unsupported', reason });
  expect(Object.isFrozen(result)).toBe(true);
}
