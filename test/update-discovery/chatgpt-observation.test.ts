// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_CONVERSATION_LIST_HARD_LIMITS,
  CHATGPT_CONVERSATION_LIST_MARKER_SOURCE,
  CHATGPT_CONVERSATION_LIST_OBSERVATION_SCHEMA,
  observeChatGptUnboundConversationListPage,
  type ChatGptConversationListObservedPage,
} from '../../src/update-discovery/chatgpt';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const record = (n: number) => ({ id: id(n), update_time: `opaque-${n}` });
const records = () => Array.from({ length: 20 }, (_, n) => record(n + 1));
function input(items: unknown[] = records(), offset = 20, total = 41) {
  return {
    request: {
      method: 'GET',
      pathname: '/backend-api/conversations',
      query: {
        exclude_conversation_origin: 'tpp',
        expand: 'false',
        hide_snorlax: 'false',
        is_archived: 'false',
        is_starred: 'false',
        limit: '20',
        order: 'updated',
        offset: String(offset),
      },
    },
    response: { status: 200, body: { items, limit: 20, offset, total } },
  };
}
function withFirst(value: unknown) {
  return input([value, ...records().slice(1)]);
}
function observed(value: unknown, limits?: unknown): ChatGptConversationListObservedPage {
  const result = observeChatGptUnboundConversationListPage(value, limits);
  expect(result.kind).toBe('observed_unbound_page');
  return result as ChatGptConversationListObservedPage;
}
function rejected(value: unknown, reason = 'invalid-input', limits?: unknown) {
  const result = observeChatGptUnboundConversationListPage(value, limits);
  expect(result).toEqual({ kind: 'rejected', reason });
  expect(Object.isFrozen(result)).toBe(true);
}
function unsupported(value: unknown, reason: string) {
  const result = observeChatGptUnboundConversationListPage(value);
  expect(result).toEqual({ kind: 'unsupported', reason });
  expect(Object.isFrozen(result)).toBe(true);
}

