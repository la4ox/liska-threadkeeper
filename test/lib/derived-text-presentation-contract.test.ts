import { describe, expect, it, vi } from 'vitest';
import {
  buildDerivedTextArtifact,
  buildDerivedTextOutputReceipt,
  buildDerivedTextOutputReceiptBytes,
  DerivedTextContractError,
  DERIVED_TEXT_MAX_BYTES,
  isDerivedTextArtifact,
  snapshotDerivedTextArtifact,
  snapshotDerivedTextOutputReceipt,
  verifyDerivedTextArtifact,
} from '../../src/lib/derived-text-presentation-contract';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/lib/sha256';

const provenance = { sourceCanonicalSha256: 'a'.repeat(64) };
const identity = {
  source: 'chatgpt' as const,
  captureId: 'capture-chatgpt-synthetic',
  conversationKey: 'b'.repeat(64),
};

async function artifact() {
  return buildDerivedTextArtifact('Русский 中文 🦊\n', provenance, sha256Hex);
}

describe('derived text transport and provenance contract', () => {
  it('round-trips exact UTF-8 bytes and a deterministic LF receipt', async () => {
    const built = await artifact();
    const verified = await verifyDerivedTextArtifact(built, sha256Hex);
    expect(new TextDecoder().decode(verified!.bytes)).toBe('Русский 中文 🦊\n');
    const receipt = buildDerivedTextOutputReceipt(identity, built);
    expect(snapshotDerivedTextOutputReceipt(receipt)).toEqual(receipt);
    const bytes = buildDerivedTextOutputReceiptBytes(receipt);
    expect(new TextDecoder().decode(bytes)).toBe(`${JSON.stringify(receipt)}\n`);
    expect(receipt.artifact).toMatchObject({
      kind: 'text',
      relativePath: 'index.txt',
      mediaType: 'text/plain',
      byteLength: built.byteLength,
      sha256: built.sha256,
      rendererVersion: 'liska-text/1',
    });
  });

  it.each(['', '\ufeffBOM\n', '\ud800x\udfff', '🦊\ud800'])(
    'preserves exact TextEncoder bytes for %j',
    async text => {
      const built = await buildDerivedTextArtifact(text, provenance, sha256Hex);
      const bytes = new TextEncoder().encode(text);
      expect(built).toMatchObject({
        byteLength: bytes.byteLength,
        bodyBase64: bytesToBase64(bytes),
        sha256: await sha256Hex(bytes),
      });
      const verified = await verifyDerivedTextArtifact(built, sha256Hex);
      expect(verified?.artifact).toEqual(built);
      expect(Array.from(verified!.bytes)).toEqual(Array.from(bytes));
    }
  );

  it.each([
    ['throwing', 'derived-text-hash-failed'],
    ['invalid', 'derived-text-invalid-hash'],
  ] as const)(
    'maps a %s hash to a stable build error and refuses verification',
    async (mode, code) => {
      const built = await artifact();
      const hash = vi.fn(async () => {
        if (mode === 'throwing') throw new Error('private hash provider detail');
        return 'A'.repeat(64);
      });
      await expect(buildDerivedTextArtifact('text', provenance, hash)).rejects.toEqual(
        new DerivedTextContractError(code)
      );
      await expect(verifyDerivedTextArtifact(built, hash)).resolves.toBeUndefined();
      expect(hash).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ['invalid leading byte', [0xff]],
    ['overlong encoding', [0xc0, 0x80]],
    ['encoded surrogate', [0xed, 0xa0, 0x80]],
    ['truncated multibyte character', [0xf0, 0x9f, 0xa6]],
  ] as const)('refuses %s even when byte length and SHA-256 agree', async (_label, values) => {
    const bytes = new Uint8Array(values);
    const built = {
      ...(await artifact()),
      byteLength: bytes.byteLength,
      bodyBase64: bytesToBase64(bytes),
      sha256: await sha256Hex(bytes),
    };
    expect(snapshotDerivedTextArtifact(built)).toEqual(built);
    const hash = vi.fn(sha256Hex);
    expect(await verifyDerivedTextArtifact(built, hash)).toBeUndefined();
    expect(hash).not.toHaveBeenCalled();
  });

  it.each([
    { schema: 'liska-derived-text/2' },
    { transport: 'staged' },
    { kind: 'html' },
    { relativePath: 'presentation/index.txt' },
    { mediaType: 'text/plain; charset=utf-8' },
    { rendererVersion: 'liska-text/2' },
    { byteLength: -1 },
    { byteLength: 1.5 },
    { byteLength: DERIVED_TEXT_MAX_BYTES + 1 },
    { sha256: 'A'.repeat(64) },
    { sourceCanonicalSha256: 'not-a-sha256' },
    { extra: true },
  ])('rejects unsupported artifact metadata: %j', async fields => {
    const built = { ...(await artifact()), ...fields };
    expect(snapshotDerivedTextArtifact(built)).toBeUndefined();
    expect(isDerivedTextArtifact(built)).toBe(false);
    const hash = vi.fn(sha256Hex);
    expect(await verifyDerivedTextArtifact(built, hash)).toBeUndefined();
    expect(hash).not.toHaveBeenCalled();
  });

  it('detaches provenance and verified bytes from an injected hash function', async () => {
    const source = { ...provenance };
    const built = await buildDerivedTextArtifact('text', source, async bytes => {
      source.sourceCanonicalSha256 = 'c'.repeat(64);
      const digest = await sha256Hex(bytes);
      bytes.fill(0);
      return digest;
    });
    expect(built.sourceCanonicalSha256).toBe(provenance.sourceCanonicalSha256);
    expect(built.bodyBase64).toBe('dGV4dA==');
    const verified = await verifyDerivedTextArtifact(built, async bytes => {
      built.bodyBase64 = 'bmV4dA==';
      const digest = await sha256Hex(bytes);
      bytes.fill(0);
      return digest;
    });
    expect(verified?.artifact.bodyBase64).toBe('dGV4dA==');
    expect(Array.from(verified!.bytes)).toEqual(Array.from(new TextEncoder().encode('text')));
  });

  it('rejects altered, noncanonical, and accessor-bearing artifacts without invoking hooks', async () => {
    const built = await artifact();
    expect(await verifyDerivedTextArtifact({ ...built, sha256: '0'.repeat(64) }, sha256Hex)).toBe(
      undefined
    );
    expect(snapshotDerivedTextArtifact({ ...built, bodyBase64: 'AB==', byteLength: 1 })).toBe(
      undefined
    );
    const getter = vi.fn();
    const hostile = Object.defineProperty({ ...built }, 'bodyBase64', {
      get: getter,
      enumerable: true,
    });
    expect(snapshotDerivedTextArtifact(hostile)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it('maps hostile provenance and identity traps to value-free errors', async () => {
    const trap = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('private trap');
        },
      }
    );
    await expect(
      buildDerivedTextArtifact('text', trap as { sourceCanonicalSha256: string }, sha256Hex)
    ).rejects.toMatchObject({ code: 'derived-text-invalid-input' });
    expect(() =>
      buildDerivedTextOutputReceipt(
        trap as { source: 'chatgpt'; captureId: string; conversationKey: string },
        {} as never
      )
    ).toThrow(DerivedTextContractError);
  });

  it('rejects invalid public builder input and trap-bearing artifact envelopes', async () => {
    await expect(
      buildDerivedTextArtifact('text', { sourceCanonicalSha256: 'not-a-sha256' }, sha256Hex)
    ).rejects.toEqual(new DerivedTextContractError('derived-text-invalid-input'));

    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private artifact trap');
        },
      }
    );
    expect(snapshotDerivedTextArtifact(trap)).toBeUndefined();
  });
});

