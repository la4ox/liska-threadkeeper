// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_LIST_HARD_LIMITS,
  CLAUDE_LIST_MARKER_SOURCE,
  CLAUDE_LIST_OBSERVATION_SCHEMA,
  CLAUDE_LIST_SCOPE_PREFIX,
  observeClaudeTerminalListPage,
  type ClaudeListObservedPage,
} from '../../src/update-discovery/claude';

const scopeKey = CLAUDE_LIST_SCOPE_PREFIX + 'a'.repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const record = (n: number) => ({ uuid: id(n), updated_at: `opaque-${n}` });
function input(records: unknown[] = [record(1)]) {
  return {
    request: {
      method: 'GET',
      route: 'chat_conversations_v2',
      query: { limit: 30, offset: 0, archived: false, consistency: 'strong' },
    },
    response: { status: 200, body: { data: records, has_more: false } },
    scope: { key: scopeKey, organizationBinding: 'resolved', workspaceBinding: 'resolved' },
  };
}
function observed(value: unknown, limits?: unknown): ClaudeListObservedPage {
  const result = observeClaudeTerminalListPage(value, limits);
  expect(result.kind).toBe('observed_page');
  return result as ClaudeListObservedPage;
}
function rejected(value: unknown, reason = 'invalid-input', limits?: unknown) {
  const result = observeClaudeTerminalListPage(value, limits);
  expect(result).toEqual({ kind: 'rejected', reason });
  expect(Object.isFrozen(result)).toBe(true);
}
function unsupported(value: unknown, reason: string) {
  const result = observeClaudeTerminalListPage(value);
  expect(result).toEqual({ kind: 'unsupported', reason });
  expect(Object.isFrozen(result)).toBe(true);
}

