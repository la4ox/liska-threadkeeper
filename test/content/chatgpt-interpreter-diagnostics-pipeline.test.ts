import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCaptureManifest } from '../../src/archive/capture';
import type { LiskaThreadArchive } from '../../src/archive';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  type ChatGptCaptureResponse,
} from '../../src/lib/chatgpt-capture-contract';
import type { ChatGptInterpreterAssetCandidate } from '../../src/lib/chatgpt-interpreter-resolver-contract';
import type { ArchiveCompanionBundle, StagedBinaryAssetResult } from '../../src/lib/types';

const messaging = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../src/lib/messaging', () => ({ sendMessage: messaging.sendMessage }));

import {
  CHATGPT_ASSET_RECAPTURE_FAILED_WARNING,
  captureChatGptArchive,
  observeChatGptInterpreterAssetResolvers,
} from '../../src/content/capture/chatgpt-current-branch';
import { acquireChatGptPageOwnedAssets } from '../../src/content/capture/chatgpt-asset-acquisition';
import { CHATGPT_INTERPRETER_DIAGNOSTIC_WARNING } from '../../src/content/capture/chatgpt-interpreter-resolver-diagnostics';
import { persistChatGptDestinationHonestAttachments } from '../../src/content/chatgpt-asset-export';

const CONVERSATION_ID = '12345678-1234-4234-8234-123456789abc';
const FIXED_TIME = '2026-08-20T12:00:00.000Z';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nsynthetic fixture\n%%EOF\n');
const PDF_URL = `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}&id=synthetic&p=p&sig=private-signed-value&ts=1&v=1`;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixtureBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      conversation_id: CONVERSATION_ID,
      title: 'Synthetic interpreter diagnostics',
      current_node: 'reply',
      mapping: {
        root: { id: 'root', parent: null, children: ['reply'], message: null },
        reply: {
          id: 'reply',
          parent: 'root',
          children: [],
          message: {
            id: 'raw-only-message-id',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: [
                '[Document](sandbox:/mnt/data/synthetic.docx)\n[PDF](sandbox:/mnt/data/synthetic.pdf)',
              ],
            },
            metadata: {},
          },
        },
      },
    })
  );
}

function readArtifact<T>(companion: ArchiveCompanionBundle, kind: 'manifest' | 'canonical'): T {
  const artifact = companion.artifacts.find(item => item.kind === kind);
  if (!artifact || artifact.transport !== 'inline')
    throw new Error('Expected synthetic inline artifact.');
  return JSON.parse(Buffer.from(artifact.bodyBase64, 'base64').toString('utf8')) as T;
}

