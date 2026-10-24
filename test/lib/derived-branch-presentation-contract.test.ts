// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  HTML_BRANCH_MAX_ORDINAL,
  htmlBranchRelativePath,
  snapshotHtmlBranchTarget,
} from '../../src/archive/presentation/branch-paths';
import {
  DERIVED_BRANCH_HTML_MAX_ORDINAL,
  DERIVED_BRANCH_HTML_SCHEMA,
  DERIVED_BRANCH_OUTPUT_RECEIPT_SCHEMA,
  DerivedBranchPresentationError,
  buildDerivedBranchHtmlArtifact,
  buildDerivedBranchOutputReceipt,
  buildDerivedBranchOutputReceiptBytes,
  deriveBranchHtmlReceiptRelativePath,
  deriveBranchHtmlRelativePath,
  isDerivedBranchHtmlArtifact,
  isDerivedBranchOutputReceipt,
  matchDerivedBranchOutputReceipt,
  snapshotDerivedBranchHtmlArtifact,
  snapshotDerivedBranchHtmlTarget,
  snapshotDerivedBranchOutputReceipt,
  verifyDerivedBranchHtmlArtifact,
  type DerivedBranchHtmlArtifact,
  type DerivedBranchHtmlTarget,
} from '../../src/lib/derived-branch-presentation-contract';
import {
  DERIVED_HTML_MAX_BYTES,
  buildDerivedHtmlArtifact,
  buildDerivedOutputReceipt,
  snapshotDerivedHtmlArtifact,
  snapshotDerivedOutputReceipt,
  type DerivedOutputIdentity,
} from '../../src/lib/derived-presentation-contract';

const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const X_SHA256 = '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881';
const provenance = { sourceCanonicalSha256: 'a'.repeat(64), assetBindingSha256: 'b'.repeat(64) };
const identity: DerivedOutputIdentity = {
  source: 'chatgpt',
  captureId: 'capture-chatgpt-safe_1',
  conversationKey: 'c'.repeat(64),
};
const leaf = { role: 'leaf', ordinal: 1 } as const;
const index = { role: 'index' } as const;

function artifact(
  target: DerivedBranchHtmlTarget = leaf,
  overrides: Record<string, unknown> = {}
): DerivedBranchHtmlArtifact {
  return {
    schema: DERIVED_BRANCH_HTML_SCHEMA,
    transport: 'inline',
    ...target,
    kind: 'html',
    relativePath: deriveBranchHtmlRelativePath(target),
    mediaType: 'text/html',
    byteLength: 1,
    sha256: X_SHA256,
    rendererVersion: 'liska-html/1',
    ...provenance,
    bodyBase64: 'eA==',
    ...overrides,
  };
}

function receipt(target: DerivedBranchHtmlTarget = leaf, overrides: Record<string, unknown> = {}) {
  return { ...buildDerivedBranchOutputReceipt(identity, artifact(target)), ...overrides };
}

function withAccessor(value: object, key: string) {
  const getter = vi.fn(() => {
    throw new Error('private native detail');
  });
  return {
    changed: Object.defineProperty({ ...value }, key, { enumerable: true, get: getter }),
    getter,
  };
}

function hostileShapes(value: object): unknown[] {
  return [
    null,
    undefined,
    'private',
    [],
    new Array(3),
    Object.assign([], value),
    Object.assign(Object.create({ inherited: true }), value),
    { ...value, [Symbol('private')]: true },
    new Proxy(value, {
      getPrototypeOf: () => {
        throw new Error('private');
      },
    }),
  ];
}

