import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/lib/sha256';

describe('shared SHA-256 helper', () => {
  it('hashes exact bytes and fails closed when Web Crypto is unavailable', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await expect(sha256Hex(bytes, webcrypto as Crypto)).resolves.toBe(
      createHash('sha256').update(bytes).digest('hex')
    );
    await expect(sha256Hex(bytes, {} as Crypto)).rejects.toThrow(
      'Web Crypto SHA-256 is unavailable.'
    );
  });
});
