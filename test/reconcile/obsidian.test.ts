import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  ChatGptReconciliationArtifact,
  ChatGptReconciliationArtifactPath,
  ChatGptReconciliationBundleManifest,
  ChatGptReconciliationDelivery,
} from '../../src/archive/reconciliation/chatgpt-delivery';
import { ObsidianApiError } from '../../src/lib/obsidian-api';
import {
  OBSIDIAN_RECONCILIATION_HARD_LIMITS,
  writeReconciliationToObsidian,
  type ObsidianReconciliationClient,
  type WriteReconciliationToObsidianInput,
} from '../../src/reconcile/obsidian';

const PRIVATE = 'PRIVATE-CREDENTIAL-OR-PAYLOAD-SENTINEL';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const OPERATION_AT = '2026-10-25T00:00:00.000Z';
const ATTEMPT = 'attempt-00000000-0000-4000-8000-000000000001';
const CONVERSATION = 'c'.repeat(64);
const hash = async (bytes: Uint8Array): Promise<string> =>
  createHash('sha256').update(bytes).digest('hex');

async function artifact(
  relativePath: ChatGptReconciliationArtifactPath,
  value: unknown
): Promise<ChatGptReconciliationArtifact> {
  const bytes = encoder.encode(`${JSON.stringify(value)}\n`);
  return {
    relativePath,
    mediaType: 'application/json',
    byteLength: bytes.length,
    sha256: await hash(bytes),
    bytes,
  };
}

function descriptor(value: ChatGptReconciliationArtifact) {
  const { relativePath, mediaType, byteLength, sha256 } = value;
  return { relativePath, mediaType, byteLength, sha256 };
}

async function delivery(status: 'normalized' | 'raw-only' = 'normalized') {
  const artifacts = [
    await artifact('official/conversation.json', {
      title: PRIVATE,
      text: 'Лиска ♥',
      id: 'synthetic',
    }),
    await artifact('official/manifest.json', { schema: 'liska-capture/1', private: PRIVATE }),
  ];
  if (status === 'normalized') {
    artifacts.push(await artifact('official/canonical/liska-thread-1.json', { private: PRIVATE }));
    artifacts.push(
      await artifact('comparison/liska-chatgpt-comparison-1.json', { schema: 'synthetic' })
    );
  }
  const failureCode = status === 'normalized' ? null : 'official-normalization-failed';
  const manifest: ChatGptReconciliationBundleManifest = {
    schema: 'liska-chatgpt-reconciliation-bundle/1',
    status,
    failureCode,
    webCanonical: {
      byteLength: 2,
      sha256: 'd'.repeat(64),
      provenanceVerification: 'canonical-declarations-only',
    },
    official: {
      captureId: 'capture-synthetic',
      declaredManifestSha256: artifacts[1].sha256,
      excerpt: descriptor(artifacts[0]),
      manifest: descriptor(artifacts[1]),
      provenance: {
        kind: 'official-export-slice',
        fileRole: 'conversations',
        conversationIndex: 0,
        byteStart: 1,
        byteEndExclusive: 10,
        sourceByteLength: 11,
      },
    },
    artifacts: artifacts.map(descriptor),
    warnings: ['Fixed synthetic warning.'],
  };
  const root = await artifact('manifest.json', manifest);
  artifacts.push(root);
  const base = { artifacts, manifest, bundleId: root.sha256, conversationKey: CONVERSATION };
  return status === 'normalized'
    ? ({ ...base, status, failureCode: null } as ChatGptReconciliationDelivery)
    : ({
        ...base,
        status,
        failureCode: 'official-normalization-failed',
      } as ChatGptReconciliationDelivery);
}

function harness() {
  const calls: Array<{ action: string; path?: string; bytes?: Uint8Array; timeout?: number }> = [];
  const files = new Map<string, Uint8Array>();
  const client: ObsidianReconciliationClient = {
    getServerVersions: vi.fn(async timeout => {
      calls.push({ action: 'server', timeout });
      return { self: '5.5.0', obsidian: '1.14.4' };
    }),
    binaryFileExists: vi.fn(async (path, timeout) => {
      calls.push({ action: 'preflight', path, timeout });
      return files.has(path);
    }),
    putBinaryFileIfAbsent: vi.fn(async (path, bytes, contentType, timeout) => {
      calls.push({ action: 'put', path, bytes: bytes.slice(), timeout });
      expect(contentType).toBe('application/octet-stream');
      if (files.has(path)) throw new ObsidianApiError(412, 'private path');
      files.set(path, bytes.slice());
    }),
    getBinaryFileBounded: vi.fn(async (path, maxBytes, timeout) => {
      calls.push({ action: 'readback', path, timeout });
      const bytes = files.get(path);
      if (bytes && bytes.byteLength > maxBytes) throw new Error('bounded read');
      return bytes?.slice() ?? null;
    }),
  };
  return { client, calls, files, factory: vi.fn(() => client) };
}