describe('ChatGPT unbound ordinary conversation-list page observation', () => {
  it.each([
    [20, 41],
    [40, 61],
    [60, 81],
  ])('admits inspected offset %s and preserves only a detached projection', (offset, total) => {
    const values = records()
      .reverse()
      .map(value => ({
        ...value,
        title: 'private-title',
        create_time: 'private-created',
        gizmo: { private: true },
        workspace: { private: true },
      }));
    const source = input(values, offset, total);
    const page = observed(source);
    expect(page).toEqual({
      kind: 'observed_unbound_page',
      schema: CHATGPT_CONVERSATION_LIST_OBSERVATION_SCHEMA,
      scopeBinding: 'unresolved',
      termination: 'unknown',
      request: { limit: 20, offset },
      reported: { limit: 20, offset, total },
      records: records().map(value => ({
        conversationId: value.id,
        marker: { source: CHATGPT_CONVERSATION_LIST_MARKER_SOURCE, token: value.update_time },
      })),
    });
    for (const value of [
      page,
      page.request,
      page.reported,
      page.records,
      ...page.records,
      ...page.records.map(value => value.marker),
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(JSON.stringify(page)).not.toMatch(/private|title|create_time|gizmo|workspace/u);
    values[0].id = id(99);
    values[0].update_time = 'mutated';
    values[0].gizmo.private = false;
    values.reverse();
    source.request.query.offset = '0';
    source.response.body.total = 0;
    expect(page.records[19].conversationId).toBe(id(20));
    expect(page.records[19].marker?.token).toBe('opaque-20');
    expect(page.request.offset).toBe(offset);
    expect(page.reported.total).toBe(total);
  });

  it.each([0, 1, 19, 20, 21, 41, 61, 81, 1000000, Number.MAX_SAFE_INTEGER])(
    'treats total %s only as bounded reported metadata, regardless of offset or item count',
    total => {
      const page = observed(input(records(), 60, total));
      expect(page.reported.total).toBe(total);
      expect(page.termination).toBe('unknown');
      expect(Object.keys(page).sort()).toEqual(
        ['kind', 'schema', 'scopeBinding', 'termination', 'request', 'reported', 'records'].sort()
      );
      expect(Object.keys(page.reported).sort()).toEqual(['limit', 'offset', 'total']);
    }
  );
  it('is deterministic, synchronous and independent of source order and identity', () => {
    const source = input();
    const first = observed(source);
    expect(observed(source)).toEqual(first);
    expect(observed(source)).not.toBe(first);
    source.response.body.items.reverse();
    expect(observed(source)).toEqual(first);
    expect(first).not.toHaveProperty('then');
    expect(first.request).not.toBe(source.request);
    expect(first.reported).not.toBe(source.response.body);
    expect(first.records).not.toBe(source.response.body.items);
    expect(first.records[0]).not.toBe(source.response.body.items[19]);
  });
  it('allows an absent marker and preserves present opaque tokens without parsing or ordering', () => {
    expect(observed(withFirst({ id: id(1) })).records[0]).toEqual({ conversationId: id(1) });
    for (const token of ['not a date', ' ', '\u0000', '2030-99-99', 'e\u0301', '\ud800'])
      expect(observed(withFirst({ id: id(1), update_time: token })).records[0].marker).toEqual({
        source: CHATGPT_CONVERSATION_LIST_MARKER_SOURCE,
        token,
      });
    const values = records();
    values[0].update_time = 'zzz';
    values[19].update_time = 'aaa';
    const page = observed(input(values.reverse()));
    expect(page.records[0].marker?.token).toBe('zzz');
    expect(page.records[19].marker?.token).toBe('aaa');
  });
  it('rejects duplicate IDs even with different markers', () => {
    const values = records();
    values[19] = { id: id(1), update_time: 'different' };
    rejected(input(values), 'duplicate-conversation-id');
  });
  it.each(['ABCDEF00-0000-4000-8000-000000000001', 'conversation-1', id(1) + 'x', ' '])(
    'reports identity spelling outside the conservative lowercase UUID policy: %s',
    value => unsupported(withFirst({ id: value }), 'unsupported-conversation-identity')
  );
  it('makes no UUID version/variant claim beyond lowercase hexadecimal 8-4-4-4-12 spelling', () => {
    const value = 'abcdef00-abcd-0000-0000-abcdef012345';
    expect(observed(withFirst({ id: value })).records[19].conversationId).toBe(value);
  });

  it.each([0, 1, 19, 21, 80, -1])('does not infer a response contract at offset %s', offset => {
    const value = input(records(), offset);
    Object.assign(value.response, { body: null });
    unsupported(value, 'unobserved-offset');
  });
  it.each(['020', '20.0', '+20', ' 20', '20 ', '2e1', '20&offset=40'])(
    'requires exact offset string grammar: %s',
    offset => {
      const value = input();
      value.request.query.offset = offset;
      unsupported(value, 'unobserved-offset');
    }
  );
  it.each(['POST', 'get', 'HEAD'])('requires exact method spelling: %s', method => {
    const value = input();
    value.request.method = method;
    unsupported(value, 'unobserved-method');
  });
  it.each([
    '/backend-api/conversations/',
    '/backend-api/conversation',
    '/backend-api/conversations?offset=20',
    'https://example.test/backend-api/conversations',
  ])('requires the exact detached pathname: %s', pathname => {
    const value = input();
    value.request.pathname = pathname;
    unsupported(value, 'unobserved-pathname');
  });
  it.each([
    ['exclude_conversation_origin', 'other'],
    ['expand', 'true'],
    ['hide_snorlax', 'true'],
    ['is_archived', 'true'],
    ['is_starred', 'true'],
    ['limit', '30'],
    ['limit', '020'],
    ['order', 'created'],
    ['order', 'UPDATED'],
  ])('does not generalize query %s = %s', (key, value) => {
    const source = input();
    Object.assign(source.request.query, { [key]: value });
    unsupported(source, 'unobserved-query');
  });
  it.each(Object.keys(input().request.query))('does not admit missing query key %s', key => {
    const value = input();
    Reflect.deleteProperty(value.request.query, key);
    unsupported(value, 'unobserved-query');
  });
  it('does not evaluate an extra query value or interpret an unobserved response body', () => {
    const value = input();
    const getter = vi.fn(() => {
      throw new Error('private query');
    });
    Object.defineProperty(value.request.query, 'extra', { enumerable: true, get: getter });
    Object.assign(value.response, { body: new Proxy({}, { ownKeys: getter }) });
    unsupported(value, 'unobserved-query');
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([100, 201, 204, 301, 401, 403, 404, 429, 500, 599])(
    'does not interpret bodies at unobserved status %s',
    status => {
      const value = input();
      value.response.status = status;
      Object.assign(value.response, { body: null });
      unsupported(value, 'unobserved-status');
    }
  );

  it.each([null, undefined, 0, '', [], new Date(), new Map(), Object.create({ request: {} })])(
    'rejects malformed input %s',
    value => rejected(value)
  );
  it.each(['request', 'response'])('rejects missing root field %s', key => {
    const value = input();
    Reflect.deleteProperty(value, key);
    rejected(value);
  });
  it.each(['method', 'pathname', 'query'])('rejects missing request field %s', key => {
    const value = input();
    Reflect.deleteProperty(value.request, key);
    rejected(value);
  });
  it.each([
    ['method', null],
    ['method', ''],
    ['pathname', 2],
    ['pathname', ''],
    ['query', null],
    ['query', 'limit=20&offset=20'],
    ['query', new URLSearchParams()],
  ])('rejects malformed detached request field %s', (key, value) => {
    const source = input();
    Object.assign(source.request, { [key]: value });
    rejected(source);
  });
  it.each(['limit', 'offset', 'expand', 'order'])('rejects non-string query field %s', key => {
    for (const value of [null, undefined, 20, false, {}, '']) {
      const source = input();
      Object.assign(source.request.query, { [key]: value });
      rejected(source);
    }
  });
  it.each([0, 99, 600, -1, -0, '200', 200.5, NaN, null])('rejects malformed status %s', status => {
    const value = input();
    Object.assign(value.response, { status });
    rejected(value);
  });
  it('rejects URL objects and transport or binding decoration at wrapper levels', () => {
    const value = input();
    Object.assign(value.request, {
      pathname: new URL('https://example.test/backend-api/conversations'),
    });
    rejected(value);
    for (const [owner, field] of [
      ['root', 'scope'],
      ['request', 'headers'],
      ['request', 'callback'],
      ['response', 'transport'],
    ]) {
      const source = input();
      Object.assign(owner === 'root' ? source : source[owner as 'request' | 'response'], {
        [field]: null,
      });
      rejected(source);
    }
  });
  it.each(['items', 'limit', 'offset', 'total'])('requires envelope field %s', key => {
    const value = input();
    Reflect.deleteProperty(value.response.body, key);
    rejected(value);
  });
  it.each([null, [], {}, { items: [] }, { items: null, limit: 20, offset: 20, total: 41 }])(
    'rejects malformed response envelope %j',
    body => {
      const value = input();
      Object.assign(value.response, { body });
      rejected(value);
    }
  );
  it('rejects extra envelope keys, including non-enumerable keys, without reading their values', () => {
    for (const enumerable of [true, false]) {
      const value = input();
      const getter = vi.fn(() => {
        throw new Error('private envelope');
      });
      Object.defineProperty(value.response.body, 'extra', { enumerable, get: getter });
      rejected(value);
      expect(getter).not.toHaveBeenCalled();
    }
  });
  it.each(['limit', 'offset', 'total'])('requires safe nonnegative integer metadata %s', key => {
    for (const value of [-1, -0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20', null]) {
      const source = input();
      Object.assign(source.response.body, { [key]: value });
      rejected(source);
    }
  });
  it.each([{ limit: 0 }, { limit: 19 }, { limit: 21 }, { offset: 0 }, { offset: 40 }])(
    'rejects mismatched response echo %j',
    patch => {
      const value = input();
      Object.assign(value.response.body, patch);
      rejected(value);
    }
  );
  it.each([0, 1, 19, 21])('requires exactly twenty items, not %s', length => {
    rejected(
      input(Array.from({ length }, (_, n) => record(n + 1))),
      length > 20 ? 'limit-exceeded' : 'invalid-input'
    );
  });
  it.each([
    null,
    [],
    {},
    { id: null },
    { id: '' },
    { id: 1 },
    { id: id(1), update_time: '' },
    { id: id(1), update_time: null },
    { id: id(1), update_time: undefined },
    { id: id(1), update_time: 1 },
  ])('rejects malformed selected record fields %j', value => rejected(withFirst(value)));

  it('never reads private or unknown record values, descriptors, getters or serialization hooks', () => {
    const getter = vi.fn(() => {
      throw new Error('private field');
    });
    const hostile = new Proxy({}, { get: getter, ownKeys: getter, getPrototypeOf: getter });
    const value = Object.assign(record(1), { privateUnknown: hostile });
    const privateNames = ['title', 'create_time', 'gizmo', 'workspace', 'toJSON'];
    for (const name of privateNames)
      Object.defineProperty(value, name, { enumerable: true, get: getter });
    const inspected: PropertyKey[] = [];
    const projected = new Proxy(value, {
      get: getter,
      getOwnPropertyDescriptor(target, key) {
        inspected.push(key);
        if (privateNames.includes(String(key)) || key === 'privateUnknown')
          throw new Error('private descriptor');
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(observed(withFirst(projected)).records[0].conversationId).toBe(id(1));
    expect(inspected).toEqual(['id', 'update_time']);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    'request',
    'response',
    'method',
    'pathname',
    'query',
    'expand',
    'status',
    'body',
    'items',
    'limit',
    'offset',
    'total',
    'id',
    'update_time',
  ])('rejects selected accessor %s without invoking it', field => {
    const value = input();
    const owners: Record<string, object> = {
      request: value,
      response: value,
      method: value.request,
      pathname: value.request,
      query: value.request,
      expand: value.request.query,
      status: value.response,
      body: value.response,
      items: value.response.body,
      limit: value.response.body,
      offset: value.response.body,
      total: value.response.body,
      id: value.response.body.items[0] as object,
      update_time: value.response.body.items[0] as object,
    };
    const getter = vi.fn(() => {
      throw new Error('must not run');
    });
    Object.defineProperty(owners[field], field, { enumerable: true, get: getter });
    rejected(value);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects non-enumerable selected fields and inherited selected values', () => {
    const value = input();
    Object.defineProperty(value.response.body, 'total', { value: 41, enumerable: false });
    rejected(value);
    const source = input();
    Object.assign(source.response, { body: Object.create(source.response.body) });
    rejected(source);
    rejected(withFirst(Object.create({ id: id(1), update_time: 'opaque' })));
  });
  it('accepts plain null-prototype objects but rejects exotic prototypes and symbols at every level', () => {
    const source = input();
    for (const value of [
      source,
      source.request,
      source.request.query,
      source.response,
      source.response.body,
      source.response.body.items[0] as object,
    ]) {
      Object.setPrototypeOf(value, null);
      observed(source);
      Object.setPrototypeOf(value, { inherited: true });
      rejected(source);
      Object.setPrototypeOf(value, Object.prototype);
      const symbol = Symbol('private');
      Object.defineProperty(value, symbol, { value: true, configurable: true });
      rejected(source);
      Reflect.deleteProperty(value, symbol);
    }
  });
  it('rejects sparse, accessor, symbolic, decorated, non-enumerable and exotic arrays', () => {
    const accessor = records();
    const getter = vi.fn(() => record(1));
    Object.defineProperty(accessor, '0', { enumerable: true, get: getter });
    const symbolic = records();
    Object.defineProperty(symbolic, Symbol('extra'), { value: true });
    const decorated = Object.assign(records(), { extra: true });
    const hidden = records();
    Object.defineProperty(hidden, '0', { value: record(1), enumerable: false });
    const exotic = records();
    Object.setPrototypeOf(exotic, null);
    const sparse = records();
    Reflect.deleteProperty(sparse, '0');
    for (const values of [new Array(20), sparse, accessor, symbolic, decorated, hidden, exotic])
      rejected(input(values));
    expect(getter).not.toHaveBeenCalled();
  });
  it('accepts already frozen caller data without mutating it', () => {
    const value = input();
    for (const item of value.response.body.items) Object.freeze(item);
    Object.freeze(value.response.body.items);
    Object.freeze(value.response.body);
    Object.freeze(value.response);
    Object.freeze(value.request.query);
    Object.freeze(value.request);
    Object.freeze(value);
    observed(value);
  });
  it('normalizes observable trap failures and revoked proxies without leaking or coercing errors', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    rejected(revoked.proxy);
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'])
      rejected(
        new Proxy(input(), {
          [trap]: () => {
            throw new Error('private exception text');
          },
        })
      );
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
    observed(new Proxy(input(), {}));
  });

  it('enforces provider record ceiling and never relaxes exact page size with lowered limits', () => {
    expect(CHATGPT_CONVERSATION_LIST_HARD_LIMITS.maxRecords).toBe(20);
    rejected(input(), 'limit-exceeded', { maxRecords: 19 });
    rejected(input(), 'limit-exceeded', { maxRecords: 0 });
    rejected(input(records().slice(0, 19)), 'invalid-input', { maxRecords: 19 });
    observed(input(), { maxRecords: 20 });
  });
  it('enforces exact marker, identity, request and reported-total bounds', () => {
    observed(withFirst({ id: id(1), update_time: 'x'.repeat(256) }));
    rejected(withFirst({ id: id(1), update_time: 'x'.repeat(257) }), 'limit-exceeded');
    observed(withFirst({ id: id(1), update_time: 'x' }), { maxTokenCodeUnits: 16 });
    rejected(input(), 'limit-exceeded', { maxTokenCodeUnits: 1 });
    observed(input(records().map(value => ({ id: value.id }))), { maxTokenCodeUnits: 0 });
    observed(input(), { maxIdentityCodeUnits: 36 });
    rejected(input(), 'limit-exceeded', { maxIdentityCodeUnits: 35 });
    unsupported(withFirst({ id: 'x'.repeat(128) }), 'unsupported-conversation-identity');
    rejected(withFirst({ id: 'x'.repeat(129) }), 'limit-exceeded');
    const source = input();
    source.request.pathname = 'x'.repeat(128);
    unsupported(source, 'unobserved-pathname');
    source.request.pathname += 'x';
    rejected(source, 'limit-exceeded');
    observed(input(), { maxRequestCodeUnits: '/backend-api/conversations'.length });
    rejected(input(), 'limit-exceeded', { maxRequestCodeUnits: 2 });
    observed(input(records(), 20, 0), { maxReportedTotal: 0 });
    rejected(input(), 'limit-exceeded', { maxReportedTotal: 40 });
  });
  it('enforces object key bounds without examining unknown values', () => {
    const value = record(1);
    Object.assign(value, { ['x'.repeat(128)]: null });
    observed(withFirst(value));
    Object.assign(value, { ['x'.repeat(129)]: null });
    rejected(withFirst(value), 'limit-exceeded');
    const many = record(1);
    for (let n = 0; n < 62; n++) Object.assign(many, { [`extra-${n}`]: null });
    observed(withFirst(many));
    Object.assign(many, { excess: null });
    rejected(withFirst(many), 'limit-exceeded');
    observed(input(), { maxObjectKeys: 8, maxKeyCodeUnits: 'exclude_conversation_origin'.length });
    rejected(input(), 'limit-exceeded', { maxObjectKeys: 7 });
    rejected(input(), 'limit-exceeded', { maxKeyCodeUnits: 1 });
  });
  it.each(Object.entries(CHATGPT_CONVERSATION_LIST_HARD_LIMITS))(
    'permits only lower safe nonnegative overrides of %s',
    (name, limit) => {
      for (const invalid of [limit + 1, -1, -0, 1.5, '1', Infinity, NaN, undefined])
        rejected(input(), 'invalid-limits', { [name]: invalid });
      observed(input(), { [name]: limit });
    }
  );
  it.each([null, [], { unknown: 1 }, new Date(), Object.create({ maxRecords: 1 })])(
    'rejects malformed override %j',
    limits => rejected(input(), 'invalid-limits', limits)
  );
  it('rejects unsafe override descriptors and symbols without invoking accessors', () => {
    const getter = vi.fn(() => 1);
    rejected(
      input(),
      'invalid-limits',
      Object.defineProperty({}, 'maxRecords', {
        enumerable: true,
        get: getter,
      })
    );
    rejected(
      input(),
      'invalid-limits',
      Object.defineProperty({}, 'maxRecords', {
        value: 20,
        enumerable: false,
      })
    );
    rejected(input(), 'invalid-limits', { [Symbol('private')]: 1 });
    expect(getter).not.toHaveBeenCalled();
    expect(Object.isFrozen(CHATGPT_CONVERSATION_LIST_HARD_LIMITS)).toBe(true);
  });
});
