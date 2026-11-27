import { describe, expect, it, vi } from 'vitest';
import {
  collectorSummary,
  snapshotCollectorSummary,
  isCollectorMessage,
  PAGE_STOP_CODES,
  COLLECTOR_CODES,
  type CollectorCode,
} from '../../src/lib/claude-account-collector-contract';
import { snapshotCollectorProjection as snapshotPrivate } from '../../src/background/claude-account-collector-projection';
const snapshotCollectorProjection = (v: unknown) => snapshotPrivate(v, uuid);

const org = '22222222-2222-4222-8222-222222222222',
  uuid = '11111111-1111-4111-8111-111111111111';
const projected = () => ({
  kind: 'projected',
  routeOrganization: org,
  organization: org,
  workspace: 'workspace',
  active: [{ uuid, is_archived: false, updated_at: 'marker' }],
});
const saved = () => collectorSummary('saved', { dispatch: 2, page: 2, target: 1, marker: 1 });
describe('closed collector boundaries', () => {
  it('snapshots fresh primitives, not the original public record', () => {
    const input = saved(),
      snapshot = snapshotCollectorSummary(input);
    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
  });
  it('rejects impossible evidence and authority, exception prose and private fields', () => {
    for (const changed of [
      { code: 'private text' },
      { schema: '5' },
      { status: 'stopped' },
      { dispatch: 1 },
      { page: 1 },
      { marker: 2 },
      { target: 31 },
      { detailRequests: 1 },
      { executionAuthorized: true },
      { accountComplete: true },
      { downloads: 2 },
      { retention: 'not-confirmed' },
      { pairMatched: false },
      { archivedTerminalEmpty: false },
      { activeTerminal: false },
      { workspace: 'private' },
    ])
      expect(snapshotCollectorSummary({ ...saved(), ...changed })).toBeUndefined();
    expect(snapshotCollectorSummary(projected())).toBeUndefined();
  });
  it('never evaluates own accessors, symbols, hidden extras, inherited properties or throwing proxies', () => {
    const getter = vi.fn(() => {
      throw Error('private');
    });
    for (const [make, snapshot] of [
      [saved, snapshotCollectorSummary],
      [projected, snapshotCollectorProjection],
    ] as const) {
      const input = make();
      const key = Object.keys(input)[0];
      for (const value of [
        Object.defineProperty({ ...input }, key, { get: getter }),
        Object.defineProperty({ ...input }, 'private', { value: 1 }),
        { ...input, [Symbol()]: 1 },
        Object.assign(Object.create(input), input),
        new Proxy(input, { ownKeys: getter }),
      ]) {
        expect(snapshot(value)).toBeUndefined();
      }
    }
    expect(getter).toHaveBeenCalledTimes(2); // only the two unavoidably observable ownKeys traps
  });
  it('accepts only action plus a closed click source, never reads extra properties', () => {
    const source = { tabId: 17, windowId: 3, url: 'https://claude.ai/chat/' + uuid };
    const m = {
        action: 'collectClaudeAccountCatalog',
        source,
        slot: { kind: 'existing', slotId: 'account-slot/1:' + 'a'.repeat(32) },
      },
      get = vi.fn();
    expect(isCollectorMessage(m)).toBe(true);
    expect(isCollectorMessage({ action: m.action })).toBe(false);
    for (const bad of [
      { ...source, tabId: -1 },
      { ...source, windowId: -0 },
      { ...source, url: source.url + '\n' },
      { ...source, url: source.url + '?x' },
      { ...source, url: 'https://claude.ai/chat/' + uuid.replace('1', 'A') },
      { ...source, scope: 'private' },
      Object.defineProperty({ ...source }, 'url', { get }),
    ]) {
      expect(isCollectorMessage({ ...m, source: bad })).toBe(false);
    }
    expect(isCollectorMessage(Object.defineProperty({ ...m }, 'tabId', { get }))).toBe(false);
    expect(
      isCollectorMessage({ ...m, manualAttestation: 'manual-same-visible-personal-context' })
    ).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
  it('requires positive membership even on a shaped private success projection', () => {
    const p = projected();
    expect(snapshotCollectorProjection({ ...p, active: [] })).toBeUndefined();
    expect(snapshotPrivate(p, org)).toBeUndefined();
  });
  it('checks the complete code/stage grid independently at public and private stopped boundaries', () => {
    // Stage indexes: before dispatch, active in progress, active terminal, archive in progress, both terminal.
    const grid = [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ];
    const expected: [number[], CollectorCode[]][] = [
      [
        [0],
        [
          'route-organization-unresolved',
          'invalid-message',
          'invalid-sender',
          'permission-unavailable',
          'active-tab-required',
          'claude-route-required',
          'document-unavailable',
          'operation-in-progress',
          'result-invalid',
        ],
      ],
      [
        [1, 3],
        [
          'request-failed',
          'auth-required',
          'rate-limited',
          'unexpected-status',
          'unexpected-redirect',
          'unexpected-media-type',
          'response-too-large',
          'response-schema-invalid',
          'scope-header-missing',
          'scope-header-invalid',
          'scope-route-mismatch',
        ],
      ],
      [[1], ['active-pagination-unsupported']],
      [[2], ['selected-chat-not-in-active-list']],
      [[2, 4], ['route-evidence-changed']],
      [
        [3],
        ['scope-pair-mismatch', 'archived-pagination-unsupported', 'nonempty-archived-unsupported'],
      ],
      [
        [4],
        [
          'admission-rejected',
          'hash-failed',
          'scoped-owner-already-present',
          'slot-missing',
          'slot-scope-mismatch',
          'scoped-read-unknown',
          'scoped-store-unavailable',
          'scoped-store-corrupt',
          'scoped-store-unsupported',
          'scoped-capacity',
          'scoped-quota',
          'existing-context-changed',
          'existing-verification-deadline',
          'existing-verification-unavailable',
          'owner-conflict',
          'owner-aborted',
          'owner-outcome-unknown',
          'owner-create-refused',
          'committed-context-changed',
          'committed-verification-deadline',
          'committed-verification-unavailable',
          'saved',
        ],
      ],
      [
        [0, 1, 2, 3, 4],
        [
          'document-replaced',
          'source-verification-unavailable',
          'navigation-changed',
          'deadline-exceeded',
        ],
      ],
    ];
    expect(expected.flatMap(([, listed]) => listed).sort()).toEqual([...COLLECTOR_CODES].sort());
    for (const [allowed, codes] of expected)
      for (const code of codes)
        grid.forEach(([dispatch, page], i) => {
          const progress = { dispatch, page, target: page > 0 ? 1 : 0, marker: 0 };
          const publicResult = collectorSummary(code, progress);
          expect(!!snapshotCollectorSummary(publicResult), code + ' ' + i).toBe(
            allowed.includes(i)
          );
          expect(
            snapshotCollectorSummary({
              ...publicResult,
              status: publicResult.status === 'saved' ? 'stopped' : 'saved',
            })
          ).toBeUndefined();
          expect(
            !!snapshotCollectorProjection({ kind: 'stopped', code, ...progress }),
            code + ' ' + i
          ).toBe(allowed.includes(i) && PAGE_STOP_CODES.some(c => c === code));
        });
    expect(
      snapshotCollectorSummary(
        collectorSummary('saved', { dispatch: 2, page: 2, target: 0, marker: 0 })
      )
    ).toBeUndefined();
  });
  it('does not turn unavailable verification into evidence of an impossible request schedule', () => {
    for (const [dispatch, page, target] of [
      [0, 1, 1],
      [1, 2, 1],
      [2, 0, 0],
      [3, 2, 1],
      [2, 1, 0],
    ]) {
      expect(
        snapshotCollectorSummary(
          collectorSummary('source-verification-unavailable', { dispatch, page, target, marker: 0 })
        )
      ).toBeUndefined();
    }
  });
  it('snapshots only one private closed projection and does not share its mutable input', () => {
    const input = projected(),
      snapshot = snapshotCollectorProjection(input);
    input.active[0].updated_at = 'changed';
    expect(snapshot).toMatchObject({
      kind: 'projected',
      progress: { dispatch: 2, page: 2, target: 1, marker: 1 },
      input: { activePage: { body: { data: [{ updated_at: 'marker' }] } } },
    });
    expect(snapshot).not.toHaveProperty('input.manualAttestation');
  });
  it('rejects bad pair, row flags, markers, extra fields, arrays and owner/receipt-shaped objects', () => {
    const p = projected(),
      row = p.active[0],
      getter = vi.fn();
    for (const value of [
      { ...p, workspace: 'a b' },
      { ...p, organization: uuid },
      { ...p, manualAttestation: 'forged' },
      { ...p, active: [{ ...row, title: 'private' }] },
      { ...p, active: [row, row] },
      { ...p, active: [{ ...row, is_archived: true }] },
      { ...p, active: [{ ...row, updated_at: undefined }] },
      { ...p, active: [{ ...row, updated_at: 'x'.repeat(257) }] },
      { ...p, active: Array(2) },
      { ...p, active: Object.defineProperty([row], '0', { get: getter }) },
      { ...p, active: Array(31).fill(row) },
      saved(),
      { kind: 'stopped', code: 'saved', dispatch: 2, page: 2, target: 1, marker: 1 },
    ]) {
      expect(snapshotCollectorProjection(value)).toBeUndefined();
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
