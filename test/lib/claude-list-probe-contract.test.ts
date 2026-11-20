import { describe, expect, it } from 'vitest';
import {
  CLAUDE_LIST_PROBE_SCHEMA,
  createClaudeListProbeFailure,
  isClaudeListProbeResponse,
  snapshotClaudeListProbeResult,
  type ClaudeListProbePage,
  type ClaudeListProbeResult,
} from '../../src/lib/claude-list-probe-contract';

const fingerprint = `liska-claude-list-probe-scope/1:${'a'.repeat(64)}`;

function page(
  partition: ClaudeListProbePage['partition'],
  offset: ClaudeListProbePage['offset'],
  hasMore = false,
  overrides: Partial<ClaudeListProbePage['counts']> = {}
): ClaudeListProbePage {
  return {
    partition,
    offset,
    hasMore,
    terminal: !hasMore,
    counts: {
      record: 0,
      validUuid: 0,
      marker: 0,
      archivedFlag: 0,
      archivedMismatch: 0,
      ...overrides,
    },
  };
}

function resultWithPages(
  pages: readonly ClaudeListProbePage[],
  unfinished = false,
  dispatch = pages.length
): ClaudeListProbeResult {
  const exercised = pages.some(item => item.offset === 30);
  const sum = (key: keyof ClaudeListProbePage['counts']) =>
    pages.reduce((total, item) => total + item.counts[key], 0);
  return {
    schema: CLAUDE_LIST_PROBE_SCHEMA,
    status: 'stopped',
    code: 'deadline-exceeded',
    verificationPresent: false,
    routeOrganizationEvidence: 'resource-timing',
    counts: {
      dispatch,
      page: pages.length,
      record: sum('record'),
      validUuid: sum('validUuid'),
      marker: sum('marker'),
      duplicate: 0,
      overlap: 0,
      archivedFlag: sum('archivedFlag'),
      archivedMismatch: sum('archivedMismatch'),
    },
    pages,
    pagination: {
      exercised,
      hypothesis: exercised ? 'offset-plus-30' : 'not-exercised',
      unfinished,
    },
    scope: {
      organizationResolved: false,
      workspaceResolved: false,
      consistent: false,
      routeOrganizationMatched: false,
      fingerprint: null,
      relevantHeaderNames: pages.length > 0 ? ['x-organization-id', 'x-workspace-id'] : [],
    },
  };
}

function result() {
  const terminalResult = resultWithPages([
    page('active', 0, false, {
      record: 2,
      validUuid: 1,
      marker: 1,
      archivedFlag: 1,
      archivedMismatch: 1,
    }),
    page('archived', 0, false, { record: 1, validUuid: 1, marker: 1, archivedFlag: 1 }),
  ]);
  return { ...terminalResult, code: 'scope-unresolved' as const };
}

