import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  type RawCaptureBundle,
  type RawCaptureManifest,
} from '../../src/archive/capture';
import { validateLiskaThreadArchive } from '../../src/archive/validate';
import {
  ChatGptNormalizationError,
  normalizeChatGptCapture,
} from '../../src/archive/normalizers/chatgpt';

const encoder = new TextEncoder();
const fetchedAssetBytes = encoder.encode('synthetic-12');
const fetchedAssetSha256 = createHash('sha256').update(fetchedAssetBytes).digest('hex');
const fixtureBytes = new Uint8Array(
  readFileSync('test/fixtures/archive/chatgpt-raw/branching-mixed-content.json')
);
const fixtureRaw = JSON.parse(new TextDecoder().decode(fixtureBytes)) as MutableRaw;

interface MutableMessage {
  create_time: unknown;
  content: { parts: unknown[]; [key: string]: unknown };
  metadata: Record<string, unknown>;
  author: { role: string; name: string | null };
  [key: string]: unknown;
}

interface MutableNode {
  id: string;
  parent: string | null;
  children: string[];
  message: MutableMessage | null;
}

interface MutableRaw extends Record<string, unknown> {
  current_node: string;
  mapping: Record<string, MutableNode>;
  conversation?: unknown;
}

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function captureManifest(
  bytes: Uint8Array,
  options: {
    mediaType?: string;
    assets?: RawCaptureManifest['assets'];
    completeness?: RawCaptureManifest['completeness'];
  } = {}
): RawCaptureManifest {
  return buildCaptureManifest({
    captureId: 'capture-chatgpt-normalizer-001',
    provider: 'chatgpt',
    conversationId: 'synthetic-chatgpt-branch',
    capturedAt: '2026-08-17T12:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: options.mediaType ?? 'application/json',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
      },
    ],
    assets: options.assets ?? [
      {
        id: 'synthetic-image-1',
        state: 'unavailable',
        attemptedAt: null,
        relativePath: null,
        mediaType: 'image/png',
        byteLength: null,
        sha256: null,
        detail: 'Images deliberately not fetched in this synthetic fixture.',
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/mapping/node~1current/message/content/parts/8',
          },
        ],
      },
      {
        id: 'synthetic-file-2',
        state: 'fetched',
        attemptedAt: '2026-08-17T12:00:01.000Z',
        relativePath: 'assets/synthetic-notes.txt',
        mediaType: 'text/plain',
        byteLength: fetchedAssetBytes.byteLength,
        sha256: fetchedAssetSha256,
        detail: null,
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/mapping/node~1current/message/metadata/attachments/0',
          },
        ],
      },
    ],
    completeness: options.completeness ?? {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'partial',
    },
  });
}

function rawClone(): MutableRaw {
  return JSON.parse(JSON.stringify(fixtureRaw)) as MutableRaw;
}

function bytesFor(raw: MutableRaw): Uint8Array {
  return encoder.encode(JSON.stringify(raw, null, 2));
}

function bundleFor(bytes: Uint8Array, manifest = captureManifest(bytes)): RawCaptureBundle {
  return {
    manifest,
    artifacts: [{ record: manifest.artifacts[0], bytes }],
    assets: manifest.assets
      .filter(asset => asset.state === 'fetched')
      .map(asset => ({ record: asset, bytes: fetchedAssetBytes })),
  };
}

async function normalize(
  raw?: MutableRaw,
  options: {
    manifest?: RawCaptureManifest;
    bytes?: Uint8Array;
    manifestSha256?: string;
    artifactId?: string;
  } = {}
) {
  const bytes = options.bytes ?? (raw ? bytesFor(raw) : fixtureBytes);
  const manifest = options.manifest ?? captureManifest(bytes);
  return normalizeChatGptCapture({
    bundle: bundleFor(bytes, manifest),
    artifactId: options.artifactId ?? 'conversation',
    manifestSha256:
      options.manifestSha256 ?? (await sha256(encoder.encode(JSON.stringify(manifest, null, 2)))),
    sha256,
  });
}

async function errorCode(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ChatGptNormalizationError);
    return (error as ChatGptNormalizationError).code;
  }
  throw new Error('Expected normalisation to fail.');
}

