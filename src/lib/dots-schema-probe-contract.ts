/**
 * Content-free evidence contract for one observed Dots room pair. This is not
 * conversation capture: neither provider values nor unknown property names may
 * cross this boundary. Only a newly constructed, validated snapshot is sized.
 */

export const DOTS_SCHEMA_PROBE_SCHEMA = 'liska-dots-schema-probe/1';
export const DOTS_SCHEMA_PROBE_FILE_NAME = 'liska-dots-schema-probe.json';
export const DOTS_SCHEMA_PROBE_MAX_BYTES = 32 * 1024;
export const DOTS_SCHEMA_PROBE_MAX_DEPTH = 12;
export const DOTS_SCHEMA_PROBE_MAX_NODES = 20_000;
export const DOTS_SCHEMA_PROBE_MAX_OBJECT_PROPERTIES = 128;
export const DOTS_SCHEMA_PROBE_MAX_ARRAY_ITEMS = 2_000;
export const DOTS_SCHEMA_PROBE_MAX_ARRAY_SHAPES = 32;
export const DOTS_SCHEMA_PROBE_METADATA_MAX_BYTES = 256 * 1024;
export const DOTS_SCHEMA_PROBE_MESSAGES_MAX_BYTES = 2 * 1024 * 1024;
export const DOTS_SCHEMA_PROBE_OBSERVATION_MS = 15_000;
export const DOTS_SCHEMA_PROBE_TIMEOUT_MS = 20_000;

/** Fixed schema vocabulary, never learned from a provider response. */
export const DOTS_SCHEMA_KNOWN_FIELDS = Object.freeze([
  'attachments',
  'author',
  'content',
  'created_at',
  'cursor',
  'data',
  'has_more',
  'hidden',
  'id',
  'items',
  'message',
  'message_id',
  'messages',
  'next_cursor',
  'pagination',
  'parent_id',
  'parts',
  'results',
  'role',
  'room',
  'room_id',
  'status',
  'text',
  'thread',
  'thread_id',
  'timestamp',
  'type',
  'updated_at',
] as const);
export type DotsSchemaKnownField = (typeof DOTS_SCHEMA_KNOWN_FIELDS)[number];

export type DotsSchemaShape =
  | { type: 'null' | 'boolean' | 'number' | 'string' }
  | {
      type: 'object';
      fields: Array<{ name: DotsSchemaKnownField; shape: DotsSchemaShape }>;
      unknownProperties: 'none' | 'present';
    }
  | { type: 'array'; itemShapes: 'unobserved' | DotsSchemaShape[] };

export const DOTS_SCHEMA_PROBE_SCOPE = Object.freeze({
  provider: 'chatgpt-dots',
  pairing: 'same-room',
  historyCompleteness: 'unverified',
  currentConversationIdentity: 'unverified',
  valuesRetained: false,
  unknownPropertyNamesRetained: false,
  tboBodiesObserved: false,
  realtimeBodiesObserved: false,
} as const);

export const DOTS_SCHEMA_PROBE_ENDPOINTS = Object.freeze({
  roomMetadata: '/backend-api/messaging/rooms/{room}',
  roomMessages: '/backend-api/messaging/rooms/{room}/messages?limit={redacted}',
} as const);

type DotsSchemaEndpoint<Path extends string> = {
  method: 'GET';
  pathPattern: Path;
  mediaType: 'application/json';
  shape: DotsSchemaShape;
};

export interface DotsSchemaProbeEvidence {
  schema: typeof DOTS_SCHEMA_PROBE_SCHEMA;
  scope: typeof DOTS_SCHEMA_PROBE_SCOPE;
  endpoints: {
    roomMetadata: DotsSchemaEndpoint<typeof DOTS_SCHEMA_PROBE_ENDPOINTS.roomMetadata>;
    roomMessages: DotsSchemaEndpoint<typeof DOTS_SCHEMA_PROBE_ENDPOINTS.roomMessages>;
  };
}

