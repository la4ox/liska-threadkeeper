// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DERIVED_HTML_MAX_BYTES,
  DERIVED_HTML_RECEIPT_RELATIVE_PATH,
  DERIVED_HTML_RELATIVE_PATH,
  DERIVED_HTML_RENDERER_VERSION,
  DERIVED_HTML_SCHEMA,
  DERIVED_OUTPUT_RECEIPT_SCHEMA,
  DerivedPresentationError,
  buildDerivedHtmlArtifact,
  buildDerivedOutputReceipt,
  buildDerivedOutputReceiptBytes,
  isDerivedHtmlArtifact,
  isDerivedOutputReceipt,
  snapshotDerivedHtmlArtifact,
  snapshotDerivedOutputReceipt,
  verifyDerivedHtmlArtifact,
  type DerivedHtmlArtifact,
  type DerivedOutputReceipt,
  type DerivedOutputIdentity,
} from '../../src/lib/derived-presentation-contract';

const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const provenance = { sourceCanonicalSha256: 'a'.repeat(64), assetBindingSha256: 'b'.repeat(64) };
const identity: DerivedOutputIdentity = {
  source: 'chatgpt',
  captureId: 'capture-chatgpt-safe_1',
  conversationKey: 'c'.repeat(64),
};

function artifact(overrides: Record<string, unknown> = {}): DerivedHtmlArtifact {
  return {
    schema: DERIVED_HTML_SCHEMA,
    transport: 'inline',
    kind: 'html',
    relativePath: DERIVED_HTML_RELATIVE_PATH,
    mediaType: 'text/html',
    byteLength: 1,
    sha256: createHash('sha256').update('x').digest('hex'),
    rendererVersion: DERIVED_HTML_RENDERER_VERSION,
    ...provenance,
    bodyBase64: 'eA==',
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}): DerivedOutputReceipt {
  return { ...buildDerivedOutputReceipt(identity, artifact()), ...overrides };
}

function withAccessor(value: object, key: string, getter = vi.fn(() => 'private')) {
  const changed = { ...value };
  Object.defineProperty(changed, key, { enumerable: true, get: getter });
  return { changed, getter };
}