describe('ChatGPT raw-byte normalizer', () => {
  it('uses the checked-in fixture bytes, verifies hashes, and produces a valid full graph', async () => {
    const { archive } = await normalize();

    expect(validateLiskaThreadArchive(archive)).toEqual({ valid: true, issues: [] });
    expect(archive.conversation.currentNodeId).toBe('node/current');
    expect(archive.graph.rootIds).toEqual(['node/root~structural']);
    expect(Object.keys(archive.graph.nodes)).toEqual([
      'node/root~structural',
      'node/user',
      'node/current',
      'node/alternate',
    ]);
    expect(archive.graph.nodes['node/root~structural'].message).toBeUndefined();
    expect(archive.graph.nodes['node/user'].childIds).toEqual(['node/current', 'node/alternate']);
    expect(archive.inputs[0].manifestSha256).toHaveLength(64);
    expect(archive.graph.nodes['node/current'].message?.sourceRefs[0].rawPointer).toBe(
      '/mapping/node~1current/message'
    );
  });

  it('validates a deeply linear graph without consuming the JavaScript call stack', async () => {
    const nodeCount = 6_000;
    const mapping: Record<string, MutableNode> = {};
    for (let index = 0; index < nodeCount; index += 1) {
      const id = `deep-node-${index}`;
      mapping[id] = {
        id,
        parent: index === 0 ? null : `deep-node-${index - 1}`,
        children: index + 1 === nodeCount ? [] : [`deep-node-${index + 1}`],
        message: null,
      };
    }
    const raw = {
      conversation_id: 'synthetic-chatgpt-branch',
      current_node: `deep-node-${nodeCount - 1}`,
      mapping,
    } as MutableRaw;

    const { archive } = await normalize(raw);

    expect(Object.keys(archive.graph.nodes)).toHaveLength(nodeCount);
    expect(archive.graph.rootIds).toEqual(['deep-node-0']);
    expect(archive.conversation.currentNodeId).toBe(`deep-node-${nodeCount - 1}`);
  });

  it('keeps known payloads exactly once and retains only top-level envelope residual metadata', async () => {
    const { archive, observedUnknownContentTypes } = await normalize();
    const message = archive.graph.nodes['node/current'].message!;
    const blocks = message.blocks;
    const serialized = JSON.stringify(archive);

    expect(blocks.map(block => block.type)).toEqual([
      'text',
      'text',
      'code',
      'reasoning',
      'tool_call',
      'tool_result',
      'execution_output',
      'citation',
      'attachment',
      'canvas_event',
      'error',
      'unknown',
      'attachment',
      'citation',
    ]);
    expect(message.extensions).toMatchObject({
      openai: { contentMetadata: { response_format_name: 'synthetic-response-format' } },
    });
    expect(JSON.stringify(message.extensions)).not.toMatch(
      /canvas_event|future_rich_part|synthetic_error|synthetic-image-1/
    );
    expect(serialized.split('First text part.')).toHaveLength(2);
    expect(serialized.split('synthetic-update')).toHaveLength(2);
    expect(
      blocks.find(block => block.type === 'unknown' && block.providerType === 'future_rich_part')
    ).toBeDefined();
    expect(observedUnknownContentTypes).toEqual(['future_rich_part']);
  });

  it('keeps large unknown, canvas, error, and nested asset residual payloads in one canonical place', async () => {
    const raw = rawClone();
    const marker = `large-residual-${'x'.repeat(4_096)}`;
    const parts = raw.mapping['node/current'].message!.content.parts;
    (parts[2] as Record<string, unknown>).nested = { marker };
    (parts[9] as Record<string, unknown>).payload = { marker };
    (parts[10] as Record<string, unknown>).error = { code: 'synthetic_error', marker };
    (parts[11] as Record<string, unknown>).payload = { marker };
    (parts[8] as Record<string, unknown>).nested = { marker };

    const { archive } = await normalize(raw);
    const serialized = JSON.stringify(archive);
    const asset = Object.values(archive.assets).find(
      asset => asset.filename === 'synthetic-image.png'
    );
    const error = archive.graph.nodes['node/current'].message?.blocks.find(
      block => block.type === 'error'
    );
    const code = archive.graph.nodes['node/current'].message?.blocks.find(
      block => block.type === 'code'
    );

    expect(serialized.split(marker)).toHaveLength(6);
    expect(code?.extensions).toMatchObject({
      openai: { contentContainer: { nested: { marker } } },
    });
    expect(asset?.extensions).toMatchObject({ openai: { nested: { marker } } });
    expect(error?.extensions).toMatchObject({ openai: { error: { marker } } });
  });

  it('scrubs sensitive extension fields and URI values with diagnostics instead of preserving request IDs', async () => {
    const raw = rawClone();
    const message = raw.mapping['node/current'].message!;
    message.metadata.request_id = 'request-secret';
    message.metadata.requestId = 'camel-request-secret';
    message.metadata.account_id = 'account-secret';
    message.extra = {
      access_token: 'token-secret',
      provider_uri: 'blob:https://chatgpt.com/opaque-secret',
      nested: {
        user_id: 'user-secret',
        organizationId: 'organization-secret',
        workspace_id: 'workspace-secret',
        tenant_uuid: 'tenant-secret',
      },
    };
    message.content.parts[0] =
      'https://cdn.example.invalid/file?X-Goog-Signature=goog-secret&access_token=token-secret&api_key=api-secret&auth=auth-secret&authorization=authorization-secret&jwt=jwt-secret&credential=credential-secret';

    const { archive } = await normalize(raw);
    const serialized = JSON.stringify(archive);

    expect(serialized).not.toMatch(
      /request-secret|camel-request-secret|account-secret|token-secret|opaque-secret|user-secret|organization-secret|workspace-secret|tenant-secret|api-secret|auth-secret|authorization-secret|jwt-secret|credential-secret/
    );
    expect(serialized).toContain('[redacted-sensitive-url]');
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'privacy-redacted-sensitive-extension-field' }),
        expect.objectContaining({ code: 'privacy-redacted-sensitive-value' }),
        expect.objectContaining({ code: 'privacy-redacted-sensitive-url' }),
      ])
    );
  });

  it('does not retain signed asset transport fields and emits a privacy diagnostic', async () => {
    const { archive } = await normalize();
    const serialized = JSON.stringify(archive);

    expect(serialized).not.toMatch(/not-retained|inline_data|signature|asset_pointer|base64/i);
    expect(archive.diagnostics.entries).toContainEqual(
      expect.objectContaining({ code: 'privacy-redacted-sensitive-asset-transport' })
    );
  });

  it('uses the actual citation alias key in the privacy source pointer', async () => {
    const raw = rawClone();
    raw.mapping['node/current'].message!.metadata.citations = [
      { label: 'Alias', link: 'https://cdn.example.invalid/x?X-Goog-Signature=secret' },
    ];

    const { archive } = await normalize(raw);
    const diagnostic = archive.diagnostics.entries.find(
      entry => entry.code === 'privacy-redacted-signed-citation-url'
    );
    expect(diagnostic?.sourceRefs[0].rawPointer).toBe(
      '/mapping/node~1current/message/metadata/citations/0/link'
    );
  });

  it('uses an actual message model over a different default and keeps the default separately', async () => {
    const raw = rawClone();
    const metadata = raw.mapping['node/current'].message!.metadata;
    metadata.model_slug = 'actual-message-model';
    metadata.default_model_slug = 'conversation-default-model';

    const { archive } = await normalize(raw);
    const message = archive.graph.nodes['node/current'].message;

    expect(message?.model).toBe('actual-message-model');
    expect(message?.extensions).toMatchObject({
      openai: { metadata: { default_model_slug: 'conversation-default-model' } },
    });
  });

  it('retains direct singular tool payloads and residuals once without contentMetadata copies', async () => {
    const raw = rawClone();
    const callMarker = `direct-call-${'c'.repeat(4_096)}`;
    const resultMarker = `direct-result-${'r'.repeat(4_096)}`;
    const fallbackMarker = `direct-fallback-${'f'.repeat(4_096)}`;
    const nullResidualMarker = `direct-null-${'n'.repeat(4_096)}`;
    const parts = raw.mapping['node/current'].message!.content.parts;
    parts.push(
      {
        content_type: 'tool_call',
        name: 'direct.call',
        arguments: { marker: callMarker },
        residual: 'direct-call-residual',
      },
      {
        content_type: 'tool_result',
        name: 'direct.call',
        result: { marker: resultMarker },
        residual: 'direct-result-residual',
      },
      {
        content_type: 'tool_result',
        name: 'direct.fallback',
        value: { marker: fallbackMarker },
      },
      {
        content_type: 'tool_result',
        name: 'direct.null',
        result: null,
        residual: { marker: nullResidualMarker },
      }
    );

    const { archive } = await normalize(raw);
    const message = archive.graph.nodes['node/current'].message!;
    const serialized = JSON.stringify(archive);
    const directCall = message.blocks.find(
      block => block.type === 'tool_call' && block.toolName === 'direct.call'
    );
    const directResult = message.blocks.find(
      block => block.type === 'tool_result' && block.toolName === 'direct.call'
    );
    const fallbackResult = message.blocks.find(
      block => block.type === 'tool_result' && block.toolName === 'direct.fallback'
    );
    const nullResult = message.blocks.find(
      block => block.type === 'tool_result' && block.toolName === 'direct.null'
    );

    expect(serialized.split(callMarker)).toHaveLength(2);
    expect(serialized.split(resultMarker)).toHaveLength(2);
    expect(serialized.split(fallbackMarker)).toHaveLength(2);
    expect(serialized.split(nullResidualMarker)).toHaveLength(2);
    expect(directCall).toMatchObject({
      arguments: { marker: callMarker },
      extensions: { openai: { residual: 'direct-call-residual' } },
    });
    expect(directResult).toMatchObject({
      result: { marker: resultMarker },
      extensions: { openai: { residual: 'direct-result-residual' } },
    });
    expect(fallbackResult).toMatchObject({
      result: {
        content_type: 'tool_result',
        name: 'direct.fallback',
        value: { marker: fallbackMarker },
      },
      extensions: { openai: {} },
    });
    expect(nullResult).toMatchObject({
      result: null,
      extensions: { openai: { residual: { marker: nullResidualMarker } } },
    });
    expect(JSON.stringify(message.extensions)).not.toMatch(
      /direct\.call|direct-call-residual|direct-result-residual/
    );
  });

  it('retains author residual metadata once for system and tool messages', async () => {
    const raw = rawClone();
    Object.assign(raw.mapping['node/user'].message!.author as Record<string, unknown>, {
      role: 'system',
      system_label: 'Synthetic system author',
      tenant_id: 'tenant-secret',
    });
    Object.assign(raw.mapping['node/alternate'].message!.author as Record<string, unknown>, {
      role: 'tool',
      tool_name: 'synthetic.tool',
    });

    const { archive } = await normalize(raw);
    const serialized = JSON.stringify(archive);
    const system = archive.graph.nodes['node/user'].message;
    const tool = archive.graph.nodes['node/alternate'].message;

    expect(system).toMatchObject({
      author: { role: 'system' },
      extensions: { openai: { author: { system_label: 'Synthetic system author' } } },
    });
    expect(tool).toMatchObject({
      author: { role: 'tool' },
      extensions: { openai: { author: { tool_name: 'synthetic.tool' } } },
    });
    expect(serialized.split('Synthetic system author')).toHaveLength(2);
    expect(serialized.split('synthetic.tool')).toHaveLength(2);
    expect(serialized).not.toContain('tenant-secret');
    expect(archive.diagnostics.entries).toContainEqual(
      expect.objectContaining({ code: 'privacy-redacted-sensitive-extension-field' })
    );
  });

  it('makes manifest evidence authoritative, merges compatible repeats, and represents manifest-only assets', async () => {
    const raw = rawClone();
    const message = raw.mapping['node/current'].message!;
    message.metadata.attachments = [
      ...(message.metadata.attachments as unknown[]),
      { file_id: 'synthetic-file-2', filename: 'synthetic-notes.txt', size_bytes: 12 },
    ];
    const bytes = bytesFor(raw);
    const assets = [
      ...captureManifest(bytes).assets.map(asset =>
        asset.id === 'synthetic-file-2'
          ? { ...asset, relativePath: 'assets/content/3e7b9b4c8d6f.blob' }
          : asset
      ),
      {
        id: 'manifest-only-asset',
        state: 'declined' as const,
        attemptedAt: null,
        relativePath: null,
        mediaType: 'application/pdf',
        byteLength: null,
        sha256: null,
        detail: 'Not fetched by policy.',
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/mapping/node~1current/message/content/parts/0',
          },
        ],
      },
    ];
    const manifest = captureManifest(bytes, { assets });
    const { archive } = await normalize(raw, { bytes, manifest });

    const notes = Object.values(archive.assets).find(
      asset => asset.filename === 'synthetic-notes.txt'
    );
    const manifestOnly = Object.values(archive.assets).find(
      asset => asset.acquisition.detail === 'Not fetched by policy.'
    );
    expect(notes?.sourceRefs).toHaveLength(2);
    expect(notes).toMatchObject({
      filename: 'synthetic-notes.txt',
      localArtifactRef: 'assets/content/3e7b9b4c8d6f.blob',
    });
    expect(manifestOnly).toMatchObject({
      mimeType: 'application/pdf',
      acquisition: { state: 'declined' },
      extensions: { openai: { manifestOnly: true } },
    });
    expect(manifestOnly?.sourceRefs[0]).toMatchObject({
      kind: 'attachment',
      id: null,
      artifactId: 'conversation',
      rawPointer: '/mapping/node~1current/message/content/parts/0',
    });
  });

  it('preserves a manifest-only asset source reference to another verified raw artifact', async () => {
    const raw = rawClone();
    const bytes = bytesFor(raw);
    const secondaryBytes = encoder.encode('{"asset":true}');
    const base = captureManifest(bytes, { assets: [] });
    const secondary = {
      id: 'asset-index',
      relativePath: 'responses/assets.json',
      mediaType: 'application/json',
      byteLength: secondaryBytes.byteLength,
      sha256: createHash('sha256').update(secondaryBytes).digest('hex'),
      endpoint: { method: 'GET' as const, pathPattern: '/backend-api/assets/{conversationId}' },
    };
    const manifest = buildCaptureManifest({
      captureId: base.captureId,
      provider: base.provider,
      conversationId: base.conversationId,
      capturedAt: base.capturedAt,
      method: base.method,
      artifacts: [base.artifacts[0], secondary],
      assets: [
        {
          id: 'cross-artifact-asset',
          state: 'not-attempted',
          attemptedAt: null,
          relativePath: null,
          mediaType: 'application/pdf',
          byteLength: null,
          sha256: null,
          detail: 'raw-inventory-not-attempted',
          sourceRefs: [{ artifactId: secondary.id, rawPointer: '/asset' }],
        },
      ],
      completeness: base.completeness,
    });
    const manifestSha256 = await sha256(encoder.encode(JSON.stringify(manifest, null, 2)));

    const { archive } = await normalizeChatGptCapture({
      bundle: {
        manifest,
        artifacts: [
          {
            record: manifest.artifacts.find(artifact => artifact.id === 'conversation')!,
            bytes,
          },
          {
            record: manifest.artifacts.find(artifact => artifact.id === secondary.id)!,
            bytes: secondaryBytes,
          },
        ],
        assets: [],
      },
      artifactId: 'conversation',
      manifestSha256,
      sha256,
    });

    expect(archive.assets['cross-artifact-asset']?.sourceRefs).toEqual([
      expect.objectContaining({ artifactId: 'asset-index', rawPointer: '/asset' }),
    ]);
  });

  it('fails closed when raw asset metadata conflicts with the manifest', async () => {
    const raw = rawClone();
    const message = raw.mapping['node/current'].message!;
    (message.metadata.attachments as Array<Record<string, unknown>>)[0].size_bytes = 13;

    await expect(errorCode(() => normalize(raw))).resolves.toBe('asset-manifest-conflict');
  });

  it.each([
    [
      'wrong artifact bytes',
      new Uint8Array([...fixtureBytes].reverse()),
      'artifact-integrity-failed',
    ],
    ['wrong manifest hash', fixtureBytes, 'manifest-integrity-failed'],
    ['malformed UTF-8 JSON', new Uint8Array([0xff, 0xfe]), 'malformed-raw-artifact'],
  ])('rejects %s with a stable provenance error', async (_label, bytes, expectedCode) => {
    const manifest = captureManifest(bytes);
    const bundle = bundleFor(bytes, manifest);
    if (expectedCode === 'artifact-integrity-failed') {
      bundle.artifacts[0].bytes = new Uint8Array([...bytes].reverse());
    }
    const manifestSha256 =
      expectedCode === 'manifest-integrity-failed'
        ? '0'.repeat(64)
        : await sha256(encoder.encode(JSON.stringify(manifest, null, 2)));
    await expect(
      errorCode(() =>
        normalizeChatGptCapture({
          bundle,
          artifactId: 'conversation',
          manifestSha256,
          sha256,
        })
      )
    ).resolves.toBe(expectedCode);
  });

  it('rejects malformed manifest structure and reports capture completeness explicitly', async () => {
    const manifest = captureManifest(fixtureBytes, {
      completeness: {
        graph: 'complete',
        messages: 'partial',
        branches: 'unknown',
        assets: 'not-attempted',
      },
    });
    const { archive } = await normalize(undefined, { manifest });
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'capture-messages-partial' }),
        expect.objectContaining({ code: 'capture-branches-unknown' }),
        expect.objectContaining({ code: 'capture-assets-not-attempted' }),
      ])
    );

    const malformed = { ...manifest, artifacts: [{}] } as unknown as RawCaptureManifest;
    await expect(errorCode(() => normalize(undefined, { manifest: malformed }))).resolves.toBe(
      'invalid-manifest'
    );
  });
});
