import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  LISKA_CAPTURE_SCHEMA,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type BuildCaptureManifestInput,
  type RawCaptureBundle,
} from '../../src/archive/capture';

const SHA256 = 'a'.repeat(64);

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
        relativePath: 'responses/conversation.json',
        mediaType: 'image/png',
        byteLength: 1,
        sha256: 'b'.repeat(64),
        detail: null,
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
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: null,
      },
    ];

    expect(() => buildCaptureManifest(value)).toThrow(/Fetched capture assets require/);
  });

  it('verifies runtime payload byte lengths against the manifest', () => {
    const manifest = buildCaptureManifest(input());
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes: new Uint8Array([1, 2, 3, 4]) }],
    };

    expect(() => validateCaptureBundleShape(bundle)).not.toThrow();
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
    };
    const sha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

    await expect(verifyCaptureBundleIntegrity(bundle, sha256)).rejects.toThrow(
      /failed SHA-256 verification/
    );
    bundle.artifacts[0].bytes = original;
    await expect(verifyCaptureBundleIntegrity(bundle, sha256)).resolves.toBeUndefined();
  });
});
