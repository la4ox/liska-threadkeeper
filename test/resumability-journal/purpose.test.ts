// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  admitNewCaptureOperation,
  assessNewCaptureEvidence,
  snapshotNewCaptureOperation,
  EVIDENCE_SCHEMA,
  FILE_ASSURANCE,
  FILE_PATH_BASIS,
  OBSIDIAN_ASSURANCE,
  OPERATION_SCHEMA,
  PURPOSE_HARD_LIMITS,
  STRICT_COMPLETENESS,
  PurposeContractError,
} from '../../src/resumability-journal/purpose';

const hash = (digit = 'a') => digit.repeat(64);
const binding = () => ({
  purpose: 'new-capture',
  operationId: 'op-1',
  attemptId: 'attempt-1',
  captureId: 'capture-1',
  admission: {
    provider: 'chatgpt',
    conversationId: 'conversation-1',
    conversationKey: `liska-conversation-key/1:${hash()}`,
  },
  sourceSelection: { catalogSha256: hash('b') },
});
const operation = (destinations = ['file']) => ({
  schema: OPERATION_SCHEMA,
  ...binding(),
  completenessPolicy: STRICT_COMPLETENESS,
  destinations: destinations.map(destination => ({
    destination,
    assurance: destination === 'file' ? FILE_ASSURANCE : OBSIDIAN_ASSURANCE,
  })),
});
const commitment = (relativePath: string, digit = 'c') => ({
  relativePath,
  byteLength: 42,
  sha256: hash(digit),
});
const destination = (name = 'file') => {
  const manifest = commitment(`${name}/manifest.json`, name === 'file' ? 'd' : 'e');
  const raw = commitment(`${name}/raw.json`);
  const canonical = commitment(`${name}/canonical.md`);
  const asset = commitment(`${name}/assets/one.png`);
  return {
    destination: name,
    manifest,
    raw,
    canonical,
    completeness: {
      policy: STRICT_COMPLETENESS,
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assetInventory: 'complete',
    },
    assets: [{ assetId: 'asset-1', state: 'fetched', commitment: asset }],
    assurance: {
      kind: name === 'file' ? FILE_ASSURANCE : OBSIDIAN_ASSURANCE,
      destination: name,
      binding: binding(),
      manifest: { ...manifest },
      artifacts: [manifest, raw, canonical, asset].map(item => ({
        commitment: { ...item },
        ...(name === 'file'
          ? {
              file: {
                basis: FILE_PATH_BASIS,
                state: 'complete',
                observedRelativePath: item.relativePath,
              },
            }
          : { readback: { byteLength: item.byteLength, sha256: item.sha256 } }),
      })),
    },
  };
};
const evidence = (destinations = ['file']) => ({
  schema: EVIDENCE_SCHEMA,
  binding: binding(),
  destinations: destinations.map(destination),
});
type Mutable = Record<string, unknown>;
const remove = (value: object, key: string) => {
  delete (value as Mutable)[key];
};
const replace = (value: object, key: string, field: unknown) => {
  (value as Mutable)[key] = field;
};
function expectCode(input: unknown, code: string, limits?: unknown) {
  try {
    admitNewCaptureOperation(input, limits);
    throw new Error('unexpected acceptance');
  } catch (error) {
    expect(error).toBeInstanceOf(PurposeContractError);
    expect((error as PurposeContractError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}
function result(input: unknown, kind: string, code: string, op = operation()) {
  const assessed = assessNewCaptureEvidence(op, input);
  expect(assessed.kind).toBe(kind);
  expect(assessed.codes).toContain(code);
  return assessed;
}

describe('new-capture operation admission', () => {
  it('detaches, deeply freezes and canonically orders every object and required destination', () => {
    const input = operation(['obsidian', 'file']);
    const admitted = admitNewCaptureOperation(input);
    expect(admitted.destinations.map(item => item.destination)).toEqual(['file', 'obsidian']);
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(Object.isFrozen(admitted.admission)).toBe(true);
    expect(Object.isFrozen(admitted.destinations)).toBe(true);
    expect(Object.isFrozen(admitted.destinations[0])).toBe(true);
    expect(Object.isFrozen(admitted.sourceSelection)).toBe(true);
    input.captureId = 'changed';
    input.destinations[0].assurance = FILE_ASSURANCE;
    expect(admitted.captureId).toBe('capture-1');
    expect(admitted.destinations[1].assurance).toBe(OBSIDIAN_ASSURANCE);
    expect(snapshotNewCaptureOperation(admitted)).toBe(
      snapshotNewCaptureOperation(operation(['file', 'obsidian']))
    );
    const reordered = Object.fromEntries(Object.entries(operation(['obsidian', 'file'])).reverse());
    expect(snapshotNewCaptureOperation(reordered)).toBe(snapshotNewCaptureOperation(admitted));
  });
  it('structurally accepts provider-aware keys without claiming their digest was computed', () => {
    const input = operation();
    input.admission.provider = 'claude';
    expect(admitNewCaptureOperation(input).admission.provider).toBe('claude');
  });
  it.each([
    'schema',
    'purpose',
    'operationId',
    'attemptId',
    'captureId',
    'admission',
    'sourceSelection',
    'completenessPolicy',
    'destinations',
  ])('requires explicit %s', key => {
    const input = operation();
    remove(input, key);
    expectCode(input, 'invalid-operation');
  });
  it.each(['verify', 'verification', 'new-capture/2'])(
    'rejects purpose %s rather than adapting it',
    purpose => {
      expectCode({ ...operation(), purpose }, 'invalid-operation');
    }
  );
  it.each([[], ['file', 'file'], ['cloud'], ['obsidian', 'file', 'obsidian']])(
    'rejects invalid required destinations %j',
    (...destinations: string[]) => {
      expectCode(operation(destinations), 'invalid-operation');
    }
  );
  it('rejects weaker or exchanged assurance and policy', () => {
    const input = operation();
    input.destinations[0].assurance = OBSIDIAN_ASSURANCE;
    expectCode(input, 'invalid-operation');
    expectCode({ ...operation(), completenessPolicy: 'best-effort' }, 'invalid-operation');
  });
  it.each([
    hash(),
    `liska-conversation-key/1:${hash('A')}`,
    `liska-conversation-key/2:${hash()}`,
    '',
  ])('rejects legacy/malformed key %s', key => {
    const input = operation();
    input.admission.conversationKey = key;
    expectCode(input, 'invalid-operation');
  });
});

describe('detached new-capture evidence relations', () => {
  it.each([['file'], ['obsidian'], ['file', 'obsidian']])(
    'accepts only all required relations for %j',
    (...names: string[]) => {
      expect(assessNewCaptureEvidence(operation(names), evidence(names))).toEqual({
        kind: 'consistent',
        codes: [],
      });
    }
  );
  it('allows destination-specific manifests and artifact bytes, not shared receipts', () => {
    const input = evidence(['file', 'obsidian']);
    input.destinations[1].raw.sha256 = hash('f');
    input.destinations[1].raw.byteLength = 77;
    input.destinations[1].assurance.artifacts[1].commitment = { ...input.destinations[1].raw };
    input.destinations[1].assurance.artifacts[1].readback = { sha256: hash('f'), byteLength: 77 };
    const op = operation(['file', 'obsidian']);
    expect(assessNewCaptureEvidence(op, input).kind).toBe('consistent');
    input.destinations[1].assurance.manifest = input.destinations[0].manifest;
    result(input, 'conflict', 'commitment-conflict', op);
  });
  it('never substitutes one successful destination for the other', () => {
    result(evidence(), 'insufficient', 'destination-missing', operation(['file', 'obsidian']));
    const input = evidence(['file', 'obsidian']);
    remove(input.destinations[1], 'assurance');
    result(input, 'insufficient', 'assurance-missing', operation(['file', 'obsidian']));
  });
  it('uses frozen deterministic codes only, without settlement or authority fields', () => {
    const input = evidence();
    remove(input.destinations[0], 'raw');
    remove(input.destinations[0], 'assurance');
    const assessed = assessNewCaptureEvidence(operation(), input);
    expect(Object.keys(assessed).sort()).toEqual(['codes', 'kind']);
    expect(Object.isFrozen(assessed)).toBe(true);
    expect(Object.isFrozen(assessed.codes)).toBe(true);
    expect(assessed.codes).toEqual([...assessed.codes].sort());
    expect(JSON.stringify(assessed)).not.toMatch(/recorded|confirmed|completed|dispatch|retry/u);
    expect(assessNewCaptureEvidence(operation(), input)).toEqual(assessed);
  });
  it('treats absent evidence as insufficient, never failed', () => {
    result(undefined, 'insufficient', 'evidence-missing');
  });
  it.each(['purpose', 'operationId', 'attemptId', 'captureId'])(
    'binds exact top-level %s',
    field => {
      const input = evidence();
      replace(input.binding, field, 'other');
      result(input, 'conflict', 'identity-conflict');
    }
  );
  it.each(['provider', 'conversationId', 'conversationKey'])('binds exact admission %s', field => {
    const input = evidence();
    replace(
      input.binding.admission,
      field,
      field === 'conversationKey' ? `liska-conversation-key/1:${hash('f')}` : 'other'
    );
    result(input, 'conflict', 'identity-conflict');
  });
  it('binds exact catalog digest', () => {
    const input = evidence();
    input.binding.sourceSelection.catalogSha256 = hash('f');
    result(input, 'conflict', 'identity-conflict');
  });
  it.each(['purpose', 'operationId', 'attemptId', 'captureId'])(
    'independently binds destination assurance %s',
    field => {
      const input = evidence();
      replace(input.destinations[0].assurance.binding, field, 'other');
      result(input, 'conflict', 'identity-conflict');
    }
  );
  it('rejects unknown and duplicated destinations as conflicts', () => {
    const input = evidence();
    input.destinations.push(destination());
    result(input, 'conflict', 'destination-conflict');
    input.destinations[1].destination = 'cloud';
    result(input, 'conflict', 'destination-conflict');
    input.destinations.pop();
    input.destinations[0].assurance.destination = 'obsidian';
    result(input, 'conflict', 'destination-conflict');
  });
  it.each(['manifest', 'raw', 'canonical'])('requires exact %s commitments', field => {
    const input = evidence();
    remove(input.destinations[0], field);
    result(input, 'insufficient', 'artifact-missing');
    remove(input.destinations[0], 'assurance');
    result(input, 'insufficient', 'artifact-missing');
  });
  it.each(['binding', 'manifest', 'artifacts', 'kind', 'destination'])(
    'does not fill missing assurance %s',
    field => {
      const input = evidence();
      remove(input.destinations[0].assurance, field);
      expect(assessNewCaptureEvidence(operation(), input).kind).toBe('insufficient');
    }
  );
  it.each(['graph', 'messages', 'branches', 'assetInventory'])(
    'requires complete %s declaration',
    field => {
      const input = evidence();
      replace(input.destinations[0].completeness, field, 'unknown');
      result(input, 'insufficient', 'completeness-incomplete');
      replace(input.destinations[0].completeness, field, 'partial');
      result(input, 'insufficient', 'completeness-incomplete');
      remove(input.destinations[0].completeness, field);
      result(input, 'insufficient', 'completeness-missing');
    }
  );
  it('requires explicit strict policy and asset inventory', () => {
    const input = evidence();
    replace(input.destinations[0].completeness, 'policy', 'best-effort');
    result(input, 'conflict', 'completeness-policy-conflict');
    remove(input.destinations[0], 'completeness');
    result(input, 'insufficient', 'completeness-missing');
    remove(input.destinations[0], 'assets');
    result(input, 'insufficient', 'asset-inventory-missing');
    remove(input.destinations[0], 'assurance');
    result(input, 'insufficient', 'asset-inventory-missing');
  });
  it('allows explicitly empty complete asset inventory, not absent inventory', () => {
    const input = evidence();
    input.destinations[0].assets = [];
    input.destinations[0].assurance.artifacts.pop();
    expect(assessNewCaptureEvidence(operation(), input).kind).toBe('consistent');
  });
  it('requires every listed asset fetched and delivered with exact bytes', () => {
    const input = evidence();
    input.destinations[0].assets[0].state = 'missing';
    result(input, 'insufficient', 'asset-not-fetched');
    input.destinations[0].assets[0].state = 'fetched';
    input.destinations[0].assurance.artifacts.pop();
    result(input, 'insufficient', 'delivery-missing');
  });
  it('detects duplicate asset identities and paths even if byte-identical', () => {
    const input = evidence();
    input.destinations[0].assets.push({ ...input.destinations[0].assets[0] });
    result(input, 'conflict', 'commitment-conflict');
    input.destinations[0].assets.pop();
    input.destinations[0].canonical = { ...input.destinations[0].raw };
    result(input, 'conflict', 'commitment-conflict');
  });
  it('keeps missing asset commitments insufficient even when delivery observations exist', () => {
    const input = evidence();
    remove(input.destinations[0].assets[0], 'commitment');
    result(input, 'insufficient', 'artifact-missing');
  });
  it('rejects unmatched and duplicate delivery observations for a complete inventory', () => {
    const input = evidence();
    input.destinations[0].assurance.artifacts.push({
      ...input.destinations[0].assurance.artifacts[0],
    });
    result(input, 'conflict', 'commitment-conflict');
    input.destinations[0].assurance.artifacts.pop();
    input.destinations[0].assurance.artifacts[0].commitment.relativePath = 'undeclared.json';
    result(input, 'conflict', 'commitment-conflict');
  });
  it.each(['provider', 'conversationId', 'conversationKey'])(
    'checks destination assurance admission %s independently',
    field => {
      const input = evidence();
      replace(
        input.destinations[0].assurance.binding.admission,
        field,
        field === 'conversationKey' ? `liska-conversation-key/1:${hash('f')}` : 'other'
      );
      result(input, 'conflict', 'identity-conflict');
    }
  );
  it('checks destination assurance catalog independently', () => {
    const input = evidence();
    input.destinations[0].assurance.binding.sourceSelection.catalogSha256 = hash('f');
    result(input, 'conflict', 'identity-conflict');
  });
  it('does not infer missing envelope binding or destinations', () => {
    const input = evidence();
    remove(input, 'binding');
    result(input, 'insufficient', 'binding-missing');
    remove(input, 'destinations');
    result(input, 'insufficient', 'destination-missing');
  });
  it('requires recognized assurance instead of accepting an unknown claimed kind', () => {
    const input = evidence();
    replace(input.destinations[0].assurance, 'kind', 'successful-write');
    result(input, 'conflict', 'assurance-conflict');
  });
  it('does not infer missing Obsidian readback from commitments', () => {
    const input = evidence(['obsidian']);
    remove(input.destinations[0].assurance.artifacts[0], 'readback');
    result(input, 'insufficient', 'delivery-missing', operation(['obsidian']));
  });
  it('requires exact File path basis and complete browser download observation', () => {
    const input = evidence();
    const file = input.destinations[0].assurance.artifacts[0].file!;
    file.state = 'unknown';
    result(input, 'insufficient', 'delivery-unconfirmed');
    file.state = 'complete';
    replace(file, 'basis', 'filename-guessed');
    result(input, 'conflict', 'assurance-conflict');
    file.basis = FILE_PATH_BASIS;
    file.observedRelativePath = 'another/manifest.json';
    result(input, 'conflict', 'commitment-conflict');
    remove(file, 'observedRelativePath');
    result(input, 'insufficient', 'delivery-missing');
  });
  it.each(['byteLength', 'sha256'])('requires exact Obsidian readback %s', field => {
    const input = evidence(['obsidian']);
    const readback = input.destinations[0].assurance.artifacts[0].readback!;
    replace(readback, field, field === 'sha256' ? hash('f') : 99);
    result(input, 'conflict', 'commitment-conflict', operation(['obsidian']));
  });
  it('never exchanges File path confirmation and byte readback', () => {
    const input = evidence();
    input.destinations[0].assurance.kind = OBSIDIAN_ASSURANCE;
    result(input, 'conflict', 'assurance-conflict');
    input.destinations[0].assurance.kind = FILE_ASSURANCE;
    input.destinations[0].assurance.artifacts[0].readback = { byteLength: 42, sha256: hash('d') };
    result(input, 'conflict', 'assurance-conflict');
    const obsidian = evidence(['obsidian']);
    obsidian.destinations[0].assurance.artifacts[0].file =
      input.destinations[0].assurance.artifacts[0].file;
    result(obsidian, 'conflict', 'assurance-conflict', operation(['obsidian']));
  });
  it('reports conflicts before missing facts, rejected shapes before relations', () => {
    const input = evidence();
    input.binding.captureId = 'wrong';
    remove(input.destinations[0], 'assurance');
    const assessed = result(input, 'conflict', 'identity-conflict');
    expect(assessed.codes).toContain('assurance-missing');
    replace(input.destinations[0].raw, 'sha256', 'invalid');
    result(input, 'rejected', 'invalid-evidence');
  });
});

describe('bounded descriptor-safe detached data', () => {
  it('does not invoke getters or toJSON at any depth', () => {
    let calls = 0;
    const input = operation();
    Object.defineProperty(input.admission, 'conversationId', {
      enumerable: true,
      get() {
        calls++;
        return 'x';
      },
    });
    expectCode(input, 'invalid-data');
    const other = operation();
    replace(other, 'toJSON', () => {
      calls++;
      return operation();
    });
    expectCode(other, 'invalid-data');
    const ev = evidence();
    Object.defineProperty(ev.destinations[0].manifest, 'sha256', {
      enumerable: true,
      get() {
        calls++;
        return hash();
      },
    });
    result(ev, 'rejected', 'invalid-data');
    expect(calls).toBe(0);
  });
  it('rejects prototypes, symbols, nonenumerable properties, cycles and sparse/decorated arrays', () => {
    const inherited = Object.assign(Object.create({ inherited: true }), operation());
    expectCode(inherited, 'invalid-data');
    const symbol = operation();
    Object.defineProperty(symbol, Symbol('x'), { value: true });
    expectCode(symbol, 'invalid-data');
    const hidden = operation();
    Object.defineProperty(hidden, 'hidden', { value: true });
    expectCode(hidden, 'invalid-data');
    const cyclic = operation();
    replace(cyclic, 'self', cyclic);
    expectCode(cyclic, 'invalid-data');
    const sparse = operation();
    sparse.destinations.length = 2;
    expectCode(sparse, 'invalid-data');
    const decorated = operation();
    replace(decorated.destinations, 'extra', 1);
    expectCode(decorated, 'invalid-data');
    const subarray = operation();
    Object.setPrototypeOf(subarray.destinations, Object.create(Array.prototype));
    expectCode(subarray, 'invalid-data');
  });
  it('accepts null prototypes and freezes detached copies, not inputs', () => {
    const input = Object.assign(Object.create(null), operation());
    expect(admitNewCaptureOperation(input).operationId).toBe('op-1');
    expect(Object.isFrozen(input)).toBe(false);
  });
  it.each([null, false, 1, 'string', [], { schema: EVIDENCE_SCHEMA, extra: true }])(
    'rejects malformed evidence %j',
    value => {
      result(value, 'rejected', 'invalid-evidence');
    }
  );
  it.each(['../escape', '/absolute', 'C:/drive', 'a\\b', 'a//b', 'a/./b', 'a/../b', 'a/b.'])(
    'rejects unsafe relative path %s',
    path => {
      const input = evidence();
      input.destinations[0].raw.relativePath = path;
      result(input, 'rejected', 'invalid-evidence');
    }
  );
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed artifact length %s',
    bytes => {
      const input = evidence();
      input.destinations[0].raw.byteLength = bytes;
      expect(assessNewCaptureEvidence(operation(), input).kind).toBe('rejected');
    }
  );
  it.each(Object.keys(PURPOSE_HARD_LIMITS))('limits %s can only be lowered', name => {
    const key = name as keyof typeof PURPOSE_HARD_LIMITS;
    expectCode(operation(), 'invalid-limits', { [key]: PURPOSE_HARD_LIMITS[key] + 1 });
    expectCode(operation(), 'invalid-limits', { [key]: 0 });
  });
  it.each([
    { maxNodes: 2 },
    { maxDepth: 1 },
    { maxStringCodeUnits: 5 },
    { maxTotalStringCodeUnits: 10 },
    { maxIdentifierCodeUnits: 3 },
  ])('enforces operation budget %j', limits => {
    expectCode(operation(), 'limit-exceeded', limits);
  });
  it('enforces array, artifact and asset limits', () => {
    expectCode(operation(['file', 'obsidian']), 'limit-exceeded', { maxArrayItems: 1 });
    expect(assessNewCaptureEvidence(operation(), evidence(), { maxArtifactBytes: 1 })).toEqual({
      kind: 'rejected',
      codes: ['limit-exceeded'],
    });
    const input = evidence();
    input.destinations[0].assets.push({ ...input.destinations[0].assets[0], assetId: 'asset-2' });
    expect(assessNewCaptureEvidence(operation(), input, { maxAssetsPerDestination: 1 })).toEqual({
      kind: 'rejected',
      codes: ['limit-exceeded'],
    });
  });
  it('normalizes trap/native failures to fixed codes without leaking prose', () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private native detail');
        },
      }
    );
    result(proxy, 'rejected', 'invalid-data');
    expectCode(proxy, 'invalid-data');
    expectCode(operation(), 'invalid-limits', proxy);
  });
  it('does not expose forged contract exception codes or invoke their getters', () => {
    let calls = 0;
    const error = new PurposeContractError('invalid-data');
    Object.defineProperty(error, 'code', {
      get() {
        calls++;
        return 'private detail';
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw error;
        },
      }
    );
    result(proxy, 'rejected', 'invalid-data');
    expect(calls).toBe(0);
    const forged = new PurposeContractError('invalid-data');
    replace(forged, 'code', 'private detail');
    result(
      new Proxy(
        {},
        {
          ownKeys() {
            throw forged;
          },
        }
      ),
      'rejected',
      'invalid-data'
    );
  });
  it('rejects accessor and unknown limit options without calling accessors', () => {
    let calls = 0;
    const limits = Object.defineProperty({}, 'maxNodes', {
      enumerable: true,
      get() {
        calls++;
        return 1;
      },
    });
    expectCode(operation(), 'invalid-limits', limits);
    expectCode(operation(), 'invalid-limits', { unknown: 1 });
    expect(calls).toBe(0);
  });
});
