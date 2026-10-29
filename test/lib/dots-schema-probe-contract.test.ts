import { describe, expect, it, vi } from 'vitest';
import {
  DOTS_SCHEMA_KNOWN_FIELDS,
  DOTS_SCHEMA_PROBE_ENDPOINTS,
  DOTS_SCHEMA_PROBE_ERROR_CODES,
  DOTS_SCHEMA_PROBE_FILE_NAME,
  DOTS_SCHEMA_PROBE_MAX_ARRAY_ITEMS,
  DOTS_SCHEMA_PROBE_MAX_ARRAY_SHAPES,
  DOTS_SCHEMA_PROBE_MAX_BYTES,
  DOTS_SCHEMA_PROBE_MAX_DEPTH,
  DOTS_SCHEMA_PROBE_MAX_NODES,
  DOTS_SCHEMA_PROBE_MAX_OBJECT_PROPERTIES,
  DOTS_SCHEMA_PROBE_SCOPE,
  DOTS_SCHEMA_PROBE_SCHEMA,
  createDotsSchemaProbeFailure,
  isDotsSchemaProbeEvidence,
  isDotsSchemaProbeResponse,
  snapshotDotsSchemaProbeEvidence,
  type DotsSchemaShape,
} from '../../src/lib/dots-schema-probe-contract';

function evidence(shape: DotsSchemaShape = { type: 'string' }) {
  return {
    schema: DOTS_SCHEMA_PROBE_SCHEMA,
    scope: { ...DOTS_SCHEMA_PROBE_SCOPE },
    endpoints: {
      roomMetadata: {
        method: 'GET',
        pathPattern: DOTS_SCHEMA_PROBE_ENDPOINTS.roomMetadata,
        mediaType: 'application/json',
        shape: { type: 'object', fields: [], unknownProperties: 'none' },
      },
      roomMessages: {
        method: 'GET',
        pathPattern: DOTS_SCHEMA_PROBE_ENDPOINTS.roomMessages,
        mediaType: 'application/json',
        shape,
      },
    },
  };
}

function objectShape(shape: DotsSchemaShape): DotsSchemaShape {
  return { type: 'object', fields: [{ name: 'data', shape }], unknownProperties: 'none' };
}

function nestedShape(depth: number): DotsSchemaShape {
  let shape: DotsSchemaShape = { type: 'null' };
  for (let index = 1; index < depth; index += 1) shape = objectShape(shape);
  return shape;
}