describe('Claude list probe content-free contract', () => {
  it('returns a detached exact snapshot and accepts only the closed response envelope', () => {
    const source = result();
    const snapshot = snapshotClaudeListProbeResult(source);
    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot?.counts).not.toBe(source.counts);
    expect(snapshot?.pages).not.toBe(source.pages);
    expect(snapshot?.pages[0]).not.toBe(source.pages[0]);
    expect(snapshot?.pages[0].counts).not.toBe(source.pages[0].counts);
    expect(isClaudeListProbeResponse({ success: true, data: source })).toBe(true);
    expect(isClaudeListProbeResponse(createClaudeListProbeFailure('invalid-sender'))).toBe(true);
  });

  it.each([
    { extra: true },
    { ...result(), schema: 'liska-claude-list-probe/1' },
    { ...result(), schema: 'liska-claude-list-probe/2' },
    { ...result(), schema: 'liska-claude-list-probe/3' },
    { ...result(), verificationPresent: 'false' },
    { ...result(), routeOrganizationEvidence: 'private-route-id' },
    { ...result(), code: 'scope-mismatch' },
    { ...result(), status: 'stopped', code: 'auth-verification-required' },
    { ...result(), privateId: 'secret' },
    { ...result(), status: 'complete', code: 'scope-unresolved' },
    { ...result(), status: 'complete', code: 'ok' },
    { ...result(), status: 'stopped', code: 'ok' },
    { ...result(), counts: { ...result().counts, dispatch: 5 } },
    { ...result(), counts: { ...result().counts, dispatch: 1 } },
    { ...result(), counts: { ...result().counts, page: 1 } },
    { ...result(), pages: [{ ...result().pages[0], terminal: false }, result().pages[1]] },
    {
      ...result(),
      pagination: { exercised: true, hypothesis: 'offset-plus-30', unfinished: false },
    },
    { ...result(), pagination: { ...result().pagination, unfinished: true } },
    { ...result(), scope: { ...result().scope, fingerprint } },
    { ...result(), scope: { ...result().scope, fingerprint: 'raw-private-scope' } },
    {
      ...result(),
      scope: { ...result().scope, relevantHeaderNames: ['authorization'] },
    },
    {
      ...result(),
      scope: { ...result().scope, relevantHeaderNames: ['x-workspace-id', 'x-organization-id'] },
    },
    {
      ...result(),
      scope: { ...result().scope, relevantHeaderNames: ['x-org-id', 'x-org-id'] },
    },
    {
      ...result(),
      scope: {
        ...result().scope,
        relevantHeaderNames: Array.from({ length: 9 }, (_, index) => `x-org-${index}`),
      },
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
    const source = result();
    const pageCounts = { ...source.pages[0].counts };
    let nestedReads = 0;
    Object.defineProperty(pageCounts, 'archivedFlag', {
      enumerable: true,
      get: () => {
        nestedReads += 1;
        return 1;
      },
    });
    expect(
      snapshotClaudeListProbeResult({
        ...source,
        pages: [{ ...source.pages[0], counts: pageCounts }, source.pages[1]],
      })
    ).toBeUndefined();
    expect(nestedReads).toBe(0);
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

  it('rejects reviewed v1/v2 and old/new mixed shapes without per-page evidence', () => {
    const {
      verificationPresent: _verificationPresent,
      routeOrganizationEvidence: _routeOrganizationEvidence,
      ...v1
    } = result();
    const { routeOrganizationEvidence: _routeEvidence, ...v2 } = result();
    expect(
      snapshotClaudeListProbeResult({
        ...v1,
        schema: 'liska-claude-list-probe/1',
      })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...v2, schema: 'liska-claude-list-probe/2' })
    ).toBeUndefined();
    expect(snapshotClaudeListProbeResult(v2)).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({
        ...v1,
        schema: CLAUDE_LIST_PROBE_SCHEMA,
        verification: { present: true },
      })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({
        ...result(),
        schema: 'liska-claude-list-probe/2',
        routeOrganizationEvidence: 'resource-timing',
      })
    ).toBeUndefined();
    const { archivedFlag: _flag, ...oldCounts } = result().counts;
    const oldPages = result().pages.map(({ counts: _counts, ...item }) => item);
    expect(snapshotClaudeListProbeResult({ ...result(), counts: oldCounts })).toBeUndefined();
    expect(snapshotClaudeListProbeResult({ ...result(), pages: oldPages })).toBeUndefined();
  });

  it.each([
    'organizationResolved',
    'workspaceResolved',
    'consistent',
    'routeOrganizationMatched',
  ] as const)('rejects a positive %s even with all other scope flags false', key => {
    expect(
      snapshotClaudeListProbeResult({ ...result(), scope: { ...result().scope, [key]: true } })
    ).toBeUndefined();
  });

  it.each(['record', 'validUuid', 'marker', 'archivedFlag', 'archivedMismatch'] as const)(
    'requires global %s to match its page total',
    key => {
      const source = result();
      const counts = { ...source.counts, [key]: source.counts[key] + 1 };
      expect(snapshotClaudeListProbeResult({ ...source, counts })).toBeUndefined();
    }
  );

  it.each([
    { active: 1, archived: 1, overlap: 1, duplicate: 0, valid: true },
    { active: 1, archived: 1, overlap: 1, duplicate: 1, valid: false },
    { active: 2, archived: 1, overlap: 1, duplicate: 1, valid: true },
    { active: 3, archived: 0, overlap: 0, duplicate: 2, valid: true },
    { active: 3, archived: 0, overlap: 0, duplicate: 3, valid: false },
    { active: 5, archived: 1, overlap: 2, duplicate: 0, valid: false },
    { active: 3, archived: 0, overlap: 1, duplicate: 0, valid: false },
    { active: 1, archived: 1, overlap: 2, duplicate: 1, valid: false },
  ])(
    'requires feasible UUID totals for active=$active archived=$archived overlap=$overlap duplicate=$duplicate',
    ({ active, archived, overlap, duplicate, valid }) => {
      const source = resultWithPages([
        page('active', 0, false, { record: active, validUuid: active }),
        page('archived', 0, false, { record: archived, validUuid: archived }),
      ]);
      const result = { ...source, counts: { ...source.counts, overlap, duplicate } };
      expect(snapshotClaudeListProbeResult(result)).toEqual(valid ? result : undefined);
    }
  );

  it.each([
    { record: 31 },
    { record: 0, validUuid: 1 },
    { record: 0, marker: 1 },
    { record: 0, archivedFlag: 1 },
    { record: 1, archivedFlag: 0, archivedMismatch: 1 },
    { record: 0.5 },
  ])('rejects malformed or out-of-bounds page counts %#', overrides => {
    const source = resultWithPages([
      page('active', 0, false, overrides),
      page('archived', 0, false, { record: 3, validUuid: 1, archivedFlag: 1 }),
    ]);
    expect(snapshotClaudeListProbeResult(source)).toBeUndefined();
  });

  it.each(['duplicate', 'overlap', 'rawMarker'])('rejects %s in a page count object', key => {
    const source = result();
    const counts = { ...source.pages[0].counts, [key]: 0 };
    const pages = [{ ...source.pages[0], counts }, source.pages[1]];
    expect(snapshotClaudeListProbeResult({ ...source, pages })).toBeUndefined();
  });

  it('rejects a missing archivedFlag count even when it would be zero', () => {
    const source = resultWithPages([page('active', 0)]);
    const { archivedFlag: _flag, ...counts } = source.pages[0].counts;
    expect(
      snapshotClaudeListProbeResult({ ...source, pages: [{ ...source.pages[0], counts }] })
    ).toBeUndefined();
  });

  const active0 = page('active', 0, true);
  const archived0 = page('archived', 0, true);
  const active30 = page('active', 30);
  const archived30 = page('archived', 30);
  const activeTerminal = page('active', 0);
  const archivedTerminal = page('archived', 0);

  it.each([
    [[], false, 0, 'deadline-exceeded'],
    [[], false, 1, 'request-failed'],
    [[activeTerminal], false, 1, 'deadline-exceeded'],
    [[activeTerminal], false, 2, 'request-failed'],
    [[active0], true, 2, 'request-failed'],
    [[active0, archived0], true, 2, 'deadline-exceeded'],
    [[active0, archived0], true, 3, 'request-failed'],
    [[active0, archived0, active30], true, 4, 'request-failed'],
    [[active0, archived0, active30, archived30], false, 4, 'scope-unresolved'],
    [[active0, archived0, active30, page('archived', 30, true)], true, 4, 'budget-exhausted'],
    [[activeTerminal, archived0, archived30], false, 3, 'scope-unresolved'],
    [[active0, archivedTerminal, active30], false, 3, 'scope-unresolved'],
    [[active0, archivedTerminal, page('active', 30, true)], true, 3, 'pagination-unfinished'],
  ] as const)(
    'accepts an exact schedule or early-stop prefix %#',
    (pages, unfinished, dispatch, code) => {
      const source = { ...resultWithPages(pages, unfinished, dispatch), code };
      expect(snapshotClaudeListProbeResult(source)).toEqual(source);
      const wrongUnfinished = {
        ...source,
        pagination: { ...source.pagination, unfinished: !unfinished },
      };
      expect(snapshotClaudeListProbeResult(wrongUnfinished)).toBeUndefined();
    }
  );

  it.each([
    [[], false, 4, 'deadline-exceeded'],
    [[active0], true, 3, 'request-failed'],
    [[activeTerminal, archivedTerminal], false, 3, 'request-failed'],
    [[active0, archivedTerminal, page('active', 30, true)], true, 4, 'unexpected-status'],
    [[active0, archived0, active30, archived30], false, 4, 'request-failed'],
    [[active0], true, 1, 'request-failed'],
  ] as const)(
    'rejects unadmitted dispatches outside the serial schedule %#',
    (pages, unfinished, dispatch, code) => {
      const source = { ...resultWithPages(pages, unfinished, dispatch), code };
      expect(snapshotClaudeListProbeResult(source)).toBeUndefined();
    }
  );

  it('requires no route hint, dispatch, page or header names for the route-organization stop', () => {
    const source = { ...resultWithPages([]), code: 'route-organization-unresolved' };
    const unresolved = { ...source, routeOrganizationEvidence: 'unresolved' };
    expect(snapshotClaudeListProbeResult(unresolved)).toEqual(unresolved);
    expect(snapshotClaudeListProbeResult(source)).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages([], false, 1), code: source.code })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages([activeTerminal]), code: source.code })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({
        ...unresolved,
        scope: { ...unresolved.scope, relevantHeaderNames: ['x-workspace-id'] },
      })
    ).toBeUndefined();
  });

  it.each([
    'request-failed',
    'auth-required',
    'rate-limited',
    'unexpected-status',
    'unexpected-redirect',
    'unexpected-media-type',
  ])('requires one unadmitted dispatch and only prior header evidence for %s', code => {
    const first = { ...resultWithPages([], false, 1), code };
    const later = { ...resultWithPages([activeTerminal], false, 2), code };
    expect(snapshotClaudeListProbeResult(first)).toEqual(first);
    expect(snapshotClaudeListProbeResult(later)).toEqual(later);
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages([activeTerminal]), code })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...first, routeOrganizationEvidence: 'unresolved' })
    ).toBeUndefined();
    expect(snapshotClaudeListProbeResult({ ...first, scope: later.scope })).toBeUndefined();
  });

  it('retains optional header names from an oversized unadmitted response', () => {
    const first = { ...resultWithPages([], false, 1), code: 'response-too-large' };
    const withNames = {
      ...first,
      scope: { ...first.scope, relevantHeaderNames: ['x-workspace-id'] },
    };
    expect(snapshotClaudeListProbeResult(first)).toEqual(first);
    expect(snapshotClaudeListProbeResult(withNames)).toEqual(withNames);
    expect(
      snapshotClaudeListProbeResult({ ...withNames, routeOrganizationEvidence: 'unresolved' })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages([activeTerminal]), code: first.code })
    ).toBeUndefined();
  });

  it.each(['navigation-changed', 'deadline-exceeded', 'response-schema-invalid'])(
    'allows %s before a dispatch or on an unadmitted response after headers',
    code => {
      const before = { ...resultWithPages([]), code, routeOrganizationEvidence: 'unresolved' };
      const after = {
        ...resultWithPages([], false, 1),
        code,
        scope: { ...before.scope, relevantHeaderNames: ['x-workspace-id'] },
      };
      const afterAdmitted = { ...resultWithPages([activeTerminal]), code };
      expect(snapshotClaudeListProbeResult(before)).toEqual(before);
      expect(snapshotClaudeListProbeResult(after)).toEqual(after);
      expect(snapshotClaudeListProbeResult(afterAdmitted)).toEqual(afterAdmitted);
      expect(snapshotClaudeListProbeResult({ ...before, scope: after.scope })).toBeUndefined();
      expect(
        snapshotClaudeListProbeResult({ ...after, routeOrganizationEvidence: 'unresolved' })
      ).toBeUndefined();
    }
  );

  const activeMoreAt30 = page('active', 30, true);
  it.each([
    [[activeTerminal], false, 'scope-unresolved'],
    [[active0, archivedTerminal, activeMoreAt30], true, 'scope-unresolved'],
    [[active0, archivedTerminal], true, 'pagination-unfinished'],
    [[active0, archivedTerminal, active30], false, 'pagination-unfinished'],
    [[active0, archived0, activeMoreAt30, archived30], true, 'pagination-unfinished'],
    [[active0, archivedTerminal, activeMoreAt30], true, 'budget-exhausted'],
    [[active0, archived0, active30, archived30], false, 'budget-exhausted'],
  ] as const)('rejects contradictory completed-schedule outcomes %#', (pages, unfinished, code) => {
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages(pages, unfinished), code })
    ).toBeUndefined();
  });

  it.each([
    { pages: [archived0, active0], unfinished: true },
    { pages: [active0, active30], unfinished: false },
    { pages: [active0, active0], unfinished: true },
    { pages: [active0, archived0, archived30], unfinished: true },
    { pages: [active0, archived0, archived30, active30], unfinished: false },
    { pages: [active0, archived0, active30, active30], unfinished: true },
    { pages: [page('active', 0), archived0, active30, archived30], unfinished: false },
    { pages: [active0, page('archived', 0), active30, archived30], unfinished: false },
    { pages: [page('active', 0), page('archived', 0), active30], unfinished: false },
  ])('rejects reordered, repeated or unjustified offsets %#', ({ pages, unfinished }) => {
    expect(snapshotClaudeListProbeResult(resultWithPages(pages, unfinished))).toBeUndefined();
  });

  it('requires both offset use and its hypothesis to agree with admitted pages', () => {
    const source = resultWithPages([active0, archived0, active30, archived30]);
    expect(
      snapshotClaudeListProbeResult({
        ...source,
        pagination: { ...source.pagination, exercised: false },
      })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({
        ...source,
        pagination: { ...source.pagination, hypothesis: 'not-exercised' },
      })
    ).toBeUndefined();
  });
});
