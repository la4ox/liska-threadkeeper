import { describe, expect, it, vi } from 'vitest';
import { binaryAssetExtension } from '../../src/lib/binary-asset-contract';
import {
  isChatGptDestinationArchiveReceipt,
  snapshotChatGptDestinationArchiveReceipt,
  type ChatGptArchivedAssetReceipt,
  type ChatGptDestinationArchiveReceipt,
} from '../../src/lib/chatgpt-archive-receipt';

function asset(overrides: Partial<ChatGptArchivedAssetReceipt> = {}): ChatGptArchivedAssetReceipt {
  return {
    sha256: 'a'.repeat(64),
    relativePath: `assets/${'a'.repeat(64)}.pdf`,
    mediaType: 'application/pdf',
    byteLength: 123,
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}): ChatGptDestinationArchiveReceipt {
  return {
    destination: 'file',
    captureId: 'capture-chatgpt-safe_123',
    conversationKey: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64),
    archiveByteLengths: { raw: 1, manifest: 2, canonical: 3 },
    assets: [asset()],
    ...overrides,
  } as ChatGptDestinationArchiveReceipt;
}

describe('ChatGPT destination archive receipt', () => {
  it.each(['file', 'obsidian'] as const)(
    'snapshots exact own data for %s without retaining aliases',
    destination => {
      const input = receipt({ destination });
      const snapshot = snapshotChatGptDestinationArchiveReceipt(input);

      expect(snapshot).toEqual(input);
      expect(snapshot).not.toBe(input);
      expect(snapshot?.assets).not.toBe(input.assets);
      expect(snapshot?.assets[0]).not.toBe(input.assets[0]);
      expect(snapshot?.archiveByteLengths).not.toBe(input.archiveByteLengths);
      input.archiveByteLengths.raw = 999;
      input.assets[0].byteLength = 999;
      input.assets.length = 0;
      expect(snapshot?.assets).toEqual([asset()]);
      expect(snapshot?.archiveByteLengths).toEqual({ raw: 1, manifest: 2, canonical: 3 });
      expect(isChatGptDestinationArchiveReceipt(snapshot)).toBe(true);
    }
  );

  it('accepts empty assets, zero bytes, safe integer byte lengths, frozen and null-prototype data', () => {
    expect(snapshotChatGptDestinationArchiveReceipt(receipt({ assets: [] }))?.assets).toEqual([]);
    const input = receipt({
      assets: [Object.freeze(Object.assign(Object.create(null), asset({ byteLength: 0 })))],
    });
    Object.freeze(input.assets);
    expect(snapshotChatGptDestinationArchiveReceipt(Object.freeze(input))).toEqual(input);
    const nullPrototype = Object.assign(
      Object.create(null),
      receipt({ assets: [asset({ byteLength: Number.MAX_SAFE_INTEGER })] })
    );
    expect(snapshotChatGptDestinationArchiveReceipt(nullPrototype)).toEqual(nullPrototype);
  });

  it.each([
    'application/json',
    'application/octet-stream',
    'application/pdf',
    'application/rtf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'image/avif',
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/plain',
    'video/mp4',
    'video/webm',
  ])('uses the established inert binary allowlist for %s', mediaType => {
    const relativePath = `assets/${'a'.repeat(64)}.${binaryAssetExtension(mediaType)}`;
    expect(
      snapshotChatGptDestinationArchiveReceipt(
        receipt({ assets: [asset({ mediaType, relativePath })] })
      )
    ).toBeDefined();
  });

  it.each([null, undefined, false, 1, 'receipt', [], new Date(), new Map(), () => receipt()])(
    'rejects non-record input %j',
    input => {
      expect(snapshotChatGptDestinationArchiveReceipt(input)).toBeUndefined();
      expect(isChatGptDestinationArchiveReceipt(input)).toBe(false);
    }
  );

  it.each([
    { destination: 'clipboard' },
    { destination: 'https://example.test' },
    { captureId: 'capture-deepseek-safe' },
    { captureId: 'capture-safe' },
    { captureId: 'capture-chatgpt-' },
    { captureId: 'capture-chatgpt-../private' },
    { captureId: 'capture-chatgpt-name\\file' },
    { captureId: `capture-chatgpt-${'a'.repeat(241)}` },
    { captureId: 'capture-chatgpt-safe\n' },
    { conversationKey: 'provider-conversation-id' },
    { conversationKey: 'C'.repeat(64) },
    { conversationKey: 'c'.repeat(63) },
    { conversationKey: `${'c'.repeat(64)}\n` },
    { manifestSha256: 'D'.repeat(64) },
    { manifestSha256: 'd'.repeat(65) },
    { manifestSha256: `${'d'.repeat(64)}\n` },
    { manifestSha256: null },
    { archiveByteLengths: undefined },
    { archiveByteLengths: null },
    { archiveByteLengths: [] },
    { assets: {} },
    { assets: null },
    { providerTitle: 'private title' },
  ])('rejects malformed receipt fields %j', fields => {
    expect(snapshotChatGptDestinationArchiveReceipt(receipt(fields))).toBeUndefined();
  });

  it('accepts the exact capture ID length boundary', () => {
    expect(
      snapshotChatGptDestinationArchiveReceipt(
        receipt({ captureId: `capture-chatgpt-${'a'.repeat(240)}` })
      )
    ).toBeDefined();
  });

  it.each(['raw', 'manifest', 'canonical'] as const)(
    'rejects malformed %s archive lengths and nested non-data objects',
    key => {
      for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
        const archiveByteLengths = { raw: 1, manifest: 2, canonical: 3, [key]: value };
        expect(
          snapshotChatGptDestinationArchiveReceipt(receipt({ archiveByteLengths }))
        ).toBeUndefined();
      }
      const getter = vi.fn(() => 1);
      const missing = { raw: 1, manifest: 2, canonical: 3 };
      Reflect.deleteProperty(missing, key);
      const accessor = Object.defineProperty({ raw: 1, manifest: 2, canonical: 3 }, key, {
        get: getter,
      });
      const hidden = Object.defineProperty({ raw: 1, manifest: 2, canonical: 3 }, key, {
        enumerable: false,
      });
      for (const archiveByteLengths of [
        missing,
        accessor,
        hidden,
        { raw: 1, manifest: 2, canonical: 3, providerId: 'private' },
        Object.assign(Object.create({ private: true }), { raw: 1, manifest: 2, canonical: 3 }),
        Object.assign({ raw: 1, manifest: 2, canonical: 3 }, { [Symbol('private')]: 1 }),
      ]) {
        expect(
          snapshotChatGptDestinationArchiveReceipt(receipt({ archiveByteLengths }))
        ).toBeUndefined();
      }
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it('accepts detached frozen/null-prototype archive lengths at exact integer boundaries', () => {
    const archiveByteLengths = Object.freeze(
      Object.assign(Object.create(null), {
        raw: 0,
        manifest: Number.MAX_SAFE_INTEGER,
        canonical: 0,
      })
    );
    const snapshot = snapshotChatGptDestinationArchiveReceipt(receipt({ archiveByteLengths }));
    expect(snapshot?.archiveByteLengths).toEqual(archiveByteLengths);
    expect(snapshot?.archiveByteLengths).not.toBe(archiveByteLengths);
  });

  it.each([
    { sha256: 'A'.repeat(64) },
    { sha256: 'a'.repeat(63) },
    { sha256: undefined },
    { byteLength: -1 },
    { byteLength: 1.5 },
    { byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { byteLength: Infinity },
    { byteLength: NaN },
    { byteLength: '123' },
    { mediaType: 'APPLICATION/PDF' },
    { mediaType: 'application/pdf ' },
    { mediaType: 'image/svg+xml' },
    { mediaType: 'text/html' },
    { mediaType: 'application/javascript' },
    { mediaType: 'application/vnd.ms-word.document.macroEnabled.12' },
    { mediaType: '__proto__' },
    { relativePath: `assets/${'b'.repeat(64)}.pdf` },
    { relativePath: `assets/${'a'.repeat(64)}.png` },
    { relativePath: `assets/${'a'.repeat(64)}.PDF` },
    { relativePath: `../assets/${'a'.repeat(64)}.pdf` },
    { relativePath: `assets\\${'a'.repeat(64)}.pdf` },
    { relativePath: `assets/${'a'.repeat(64)}.pdf?secret=1` },
    { relativePath: 'assets/provider-name.pdf' },
    { fileName: 'private-name.pdf' },
    { status: 'failed' },
  ])('rejects malformed asset data %j', fields => {
    expect(
      snapshotChatGptDestinationArchiveReceipt(receipt({ assets: [{ ...asset(), ...fields }] }))
    ).toBeUndefined();
  });

  it('rejects missing, inherited, non-enumerable, or symbol properties and custom prototypes', () => {
    const missing = receipt();
    Reflect.deleteProperty(missing, 'manifestSha256');
    const hidden = Object.defineProperty(receipt(), 'manifestSha256', { enumerable: false });
    const extraHidden = Object.defineProperty(receipt(), 'private', { value: 'secret' });
    const extraSymbol = Object.assign(receipt(), { [Symbol('private')]: 'secret' });
    const inherited = Object.assign(Object.create({ manifestSha256: 'd'.repeat(64) }), missing);
    const inheritedAsset = Object.assign(Object.create({ providerName: 'secret' }), asset());
    for (const input of [
      missing,
      hidden,
      extraHidden,
      extraSymbol,
      inherited,
      receipt({ assets: [inheritedAsset] }),
    ]) {
      expect(snapshotChatGptDestinationArchiveReceipt(input)).toBeUndefined();
    }
  });

  it('rejects accessor fields at every level without invoking them', () => {
    const getter = vi.fn(() => 'secret');
    const outer = Object.defineProperty(receipt(), 'captureId', { get: getter });
    const inner = Object.defineProperty(asset(), 'relativePath', { get: getter });
    const assets = [asset()];
    Object.defineProperty(assets, '0', { get: getter });

    for (const input of [outer, receipt({ assets: [inner] }), receipt({ assets })]) {
      expect(snapshotChatGptDestinationArchiveReceipt(input)).toBeUndefined();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects duplicate canonical targets but permits identical bytes at distinct allowed paths', () => {
    const text = asset({ mediaType: 'text/plain', relativePath: `assets/${'a'.repeat(64)}.txt` });
    expect(
      snapshotChatGptDestinationArchiveReceipt(receipt({ assets: [asset(), asset()] }))
    ).toBeUndefined();
    expect(snapshotChatGptDestinationArchiveReceipt(receipt({ assets: [asset(), text] }))).toEqual(
      receipt({ assets: [asset(), text] })
    );
  });

  it('rejects sparse, extended, symbol-keyed, and custom-prototype arrays', () => {
    const sparse = [asset(), asset(), asset()];
    Reflect.deleteProperty(sparse, '1');
    const extra = Object.assign([asset()], { private: 'secret' });
    const symbol = Object.assign([asset()], { [Symbol('private')]: 'secret' });
    const custom = Object.setPrototypeOf([asset()], Object.create(Array.prototype));
    for (const assets of [sparse, extra, symbol, custom]) {
      expect(snapshotChatGptDestinationArchiveReceipt(receipt({ assets }))).toBeUndefined();
    }
  });

  it('fails closed on objects whose reflection throws', () => {
    const revoked = Proxy.revocable(receipt(), {});
    revoked.revoke();
    expect(snapshotChatGptDestinationArchiveReceipt(revoked.proxy)).toBeUndefined();
  });
});