function distinctShapes(count: number): DotsSchemaShape[] {
  const types = ['boolean', 'null', 'number', 'string'] as const;
  return Array.from(
    { length: count },
    (_, index): DotsSchemaShape => ({
      type: 'object',
      fields: [
        {
          name: DOTS_SCHEMA_KNOWN_FIELDS[Math.floor(index / 4)],
          shape: { type: types[index % 4] },
        },
      ],
      unknownProperties: 'none',
    })
  ).sort((left, right) => {
    const a = JSON.stringify(left);
    const b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function wideShape(depth: number): DotsSchemaShape {
  if (depth === 1) return { type: 'string' };
  return {
    type: 'object',
    fields: DOTS_SCHEMA_KNOWN_FIELDS.map(name => ({ name, shape: wideShape(depth - 1) })),
    unknownProperties: 'none',
  };
}

describe('Dots schema-only evidence contract', () => {
  it('accepts a detached fixed-scope pair with only structural scalar types', () => {
    const source = evidence({
      type: 'object',
      fields: [
        { name: 'has_more', shape: { type: 'boolean' } },
        {
          name: 'messages',
          shape: { type: 'array', itemShapes: [{ type: 'null' }, { type: 'string' }] },
        },
      ],
      unknownProperties: 'present',
    });
    const snapshot = snapshotDotsSchemaProbeEvidence(source);
    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot?.scope).not.toBe(source.scope);
    expect(snapshot?.endpoints.roomMessages.shape).not.toBe(source.endpoints.roomMessages.shape);
    source.scope.valuesRetained = true as never;
    source.endpoints.roomMessages.shape = { type: 'number' };
    expect(snapshot?.scope.valuesRetained).toBe(false);
    expect(snapshot?.endpoints.roomMessages.shape.type).toBe('object');
    expect(isDotsSchemaProbeEvidence(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/https:|room-[0-9]|private|secret/);
  });

  it('accepts null-prototype records but never custom record or array prototypes', () => {
    const source = evidence();
    Object.setPrototypeOf(source, null);
    Object.setPrototypeOf(source.scope, null);
    expect(isDotsSchemaProbeEvidence(source)).toBe(true);
    expect(
      isDotsSchemaProbeEvidence(Object.assign(Object.create({ secret: 'no' }), evidence()))
    ).toBe(false);
    const shape = { type: 'array', itemShapes: [{ type: 'string' }] } as DotsSchemaShape;
    if (shape.type === 'array' && Array.isArray(shape.itemShapes)) {
      Object.setPrototypeOf(shape.itemShapes, null);
    }
    expect(isDotsSchemaProbeEvidence(evidence(shape))).toBe(false);
  });

  it.each([null, undefined, false, 0, '', [], Symbol('private')])(
    'rejects primitive envelope %s',
    value => {
      expect(snapshotDotsSchemaProbeEvidence(value)).toBeUndefined();
      expect(isDotsSchemaProbeResponse(value)).toBe(false);
    }
  );

  it('requires every fixed claim and endpoint without extras or content-bearing fields', () => {
    for (const key of Object.keys(DOTS_SCHEMA_PROBE_SCOPE)) {
      const source = evidence();
      Object.defineProperty(source.scope, key, { value: 'private-value', enumerable: true });
      expect(isDotsSchemaProbeEvidence(source), key).toBe(false);
    }
    const malformed = [
      { ...evidence(), schema: 'liska-dots-schema-probe/2' },
      { ...evidence(), roomId: 'private-room' },
      { ...evidence(), scope: { ...DOTS_SCHEMA_PROBE_SCOPE, nonce: 'private' } },
      { ...evidence(), endpoints: { ...evidence().endpoints, live: {} } },
    ];
    for (const source of malformed) expect(isDotsSchemaProbeEvidence(source)).toBe(false);
    for (const endpoint of ['roomMetadata', 'roomMessages'] as const) {
      for (const change of [
        { method: 'POST' },
        { pathPattern: '/backend-api/messaging/rooms/private-room' },
        { mediaType: 'application/problem+json' },
        { byteLength: 42 },
        { sha256: 'a'.repeat(64) },
      ]) {
        const source = evidence();
        Object.assign(source.endpoints[endpoint], change);
        expect(isDotsSchemaProbeEvidence(source)).toBe(false);
      }
    }
    for (const key of ['schema', 'scope', 'endpoints']) {
      const source = evidence() as Record<string, unknown>;
      delete source[key];
      expect(isDotsSchemaProbeEvidence(source)).toBe(false);
    }
  });

  it('rejects private/dynamic field names and actual scalar payloads', () => {
    for (const name of [
      'private@example.test',
      'secret-token',
      '__proto__',
      'constructor',
      'memory',
      'persona',
      'account',
    ]) {
      const shape = {
        type: 'object',
        fields: [{ name, shape: { type: 'string' } }],
        unknownProperties: 'none',
      };
      expect(isDotsSchemaProbeEvidence(evidence(shape as DotsSchemaShape))).toBe(false);
    }
    for (const shape of [
      { type: 'string', value: 'private text' },
      { type: 'number', value: 3 },
      { type: 'boolean', value: false },
      { type: 'null', value: null },
      { type: 'private text' },
      7,
      'string',
      null,
    ]) {
      expect(isDotsSchemaProbeEvidence(evidence(shape as DotsSchemaShape))).toBe(false);
    }
  });

  it('never invokes accessors or toJSON anywhere in the caller tree', () => {
    for (const target of ['root', 'scope', 'endpoint', 'shape', 'field', 'array'] as const) {
      const shape: DotsSchemaShape = {
        type: 'object',
        fields: [{ name: 'id', shape: { type: 'string' } }],
        unknownProperties: 'none',
      };
      const source = evidence(shape);
      const getter = vi.fn(() => 'private');
      const object =
        target === 'root'
          ? source
          : target === 'scope'
            ? source.scope
            : target === 'endpoint'
              ? source.endpoints.roomMessages
              : target === 'shape'
                ? shape
                : target === 'field'
                  ? shape.fields[0]
                  : shape.fields;
      const key =
        target === 'array'
          ? '0'
          : target === 'field'
            ? 'name'
            : target === 'shape'
              ? 'type'
              : target === 'endpoint'
                ? 'mediaType'
                : target === 'scope'
                  ? 'provider'
                  : 'schema';
      Object.defineProperty(object, key, { get: getter, enumerable: true, configurable: true });
      expect(isDotsSchemaProbeEvidence(source), target).toBe(false);
      expect(getter).not.toHaveBeenCalled();
    }
    const source = evidence();
    const toJSON = vi.fn(() => ({ secret: 'private' }));
    Object.defineProperty(source.endpoints.roomMetadata.shape, 'toJSON', {
      value: toJSON,
      enumerable: false,
    });
    expect(isDotsSchemaProbeEvidence(source)).toBe(false);
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('rejects symbols, nonenumerable fields, sparse arrays, cycles, and throwing reflection', () => {
    const symbol = evidence();
    Object.defineProperty(symbol.scope, Symbol('private'), { value: true });
    expect(isDotsSchemaProbeEvidence(symbol)).toBe(false);
    const hidden = evidence();
    Object.defineProperty(hidden.scope, 'provider', { value: 'chatgpt-dots', enumerable: false });
    expect(isDotsSchemaProbeEvidence(hidden)).toBe(false);
    const sparse: DotsSchemaShape[] = new Array(1);
    expect(isDotsSchemaProbeEvidence(evidence({ type: 'array', itemShapes: sparse }))).toBe(false);
    const cyclic = objectShape({ type: 'null' });
    if (cyclic.type === 'object') cyclic.fields[0].shape = cyclic;
    expect(isDotsSchemaProbeEvidence(evidence(cyclic))).toBe(false);
    const proxy = new Proxy(evidence(), {
      getPrototypeOf() {
        throw new Error('private');
      },
    });
    expect(() => snapshotDotsSchemaProbeEvidence(proxy)).not.toThrow();
    expect(snapshotDotsSchemaProbeEvidence(proxy)).toBeUndefined();
    const extraArrayProperty = [{ type: 'string' }] as DotsSchemaShape[];
    Object.defineProperty(extraArrayProperty, Symbol('private'), { value: true });
    expect(
      isDotsSchemaProbeEvidence(evidence({ type: 'array', itemShapes: extraArrayProperty }))
    ).toBe(false);
  });

  it('requires strictly sorted unique object fields and array shapes', () => {
    const field = { name: 'id' as const, shape: { type: 'string' as const } };
    for (const fields of [
      [field, field],
      [{ name: 'text' as const, shape: { type: 'string' as const } }, field],
    ]) {
      expect(
        isDotsSchemaProbeEvidence(evidence({ type: 'object', fields, unknownProperties: 'none' }))
      ).toBe(false);
    }
    for (const itemShapes of [
      [],
      [{ type: 'string' as const }, { type: 'string' as const }],
      [{ type: 'string' as const }, { type: 'null' as const }],
    ]) {
      expect(isDotsSchemaProbeEvidence(evidence({ type: 'array', itemShapes }))).toBe(false);
    }
    expect(isDotsSchemaProbeEvidence(evidence({ type: 'array', itemShapes: 'unobserved' }))).toBe(
      true
    );
    expect(
      isDotsSchemaProbeEvidence(
        evidence({ type: 'array', itemShapes: distinctShapes(DOTS_SCHEMA_PROBE_MAX_ARRAY_SHAPES) })
      )
    ).toBe(true);
    expect(
      isDotsSchemaProbeEvidence(
        evidence({
          type: 'array',
          itemShapes: distinctShapes(DOTS_SCHEMA_PROBE_MAX_ARRAY_SHAPES + 1),
        })
      )
    ).toBe(false);
  });

  it('enforces depth and object-width bounds before serialization', () => {
    expect(isDotsSchemaProbeEvidence(evidence(nestedShape(DOTS_SCHEMA_PROBE_MAX_DEPTH)))).toBe(
      true
    );
    expect(isDotsSchemaProbeEvidence(evidence(nestedShape(DOTS_SCHEMA_PROBE_MAX_DEPTH + 1)))).toBe(
      false
    );
    const fields = Array.from({ length: DOTS_SCHEMA_PROBE_MAX_OBJECT_PROPERTIES + 1 }, () => ({
      name: 'id' as const,
      shape: { type: 'string' as const },
    }));
    expect(
      isDotsSchemaProbeEvidence(evidence({ type: 'object', fields, unknownProperties: 'none' }))
    ).toBe(false);
    const oversized = evidence(wideShape(4));
    const stringify = vi.spyOn(JSON, 'stringify');
    expect(snapshotDotsSchemaProbeEvidence(oversized)).toBeUndefined();
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it('refuses otherwise-valid evidence beyond the final 32 KiB ceiling', () => {
    const source = evidence(wideShape(3));
    expect(JSON.stringify(source).length).toBeGreaterThan(DOTS_SCHEMA_PROBE_MAX_BYTES);
    expect(snapshotDotsSchemaProbeEvidence(source)).toBeUndefined();
  });

  it('exports fixed non-raiseable traversal policy and lexicographic vocabulary', () => {
    expect(DOTS_SCHEMA_PROBE_MAX_BYTES).toBe(32 * 1024);
    expect(DOTS_SCHEMA_PROBE_MAX_DEPTH).toBe(12);
    expect(DOTS_SCHEMA_PROBE_MAX_NODES).toBe(20_000);
    expect(DOTS_SCHEMA_PROBE_MAX_OBJECT_PROPERTIES).toBe(128);
    expect(DOTS_SCHEMA_PROBE_MAX_ARRAY_ITEMS).toBe(2_000);
    expect(DOTS_SCHEMA_PROBE_MAX_ARRAY_SHAPES).toBe(32);
    expect([...DOTS_SCHEMA_KNOWN_FIELDS].sort()).toEqual(DOTS_SCHEMA_KNOWN_FIELDS);
    expect(Object.isFrozen(DOTS_SCHEMA_KNOWN_FIELDS)).toBe(true);
  });

  it('accepts only the fixed filename or finite failure codes in popup responses', () => {
    expect(
      isDotsSchemaProbeResponse({ success: true, fileName: DOTS_SCHEMA_PROBE_FILE_NAME })
    ).toBe(true);
    for (const code of DOTS_SCHEMA_PROBE_ERROR_CODES) {
      expect(isDotsSchemaProbeResponse(createDotsSchemaProbeFailure(code))).toBe(true);
    }
    for (const value of [
      { success: true, fileName: 'private-room.json' },
      { success: true, fileName: DOTS_SCHEMA_PROBE_FILE_NAME, roomId: 'private' },
      { success: false, code: 'private exception text' },
      { success: false, code: 'timed-out', error: 'private' },
      Object.assign(Object.create({ private: true }), { success: false, code: 'timed-out' }),
    ])
      expect(isDotsSchemaProbeResponse(value)).toBe(false);
    const getter = vi.fn(() => true);
    expect(
      isDotsSchemaProbeResponse({
        get success() {
          return getter();
        },
        fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
      })
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('admits only the exact fixed RequestInit-presence failure response', () => {
    expect(DOTS_SCHEMA_PROBE_ERROR_CODES).toContain('request-init-present');
    expect(isDotsSchemaProbeResponse(createDotsSchemaProbeFailure('request-init-present'))).toBe(
      true
    );
    expect(
      isDotsSchemaProbeResponse({
        success: false,
        code: 'request-init-present',
        init: { headers: 'private' },
      })
    ).toBe(false);
    expect(
      isDotsSchemaProbeResponse({ success: false, code: 'request-init-present: private' })
    ).toBe(false);
  });
});
