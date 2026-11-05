import {
  EVIDENCE_SCHEMA,
  FILE_ASSURANCE,
  OBSIDIAN_ASSURANCE,
  OPERATION_SCHEMA,
  STRICT_COMPLETENESS,
  type PurposeLimits,
  type RejectionCode,
} from './contracts';
import { fail, type Data, type RecordData } from './data';

// Keep the small mutually reused schema parsers scoped to one limit/error context;
// splitting the factory would expose parser internals or add context plumbing to every check.
// eslint-disable-next-line max-lines-per-function
export function validator(limits: PurposeLimits, code: RejectionCode) {
  const check = (condition: unknown): void => {
    if (!condition) fail(code);
  };
  const record = (value: Data | undefined, keys: string[]): RecordData => {
    check(value !== null && typeof value === 'object' && !Array.isArray(value));
    const obj = value as RecordData;
    check(Object.keys(obj).every(key => keys.includes(key)));
    return obj;
  };
  const text = (value: Data | undefined): string => {
    check(typeof value === 'string' && value.length > 0);
    check(
      ![...(value as string)].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    );
    return value as string;
  };
  const id = (value: Data | undefined): string => {
    const result = text(value);
    if (result.length > limits.maxIdentifierCodeUnits) fail('limit-exceeded');
    check(result === result.trim());
    return result;
  };
  const hash = (value: Data | undefined): void => check(/^[a-f0-9]{64}$/u.test(text(value)));
  const bytes = (value: Data | undefined): void => {
    check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
    if ((value as number) > limits.maxArtifactBytes) fail('limit-exceeded');
  };
  const relativePath = (value: Data | undefined): void => {
    const path = text(value);
    // Portable exact relative paths: no traversal, drive, alternate separator or normalization.
    check(
      !/[\\:*?"<>|]/u.test(path) &&
        path
          .split('/')
          .every(part => part !== '' && part !== '.' && part !== '..' && !/[. ]$/u.test(part))
    );
  };
  const list = (value: Data | undefined): Data[] => {
    check(Array.isArray(value));
    return value as Data[];
  };
  const optional = (obj: RecordData, key: string, parse: (value: Data) => void) => {
    if (key in obj) parse(obj[key]);
  };
  const commitment = (value: Data): void => {
    const obj = record(value, ['relativePath', 'byteLength', 'sha256']);
    relativePath(obj.relativePath);
    bytes(obj.byteLength);
    hash(obj.sha256);
  };
  const binding = (value: Data, operation = false): RecordData => {
    const keys = [
      'purpose',
      'operationId',
      'attemptId',
      'captureId',
      'admission',
      'sourceSelection',
    ];
    const obj = record(
      value,
      operation ? [...keys, 'schema', 'destinations', 'completenessPolicy'] : keys
    );
    id(obj.purpose);
    for (const key of ['operationId', 'attemptId', 'captureId']) id(obj[key]);
    const admission = record(obj.admission, ['provider', 'conversationId', 'conversationKey']);
    check(/^[a-z][a-z0-9-]{0,63}$/u.test(id(admission.provider)));
    id(admission.conversationId);
    check(/^liska-conversation-key\/1:[a-f0-9]{64}$/u.test(text(admission.conversationKey)));
    hash(record(obj.sourceSelection, ['catalogSha256']).catalogSha256);
    return obj;
  };
  const operation = (value: Data): void => {
    const obj = binding(value, true);
    check(obj.schema === OPERATION_SCHEMA && obj.purpose === 'new-capture');
    check(obj.completenessPolicy === STRICT_COMPLETENESS);
    const destinations = list(obj.destinations);
    check(destinations.length > 0 && destinations.length <= 2);
    const seen = new Set<string>();
    for (const entry of destinations) {
      const requirement = record(entry, ['destination', 'assurance']);
      const destination = text(requirement.destination);
      check(!seen.has(destination));
      seen.add(destination);
      check(
        (destination === 'file' && requirement.assurance === FILE_ASSURANCE) ||
          (destination === 'obsidian' && requirement.assurance === OBSIDIAN_ASSURANCE)
      );
    }
    destinations.sort((a, b) => {
      const left = (a as RecordData).destination as string;
      const right = (b as RecordData).destination as string;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  };
  const completeness = (value: Data): void => {
    const obj = record(value, ['policy', 'graph', 'messages', 'branches', 'assetInventory']);
    optional(obj, 'policy', text);
    for (const key of ['graph', 'messages', 'branches', 'assetInventory'])
      optional(obj, key, state => check(['complete', 'partial', 'unknown'].includes(text(state))));
  };
  const asset = (value: Data): void => {
    const obj = record(value, ['assetId', 'state', 'commitment']);
    id(obj.assetId);
    optional(obj, 'state', state => check(['fetched', 'missing', 'unknown'].includes(text(state))));
    optional(obj, 'commitment', commitment);
  };
  const observation = (value: Data): void => {
    const obj = record(value, ['commitment', 'file', 'readback']);
    commitment(obj.commitment);
    optional(obj, 'file', value => {
      const file = record(value, ['basis', 'state', 'observedRelativePath']);
      optional(file, 'basis', text);
      optional(file, 'state', state => check(['complete', 'unknown'].includes(text(state))));
      optional(file, 'observedRelativePath', relativePath);
    });
    optional(obj, 'readback', value => {
      const readback = record(value, ['byteLength', 'sha256']);
      bytes(readback.byteLength);
      hash(readback.sha256);
    });
  };
  const assurance = (value: Data): void => {
    const obj = record(value, ['kind', 'destination', 'binding', 'manifest', 'artifacts']);
    optional(obj, 'kind', text);
    optional(obj, 'destination', id);
    optional(obj, 'binding', binding);
    optional(obj, 'manifest', commitment);
    optional(obj, 'artifacts', value => list(value).forEach(observation));
  };
  const destination = (value: Data): void => {
    const obj = record(value, [
      'destination',
      'manifest',
      'raw',
      'canonical',
      'completeness',
      'assets',
      'assurance',
    ]);
    id(obj.destination);
    for (const key of ['manifest', 'raw', 'canonical']) optional(obj, key, commitment);
    optional(obj, 'completeness', completeness);
    optional(obj, 'assets', value => {
      const assets = list(value);
      if (assets.length > limits.maxAssetsPerDestination) fail('limit-exceeded');
      assets.forEach(asset);
    });
    optional(obj, 'assurance', assurance);
  };
  const evidence = (value: Data): void => {
    const obj = record(value, ['schema', 'binding', 'destinations']);
    check(obj.schema === EVIDENCE_SCHEMA);
    optional(obj, 'binding', binding);
    optional(obj, 'destinations', value => list(value).forEach(destination));
  };
  return { operation, evidence };
}
