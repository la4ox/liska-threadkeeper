import { describe, expect, it, vi } from 'vitest';
import {
  buildDerivedTextArtifact,
  buildDerivedTextOutputReceipt,
  buildDerivedTextOutputReceiptBytes,
  DerivedTextContractError,
  snapshotDerivedTextArtifact,
  snapshotDerivedTextOutputReceipt,
  verifyDerivedTextArtifact,
} from '../../src/lib/derived-text-presentation-contract';
import { sha256Hex } from '../../src/lib/sha256';

async function artifact() {
  return buildDerivedTextArtifact(
    'Русский 中文 🦊\n',
    { sourceCanonicalSha256: 'a'.repeat(64) },
    sha256Hex
  );
}

describe('derived text transport and provenance contract', () => {
  it('round-trips exact UTF-8 bytes and a deterministic LF receipt', async () => {
    const built = await artifact();
    const verified = await verifyDerivedTextArtifact(built, sha256Hex);
    expect(new TextDecoder().decode(verified!.bytes)).toBe('Русский 中文 🦊\n');
    const receipt = buildDerivedTextOutputReceipt(
      {
        source: 'chatgpt',
        captureId: 'capture-chatgpt-synthetic',
        conversationKey: 'b'.repeat(64),
      },
      built
    );
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
});
