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