describe('closed branch HTML names', () => {
  it('shares the exact low-level target snapshot and closed names with the archive renderer', () => {
    expect(snapshotDerivedBranchHtmlTarget).toBe(snapshotHtmlBranchTarget);
    expect(DERIVED_BRANCH_HTML_MAX_ORDINAL).toBe(HTML_BRANCH_MAX_ORDINAL);
    for (const target of [leaf, index, { role: 'leaf', ordinal: 999999 } as const])
      expect(deriveBranchHtmlRelativePath(target)).toBe(htmlBranchRelativePath(target));
    expect(htmlBranchRelativePath({ ...leaf, path: 'private.html' })).toBeUndefined();
    expect(
      snapshotHtmlBranchTarget(
        new Proxy(
          { ...index },
          {
            ownKeys: () => [Symbol('private')],
          }
        )
      )
    ).toBeUndefined();
  });

  it('pins independent schemas and the six-digit ordinal ceiling', () => {
    expect(DERIVED_BRANCH_HTML_SCHEMA).toBe('liska-derived-branch-html/1');
    expect(DERIVED_BRANCH_OUTPUT_RECEIPT_SCHEMA).toBe('liska-derived-branch-output-receipt/1');
    expect(DERIVED_BRANCH_HTML_MAX_ORDINAL).toBe(999999);
  });

  it.each([
    [leaf, 'branch-000001.html', 'presentation/liska-html-1.branch-000001.receipt.json'],
    [
      { role: 'leaf', ordinal: 42 } as const,
      'branch-000042.html',
      'presentation/liska-html-1.branch-000042.receipt.json',
    ],
    [
      { role: 'leaf', ordinal: 999999 } as const,
      'branch-999999.html',
      'presentation/liska-html-1.branch-999999.receipt.json',
    ],
    [index, 'branches.html', 'presentation/liska-html-1.branches.receipt.json'],
  ])('derives golden artifact and receipt paths from %j only', (target, htmlPath, receiptPath) => {
    expect(deriveBranchHtmlRelativePath(target)).toBe(htmlPath);
    expect(deriveBranchHtmlReceiptRelativePath(target)).toBe(receiptPath);
    expect(snapshotDerivedBranchHtmlTarget(target)).toEqual(target);
    expect(snapshotDerivedBranchHtmlTarget(target)).not.toBe(target);
  });

  it.each([
    ...hostileShapes(leaf),
    {},
    { role: 'branch', ordinal: 1 },
    { role: 'leaf' },
    { role: 'leaf', ordinal: 0 },
    { role: 'leaf', ordinal: -0 },
    { role: 'leaf', ordinal: -1 },
    { role: 'leaf', ordinal: 1000000 },
    { role: 'leaf', ordinal: 1.5 },
    { role: 'leaf', ordinal: Number.NaN },
    { role: 'leaf', ordinal: Number.POSITIVE_INFINITY },
    { role: 'leaf', ordinal: Number.MAX_SAFE_INTEGER + 1 },
    { role: 'leaf', ordinal: '000001' },
    { role: 'index', ordinal: undefined },
    { role: 'index', ordinal: 1 },
    { ...leaf, relativePath: 'branch-000001.html' },
    { ...index, relativePath: 'branches.html' },
  ])('rejects invalid targets without accepting a caller path', target => {
    expect(snapshotDerivedBranchHtmlTarget(target)).toBeUndefined();
    for (const derive of [deriveBranchHtmlRelativePath, deriveBranchHtmlReceiptRelativePath]) {
      expect(() => derive(target as DerivedBranchHtmlTarget)).toThrow(
        new DerivedBranchPresentationError('derived-branch-html-invalid-target')
      );
    }
  });

  it('rejects missing, inherited, accessor and non-enumerable role/ordinal without reads', () => {
    for (const target of [leaf, index]) {
      for (const key of Object.keys(target)) {
        const { changed, getter } = withAccessor(target, key);
        expect(snapshotDerivedBranchHtmlTarget(changed)).toBeUndefined();
        expect(getter).not.toHaveBeenCalled();
        expect(
          snapshotDerivedBranchHtmlTarget(
            Object.defineProperty({ ...target }, key, { enumerable: false })
          )
        ).toBeUndefined();
        expect(
          snapshotDerivedBranchHtmlTarget(Object.assign(Object.create(target), {}))
        ).toBeUndefined();
      }
    }
    expect(snapshotDerivedBranchHtmlTarget(Object.assign(Object.create(null), leaf))).toEqual(leaf);
  });
});

