import { describe, expect, it } from 'vitest';
import {
  CLAUDE_LIST_PROBE_SCHEMA,
  createClaudeListProbeFailure,
  isClaudeListProbeResponse,
  snapshotClaudeListProbeResult,
} from '../../src/lib/claude-list-probe-contract';

const fingerprint = `liska-claude-list-probe-scope/1:${'a'.repeat(64)}`;

function result() {
  return {
    schema: CLAUDE_LIST_PROBE_SCHEMA,
    status: 'complete' as const,
    code: 'ok' as const,
    verificationPresent: false,
    counts: {
      dispatch: 2,
      page: 2,
      record: 3,
      validUuid: 3,
      marker: 2,
      duplicate: 0,
      overlap: 0,
      archivedMismatch: 0,
    },
    pages: [
      { partition: 'active' as const, offset: 0 as const, hasMore: false, terminal: true },
      { partition: 'archived' as const, offset: 0 as const, hasMore: false, terminal: true },
    ],
    pagination: {
      exercised: false,
      hypothesis: 'not-exercised' as const,
      unfinished: false,
    },
    scope: {
      organizationResolved: true,
      workspaceResolved: true,
      consistent: true,
      routeOrganizationMatched: true,
      fingerprint,
      relevantHeaderNames: ['x-organization-id', 'x-workspace-id'],
    },
  };
}

describe('Claude list probe content-free contract', () => {
  it('returns a detached exact snapshot and accepts only the closed response envelope', () => {
    const source = result();
    const snapshot = snapshotClaudeListProbeResult(source);
    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot?.counts).not.toBe(source.counts);
    expect(isClaudeListProbeResponse({ success: true, data: source })).toBe(true);
    expect(isClaudeListProbeResponse(createClaudeListProbeFailure('invalid-sender'))).toBe(true);
  });

  it.each([
    { extra: true },
    { ...result(), schema: 'liska-claude-list-probe/1' },
    { ...result(), verificationPresent: 'false' },
    { ...result(), status: 'stopped', code: 'auth-verification-required' },
    { ...result(), privateId: 'secret' },
    { ...result(), status: 'complete', code: 'scope-unresolved' },
    { ...result(), counts: { ...result().counts, dispatch: 5 } },
    { ...result(), counts: { ...result().counts, page: 1 } },
    { ...result(), pages: [{ ...result().pages[0], terminal: false }] },
    {
      ...result(),
      pagination: { exercised: true, hypothesis: 'offset-plus-30', unfinished: false },
    },
    { ...result(), scope: { ...result().scope, fingerprint: 'raw-private-scope' } },
    {
      ...result(),
      scope: { ...result().scope, relevantHeaderNames: ['authorization'] },
    },
    {
      ...result(),
      scope: { ...result().scope, relevantHeaderNames: ['x-workspace-id', 'x-organization-id'] },
    },
  ])('rejects malformed, over-budget or privacy-expanding result %#', value => {
    expect(snapshotClaudeListProbeResult(value)).toBeUndefined();
  });

  it('rejects accessors, symbols, exotic prototypes and extra response fields without invoking them', () => {
    const getter = () => {
      throw new Error('must not run');
    };
    const accessor = { ...result() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'code', { enumerable: true, get: getter });
    expect(snapshotClaudeListProbeResult(accessor)).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult(Object.assign(Object.create({}), result()))
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...result(), [Symbol('private')]: true })
    ).toBeUndefined();
    const hostile = new Proxy(result(), {
      ownKeys: () => {
        throw new Error('private proxy detail');
      },
    });
    expect(snapshotClaudeListProbeResult(hostile)).toBeUndefined();
    expect(isClaudeListProbeResponse(hostile)).toBe(false);
    expect(
      isClaudeListProbeResponse({ success: false, code: 'invalid-sender', detail: 'private' })
    ).toBe(false);
  });

  it('rejects the reviewed v1 shape and every old/new mixed shape', () => {
    const { verificationPresent: _verificationPresent, ...withoutVerification } = result();
    expect(
      snapshotClaudeListProbeResult({
        ...withoutVerification,
        schema: 'liska-claude-list-probe/1',
      })
    ).toBeUndefined();
    expect(snapshotClaudeListProbeResult(withoutVerification)).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({
        ...withoutVerification,
        schema: CLAUDE_LIST_PROBE_SCHEMA,
        verification: { present: true },
      })
    ).toBeUndefined();
  });

  it('allows unresolved scope only without a fingerprint', () => {
    const unresolved = {
      ...result(),
      status: 'stopped' as const,
      code: 'scope-unresolved' as const,
      scope: {
        organizationResolved: false,
        workspaceResolved: true,
        consistent: false,
        routeOrganizationMatched: false,
        fingerprint: null,
        relevantHeaderNames: ['x-org-id', 'x-organization-id', 'x-workspace-id'],
      },
    };
    expect(snapshotClaudeListProbeResult(unresolved)).toEqual(unresolved);
  });
});