async function runPipeline(
  mode: 'partial' | 'all-failed' | 'run-failed',
  obsidianBinarySucceeds = true
) {
  const originalBytes = fixtureBytes();
  const response: ChatGptCaptureResponse = {
    success: true,
    data: {
      transport: 'inline',
      bodyBase64: Buffer.from(originalBytes).toString('base64'),
      byteLength: originalBytes.byteLength,
      sha256: sha256(originalBytes),
      mediaType: 'application/json',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      transientAssetResolvers: [],
    },
  };
  const captured = await captureChatGptArchive(CONVERSATION_ID, {
    requestCapture: async () => response,
    createCaptureId: () => `capture-chatgpt-${CONVERSATION_ID}`,
    now: () => new Date(FIXED_TIME),
  });
  const context = captured.assetExportContext;
  if (!context) throw new Error('Synthetic capture requires an attachment context.');
  const originalLedger = JSON.stringify(context.rawCaptureBundle.manifest.assets);
  let plan: ChatGptInterpreterAssetCandidate[] = [];
  messaging.sendMessage.mockImplementation(
    async (request: { action: string; candidates: ChatGptInterpreterAssetCandidate[] }) => {
      expect(request.action).toBe('resolveChatGptInterpreterAssets');
      plan = request.candidates;
      expect(plan).toHaveLength(2);
      if (mode === 'run-failed') return { success: false, code: 'source-http-error' };
      const pdf = plan.find(candidate => candidate.sandboxPath.endsWith('.pdf'))!;
      return {
        success: true,
        data: {
          resolved: mode === 'partial' ? [{ assetId: pdf.assetId, downloadUrl: PDF_URL }] : [],
          diagnostics: plan.map(candidate =>
            candidate.assetId === pdf.assetId
              ? { assetId: candidate.assetId, code: mode === 'partial' ? 'resolved' : 'timed-out' }
              : { assetId: candidate.assetId, code: 'http-error', httpStatus: 404 }
          ),
        },
      };
    }
  );

  const finalCompanions = new Map<string, ArchiveCompanionBundle>();
  const persistArtifacts = vi.fn(
    async (
      companion: ArchiveCompanionBundle,
      _note: string,
      _source: string,
      outputs: string[],
      kinds: readonly string[]
    ) => {
      if (kinds.includes('manifest')) {
        for (const destination of outputs) finalCompanions.set(destination, companion);
      } else {
        const raw = companion.artifacts.find(artifact => artifact.kind === 'raw')!;
        expect(raw.transport).toBe('inline');
        if (raw.transport === 'inline')
          expect(Buffer.from(raw.bodyBase64, 'base64')).toEqual(Buffer.from(originalBytes));
      }
      return { activeOutputs: outputs as ('file' | 'obsidian')[], warnings: [] };
    }
  );
  const fetcher = vi.fn(
    async () => new Response(PDF_BYTES, { headers: { 'Content-Type': 'application/pdf' } })
  );
  const persistBinaryAssets = vi.fn(
    async (input: {
      assets: { record: import('../../src/archive').RawCaptureAssetRecord; bytes: Uint8Array }[];
    }): Promise<StagedBinaryAssetResult[]> =>
      input.assets.map(asset => ({
        assetId: asset.record.id,
        descriptor: {
          assetId: asset.record.id,
          relativePath: asset.record.relativePath!,
          mediaType: asset.record.mediaType!,
          byteLength: asset.bytes.byteLength,
          sha256: sha256(asset.bytes),
        },
        results: [
          { destination: 'file', success: true },
          { destination: 'obsidian', success: obsidianBinarySucceeds },
        ],
        allSuccessful: obsidianBinarySucceeds,
      }))
  );
  const result = await persistChatGptDestinationHonestAttachments(
    context,
    captured.archiveCompanion,
    'synthetic-thread.md',
    ['file', 'obsidian'],
    {
      persistArtifacts,
      observeInterpreterResolvers: observeChatGptInterpreterAssetResolvers,
      observeResolvers: async () => ({
        kind: 'recapture-failed',
        warning: CHATGPT_ASSET_RECAPTURE_FAILED_WARNING,
      }),
      acquireAssets: input =>
        acquireChatGptPageOwnedAssets({ ...input, fetcher, now: () => new Date(FIXED_TIME) }),
      persistBinaryAssets,
    }
  );
  expect(JSON.stringify(context.rawCaptureBundle.manifest.assets)).toBe(originalLedger);
  expect(
    Buffer.from(context.rawCaptureBundle.artifacts[0].bytes).equals(Buffer.from(originalBytes))
  ).toBe(true);
  return { result, plan, finalCompanions, fetcher, persistBinaryAssets, originalBytes };
}

