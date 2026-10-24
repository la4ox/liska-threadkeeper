// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNodePath, type LiskaThreadArchive } from '../../src/archive';
import {
  HtmlPresentationError,
  renderArchiveHtml,
  type HtmlAssetBindingSet,
} from '../../src/archive/presentation';
import {
  DerivedHtmlPreparationError,
  prepareDerivedHtmlArtifact,
} from '../../src/content/derived-html-presentation';
import { retainStructuredPresentation } from '../../src/content/structured-presentation';
import { DERIVED_HTML_MAX_BYTES } from '../../src/lib/derived-presentation-contract';
import { sha256Hex } from '../../src/lib/sha256';
import type {
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  StructuredArchiveSource,
  StructuredPresentationContext,
} from '../../src/lib/types';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

vi.mock('../../src/lib/sha256', () => ({ sha256Hex: vi.fn() }));
vi.mock('../../src/archive/presentation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/archive/presentation')>();
  return { ...actual, renderArchiveHtml: vi.fn(actual.renderArchiveHtml) };
});

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const MANIFEST_SHA256 = 'a'.repeat(64);
const BINDING_SHA256 = 'b'.repeat(64);

function context(
  source: StructuredArchiveSource = 'chatgpt',
  transport: 'inline' | 'staged' = 'inline'
): StructuredPresentationContext {
  const archive = structuredClone(branchingFixture) as LiskaThreadArchive;
  archive.conversation.provider = source;
  archive.conversation.title = 'Русский 中文 🦊';
  archive.archiveId = `${source}:${archive.conversation.id}`;
  archive.inputs[0].captureId = `capture-${source}-html-test`;
  const bytes = new TextEncoder().encode(JSON.stringify(archive, null, 2));
  const artifact = (kind: 'raw' | 'manifest' | 'canonical'): ArchiveCompanionArtifact => ({
    kind,
    relativePath:
      kind === 'raw'
        ? 'responses/conversation.json'
        : kind === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json',
    byteLength: kind === 'canonical' ? bytes.byteLength : 2,
    sha256: kind === 'canonical' ? hash(bytes) : MANIFEST_SHA256,
    ...(transport === 'staged' && kind !== 'manifest'
      ? { transport: 'staged', stageId: 'archive-stage-synthetic' }
      : { transport: 'inline', bodyBase64: 'e30=' }),
  });
  const companion: ArchiveCompanionBundle = {
    captureId: archive.inputs[0].captureId,
    conversationKey: 'c'.repeat(64),
    artifacts: [artifact('raw'), artifact('manifest'), artifact('canonical')],
  };
  return retainStructuredPresentation({
    source,
    archive,
    archiveCompanion: companion,
    targetNodeId: 'node-current',
    selectedNodeIds: getNodePath(archive, 'node-current'),
    includeToolContent: false,
  })!;
}

function changed(
  original: StructuredPresentationContext,
  overrides: Record<string, unknown>
): StructuredPresentationContext {
  return { ...original, ...overrides } as StructuredPresentationContext;
}

function bindings(value: StructuredPresentationContext): HtmlAssetBindingSet {
  const asset = value.archive.assets['asset-synthetic-image'];
  return {
    sha256: BINDING_SHA256,
    bindings: [
      {
        assetId: asset.id,
        path: `assets/${asset.sha256}.png`,
        sha256: asset.sha256!,
        mimeType: asset.mimeType!,
        byteLength: asset.byteLength!,
        renderMode: 'image',
      },
    ],
  };
}

