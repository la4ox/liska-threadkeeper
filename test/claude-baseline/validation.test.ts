// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_BASELINE_HARD_LIMITS,
  enumerateClaudeBaselineCatalog,
} from '../../src/claude-baseline';
import {
  attestation,
  catalog,
  id,
  markerSource,
  page,
  rejected,
  scopeKey,
  target,
  unsupported,
} from './fixtures';

describe('closed bounded catalog validation', () => {
  it.each([null, undefined, 0, '', [], new Date(), new Map(), Object.create(page())])(
    'rejects malformed observation %s',
    value => rejected(value)
  );

  it.each([
    { kind: undefined },
    { kind: '' },
    { schema: null },
    { scopeKey: '' },
    { scopeKey: null },
    { records: null },
    { records: {} },
    { records: [null] },
    { records: [{}] },
    { records: [{ conversationId: null }] },
    { records: [{ conversationId: '' }] },
    { records: [{ conversationId: id(1), marker: undefined }] },
    { records: [{ conversationId: id(1), marker: null }] },
    { records: [{ conversationId: id(1), marker: {} }] },
    { records: [{ conversationId: id(1), marker: { source: markerSource, token: '' } }] },
    { records: [{ conversationId: id(1), marker: { source: markerSource, token: 1 } }] },
    { records: [{ conversationId: id(1), marker: { source: null, token: 'x' } }] },
  ])('rejects malformed observed field %j', patch => rejected({ ...page(), ...patch }));

  it.each([{ kind: 'catalog' }, { schema: 'claude-list-page-observation/2' }])(
    'does not infer support for another observation %j',
    patch => {
      unsupported({ ...page(), ...patch }, attestation(), 'unsupported-observation');
    }
  );

  it.each([
    'ABCDEF00-0000-4000-8000-000000000001',
    'conversation-1',
    id(1) + 'x',
    id(1) + '\n',
    ' ',
  ])('does not broaden the conservative ADR053 ID policy %j', conversationId => {
    unsupported(page([{ conversationId }]), attestation(), 'unsupported-conversation-identity');
  });

  it('does not accept an unknown marker source', () => {
    unsupported(
      page([{ conversationId: id(1), marker: { source: 'other/1', token: 'opaque' } }]),
      attestation(),
      'unsupported-marker-source'
    );
  });

  it('rejects duplicate IDs with matching, conflicting and missing markers', () => {
    for (const duplicate of [
      target(),
      { ...target(), marker: { source: markerSource, token: 'other' } },
      { conversationId: id(1) },
    ]) {
      rejected(page([target(), duplicate]), 'duplicate-conversation-id');
    }
  });

  it('does not accept the raw transport envelope as an admitted observation', () => {
    rejected({ request: {}, response: {}, scope: {} });
    rejected({ kind: 'unsupported', reason: 'nonterminal-page' });
    rejected({ kind: 'rejected', reason: 'invalid-input' });
  });

  it('rejects unknown fields at every level without getters, traversal or serialization', () => {
    const getter = vi.fn(() => {
      throw new Error('private getter');
    });
    const nested = new Proxy({}, { get: getter, ownKeys: getter, getPrototypeOf: getter });
    const record = target();
    for (const object of [page(), record, record.marker, attestation()]) {
      const input =
        object === record
          ? page([record])
          : object === record.marker
            ? page([record])
            : 'records' in object
              ? object
              : page();
      Object.defineProperty(object, 'toJSON', {
        get: getter,
        enumerable: true,
        configurable: true,
      });
      expect(
        enumerateClaudeBaselineCatalog(input, 'evidence' in object ? object : attestation())
      ).toEqual({ kind: 'rejected', reason: 'invalid-input' });
      Reflect.deleteProperty(object, 'toJSON');
      Object.assign(object, { privateUnknown: nested });
      expect(
        enumerateClaudeBaselineCatalog(input, 'evidence' in object ? object : attestation())
      ).toEqual({ kind: 'rejected', reason: 'invalid-input' });
      Reflect.deleteProperty(object, 'privateUnknown');
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    'kind',
    'schema',
    'scopeKey',
    'records',
    'conversationId',
    'marker',
    'source',
    'token',
    'attestationSchema',
    'evidence',
    'attestationScopeKey',
    'organizationBinding',
    'workspaceBinding',
  ])('rejects selected accessor %s without invoking it', field => {
    const record = target();
    const observed = page([record]);
    const evidence = attestation();
    const owners: Record<string, [object, string]> = {
      kind: [observed, 'kind'],
      schema: [observed, 'schema'],
      scopeKey: [observed, 'scopeKey'],
      records: [observed, 'records'],
      conversationId: [record, 'conversationId'],
      marker: [record, 'marker'],
      source: [record.marker, 'source'],
      token: [record.marker, 'token'],
      attestationSchema: [evidence, 'schema'],
      evidence: [evidence, 'evidence'],
      attestationScopeKey: [evidence, 'scopeKey'],
      organizationBinding: [evidence, 'organizationBinding'],
      workspaceBinding: [evidence, 'workspaceBinding'],
    };
    const getter = vi.fn(() => {
      throw new Error('private');
    });
    const [object, key] = owners[field];
    Object.defineProperty(object, key, { enumerable: true, get: getter });
    expect(enumerateClaudeBaselineCatalog(observed, evidence)).toEqual({
      kind: 'rejected',
      reason: 'invalid-input',
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('accepts plain null prototypes but rejects inherited/exotic, symbolic and hidden fields at every level', () => {
    const record = target();
    const observed = page([record]);
    const evidence = attestation();
    for (const value of [observed, record, record.marker, evidence]) {
      Object.setPrototypeOf(value, null);
      catalog(observed, evidence);
      Object.setPrototypeOf(value, { inherited: true });
      expect(enumerateClaudeBaselineCatalog(observed, evidence)).toEqual({
        kind: 'rejected',
        reason: 'invalid-input',
      });
      Object.setPrototypeOf(value, Object.prototype);
      const symbol = Symbol('private');
      Object.defineProperty(value, symbol, { value: true, configurable: true });
      expect(enumerateClaudeBaselineCatalog(observed, evidence)).toEqual({
        kind: 'rejected',
        reason: 'invalid-input',
      });
      Reflect.deleteProperty(value, symbol);
      const key = Object.keys(value)[0];
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      Object.defineProperty(value, key, { ...descriptor, enumerable: false });
      expect(enumerateClaudeBaselineCatalog(observed, evidence)).toEqual({
        kind: 'rejected',
        reason: 'invalid-input',
      });
      Object.defineProperty(value, key, descriptor);
    }
    const inherited = Object.create(null);
    Object.assign(inherited, { schema: observed.schema, scopeKey, records: [] });
    rejected(inherited);
  });

  it('rejects sparse, accessor, decorated, symbolic and exotic arrays without reading entries', () => {
    const getter = vi.fn(() => target());
    const accessor = [target()];
    Object.defineProperty(accessor, '0', { get: getter, enumerable: true });
    const symbolic = [target()];
    Object.defineProperty(symbolic, Symbol('private'), { value: true });
    const hidden = [target()];
    Object.defineProperty(hidden, '0', { enumerable: false });
    const exotic = [target()];
    Object.setPrototypeOf(exotic, null);
    for (const records of [
      new Array(1),
      accessor,
      symbolic,
      hidden,
      exotic,
      Object.assign([target()], { extra: true }),
    ])
      rejected(page(records));
    expect(getter).not.toHaveBeenCalled();
  });

  it('contains observable Proxy failures without coercing or exposing private exceptions', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    rejected(revoked.proxy);
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const failTrap = () => {
        throw new Error('private exception');
      };
      rejected(new Proxy(page(), { [trap]: failTrap }));
      rejected(page([new Proxy(target(), { [trap]: failTrap })]));
      rejected(
        page([
          {
            conversationId: id(1),
            marker: new Proxy(target().marker, { [trap]: failTrap }),
          },
        ])
      );
      expect(
        enumerateClaudeBaselineCatalog(page(), new Proxy(attestation(), { [trap]: failTrap }))
      ).toEqual({ kind: 'rejected', reason: 'invalid-input' });
    }
    const coercion = { toString: vi.fn(), toJSON: vi.fn() };
    rejected(
      new Proxy(page(), {
        ownKeys: () => {
          throw coercion;
        },
      })
    );
    expect(coercion.toString).not.toHaveBeenCalled();
    expect(coercion.toJSON).not.toHaveBeenCalled();
    catalog(new Proxy(page(), {}), new Proxy(attestation(), {}));
  });

  it('enforces hard record/token bounds and every lowered data limit', () => {
    catalog(page(Array.from({ length: 30 }, (_, n) => target(n))));
    rejected(page(Array.from({ length: 31 }, (_, n) => target(n))), 'limit-exceeded');
    catalog(
      page([{ conversationId: id(1), marker: { source: markerSource, token: 'x'.repeat(256) } }])
    );
    rejected(
      page([{ conversationId: id(1), marker: { source: markerSource, token: 'x'.repeat(257) } }]),
      'limit-exceeded'
    );
    const lower = {
      maxRecords: 1,
      maxTokenCodeUnits: 'opaque-1'.length,
      maxScopeKeyCodeUnits: scopeKey.length,
      maxIdentityCodeUnits: 36,
      maxObjectKeys: 5,
      maxKeyCodeUnits: 'organizationBinding'.length,
    };
    catalog(page(), attestation(), lower);
    for (const [key, value] of Object.entries(lower))
      rejected(page(), 'limit-exceeded', { [key]: value - 1 });
    catalog(page([]), attestation(), { maxRecords: 0 });
    catalog(page([{ conversationId: id(1) }]), attestation(), { maxTokenCodeUnits: 0 });
    for (const key of Object.keys(CLAUDE_BASELINE_HARD_LIMITS))
      rejected(page(), 'limit-exceeded', { [key]: 0 });
  });

  it('bounds object/key/scope/identity sizes before unsupported spellings or unknown values', () => {
    const keys = Object.fromEntries(Array.from({ length: 65 }, (_, n) => [`extra-${n}`, null]));
    rejected(keys, 'limit-exceeded');
    rejected({ ...page(), ['x'.repeat(129)]: null }, 'limit-exceeded');
    rejected({ ...page(), scopeKey: 'x'.repeat(257) }, 'limit-exceeded');
    rejected(page([{ conversationId: 'x'.repeat(129) }]), 'limit-exceeded');
    unsupported({ ...page(), scopeKey: 'x'.repeat(256) }, attestation(), 'unsupported-scope-key');
    unsupported(
      page([{ conversationId: 'x'.repeat(128) }]),
      attestation(),
      'unsupported-conversation-identity'
    );
  });

  it.each(Object.entries(CLAUDE_BASELINE_HARD_LIMITS))('never raises limit %s', (name, max) => {
    for (const value of [max + 1, -1, -0, 1.5, '1', Infinity, NaN, undefined])
      rejected(page(), 'invalid-limits', { [name]: value });
    catalog(page(), attestation(), { [name]: max });
  });

  it('rejects malformed, exotic and accessor overrides without executing getters', () => {
    const getter = vi.fn(() => 1);
    const symbolic = { [Symbol('private')]: 1 };
    const accessor = Object.defineProperty({}, 'maxRecords', { get: getter, enumerable: true });
    for (const limits of [
      null,
      [],
      new Date(),
      { unknown: 1 },
      symbolic,
      accessor,
      Object.create({ maxRecords: 1 }),
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('private');
          },
        }
      ),
    ])
      rejected(page(), 'invalid-limits', limits);
    expect(getter).not.toHaveBeenCalled();
  });
});
