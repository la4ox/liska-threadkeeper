import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCaptureManifest, type RawCaptureBundle } from '../../src/archive/capture';
import { validateLiskaThreadArchive } from '../../src/archive/validate';
import {
  CLAUDE_NORMALIZER_ID,
  CLAUDE_SOURCE_FORMAT,
  ClaudeNormalizationError,
  inventoryClaudeRawAssets,
  normalizeClaudeCapture,
  preflightClaudeDetailArtifact,
} from '../../src/archive/normalizers/claude';

const fixtureBytes = new Uint8Array(
  readFileSync('test/fixtures/archive/claude-detail/synthetic-branching-rich.json')
);
interface Detail extends Record<string, unknown> {
  uuid: string;
  chat_messages: Array<Record<string, unknown>>;
}
const fixture = JSON.parse(new TextDecoder().decode(fixtureBytes)) as Detail;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sha256 = (bytes: Uint8Array) => Promise.resolve(hash(bytes));
const manifestHash = (bundle: RawCaptureBundle) =>
  hash(new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2)));

function changed(mutate: (detail: Detail) => void): Uint8Array {
  const detail = structuredClone(fixture);
  mutate(detail);
  return encode(detail);
}

async function bundleFor(
  bytes = fixtureBytes,
  conversationId = fixture.uuid
): Promise<RawCaptureBundle> {
  let raw: unknown = null;
  let unknown: string[] = [];
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    /* Normalizer reports malformed bytes. */
  }
  try {
    unknown = preflightClaudeDetailArtifact(bytes, conversationId);
  } catch {
    /* Normalizer reports graph errors. */
  }
  const inventory = await inventoryClaudeRawAssets({ raw, artifactId: 'conversation', sha256 });
  const manifest = buildCaptureManifest({
    captureId: 'claude-synthetic-capture',
    provider: 'claude',
    conversationId,
    capturedAt: '2026-10-31T09:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: bytes.byteLength,
        sha256: hash(bytes),
        endpoint: {
          method: 'GET',
          pathPattern: '/api/organizations/{organizationId}/chat_conversations/{conversationId}',
        },
      },
    ],
    assets: inventory.assets,
    completeness: {
      graph: 'unknown',
      messages: 'unknown',
      branches: 'unknown',
      assets: 'not-attempted',
    },
    observedUnknownContentTypes: unknown,
  });
  return { manifest, artifacts: [{ record: manifest.artifacts[0], bytes }], assets: [] };
}

async function normalize(bytes = fixtureBytes) {
  const bundle = await bundleFor(bytes);
  return normalizeClaudeCapture({
    bundle,
    artifactId: 'conversation',
    manifestSha256: manifestHash(bundle),
    sha256,
  });
}

async function rejects(bytes: Uint8Array, code: string) {
  const error: unknown = await normalize(bytes).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ClaudeNormalizationError);
  expect(error).toMatchObject({ code });
}

