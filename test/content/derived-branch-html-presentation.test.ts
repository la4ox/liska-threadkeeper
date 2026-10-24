// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNodePath,
  type ArchiveNode,
  type LiskaThreadArchive,
  type RawCaptureAssetRecord,
} from '../../src/archive';
import {
  prepareArchiveHtmlBranchSession,
  type HtmlAssetBindingSet,
  type HtmlBranchRenderFact,
} from '../../src/archive/presentation';
import {
  DerivedHtmlBranchPreparationError,
  prepareDerivedHtmlBranchPresentationSession,
} from '../../src/content/derived-branch-html-presentation';
import { persistDerivedBranchHtmlArtifactForFile } from '../../src/content/derived-branch-html-persistence';
import { prepareDerivedHtmlArtifact } from '../../src/content/derived-html-presentation';
import { buildFinalizedFileArchivePresentationEvidence } from '../../src/content/finalized-html-assets';
import {
  retainStructuredArchivePresentation,
  retainStructuredPresentation,
} from '../../src/content/structured-presentation';
import {
  buildDerivedBranchHtmlArtifact,
  buildDerivedBranchOutputReceipt,
  deriveBranchHtmlReceiptRelativePath,
} from '../../src/lib/derived-branch-presentation-contract';
import { buildDerivedBranchHtmlPersistResponse } from '../../src/lib/derived-branch-persistence-contract';
import { DERIVED_HTML_MAX_BYTES } from '../../src/lib/derived-presentation-contract';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import { sha256Hex } from '../../src/lib/sha256';
import type {
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  StructuredArchivePresentationContext,
  StructuredArchiveSource,
} from '../../src/lib/types';
import fixture from '../fixtures/archive/branching-chatgpt-thread.json';

vi.mock('../../src/lib/sha256', () => ({ sha256Hex: vi.fn() }));
vi.mock('../../src/archive/presentation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/archive/presentation')>();
  return {
    ...actual,
    prepareArchiveHtmlBranchSession: vi.fn(actual.prepareArchiveHtmlBranchSession),
  };
});

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const manifestSha = 'a'.repeat(64);
const key = 'c'.repeat(64);
const html = (artifact: { bodyBase64: string }) =>
  Buffer.from(artifact.bodyBase64, 'base64').toString('utf8');

function companion(archive: LiskaThreadArchive): ArchiveCompanionBundle {
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
    sha256: kind === 'canonical' ? hash(bytes) : manifestSha,
    transport: 'staged',
    stageId: 'PRIVATE-STAGE-ID',
  });
  return {
    captureId: archive.inputs[0].captureId,
    conversationKey: key,
    artifacts: [artifact('raw'), artifact('manifest'), artifact('canonical')],
  };
}

function setup(
  source: StructuredArchiveSource = 'chatgpt',
  value = structuredClone(fixture) as LiskaThreadArchive
) {
  value.conversation.provider = source;
  value.conversation.title = 'PRIVATE-TITLE Русский 中文 🦊';
  value.archiveId = `${source}:${value.conversation.id}`;
  value.inputs[0].captureId = `capture-${source}-branch-session`;
  value.inputs[0].manifestSha256 = manifestSha;
  const evidence = companion(value);
  const context = retainStructuredArchivePresentation({
    source,
    archive: value,
    archiveCompanion: evidence,
    includeToolContent: false,
  })!;
  return { context, companion: evidence, archive: value };
}

function identity(context: StructuredArchivePresentationContext) {
  const { source, captureId, conversationKey } = context;
  return { source, captureId, conversationKey };
}

function sharedPrefix(depth: number, leaves: number) {
  const archive = structuredClone(fixture) as LiskaThreadArchive;
  const nodes: Record<string, ArchiveNode> = {};
  const node = (id: string, parentId: string | null): ArchiveNode => ({
    id,
    parentId,
    childIds: [],
    sourceRefs: [
      { format: 'synthetic/1', kind: 'node', id: null, artifactId: null, rawPointer: null },
    ],
    extensions: {},
  });
  for (let index = 0; index < depth; index++) {
    nodes[`PRIVATE-prefix-${index}`] = node(
      `PRIVATE-prefix-${index}`,
      index ? `PRIVATE-prefix-${index - 1}` : null
    );
    if (index) nodes[`PRIVATE-prefix-${index - 1}`].childIds.push(`PRIVATE-prefix-${index}`);
  }
  for (let index = 0; index < leaves; index++) {
    nodes[`PRIVATE-leaf-${index}`] = node(`PRIVATE-leaf-${index}`, `PRIVATE-prefix-${depth - 1}`);
    nodes[`PRIVATE-prefix-${depth - 1}`].childIds.push(`PRIVATE-leaf-${index}`);
  }
  archive.graph = { rootIds: ['PRIVATE-prefix-0'], nodes };
  archive.conversation.currentNodeId = null;
  archive.assets = {};
  return archive;
}