describe('derived HTML artifact', () => {
  it('pins separate schemas, renderer, capture-root HTML and presentation receipt paths', () => {
    expect(DERIVED_HTML_SCHEMA).toBe('liska-derived-html/1');
    expect(DERIVED_OUTPUT_RECEIPT_SCHEMA).toBe('liska-derived-output-receipt/1');
    expect(DERIVED_HTML_RENDERER_VERSION).toBe('liska-html/1');
    expect(DERIVED_HTML_RELATIVE_PATH).toBe('index.html');
    expect(DERIVED_HTML_RECEIPT_RELATIVE_PATH).toBe('presentation/liska-html-1.receipt.json');
    expect(DERIVED_HTML_MAX_BYTES).toBe(32 * 1024 * 1024);
  });

  it.each([
    '',
    '<p>hello</p>',
    'Русский 中文 日本語 🦊♥',
    '\ufeffBOM',
    '\ud800x\udfff',
    '🦊\ud800',
  ])('round-trips exact TextEncoder UTF-8 bytes: %j', async html => {
    const output = await buildDerivedHtmlArtifact(html, provenance, hash);
    const bytes = new TextEncoder().encode(html);
    expect(output.bodyBase64).toBe(Buffer.from(bytes).toString('base64'));
    expect(output.byteLength).toBe(bytes.byteLength);
    expect(output.sha256).toBe(await hash(bytes));
    expect(output).toMatchObject(provenance);
    expect(isDerivedHtmlArtifact(output)).toBe(true);
    const verified = await verifyDerivedHtmlArtifact(output, hash);
    expect(verified?.bytes).toEqual(bytes);
    expect(verified?.artifact).toEqual(output);
    expect(verified?.artifact).not.toBe(output);
  });

  it('accepts an exact 32 MiB body and shape-validates it without decoding', async () => {
    const output = await buildDerivedHtmlArtifact(
      `${'x'.repeat(DERIVED_HTML_MAX_BYTES - 4)}🦊`,
      provenance,
      hash
    );
    expect(output.byteLength).toBe(DERIVED_HTML_MAX_BYTES);
    const decoder = vi.spyOn(globalThis, 'atob').mockImplementation(() => {
      throw new Error('shape must not decode');
    });
    try {
      expect(snapshotDerivedHtmlArtifact(output)).toEqual(output);
    } finally {
      decoder.mockRestore();
    }
  });

  it.each([
    () => 'x'.repeat(DERIVED_HTML_MAX_BYTES + 1),
    () => `${'x'.repeat(DERIVED_HTML_MAX_BYTES - 1)}é`,
    () => `${'x'.repeat(DERIVED_HTML_MAX_BYTES - 2)}\ud800`,
    () => '中'.repeat(Math.ceil(DERIVED_HTML_MAX_BYTES / 3)),
  ])('refuses overmax by exact UTF-8 length before encoding, hashing or base64', async makeHtml => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const sha256 = vi.fn(hash);
    const base64 = vi.spyOn(globalThis, 'btoa');
    try {
      await expect(buildDerivedHtmlArtifact(makeHtml(), provenance, sha256)).rejects.toMatchObject({
        code: 'derived-html-too-large',
        message: 'derived-html-too-large',
      });
      expect(encode).not.toHaveBeenCalled();
      expect(sha256).not.toHaveBeenCalled();
      expect(base64).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
      base64.mockRestore();
    }
  });

  it.each(['eA', 'eA===', 'eA==\n', 'eA-_', 'eA =', 'eA==eA==', 'éA==', 'eB==', 'eA/=', '=AAA'])(
    'rejects malformed or noncanonical base64 without decode: %j',
    bodyBase64 => expect(snapshotDerivedHtmlArtifact(artifact({ bodyBase64 }))).toBeUndefined()
  );

  it.each([
    { schema: 'liska-derived-html/2' },
    { transport: 'staged' },
    { stageId: 'private' },
    { kind: 'canonical' },
    { relativePath: 'presentation/index.html' },
    { relativePath: '../index.html' },
    { mediaType: 'text/html; charset=utf-8' },
    { mediaType: 'TEXT/HTML' },
    { rendererVersion: 'liska-html/2' },
    { byteLength: -1 },
    { byteLength: 0 },
    { byteLength: 1.5 },
    { byteLength: Number.NaN },
    { byteLength: Number.POSITIVE_INFINITY },
    { byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { byteLength: DERIVED_HTML_MAX_BYTES + 1 },
    { byteLength: '1' },
    { sha256: 'A'.repeat(64) },
    { sha256: `${'a'.repeat(64)}\n` },
    { sha256: 'a'.repeat(63) },
    { sourceCanonicalSha256: 'A'.repeat(64) },
    { sourceCanonicalSha256: `${'a'.repeat(64)}\n` },
    { assetBindingSha256: 'B'.repeat(64) },
    { assetBindingSha256: `${'b'.repeat(64)}\n` },
    { assetBindingSha256: undefined },
    { assetBindingSha256: '' },
    { extra: true },
  ])('rejects invalid artifact field: %j', fields => {
    expect(snapshotDerivedHtmlArtifact(artifact(fields))).toBeUndefined();
  });

  it('accepts no bindings only as explicit null and plain null-prototype records', () => {
    const output = artifact({ assetBindingSha256: null });
    expect(snapshotDerivedHtmlArtifact(Object.assign(Object.create(null), output))).toEqual(output);
  });

  it('requires every own enumerable data field without invoking getters', () => {
    for (const key of Object.keys(artifact())) {
      const missing: Record<string, unknown> = { ...artifact() };
      delete missing[key];
      expect(snapshotDerivedHtmlArtifact(missing)).toBeUndefined();
      const { changed, getter } = withAccessor(artifact(), key);
      expect(snapshotDerivedHtmlArtifact(changed)).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
      expect(
        snapshotDerivedHtmlArtifact(Object.defineProperty(artifact(), key, { enumerable: false }))
      ).toBeUndefined();
    }
  });

  it.each([
    null,
    undefined,
    'private',
    [],
    new Array(2),
    Object.assign([], artifact()),
    Object.assign(Object.create({ inherited: true }), artifact()),
    { ...artifact(), [Symbol('private')]: true },
    new Proxy(artifact(), {
      getPrototypeOf: () => {
        throw new Error('private');
      },
    }),
  ])('fails closed on non-plain artifacts', value => {
    expect(snapshotDerivedHtmlArtifact(value)).toBeUndefined();
    expect(isDerivedHtmlArtifact(value)).toBe(false);
  });

  it('detaches the builder provenance and snapshots before awaiting injected hashes', async () => {
    const input = { ...provenance };
    const output = await buildDerivedHtmlArtifact('x', input, async bytes => {
      input.sourceCanonicalSha256 = 'd'.repeat(64);
      const result = await hash(bytes);
      bytes.fill(0);
      return result;
    });
    expect(output.sourceCanonicalSha256).toBe(provenance.sourceCanonicalSha256);
    expect(output.bodyBase64).toBe('eA==');
    const verification = verifyDerivedHtmlArtifact(output, async bytes => {
      output.bodyBase64 = 'eQ==';
      const result = await hash(bytes);
      bytes.fill(0);
      return result;
    });
    const verified = await verification;
    expect(verified?.artifact.bodyBase64).toBe('eA==');
    expect(verified?.bytes).toEqual(new Uint8Array([120]));
    verified!.bytes[0] = 1;
    expect(verified?.artifact.bodyBase64).toBe('eA==');
  });

  it('verifies exact length, SHA and fatal UTF-8, including overlong/surrogate encodings', async () => {
    expect(
      await verifyDerivedHtmlArtifact(artifact({ sha256: 'f'.repeat(64) }), hash)
    ).toBeUndefined();
    expect(await verifyDerivedHtmlArtifact(artifact({ byteLength: 2 }), hash)).toBeUndefined();
    for (const bytes of [[0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0xa6]]) {
      const raw = new Uint8Array(bytes);
      const invalidUtf8 = artifact({
        byteLength: raw.length,
        sha256: await hash(raw),
        bodyBase64: Buffer.from(raw).toString('base64'),
      });
      expect(snapshotDerivedHtmlArtifact(invalidUtf8)).toEqual(invalidUtf8);
      expect(await verifyDerivedHtmlArtifact(invalidUtf8, hash)).toBeUndefined();
    }
  });

  it('fails closed on hash/decoder failures without leaking input or native errors', async () => {
    const secretFailure = async () => {
      throw new Error('private-url-or-content');
    };
    await expect(
      buildDerivedHtmlArtifact('private content', provenance, secretFailure)
    ).rejects.toEqual(new DerivedPresentationError('derived-html-hash-failed'));
    await expect(
      buildDerivedHtmlArtifact('x', provenance, async () => 'A'.repeat(64))
    ).rejects.toEqual(new DerivedPresentationError('derived-html-invalid-hash'));
    expect(await verifyDerivedHtmlArtifact(artifact(), secretFailure)).toBeUndefined();
    expect(await verifyDerivedHtmlArtifact(artifact(), async () => 'bad')).toBeUndefined();
    const decode = vi.spyOn(globalThis, 'atob').mockImplementation(() => {
      throw new Error('private');
    });
    try {
      expect(await verifyDerivedHtmlArtifact(artifact(), hash)).toBeUndefined();
    } finally {
      decode.mockRestore();
    }
  });

  it('rejects malformed builder input with stable codes and never reads provenance getters', async () => {
    const { changed, getter } = withAccessor(provenance, 'sourceCanonicalSha256');
    await expect(buildDerivedHtmlArtifact('x', changed as typeof provenance, hash)).rejects.toEqual(
      new DerivedPresentationError('derived-html-invalid-input')
    );
    expect(getter).not.toHaveBeenCalled();
    await expect(
      buildDerivedHtmlArtifact(3 as unknown as string, provenance, hash)
    ).rejects.toEqual(new DerivedPresentationError('derived-html-invalid-input'));
    await expect(buildDerivedHtmlArtifact('x', { ...provenance, secret: 1 }, hash)).rejects.toEqual(
      new DerivedPresentationError('derived-html-invalid-input')
    );
  });
});