export const DOTS_SCHEMA_PROBE_ERROR_CODES = Object.freeze([
  'invalid-sender',
  'invalid-message',
  'permission-unavailable',
  'active-tab-required',
  'dots-route-required',
  'conflicting-fragment',
  'operation-in-progress',
  'nonce-invalid',
  'tab-update-failed',
  'document-unavailable',
  'document-replaced',
  'navigation-changed',
  'timed-out',
  'target-not-observed',
  'ambiguous-room',
  'duplicate-endpoint',
  'request-failed',
  'response-http-error',
  'response-route-mismatch',
  'response-media-type-invalid',
  'response-processing-failed',
  'payload-too-large',
  'schema-invalid',
  'schema-limit-exceeded',
  'result-invalid',
  'download-failed',
  'cleanup-failed',
  'hook-state-failed',
] as const);
export type DotsSchemaProbeErrorCode = (typeof DOTS_SCHEMA_PROBE_ERROR_CODES)[number];
export type DotsSchemaProbeResponse =
  | { success: true; fileName: typeof DOTS_SCHEMA_PROBE_FILE_NAME }
  | { success: false; code: DotsSchemaProbeErrorCode };

const knownFields = new Set<string>(DOTS_SCHEMA_KNOWN_FIELDS);
const scopeKeys = Object.keys(DOTS_SCHEMA_PROBE_SCOPE);

/** Descriptor-only reads keep accessors/toJSON out of validation and sizing. */
function dataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length) return undefined;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !expectedKeys.includes(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value: unknown, maxLength: number): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) return undefined;
  if (Reflect.ownKeys(value).length !== length + 1) return undefined;
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    result.push(descriptor.value);
  }
  return result;
}

interface ShapeBudget {
  nodes: number;
  ancestors: WeakSet<object>;
}

function snapshotObjectShape(
  value: unknown,
  depth: number,
  budget: ShapeBudget
): DotsSchemaShape | undefined {
  const record = dataRecord(value, ['type', 'fields', 'unknownProperties']);
  if (
    !record ||
    record.type !== 'object' ||
    (record.unknownProperties !== 'none' && record.unknownProperties !== 'present')
  ) {
    return undefined;
  }
  const fields = denseArray(record.fields, DOTS_SCHEMA_PROBE_MAX_OBJECT_PROPERTIES);
  if (!fields) return undefined;
  const snapshot: Array<{ name: DotsSchemaKnownField; shape: DotsSchemaShape }> = [];
  let previousName = '';
  for (const valueField of fields) {
    const field = dataRecord(valueField, ['name', 'shape']);
    if (!field || typeof field.name !== 'string' || !knownFields.has(field.name)) return undefined;
    if (field.name <= previousName) return undefined;
    const shape = snapshotShape(field.shape, depth + 1, budget);
    if (!shape) return undefined;
    snapshot.push({ name: field.name as DotsSchemaKnownField, shape });
    previousName = field.name;
  }
  return { type: 'object', fields: snapshot, unknownProperties: record.unknownProperties };
}

function snapshotArrayShape(
  value: unknown,
  depth: number,
  budget: ShapeBudget
): DotsSchemaShape | undefined {
  const record = dataRecord(value, ['type', 'itemShapes']);
  if (!record || record.type !== 'array') return undefined;
  if (record.itemShapes === 'unobserved') return { type: 'array', itemShapes: 'unobserved' };
  const items = denseArray(record.itemShapes, DOTS_SCHEMA_PROBE_MAX_ARRAY_SHAPES);
  if (!items || items.length === 0) return undefined;
  const snapshot: DotsSchemaShape[] = [];
  let previousKey = '';
  for (const item of items) {
    const shape = snapshotShape(item, depth + 1, budget);
    if (!shape) return undefined;
    // The string is built only from the detached, fixed-vocabulary snapshot.
    const key = JSON.stringify(shape);
    if (key <= previousKey) return undefined;
    snapshot.push(shape);
    previousKey = key;
  }
  return { type: 'array', itemShapes: snapshot };
}

