import { describe, expect, it } from 'vitest';
import {
  CLAUDE_LIST_PROBE_SCHEMA,
  createClaudeListProbeFailure,
  isClaudeListProbeResponse,
  snapshotClaudeListProbeResult,
  type ClaudeListProbePage,
  type ClaudeListProbeResult,
} from '../../src/lib/claude-list-probe-contract';

const fingerprint = `claude-probe-scope-run-v1-sha256:${'a'.repeat(64)}`;
const otherFingerprint = `claude-probe-scope-run-v1-sha256:${'b'.repeat(64)}`;
const exactHeaderNames = ['anthropic-organization-id', 'anthropic-workspace-id'];
const incompleteHeaderNames = [
  [],
  ...exactHeaderNames.map(name => [name]),
  ['x-organization-id', 'x-workspace-id'],
];

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
    scopeFingerprint: fingerprint,
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
      observed: false,
      fingerprint: null,
      relevantHeaderNames: pages.length > 0 ? [...exactHeaderNames] : [],
    },
  };
}

function scopeObserved(source: ClaudeListProbeResult): ClaudeListProbeResult {
  return {
    ...source,
    code: 'scope-observed',
    scope: { ...source.scope, observed: true, fingerprint },
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
  return scopeObserved(terminalResult);
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
    { ...result(), schema: 'liska-claude-list-probe/4' },
    { ...result(), verificationPresent: 'false' },
    { ...result(), routeOrganizationEvidence: 'private-route-id' },
    { ...result(), code: 'scope-mismatch' },
    { ...result(), code: 'scope-unresolved' },
    { ...result(), status: 'stopped', code: 'auth-verification-required' },
    { ...result(), privateId: 'secret' },
    { ...result(), status: 'complete', code: 'scope-observed' },
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
    { ...result(), scope: { ...result().scope, fingerprint: otherFingerprint } },
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

  it('rejects old schemas and mixed shapes without the exact per-page scope evidence', () => {
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
    const source = result();
    const v4Pages = source.pages.map(({ scopeFingerprint: _fingerprint, ...item }) => item);
    const v4Scope = {
      organizationResolved: false,
      workspaceResolved: false,
      consistent: false,
      routeOrganizationMatched: false,
      fingerprint: null,
      relevantHeaderNames: source.scope.relevantHeaderNames,
    };
    expect(snapshotClaudeListProbeResult({ ...source, pages: v4Pages })).toBeUndefined();
    expect(snapshotClaudeListProbeResult({ ...source, scope: v4Scope })).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...source, pages: [source.pages[0], v4Pages[1]] })
    ).toBeUndefined();
  });

  it.each([null, 0, 'true', {}, false])(
    'requires an exact, positive observed flag (%j)',
    observed => {
      expect(
        snapshotClaudeListProbeResult({ ...result(), scope: { ...result().scope, observed } })
      ).toBeUndefined();
    }
  );

  it.each([
    null,
    undefined,
    {},
    `liska-claude-list-probe-scope/1:${'a'.repeat(64)}`,
    `claude-probe-scope-run-v1-sha256:${'A'.repeat(64)}`,
    `claude-probe-scope-run-v1-sha256:${'a'.repeat(63)}`,
    `claude-probe-scope-run-v1-sha256:${'a'.repeat(65)}`,
    `${fingerprint}\n`,
  ])('rejects malformed page and global fingerprints (%j)', value => {
    const source = result();
    expect(
      snapshotClaudeListProbeResult({ ...source, scope: { ...source.scope, fingerprint: value } })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({
        ...source,
        pages: source.pages.map(page => ({ ...page, scopeFingerprint: value })),
      })
    ).toBeUndefined();
  });

  it('reads neither scope nor page fingerprint accessors', () => {
    const source = result();
    let reads = 0;
    const getter = {
      enumerable: true,
      get: () => {
        reads += 1;
        return fingerprint;
      },
    };
    const scope = Object.defineProperty({ ...source.scope }, 'fingerprint', getter);
    const active = Object.defineProperty({ ...source.pages[0] }, 'scopeFingerprint', getter);
    expect(snapshotClaudeListProbeResult({ ...source, scope })).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...source, pages: [active, source.pages[1]] })
    ).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('requires a shared fingerprint even on a stopped admitted prefix', () => {
    const source = resultWithPages([page('active', 0, true), page('archived', 0)], true, 3);
    expect(snapshotClaudeListProbeResult(source)).toEqual(source);
    expect(
      snapshotClaudeListProbeResult({
        ...source,
        pages: [source.pages[0], { ...source.pages[1], scopeFingerprint: otherFingerprint }],
      })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...source, scope: { ...source.scope, fingerprint } })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...result(), code: 'deadline-exceeded' })
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
    [[active0, archived0, active30, archived30], false, 4, 'scope-observed'],
    [[active0, archived0, active30, page('archived', 30, true)], true, 4, 'budget-exhausted'],
    [[activeTerminal, archived0, archived30], false, 3, 'scope-observed'],
    [[active0, archivedTerminal, active30], false, 3, 'scope-observed'],
    [[active0, archivedTerminal, page('active', 30, true)], true, 3, 'pagination-unfinished'],
  ] as const)(
    'accepts an exact schedule or early-stop prefix %#',
    (pages, unfinished, dispatch, code) => {
      const base = resultWithPages(pages, unfinished, dispatch);
      const source = code === 'scope-observed' ? scopeObserved(base) : { ...base, code };
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

  it.each(['response-too-large', 'scope-header-invalid', 'scope-route-mismatch'])(
    'requires one unadmitted dispatch and both exact names for %s, even on page zero',
    code => {
      for (const pages of [[], [activeTerminal]]) {
        const base = resultWithPages(pages, false, pages.length + 1);
        const failure = {
          ...base,
          code,
          scope: { ...base.scope, relevantHeaderNames: [...exactHeaderNames, 'x-workspace-id'] },
        };
        const withoutFailure = { ...resultWithPages(pages), code };
        expect(snapshotClaudeListProbeResult(failure)).toEqual(failure);
        expect(snapshotClaudeListProbeResult(withoutFailure)).toBeUndefined();
        expect(
          snapshotClaudeListProbeResult({ ...failure, routeOrganizationEvidence: 'unresolved' })
        ).toBeUndefined();
        for (const relevantHeaderNames of incompleteHeaderNames) {
          expect(
            snapshotClaudeListProbeResult({
              ...failure,
              scope: { ...failure.scope, relevantHeaderNames },
            })
          ).toBeUndefined();
        }
      }
    }
  );

  it('allows missing-header outcomes with one unadmitted dispatch and honest aggregate names', () => {
    const code = 'scope-header-missing';
    const first = { ...resultWithPages([], false, 1), code };
    for (const relevantHeaderNames of incompleteHeaderNames) {
      const source = { ...first, scope: { ...first.scope, relevantHeaderNames } };
      expect(snapshotClaudeListProbeResult(source)).toEqual(source);
    }
    expect(
      snapshotClaudeListProbeResult({
        ...first,
        scope: { ...first.scope, relevantHeaderNames: exactHeaderNames },
      })
    ).toBeUndefined();
    const later = { ...resultWithPages([activeTerminal], false, 2), code };
    expect(snapshotClaudeListProbeResult(later)).toEqual(later);
    expect(snapshotClaudeListProbeResult({ ...later, scope: first.scope })).toBeUndefined();
    expect(snapshotClaudeListProbeResult({ ...resultWithPages([]), code })).toBeUndefined();
  });

  it('requires a previously admitted page plus one unadmitted dispatch for pair mismatch', () => {
    const code = 'scope-pair-mismatch';
    const admissible = { ...resultWithPages([active0], true, 2), code };
    expect(snapshotClaudeListProbeResult(admissible)).toEqual(admissible);
    expect(
      snapshotClaudeListProbeResult({
        ...admissible,
        scope: { ...admissible.scope, relevantHeaderNames: [] },
      })
    ).toBeUndefined();
    const first = resultWithPages([], false, 1);
    expect(
      snapshotClaudeListProbeResult({ ...first, code, scope: admissible.scope })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages([active0], true), code })
    ).toBeUndefined();
  });

  it('allows crypto failure only at resolved-route preflight or first-page digest', () => {
    const code = 'scope-crypto-failed';
    const preflight = { ...resultWithPages([]), code };
    const afterDispatch = { ...resultWithPages([], false, 1), code };
    const digestFailure = {
      ...afterDispatch,
      scope: { ...afterDispatch.scope, relevantHeaderNames: exactHeaderNames },
    };
    expect(snapshotClaudeListProbeResult(preflight)).toEqual(preflight);
    expect(snapshotClaudeListProbeResult(digestFailure)).toEqual(digestFailure);
    for (const relevantHeaderNames of incompleteHeaderNames) {
      expect(
        snapshotClaudeListProbeResult({
          ...afterDispatch,
          scope: { ...afterDispatch.scope, relevantHeaderNames },
        })
      ).toBeUndefined();
    }
    expect(
      snapshotClaudeListProbeResult({ ...preflight, routeOrganizationEvidence: 'unresolved' })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...preflight, scope: digestFailure.scope })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages([activeTerminal]), code })
    ).toBeUndefined();
    expect(
      snapshotClaudeListProbeResult({ ...resultWithPages([activeTerminal], false, 2), code })
    ).toBeUndefined();
  });

  it('requires the exact two header names for terminal scope observation', () => {
    const source = result();
    const names = [...exactHeaderNames, 'x-workspace-id'];
    const withNames = { ...source, scope: { ...source.scope, relevantHeaderNames: names } };
    expect(snapshotClaudeListProbeResult(withNames)).toEqual(withNames);
    for (const relevantHeaderNames of incompleteHeaderNames) {
      expect(
        snapshotClaudeListProbeResult({
          ...source,
          scope: { ...source.scope, relevantHeaderNames },
        })
      ).toBeUndefined();
    }
    expect(
      snapshotClaudeListProbeResult({
        ...source,
        scope: { ...source.scope, observed: false, fingerprint: null },
      })
    ).toBeUndefined();
  });

  it.each(['navigation-changed', 'deadline-exceeded', 'response-schema-invalid'])(
    'allows %s before a dispatch or on an unadmitted response after headers',
    code => {
      const before = { ...resultWithPages([]), code, routeOrganizationEvidence: 'unresolved' };
      const after = { ...resultWithPages([], false, 1), code };
      const afterAdmitted = { ...resultWithPages([activeTerminal]), code };
      expect(snapshotClaudeListProbeResult(before)).toEqual(before);
      expect(snapshotClaudeListProbeResult(afterAdmitted)).toEqual(afterAdmitted);
      expect(
        snapshotClaudeListProbeResult({ ...after, routeOrganizationEvidence: 'unresolved' })
      ).toBeUndefined();
      for (const relevantHeaderNames of [...incompleteHeaderNames, exactHeaderNames]) {
        const scope = { ...after.scope, relevantHeaderNames };
        const candidate = { ...after, scope };
        expect(snapshotClaudeListProbeResult(candidate)).toEqual(candidate);
        if (relevantHeaderNames.length > 0)
          expect(snapshotClaudeListProbeResult({ ...before, scope })).toBeUndefined();
        if (relevantHeaderNames !== exactHeaderNames)
          expect(snapshotClaudeListProbeResult({ ...afterAdmitted, scope })).toBeUndefined();
      }
    }
  );

  const activeMoreAt30 = page('active', 30, true);
  it.each([
    [[activeTerminal], false, 'scope-observed'],
    [[active0, archivedTerminal, activeMoreAt30], true, 'scope-observed'],
    [[active0, archivedTerminal], true, 'pagination-unfinished'],
    [[active0, archivedTerminal, active30], false, 'pagination-unfinished'],
    [[active0, archived0, activeMoreAt30, archived30], true, 'pagination-unfinished'],
    [[active0, archivedTerminal, activeMoreAt30], true, 'budget-exhausted'],
    [[active0, archived0, active30, archived30], false, 'budget-exhausted'],
  ] as const)('rejects contradictory completed-schedule outcomes %#', (pages, unfinished, code) => {
    const base = resultWithPages(pages, unfinished);
    const candidate = code === 'scope-observed' ? scopeObserved(base) : { ...base, code };
    expect(snapshotClaudeListProbeResult(candidate)).toBeUndefined();
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
