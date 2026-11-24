// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  admitClaudeAccountCatalog,
  type ClaudeAccountCatalogAdmissionFailure,
  type ClaudeAccountCatalogAdmissionInput,
  type ClaudeAccountCatalogAdmissionResult,
  type ClaudeAccountScopeSha256,
} from '../../src/claude-baseline';

const organization = 'a0000000-0000-0000-0000-000000000001';
const otherOrganization = 'a0000000-0000-0000-0000-000000000002';
const workspace = 'Synthetic._~-Workspace';
const marker = 'opaque synthetic marker, not a date';
const id = (suffix: number) => `b0000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
const activeRecord = (suffix = 1) => ({ uuid: id(suffix), is_archived: false as const });
const activePage = (data = [activeRecord(2), { ...activeRecord(), updated_at: marker }]) => ({
  offset: 0 as const,
  body: { data, has_more: false as const },
});
const archivedPage = () => ({
  offset: 0 as const,
  body: { data: [] as never[], has_more: false as const },
});
const input = (routeOrganization = organization, workspaceValue = workspace) =>
  ({
    routeOrganization,
    scopeHeaders: {
      'anthropic-organization-id': routeOrganization,
      'anthropic-workspace-id': workspaceValue,
    },
    manualAttestation: 'manual-same-visible-personal-context',
    activePage: activePage(),
    archivedPage: archivedPage(),
  }) satisfies ClaudeAccountCatalogAdmissionInput;

const sha256: ClaudeAccountScopeSha256 = preimage =>
  new Uint8Array(createHash('sha256').update(preimage, 'utf8').digest());
const schema = 'liska-claude-account-catalog-admission/1';

function admitted(result: ClaudeAccountCatalogAdmissionResult) {
  expect(result.kind).toBe('admitted');
  if (result.kind !== 'admitted') throw new Error('expected admission');
  return result;
}

async function expectRejected(
  value: unknown,
  reason: ClaudeAccountCatalogAdmissionFailure,
  limits?: unknown
) {
  const digest = vi.fn(sha256);
  const result = await admitClaudeAccountCatalog(value, digest, limits);
  expect(result).toEqual({ kind: 'rejected', schema, reason });
  expect(Object.isFrozen(result)).toBe(true);
  expect(digest).not.toHaveBeenCalled();
}

describe('projected Claude account catalog admission', () => {
  it('uses one exact domain and preserves sorted targets, markers and the existing catalog semantics', async () => {
    const digest = vi.fn(async (preimage: string) => sha256(preimage));
    const result = admitted(await admitClaudeAccountCatalog(input(), digest));
    const expectedPreimage =
      '["liska-claude-account-catalog-scope/1","https://claude.ai","anthropic-organization-id","a0000000-0000-0000-0000-000000000001","anthropic-workspace-id","Synthetic._~-Workspace"]';
    expect(digest).toHaveBeenCalledExactlyOnceWith(expectedPreimage);
    const scopeKey = `claude-list-scope/1:${createHash('sha256').update(expectedPreimage, 'utf8').digest('hex')}`;
    expect(scopeKey).toMatch(/^claude-list-scope\/1:[a-f0-9]{64}$/u);
    expect(result).toEqual({
      kind: 'admitted',
      schema,
      catalog: {
        kind: 'catalog',
        schema: 'liska-claude-account-baseline-catalog/1',
        provider: 'claude',
        scopeKey,
        scopeEvidence: 'manual-personal-scope',
        coverage: { active: 'terminal-observed', archived: 'unobserved' },
        accountComplete: false,
        targets: [
          {
            conversationId: id(1),
            marker: { source: 'claude-chat-conversations-v2.updated_at/1', token: marker },
          },
          { conversationId: id(2) },
        ],
      },
      evidence: {
        provenance: 'caller-projected',
        scopeDerivation: 'provided-header-pair-sha256',
        personalContextAssertion: 'manual-same-visible-personal-context',
        active: 'offset-0-terminal-projected',
        archived: 'offset-0-terminal-empty-projected',
        accountComplete: false,
        executionAuthorized: false,
      },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      organization,
      workspace,
      expectedPreimage,
      'fingerprint',
      'scopeHeaders',
      'routeOrganization',
      'has_more',
      'https://',
      'receipt',
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it('gives the same exact pair one key independently of invocation, record set and input key order', async () => {
    const first = admitted(await admitClaudeAccountCatalog(input(), sha256));
    const second = admitted(
      await admitClaudeAccountCatalog(
        {
          ...input(),
          scopeHeaders: {
            'anthropic-workspace-id': workspace,
            'anthropic-organization-id': organization,
          },
          activePage: activePage([]),
        },
        sha256
      )
    );
    expect(first.catalog.scopeKey).toBe(second.catalog.scopeKey);
    expect(second.catalog.targets).toEqual([]);
    expect(second.catalog.accountComplete).toBe(false);
    expect(second.evidence.provenance).toBe('caller-projected');
    expect(second.evidence.executionAuthorized).toBe(false);
    for (const changed of [
      input(otherOrganization),
      input(organization, workspace.toLowerCase()),
    ]) {
      const result = admitted(await admitClaudeAccountCatalog(changed, sha256));
      expect(result.catalog.scopeKey).not.toBe(first.catalog.scopeKey);
    }
  });

  it('accepts exact hard ceilings and rejects excess without hashing', async () => {
    const data = Array.from({ length: 30 }, (_, n) => activeRecord(n + 1));
    const tight = {
      ...input(organization, 'W'.repeat(128)),
      activePage: activePage([
        { ...activeRecord(31), updated_at: 'z'.repeat(256) },
        ...data.slice(1),
      ]),
    };
    const result = admitted(await admitClaudeAccountCatalog(tight, sha256));
    expect(result.catalog.targets).toHaveLength(30);
    await expectRejected(
      { ...tight, activePage: activePage([...data, activeRecord(31)]) },
      'limit-exceeded'
    );
    await expectRejected(
      { ...tight, activePage: activePage([{ ...activeRecord(), updated_at: 'z'.repeat(257) }]) },
      'limit-exceeded'
    );
    await expectRejected(input(organization, 'W'.repeat(129)), 'limit-exceeded');
  });

  it.each(['', ' Synthetic', 'Synthetic ', 'Synthetic\n', 'a/b', 'a:b', 'a,b', '\t', 'é'])(
    'rejects an invalid workspace envelope (%j)',
    async value => {
      await expectRejected(input(organization, value), 'invalid-input');
    }
  );

  it('requires exact own header names, a route UUID and a manual choice; a reviewed receipt cannot substitute', async () => {
    const good = input();
    await expectRejected({ ...good, routeOrganization: otherOrganization }, 'scope-mismatch');
    await expectRejected(input(organization.toUpperCase()), 'invalid-input');
    await expectRejected(input(`${organization}\n`), 'invalid-input');
    await expectRejected(
      { ...good, manualAttestation: 'manual-personal-scope' },
      'manual-attestation-required'
    );
    await expectRejected({ ...good, manualAttestation: undefined }, 'manual-attestation-required');
    await expectRejected(
      { ...good, scopeHeaders: { ...good.scopeHeaders, other: 'extra' } },
      'invalid-input'
    );
    await expectRejected(
      {
        ...good,
        scopeHeaders: {
          'Anthropic-Organization-Id': organization,
          'anthropic-workspace-id': workspace,
        },
      },
      'invalid-input'
    );
    await expectRejected(
      { ...good, scopeHeaders: { 'anthropic-organization-id': organization } },
      'invalid-input'
    );
    await expectRejected(
      { reviewedActiveReceipt: { count: 2 }, reviewedScopeReceipt: { count: 2 } },
      'invalid-input'
    );
  });

  it.each([
    [
      'active continuation',
      { activePage: { ...activePage(), body: { data: [], has_more: true } } },
      'active-pagination-unsupported',
    ],
    [
      'active offset 30',
      { activePage: { ...activePage(), offset: 30 } },
      'active-pagination-unsupported',
    ],
    [
      'active offset negative zero',
      { activePage: { ...activePage(), offset: -0 } },
      'active-pagination-unsupported',
    ],
    [
      'archived continuation',
      { archivedPage: { ...archivedPage(), body: { data: [], has_more: true } } },
      'archived-pagination-unsupported',
    ],
    [
      'archived offset 30',
      { archivedPage: { ...archivedPage(), offset: 30 } },
      'archived-pagination-unsupported',
    ],
    [
      'nonempty archive',
      {
        archivedPage: {
          ...archivedPage(),
          body: { data: [{ uuid: id(33), is_archived: true }], has_more: false },
        },
      },
      'nonempty-archived-unsupported',
    ],
    ['cursor decoration', { activePage: { ...activePage(), continuation: null } }, 'invalid-input'],
    [
      'body decoration',
      { activePage: { ...activePage(), body: { ...activePage().body, title: 'synthetic' } } },
      'invalid-input',
    ],
  ] as const)('fails closed on %s', async (_label, overrides, reason) => {
    await expectRejected({ ...input(), ...overrides }, reason);
  });

  it.each([
    ['duplicate exact identity', [activeRecord(), activeRecord()], 'duplicate-conversation-id'],
    ['uppercase identity', [{ ...activeRecord(), uuid: id(1).toUpperCase() }], 'invalid-input'],
    ['malformed identity', [{ ...activeRecord(), uuid: 'synthetic' }], 'invalid-input'],
    ['missing archive flag', [{ uuid: id(1) }], 'invalid-input'],
    ['archived true in active page', [{ ...activeRecord(), is_archived: true }], 'invalid-input'],
    ['nonboolean archive flag', [{ ...activeRecord(), is_archived: 0 }], 'invalid-input'],
    ['empty marker', [{ ...activeRecord(), updated_at: '' }], 'invalid-input'],
    ['explicit undefined marker', [{ ...activeRecord(), updated_at: undefined }], 'invalid-input'],
    ['nonstring marker', [{ ...activeRecord(), updated_at: 3 }], 'invalid-input'],
    ['unprojected record field', [{ ...activeRecord(), name: 'synthetic title' }], 'invalid-input'],
    [
      'identity equal to a scope value',
      [{ ...activeRecord(), uuid: organization }],
      'scope-value-in-target',
    ],
    [
      'marker equal to a scope value',
      [{ ...activeRecord(), updated_at: workspace }],
      'scope-value-in-target',
    ],
  ] as const)('fails closed on %s', async (_label, data, reason) => {
    await expectRejected(
      { ...input(), activePage: { offset: 0, body: { data, has_more: false } } },
      reason
    );
  });

  it('rejects nonplain and accessor-bearing inputs without evaluating a getter', async () => {
    const getter = vi.fn(() => {
      throw new Error('must not read');
    });
    const accessor = (target: object, key: PropertyKey) =>
      Object.defineProperty(target, key, { get: getter, enumerable: true });
    const good = input();
    for (const candidate of [
      accessor({ ...good }, 'scopeHeaders'),
      { ...good, scopeHeaders: accessor({ ...good.scopeHeaders }, 'anthropic-workspace-id') },
      { ...good, activePage: { offset: 0, body: accessor({ data: [] }, 'has_more') } },
      { ...good, activePage: activePage([accessor(activeRecord(), 'uuid')]) },
      {
        ...good,
        activePage: activePage(
          accessor([activeRecord()], '0') as ReturnType<typeof activeRecord>[]
        ),
      },
      {
        ...good,
        activePage: activePage(
          accessor([activeRecord()], Symbol('outside')) as ReturnType<typeof activeRecord>[]
        ),
      },
      { ...good, activePage: activePage(new Array(1)) },
      { ...good, scopeHeaders: Object.create(good.scopeHeaders) },
      { ...good, [Symbol('outside')]: false },
      {
        ...good,
        archivedPage: {
          offset: 0,
          body: { data: new (class extends Array {})(), has_more: false },
        },
      },
      Object.defineProperty({ ...good }, 'routeOrganization', {
        value: organization,
        enumerable: false,
      }),
      new Proxy(good, {
        ownKeys() {
          throw new Error(workspace);
        },
      }),
    ])
      await expectRejected(candidate, 'invalid-input');
    await expectRejected(good, 'invalid-limits', accessor({}, 'maxRecords'));
    expect(getter).not.toHaveBeenCalled();
  });

  it('honors only closed lowering overrides', async () => {
    for (const limits of [
      { maxRecords: 1 },
      { maxObjectKeys: 4 },
      { maxIdentityCodeUnits: 35 },
      { maxKeyCodeUnits: 24 },
      { maxTokenCodeUnits: 1 },
      { maxScopeKeyCodeUnits: 83 },
    ])
      await expectRejected(input(), 'limit-exceeded', limits);
    for (const limits of [
      { maxRecords: 31 },
      { maxRecords: -0 },
      { maxTokenCodeUnits: 257 },
      { invented: 1 },
    ])
      await expectRejected(input(), 'invalid-limits', limits);
    const result = admitted(
      await admitClaudeAccountCatalog({ ...input(), activePage: activePage([]) }, sha256, {
        maxRecords: 0,
        maxScopeKeyCodeUnits: 84,
      })
    );
    expect(result.catalog.targets).toEqual([]);
  });

  it('requires exactly native 32-byte SHA-256 output and never reflects hash errors', async () => {
    const accessor = vi.fn(() => {
      throw new Error(workspace);
    });
    const attached = Object.defineProperty(new Uint8Array(32), 'length', { get: accessor });
    const arbitraryThenable = Object.defineProperty({}, 'then', { get: accessor });
    const reparented = Object.setPrototypeOf(new Float32Array(32), Uint8Array.prototype);
    for (const candidate of [
      null,
      new Uint8Array(0),
      new Uint8Array(31),
      new Uint8Array(33),
      new Array(32).fill(0),
      new Uint16Array(32),
      new Uint8Array(32).buffer,
      attached,
      arbitraryThenable,
      reparented,
    ]) {
      const digest = vi.fn(() => candidate);
      expect(await admitClaudeAccountCatalog(input(), digest as ClaudeAccountScopeSha256)).toEqual({
        kind: 'rejected',
        schema,
        reason: 'hash-failed',
      });
      expect(digest).toHaveBeenCalledTimes(1);
    }
    for (const rejectedHash of [
      () => {
        throw new Error(workspace);
      },
      () => Promise.reject(organization),
      null,
    ])
      expect(
        await admitClaudeAccountCatalog(input(), rejectedHash as ClaudeAccountScopeSha256)
      ).toEqual({ kind: 'rejected', schema, reason: 'hash-failed' });
    expect(accessor).not.toHaveBeenCalled();

    const decorated = Object.defineProperty(Promise.resolve(new Uint8Array(32)), 'then', {
      get: accessor,
    });
    expect((await admitClaudeAccountCatalog(input(), () => decorated)).kind).toBe('admitted');
    class DigestPromise extends Promise<Uint8Array> {}
    expect(
      await admitClaudeAccountCatalog(
        input(),
        () => new DigestPromise((_resolve, reject) => reject(new Error(workspace)))
      )
    ).toEqual({ kind: 'rejected', schema, reason: 'hash-failed' });
    expect(accessor).not.toHaveBeenCalled();
  });

  it('snapshots caller data before asynchronous hashing, detaches output and deep-freezes every layer', async () => {
    const value = input();
    const before = JSON.stringify(value);
    const digest = vi.fn((preimage: string) => Promise.resolve(sha256(preimage)));
    const pending = admitClaudeAccountCatalog(value, digest);
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.isFrozen(value.activePage.body.data)).toBe(false);
    value.activePage.body.data[1].updated_at = 'late mutation';
    value.activePage.body.data.reverse();
    value.scopeHeaders['anthropic-workspace-id'] = 'Mutated';
    const result = admitted(await pending);
    expect(result).toEqual(admitted(await admitClaudeAccountCatalog(input(), sha256)));
    const [first, second] = result.catalog.targets;
    for (const part of [
      result,
      result.catalog,
      result.catalog.coverage,
      result.catalog.targets,
      first,
      first.marker,
      second,
      result.evidence,
    ])
      expect(Object.isFrozen(part)).toBe(true);
  });
});