async function request(status: 'normalized' | 'raw-only' = 'normalized') {
  const h = harness();
  const input: WriteReconciliationToObsidianInput = {
    delivery: await delivery(status),
    settings: {
      obsidianUrl: 'http://127.0.0.1:27123',
      obsidianApiKey: PRIVATE,
      vaultPath: 'AI/{platform}/{YYYY}/{MM}/{DD}',
    },
    operationAt: OPERATION_AT,
    attemptId: ATTEMPT,
    sha256: hash,
    clientFactory: h.factory,
  };
  return { input, ...h };
}

function expectContentFree(value: unknown): void {
  const text = JSON.stringify(value);
  for (const forbidden of [PRIVATE, '127.0.0.1', 'AI/', 'capture-synthetic', 'Лиска'])
    expect(text).not.toContain(forbidden);
}

describe('writeReconciliationToObsidian', () => {
  it.each(['normalized', 'raw-only'] as const)(
    'preflights and sequentially verifies the exact %s bundle with root last',
    async status => {
      const h = await request(status);
      const result = await writeReconciliationToObsidian(h.input);
      const paths = h.input.delivery.artifacts.map(value => value.relativePath);
      expect(result).toMatchObject({
        status: 'confirmed',
        failureCode: null,
        attemptId: ATTEMPT,
        bundleId: h.input.delivery.bundleId,
        conversationKey: CONVERSATION,
      });
      expect(result.receipts).toEqual(
        paths.map(relativePath => ({ relativePath, state: 'confirmed', failureCode: null }))
      );
      expect(h.calls.map(call => call.action)).toEqual([
        'server',
        ...paths.map(() => 'preflight'),
        ...paths.flatMap(() => ['put', 'readback']),
      ]);
      const putCalls = h.calls.filter(call => call.action === 'put');
      expect(putCalls[putCalls.length - 1].path).toMatch(/\/manifest.json$/);
      for (let index = 0; index < putCalls.length; index += 1) {
        expect(putCalls[index].path).toMatch(
          new RegExp(
            `^AI/chatgpt/2026/10/25/_liska-reconciliation/${CONVERSATION}/${h.input.delivery.bundleId}/${ATTEMPT}/`
          )
        );
        expect(Array.from(putCalls[index].bytes!)).toEqual(
          Array.from(h.input.delivery.artifacts[index].bytes)
        );
        expect(await hash(h.files.get(putCalls[index].path!)!)).toBe(
          h.input.delivery.artifacts[index].sha256
        );
      }
      expect(h.calls.every(call => call.timeout === 60_000)).toBe(true);
      expectContentFree(result);
    }
  );

  it.each([
    '5.4.999',
    '5.1.0',
    '5.5.0-beta.1',
    '5.5',
    'v5.5.0',
    '5.05.0',
    '99999999999999999999.0.0',
  ])('rejects unsupported server version %s before touching artifact paths', async version => {
    const h = await request();
    vi.mocked(h.client.getServerVersions).mockResolvedValue({ self: version, obsidian: '1.14.4' });
    const result = await writeReconciliationToObsidian(h.input);
    expect(result).toMatchObject({ status: 'refused', failureCode: 'server-unsupported' });
    expect(h.client.binaryFileExists).not.toHaveBeenCalled();
    expect(h.client.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    expectContentFree(result);
  });

  it.each(['5.5.0', '5.5.2', '5.6.0', '6.0.0'])(
    'admits stable create-only server %s',
    async version => {
      const h = await request();
      vi.mocked(h.client.getServerVersions).mockResolvedValue({
        self: version,
        obsidian: '1.14.4',
      });
      expect((await writeReconciliationToObsidian(h.input)).status).toBe('confirmed');
    }
  );

  it('sanitizes authentication/server-info errors before artifact preflight', async () => {
    const h = await request();
    vi.mocked(h.client.getServerVersions).mockRejectedValue(new ObsidianApiError(401, PRIVATE));
    const result = await writeReconciliationToObsidian(h.input);
    expect(result).toMatchObject({ status: 'refused', failureCode: 'server-info-failed' });
    expect(h.client.binaryFileExists).not.toHaveBeenCalled();
    expect(h.client.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    expectContentFree(result);
  });

  it('refuses any occupied target before all writes, including empty or identical contents', async () => {
    for (const occupied of [new Uint8Array(), encoder.encode('same')]) {
      const h = await request();
      vi.mocked(h.client.binaryFileExists)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      h.files.set('unrelated', occupied);
      const result = await writeReconciliationToObsidian(h.input);
      expect(result).toMatchObject({ status: 'refused', failureCode: 'collision' });
      expect(h.client.putBinaryFileIfAbsent).not.toHaveBeenCalled();
      expect(result.receipts.every(receipt => receipt.state === 'not-dispatched')).toBe(true);
    }
  });

  it('refuses a failed preflight without writing', async () => {
    const h = await request();
    vi.mocked(h.client.binaryFileExists).mockRejectedValue(new Error(PRIVATE));
    const result = await writeReconciliationToObsidian(h.input);
    expect(result).toMatchObject({ status: 'refused', failureCode: 'preflight-failed' });
    expect(h.client.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    expectContentFree(result);
  });

  it.each([0, 1, 2, 3, 4])(
    'stops after unconfirmed PUT at artifact %i without retry or rollback',
    async position => {
      const h = await request();
      const originalPut = h.client.putBinaryFileIfAbsent;
      let index = 0;
      vi.mocked(h.client.putBinaryFileIfAbsent).mockImplementation(async (...args) => {
        const current = index++;
        if (current === position) throw new Error(PRIVATE);
        const [path, bytes] = args;
        h.files.set(path, bytes.slice());
      });
      const result = await writeReconciliationToObsidian(h.input);
      expect(result).toMatchObject({ status: 'partial', failureCode: 'write-unconfirmed' });
      expect(result.receipts[position]).toMatchObject({
        state: 'unknown',
        failureCode: 'write-unconfirmed',
      });
      expect(
        result.receipts.slice(0, position).every(receipt => receipt.state === 'confirmed')
      ).toBe(true);
      expect(
        result.receipts.slice(position + 1).every(receipt => receipt.state === 'not-dispatched')
      ).toBe(true);
      expect(originalPut).toHaveBeenCalledTimes(position + 1);
      expect(h.files.size).toBe(position);
      expectContentFree(result);
    }
  );

  it('treats an atomic 412 refusal as collision, not an unknown write', async () => {
    const h = await request();
    vi.mocked(h.client.putBinaryFileIfAbsent).mockRejectedValue(new ObsidianApiError(412, PRIVATE));
    const result = await writeReconciliationToObsidian(h.input);
    expect(result).toMatchObject({ status: 'refused', failureCode: 'collision' });
    expect(result.receipts[0]).toMatchObject({ state: 'not-dispatched', failureCode: 'collision' });
    expect(h.client.putBinaryFileIfAbsent).toHaveBeenCalledOnce();
    expect(h.client.getBinaryFileBounded).not.toHaveBeenCalled();
  });

  it.each(['throw', 'missing', 'size', 'hash'] as const)(
    'stops all successors on %s readback failure and leaves current state unknown',
    async mode => {
      const h = await request();
      vi.mocked(h.client.getBinaryFileBounded).mockImplementation(async () => {
        if (mode === 'throw') throw new Error(PRIVATE);
        if (mode === 'missing') return null;
        if (mode === 'size') return new Uint8Array();
        return new Uint8Array(h.input.delivery.artifacts[0].byteLength);
      });
      const result = await writeReconciliationToObsidian(h.input);
      expect(result.status).toBe('partial');
      expect(result.failureCode).toBe(
        {
          throw: 'readback-failed',
          missing: 'readback-missing',
          size: 'readback-size-mismatch',
          hash: 'readback-hash-mismatch',
        }[mode]
      );
      expect(result.receipts[0].state).toBe('unknown');
      expect(result.receipts.slice(1).every(receipt => receipt.state === 'not-dispatched')).toBe(
        true
      );
      expect(h.client.putBinaryFileIfAbsent).toHaveBeenCalledOnce();
      expect(h.files.size).toBe(1);
      expectContentFree(result);
    }
  );

  it('does not claim root commitment after uncertain final manifest readback', async () => {
    const h = await request();
    const originalRead = h.client.getBinaryFileBounded;
    let index = 0;
    vi.mocked(h.client.getBinaryFileBounded).mockImplementation(async path => {
      if (index++ === 4) throw new Error(PRIVATE);
      return h.files.get(path)!.slice();
    });
    const result = await writeReconciliationToObsidian(h.input);
    expect(result).toMatchObject({ status: 'partial', failureCode: 'readback-failed' });
    expect(result.receipts.slice(0, 4).every(receipt => receipt.state === 'confirmed')).toBe(true);
    expect(result.receipts[4].state).toBe('unknown');
    expect(originalRead).toHaveBeenCalledTimes(5);
    expect(h.files.size).toBe(5);
  });

  it('cancels before server contact without dispatching output', async () => {
    const h = await request();
    const controller = new AbortController();
    controller.abort();
    const result = await writeReconciliationToObsidian({ ...h.input, signal: controller.signal });
    expect(result).toMatchObject({ status: 'cancelled', failureCode: 'cancelled' });
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('cancels future calls after a write while preserving prior confirmed files', async () => {
    const h = await request();
    const controller = new AbortController();
    let writes = 0;
    vi.mocked(h.client.putBinaryFileIfAbsent).mockImplementation(async (path, bytes) => {
      h.files.set(path, bytes.slice());
      if (++writes === 2) controller.abort();
    });
    const result = await writeReconciliationToObsidian({ ...h.input, signal: controller.signal });
    expect(result).toMatchObject({ status: 'partial', failureCode: 'cancelled' });
    expect(result.receipts[0].state).toBe('confirmed');
    expect(result.receipts[1].state).toBe('unknown');
    expect(h.client.putBinaryFileIfAbsent).toHaveBeenCalledTimes(2);
    expect(h.client.getBinaryFileBounded).toHaveBeenCalledOnce();
    expect(h.files.size).toBe(2);
  });

  it('pins paths, settings, manifests and owned bytes before the first await', async () => {
    const h = await request();
    const originals = h.input.delivery.artifacts.map(value => value.bytes.slice());
    vi.mocked(h.client.getServerVersions).mockImplementation(async () => {
      h.input.settings.obsidianUrl = `https://${PRIVATE}.invalid`;
      h.input.settings.obsidianApiKey = 'changed';
      h.input.settings.vaultPath = '../changed';
      h.input.operationAt = '2030-01-01T00:00:00.000Z';
      h.input.attemptId = '../changed';
      for (const value of h.input.delivery.artifacts) value.bytes.fill(0);
      h.input.delivery.manifest.warnings.push(PRIVATE);
      return { self: '5.5.0', obsidian: '1.14.4' };
    });
    const result = await writeReconciliationToObsidian(h.input);
    expect(result.status).toBe('confirmed');
    expect(h.factory).toHaveBeenCalledWith('http://127.0.0.1:27123', PRIVATE);
    const writes = h.calls.filter(call => call.action === 'put');
    expect(writes.map(call => Array.from(call.bytes!))).toEqual(
      originals.map(bytes => Array.from(bytes))
    );
    expect(writes.every(call => call.path?.startsWith('AI/chatgpt/2026/10/25/'))).toBe(true);
    expectContentFree(result);
  });

  it.each([
    'foreign',
    'credentials',
    'empty-key',
    'traversal',
    'backslash',
    'device',
    'unknown-token',
  ] as const)('rejects %s settings before network contact', async kind => {
    const h = await request();
    if (kind === 'foreign') h.input.settings.obsidianUrl = 'https://example.test';
    if (kind === 'credentials') h.input.settings.obsidianUrl = 'http://u:p@127.0.0.1:27123';
    if (kind === 'empty-key') h.input.settings.obsidianApiKey = '   ';
    if (kind === 'traversal') h.input.settings.vaultPath = '../escape';
    if (kind === 'backslash') h.input.settings.vaultPath = 'AI\\escape';
    if (kind === 'device') h.input.settings.vaultPath = 'AI/CON';
    if (kind === 'unknown-token') h.input.settings.vaultPath = 'AI/{secret}';
    const result = await writeReconciliationToObsidian(h.input);
    expect(result).toMatchObject({ status: 'refused', failureCode: 'invalid-settings' });
    expect(h.factory).not.toHaveBeenCalled();
    expectContentFree(result);
  });

  it.each(['order', 'root', 'path', 'length', 'hash', 'key', 'manifest'] as const)(
    'rejects malformed %s delivery before network contact',
    async kind => {
      const h = await request();
      const value = h.input.delivery;
      if (kind === 'order') value.artifacts.reverse();
      if (kind === 'root') value.bundleId = 'a'.repeat(64);
      if (kind === 'path') value.artifacts[0].relativePath = '../escape' as never;
      if (kind === 'length') value.artifacts[0].byteLength += 1;
      if (kind === 'hash') value.artifacts[0].bytes[0] ^= 1;
      if (kind === 'key') value.conversationKey = PRIVATE;
      if (kind === 'manifest') value.manifest.warnings.push('changed');
      const result = await writeReconciliationToObsidian(h.input);
      expect(result).toMatchObject({ status: 'refused', failureCode: 'invalid-delivery' });
      expect(h.factory).not.toHaveBeenCalled();
      expectContentFree(result);
    }
  );

  it('rejects raised or exhausted byte ceilings without server contact', async () => {
    for (const limits of [
      { maxArtifactBytes: 1 },
      { maxBundleBytes: 1 },
      { maxManifestBytes: 1 },
      { requestTimeoutMs: OBSIDIAN_RECONCILIATION_HARD_LIMITS.requestTimeoutMs + 1 },
    ]) {
      const h = await request();
      const result = await writeReconciliationToObsidian({ ...h.input, limits });
      expect(result.status).toBe('refused');
      expect(h.factory).not.toHaveBeenCalled();
    }
  });

  it('sanitizes malformed, throwing or mutating hash implementations', async () => {
    for (const mode of ['invalid', 'throw', 'mutate']) {
      const h = await request();
      const result = await writeReconciliationToObsidian({
        ...h.input,
        sha256: async bytes => {
          if (mode === 'invalid') return PRIVATE;
          if (mode === 'throw') throw new Error(PRIVATE);
          const digest = await hash(bytes);
          bytes[0] ^= 1;
          return digest;
        },
      });
      expect(result).toMatchObject({
        status: 'refused',
        failureCode: `hash-${mode === 'throw' ? 'failed' : mode === 'invalid' ? 'invalid' : 'mutated'}`,
      });
      expect(h.factory).not.toHaveBeenCalled();
      expectContentFree(result);
    }
  });

  it('rejects accessors and hostile thrown Proxy values with fixed output', async () => {
    const h = await request();
    const getter = vi.fn(() => PRIVATE);
    Object.defineProperty(h.input.settings, 'obsidianApiKey', { get: getter });
    const result = await writeReconciliationToObsidian(h.input);
    expect(result.failureCode).toBe('invalid-settings');
    expect(getter).not.toHaveBeenCalled();
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(PRIVATE);
        },
      }
    );
    const hostile = new Proxy(h.input, {
      getPrototypeOf() {
        throw thrown;
      },
    });
    expect((await writeReconciliationToObsidian(hostile)).failureCode).toBe('invalid-input');
    expectContentFree(result);
  });

  it('rejects artifact index accessors without invoking them or contacting the server', async () => {
    const h = await request();
    const getter = vi.fn(() => h.input.delivery.artifacts[1]);
    Object.defineProperty(h.input.delivery.artifacts, '0', { get: getter });
    const result = await writeReconciliationToObsidian(h.input);
    expect(result.failureCode).toBe('invalid-delivery');
    expect(getter).not.toHaveBeenCalled();
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('rejects duplicate decoded root-manifest keys before any server request', async () => {
    const h = await request();
    const root = h.input.delivery.artifacts[h.input.delivery.artifacts.length - 1];
    const text = decoder.decode(root.bytes).replace('{', '{"status":"raw-only",');
    root.bytes = encoder.encode(text);
    root.byteLength = root.bytes.length;
    root.sha256 = await hash(root.bytes);
    h.input.delivery.bundleId = root.sha256;
    const result = await writeReconciliationToObsidian(h.input);
    expect(result.failureCode).toBe('invalid-delivery');
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('does not rewrite the root or official manifest JSON bytes', async () => {
    const h = await request();
    const expected = h.input.delivery.artifacts.map(value => decoder.decode(value.bytes));
    await writeReconciliationToObsidian(h.input);
    expect(
      h.calls.filter(call => call.action === 'put').map(call => decoder.decode(call.bytes))
    ).toEqual(expected);
  });
});