describe('derived text output receipt validation', () => {
  it.each([
    { schema: 'liska-derived-text-output-receipt/2' },
    { source: 'claude' },
    { source: 'deepseek' },
    { captureId: 'capture-deepseek-synthetic' },
    { captureId: 'capture-chatgpt-' },
    { conversationKey: 'provider-conversation-id' },
    { sourceCanonicalSha256: 'A'.repeat(64) },
    { extra: true },
  ])('rejects invalid receipt identity or envelope: %j', async fields => {
    const receipt = { ...buildDerivedTextOutputReceipt(identity, await artifact()), ...fields };
    expect(snapshotDerivedTextOutputReceipt(receipt)).toBeUndefined();
    expect(() => buildDerivedTextOutputReceiptBytes(receipt)).toThrow(
      new DerivedTextContractError('derived-text-receipt-invalid-input')
    );
  });

  it.each([
    { kind: 'html' },
    { relativePath: 'index.html' },
    { mediaType: 'application/json' },
    { byteLength: Number.NaN },
    { sha256: 'invalid' },
    { rendererVersion: 'liska-text/2' },
    { bodyBase64: 'dGV4dA==' },
  ])('rejects invalid or transport-bearing receipt descriptors: %j', async fields => {
    const receipt = buildDerivedTextOutputReceipt(identity, await artifact());
    const changed = { ...receipt, artifact: { ...receipt.artifact, ...fields } };
    expect(snapshotDerivedTextOutputReceipt(changed)).toBeUndefined();
    expect(() => buildDerivedTextOutputReceiptBytes(changed)).toThrow(
      new DerivedTextContractError('derived-text-receipt-invalid-input')
    );
  });

  it('refuses invalid builder identities and artifacts with a stable error', async () => {
    const built = await artifact();
    expect(() => buildDerivedTextOutputReceipt({ ...identity, source: 'deepseek' }, built)).toThrow(
      new DerivedTextContractError('derived-text-receipt-invalid-input')
    );
    expect(() =>
      buildDerivedTextOutputReceipt(identity, { ...built, relativePath: 'index.html' } as never)
    ).toThrow(new DerivedTextContractError('derived-text-receipt-invalid-input'));
  });

  it('detaches a null-prototype receipt and serializes in fixed order with LF', async () => {
    const receipt = buildDerivedTextOutputReceipt(identity, await artifact());
    const reordered = Object.assign(
      Object.create(null),
      Object.fromEntries(Object.entries(receipt).reverse()),
      { artifact: Object.fromEntries(Object.entries(receipt.artifact).reverse()) }
    );
    const snapshot = snapshotDerivedTextOutputReceipt(reordered)!;
    expect(snapshot).toEqual(receipt);
    expect(snapshot).not.toBe(reordered);
    expect(snapshot.artifact).not.toBe(reordered.artifact);
    expect(buildDerivedTextOutputReceiptBytes(reordered)).toEqual(
      buildDerivedTextOutputReceiptBytes(receipt)
    );
    reordered.artifact.sha256 = 'f'.repeat(64);
    expect(snapshot.artifact.sha256).toBe(receipt.artifact.sha256);
    expect(new TextDecoder().decode(buildDerivedTextOutputReceiptBytes(snapshot))).toBe(
      `${JSON.stringify(receipt)}\n`
    );
  });

  it('rejects a trap-bearing receipt envelope without leaking the trap', () => {
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private receipt trap');
        },
      }
    );
    expect(snapshotDerivedTextOutputReceipt(trap)).toBeUndefined();
  });
});