// eslint-disable-next-line complexity -- Keep the recursive fixed-shape trust boundary linear and auditable.
function snapshotShape(
  value: unknown,
  depth: number,
  budget: ShapeBudget
): DotsSchemaShape | undefined {
  if (depth > DOTS_SCHEMA_PROBE_MAX_DEPTH || ++budget.nodes > DOTS_SCHEMA_PROBE_MAX_NODES) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || budget.ancestors.has(value)) return undefined;
  budget.ancestors.add(value);
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    const type: unknown = descriptor.value;
    if (type === 'object') return snapshotObjectShape(value, depth, budget);
    if (type === 'array') return snapshotArrayShape(value, depth, budget);
    if (type !== 'null' && type !== 'boolean' && type !== 'number' && type !== 'string') {
      return undefined;
    }
    return dataRecord(value, ['type'])?.type === type ? { type } : undefined;
  } finally {
    budget.ancestors.delete(value);
  }
}

function snapshotScope(value: unknown): typeof DOTS_SCHEMA_PROBE_SCOPE | undefined {
  const record = dataRecord(value, scopeKeys);
  if (!record) return undefined;
  for (const key of scopeKeys) {
    if (record[key] !== DOTS_SCHEMA_PROBE_SCOPE[key as keyof typeof DOTS_SCHEMA_PROBE_SCOPE]) {
      return undefined;
    }
  }
  return { ...DOTS_SCHEMA_PROBE_SCOPE };
}

function snapshotEndpoint<Path extends string>(
  value: unknown,
  pathPattern: Path,
  budget: ShapeBudget
): DotsSchemaEndpoint<Path> | undefined {
  const record = dataRecord(value, ['method', 'pathPattern', 'mediaType', 'shape']);
  if (
    !record ||
    record.method !== 'GET' ||
    record.pathPattern !== pathPattern ||
    record.mediaType !== 'application/json'
  )
    return undefined;
  const shape = snapshotShape(record.shape, 1, budget);
  return shape ? { method: 'GET', pathPattern, mediaType: 'application/json', shape } : undefined;
}

/** Returns a detached canonical snapshot; never size or persist the caller's object. */
export function snapshotDotsSchemaProbeEvidence(
  value: unknown
): DotsSchemaProbeEvidence | undefined {
  try {
    const record = dataRecord(value, ['schema', 'scope', 'endpoints']);
    if (!record || record.schema !== DOTS_SCHEMA_PROBE_SCHEMA) return undefined;
    const scope = snapshotScope(record.scope);
    const endpoints = dataRecord(record.endpoints, ['roomMetadata', 'roomMessages']);
    if (!scope || !endpoints) return undefined;
    const budget: ShapeBudget = { nodes: 0, ancestors: new WeakSet() };
    const roomMetadata = snapshotEndpoint(
      endpoints.roomMetadata,
      DOTS_SCHEMA_PROBE_ENDPOINTS.roomMetadata,
      budget
    );
    const roomMessages = snapshotEndpoint(
      endpoints.roomMessages,
      DOTS_SCHEMA_PROBE_ENDPOINTS.roomMessages,
      budget
    );
    if (!roomMetadata || !roomMessages) return undefined;
    const snapshot: DotsSchemaProbeEvidence = {
      schema: DOTS_SCHEMA_PROBE_SCHEMA,
      scope,
      endpoints: { roomMetadata, roomMessages },
    };
    // Every possible persisted string is ASCII and fixed/allowlisted here.
    return JSON.stringify(snapshot).length <= DOTS_SCHEMA_PROBE_MAX_BYTES ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

export function isDotsSchemaProbeEvidence(value: unknown): value is DotsSchemaProbeEvidence {
  return snapshotDotsSchemaProbeEvidence(value) !== undefined;
}

export function createDotsSchemaProbeFailure(
  code: DotsSchemaProbeErrorCode
): DotsSchemaProbeResponse {
  return { success: false, code };
}

export function isDotsSchemaProbeResponse(value: unknown): value is DotsSchemaProbeResponse {
  try {
    const success = Object.getOwnPropertyDescriptor(value, 'success');
    if (!success || !('value' in success)) return false;
    if (success.value === true) {
      const record = dataRecord(value, ['success', 'fileName']);
      return record?.success === true && record.fileName === DOTS_SCHEMA_PROBE_FILE_NAME;
    }
    if (success.value !== false) return false;
    const record = dataRecord(value, ['success', 'code']);
    return (
      !!record &&
      record.success === false &&
      typeof record.code === 'string' &&
      (DOTS_SCHEMA_PROBE_ERROR_CODES as readonly string[]).includes(record.code)
    );
  } catch {
    return false;
  }
}
