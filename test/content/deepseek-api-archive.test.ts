import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InlineArchiveCompanionArtifact } from '../../src/lib/types';
import * as archiveProjection from '../../src/content/archive-projection';
import {
  DeepSeekStructuredCaptureError,
  fetchDeepSeekConversation,
} from '../../src/content/extractors/deepseek-api';

const fixtureBytes = new Uint8Array(
  readFileSync('test/fixtures/archive/deepseek-raw/branching-replace.json')
);

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function inlineBytes(artifact: InlineArchiveCompanionArtifact): Uint8Array {
  return new Uint8Array(Buffer.from(artifact.bodyBase64, 'base64'));
}

function fixtureResponse(): Response {
  return new Response(fixtureBytes.slice(), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('DeepSeek structured archive composition', () => {
  beforeEach(() => {
    localStorage.setItem('userToken', JSON.stringify({ value: 'transient-local-token' }));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'cancels an unsuccessful history body without changing its HTTP error (cancel fails: %s)',
    async cancelFails => {
      const response = new Response('synthetic unavailable history', { status: 503 });
      const cancel = vi.spyOn(response.body!, 'cancel');
      if (cancelFails) cancel.mockRejectedValue(new Error('synthetic cancellation failure'));
      const getReader = vi.spyOn(response.body!, 'getReader');
      const normalizeCapture = vi.fn();
      const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      await expect(
        fetchDeepSeekConversation('deepseek-branching-1', false, { normalizeCapture })
      ).rejects.toThrow('Capture endpoint returned HTTP 503.');

      expect(fetcher).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      expect(getReader).not.toHaveBeenCalled();
      expect(normalizeCapture).not.toHaveBeenCalled();
    }
  );

  it('binds exact raw bytes to manifest and canonical companions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fixtureResponse());
    const result = await fetchDeepSeekConversation('deepseek-branching-1', false, {
      createCaptureId: () => 'capture-deepseek-fixed-001',
      now: () => new Date('2026-09-18T06:00:00.000Z'),
    });

    expect(result).not.toBeNull();
    const artifacts = result!.archiveCompanion
      .artifacts as readonly InlineArchiveCompanionArtifact[];
    expect(artifacts.map(artifact => artifact.kind)).toEqual(['raw', 'manifest', 'canonical']);
    expect(inlineBytes(artifacts[0])).toEqual(fixtureBytes);
    expect(artifacts[0].sha256).toBe(hash(fixtureBytes));

    const manifestBytes = inlineBytes(artifacts[1]);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      artifacts: Array<{ sha256: string }>;
      completeness: Record<string, string>;
      assets: Array<{
        id: string;
        state: string;
        attemptedAt: null;
        relativePath: null;
        mediaType: null;
        byteLength: null;
        sha256: null;
        sourceRefs: Array<{ artifactId: string; rawPointer: string }>;
      }>;
      warnings: string[];
      observedUnknownContentTypes: string[];
    };
    const canonical = JSON.parse(new TextDecoder().decode(inlineBytes(artifacts[2]))) as {
      inputs: Array<{ manifestSha256: string }>;
      graph: { nodes: Record<string, unknown> };
      assets: Record<
        string,
        {
          filename: string | null;
          mimeType: null;
          byteLength: number | null;
          sha256: null;
          localArtifactRef: null;
          acquisition: { state: string; attemptedAt: null };
          sourceRefs: Array<{ id: string | null; rawPointer: string }>;
          extensions: { deepseek: Record<string, unknown> };
        }
      >;
    };
    expect(manifest.artifacts[0].sha256).toBe(hash(fixtureBytes));
    expect(canonical.inputs[0].manifestSha256).toBe(hash(manifestBytes));
    expect(manifest.completeness).toEqual({
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'not-attempted',
    });
    expect(manifest.assets).toHaveLength(2);
    expect(manifest.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^deepseek-asset-[a-f0-9]{64}$/),
          state: 'not-attempted',
          attemptedAt: null,
          relativePath: null,
          mediaType: null,
          byteLength: null,
          sha256: null,
          sourceRefs: [
            {
              artifactId: 'conversation',
              rawPointer: '/data/biz_data/chat_messages/0/files/0',
            },
            {
              artifactId: 'conversation',
              rawPointer: '/data/biz_data/chat_messages/4/files/0',
            },
          ],
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^deepseek-asset-[a-f0-9]{64}$/),
          sourceRefs: [
            {
              artifactId: 'conversation',
              rawPointer: '/data/biz_data/chat_messages/2/files/0',
            },
          ],
        }),
      ])
    );
    expect(JSON.stringify(manifest)).not.toContain('deepseek-file-alpha');
    expect(JSON.stringify(manifest)).not.toContain('deepseek-file-beta');
    expect(manifest.warnings).toEqual([
      'DeepSeek attachment metadata was inventoried; binary acquisition was not attempted.',
    ]);
    expect(manifest.observedUnknownContentTypes).toEqual(['FUTURE_WIDGET']);
    expect(Object.keys(canonical.graph.nodes)).toContain('inactive-answer');
    expect(Object.keys(canonical.assets)).toHaveLength(2);
    expect(Object.values(canonical.assets)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: 'shared-report.txt',
          mimeType: null,
          byteLength: 2048,
          sha256: null,
          localArtifactRef: null,
          acquisition: expect.objectContaining({ state: 'not-attempted', attemptedAt: null }),
          extensions: {
            deepseek: expect.objectContaining({
              inserted_at: '2026-09-18T05:00:00.000Z',
              updated_at: '2026-09-18T05:01:00.000Z',
              status: 'ready',
              error_code: null,
              previewable: true,
              token_usage: 512,
            }),
          },
        }),
      ])
    );
    const canonicalSourceIds = Object.values(canonical.assets)
      .flatMap(asset => asset.sourceRefs)
      .map(source => source.id);
    expect(canonicalSourceIds).toEqual([null, null, null]);
    expect(Object.keys(canonical.assets)).not.toContain('deepseek-file-alpha');
    expect(Object.keys(canonical.assets)).not.toContain('deepseek-file-beta');
    expect(
      JSON.stringify(Object.values(canonical.assets).map(asset => asset.extensions.deepseek))
    ).not.toContain('deepseek-file-alpha');
    expect(
      JSON.stringify(Object.values(canonical.assets).map(asset => asset.extensions.deepseek))
    ).not.toContain('deepseek-file-beta');
    expect(JSON.stringify(canonical)).not.toContain('deepseek-file-alpha');
    expect(JSON.stringify(canonical)).not.toContain('deepseek-file-beta');
    expect(JSON.stringify({ manifest, canonical })).not.toContain('transient-local-token');
    expect(result!.data.capture).toEqual({ mode: 'structured-api', completeness: 'complete' });
    expect(result!.assetExportContext).toMatchObject({
      rawCaptureBundle: { manifest: { captureId: 'capture-deepseek-fixed-001' } },
      rawArtifact: { kind: 'raw', sha256: hash(fixtureBytes) },
    });
    expect(result!.data.messages.map(message => message.content).join('\n')).not.toContain(
      'Inactive sibling answer'
    );
    expect(result!.warnings).toEqual(
      expect.arrayContaining([
        'Legacy Markdown omitted 3 attachment block(s); the canonical archive retains their references and metadata. Binary files are preserved only for assets marked fetched when their selected output write succeeds.',
      ])
    );
  });

  it('toggles only legacy reasoning presentation, not canonical retention', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(fixtureResponse()));
    const dependencies = {
      createCaptureId: () => 'capture-deepseek-fixed-002',
      now: () => new Date('2026-09-18T06:00:00.000Z'),
    };
    const withoutThinking = await fetchDeepSeekConversation(
      'deepseek-branching-1',
      false,
      dependencies
    );
    const withThinking = await fetchDeepSeekConversation(
      'deepseek-branching-1',
      true,
      dependencies
    );

    expect(withoutThinking?.data.messages.every(message => message.toolContent === undefined)).toBe(
      true
    );
    expect(
      withThinking?.data.messages.some(message =>
        message.toolContent?.includes('DeepSeek reasoning')
      )
    ).toBe(true);
    expect(withoutThinking?.archive).toEqual(withThinking?.archive);
  });

  it('relabels only generated headings while preserving ordered provider text after redaction', async () => {
    const reasoningBodies = [
      [
        '**Reasoning**\nA provider-authored heading at the start.',
        'Inline **Reasoning** stays unchanged.',
        '**Reasoning**\nA provider-authored paragraph heading.',
        '> **Reasoning**\n> A quoted heading.',
        'Inline code: `**Reasoning**`.',
        '```markdown\n**Reasoning**\n```',
        '  Whitespace\tstays unchanged.  ',
        'Authorization: Bearer synthetic-fixture-secret',
      ].join('\n\n'),
      '**Reasoning**\nThe second provider-authored heading.',
    ];
    const visibleBodies = [
      'Visible **Reasoning**\n\n**Reasoning**\nVisible heading.',
      '> **Reasoning**\n\n`**Reasoning**`\n\n```markdown\n**Reasoning**\n```',
    ];
    const raw = JSON.parse(new TextDecoder().decode(fixtureBytes));
    raw.data.biz_data.chat_messages[4].fragments = [
      { type: 'THINK', content: reasoningBodies[0] },
      { type: 'RESPONSE', content: visibleBodies[0] },
      { type: 'THINK', content: reasoningBodies[1] },
      { type: 'RESPONSE', content: visibleBodies[1] },
    ];
    const rawBytes = new TextEncoder().encode(JSON.stringify(raw));
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(rawBytes.slice(), { status: 200 }))
    );
    const dependencies = {
      createCaptureId: () => 'capture-deepseek-reasoning-collision',
      now: () => new Date('2026-09-18T06:00:00.000Z'),
    };
    const withoutThinking = await fetchDeepSeekConversation(
      'deepseek-branching-1',
      false,
      dependencies
    );
    const withThinking = await fetchDeepSeekConversation(
      'deepseek-branching-1',
      true,
      dependencies
    );
    const redactedBodies = [
      reasoningBodies[0].replace(
        'Authorization: Bearer synthetic-fixture-secret',
        '[redacted-credential]'
      ),
      reasoningBodies[1],
    ];
    const expectedToolContent = redactedBodies
      .map(body => `**DeepSeek reasoning**\n${body}`)
      .join('\n\n');

    expect(withThinking).not.toBeNull();
    expect(
      withThinking!.data.messages.find(message => message.id === 'current-answer')
    ).toMatchObject({
      content: visibleBodies.join('\n\n'),
      toolContent: expectedToolContent,
    });
    expect(withoutThinking!.data.messages.every(message => message.toolContent === undefined)).toBe(
      true
    );
    expect(withoutThinking!.data.messages.map(message => message.content)).toEqual(
      withThinking!.data.messages.map(message => message.content)
    );
    const blocks = withThinking!.archive.graph.nodes['current-answer'].message!.blocks;
    expect(blocks.filter(block => block.type === 'reasoning').map(block => block.text)).toEqual(
      redactedBodies
    );
    expect(blocks.filter(block => block.type === 'markdown').map(block => block.markdown)).toEqual(
      visibleBodies
    );
    expect(withoutThinking!.archive).toEqual(withThinking!.archive);
    expect(withoutThinking!.archiveCompanion).toEqual(withThinking!.archiveCompanion);
    expect(JSON.stringify(withThinking!.archive)).not.toContain('synthetic-fixture-secret');
    const rawArtifact = withThinking!.archiveCompanion.artifacts.find(
      artifact => artifact.kind === 'raw'
    ) as InlineArchiveCompanionArtifact;
    expect(Array.from(inlineBytes(rawArtifact))).toEqual(Array.from(rawBytes));
    expect(rawArtifact.sha256).toBe(hash(rawBytes));
  });

  it.each(['', ' \t '])(
    'leaves a blank source title %j unchanged in API canonical/raw evidence',
    async title => {
      const raw = JSON.parse(new TextDecoder().decode(fixtureBytes));
      raw.data.biz_data.chat_session.title = title;
      const rawBytes = new TextEncoder().encode(JSON.stringify(raw));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(rawBytes, { status: 200 }));

      const result = await fetchDeepSeekConversation('deepseek-branching-1', false, {
        createCaptureId: () => 'capture-deepseek-blank-title',
        now: () => new Date('2026-09-18T06:00:00.000Z'),
      });

      expect(result?.archive.conversation.title).toBe(title);
      expect(result?.data.title).toBe(title);
      const artifacts = result!.archiveCompanion
        .artifacts as readonly InlineArchiveCompanionArtifact[];
      expect(new TextDecoder().decode(inlineBytes(artifacts[0]))).toBe(JSON.stringify(raw));
      expect(artifacts[0].sha256).toBe(hash(rawBytes));
      expect(
        JSON.parse(new TextDecoder().decode(inlineBytes(artifacts[2]))).conversation.title
      ).toBe(title);
    }
  );

  it('retains raw and manifest companions when normalization fails after capture', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fixtureResponse());
    const promise = fetchDeepSeekConversation('deepseek-branching-1', false, {
      createCaptureId: () => 'capture-deepseek-fixed-003',
      now: () => new Date('2026-09-18T06:00:00.000Z'),
      normalizeCapture: () => Promise.reject(new Error('synthetic normalizer failure')),
    });

    await expect(promise).rejects.toMatchObject<Partial<DeepSeekStructuredCaptureError>>({
      code: 'normalization-failed',
      archiveCompanion: {
        artifacts: [
          expect.objectContaining({ kind: 'raw' }),
          expect.objectContaining({ kind: 'manifest' }),
        ],
      },
    });
  });

  it.each([
    [
      'an invalid non-null alias',
      { created_at: 'not-a-timestamp', create_time: '2026-09-18T06:00:00.000Z' },
    ],
    [
      'conflicting valid aliases',
      { created_at: '2026-09-18T06:00:00.000Z', create_time: '2026-09-18T06:00:01.000Z' },
    ],
  ])('retains exact raw evidence for %s', async (_label, timestampAliases) => {
    const raw = JSON.parse(new TextDecoder().decode(fixtureBytes));
    Object.assign(raw.data.biz_data.chat_session, timestampAliases);
    const rawBytes = new TextEncoder().encode(JSON.stringify(raw));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(rawBytes.slice(), { status: 200 })
    );

    const error = await fetchDeepSeekConversation('deepseek-branching-1', false, {
      createCaptureId: () => 'capture-deepseek-invalid-timestamp',
      now: () => new Date('2026-09-18T06:00:00.000Z'),
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject<Partial<DeepSeekStructuredCaptureError>>({
      code: 'normalization-failed',
    });
    const artifacts = (error as DeepSeekStructuredCaptureError).archiveCompanion!
      .artifacts as readonly InlineArchiveCompanionArtifact[];
    expect(artifacts.map(artifact => artifact.kind)).toEqual(['raw', 'manifest']);
    expect(Array.from(inlineBytes(artifacts[0]))).toEqual(Array.from(rawBytes));
    expect(artifacts[0].sha256).toBe(hash(rawBytes));
    const manifest = JSON.parse(new TextDecoder().decode(inlineBytes(artifacts[1]))) as {
      artifacts: Array<{ sha256: string }>;
    };
    expect(manifest.artifacts[0].sha256).toBe(hash(rawBytes));
  });

  it('fails closed before persistence for an invalid capture identifier or clock', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(fixtureResponse()));

    await expect(
      fetchDeepSeekConversation('deepseek-branching-1', false, {
        createCaptureId: () => 'invalid id with whitespace',
      })
    ).rejects.toMatchObject<Partial<DeepSeekStructuredCaptureError>>({
      code: 'capture-id-invalid',
    });
    await expect(
      fetchDeepSeekConversation('deepseek-branching-1', false, {
        createCaptureId: () => 'capture-deepseek-fixed-004',
        now: () => {
          throw new Error('clock unavailable');
        },
      })
    ).rejects.toMatchObject<Partial<DeepSeekStructuredCaptureError>>({
      code: 'capture-time-invalid',
    });
  });

  it('does not issue a history request for invalid or unavailable page-local tokens', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    localStorage.setItem('userToken', JSON.stringify({ value: 'token\nsmuggling' }));

    await expect(fetchDeepSeekConversation('deepseek-branching-1', false)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    await expect(fetchDeepSeekConversation('deepseek-branching-1', false)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retains the raw and manifest pair when branch projection fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fixtureResponse());
    vi.spyOn(archiveProjection, 'projectArchiveBranch').mockImplementation(() => {
      throw new Error('synthetic projection failure');
    });

    await expect(
      fetchDeepSeekConversation('deepseek-branching-1', false, {
        createCaptureId: () => 'capture-deepseek-fixed-005',
        now: () => new Date('2026-09-18T06:00:00.000Z'),
      })
    ).rejects.toMatchObject<Partial<DeepSeekStructuredCaptureError>>({
      code: 'projection-failed',
      archiveCompanion: {
        artifacts: [
          expect.objectContaining({ kind: 'raw' }),
          expect.objectContaining({ kind: 'manifest' }),
        ],
      },
    });
  });
});