async function boundSetup(source: StructuredArchiveSource = 'chatgpt') {
  const initial = setup(source);
  const archive = structuredClone(initial.archive);
  const asset = archive.assets['asset-synthetic-image'];
  asset.localArtifactRef = `assets/${asset.sha256}.png`;
  const confirmed: RawCaptureAssetRecord = {
    id: asset.id,
    state: 'fetched',
    relativePath: asset.localArtifactRef,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
    mediaType: asset.mimeType,
    sourceRefs: [],
    attemptedAt: null,
    detail: null,
  };
  const evidence = (await buildFinalizedFileArchivePresentationEvidence(
    initial.context,
    archive,
    companion(archive),
    [confirmed]
  ))!;
  return { ...evidence, archive };
}

beforeEach(() => {
  vi.mocked(sha256Hex)
    .mockReset()
    .mockImplementation(async bytes => hash(bytes));
  vi.mocked(prepareArchiveHtmlBranchSession).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('authorized canonical-derived branch HTML session', () => {
  it.each(['chatgpt', 'deepseek'] as const)(
    'authorizes %s canonical once and hashes only individual built outputs thereafter',
    async source => {
      const { context } = setup(source);
      const stringify = vi.spyOn(JSON, 'stringify');
      const session = await prepareDerivedHtmlBranchPresentationSession(context);
      expect(sha256Hex).toHaveBeenCalledTimes(1);
      expect(prepareArchiveHtmlBranchSession).toHaveBeenCalledTimes(1);
      expect(stringify.mock.calls.filter(call => call[0] === context.archive)).toEqual([
        [context.archive, null, 2],
      ]);
      expect(vi.mocked(sha256Hex).mock.calls[0][0]).toEqual(
        new TextEncoder().encode(JSON.stringify(context.archive, null, 2))
      );
      stringify.mockClear();
      const first = await session.buildLeaf(1);
      const second = await session.buildLeaf(2);
      const index = await session.buildIndex([first.fact, second.fact]);
      expect(sha256Hex).toHaveBeenCalledTimes(4);
      expect(prepareArchiveHtmlBranchSession).toHaveBeenCalledTimes(1);
      expect(stringify.mock.calls.filter(call => call[0] === context.archive)).toHaveLength(0);
      for (const artifact of [first.artifact, second.artifact, index]) {
        expect(artifact.sourceCanonicalSha256).toBe(context.canonical.sha256);
        expect(artifact.byteLength).toBe(Buffer.from(artifact.bodyBase64, 'base64').byteLength);
        expect(artifact.sha256).toBe(hash(Buffer.from(artifact.bodyBase64, 'base64')));
        expect(Object.isFrozen(artifact)).toBe(true);
      }
    }
  );

  it('byte-matches B1+B2a leaf/index contracts including exact role/path/provenance', async () => {
    const { context, assetBindings } = await boundSetup();
    const session = await prepareDerivedHtmlBranchPresentationSession(context, assetBindings);
    const reference = prepareArchiveHtmlBranchSession({
      archive: context.archive,
      canonicalSha256: context.canonical.sha256,
      profile: { includeToolContent: false },
      assetBindings,
      limits: { maxHtmlChars: DERIVED_HTML_MAX_BYTES, maxHtmlBytes: DERIVED_HTML_MAX_BYTES },
    });
    const referenceFacts: HtmlBranchRenderFact[] = [];
    const facts: HtmlBranchRenderFact[] = [];
    const provenance = {
      sourceCanonicalSha256: context.canonical.sha256,
      assetBindingSha256: assetBindings.sha256,
    };
    for (const ordinal of [1, 2]) {
      const expected = reference.renderLeaf(ordinal);
      referenceFacts.push(expected.fact);
      const actual = await session.buildLeaf(ordinal);
      facts.push(actual.fact);
      expect(actual.artifact).toEqual(
        await buildDerivedBranchHtmlArtifact(
          expected.presentation.html,
          { role: 'leaf', ordinal },
          provenance,
          async bytes => hash(bytes)
        )
      );
      expect(actual.fact).toEqual(expected.fact);
      expect(actual.artifact.relativePath).toBe(`branch-00000${ordinal}.html`);
      expect(deriveBranchHtmlReceiptRelativePath({ role: 'leaf', ordinal })).toBe(
        `presentation/liska-html-1.branch-00000${ordinal}.receipt.json`
      );
    }
    const index = await session.buildIndex(facts);
    expect(index).toEqual(
      await buildDerivedBranchHtmlArtifact(
        reference.renderIndex(referenceFacts).html,
        { role: 'index' },
        provenance,
        async bytes => hash(bytes)
      )
    );
    expect(index).toMatchObject({
      schema: 'liska-derived-branch-html/1',
      role: 'index',
      relativePath: 'branches.html',
    });
    expect(index).not.toHaveProperty('ordinal');
    expect(html(index)).toContain('href="branch-000001.html"');
    expect(html(index)).not.toContain('PRIVATE-TITLE');
  });

  it('retains current/selected bytes and error codes through the shared authorizer', async () => {
    const { context, companion: evidence } = setup();
    const selected = retainStructuredPresentation({
      source: context.source,
      archive: context.archive,
      archiveCompanion: evidence,
      targetNodeId: 'node-current',
      selectedNodeIds: getNodePath(context.archive, 'node-current'),
      includeToolContent: false,
    })!;
    const single = await prepareDerivedHtmlArtifact(selected);
    const session = await prepareDerivedHtmlBranchPresentationSession(context);
    const currentOrdinal = session.branches.find(branch => branch.isCurrentLeaf)!.ordinal;
    const leaf = await session.buildLeaf(currentOrdinal);
    expect(leaf.artifact.bodyBase64).toBe(single.bodyBase64);
    expect(leaf.artifact.sha256).toBe(single.sha256);
    const bad = { ...selected, canonical: { ...selected.canonical, byteLength: 1 } };
    await expect(prepareDerivedHtmlArtifact(bad)).rejects.toMatchObject({
      code: 'derived-html-canonical-length-mismatch',
    });
    await expect(prepareDerivedHtmlBranchPresentationSession(bad)).rejects.toMatchObject({
      code: 'derived-branch-html-canonical-length-mismatch',
    });
  });

  it('keeps raw/transport/provider IDs and message bodies out of the serializable public session, facts, index and receipts', async () => {
    const { context } = setup();
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    const subtype = { ...context };
    for (const key of [
      'targetNodeId',
      'selectedNodeIds',
      'rawCaptureBundle',
      'assetExportContext',
      'destination',
    ])
      Object.defineProperty(subtype, key, { enumerable: true, get: getter });
    const session = await prepareDerivedHtmlBranchPresentationSession(subtype);
    const first = await session.buildLeaf(1);
    const second = await session.buildLeaf(2);
    const index = await session.buildIndex([first.fact, second.fact]);
    const receipt = buildDerivedBranchOutputReceipt(identity(context), first.artifact);
    for (const value of [
      JSON.stringify(session),
      JSON.stringify(first.fact),
      html(index),
      JSON.stringify(receipt),
    ]) {
      expect(value).not.toMatch(
        /PRIVATE|node-current|node-root|node-alternate|bodyBase64|stageId|targetNodeId|selectedNodeIds|rawCapture|assetExportContext/
      );
      expect(value).not.toContain(context.archive.conversation.id);
    }
    expect(Object.keys(session)).toEqual([
      'branches',
      'branchCount',
      'branchPointCount',
      'buildLeaf',
      'buildIndex',
    ]);
    for (const value of [
      session,
      session.branches,
      session.branches[0],
      first,
      first.fact,
      first.fact.diagnostics,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });

  it('renders on demand without caching leaf HTML or redoing canonical validation', async () => {
    const actual = await vi.importActual<typeof import('../../src/archive/presentation')>(
      '../../src/archive/presentation'
    );
    const renderLeaf = vi.fn();
    vi.mocked(prepareArchiveHtmlBranchSession).mockImplementationOnce(input => {
      const prepared = actual.prepareArchiveHtmlBranchSession(input);
      renderLeaf.mockImplementation(prepared.renderLeaf);
      return { ...prepared, renderLeaf };
    });
    const session = await prepareDerivedHtmlBranchPresentationSession(setup().context);
    expect(renderLeaf).not.toHaveBeenCalled();
    const first = await session.buildLeaf(1);
    const repeated = await session.buildLeaf(1);
    expect(renderLeaf).toHaveBeenCalledTimes(2);
    expect(sha256Hex).toHaveBeenCalledTimes(3);
    expect(first).not.toBe(repeated);
    expect(first.fact).not.toBe(repeated.fact);
    expect(first.artifact).not.toBe(repeated.artifact);
    expect(first).toEqual(repeated);
  });

  it('allows null current without inventing a target and reuses the bounded deep/wide B1 path', async () => {
    const { context } = setup('chatgpt', sharedPrefix(1000, 512));
    const session = await prepareDerivedHtmlBranchPresentationSession(context);
    expect(session.branchCount).toBe(512);
    expect(session.branchPointCount).toBe(1);
    expect(session.branches[0]).toMatchObject({
      nodeCount: 1001,
      isCurrentLeaf: false,
      containsCurrentNode: false,
    });
    await session.buildLeaf(1);
    await session.buildLeaf(512);
    expect(sha256Hex).toHaveBeenCalledTimes(3);
    await expect(
      prepareDerivedHtmlBranchPresentationSession(setup('chatgpt', sharedPrefix(1, 513)).context)
    ).rejects.toMatchObject({ code: 'html-branch-count-limit' });
  });

  it('honors tightened branches/traversal/output ceilings and snapshots options before hashing', async () => {
    const { context } = setup();
    await expect(
      prepareDerivedHtmlBranchPresentationSession(context, undefined, { maxBranches: 1 })
    ).rejects.toMatchObject({ code: 'html-branch-count-limit' });
    vi.mocked(sha256Hex).mockClear();
    await expect(
      prepareDerivedHtmlBranchPresentationSession(context, undefined, {
        limits: { maxInputJsonNodes: 1 },
      })
    ).rejects.toMatchObject({ code: 'html-input-node-limit' });
    expect(sha256Hex).not.toHaveBeenCalled();
    const options = { maxBranches: 2, limits: { maxHtmlBytes: 1 } };
    vi.mocked(sha256Hex).mockImplementationOnce(async bytes => {
      options.maxBranches = 1;
      options.limits.maxHtmlBytes = DERIVED_HTML_MAX_BYTES;
      return hash(bytes);
    });
    const session = await prepareDerivedHtmlBranchPresentationSession(context, undefined, options);
    expect(session.branchCount).toBe(2);
    await expect(session.buildLeaf(1)).rejects.toMatchObject({ code: 'html-output-limit' });
    expect(sha256Hex).toHaveBeenCalledTimes(1);
  });

  it.each([0, 513, -1, NaN, 1.5, '2'])('rejects invalid maxBranches=%s', async maxBranches => {
    await expect(
      prepareDerivedHtmlBranchPresentationSession(setup().context, undefined, {
        maxBranches: maxBranches as number,
      })
    ).rejects.toMatchObject({ code: 'html-limits-invalid' });
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it('rejects arbitrary option paths/targets, getters, prototypes and proxy traps value-free', async () => {
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    const accessor = Object.defineProperty({}, 'limits', { enumerable: true, get: getter });
    for (const options of [
      { relativePath: 'PRIVATE.html' },
      { targetNodeId: 'PRIVATE' },
      accessor,
      Object.create({ limits: {} }),
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('PRIVATE');
          },
        }
      ),
    ]) {
      await expect(
        prepareDerivedHtmlBranchPresentationSession(setup().context, undefined, options)
      ).rejects.toEqual(
        new DerivedHtmlBranchPreparationError('derived-branch-html-options-invalid')
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it.each([
    'cloned',
    'reordered',
    'cross-session',
    'mutated',
    'proxy',
    'sparse',
    'array accessor',
    'extra array field',
  ])('accepts only ordered same-session facts, rejecting %s', async mode => {
    const session = await prepareDerivedHtmlBranchPresentationSession(setup().context);
    const first = await session.buildLeaf(1);
    const second = await session.buildLeaf(2);
    const facts = [first.fact, second.fact];
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    if (mode === 'cloned') facts[0] = { ...facts[0] };
    if (mode === 'reordered') facts.reverse();
    if (mode === 'cross-session')
      facts[0] = (
        await (await prepareDerivedHtmlBranchPresentationSession(setup().context)).buildLeaf(1)
      ).fact;
    if (mode === 'mutated') {
      expect(() => Object.assign(first.fact, { ordinal: 2 })).toThrow();
      facts[0] = { ...facts[0], renderedMessageCount: 999 };
    }
    if (mode === 'proxy') facts[0] = new Proxy(facts[0], { get: getter });
    if (mode === 'sparse') delete facts[0];
    if (mode === 'array accessor')
      Object.defineProperty(facts, '0', { get: getter, enumerable: true });
    if (mode === 'extra array field') Object.assign(facts, { extra: true });
    vi.mocked(sha256Hex).mockClear();
    await expect(session.buildIndex(facts)).rejects.toMatchObject({
      code: 'html-branch-facts-invalid',
      message: 'html-branch-facts-invalid',
    });
    expect(sha256Hex).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    'captureId',
    'conversationKey',
    'manifest',
    'canonical',
    'current',
    'context getter',
    'identity getter',
    'body getter',
  ])('fails closed after %s changes during canonical hashing', async mode => {
    const original = setup().context;
    const context = {
      ...original,
      manifest: { ...original.manifest },
      canonical: { ...original.canonical },
    };
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    vi.mocked(sha256Hex).mockImplementationOnce(async bytes => {
      if (mode === 'captureId') context.captureId = 'capture-chatgpt-other';
      if (mode === 'conversationKey') context.conversationKey = 'd'.repeat(64);
      if (mode === 'manifest') context.manifest.byteLength += 1;
      if (mode === 'canonical') context.canonical.byteLength += 1;
      if (mode === 'current') context.archive.conversation.currentNodeId = 'node-root';
      if (mode === 'context getter')
        Object.defineProperty(context, 'source', { get: getter, enumerable: true });
      if (mode === 'identity getter')
        Object.defineProperty(context.archive.conversation, 'id', {
          get: getter,
          enumerable: true,
        });
      if (mode === 'body getter')
        Object.defineProperty(context.archive.conversation, 'title', {
          get: getter,
          enumerable: true,
        });
      return hash(bytes);
    });
    const code =
      mode === 'body getter' ? 'html-input-invalid' : 'derived-branch-html-context-invalid';
    await expect(prepareDerivedHtmlBranchPresentationSession(context)).rejects.toMatchObject({
      code,
      message: code,
    });
    expect(getter).not.toHaveBeenCalled();
    expect(sha256Hex).toHaveBeenCalledTimes(1);
  });

  it.each(['wrong length', 'wrong hash', 'hash rejected', 'serialize rejected'])(
    'stops value-free on canonical %s before B1 preparation',
    async mode => {
      const base = setup().context;
      const context = { ...base, canonical: { ...base.canonical } };
      const codes = {
        'wrong length': 'length-mismatch',
        'wrong hash': 'hash-mismatch',
        'hash rejected': 'hash-failed',
        'serialize rejected': 'serialization-failed',
      };
      if (mode === 'wrong length') context.canonical.byteLength += 1;
      if (mode === 'wrong hash') context.canonical.sha256 = 'f'.repeat(64);
      if (mode === 'hash rejected')
        vi.mocked(sha256Hex).mockRejectedValueOnce(new Error('PRIVATE'));
      if (mode === 'serialize rejected')
        vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
          throw new Error('PRIVATE');
        });
      await expect(prepareDerivedHtmlBranchPresentationSession(context)).rejects.toEqual(
        new DerivedHtmlBranchPreparationError(
          `derived-branch-html-canonical-${codes[mode as keyof typeof codes]}` as 'derived-branch-html-canonical-length-mismatch'
        )
      );
      expect(prepareArchiveHtmlBranchSession).not.toHaveBeenCalled();
    }
  );

  it('preserves empty/null bindings, rejects mismatches and never binds a canonical path by itself', async () => {
    const { context, assetBindings } = await boundSetup();
    const unbound = await prepareDerivedHtmlBranchPresentationSession(context);
    expect(html((await unbound.buildLeaf(1)).artifact)).not.toContain('<img');
    const empty = await prepareDerivedHtmlBranchPresentationSession(context, {
      bindings: [],
      sha256: null,
    });
    expect((await empty.buildLeaf(1)).artifact.assetBindingSha256).toBeNull();
    const mismatch: HtmlAssetBindingSet = {
      ...assetBindings,
      bindings: assetBindings.bindings.map(item => ({
        ...item,
        path: `assets/${'e'.repeat(64)}.png`,
      })),
    };
    await expect(
      prepareDerivedHtmlBranchPresentationSession(context, mismatch)
    ).rejects.toMatchObject({ code: 'html-bindings-invalid' });
  });

  it('rejects a binding digest changed during canonical hashing and snapshots valid bindings for the session', async () => {
    const value = await boundSetup();
    const set = {
      sha256: value.assetBindings.sha256,
      bindings: value.assetBindings.bindings.map(item => ({ ...item })),
    };
    vi.mocked(sha256Hex).mockImplementationOnce(async bytes => {
      set.sha256 = 'f'.repeat(64);
      return hash(bytes);
    });
    await expect(
      prepareDerivedHtmlBranchPresentationSession(value.context, set)
    ).rejects.toMatchObject({ code: 'derived-branch-html-context-invalid' });
    set.sha256 = value.assetBindings.sha256;
    const session = await prepareDerivedHtmlBranchPresentationSession(value.context, set);
    const originalPath = set.bindings[0].path;
    set.bindings[0].path = 'PRIVATE-mutated-path';
    set.sha256 = 'e'.repeat(64);
    const leaf = await session.buildLeaf(1);
    expect(leaf.artifact.assetBindingSha256).toBe(value.assetBindings.sha256);
    expect(html(leaf.artifact)).toContain(`<img src="${originalPath}"`);
    expect(html(leaf.artifact)).not.toContain('PRIVATE-mutated-path');
  });

  it('wraps unexpected session/render exceptions and rejects renderer provenance mismatches before artifact hashing', async () => {
    vi.mocked(prepareArchiveHtmlBranchSession).mockImplementationOnce(() => {
      throw new Error('PRIVATE');
    });
    await expect(prepareDerivedHtmlBranchPresentationSession(setup().context)).rejects.toEqual(
      new DerivedHtmlBranchPreparationError('derived-branch-html-session-failed')
    );
    const actual = await vi.importActual<typeof import('../../src/archive/presentation')>(
      '../../src/archive/presentation'
    );
    for (const mode of ['exception', 'canonical', 'bindings'] as const) {
      vi.mocked(prepareArchiveHtmlBranchSession).mockImplementationOnce(input => {
        const prepared = actual.prepareArchiveHtmlBranchSession(input);
        return {
          ...prepared,
          renderLeaf(ordinal) {
            if (mode === 'exception') throw new Error('PRIVATE');
            const result = prepared.renderLeaf(ordinal);
            return {
              ...result,
              presentation: {
                ...result.presentation,
                ...(mode === 'canonical'
                  ? { canonicalSha256: 'f'.repeat(64) }
                  : { assetBindingSha256: 'f'.repeat(64) }),
              },
            };
          },
        };
      });
      const session = await prepareDerivedHtmlBranchPresentationSession(setup().context);
      vi.mocked(sha256Hex).mockClear();
      await expect(session.buildLeaf(1)).rejects.toMatchObject({
        code:
          mode === 'exception'
            ? 'derived-branch-html-render-failed'
            : 'derived-branch-html-render-provenance-mismatch',
      });
      expect(sha256Hex).not.toHaveBeenCalled();
    }
  });

  it('preserves per-HTML hashing failure without granting a fact or claiming delivery', async () => {
    const session = await prepareDerivedHtmlBranchPresentationSession(setup().context);
    vi.mocked(sha256Hex).mockRejectedValueOnce(new Error('PRIVATE'));
    await expect(session.buildLeaf(1)).rejects.toMatchObject({
      code: 'derived-branch-html-hash-failed',
      message: 'derived-branch-html-hash-failed',
    });
    await expect(session.buildIndex([])).rejects.toMatchObject({
      code: 'html-branch-facts-invalid',
    });
  });

  it.each(['chatgpt', 'deepseek'] as const)(
    'composes finalized %s base → one B2b leaf → one B2a send with independent outcomes',
    async source => {
      const { context, assetBindings } = await boundSetup(source);
      const session = await prepareDerivedHtmlBranchPresentationSession(context, assetBindings);
      const { artifact, fact } = await session.buildLeaf(1);
      const response = buildDerivedBranchHtmlPersistResponse(
        { state: 'confirmed' },
        { state: 'not-dispatched' }
      );
      const send = vi.fn(async () => response);
      const observation = await persistDerivedBranchHtmlArtifactForFile(
        identity(context),
        artifact,
        serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS),
        send
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toMatchObject({
        action: 'persistDerivedBranchHtmlPresentation',
        source,
        captureId: context.captureId,
        outputs: ['file'],
        artifact,
      });
      expect(observation).toEqual({ state: 'observed', response });
      expect(fact).not.toHaveProperty('written');
      expect(session).not.toHaveProperty('complete');
    }
  );
});
