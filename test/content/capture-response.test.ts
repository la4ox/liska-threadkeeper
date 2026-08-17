import { describe, expect, it, vi } from 'vitest';
import {
  captureResponseArtifact,
  hashCaptureManifest,
  parseJsonArtifact,
  readBoundedResponseBytes,
  sha256Hex,
} from '../../src/content/capture/response';
import { buildCaptureManifest } from '../../src/archive/capture';

describe('capture response primitives', () => {
  it('preserves exact bytes and computes the known SHA-256 digest', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('streams a response into a hashed raw artifact', async () => {
    const source = '{"mapping":{}}';
    const response = new Response(source, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

    const artifact = await captureResponseArtifact(response, {
      artifactId: 'conversation',
      relativePath: 'responses/conversation.json',
      endpoint: { method: 'POST', pathPattern: '/backend-api/f/conversation' },
      maxBytes: 1024,
    });

    expect(new TextDecoder().decode(artifact.bytes)).toBe(source);
    expect(artifact.record.byteLength).toBe(new TextEncoder().encode(source).byteLength);
    expect(artifact.record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.record.mediaType).toBe('application/json; charset=utf-8');
    expect(parseJsonArtifact(artifact.bytes)).toEqual({ mapping: {} });
  });

  it('rejects an oversized declared response before reading its body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const arrayBuffer = vi.fn();
    const response = {
      headers: new Headers({ 'content-length': '999' }),
      body: { cancel },
      arrayBuffer,
    } as unknown as Response;

    await expect(readBoundedResponseBytes(response, 10)).rejects.toThrow(/exceeds/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('cancels a stream that exceeds the runtime byte limit', async () => {
    const cancel = vi.fn();
    const response = {
      headers: new Headers(),
      body: {
        getReader: () => {
          let read = false;
          return {
            read: async () => {
              if (read) return { done: true, value: undefined } as const;
              read = true;
              return { done: false, value: new Uint8Array(11) } as const;
            },
            cancel,
          };
        },
      },
    } as unknown as Response;

    await expect(readBoundedResponseBytes(response, 10)).rejects.toThrow(/exceeds/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('validates the byte limit and bounds responses without a readable stream', async () => {
    const small = new Uint8Array([0, 1, 2]);
    const bodyless = {
      headers: new Headers(),
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(small.buffer),
    } as unknown as Response;

    await expect(readBoundedResponseBytes(bodyless, 3)).resolves.toEqual(small);
    await expect(readBoundedResponseBytes(bodyless, 2)).rejects.toThrow(/exceeds/);
    await expect(readBoundedResponseBytes(bodyless, 0)).rejects.toThrow(/positive safe integer/);
  });

  it('rejects malformed UTF-8 rather than changing raw evidence', () => {
    expect(() => parseJsonArtifact(new Uint8Array([0xff]))).toThrow();
  });

  it('preserves arbitrary binary bytes without a text round trip', async () => {
    const expected = new Uint8Array([0, 255, 1, 128, 42]);
    const artifact = await captureResponseArtifact(new Response(expected), {
      artifactId: 'binary',
      relativePath: 'responses/binary.dat',
      endpoint: { method: 'GET', pathPattern: '/backend-api/example' },
      maxBytes: 1024,
      mediaType: 'application/octet-stream',
    });

    expect([...artifact.bytes]).toEqual([...expected]);
  });

  it('hashes the same formatted manifest representation intended for disk', async () => {
    const manifest = buildCaptureManifest({
      captureId: 'capture-001',
      provider: 'chatgpt',
      conversationId: 'conversation-001',
      capturedAt: '2026-08-17T00:00:00.000Z',
      method: 'same-origin-api',
      artifacts: [
        {
          id: 'conversation',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'a'.repeat(64),
          endpoint: { method: 'POST', pathPattern: '/backend-api/f/conversation' },
        },
      ],
      completeness: {
        graph: 'complete',
        messages: 'complete',
        branches: 'complete',
        assets: 'not-attempted',
      },
    });

    expect(await hashCaptureManifest(manifest)).toBe(
      await sha256Hex(new TextEncoder().encode(JSON.stringify(manifest, null, 2)))
    );
  });
});