describe('raw-to-canonical interpreter diagnostics pipeline', () => {
  beforeEach(() => {
    messaging.sendMessage.mockReset();
  });

  it('saves PDF bytes while retaining a distinct DOCX HTTP404 reason in both destinations', async () => {
    const run = await runPipeline('partial');
    const docxId = run.plan.find(candidate => candidate.sandboxPath.endsWith('.docx'))!.assetId;
    const pdfId = run.plan.find(candidate => candidate.sandboxPath.endsWith('.pdf'))!.assetId;
    expect(run.fetcher).toHaveBeenCalledOnce();
    expect(run.fetcher).toHaveBeenCalledWith(
      PDF_URL,
      expect.objectContaining({ credentials: 'include', redirect: 'error' })
    );
    expect(run.result.completeDestinations).toEqual(['file', 'obsidian']);
    for (const companion of run.finalCompanions.values()) {
      const manifest = readArtifact<RawCaptureManifest>(companion, 'manifest');
      const archive = readArtifact<LiskaThreadArchive>(companion, 'canonical');
      expect(manifest.assets).toHaveLength(2);
      expect(manifest.artifacts[0].sha256).toBe(sha256(run.originalBytes));
      const manifestArtifact = companion.artifacts.find(item => item.kind === 'manifest')!;
      expect(archive.inputs[0].manifestSha256).toBe(manifestArtifact.sha256);
      expect(manifest.assets.find(asset => asset.id === docxId)).toMatchObject({
        state: 'not-attempted',
        detail: 'interpreter-resolver-http-404',
        attemptedAt: null,
        relativePath: null,
        sha256: null,
      });
      expect(archive.assets[docxId].acquisition).toEqual({
        state: 'not-attempted',
        attemptedAt: null,
        detail: 'interpreter-resolver-http-404',
      });
      expect(archive.assets[docxId].localArtifactRef).toBeNull();
      expect(manifest.assets.find(asset => asset.id === pdfId)).toMatchObject({
        state: 'fetched',
        sha256: sha256(PDF_BYTES),
        byteLength: PDF_BYTES.byteLength,
      });
      expect(archive.assets[pdfId].sha256).toBe(sha256(PDF_BYTES));
      expect(manifest.warnings).toContain(CHATGPT_INTERPRETER_DIAGNOSTIC_WARNING);
      expect(JSON.stringify(manifest)).not.toMatch(
        /private-signed-value|downloadUrl|httpStatus|expired/
      );
      expect(JSON.stringify(archive)).not.toContain('private-signed-value');
    }
  });

  it.each(['all-failed', 'run-failed'] as const)(
    'preserves reasons when %s produces no candidate or binary write',
    async mode => {
      const run = await runPipeline(mode);
      expect(run.fetcher).not.toHaveBeenCalled();
      expect(run.persistBinaryAssets).not.toHaveBeenCalled();
      for (const companion of run.finalCompanions.values()) {
        const manifest = readArtifact<RawCaptureManifest>(companion, 'manifest');
        const archive = readArtifact<LiskaThreadArchive>(companion, 'canonical');
        for (const candidate of run.plan) {
          const detail =
            mode === 'run-failed'
              ? 'interpreter-resolver-run-source-http-error'
              : candidate.sandboxPath.endsWith('.docx')
                ? 'interpreter-resolver-http-404'
                : 'interpreter-resolver-timed-out';
          expect(manifest.assets.find(asset => asset.id === candidate.assetId)).toMatchObject({
            state: 'not-attempted',
            attemptedAt: null,
            detail,
          });
          expect(archive.assets[candidate.assetId].acquisition).toEqual({
            state: 'not-attempted',
            attemptedAt: null,
            detail,
          });
        }
        expect(manifest.warnings).toContain(CHATGPT_INTERPRETER_DIAGNOSTIC_WARNING);
      }
    }
  );

  it('keeps destination write failure separate from a different file resolver failure', async () => {
    const run = await runPipeline('partial', false);
    const pdfId = run.plan.find(candidate => candidate.sandboxPath.endsWith('.pdf'))!.assetId;
    const docxId = run.plan.find(candidate => candidate.sandboxPath.endsWith('.docx'))!.assetId;
    const file = readArtifact<RawCaptureManifest>(run.finalCompanions.get('file')!, 'manifest');
    const obsidian = readArtifact<RawCaptureManifest>(
      run.finalCompanions.get('obsidian')!,
      'manifest'
    );
    expect(file.assets.find(asset => asset.id === pdfId)?.state).toBe('fetched');
    expect(obsidian.assets.find(asset => asset.id === pdfId)).toMatchObject({
      state: 'failed',
      detail: 'destination-write-failed',
      relativePath: null,
      sha256: null,
    });
    expect(obsidian.assets.find(asset => asset.id === docxId)).toMatchObject({
      state: 'not-attempted',
      detail: 'interpreter-resolver-http-404',
      attemptedAt: null,
    });
  });
});