describe('branch HTML artifact', () => {
  it.each([leaf, index])('builds the exact closed golden artifact for %j', async target => {
    const result = await buildDerivedBranchHtmlArtifact('x', target, provenance, hash);
    expect(result).toEqual(artifact(target));
    expect(isDerivedBranchHtmlArtifact(result)).toBe(true);
    expect(snapshotDerivedBranchHtmlArtifact(result)).toEqual(result);
    expect(snapshotDerivedBranchHtmlArtifact(result)).not.toBe(result);
    expect((await verifyDerivedBranchHtmlArtifact(result, hash))?.bytes).toEqual(
      new Uint8Array([120])
    );
  });

  it.each(['', '<p>hello</p>', 'Русский 中文 日本語 🦊♥', '\ufeffBOM', '\ud800x\udfff'])(
    'preserves exact TextEncoder UTF-8 bytes: %j',
    async html => {
      const output = await buildDerivedBranchHtmlArtifact(html, leaf, provenance, hash);
      const bytes = new TextEncoder().encode(html);
      expect(output.bodyBase64).toBe(Buffer.from(bytes).toString('base64'));
      expect(output.byteLength).toBe(bytes.length);
      expect(output.sha256).toBe(await hash(bytes));
      const verified = await verifyDerivedBranchHtmlArtifact(output, hash);
      expect(verified?.bytes).toEqual(bytes);
      expect(verified?.artifact).toEqual(output);
    }
  );

  it('accepts max ordinal, explicit no-bindings null and plain null-prototype data', async () => {
    const output = await buildDerivedBranchHtmlArtifact(
      'x',
      { role: 'leaf', ordinal: 999999 },
      { ...provenance, assetBindingSha256: null },
      hash
    );
    expect(output.relativePath).toBe('branch-999999.html');
    expect(snapshotDerivedBranchHtmlArtifact(Object.assign(Object.create(null), output))).toEqual(
      output
    );
    expect(output.assetBindingSha256).toBeNull();
  });

  it.each([
    { schema: 'liska-derived-html/1' },
    { schema: 'liska-derived-branch-html/2' },
    { transport: 'staged' },
    { kind: 'canonical' },
    { relativePath: 'index.html' },
    { relativePath: 'branches.html' },
    { relativePath: 'branch-000002.html' },
    { relativePath: 'branch-1.html' },
    { relativePath: '../branch-000001.html' },
    { relativePath: 'presentation/branch-000001.html' },
    { relativePath: 'branch-000001.html\n' },
    { role: 'index' },
    { ordinal: 0 },
    { ordinal: 1000000 },
    { ordinal: 1.5 },
    { mediaType: 'text/html; charset=utf-8' },
    { rendererVersion: 'liska-html/2' },
    { byteLength: 2 },
    { byteLength: -1 },
    { byteLength: DERIVED_HTML_MAX_BYTES + 1 },
    { sha256: 'A'.repeat(64) },
    { sourceCanonicalSha256: 'private-provider-id' },
    { sourceCanonicalSha256: `${'a'.repeat(64)}\n` },
    { assetBindingSha256: undefined },
    { assetBindingSha256: 'B'.repeat(64) },
    { bodyBase64: 'eA' },
    { bodyBase64: 'eB==' },
    { bodyBase64: 'eA/=' },
    { bodyBase64: 'eA==\n' },
    { bodyBase64: 'eA-_' },
    { extra: 'private' },
  ])('rejects cross-role/path/schema or invalid artifact fields: %j', fields => {
    expect(snapshotDerivedBranchHtmlArtifact(artifact(leaf, fields))).toBeUndefined();
  });

  it('rejects leaf fields on an index, and index paths for a leaf', () => {
    expect(snapshotDerivedBranchHtmlArtifact(artifact(index, { ordinal: 1 }))).toBeUndefined();
    expect(
      snapshotDerivedBranchHtmlArtifact(artifact(index, { relativePath: 'branch-000001.html' }))
    ).toBeUndefined();
    expect(snapshotDerivedBranchHtmlArtifact(artifact(index, { role: 'leaf' }))).toBeUndefined();
  });

  it('rejects missing/inherited/accessor/non-enumerable/symbol artifact keys without reads', () => {
    for (const target of [leaf, index]) {
      const original = artifact(target);
      for (const key of Object.keys(original)) {
        const missing: Record<string, unknown> = { ...original };
        delete missing[key];
        expect(snapshotDerivedBranchHtmlArtifact(missing)).toBeUndefined();
        const { changed, getter } = withAccessor(original, key);
        expect(snapshotDerivedBranchHtmlArtifact(changed)).toBeUndefined();
        expect(getter).not.toHaveBeenCalled();
        expect(
          snapshotDerivedBranchHtmlArtifact(
            Object.defineProperty({ ...original }, key, { enumerable: false })
          )
        ).toBeUndefined();
      }
      for (const bad of hostileShapes(original)) {
        expect(snapshotDerivedBranchHtmlArtifact(bad)).toBeUndefined();
        expect(isDerivedBranchHtmlArtifact(bad)).toBe(false);
      }
    }
  });

  it('shape-validates without decoding, then detects changed bytes, hash and fatal UTF-8', async () => {
    const decode = vi.spyOn(globalThis, 'atob').mockImplementation(() => {
      throw new Error('shape must not decode');
    });
    try {
      expect(snapshotDerivedBranchHtmlArtifact(artifact())).toEqual(artifact());
    } finally {
      decode.mockRestore();
    }
    for (const fields of [{ bodyBase64: 'eQ==' }, { sha256: 'f'.repeat(64) }]) {
      expect(snapshotDerivedBranchHtmlArtifact(artifact(leaf, fields))).toBeDefined();
      expect(await verifyDerivedBranchHtmlArtifact(artifact(leaf, fields), hash)).toBeUndefined();
    }
    for (const raw of [[0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0xa6]]) {
      const bytes = new Uint8Array(raw);
      const invalid = artifact(leaf, {
        byteLength: bytes.length,
        sha256: await hash(bytes),
        bodyBase64: Buffer.from(bytes).toString('base64'),
      });
      expect(snapshotDerivedBranchHtmlArtifact(invalid)).toBeDefined();
      expect(await verifyDerivedBranchHtmlArtifact(invalid, hash)).toBeUndefined();
    }
  });

  it('snapshots target/provenance before await and isolates bytes from hash mutation', async () => {
    const target: DerivedBranchHtmlTarget = { ...leaf };
    const source = { ...provenance };
    const output = await buildDerivedBranchHtmlArtifact('x', target, source, async bytes => {
      target.ordinal = 2;
      source.sourceCanonicalSha256 = 'd'.repeat(64);
      const digest = await hash(bytes);
      bytes.fill(0);
      return digest;
    });
    expect(output).toEqual(artifact());
    const verification = verifyDerivedBranchHtmlArtifact(output, async bytes => {
      output.relativePath = 'branch-000002.html';
      output.sourceCanonicalSha256 = 'e'.repeat(64);
      const digest = await hash(bytes);
      bytes.fill(0);
      return digest;
    });
    const verified = await verification;
    expect(verified?.artifact).toEqual(artifact());
    expect(verified?.bytes).toEqual(new Uint8Array([120]));
  });

  it('retains the bounded v1 byte ceiling and fails before hashing overmax', async () => {
    const sha256 = vi.fn(hash);
    await expect(
      buildDerivedBranchHtmlArtifact(
        'x'.repeat(DERIVED_HTML_MAX_BYTES + 1),
        leaf,
        provenance,
        sha256
      )
    ).rejects.toEqual(new DerivedBranchPresentationError('derived-branch-html-too-large'));
    expect(sha256).not.toHaveBeenCalled();
  });

  it('returns value-free errors for invalid input, hostile objects and hash/encoding failures', async () => {
    const { changed, getter } = withAccessor(provenance, 'sourceCanonicalSha256');
    await expect(
      buildDerivedBranchHtmlArtifact('private body', leaf, changed as typeof provenance, hash)
    ).rejects.toEqual(new DerivedBranchPresentationError('derived-branch-html-invalid-input'));
    expect(getter).not.toHaveBeenCalled();
    await expect(
      buildDerivedBranchHtmlArtifact('private body', { ...leaf, ordinal: 0 }, provenance, hash)
    ).rejects.toEqual(new DerivedBranchPresentationError('derived-branch-html-invalid-target'));
    await expect(
      buildDerivedBranchHtmlArtifact('private body', leaf, provenance, async () => {
        throw new Error('private native detail');
      })
    ).rejects.toEqual(new DerivedBranchPresentationError('derived-branch-html-hash-failed'));
    await expect(
      buildDerivedBranchHtmlArtifact('private body', leaf, provenance, async () => 'private')
    ).rejects.toEqual(new DerivedBranchPresentationError('derived-branch-html-invalid-hash'));
    expect(
      await verifyDerivedBranchHtmlArtifact(artifact(), async () => {
        throw new Error('private');
      })
    ).toBeUndefined();
    const encode = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => {
      throw new Error('private');
    });
    try {
      await expect(buildDerivedBranchHtmlArtifact('x', leaf, provenance, hash)).rejects.toEqual(
        new DerivedBranchPresentationError('derived-branch-html-encoding-failed')
      );
    } finally {
      encode.mockRestore();
    }
  });
});