describe('Claude web-detail liska-thread/1 normalizer', () => {
  it('verifies exact provenance, retains deterministic topology and does not upgrade completeness', async () => {
    const first = await normalize();
    expect(await normalize()).toEqual(first);
    const { archive } = first;
    expect(CLAUDE_SOURCE_FORMAT).toBe('claude.web.detail');
    expect(CLAUDE_NORMALIZER_ID).toBe('claude-web/1');
    expect(validateLiskaThreadArchive(archive)).toMatchObject({ valid: true });
    expect(archive.inputs[0]).toMatchObject({
      manifestSha256: manifestHash(await bundleFor()),
      normalizer: 'claude-web/1',
      extensions: {
        claude: {
          completeness: {
            graph: 'unknown',
            messages: 'unknown',
            branches: 'unknown',
            assets: 'not-attempted',
          },
        },
      },
    });
    expect(Object.keys(archive.graph.nodes)).toEqual([
      'message-root',
      'message-answer',
      'message-inactive',
      'message-current',
    ]);
    expect(archive.graph.rootIds).toEqual(['message-root']);
    expect(archive.graph.nodes['message-root']).toMatchObject({
      parentId: null,
      extensions: { claude: { parent_message_uuid: 'synthetic-external-root' } },
    });
    expect(archive.graph.nodes['message-answer'].childIds).toEqual([
      'message-inactive',
      'message-current',
    ]);
    expect(archive.conversation.currentNodeId).toBe('message-current');
    expect(archive.graph.nodes['message-current'].message?.sourceRefs).toEqual([
      {
        format: 'claude.web.detail',
        kind: 'message',
        id: 'message-current',
        artifactId: 'conversation',
        rawPointer: '/chat_messages/3',
      },
    ]);
    expect(archive.graph.nodes['message-root'].message?.author.role).toBe('user');
    expect(archive.graph.nodes['message-root'].message?.extensions.claude).toMatchObject({
      sender: 'human',
      index: 0,
    });
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unresolved-root-parent',
          sourceRefs: [
            expect.objectContaining({ rawPointer: '/chat_messages/0/parent_message_uuid' }),
          ],
        }),
        expect.objectContaining({ code: 'capture-graph-unknown' }),
      ])
    );
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'web-detail-direct-text-only',
          sourceRefs: [expect.objectContaining({ rawPointer: '/chat_messages/1/text' })],
        }),
      ])
    );
  });

  it('keeps ordered thinking, text, citation, tools, references and bounded unknowns without duplicate text', async () => {
    const { archive, observedUnknownContentTypes } = await normalize();
    const message = archive.graph.nodes['message-current'].message!;
    expect(message.blocks.map(block => block.type)).toEqual([
      'reasoning',
      'markdown',
      'citation',
      'tool_call',
      'tool_result',
      'attachment',
      'attachment',
      'unknown',
      'attachment',
      'unknown',
    ]);
    expect(message.blocks[0]).toMatchObject({
      type: 'reasoning',
      text: 'Synthetic reasoning, kept separately.',
      sourceRefs: [expect.objectContaining({ rawPointer: '/chat_messages/3/content/0' })],
      extensions: { claude: { summary: { kind: 'synthetic' } } },
    });
    expect(message.blocks[2]).toMatchObject({
      type: 'citation',
      url: 'https://example.invalid/synthetic-source',
      content: { cited_text: 'A synthetic reference.' },
    });
    expect(message.blocks[3]).toMatchObject({
      type: 'tool_call',
      toolName: 'synthetic_lookup',
      arguments: { query: 'synthetic' },
      extensions: { claude: { id: 'synthetic-tool-call' } },
    });
    expect(message.blocks[4]).toMatchObject({
      type: 'tool_result',
      result: [{ type: 'text', text: 'Synthetic tool result.' }],
      extensions: { claude: { tool_use_id: 'synthetic-tool-call', is_error: false } },
    });
    expect(observedUnknownContentTypes).toEqual(['artifact', 'future_widget']);
    expect(message.extensions.claude).toMatchObject({
      truncated: true,
      sync_sources: [{ type: 'synthetic_connector', enabled: false }],
    });
    expect(
      archive.diagnostics.entries.some(entry => entry.code === 'provider-message-truncated')
    ).toBe(true);
    expect(JSON.stringify(message)).not.toContain('Duplicate provider text');
  });

  it('supports direct text fallback and empty structured content without duplicate blocks', async () => {
    const { archive } = await normalize(
      changed(detail => {
        detail.chat_messages[0].content = [];
        detail.chat_messages[1].content = null;
      })
    );
    expect(archive.graph.nodes['message-root'].message?.blocks[0]).toMatchObject({
      type: 'text',
      text: 'Read this wholly synthetic document.',
      sourceRefs: [expect.objectContaining({ rawPointer: '/chat_messages/0/text' })],
    });
    expect(archive.graph.nodes['message-answer'].message?.blocks).toMatchObject([
      { type: 'markdown', markdown: 'An initial synthetic answer.' },
    ]);
  });

  it('supports no-index stable array order, null roots, multiple roots and empty conversations', async () => {
    const { archive } = await normalize(
      changed(detail => {
        detail.chat_messages.forEach(message => delete message.index);
        detail.chat_messages[0].parent_message_uuid = null;
        detail.chat_messages[2].parent_message_uuid = null;
      })
    );
    expect(archive.graph.rootIds).toEqual(['message-root', 'message-inactive']);
    expect(archive.graph.nodes['message-answer'].childIds).toEqual(['message-current']);
    const empty = await normalize(
      changed(detail => {
        detail.chat_messages = [];
        delete detail.current_leaf_message_uuid;
      })
    );
    expect(empty.archive.graph).toEqual({ rootIds: [], nodes: {} });
    expect(empty.archive.conversation.currentNodeId).toBeNull();
  });

  it('inventories metadata without binary claims; coalesces only exact durable IDs', async () => {
    const bytes = changed(detail => {
      detail.chat_messages[3].files = [
        { file_name: 'same-name.txt', file_size: 2 },
        { file_name: 'same-name.txt', file_size: 2 },
        { id: 'conflicting-1', file_id: 'conflicting-2', file_name: 'same-name.txt' },
        { id: 'conflicting-1', file_id: 'conflicting-2', file_name: 'same-name.txt' },
      ];
    });
    const { archive } = await normalize(bytes);
    const bundle = await bundleFor(bytes);
    expect(Object.keys(archive.assets)).toHaveLength(6);
    expect(
      Object.values(archive.assets).find(asset => asset.sourceRefs.length === 2)
    ).toMatchObject({ filename: 'synthetic-notes.txt', byteLength: 128 });
    for (const asset of Object.values(archive.assets)) {
      expect(asset.id).toMatch(/^claude-asset-[a-f0-9]{64}$/);
      expect(asset).toMatchObject({
        sha256: null,
        localArtifactRef: null,
        acquisition: { state: 'not-attempted', attemptedAt: null },
      });
      const manifestAsset = bundle.manifest.assets.find(item => item.id === asset.id)!;
      expect(manifestAsset).toMatchObject({
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        byteLength: null,
        sha256: null,
      });
      expect(manifestAsset.sourceRefs.map(item => item.rawPointer)).toEqual(
        asset.sourceRefs.map(item => item.rawPointer)
      );
    }
    expect(bundle.assets).toEqual([]);
  });

  it('rejects invented/missing ledger refs and all manifest binary acquisition claims', async () => {
    for (const mutation of [
      (bundle: RawCaptureBundle) => {
        bundle.manifest.assets.pop();
      },
      (bundle: RawCaptureBundle) => {
        bundle.manifest.assets[0].sourceRefs[0].rawPointer = '/uuid';
      },
      (bundle: RawCaptureBundle) => {
        bundle.manifest.assets[0].state = 'declined';
      },
    ]) {
      const bundle = await bundleFor();
      mutation(bundle);
      bundle.manifest = buildCaptureManifest(bundle.manifest);
      await expect(
        normalizeClaudeCapture({
          bundle,
          artifactId: 'conversation',
          manifestSha256: manifestHash(bundle),
          sha256,
        })
      ).rejects.toMatchObject({ code: 'asset-inventory-mismatch' });
    }
  });

  it('keeps account identity, credentials, signed URLs and inline binary payloads raw-only', async () => {
    const bytes = changed(detail => {
      detail.account = { uuid: 'private-account-identity', email: 'private-email-value' };
      detail.organization_id = 'private-org-identity';
      detail.auth = { value: 'private-auth-value' };
      detail.name = 'Authorization: Bearer private-title-value';
      detail.chat_messages[3].extra = {
        request_headers: { Authorization: 'private-header-value' },
        account_uuid: 'private-nested-identity',
        download_url: 'https://files.example.invalid/a?sig=private-url-value',
        note: 'Use https://files.example.invalid/a?X-Amz-Signature=private-signed-value or /download?token=private-relative-value or [file](&#47;download&#63;api_key=private-encoded-value)',
      };
      detail.chat_messages[3].content = [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'private-binary-value' },
        },
        {
          type: 'citation',
          title: 'Safe',
          url: 'https://example.invalid/?token=private-citation-value',
          account_id: 'private-citation-identity',
        },
        {
          type: 'future',
          api_key: 'private-unknown-value',
          nested: { cookie: 'private-cookie-value', retained: true },
        },
      ];
    });
    const { archive } = await normalize(bytes);
    const serialized = JSON.stringify(archive);
    expect(serialized).not.toMatch(/private-[a-z-]+/);
    expect(serialized).toContain('[redacted-credential]');
    expect(serialized).toContain('[redacted-sensitive-url]');
    expect(archive.graph.nodes['message-current'].message?.blocks[1]).toMatchObject({
      type: 'citation',
      url: null,
    });
    expect(
      archive.diagnostics.entries.some(entry => entry.code === 'privacy-redacted-sensitive-field')
    ).toBe(true);
  });

  it('preserves malformed/unknown blocks and bounds samples with explicit diagnostics', async () => {
    const { archive, observedUnknownContentTypes } = await normalize(
      changed(detail => {
        detail.chat_messages[3].content = [
          null,
          { type: 'thinking', thinking: { nested: true } },
          { type: 'future', body: 'x'.repeat(40_000) },
        ];
        delete detail.chat_messages[3].artifacts;
      })
    );
    expect(observedUnknownContentTypes).toEqual([
      'INVALID_CONTENT_BLOCK',
      'future',
      'thinking:malformed',
    ]);
    const blocks = archive.graph.nodes['message-current'].message!.blocks;
    expect(blocks.slice(0, 3).map(block => block.type)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(blocks[2]).toMatchObject({ type: 'unknown', raw: { _liskaTruncated: true } });
    expect(archive.diagnostics.entries.some(entry => entry.code === 'bounded-provider-value')).toBe(
      true
    );
  });

  it.each([
    [
      'duplicate ID',
      (detail: Detail) => {
        detail.chat_messages[3].uuid = 'message-inactive';
      },
      'duplicate-message-id',
    ],
    [
      'cycle',
      (detail: Detail) => {
        detail.chat_messages[0].parent_message_uuid = 'message-current';
      },
      'graph-cycle',
    ],
    [
      'missing leaf',
      (detail: Detail) => {
        delete detail.current_leaf_message_uuid;
      },
      'current-message-missing',
    ],
    [
      'unknown leaf',
      (detail: Detail) => {
        detail.current_leaf_message_uuid = 'missing-leaf';
      },
      'current-message-missing',
    ],
    [
      'non-leaf current',
      (detail: Detail) => {
        detail.current_leaf_message_uuid = 'message-answer';
      },
      'current-message-not-leaf',
    ],
    [
      'duplicate index',
      (detail: Detail) => {
        detail.chat_messages[3].index = 2;
      },
      'invalid-message-index',
    ],
    [
      'non-monotonic index',
      (detail: Detail) => {
        detail.chat_messages[3].index = 0;
      },
      'invalid-message-index',
    ],
    [
      'fractional index',
      (detail: Detail) => {
        detail.chat_messages[3].index = 3.5;
      },
      'invalid-message-index',
    ],
    [
      'unsafe ID',
      (detail: Detail) => {
        detail.chat_messages[3].uuid = '__proto__';
      },
      'unsafe-id',
    ],
    [
      'missing parent',
      (detail: Detail) => {
        delete detail.chat_messages[3].parent_message_uuid;
      },
      'missing-parent-id',
    ],
    [
      'two unresolved parents',
      (detail: Detail) => {
        detail.chat_messages[3].parent_message_uuid = 'another-missing-parent';
      },
      'parent-message-missing',
    ],
    [
      'wrong UUID',
      (detail: Detail) => {
        detail.uuid = 'different-conversation';
      },
      'conversation-id-mismatch',
    ],
  ] as const)('rejects %s', async (_name, mutate, code) => {
    await rejects(changed(mutate), code);
  });

  it('fails closed on malformed UTF-8/JSON and integrity drift', async () => {
    await rejects(new TextEncoder().encode('{'), 'malformed-raw-artifact');
    await rejects(new Uint8Array([0xff]), 'malformed-raw-artifact');
    const bundle = await bundleFor();
    await expect(
      normalizeClaudeCapture({
        bundle,
        artifactId: 'conversation',
        manifestSha256: '0'.repeat(64),
        sha256,
      })
    ).rejects.toMatchObject({ code: 'manifest-integrity-failed' });
    bundle.artifacts[0].bytes = fixtureBytes.slice();
    bundle.artifacts[0].bytes[0] ^= 1;
    await expect(
      normalizeClaudeCapture({
        bundle,
        artifactId: 'conversation',
        manifestSha256: manifestHash(bundle),
        sha256,
      })
    ).rejects.toMatchObject({ code: 'artifact-integrity-failed' });
  });

  it('requires exact observed-unknown evidence in the integrity-verified manifest', async () => {
    const bundle = await bundleFor();
    bundle.manifest.observedUnknownContentTypes = [];
    await expect(
      normalizeClaudeCapture({
        bundle,
        artifactId: 'conversation',
        manifestSha256: manifestHash(bundle),
        sha256,
      })
    ).rejects.toMatchObject({ code: 'unknown-content-types-mismatch' });
  });

  it('captures raw type evidence in preflight even when the current leaf is missing', async () => {
    const bytes = changed(detail => {
      delete detail.current_leaf_message_uuid;
    });
    expect(preflightClaudeDetailArtifact(bytes, fixture.uuid)).toEqual([
      'artifact',
      'future_widget',
    ]);
    const bundle = await bundleFor(bytes);
    expect(bundle.artifacts[0].bytes).toEqual(bytes);
    expect(bundle.manifest.observedUnknownContentTypes).toEqual(['artifact', 'future_widget']);
    await expect(
      normalizeClaudeCapture({
        bundle,
        artifactId: 'conversation',
        manifestSha256: manifestHash(bundle),
        sha256,
      })
    ).rejects.toMatchObject({ code: 'current-message-missing' });
  });

  it('limits preflight to safe JSON, plain top-level identity and type inventory', () => {
    expect(
      preflightClaudeDetailArtifact(
        encode({ uuid: fixture.uuid, chat_messages: null }),
        fixture.uuid
      )
    ).toEqual([]);
    expect(
      preflightClaudeDetailArtifact(
        changed(detail => {
          detail.chat_messages[1].uuid = detail.chat_messages[0].uuid;
          detail.chat_messages[2].index = -1;
          detail.chat_messages[0].parent_message_uuid = 'message-current';
        }),
        fixture.uuid
      )
    ).toEqual(['artifact', 'future_widget']);
    expect(() => preflightClaudeDetailArtifact(encode([]), fixture.uuid)).toThrow(
      ClaudeNormalizationError
    );
    expect(() => preflightClaudeDetailArtifact(encode({ uuid: 'other' }), fixture.uuid)).toThrow(
      ClaudeNormalizationError
    );
    expect(() => preflightClaudeDetailArtifact(new Uint8Array([0xff]), fixture.uuid)).toThrow(
      ClaudeNormalizationError
    );
  });

  it('excludes identity/auth aliases across canonical residual, unknown, tool, citation and asset metadata', async () => {
    const aliases = [
      'user_id',
      'userId',
      'user-id',
      'user_uuid',
      'userName',
      'creator_id',
      'createdBy',
      'created_by_uuid',
      'accountId',
      'emailAddress',
      'phone_number',
      'phoneNumber',
      'phone-number',
      'mobile_number',
      'auth_key',
      'authKey',
      'auth-key',
      'x_auth_token',
      'token_value',
      'tokenValue',
      'access_token',
      'refreshToken',
      'id-token',
      'cookie_header',
      'setCookie',
      'session_id',
      'sessionId',
      'secret_key',
      'clientSecret',
      'api_key',
      'apiKey',
      'x-api-key',
      'client_id',
    ];
    const privateFields = Object.fromEntries(
      aliases.map((key, index) => [key, `private-alias-${index}`])
    );
    const structural = {
      token_usage: 7,
      token_count: 2,
      message_count: 4,
      user_selected: false,
      has_user_messages: true,
      authored_at: 'synthetic',
      is_error: false,
    };
    const payload = { ...privateFields, ...structural };
    const { archive } = await normalize(
      changed(detail => {
        Object.assign(detail, privateFields);
        detail.chat_messages[3].extension_data = payload;
        detail.chat_messages[3].content = [
          { type: 'text', text: 'Safe canonical text.', nested: payload },
          { type: 'tool_use', name: 'lookup', input: payload },
          { type: 'tool_result', content: payload },
          { type: 'citation', title: 'Safe citation', ...payload },
          { type: 'image', source: { type: 'metadata', ...payload } },
          { type: 'future', nested: payload },
        ];
      })
    );
    expect(JSON.stringify(archive)).not.toContain('private-alias-');
    const message = archive.graph.nodes['message-current'].message!;
    expect(message.extensions.claude).toMatchObject({ extension_data: structural });
    expect(message.blocks[0]).toMatchObject({ extensions: { claude: { nested: structural } } });
    expect(message.blocks[1]).toMatchObject({ type: 'tool_call', arguments: structural });
    expect(message.blocks[2]).toMatchObject({ type: 'tool_result', result: structural });
    expect(message.blocks[3]).toMatchObject({ type: 'citation', content: structural });
    expect(message.blocks[5]).toMatchObject({ type: 'unknown', raw: { nested: structural } });
    const image = Object.values(archive.assets).find(asset =>
      asset.sourceRefs.some(source => source.rawPointer === '/chat_messages/3/content/4')
    )!;
    expect(image.extensions.claude).toMatchObject({
      metadata: [{ value: { source: structural } }],
    });
  });

  it('sanitizes labeled credentials and entity-encoded signed URLs in otherwise safe values', async () => {
    const { archive } = await normalize(
      changed(detail => {
        detail.chat_messages[3].extension_data = {
          safe_note:
            'auth_key=private-auth-labeled; userId: private-user-labeled; apiKey="private-api-labeled"',
          link_notes: [
            '[download](&#47;download&#63;auth_key&#61;private-encoded-auth)',
            '[download](&amp;#47;download&amp;#63;signature&amp;#61;private-double-encoded)',
            'https://example.invalid/download?X-Amz-Signature&#61;private-encoded-signature',
          ],
          retained: { version: 2, state: 'synthetic' },
        };
      })
    );
    const serialized = JSON.stringify(archive);
    expect(serialized).not.toMatch(/private-(?:auth|user|api|encoded|double)/);
    expect(serialized).toContain('[redacted-credential]');
    expect(serialized).toContain('[redacted-sensitive-url]');
    expect(archive.graph.nodes['message-current'].message?.extensions.claude).toMatchObject({
      extension_data: { retained: { version: 2, state: 'synthetic' } },
    });
  });

  it('retains unmapped nested tool content, metadata and alternate thinking text', async () => {
    const { archive, observedUnknownContentTypes } = await normalize(
      changed(detail => {
        detail.chat_messages[3].content = [
          { type: 'thinking', thinking: 'Primary thinking.', text: 'Alternate provider text.' },
          {
            type: 'tool_result',
            content: [
              { type: 'tool_result', content: [{ type: 'nested_future', retained: true }] },
              {
                type: 'image',
                file_id: 'nested-image',
                source: { type: 'metadata', media_type: 'image/png' },
              },
              {
                type: 'text',
                text: 'Nested tool text.',
                citations: [{ title: 'Nested citation', url: 'https://example.invalid/nested' }],
              },
            ],
          },
        ];
        delete detail.chat_messages[3].artifacts;
      })
    );
    expect(observedUnknownContentTypes).toEqual(['nested_future']);
    const blocks = archive.graph.nodes['message-current'].message!.blocks;
    expect(blocks[0]).toMatchObject({
      type: 'reasoning',
      text: 'Primary thinking.',
      extensions: { claude: { text: 'Alternate provider text.' } },
    });
    expect(blocks.slice(1).map(block => block.type)).toEqual([
      'tool_result',
      'unknown',
      'attachment',
      'citation',
      'attachment',
    ]);
    expect(blocks[2]).toMatchObject({
      providerType: 'nested_future',
      sourceRefs: [
        expect.objectContaining({ rawPointer: '/chat_messages/3/content/1/content/0/content/0' }),
      ],
    });
  });

  it('keeps durable asset identities independent of filenames', async () => {
    const before = await normalize();
    const after = await normalize(
      changed(detail => {
        const attachment = (
          detail.chat_messages[0].attachments as Array<Record<string, unknown>>
        )[0];
        attachment.file_name = 'renamed-synthetic.txt';
      })
    );
    const beforeAsset = Object.values(before.archive.assets).find(
      asset => asset.sourceRefs.length === 2
    )!;
    const afterAsset = Object.values(after.archive.assets).find(
      asset => asset.sourceRefs.length === 2
    )!;
    expect(afterAsset.id).toBe(beforeAsset.id);
    expect(afterAsset.filename).toBe('renamed-synthetic.txt');
  });

  it('normalizes a long chain without recursive graph traversal', async () => {
    const count = 2500;
    const { archive } = await normalize(
      changed(detail => {
        detail.current_leaf_message_uuid = `node-${count - 1}`;
        detail.chat_messages = Array.from({ length: count }, (_, index) => ({
          uuid: `node-${index}`,
          parent_message_uuid: index === 0 ? null : `node-${index - 1}`,
          sender: index % 2 ? 'assistant' : 'human',
          text: `Synthetic message ${index}`,
        }));
      })
    );
    expect(Object.keys(archive.graph.nodes)).toHaveLength(count);
    expect(archive.conversation.currentNodeId).toBe(`node-${count - 1}`);
    expect(validateLiskaThreadArchive(archive).valid).toBe(true);
  });
});