describe('derived output receipt', () => {
  it.each(['chatgpt', 'deepseek'] as const)(
    'binds %s identity, source hashes, and only an HTML descriptor',
    source => {
      const output = buildDerivedOutputReceipt(
        { ...identity, source, captureId: `capture-${source}-safe` },
        artifact()
      );
      expect(output).toEqual({
        schema: DERIVED_OUTPUT_RECEIPT_SCHEMA,
        source,
        captureId: `capture-${source}-safe`,
        conversationKey: identity.conversationKey,
        ...provenance,
        artifact: {
          kind: 'html',
          relativePath: 'index.html',
          mediaType: 'text/html',
          byteLength: 1,
          sha256: artifact().sha256,
          rendererVersion: 'liska-html/1',
        },
      });
      expect(isDerivedOutputReceipt(output)).toBe(true);
    }
  );

  it.each([
    { schema: 'liska-derived-output-receipt/2' },
    { source: 'claude' },
    { source: 'deepseek' },
    { captureId: 'capture-deepseek-safe' },
    { captureId: 'capture-chatgpt-../secret' },
    { captureId: 'capture-chatgpt-_unsafe' },
    { captureId: 'capture-chatgpt-' },
    { captureId: `capture-chatgpt-${'a'.repeat(241)}` },
    { captureId: 'capture-chatgpt-a\n' },
    { conversationKey: 'C'.repeat(64) },
    { conversationKey: 'provider-conversation-id' },
    { sourceCanonicalSha256: 'A'.repeat(64) },
    { assetBindingSha256: undefined },
    { artifact: artifact() },
  ])('rejects invalid receipt field: %j', fields => {
    expect(snapshotDerivedOutputReceipt(receipt(fields))).toBeUndefined();
  });

  it.each([
    'destination',
    'absolutePath',
    'providerId',
    'conversationId',
    'title',
    'url',
    'timestamp',
    'content',
    'bodyBase64',
    'assets',
  ])('rejects privacy field %s at either receipt or descriptor level', key => {
    expect(snapshotDerivedOutputReceipt(receipt({ [key]: 'private' }))).toBeUndefined();
    const original = receipt();
    expect(
      snapshotDerivedOutputReceipt({
        ...original,
        artifact: { ...original.artifact, [key]: 'private' },
      })
    ).toBeUndefined();
  });

  it('strictly snapshots all nested fields without getters, symbols, prototypes or sparse arrays', () => {
    const output = receipt();
    for (const key of Object.keys(output)) {
      const { changed, getter } = withAccessor(output, key);
      expect(snapshotDerivedOutputReceipt(changed)).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
      const missing: Record<string, unknown> = { ...output };
      delete missing[key];
      expect(snapshotDerivedOutputReceipt(missing)).toBeUndefined();
    }
    for (const key of Object.keys(output.artifact)) {
      const { changed, getter } = withAccessor(output.artifact, key);
      expect(snapshotDerivedOutputReceipt({ ...output, artifact: changed })).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
      const missing: Record<string, unknown> = { ...output.artifact };
      delete missing[key];
      expect(snapshotDerivedOutputReceipt({ ...output, artifact: missing })).toBeUndefined();
    }
    for (const bad of [
      new Array(3),
      Object.assign(Object.create({ inherited: true }), output.artifact),
      { ...output.artifact, [Symbol('private')]: true },
      Object.defineProperty({ ...output.artifact }, 'sha256', { enumerable: false }),
    ])
      expect(snapshotDerivedOutputReceipt({ ...output, artifact: bad })).toBeUndefined();
    expect(snapshotDerivedOutputReceipt({ ...output, [Symbol('private')]: true })).toBeUndefined();
    expect(
      snapshotDerivedOutputReceipt(Object.assign(Object.create({ private: true }), output))
    ).toBeUndefined();
    expect(snapshotDerivedOutputReceipt(new Array(2))).toBeUndefined();
  });

  it('detaches nested descriptors and emits deterministic receipt UTF-8 JSON with LF', () => {
    const input = receipt();
    const snapshot = snapshotDerivedOutputReceipt(input)!;
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    reordered.artifact = Object.fromEntries(Object.entries(input.artifact).reverse());
    const bytes = buildDerivedOutputReceiptBytes(input);
    expect(buildDerivedOutputReceiptBytes(reordered)).toEqual(bytes);
    expect(new TextDecoder().decode(bytes)).toBe(`${JSON.stringify(snapshot)}\n`);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(snapshot);
    input.artifact.sha256 = 'd'.repeat(64);
    input.sourceCanonicalSha256 = 'e'.repeat(64);
    expect(snapshot.artifact.sha256).toBe(artifact().sha256);
    expect(snapshot.sourceCanonicalSha256).toBe(provenance.sourceCanonicalSha256);
    bytes.fill(0);
    expect(buildDerivedOutputReceiptBytes(snapshot)[0]).toBe('{'.charCodeAt(0));
  });

  it('preserves explicit no-bindings null and capture suffix bounds for both sources', () => {
    for (const [source, maxSuffix] of [
      ['chatgpt', 240],
      ['deepseek', 236],
    ] as const) {
      const output = buildDerivedOutputReceipt(
        { ...identity, source, captureId: `capture-${source}-${'a'.repeat(maxSuffix)}` },
        artifact({ assetBindingSha256: null })
      );
      expect(snapshotDerivedOutputReceipt(output)?.assetBindingSha256).toBeNull();
      expect(
        snapshotDerivedOutputReceipt({ ...output, captureId: `${output.captureId}a` })
      ).toBeUndefined();
    }
  });

  it('uses fixed fail-closed builder errors on invalid identity, artifact or receipt', () => {
    expect(() =>
      buildDerivedOutputReceipt({ ...identity, source: 'deepseek' }, artifact())
    ).toThrow(new DerivedPresentationError('derived-receipt-invalid-input'));
    expect(() => buildDerivedOutputReceipt(identity, artifact({ sha256: 'private' }))).toThrow(
      new DerivedPresentationError('derived-receipt-invalid-input')
    );
    expect(() => buildDerivedOutputReceiptBytes({ ...receipt(), secret: 'private' })).toThrow(
      new DerivedPresentationError('derived-receipt-invalid-input')
    );
    const { changed, getter } = withAccessor(identity, 'captureId');
    expect(() =>
      buildDerivedOutputReceipt(changed as unknown as DerivedOutputIdentity, artifact())
    ).toThrow(new DerivedPresentationError('derived-receipt-invalid-input'));
    expect(getter).not.toHaveBeenCalled();
  });
  it('does not leak native receipt encoding failures', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => {
      throw new Error('private native detail');
    });
    try {
      expect(() => buildDerivedOutputReceiptBytes(receipt())).toThrow(
        new DerivedPresentationError('derived-receipt-encoding-failed')
      );
    } finally {
      encode.mockRestore();
    }
  });
});