describe('branch output receipt', () => {
  it.each([leaf, index])('serializes golden deterministic UTF-8 receipt bytes for %j', target => {
    const output = receipt(target);
    const roleFields = target.role === 'leaf' ? '"role":"leaf","ordinal":1' : '"role":"index"';
    const path = target.role === 'leaf' ? 'branch-000001.html' : 'branches.html';
    const golden =
      `{"schema":"liska-derived-branch-output-receipt/1","source":"chatgpt",` +
      `"captureId":"capture-chatgpt-safe_1","conversationKey":"${'c'.repeat(64)}",` +
      `"sourceCanonicalSha256":"${'a'.repeat(64)}","assetBindingSha256":"${'b'.repeat(64)}",` +
      `"artifact":{${roleFields},"kind":"html","relativePath":"${path}","mediaType":"text/html",` +
      `"byteLength":1,"sha256":"${X_SHA256}","rendererVersion":"liska-html/1"}}\n`;
    const bytes = buildDerivedBranchOutputReceiptBytes(output);
    expect(bytes).toEqual(new TextEncoder().encode(golden));
    expect(isDerivedBranchOutputReceipt(output)).toBe(true);
    expect(JSON.parse(golden)).toEqual(output);
    const reordered: Record<string, unknown> = Object.fromEntries(Object.entries(output).reverse());
    reordered.artifact = Object.fromEntries(Object.entries(output.artifact).reverse());
    expect(buildDerivedBranchOutputReceiptBytes(reordered)).toEqual(bytes);
    expect(bytes[bytes.length - 1]).toBe(10);
    expect(new TextDecoder().decode(bytes)).not.toContain('\r');
  });

  it.each(['chatgpt', 'deepseek'] as const)(
    'copies exact %s capture identity and provenance',
    source => {
      const output = buildDerivedBranchOutputReceipt(
        { ...identity, source, captureId: `capture-${source}-safe` },
        artifact(index, { assetBindingSha256: null })
      );
      expect(output.source).toBe(source);
      expect(output.captureId).toBe(`capture-${source}-safe`);
      expect(output.conversationKey).toBe(identity.conversationKey);
      expect(output.sourceCanonicalSha256).toBe(provenance.sourceCanonicalSha256);
      expect(output.assetBindingSha256).toBeNull();
      expect(output.artifact.relativePath).toBe('branches.html');
    }
  );

  it.each([
    'bodyBase64',
    'body',
    'url',
    'title',
    'timestamp',
    'providerId',
    'nodeId',
    'destination',
    'absolutePath',
  ])('rejects forbidden %s at either receipt or descriptor level', key => {
    const original = receipt();
    expect(snapshotDerivedBranchOutputReceipt({ ...original, [key]: 'private' })).toBeUndefined();
    expect(
      snapshotDerivedBranchOutputReceipt({
        ...original,
        artifact: { ...original.artifact, [key]: 'private' },
      })
    ).toBeUndefined();
  });

  it('has no body/private values, URLs, provider node IDs or clock in receipt bytes', async () => {
    const html = await buildDerivedBranchHtmlArtifact(
      '<p>private body; title; https://private.example/provider-node-id</p>',
      leaf,
      provenance,
      hash
    );
    const output = buildDerivedBranchOutputReceipt(identity, html);
    const serialized = new TextDecoder().decode(buildDerivedBranchOutputReceiptBytes(output));
    for (const forbidden of [
      'private',
      'https:',
      'provider-node-id',
      'bodyBase64',
      html.bodyBase64,
    ])
      expect(serialized).not.toContain(forbidden);
    expect(Object.keys(output.artifact)).toEqual([
      'role',
      'ordinal',
      'kind',
      'relativePath',
      'mediaType',
      'byteLength',
      'sha256',
      'rendererVersion',
    ]);
  });

  it.each([
    { schema: 'liska-derived-output-receipt/1' },
    { schema: 'liska-derived-branch-output-receipt/2' },
    { source: 'claude' },
    { source: 'deepseek' },
    { captureId: 'capture-chatgpt-../private' },
    { conversationKey: 'provider-conversation-id' },
    { sourceCanonicalSha256: 'A'.repeat(64) },
    { assetBindingSha256: '' },
    { artifact: artifact() },
  ])('rejects invalid receipt fields: %j', fields => {
    expect(snapshotDerivedBranchOutputReceipt(receipt(leaf, fields))).toBeUndefined();
  });

  it('rejects cross-role/path confusion in the descriptor', () => {
    const original = receipt();
    for (const fields of [
      { role: 'index' },
      { relativePath: 'branches.html' },
      { relativePath: 'branch-000002.html' },
      { relativePath: '../branch-000001.html' },
      { ordinal: '000001' },
      { ordinal: 0 },
    ])
      expect(
        snapshotDerivedBranchOutputReceipt({
          ...original,
          artifact: { ...original.artifact, ...fields },
        })
      ).toBeUndefined();
  });

  it('rejects unexpected/missing/inherited/accessor keys at both levels without reads', () => {
    for (const target of [leaf, index]) {
      const original = receipt(target);
      for (const [value, wrap] of [
        [original, (value: object) => value],
        [original.artifact, (value: object) => ({ ...original, artifact: value })],
      ] as const) {
        for (const key of Object.keys(value)) {
          const missing: Record<string, unknown> = { ...value };
          delete missing[key];
          expect(snapshotDerivedBranchOutputReceipt(wrap(missing))).toBeUndefined();
          const { changed, getter } = withAccessor(value, key);
          expect(snapshotDerivedBranchOutputReceipt(wrap(changed))).toBeUndefined();
          expect(getter).not.toHaveBeenCalled();
          expect(
            snapshotDerivedBranchOutputReceipt(
              wrap(Object.defineProperty({ ...value }, key, { enumerable: false }))
            )
          ).toBeUndefined();
        }
      }
      for (const bad of hostileShapes(original)) {
        expect(snapshotDerivedBranchOutputReceipt(bad)).toBeUndefined();
        expect(isDerivedBranchOutputReceipt(bad)).toBe(false);
      }
      for (const bad of hostileShapes(original.artifact))
        expect(snapshotDerivedBranchOutputReceipt({ ...original, artifact: bad })).toBeUndefined();
    }
  });

  it('detaches nested snapshots and serialized bytes from later mutations', () => {
    const input = receipt();
    const snapshot = snapshotDerivedBranchOutputReceipt(input)!;
    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(snapshot.artifact).not.toBe(input.artifact);
    input.artifact.relativePath = 'branch-000002.html';
    input.sourceCanonicalSha256 = 'd'.repeat(64);
    expect(snapshot).toEqual(receipt());
    const bytes = buildDerivedBranchOutputReceiptBytes(snapshot);
    bytes.fill(0);
    expect(buildDerivedBranchOutputReceiptBytes(snapshot)[0]).toBe(123);
  });

  it('matches exact identity/role/path/provenance/renderer/length/hash without retaining body', () => {
    const input = receipt();
    const result = matchDerivedBranchOutputReceipt(input, identity, artifact());
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result?.artifact).not.toBe(input.artifact);
    expect(result?.artifact).not.toHaveProperty('bodyBase64');
    for (const changed of [
      receipt(index),
      receipt({ role: 'leaf', ordinal: 2 }),
      receipt(leaf, { sourceCanonicalSha256: 'd'.repeat(64) }),
      receipt(leaf, { assetBindingSha256: null }),
      receipt(leaf, { source: 'deepseek', captureId: 'capture-deepseek-safe' }),
      receipt(leaf, { captureId: 'capture-chatgpt-other' }),
      receipt(leaf, { conversationKey: 'd'.repeat(64) }),
      receipt(leaf, { artifact: { ...input.artifact, sha256: 'd'.repeat(64) } }),
      receipt(leaf, { artifact: { ...input.artifact, byteLength: 2 } }),
      receipt(leaf, { artifact: { ...input.artifact, rendererVersion: 'liska-html/2' } }),
    ])
      expect(matchDerivedBranchOutputReceipt(changed, identity, artifact())).toBeUndefined();
    for (const fields of [
      { sourceCanonicalSha256: 'd'.repeat(64) },
      { assetBindingSha256: null },
      { sha256: 'd'.repeat(64) },
      { rendererVersion: 'liska-html/2' },
    ])
      expect(
        matchDerivedBranchOutputReceipt(input, identity, artifact(leaf, fields))
      ).toBeUndefined();
    expect(matchDerivedBranchOutputReceipt(input, identity, artifact(index))).toBeUndefined();
    expect(
      matchDerivedBranchOutputReceipt(
        input,
        { ...identity, captureId: 'capture-chatgpt-other' },
        artifact()
      )
    ).toBeUndefined();
  });

  it('does not rehash HTML in the matcher; byte verification is a separate required step', async () => {
    const changed = artifact(leaf, { bodyBase64: 'eQ==' });
    expect(matchDerivedBranchOutputReceipt(receipt(), identity, changed)).toEqual(receipt());
    expect(await verifyDerivedBranchHtmlArtifact(changed, hash)).toBeUndefined();
  });

  it('matcher rejects malformed/accessor identity, artifact and receipt without invoking getters', () => {
    const original = receipt();
    const identityAccessor = withAccessor(identity, 'captureId');
    const artifactAccessor = withAccessor(artifact(), 'bodyBase64');
    const receiptAccessor = withAccessor(original, 'sourceCanonicalSha256');
    const descriptorAccessor = withAccessor(original.artifact, 'ordinal');
    expect(
      matchDerivedBranchOutputReceipt(
        original,
        identityAccessor.changed as unknown as DerivedOutputIdentity,
        artifact()
      )
    ).toBeUndefined();
    expect(
      matchDerivedBranchOutputReceipt(original, identity, artifactAccessor.changed)
    ).toBeUndefined();
    expect(
      matchDerivedBranchOutputReceipt(receiptAccessor.changed, identity, artifact())
    ).toBeUndefined();
    expect(
      matchDerivedBranchOutputReceipt(
        { ...original, artifact: descriptorAccessor.changed },
        identity,
        artifact()
      )
    ).toBeUndefined();
    for (const { getter } of [
      identityAccessor,
      artifactAccessor,
      receiptAccessor,
      descriptorAccessor,
    ])
      expect(getter).not.toHaveBeenCalled();
    expect(
      matchDerivedBranchOutputReceipt(
        original,
        Object.assign(Object.create({ inherited: true }), identity),
        artifact()
      )
    ).toBeUndefined();
  });

  it('does not leak rejected input or native receipt encoding errors', () => {
    const output = receipt();
    expect(() =>
      buildDerivedBranchOutputReceipt({ ...identity, source: 'deepseek' }, artifact())
    ).toThrow(new DerivedBranchPresentationError('derived-branch-receipt-invalid-input'));
    expect(() =>
      buildDerivedBranchOutputReceipt(identity, artifact(leaf, { sha256: 'private' }))
    ).toThrow(new DerivedBranchPresentationError('derived-branch-receipt-invalid-input'));
    expect(() => buildDerivedBranchOutputReceiptBytes({ ...output, title: 'private' })).toThrow(
      new DerivedBranchPresentationError('derived-branch-receipt-invalid-input')
    );
    const encode = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => {
      throw new Error('private native detail');
    });
    try {
      expect(() => buildDerivedBranchOutputReceiptBytes(output)).toThrow(
        new DerivedBranchPresentationError('derived-branch-receipt-encoding-failed')
      );
    } finally {
      encode.mockRestore();
    }
  });
});

describe('current-branch v1 separation', () => {
  it('keeps branch and v1 artifact/receipt validators mutually exclusive', async () => {
    const current = await buildDerivedHtmlArtifact('x', provenance, hash);
    const currentReceipt = buildDerivedOutputReceipt(identity, current);
    for (const target of [leaf, index]) {
      expect(snapshotDerivedHtmlArtifact(artifact(target))).toBeUndefined();
      expect(snapshotDerivedOutputReceipt(receipt(target))).toBeUndefined();
    }
    expect(snapshotDerivedBranchHtmlArtifact(current)).toBeUndefined();
    expect(snapshotDerivedBranchOutputReceipt(currentReceipt)).toBeUndefined();
    expect(snapshotDerivedHtmlArtifact(current)).toEqual(current);
    expect(snapshotDerivedOutputReceipt(currentReceipt)).toEqual(currentReceipt);
  });
});
