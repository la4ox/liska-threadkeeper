import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  normalizeChatGptCapture,
  type RawCaptureBundle,
} from '../../src/archive';
import { projectArchiveBranch } from '../../src/content/archive-projection';
import rawFixture from '../fixtures/archive/chatgpt-raw/branching-mixed-content.json';

const encoder = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('verified ChatGPT archive pipeline', () => {
  it('keeps the complete graph while projecting only the current branch', async () => {
    const bytes = encoder.encode(JSON.stringify(rawFixture));
    const artifact = {
      id: 'conversation',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: bytes.byteLength,
      sha256: await sha256(bytes),
      endpoint: {
        method: 'GET' as const,
        pathPattern: '/backend-api/conversation/{conversationId}',
      },
    };
    const manifest = buildCaptureManifest({
      captureId: 'capture-chatgpt-pipeline-001',
      provider: 'chatgpt',
      conversationId: 'synthetic-chatgpt-branch',
      capturedAt: '2026-08-17T12:00:00.000Z',
      method: 'same-origin-api',
      artifacts: [artifact],
      completeness: {
        graph: 'complete',
        messages: 'complete',
        branches: 'complete',
        assets: 'partial',
      },
    });
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes }],
    };
    const manifestSha256 = await sha256(encoder.encode(JSON.stringify(manifest, null, 2)));

    const { archive } = await normalizeChatGptCapture({
      bundle,
      artifactId: 'conversation',
      manifestSha256,
      sha256,
    });
    const projection = projectArchiveBranch(archive, { includeToolContent: true });

    expect(Object.keys(archive.graph.nodes)).toContain('node/alternate');
    expect(projection.selectedNodeIds).toEqual([
      'node/root~structural',
      'node/user',
      'node/current',
    ]);
    expect(projection.selectedNodeIds).not.toContain('node/alternate');
    expect(projection.data.messages.map(message => message.id)).toEqual([
      'message/user',
      'message/current',
    ]);
    expect(projection.data.messages[1].content).toContain('First text part.');
    expect(projection.data.messages[1].toolContent).toContain('**Reasoning**');
  });
});