beforeEach(() => {
  vi.mocked(sha256Hex).mockReset();
  vi.mocked(sha256Hex).mockImplementation(async bytes => hash(bytes));
  vi.mocked(renderArchiveHtml).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('optional exact-canonical HTML preparation', () => {
  it.each([
    ['chatgpt', 'inline'],
    ['chatgpt', 'staged'],
    ['deepseek', 'inline'],
    ['deepseek', 'staged'],
  ] as const)('authorizes exact %s canonical bytes from %s evidence', async (source, transport) => {
    const value = context(source, transport);
    const expected = new TextEncoder().encode(JSON.stringify(value.archive, null, 2));
    const artifact = await prepareDerivedHtmlArtifact(value);
    expect(vi.mocked(sha256Hex).mock.calls[0][0]).toEqual(expected);
    expect(artifact).toMatchObject({
      schema: 'liska-derived-html/1',
      relativePath: 'index.html',
      mediaType: 'text/html',
      rendererVersion: 'liska-html/1',
      sourceCanonicalSha256: value.canonical.sha256,
      assetBindingSha256: null,
    });
    const bytes = Buffer.from(artifact.bodyBase64, 'base64');
    expect(bytes.byteLength).toBe(artifact.byteLength);
    expect(hash(bytes)).toBe(artifact.sha256);
    expect(bytes.toString('utf8')).toContain('Русский 中文 🦊');
    expect(renderArchiveHtml).toHaveBeenCalledWith({
      archive: value.archive,
      canonicalSha256: value.canonical.sha256,
      targetNodeId: value.targetNodeId,
      profile: { includeToolContent: false },
      limits: { maxHtmlChars: DERIVED_HTML_MAX_BYTES, maxHtmlBytes: DERIVED_HTML_MAX_BYTES },
    });
  });

  it('rejects an impossibly small canonical descriptor before UTF-8 allocation', async () => {
    const value = context();
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    await expect(
      prepareDerivedHtmlArtifact(
        changed(value, { canonical: { ...value.canonical, byteLength: 1 } })
      )
    ).rejects.toMatchObject({ code: 'derived-html-canonical-length-mismatch' });
    expect(encode).not.toHaveBeenCalled();
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it('does no serialization, hashing or rendering when not invoked', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    expect(typeof prepareDerivedHtmlArtifact).toBe('function');
    expect(stringify).not.toHaveBeenCalled();
    expect(sha256Hex).not.toHaveBeenCalled();
    expect(renderArchiveHtml).not.toHaveBeenCalled();
  });

  it('serializes/encodes/hashes the whole canonical exactly once', async () => {
    const value = context();
    const stringify = vi.spyOn(JSON, 'stringify');
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    await prepareDerivedHtmlArtifact(value);
    const wholeArchive = stringify.mock.calls.filter(call => call[0] === value.archive);
    expect(wholeArchive).toEqual([[value.archive, null, 2]]);
    const canonicalEncodings = encode.mock.calls.filter(call =>
      call[0]?.startsWith('{\n  "schema"')
    );
    expect(canonicalEncodings).toHaveLength(1);
    expect(sha256Hex).toHaveBeenCalledTimes(2); // Canonical bytes, then delivered HTML bytes.
  });

  it('is deterministic and does not reconstruct the selected view from Markdown', async () => {
    const value = context();
    const first = await prepareDerivedHtmlArtifact(value);
    expect(await prepareDerivedHtmlArtifact(value)).toEqual(first);
    expect(renderArchiveHtml).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['wrong byte length', 'derived-html-canonical-length-mismatch'],
    ['wrong digest', 'derived-html-canonical-hash-mismatch'],
  ])('refuses %s before rendering', async (label, code) => {
    const value = context();
    const canonical = {
      ...value.canonical,
      ...(label === 'wrong byte length'
        ? { byteLength: value.canonical.byteLength + 1 }
        : { sha256: 'f'.repeat(64) }),
    };
    await expect(prepareDerivedHtmlArtifact(changed(value, { canonical }))).rejects.toMatchObject({
      code,
      message: code,
    });
    expect(renderArchiveHtml).not.toHaveBeenCalled();
  });

  it.each([
    ['source', { source: 'gemini' }],
    ['provider', { source: 'deepseek', captureId: 'capture-deepseek-html-test' }],
    ['capture', { captureId: 'capture-chatgpt-other' }],
    ['opaque conversation key', { conversationKey: 'provider-id' }],
    ['target', { targetNodeId: 'missing' }],
    ['selected path order', { selectedNodeIds: ['node-current', 'node-root'] }],
    ['selected path omission', { selectedNodeIds: ['node-current'] }],
    ['selected path terminal', { targetNodeId: 'node-alternate' }],
    ['profile', { includeToolContent: 'true' }],
  ])('refuses an inconsistent %s', async (_label, overrides) => {
    await expect(prepareDerivedHtmlArtifact(changed(context(), overrides))).rejects.toMatchObject({
      code: 'derived-html-context-invalid',
    });
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it.each(['manifest', 'canonical'] as const)(
    'revalidates fixed %s descriptor evidence',
    async kind => {
      for (const overrides of [
        { relativePath: 'elsewhere/private.json' },
        { mediaType: 'text/json' },
        { kind: 'raw' },
        { sha256: 'A'.repeat(64) },
        { byteLength: 0 },
        { byteLength: Number.NaN },
      ]) {
        const value = context();
        await expect(
          prepareDerivedHtmlArtifact(changed(value, { [kind]: { ...value[kind], ...overrides } }))
        ).rejects.toMatchObject({ code: 'derived-html-context-invalid' });
      }
      expect(sha256Hex).not.toHaveBeenCalled();
    }
  );

  it.each(['manifest', 'capture', 'archiveId', 'current', 'multiple inputs'])(
    'revalidates archive/input %s identity',
    async kind => {
      const value = context();
      if (kind === 'manifest') value.archive.inputs[0].manifestSha256 = 'f'.repeat(64);
      if (kind === 'capture') value.archive.inputs[0].captureId = 'capture-chatgpt-other';
      if (kind === 'archiveId') value.archive.archiveId = 'chatgpt:other';
      if (kind === 'current') value.archive.conversation.currentNodeId = 'missing';
      if (kind === 'multiple inputs') value.archive.inputs.push(value.archive.inputs[0]);
      await expect(prepareDerivedHtmlArtifact(value)).rejects.toMatchObject({
        code: 'derived-html-context-invalid',
      });
      expect(sha256Hex).not.toHaveBeenCalled();
    }
  );

  it('accepts only renderer-validated finalized bindings and matching result provenance', async () => {
    const value = context();
    const set = bindings(value);
    const artifact = await prepareDerivedHtmlArtifact(value, set);
    expect(artifact.assetBindingSha256).toBe(BINDING_SHA256);
    expect(Buffer.from(artifact.bodyBase64, 'base64').toString()).toContain(
      `<img src="${set.bindings[0].path}"`
    );
    await expect(
      prepareDerivedHtmlArtifact(value, { bindings: [], sha256: null })
    ).resolves.toMatchObject({ assetBindingSha256: null });
  });

  it.each([
    { bindings: [], sha256: BINDING_SHA256 },
    { bindings: [{ assetId: 'missing' }], sha256: null },
  ])('does not accept malformed or nonempty null-digest bindings', async set => {
    await expect(
      prepareDerivedHtmlArtifact(context(), set as HtmlAssetBindingSet)
    ).rejects.toMatchObject({ code: 'html-bindings-invalid' });
  });

  it('never invents bindings from fetched canonical localArtifactRef', async () => {
    const value = context();
    expect(value.archive.assets['asset-synthetic-image'].localArtifactRef).toBeTruthy();
    const artifact = await prepareDerivedHtmlArtifact(value);
    const html = Buffer.from(artifact.bodyBase64, 'base64').toString();
    expect(html).toContain('Attachment has no finalized local binding.');
    expect(html).not.toContain('<img');
    expect(artifact.assetBindingSha256).toBeNull();
  });

  it('rejects accessors and custom serializers without invoking them', async () => {
    const value = context();
    const getter = vi.fn(() => 'private');
    Object.defineProperty(value.archive.conversation, 'title', { get: getter, enumerable: true });
    await expect(prepareDerivedHtmlArtifact(value)).rejects.toMatchObject({
      code: 'html-input-invalid',
    });
    expect(getter).not.toHaveBeenCalled();
    const second = context();
    const toJSON = vi.fn(() => ({ private: true }));
    Object.assign(second.archive, { toJSON });
    await expect(prepareDerivedHtmlArtifact(second)).rejects.toMatchObject({
      code: 'html-input-invalid',
    });
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('does not read unrelated subtype evidence or descriptor transport bodies', async () => {
    const value = context();
    const getter = vi.fn(() => {
      throw new Error('private');
    });
    const canonical = { ...value.canonical };
    Object.defineProperty(canonical, 'bodyBase64', { get: getter });
    const subtype = changed(value, { canonical });
    Object.defineProperty(subtype, 'assetExportContext', { get: getter, enumerable: true });
    await expect(prepareDerivedHtmlArtifact(subtype)).resolves.toBeDefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it('sanitizes throwing context/binding proxy traps', async () => {
    const proxy = new Proxy(context(), {
      getOwnPropertyDescriptor() {
        throw new Error('private');
      },
    });
    await expect(prepareDerivedHtmlArtifact(proxy)).rejects.toEqual(
      new DerivedHtmlPreparationError('derived-html-context-invalid')
    );
    const set = new Proxy(
      { bindings: [], sha256: null },
      {
        getPrototypeOf() {
          throw new Error('private');
        },
      }
    );
    await expect(prepareDerivedHtmlArtifact(context(), set)).rejects.toEqual(
      new DerivedHtmlPreparationError('derived-html-context-invalid')
    );
  });

  it('rechecks detached scalar/path evidence after the canonical hash await', async () => {
    const value = changed(context(), {});
    vi.mocked(sha256Hex).mockImplementationOnce(async bytes => {
      Object.assign(value, { targetNodeId: 'node-alternate' });
      return hash(bytes);
    });
    await expect(prepareDerivedHtmlArtifact(value)).rejects.toMatchObject({
      code: 'derived-html-context-invalid',
    });
    expect(renderArchiveHtml).not.toHaveBeenCalled();
  });

  it('scrubs unexpected hashing and renderer exceptions', async () => {
    vi.mocked(sha256Hex).mockRejectedValueOnce(new Error('private transport secret'));
    await expect(prepareDerivedHtmlArtifact(context())).rejects.toEqual(
      new DerivedHtmlPreparationError('derived-html-canonical-hash-failed')
    );
    vi.mocked(renderArchiveHtml).mockImplementationOnce(() => {
      throw new Error('private renderer secret');
    });
    await expect(prepareDerivedHtmlArtifact(context())).rejects.toEqual(
      new DerivedHtmlPreparationError('derived-html-render-failed')
    );
  });

  it('scrubs an unexpected serializer exception without hashing or rendering', async () => {
    const value = context();
    vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('private');
    });
    await expect(prepareDerivedHtmlArtifact(value)).rejects.toEqual(
      new DerivedHtmlPreparationError('derived-html-canonical-serialization-failed')
    );
    expect(sha256Hex).not.toHaveBeenCalled();
    expect(renderArchiveHtml).not.toHaveBeenCalled();
  });

  it('rejects excessive canonical JSON depth before serialization', async () => {
    const value = context();
    let nested: Record<string, unknown> = {};
    const original = nested;
    for (let index = 0; index < 100; index++) {
      const next = {};
      nested.child = next;
      nested = next;
    }
    Object.assign(value.archive.extensions, { test: original });
    const stringify = vi.spyOn(JSON, 'stringify');
    await expect(prepareDerivedHtmlArtifact(value)).rejects.toMatchObject({
      code: 'html-input-depth-limit',
    });
    expect(stringify).not.toHaveBeenCalled();
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it('does not treat exact authorized JSON as proof of valid canonical schema', async () => {
    const value = context();
    Object.assign(value.archive.diagnostics, { entries: 'invalid' });
    const bytes = new TextEncoder().encode(JSON.stringify(value.archive, null, 2));
    const input = changed(value, {
      canonical: { ...value.canonical, byteLength: bytes.byteLength, sha256: hash(bytes) },
    });
    await expect(prepareDerivedHtmlArtifact(input)).rejects.toMatchObject({
      code: 'html-archive-invalid',
    });
    expect(sha256Hex).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicit selected leaf when the provider has no current node', async () => {
    const value = context();
    value.archive.conversation.currentNodeId = null;
    const bytes = new TextEncoder().encode(JSON.stringify(value.archive, null, 2));
    const input = changed(value, {
      canonical: { ...value.canonical, byteLength: bytes.byteLength, sha256: hash(bytes) },
    });
    await expect(prepareDerivedHtmlArtifact(input)).resolves.toMatchObject({
      sourceCanonicalSha256: hash(bytes),
    });
  });

  it('preserves stable renderer limit failures without returning partial HTML', async () => {
    vi.mocked(renderArchiveHtml).mockImplementationOnce(() => {
      throw new HtmlPresentationError('html-output-limit');
    });
    await expect(prepareDerivedHtmlArtifact(context())).rejects.toMatchObject({
      code: 'html-output-limit',
      message: 'html-output-limit',
    });
    expect(sha256Hex).toHaveBeenCalledTimes(1);
  });

  it('rejects result provenance mismatches before building an artifact', async () => {
    const value = context();
    const actual = (
      await vi.importActual<typeof import('../../src/archive/presentation')>(
        '../../src/archive/presentation'
      )
    ).renderArchiveHtml;
    vi.mocked(renderArchiveHtml).mockImplementationOnce(input => ({
      ...actual(input),
      canonicalSha256: 'f'.repeat(64),
    }));
    await expect(prepareDerivedHtmlArtifact(value)).rejects.toMatchObject({
      code: 'derived-html-render-provenance-mismatch',
    });
    vi.mocked(renderArchiveHtml).mockImplementationOnce(input => ({
      ...actual(input),
      assetBindingSha256: 'f'.repeat(64),
    }));
    await expect(prepareDerivedHtmlArtifact(value)).rejects.toMatchObject({
      code: 'derived-html-render-provenance-mismatch',
    });
  });

  it('enforces the separate 32 MiB artifact ceiling after rendering', async () => {
    const value = context();
    vi.mocked(renderArchiveHtml).mockReturnValueOnce({
      schema: 'liska-html/1',
      rendererVersion: 'liska-html/1',
      html: 'x'.repeat(DERIVED_HTML_MAX_BYTES + 1),
      selectedNodeCount: 1,
      renderedMessageCount: 1,
      diagnostics: [],
      canonicalSha256: value.canonical.sha256,
      assetBindingSha256: null,
    });
    await expect(prepareDerivedHtmlArtifact(value)).rejects.toMatchObject({
      code: 'derived-html-too-large',
      message: 'derived-html-too-large',
    });
    expect(sha256Hex).toHaveBeenCalledTimes(1);
  });
});