describe('Claude terminal list page observation', () => {
  it('admits a synthetic twelve-record terminal sample with only detached minimal fields', () => {
    const records = Array.from({ length: 12 }, (_, n) => ({
      ...record(12 - n),
      created_at: 'private-created-token',
      name: 'private-name',
      summary: 'private-summary',
      is_archived: false,
      is_starred: true,
      is_temporary: false,
      is_multiplayer: false,
      model: 'private-model',
      platform: 'private-platform',
      project: { name: 'private-project' },
      settings: { secret: 'private-settings' },
      workspace_upgraded: true,
    }));
    const source = input(records);
    Object.assign(source.scope, {
      organizationId: 'private-organization',
      workspaceId: 'private-workspace',
      accountId: 'private-account',
    });
    const page = observed(source);
    expect(page).toEqual({
      kind: 'observed_page',
      schema: CLAUDE_LIST_OBSERVATION_SCHEMA,
      scopeKey,
      records: Array.from({ length: 12 }, (_, n) => ({
        conversationId: id(n + 1),
        marker: { source: CLAUDE_LIST_MARKER_SOURCE, token: `opaque-${n + 1}` },
      })),
    });
    for (const value of [page, page.records, ...page.records, ...page.records.map(r => r.marker)])
      expect(Object.isFrozen(value)).toBe(true);
    records[0].updated_at = 'mutated';
    records[0].settings.secret = 'mutated';
    source.scope.key = 'mutated';
    records.reverse();
    expect(page.records[11].marker?.token).toBe('opaque-12');
    expect(page.scopeKey).toBe(scopeKey);
    expect(JSON.stringify(page)).not.toMatch(
      /private|created_at|name|summary|settings|organizationBinding|workspaceBinding|project|model|platform|uuid|has_more|request|response/u
    );
  });

  it('is deterministic across repeated observations and source record order', () => {
    const values = [record(3), record(1), record(2)];
    const first = observed(input(values));
    expect(observed(input([...values].reverse()))).toEqual(first);
    expect(observed(input(values))).toEqual(first);
    expect(observed(input(values))).not.toBe(first);
  });

  it('permits an empty terminal observation and an absent opaque marker', () => {
    expect(observed(input([])).records).toEqual([]);
    expect(observed(input([{ uuid: id(1) }])).records).toEqual([{ conversationId: id(1) }]);
  });

  it('does not parse or normalize opaque marker tokens', () => {
    for (const token of ['not a date', ' ', '\u0000', '2030-99-99', 'e\u0301', '\ud800']) {
      expect(observed(input([{ uuid: id(1), updated_at: token }])).records[0].marker?.token).toBe(
        token
      );
    }
  });

  it('rejects duplicate IDs even when their marker tokens differ', () => {
    rejected(input([record(1), { uuid: id(1), updated_at: 'other' }]), 'duplicate-conversation-id');
  });

  it.each(['POST', 'get', 'HEAD'])('reports unobserved method %s', method => {
    const value = input();
    value.request.method = method;
    unsupported(value, 'unobserved-method');
  });
  it.each(['chat_conversations_v1', 'chat_conversations_v3', '/chat_conversations_v2', 'other'])(
    'reports unobserved route/version %s',
    route => {
      const value = input();
      value.request.route = route;
      unsupported(value, 'unobserved-route');
    }
  );
  it.each([
    { limit: 29 },
    { limit: 31 },
    { limit: 0 },
    { offset: 1 },
    { offset: 30 },
    { archived: true },
    { consistency: 'eventual' },
    { consistency: 'STRONG' },
  ])('reports unobserved query %j', patch => {
    const value = input();
    Object.assign(value.request.query, patch);
    unsupported(value, 'unobserved-query');
  });
  it('reports extra query keys without evaluating their values', () => {
    const value = input();
    const getter = vi.fn(() => {
      throw new Error('private query');
    });
    Object.defineProperty(value.request.query, 'cursor', { enumerable: true, get: getter });
    unsupported(value, 'unobserved-query');
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([100, 201, 204, 301, 401, 403, 404, 429, 500, 599])(
    'reports unobserved HTTP status %s without interpreting error body',
    status => {
      const value = input();
      value.response.status = status;
      Object.assign(value.response, { body: null });
      unsupported(value, 'unobserved-status');
    }
  );
  it.each([
    { organizationBinding: 'unresolved' },
    { workspaceBinding: 'unresolved' },
    { organizationBinding: 'unresolved', workspaceBinding: 'unresolved' },
  ])('requires both explicit scope bindings %j', patch => {
    const value = input();
    Object.assign(value.scope, patch);
    unsupported(value, 'unresolved-scope');
  });
  it('reports a missing externally resolved key as unresolved scope', () => {
    const value = input();
    Reflect.deleteProperty(value.scope, 'key');
    unsupported(value, 'unresolved-scope');
  });
  it.each([
    'claude-list-scope/2:' + 'a'.repeat(64),
    'other-scope/1:' + 'a'.repeat(64),
    CLAUDE_LIST_SCOPE_PREFIX + 'A'.repeat(64),
    CLAUDE_LIST_SCOPE_PREFIX + 'a'.repeat(63),
    'raw-organization-workspace',
  ])('does not admit unsupported scope identity %s', key => {
    const value = input();
    value.scope.key = key;
    unsupported(value, 'unsupported-scope-key');
  });
  it.each(['ABCDEF00-0000-4000-8000-000000000001', 'conversation-1', id(1) + 'x', ' '])(
    'does not admit unsupported conversation identity %s',
    uuid => unsupported(input([{ uuid }]), 'unsupported-conversation-identity')
  );
  it('reports nonterminal pages as unsupported without introducing a continuation', () => {
    const value = input();
    value.response.body.has_more = true;
    unsupported(value, 'nonterminal-page');
  });

  it.each([null, undefined, 0, '', [], new Date(), new Map(), Object.create({ request: {} })])(
    'rejects a malformed top-level input %s',
    value => rejected(value)
  );
  it.each([
    ['method', null],
    ['method', ''],
    ['route', 2],
    ['route', ''],
    ['query', null],
  ])('rejects malformed request field %s = %s', (key, value) => {
    const source = input();
    Object.assign(source.request, { [key]: value });
    rejected(source);
  });
  it.each([
    ['limit', '30'],
    ['limit', -1],
    ['limit', -0],
    ['limit', 1.5],
    ['limit', Infinity],
    ['limit', Number.MAX_SAFE_INTEGER + 1],
    ['offset', '0'],
    ['offset', -1],
    ['archived', 'false'],
    ['archived', null],
    ['consistency', ''],
    ['consistency', true],
  ])('rejects malformed query field %s = %s', (key, value) => {
    const source = input();
    Object.assign(source.request.query, { [key]: value });
    rejected(source);
  });
  it.each([0, 99, 600, -1, '200', 200.5, NaN, null])('rejects malformed status %s', status => {
    const value = input();
    Object.assign(value.response, { status });
    rejected(value);
  });
  it.each([
    null,
    [],
    {},
    { data: [] },
    { has_more: false },
    { data: null, has_more: false },
    { data: [], has_more: 'false' },
    { data: [], has_more: null },
  ])('rejects malformed envelope %j', body => {
    const value = input();
    Object.assign(value.response, { body });
    rejected(value);
  });
  it.each([
    null,
    [],
    {},
    { uuid: null },
    { uuid: '' },
    { uuid: 1 },
    { uuid: id(1), updated_at: '' },
    { uuid: id(1), updated_at: null },
    { uuid: id(1), updated_at: undefined },
    { uuid: id(1), updated_at: 1 },
  ])('rejects malformed record %j', value => rejected(input([value])));
  it.each([{ organizationBinding: true }, { workspaceBinding: '' }, { key: null }, { key: '' }])(
    'rejects malformed scope %j',
    patch => {
      const value = input();
      Object.assign(value.scope, patch);
      rejected(value);
    }
  );

  it('ignores unknown values at every object level without traversal, getters or serialization', () => {
    const source = input();
    const getter = vi.fn(() => {
      throw new Error('private getter');
    });
    const hostile = new Proxy({}, { ownKeys: getter, getPrototypeOf: getter, get: getter });
    for (const value of [
      source,
      source.request,
      source.response,
      source.scope,
      source.response.body,
      source.response.body.data[0],
    ]) {
      Object.defineProperty(value, 'toJSON', { enumerable: true, get: getter });
      Object.assign(value as object, { privateUnknown: hostile });
    }
    expect(observed(source).records).toHaveLength(1);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    'request',
    'method',
    'limit',
    'status',
    'body',
    'data',
    'has_more',
    'uuid',
    'updated_at',
    'key',
    'organizationBinding',
    'workspaceBinding',
  ])('rejects a known accessor %s without invoking it', field => {
    const value = input();
    const owners: Record<string, object> = {
      request: value,
      method: value.request,
      limit: value.request.query,
      status: value.response,
      body: value.response,
      data: value.response.body,
      has_more: value.response.body,
      uuid: value.response.body.data[0] as object,
      updated_at: value.response.body.data[0] as object,
      key: value.scope,
      organizationBinding: value.scope,
      workspaceBinding: value.scope,
    };
    const getter = vi.fn(() => {
      throw new Error('must not run');
    });
    Object.defineProperty(owners[field], field, { enumerable: true, get: getter });
    rejected(value);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects non-enumerable known fields and inherited fields', () => {
    const value = input();
    Object.defineProperty(value.response.body, 'has_more', { value: false, enumerable: false });
    rejected(value);
    value.response.body = Object.create({ data: [], has_more: false });
    rejected(value);
  });
  it('accepts null prototypes while rejecting exotic prototypes and symbols at each level', () => {
    const source = input();
    for (const value of [
      source,
      source.request,
      source.request.query,
      source.scope,
      source.response,
      source.response.body,
      source.response.body.data[0],
    ]) {
      const prototype = Object.getPrototypeOf(value);
      Object.setPrototypeOf(value, null);
      observed(source);
      Object.setPrototypeOf(value, prototype);
      Object.setPrototypeOf(value, { inherited: true });
      rejected(source);
      Object.setPrototypeOf(value, prototype);
      Object.defineProperty(value, Symbol('private'), { value: true, configurable: true });
      rejected(source);
      Reflect.deleteProperty(
        value as object,
        Reflect.ownKeys(value as object).find(k => typeof k === 'symbol')!
      );
    }
  });
  it('rejects sparse, decorated, symbolic, accessor and exotic arrays without running getters', () => {
    const accessor = [record(1)];
    const getter = vi.fn(() => record(1));
    Object.defineProperty(accessor, '0', { enumerable: true, get: getter });
    const symbolic = [record(1)];
    Object.defineProperty(symbolic, Symbol('extra'), { value: true });
    const decorated = Object.assign([record(1)], { extra: true });
    const exotic = [record(1)];
    Object.setPrototypeOf(exotic, null);
    for (const values of [new Array(1), accessor, symbolic, decorated, exotic])
      rejected(input(values));
    expect(getter).not.toHaveBeenCalled();
  });
  it('normalizes revoked and hostile Proxy exceptions to fixed outcomes with no private prose', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    rejected(revoked.proxy);
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const hostile = new Proxy(input(), {
        [trap]: () => {
          throw new Error('private exception text');
        },
      });
      rejected(hostile);
    }
    const coercion = { toString: vi.fn(), toJSON: vi.fn() };
    rejected(
      new Proxy(input(), {
        ownKeys: () => {
          throw coercion;
        },
      })
    );
    expect(coercion.toString).not.toHaveBeenCalled();
    expect(coercion.toJSON).not.toHaveBeenCalled();
  });
  it('detaches a transparent caller-owned Proxy without claiming Proxy detection', () => {
    observed(new Proxy(input(), {}));
  });

  it('enforces exact hard record and token ceilings and lowering-only overrides', () => {
    observed(input(Array.from({ length: 30 }, (_, n) => record(n))));
    rejected(input(Array.from({ length: 31 }, (_, n) => record(n))), 'limit-exceeded');
    observed(input([{ uuid: id(1), updated_at: 'x'.repeat(256) }]));
    rejected(input([{ uuid: id(1), updated_at: 'x'.repeat(257) }]), 'limit-exceeded');
    observed(input([record(1)]), { maxRecords: 1 });
    rejected(input([record(1), record(2)]), 'limit-exceeded', { maxRecords: 1 });
    observed(input([]), { maxRecords: 0 });
    rejected(input(), 'limit-exceeded', { maxRecords: 0 });
    observed(input([{ uuid: id(1), updated_at: 'x' }]), { maxTokenCodeUnits: 1 });
    rejected(input(), 'limit-exceeded', { maxTokenCodeUnits: 1 });
    observed(input([{ uuid: id(1) }]), { maxTokenCodeUnits: 0 });
  });
  it('enforces exact key, object-key, scope-key and identity bounds', () => {
    const source = input();
    Object.assign(source, { ['x'.repeat(128)]: true });
    observed(source);
    Object.assign(source, { ['x'.repeat(129)]: true });
    rejected(source, 'limit-exceeded');
    const withKeys = input();
    for (let n = 0; n < 61; n++) Object.assign(withKeys, { [`extra-${n}`]: true });
    observed(withKeys);
    Object.assign(withKeys, { excess: true });
    rejected(withKeys, 'limit-exceeded');
    observed(input(), {
      maxScopeKeyCodeUnits: scopeKey.length,
      maxIdentityCodeUnits: 36,
      maxKeyCodeUnits: 'organizationBinding'.length,
      maxObjectKeys: 4,
    });
    rejected(input(), 'limit-exceeded', { maxScopeKeyCodeUnits: scopeKey.length - 1 });
    rejected(input(), 'limit-exceeded', { maxIdentityCodeUnits: 35 });
    rejected(input(), 'limit-exceeded', { maxKeyCodeUnits: 'organizationBinding'.length - 1 });
    rejected(input(), 'limit-exceeded', { maxObjectKeys: 3 });
    const scope = input();
    scope.scope.key = 'x'.repeat(256);
    unsupported(scope, 'unsupported-scope-key');
    scope.scope.key += 'x';
    rejected(scope, 'limit-exceeded');
  });
  it.each(Object.entries(CLAUDE_LIST_HARD_LIMITS))('never raises limit %s', (name, limit) => {
    rejected(input(), 'invalid-limits', { [name]: limit + 1 });
    rejected(input(), 'invalid-limits', { [name]: -1 });
    rejected(input(), 'invalid-limits', { [name]: -0 });
    rejected(input(), 'invalid-limits', { [name]: 1.5 });
    rejected(input(), 'invalid-limits', { [name]: '1' });
    rejected(input(), 'invalid-limits', { [name]: Infinity });
    observed(input(), { [name]: limit });
  });
  it.each([null, [], { unknown: 1 }, new Date(), { maxRecords: undefined }])(
    'rejects malformed override %j',
    limits => rejected(input(), 'invalid-limits', limits)
  );
  it('does not invoke limit accessors and freezes the published hard limits', () => {
    const getter = vi.fn(() => 1);
    rejected(
      input(),
      'invalid-limits',
      Object.defineProperty({}, 'maxRecords', {
        enumerable: true,
        get: getter,
      })
    );
    expect(getter).not.toHaveBeenCalled();
    expect(Object.isFrozen(CLAUDE_LIST_HARD_LIMITS)).toBe(true);
  });
});
