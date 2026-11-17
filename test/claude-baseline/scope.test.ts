// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { enumerateClaudeBaselineCatalog } from '../../src/claude-baseline';
import { attestation, otherScopeKey, page, scopeKey, unsupported } from './fixtures';

describe('manual personal-scope evidence binding', () => {
  it.each([
    { organizationBinding: 'unresolved' },
    { workspaceBinding: 'unresolved' },
    { organizationBinding: 'unresolved', workspaceBinding: 'unresolved' },
  ])('requires both explicitly resolved bindings %j', patch => {
    unsupported(page(), { ...attestation(), ...patch }, 'unresolved-scope');
  });

  it('does not default missing scope evidence to personal', () => {
    const evidence = attestation();
    Reflect.deleteProperty(evidence, 'scopeKey');
    unsupported(page(), evidence, 'unresolved-scope');
    expect(enumerateClaudeBaselineCatalog(page(), undefined)).toEqual({
      kind: 'rejected',
      reason: 'invalid-input',
    });
  });

  it('requires the exact same opaque key without normalization or scope switching', () => {
    unsupported(page(), { ...attestation(), scopeKey: otherScopeKey }, 'scope-mismatch');
    unsupported({ ...page(), scopeKey: otherScopeKey }, attestation(), 'scope-mismatch');
    expect(scopeKey).not.toBe(otherScopeKey);
  });

  it.each([
    'claude-list-scope/2:' + 'a'.repeat(64),
    'claude-list-scope/1:' + 'A'.repeat(64),
    'claude-list-scope/1:' + 'a'.repeat(63),
    'raw-organization-workspace',
    scopeKey + '\n',
  ])('rejects unsupported scope spelling %j on either side', key => {
    unsupported({ ...page(), scopeKey: key }, attestation(), 'unsupported-scope-key');
    unsupported(page(), { ...attestation(), scopeKey: key }, 'unsupported-scope-key');
  });

  it.each([
    { schema: 'liska-claude-personal-scope-attestation/2' },
    { evidence: 'automatic' },
    { evidence: 'manual-work-scope' },
    { evidence: 'authenticated' },
  ])('cannot replace manual personal attestation with %j', patch => {
    unsupported(page(), { ...attestation(), ...patch }, 'unsupported-attestation');
  });

  it.each([
    null,
    {},
    [],
    { ...attestation(), schema: null },
    { ...attestation(), evidence: '' },
    { ...attestation(), scopeKey: null },
    { ...attestation(), scopeKey: '' },
    { ...attestation(), organizationBinding: true },
    { ...attestation(), workspaceBinding: '' },
    { ...attestation(), organizationId: 'private-organization' },
    { ...attestation(), workspaceId: 'private-workspace' },
    { ...attestation(), email: 'private@example.invalid' },
    { ...attestation(), token: 'private-bearer-token' },
  ])('rejects malformed or over-disclosing attestation without leaking its value %j', evidence => {
    const result = enumerateClaudeBaselineCatalog(page(), evidence);
    expect(result).toEqual({ kind: 'rejected', reason: 'invalid-input' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private/u);
  });
});
