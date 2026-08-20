import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  LISKA_CAPTURE_SCHEMA,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type BuildCaptureManifestInput,
  type RawCaptureAssetRecord,
  type RawCaptureBundle,
} from '../../src/archive/capture';

const SHA256 = 'a'.repeat(64);
const ASSET_SOURCE_REFS = [
  { artifactId: 'conversation', rawPointer: '/mapping/node/message/content' },
];

function unattemptedAsset(): RawCaptureAssetRecord {
  return {
    id: 'asset-1',
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: null,
    byteLength: null,
    sha256: null,
    detail: null,
    sourceRefs: ASSET_SOURCE_REFS,
  };
}

function input(): BuildCaptureManifestInput {
  return {
    captureId: 'capture-chatgpt-001',
    provider: 'chatgpt',
    conversationId: 'conversation-001',
    capturedAt: '2026-08-17T00:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: 4,
        sha256: SHA256,
        endpoint: {
          method: 'POST',
          pathPattern: '/backend-api/f/conversation',
        },
      },
    ],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'not-attempted',
    },
    warnings: ['Assets were deliberately not fetched.'],
    observedUnknownContentTypes: ['zeta', 'alpha', 'zeta'],
  };
}

describe('raw capture manifest', () => {
  it('builds deterministic credential-free metadata without embedding bytes', () => {
    const manifest = buildCaptureManifest(input());

    expect(manifest).toEqual({
      schema: LISKA_CAPTURE_SCHEMA,
      captureId: 'capture-chatgpt-001',
      provider: 'chatgpt',
      conversationId: 'conversation-001',
      capturedAt: '2026-08-17T00:00:00.000Z',
      method: 'same-origin-api',
      artifacts: input().artifacts,
      assets: [],
      completeness: input().completeness,
      warnings: ['Assets were deliberately not fetched.'],
      observedUnknownContentTypes: ['alpha', 'zeta'],
    });
    expect(JSON.stringify(manifest)).not.toMatch(/authorization|cookie|bytes/i);
  });

  it('strips unexpected runtime fields instead of persisting request secrets', () => {
    const malicious = input() as BuildCaptureManifestInput & {
      headers: { Authorization: string };
    };
    malicious.headers = { Authorization: 'Bearer secret' };
    Object.assign(malicious.artifacts[0], {
      headers: { Cookie: 'session=secret' },
    });

    const serialized = JSON.stringify(buildCaptureManifest(malicious));

    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('headers');
  });

  it.each([
    [
      'full endpoint URL',
      (value: BuildCaptureManifestInput) =>
        (value.artifacts[0].endpoint.pathPattern = 'https://chatgpt.com/x'),
    ],
    [
      'endpoint query',
      (value: BuildCaptureManifestInput) =>
        (value.artifacts[0].endpoint.pathPattern = '/x?token=nope'),
    ],
    [
      'credential-bearing endpoint path',
      (value: BuildCaptureManifestInput) =>
        (value.artifacts[0].endpoint.pathPattern = '/x;session_token=secret'),
    ],
    [
      'scheme-relative endpoint path',
      (value: BuildCaptureManifestInput) =>
        (value.artifacts[0].endpoint.pathPattern = '//attacker.example/x'),
    ],
    [
      'backslash endpoint path',
      (value: BuildCaptureManifestInput) =>
        (value.artifacts[0].endpoint.pathPattern = '/safe\\attacker'),
    ],
    [
      'path traversal',
      (value: BuildCaptureManifestInput) =>
        (value.artifacts[0].relativePath = '../conversation.json'),
    ],
    [
      'uppercase digest',
      (value: BuildCaptureManifestInput) => (value.artifacts[0].sha256 = 'A'.repeat(64)),
    ],
    ['invalid timestamp', (value: BuildCaptureManifestInput) => (value.capturedAt = 'not-a-date')],
    [
      'normalized invalid calendar date',
      (value: BuildCaptureManifestInput) => (value.capturedAt = '2026-02-30T00:00:00.000Z'),
    ],
    [
      'credential warning',
      (value: BuildCaptureManifestInput) => (value.warnings = ['Authorization: Bearer secret']),
    ],
  ] as const)('rejects %s', (_label, mutate) => {
    const value = input();
    mutate(value);
    expect(() => buildCaptureManifest(value)).toThrow();
  });

  it.each([
    ['invalid artifact ID', (value: BuildCaptureManifestInput) => (value.artifacts[0].id = '')],
    [
      'invalid endpoint method',
      (value: BuildCaptureManifestInput) =>
        (value.artifacts[0].endpoint.method = 'DELETE' as 'GET'),
    ],
    [
      'empty artifact media type',
      (value: BuildCaptureManifestInput) => (value.artifacts[0].mediaType = ''),
    ],
    [
      'negative artifact byte length',
      (value: BuildCaptureManifestInput) => (value.artifacts[0].byteLength = -1),
    ],
    [
      'invalid capture method',
      (value: BuildCaptureManifestInput) =>
        (value.method = 'automatic' as BuildCaptureManifestInput['method']),
    ],
  ] as const)('rejects the %s boundary', (_label, mutate) => {
    const value = input();
    mutate(value);
    expect(() => buildCaptureManifest(value)).toThrow();
  });

  it('rejects duplicate artifact paths', () => {
    const value = input();
    value.artifacts.push({ ...value.artifacts[0], id: 'duplicate' });
    expect(() => buildCaptureManifest(value)).toThrow(/paths must be unique/);
  });

  it('rejects asset paths that collide with raw response artifacts', () => {
    const value = input();
    value.assets = [
      {
        id: 'asset-1',
        state: 'fetched',
        attemptedAt: '2026-08-17T00:00:01.000Z',
        relativePath: 'responses/conversation.json',
        mediaType: 'image/png',
        byteLength: 1,
        sha256: 'b'.repeat(64),
        detail: null,
        sourceRefs: ASSET_SOURCE_REFS,
      },
    ];

    expect(() => buildCaptureManifest(value)).toThrow(/bundle paths must be unique/);
  });

  it('requires fetched assets to carry verifiable local provenance', () => {
    const value = input();
    value.assets = [
      {
        id: 'asset-1',
        state: 'fetched',
        attemptedAt: '2026-08-17T00:00:01.000Z',
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: null,
        sourceRefs: ASSET_SOURCE_REFS,
      },
    ];

    expect(() => buildCaptureManifest(value)).toThrow(/Fetched capture assets require/);
  });

  it('rejects invalid unfetched asset claims and malformed source references', () => {
    const value = input();
    value.assets = [{ ...unattemptedAsset(), state: 'invented' as 'not-attempted' }];
    expect(() => buildCaptureManifest(value)).toThrow(/state is invalid/);

    value.assets = [{ ...unattemptedAsset(), byteLength: -1 }];
    expect(() => buildCaptureManifest(value)).toThrow(/byteLength/);

    value.assets = [{ ...unattemptedAsset(), sha256: 'not-a-hash' }];
    expect(() => buildCaptureManifest(value)).toThrow(/sha256/);

    value.assets = [{ ...unattemptedAsset(), relativePath: 'assets/unfetched.bin' }];
    expect(() => buildCaptureManifest(value)).toThrow(/Unfetched capture assets/);

    value.assets = [
      { ...unattemptedAsset(), state: 'unavailable', attemptedAt: 1 as unknown as string },
    ];
    expect(() => buildCaptureManifest(value)).toThrow(/attemptedAt/);

    value.assets = [
      {
        ...unattemptedAsset(),
        sourceRefs: [null as unknown as RawCaptureAssetRecord['sourceRefs'][number]],
      },
    ];
    expect(() => buildCaptureManifest(value)).toThrow(/plain objects/);
  });

  it.each(['not-attempted', 'unavailable', 'declined', 'expired', 'failed'] as const)(
    'retains the explicit %s state without claiming local bytes',
    state => {
      const value = input();
      value.assets = [
        {
          id: 'asset-1',
          state,
          attemptedAt:
            state === 'expired' || state === 'failed' ? '2026-08-17T00:00:01.000Z' : null,
          relativePath: null,
          mediaType: 'application/octet-stream',
          byteLength: null,
          sha256: null,
          detail: state,
          sourceRefs: ASSET_SOURCE_REFS,
        },
      ];

      expect(buildCaptureManifest(value).assets[0]).toMatchObject({
        state,
        relativePath: null,
        byteLength: null,
        sha256: null,
      });
    }
  );

  it.each(['fetched', 'expired', 'failed'] as const)(
    'requires attemptedAt for %s asset evidence',
    state => {
      const value = input();
      value.assets = [
        {
          id: 'asset-1',
          state,
          attemptedAt: null,
          relativePath: state === 'fetched' ? 'assets/asset-1.bin' : null,
          mediaType: 'application/octet-stream',
          byteLength: state === 'fetched' ? 1 : null,
          sha256: state === 'fetched' ? 'b'.repeat(64) : null,
          detail: null,
          sourceRefs: ASSET_SOURCE_REFS,
        },
      ];
      expect(() => buildCaptureManifest(value)).toThrow(/require attemptedAt/);
    }
  );

  it.each(['not-attempted', 'declined'] as const)(
    'rejects attemptedAt claims for %s assets',
    state => {
      const value = input();
      value.assets = [
        {
          id: 'asset-1',
          state,
          attemptedAt: '2026-08-17T00:00:01.000Z',
          relativePath: null,
          mediaType: null,
          byteLength: null,
          sha256: null,
          detail: null,
          sourceRefs: ASSET_SOURCE_REFS,
        },
      ];
      expect(() => buildCaptureManifest(value)).toThrow(/must not claim attemptedAt/);
    }
  );

  it('requires canonical, unique exact raw source references for every asset', () => {
    const value = input();
    value.assets = [
      {
        id: 'asset-2',
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: null,
        sourceRefs: [
          { artifactId: 'conversation', rawPointer: '/z' },
          { artifactId: 'conversation', rawPointer: '/a' },
        ],
      },
      {
        id: 'asset-1',
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: null,
        sourceRefs: [{ artifactId: 'conversation', rawPointer: '/b' }],
      },
    ];

    const manifest = buildCaptureManifest(value);
    expect(manifest.assets.map(asset => asset.id)).toEqual(['asset-1', 'asset-2']);
    expect(manifest.assets[1]?.sourceRefs.map(sourceRef => sourceRef.rawPointer)).toEqual([
      '/a',
      '/z',
    ]);

    value.assets[0].sourceRefs = [];
    expect(() => buildCaptureManifest(value)).toThrow(/require at least one exact raw source/);
    value.assets[0].sourceRefs = [{ artifactId: 'unknown', rawPointer: '/a' }];
    expect(() => buildCaptureManifest(value)).toThrow(/name a capture artifact/);
    value.assets[0].sourceRefs = [{ artifactId: 'conversation', rawPointer: 'not-a-pointer' }];
    expect(() => buildCaptureManifest(value)).toThrow(/exact non-empty JSON Pointer/);
    value.assets[0].sourceRefs = [{ artifactId: 'conversation', rawPointer: '/b' }];
    expect(() => buildCaptureManifest(value)).toThrow(/raw source references must be unique/);
  });

  it('verifies runtime payload byte lengths against the manifest', () => {
    const manifest = buildCaptureManifest(input());
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes: new Uint8Array([1, 2, 3, 4]) }],
      assets: [],
    };

    expect(() => validateCaptureBundleShape(bundle)).not.toThrow();
    expect(() => validateCaptureBundleShape({ manifest, artifacts: [], assets: [] })).toThrow(
      /do not match the manifest/
    );
    bundle.artifacts[0].bytes = new Uint8Array([1]);
    expect(() => validateCaptureBundleShape(bundle)).toThrow(/wrong byte length/);
  });

  it('rejects a runtime artifact record that differs from its manifest record', () => {
    const manifest = buildCaptureManifest(input());
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [
        {
          record: { ...manifest.artifacts[0], relativePath: 'responses/other.json' },
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      ],
      assets: [],
    };

    expect(() => validateCaptureBundleShape(bundle)).toThrow(/not the manifest record/);
  });

  it('detects same-length raw byte replacement with SHA-256 verification', async () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const value = input();
    value.artifacts[0].sha256 = createHash('sha256').update(original).digest('hex');
    const manifest = buildCaptureManifest(value);
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes: new Uint8Array([4, 3, 2, 1]) }],
      assets: [],
    };
    const sha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

    await expect(verifyCaptureBundleIntegrity(bundle, sha256)).rejects.toThrow(
      /failed SHA-256 verification/
    );
    bundle.artifacts[0].bytes = original;
    await expect(verifyCaptureBundleIntegrity(bundle, sha256)).resolves.toBeUndefined();
  });

  it('requires exact runtime bytes for every fetched asset and verifies their SHA-256', async () => {
    const artifactBytes = new Uint8Array([1, 2, 3, 4]);
    const assetBytes = new Uint8Array([9, 8, 7]);
    const value = input();
    value.artifacts[0].sha256 = createHash('sha256').update(artifactBytes).digest('hex');
    value.assets = [
      {
        ...unattemptedAsset(),
        state: 'fetched',
        attemptedAt: '2026-08-17T00:00:01.000Z',
        relativePath: 'assets/asset-1.bin',
        mediaType: 'application/octet-stream',
        byteLength: assetBytes.byteLength,
        sha256: createHash('sha256').update(assetBytes).digest('hex'),
      },
    ];
    const manifest = buildCaptureManifest(value);
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes: artifactBytes }],
      assets: [{ record: manifest.assets[0], bytes: assetBytes }],
    };
    const sha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

    expect(() => validateCaptureBundleShape(bundle)).not.toThrow();
    expect(() => validateCaptureBundleShape({ ...bundle, assets: [] })).toThrow(
      /do not match the fetched manifest assets/
    );
    expect(() =>
      validateCaptureBundleShape({
        ...bundle,
        assets: [{ record: manifest.assets[0], bytes: new Uint8Array([9]) }],
      })
    ).toThrow(/wrong byte length/);
    await expect(verifyCaptureBundleIntegrity(bundle, sha256)).resolves.toBeUndefined();

    bundle.assets[0].bytes = new Uint8Array([7, 8, 9]);
    await expect(verifyCaptureBundleIntegrity(bundle, sha256)).rejects.toThrow(
      /asset asset-1 failed SHA-256 verification/
    );
  });
});
