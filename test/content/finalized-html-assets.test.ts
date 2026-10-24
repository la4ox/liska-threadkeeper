// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getNodePath,
  type LiskaThreadArchive,
  type RawCaptureAssetRecord,
} from '../../src/archive';
import { htmlAssetMediaPolicy } from '../../src/archive/presentation/assets';
import {
  buildFinalizedFilePresentationEvidence,
  buildFinalizedFileArchivePresentationEvidence,
  reconcileFinalizedFileArchivePresentationEvidence,
  LISKA_HTML_ASSET_BINDINGS_SCHEMA,
} from '../../src/content/finalized-html-assets';
import { prepareDerivedHtmlBranchPresentationSession } from '../../src/content/derived-branch-html-presentation';
import {
  retainStructuredArchivePresentation,
  retainStructuredPresentation,
} from '../../src/content/structured-presentation';
import * as sha256Module from '../../src/lib/sha256';
import { buildChatGptDestinationArchiveReceipt } from '../../src/content/chatgpt-destination-receipt';
import type {
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  StructuredArchiveSource,
  StructuredPresentationContext,
} from '../../src/lib/types';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const SHA256 = 'b'.repeat(64);
const MANIFEST_SHA256 = 'a'.repeat(64);
const KEY = 'c'.repeat(64);
const PATH = `assets/${SHA256}.png`;
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function companion(archive: LiskaThreadArchive): ArchiveCompanionBundle {
  const canonical = JSON.stringify(archive, null, 2);
  const artifact = (kind: 'raw' | 'manifest' | 'canonical'): ArchiveCompanionArtifact => ({
    kind,
    relativePath:
      kind === 'raw'
        ? 'responses/conversation.json'
        : kind === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json',
    byteLength: kind === 'canonical' ? new TextEncoder().encode(canonical).byteLength : 2,
    sha256: kind === 'canonical' ? hash(canonical) : MANIFEST_SHA256,
    ...(kind === 'manifest'
      ? { transport: 'inline', bodyBase64: 'PRIVATE-RAW-BYTES' }
      : { transport: 'staged', stageId: 'PRIVATE-STAGE-ID' }),
  });
  return {
    captureId: archive.inputs[0].captureId,
    conversationKey: KEY,
    capturedAt: archive.inputs[0].capturedAt,
    artifacts: [artifact('raw'), artifact('manifest'), artifact('canonical')],
  };
}

function record(
  id = 'asset-z',
  mediaType = 'image/png',
  extension = 'png',
  overrides: Partial<RawCaptureAssetRecord> = {}
): RawCaptureAssetRecord {
  return {
    id,
    state: 'fetched',
    attemptedAt: '2026-10-24T08:00:00.000Z',
    relativePath: `assets/${SHA256}.${extension}`,
    mediaType,
    byteLength: 42,
    sha256: SHA256,
    detail: null,
    sourceRefs: [{ artifactId: 'conversation', rawPointer: '/mapping/synthetic' }],
    ...overrides,
  };
}

function setup(
  records: RawCaptureAssetRecord[] = [record()],
  source: StructuredArchiveSource = 'chatgpt'
) {
  const initialArchive = structuredClone(branchingFixture) as LiskaThreadArchive;
  initialArchive.assets = {};
  initialArchive.conversation.provider = source;
  initialArchive.archiveId = `${source}:${initialArchive.conversation.id}`;
  initialArchive.inputs[0].captureId = `capture-${source}-finalized-test`;
  const initialContext = retainStructuredPresentation({
    source,
    archive: initialArchive,
    archiveCompanion: companion(initialArchive),
    targetNodeId: 'node-current',
    selectedNodeIds: getNodePath(initialArchive, 'node-current'),
    includeToolContent: false,
  })!;
  const finalArchive = structuredClone(initialArchive);
  for (const item of records) {
    finalArchive.assets[item.id] = {
      id: item.id,
      filename: null,
      mimeType: item.mediaType,
      byteLength: item.byteLength,
      dimensions: null,
      sha256: item.sha256,
      localArtifactRef: item.relativePath,
      acquisition: { state: 'fetched', attemptedAt: item.attemptedAt, detail: null },
      sourceRefs: [],
      extensions: {},
    };
  }
  const finalCompanion = companion(finalArchive);
  return { initialContext, finalArchive, finalCompanion, records };
}

function build(value = setup()) {
  return buildFinalizedFilePresentationEvidence(
    value.initialContext,
    value.finalArchive,
    value.finalCompanion,
    value.records
  );
}

afterEach(() => vi.restoreAllMocks());

describe('destination-finalized HTML asset binding evidence', () => {
  async function reconciledSetup() {
    const value = setup([record('asset-a'), record('asset-b')]);
    const evidence = (await buildFinalizedFileArchivePresentationEvidence(
      value.initialContext,
      value.finalArchive,
      value.finalCompanion,
      value.records
    ))!;
    const receipt = buildChatGptDestinationArchiveReceipt(value.finalCompanion, 'file', [
      { record: value.records[0], bytes: new Uint8Array(42) },
    ]);
    return { evidence, receipt };
  }

  it('reconciles byte-identical aliases against one physical File receipt and detaches the capability', async () => {
    const { evidence, receipt } = await reconciledSetup();
    expect(receipt.assets).toHaveLength(1);
    const detached = reconcileFinalizedFileArchivePresentationEvidence(evidence, receipt)!;
    expect(detached).toEqual(evidence);
    expect(detached).not.toBe(evidence);
    expect(detached.context).not.toBe(evidence.context);
    expect(detached.context.archive).toBe(evidence.context.archive);
    expect(detached.assetBindings.bindings).toHaveLength(2);
    expect(detached.assetBindings.bindings[0]).not.toBe(evidence.assetBindings.bindings[0]);
    expect(Object.getPrototypeOf(detached.assetBindings.bindings[0])).toBe(Object.prototype);
    for (const item of [
      detached,
      detached.context,
      detached.context.manifest,
      detached.context.canonical,
      detached.assetBindings,
      detached.assetBindings.bindings,
      ...detached.assetBindings.bindings,
    ])
      expect(Object.isFrozen(item)).toBe(true);
  });

  it('keeps reconciled File bindings acceptable to the all-branches renderer', async () => {
    const archive = structuredClone(branchingFixture) as LiskaThreadArchive;
    archive.inputs[0].captureId = 'capture-chatgpt-reconciled-render';
    const asset = archive.assets['asset-synthetic-image'];
    asset.localArtifactRef = PATH;
    const fetched = record('asset-synthetic-image', 'image/png', 'png', {
      attemptedAt: asset.acquisition.attemptedAt,
      sourceRefs: asset.sourceRefs,
    });
    const finalizedCompanion = companion(archive);
    const context = retainStructuredArchivePresentation({
      source: 'chatgpt',
      archive,
      archiveCompanion: finalizedCompanion,
      includeToolContent: true,
    })!;
    const evidence = (await buildFinalizedFileArchivePresentationEvidence(
      context,
      archive,
      finalizedCompanion,
      [fetched]
    ))!;
    const receipt = buildChatGptDestinationArchiveReceipt(finalizedCompanion, 'file', [
      { record: fetched, bytes: new Uint8Array(42) },
    ]);
    const reconciled = reconcileFinalizedFileArchivePresentationEvidence(evidence, receipt)!;

    const session = await prepareDerivedHtmlBranchPresentationSession(
      reconciled.context,
      reconciled.assetBindings
    );
    expect(session.branchCount).toBe(2);
    await expect(session.buildLeaf(1)).resolves.toMatchObject({
      artifact: { role: 'leaf', ordinal: 1 },
    });
  });

  it.each([
    'destination',
    'captureId',
    'conversationKey',
    'manifestHash',
    'manifestLength',
    'canonicalLength',
  ] as const)('rejects mismatched receipt %s', async field => {
    const { evidence, receipt } = await reconciledSetup();
    if (field === 'destination') receipt.destination = 'obsidian';
    if (field === 'captureId') receipt.captureId += '-other';
    if (field === 'conversationKey') receipt.conversationKey = 'e'.repeat(64);
    if (field === 'manifestHash') receipt.manifestSha256 = 'e'.repeat(64);
    if (field === 'manifestLength') receipt.archiveByteLengths.manifest += 1;
    if (field === 'canonicalLength') receipt.archiveByteLengths.canonical += 1;
    expect(reconcileFinalizedFileArchivePresentationEvidence(evidence, receipt)).toBeUndefined();
  });

  it.each([
    'path',
    'hash',
    'mime',
    'length',
    'missing-receipt',
    'missing-binding',
    'missing-supported-asset',
  ] as const)('rejects File asset/binding disagreement: %s', async field => {
    const { evidence, receipt } = await reconciledSetup();
    if (field === 'path') receipt.assets[0].relativePath = `assets/${'c'.repeat(64)}.png`;
    if (field === 'hash') receipt.assets[0].sha256 = 'c'.repeat(64);
    if (field === 'mime') receipt.assets[0].mediaType = 'image/jpeg';
    if (field === 'length') receipt.assets[0].byteLength += 1;
    if (field === 'missing-receipt') receipt.assets = [];
    const input =
      field === 'missing-binding'
        ? { ...evidence, assetBindings: { bindings: [], sha256: null } }
        : evidence;
    if (field === 'missing-supported-asset')
      receipt.assets.push({
        sha256: 'c'.repeat(64),
        relativePath: `assets/${'c'.repeat(64)}.pdf`,
        mediaType: 'application/pdf',
        byteLength: 10,
      });
    expect(reconcileFinalizedFileArchivePresentationEvidence(input, receipt)).toBeUndefined();
  });

  it('reads stateful context and binding descriptors once and passes the same detached capability onward', async () => {
    const { evidence, receipt } = await reconciledSetup();
    const propertyReads = vi.fn(() => {
      throw new Error('ordinary read forbidden');
    });
    const observed: Array<{ key: string | symbol; count: number }> = [];
    const wrap = <T extends object>(target: T): T => {
      const counts = new Map<string | symbol, number>();
      return new Proxy(target, {
        get: propertyReads,
        getOwnPropertyDescriptor(object, key) {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          observed.push({ key, count });
          if (count > 1) throw new Error('second descriptor read');
          return Reflect.getOwnPropertyDescriptor(object, key);
        },
      });
    };
    const input = wrap({
      context: wrap({
        ...evidence.context,
        manifest: wrap({ ...evidence.context.manifest }),
        canonical: wrap({ ...evidence.context.canonical }),
      }),
      assetBindings: wrap({
        sha256: evidence.assetBindings.sha256,
        bindings: wrap(evidence.assetBindings.bindings.map(binding => wrap({ ...binding }))),
      }),
    });
    const detached = reconcileFinalizedFileArchivePresentationEvidence(input, receipt);
    expect(detached).toEqual(evidence);
    expect(propertyReads).not.toHaveBeenCalled();
    expect(observed.every(row => row.count === 1)).toBe(true);
    expect(reconcileFinalizedFileArchivePresentationEvidence(detached!, receipt)).toEqual(evidence);
    expect(propertyReads).not.toHaveBeenCalled();
  });
  it.each(['chatgpt', 'deepseek'] as const)(
    'shares exactly one binding digest between the %s base and selected APIs',
    async source => {
      const value = setup([record('asset-a'), record('asset-b')], source);
      const digest = vi.spyOn(sha256Module, 'sha256Hex');
      const base = (await buildFinalizedFileArchivePresentationEvidence(
        value.initialContext,
        value.finalArchive,
        value.finalCompanion,
        value.records
      ))!;
      expect(digest).toHaveBeenCalledTimes(1);
      const selected = (await build(value))!;
      expect(digest).toHaveBeenCalledTimes(2);
      expect(base.assetBindings).toEqual(selected.assetBindings);
      expect(base.context.archive).toBe(value.finalArchive);
      expect(base.context.canonical).toEqual(selected.context.canonical);
      const { targetNodeId, selectedNodeIds, ...selectedBase } = selected.context;
      expect(targetNodeId).toBe(value.initialContext.targetNodeId);
      expect(selectedNodeIds).toEqual(value.initialContext.selectedNodeIds);
      expect(base.context).toEqual(selectedBase);
      for (const item of [
        base,
        base.context,
        base.context.manifest,
        base.context.canonical,
        base.assetBindings,
        base.assetBindings.bindings,
        base.assetBindings.bindings[0],
      ])
        expect(Object.isFrozen(item)).toBe(true);
      value.records[0].relativePath = 'mutated';
      value.finalCompanion.artifacts[2]!.sha256 = 'f'.repeat(64);
      expect(base.assetBindings.bindings[0].path).toBe(PATH);
      expect(base.context.canonical.sha256).not.toBe('f'.repeat(64));
    }
  );

  it('retains final base evidence with no current/selected node and does not read selected/runtime metadata', async () => {
    const value = setup();
    value.finalArchive.conversation.currentNodeId = null;
    value.finalCompanion = companion(value.finalArchive);
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    const initial = { ...value.initialContext };
    for (const key of ['targetNodeId', 'selectedNodeIds', 'assetExportContext', 'rawCaptureBundle'])
      Object.defineProperty(initial, key, { get: getter, enumerable: true });
    const evidence = await buildFinalizedFileArchivePresentationEvidence(
      initial,
      value.finalArchive,
      value.finalCompanion,
      value.records
    );
    expect(evidence?.context.archive.conversation.currentNodeId).toBeNull();
    expect(evidence?.context).not.toHaveProperty('targetNodeId');
    expect(evidence?.context).not.toHaveProperty('selectedNodeIds');
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    'unsupported',
    'missing File confirmation',
    'mismatch',
    'alias conflict',
    'duplicate record',
    'stale key',
  ])(
    'shares base reconciliation for %s instead of granting File authority from unrelated observations',
    async kind => {
      const value = setup(
        kind === 'unsupported'
          ? [record('asset-a', 'text/html', 'html')]
          : [record('asset-a'), record('asset-b')]
      );
      if (kind === 'missing File confirmation') {
        value.records = [];
        Object.assign((value.initialContext = { ...value.initialContext }), {
          obsidianRecords: [record('asset-a'), record('asset-b')],
        });
      }
      if (kind === 'mismatch') value.records[0].byteLength = 99;
      if (kind === 'alias conflict') {
        value.records[1].byteLength = 99;
        value.finalArchive.assets['asset-b'].byteLength = 99;
      }
      if (kind === 'duplicate record') value.records.push(value.records[0]);
      if (kind === 'stale key') value.finalCompanion.conversationKey = 'f'.repeat(64);
      const result = await buildFinalizedFileArchivePresentationEvidence(
        value.initialContext,
        value.finalArchive,
        value.finalCompanion,
        value.records
      );
      if (kind === 'unsupported')
        expect(result?.assetBindings).toEqual({ bindings: [], sha256: null });
      else expect(result).toBeUndefined();
    }
  );
  it('uses one fixed schema and a golden UTF-8 digest with code-unit ID ordering', async () => {
    const value = setup([record('asset-z'), record('asset-a'), record('asset-Z')]);
    const evidence = (await build(value))!;
    expect(LISKA_HTML_ASSET_BINDINGS_SCHEMA).toBe('liska-html-asset-bindings/1');
    expect(evidence.assetBindings.bindings).toEqual(
      ['asset-Z', 'asset-a', 'asset-z'].map(assetId => ({
        assetId,
        path: PATH,
        sha256: SHA256,
        mimeType: 'image/png',
        byteLength: 42,
        renderMode: 'image',
      }))
    );
    const exact =
      JSON.stringify({
        schema: 'liska-html-asset-bindings/1',
        bindings: evidence.assetBindings.bindings,
      }) + '\n';
    expect(evidence.assetBindings.sha256).toBe(hash(exact));
    expect(evidence.assetBindings.sha256).toBe(
      'e8ab95cbf3e6ecf8b365feb0d39ec864c7677a3f38508b25bb5877b57cd1efe4'
    );
    expect(Object.keys(evidence.assetBindings.bindings[0])).toEqual([
      'assetId',
      'path',
      'sha256',
      'mimeType',
      'byteLength',
      'renderMode',
    ]);
  });

  it('ignores input enumeration/key order and never uses locale sorting', async () => {
    const first = setup([record('asset-z'), record('asset-A')]);
    const second = setup([record('asset-A'), record('asset-z')]);
    second.records = second.records.map(
      item => Object.fromEntries(Object.entries(item).reverse()) as unknown as RawCaptureAssetRecord
    );
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
      throw new Error('locale sorting must not run');
    });
    expect((await build(first))?.assetBindings).toEqual((await build(second))?.assetBindings);
    expect(localeCompare).not.toHaveBeenCalled();
  });

  it.each(['chatgpt', 'deepseek'] as const)(
    'rebinds %s final descriptors/path/profile while retaining only the final archive reference',
    async source => {
      const value = setup([record()], source);
      const evidence = (await build(value))!;
      expect(evidence.context.archive).toBe(value.finalArchive);
      expect(evidence.context.archive).not.toBe(value.initialContext.archive);
      expect(evidence.context.canonical.sha256).not.toBe(value.initialContext.canonical.sha256);
      expect(evidence.context).toMatchObject({
        source,
        captureId: value.initialContext.captureId,
        conversationKey: KEY,
        targetNodeId: value.initialContext.targetNodeId,
        selectedNodeIds: value.initialContext.selectedNodeIds,
        includeToolContent: false,
      });
      expect(evidence.context.canonical).toEqual({
        kind: 'canonical',
        relativePath: 'canonical/liska-thread-1.json',
        mediaType: 'application/json',
        byteLength: value.finalCompanion.artifacts[2]!.byteLength,
        sha256: value.finalCompanion.artifacts[2]!.sha256,
      });
    }
  );

  it('returns an empty/null binding set without hashing, including non-fetched canonical assets', async () => {
    const value = setup();
    const asset = value.finalArchive.assets['asset-z'];
    asset.acquisition.state = 'not-attempted';
    asset.localArtifactRef = asset.sha256 = null;
    asset.byteLength = null;
    value.records = [];
    const digest = vi.spyOn(sha256Module, 'sha256Hex');
    expect((await build(value))?.assetBindings).toEqual({ bindings: [], sha256: null });
    expect(digest).not.toHaveBeenCalled();
    expect((await build(setup([])))?.assetBindings).toEqual({ bindings: [], sha256: null });
  });

  it.each([
    ['image/png', 'png', 'image'],
    ['image/jpeg', 'jpg', 'image'],
    ['image/gif', 'gif', 'image'],
    ['image/webp', 'webp', 'image'],
    ['image/avif', 'avif', 'download'],
    ['image/bmp', 'bmp', 'download'],
    ['application/pdf', 'pdf', 'download'],
    ['application/octet-stream', 'bin', 'download'],
    ['application/json', 'json', 'download'],
    ['application/rtf', 'rtf', 'download'],
    ['application/zip', 'zip', 'download'],
    ['text/plain', 'txt', 'download'],
    ['text/csv', 'csv', 'download'],
    ['audio/mpeg', 'mp3', 'download'],
    ['audio/mp4', 'm4a', 'download'],
    ['audio/ogg', 'ogg', 'download'],
    ['audio/wav', 'wav', 'download'],
    ['video/mp4', 'mp4', 'download'],
    ['video/webm', 'webm', 'download'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'download'],
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'pptx',
      'download',
    ],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 'download'],
  ])('binds %s only in its shared %s/%s mode', async (mimeType, extension, renderMode) => {
    expect(htmlAssetMediaPolicy(mimeType)).toEqual({ extension, renderMode });
    const evidence = (await build(setup([record('asset-a', mimeType, extension)])))!;
    expect(evidence.assetBindings.bindings[0]).toMatchObject({ mimeType, renderMode });
  });

  it.each([
    ['image/svg+xml', 'svg'],
    ['text/html', 'html'],
    ['application/javascript', 'js'],
    ['application/x-unsupported', 'bin'],
  ])('reconciles fetched unsupported %s but never binds it', async (mimeType, extension) => {
    const value = setup([record('unsupported', mimeType, extension)]);
    const digest = vi.spyOn(sha256Module, 'sha256Hex');
    expect(htmlAssetMediaPolicy(mimeType)).toBeUndefined();
    expect((await build(value))?.assetBindings).toEqual({ bindings: [], sha256: null });
    expect(digest).not.toHaveBeenCalled();
    value.records = [];
    expect(await build(value)).toBeUndefined();
    value.records = [record('unsupported', mimeType, extension, { byteLength: 99 })];
    expect(await build(value)).toBeUndefined();
  });

  it.each([
    ['relativePath', null],
    ['relativePath', `assets/${SHA256}.jpg`],
    ['relativePath', `https://example.test/${SHA256}.png`],
    ['relativePath', `assets/../${SHA256}.png`],
    ['mediaType', null],
    ['mediaType', 'image/jpeg'],
    ['mediaType', 'image/PNG'],
    ['mediaType', 'image/png; charset=utf-8'],
    ['sha256', null],
    ['sha256', 'd'.repeat(64)],
    ['sha256', 'B'.repeat(64)],
    ['byteLength', null],
    ['byteLength', 41],
    ['byteLength', -1],
    ['byteLength', 1.5],
    ['byteLength', Number.MAX_SAFE_INTEGER + 1],
    ['state', 'failed'],
    ['id', 'other-asset'],
  ])('fails closed for malformed/mismatched descriptor %s=%s', async (field, replacement) => {
    const value = setup();
    Object.assign(value.records[0], { [field]: replacement });
    expect(await build(value)).toBeUndefined();
  });

  it.each([null, `assets/${SHA256}.jpg`, 'https://example.test/private.png'])(
    'requires the exact canonical localArtifactRef, not merely identical byte metadata: %s',
    async path => {
      const value = setup();
      value.finalArchive.assets['asset-z'].localArtifactRef = path;
      expect(await build(value)).toBeUndefined();
    }
  );

  it('rejects missing, extra, duplicate, wrong-state and map-key/ID-inconsistent descriptors', async () => {
    const missing = setup();
    missing.records = [];
    const extra = setup();
    extra.records.push(record('extra'));
    const duplicate = setup();
    duplicate.records.push({ ...duplicate.records[0] });
    const wrongState = setup();
    wrongState.finalArchive.assets['asset-z'].acquisition.state = 'failed';
    const wrongId = setup();
    wrongId.finalArchive.assets['asset-z'].id = 'other';
    for (const value of [missing, extra, duplicate, wrongState, wrongId])
      expect(await build(value)).toBeUndefined();
  });

  it('allows byte-identical aliases to share one local path but rejects conflicting aliases', async () => {
    const aliases = setup([record('alias-a'), record('alias-b')]);
    const evidence = (await build(aliases))!;
    expect(evidence.assetBindings.bindings).toHaveLength(2);
    expect(evidence.assetBindings.bindings.map(item => item.path)).toEqual([PATH, PATH]);
    aliases.records[1].byteLength = 99;
    aliases.finalArchive.assets['alias-b'].byteLength = 99;
    expect(await build(aliases)).toBeUndefined();

    const unsupported = setup([
      record('alias-a', 'application/x-first', 'bin'),
      record('alias-b', 'application/x-second', 'bin'),
    ]);
    expect(await build(unsupported)).toBeUndefined();
  });

  it.each(['capture', 'key', 'provider', 'manifest', 'canonical path', 'target', 'selected path'])(
    'rejects stale %s instead of retaining the initial pre-finalization context',
    async field => {
      const value = setup();
      if (field === 'capture') {
        value.finalCompanion.captureId = 'capture-chatgpt-other';
        value.finalArchive.inputs[0].captureId = value.finalCompanion.captureId;
      }
      if (field === 'key') value.finalCompanion.conversationKey = 'd'.repeat(64);
      if (field === 'provider') value.finalArchive.conversation.provider = 'deepseek';
      if (field === 'manifest') value.finalArchive.inputs[0].manifestSha256 = 'd'.repeat(64);
      if (field === 'canonical path')
        value.finalCompanion.artifacts[2]!.relativePath = 'canonical/stale.json';
      if (field === 'target') delete value.finalArchive.graph.nodes['node-current'];
      if (field === 'selected path')
        value.initialContext = { ...value.initialContext, selectedNodeIds: ['node-current'] };
      expect(await build(value)).toBeUndefined();
    }
  );

  it('retains an explicit alternate leaf and tool-content profile without following provider current', async () => {
    const value = setup();
    value.initialContext = {
      ...value.initialContext,
      targetNodeId: 'node-alternate',
      selectedNodeIds: getNodePath(value.finalArchive, 'node-alternate'),
      includeToolContent: true,
    };
    expect((await build(value))?.context).toMatchObject({
      targetNodeId: 'node-alternate',
      selectedNodeIds: getNodePath(value.finalArchive, 'node-alternate'),
      includeToolContent: true,
    });
  });

  it('detaches/freezes exact scalar records and does not retain runtime, raw, stage, filename or output evidence', async () => {
    const value = setup();
    const unused = vi.fn(() => {
      throw new Error('private runtime must not be read');
    });
    value.initialContext = {
      ...value.initialContext,
      assetExportContext: { rawCaptureBundle: 'PRIVATE-RAW', destination: 'PRIVATE-VAULT' },
    } as StructuredPresentationContext;
    Object.defineProperty(value.records[0], 'providerFilename', { get: unused });
    Object.defineProperty(value.finalCompanion.artifacts[0], 'bodyBase64', { get: unused });
    const evidence = (await build(value))!;
    expect(unused).not.toHaveBeenCalled();
    expect(Object.keys(evidence)).toEqual(['context', 'assetBindings']);
    expect(Object.keys(evidence.context)).toEqual([
      'source',
      'archive',
      'captureId',
      'conversationKey',
      'manifest',
      'canonical',
      'targetNodeId',
      'selectedNodeIds',
      'includeToolContent',
    ]);
    expect(Object.keys(evidence.context.manifest)).toEqual([
      'kind',
      'relativePath',
      'mediaType',
      'byteLength',
      'sha256',
    ]);
    const detached = evidence.assetBindings.bindings[0];
    value.records[0].relativePath = 'mutated';
    value.finalCompanion.artifacts[2]!.sha256 = 'f'.repeat(64);
    expect(detached.path).toBe(PATH);
    expect(evidence.context.canonical.sha256).not.toBe('f'.repeat(64));
    for (const item of [
      evidence,
      evidence.context,
      evidence.assetBindings,
      evidence.assetBindings.bindings,
      detached,
    ])
      expect(Object.isFrozen(item)).toBe(true);
    expect(
      JSON.stringify({ ...evidence, context: { ...evidence.context, archive: undefined } })
    ).not.toMatch(/PRIVATE|stageId|bodyBase64|providerFilename|destination|rawCapture/);
  });

  it.each(['context', 'companion', 'artifact', 'record', 'archive', 'array', 'path'])(
    'rejects used accessor tricks in %s without invoking the getter',
    async location => {
      const value = setup();
      const getter = vi.fn(() => {
        throw new Error('private-getter-error');
      });
      if (location === 'context') {
        value.initialContext = { ...value.initialContext };
        Object.defineProperty(value.initialContext, 'source', { get: getter, enumerable: true });
      }
      if (location === 'companion')
        Object.defineProperty(value.finalCompanion, 'capturedAt', {
          get: getter,
          enumerable: true,
        });
      if (location === 'artifact')
        Object.defineProperty(value.finalCompanion.artifacts[2], 'sha256', {
          get: getter,
          enumerable: true,
        });
      if (location === 'record')
        Object.defineProperty(value.records[0], 'sha256', { get: getter, enumerable: true });
      if (location === 'archive')
        Object.defineProperty(value.finalArchive.assets['asset-z'], 'localArtifactRef', {
          get: getter,
          enumerable: true,
        });
      if (location === 'array')
        Object.defineProperty(value.records, '0', { get: getter, enumerable: true });
      if (location === 'path') {
        const path = [...value.initialContext.selectedNodeIds];
        Object.defineProperty(path, '0', { get: getter, enumerable: true });
        value.initialContext = { ...value.initialContext, selectedNodeIds: path };
      }
      expect(await build(value)).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it.each(['context', 'companion', 'record', 'archive', 'array', 'sparse'])(
    'rejects inherited, custom-prototype or sparse %s evidence',
    async location => {
      const value = setup();
      if (location === 'context') value.initialContext = Object.create(value.initialContext);
      if (location === 'companion') value.finalCompanion = Object.create(value.finalCompanion);
      if (location === 'record') value.records[0] = Object.create(value.records[0]);
      if (location === 'archive')
        Object.setPrototypeOf(value.finalArchive.assets, { inherited: true });
      if (location === 'array')
        Object.setPrototypeOf(value.records, Object.create(Array.prototype));
      if (location === 'sparse') delete value.records[0];
      expect(await build(value)).toBeUndefined();
    }
  );

  it('returns value-free undefined for rejected hashing and malformed final structures', async () => {
    vi.spyOn(sha256Module, 'sha256Hex').mockRejectedValue(new Error('PRIVATE-CRYPTO-DETAIL'));
    expect(await build()).toBeUndefined();
    const value = setup();
    value.finalArchive.assets = null as unknown as LiskaThreadArchive['assets'];
    expect(await build(value)).toBeUndefined();
  });

  it.each([null, 1, [], 'malformed', { asset: null }, { asset: {} }])(
    'rejects a malformed canonical asset map without creating empty success: %j',
    async assets => {
      const value = setup([]);
      value.finalArchive.assets = assets as unknown as LiskaThreadArchive['assets'];
      expect(await build(value)).toBeUndefined();
    }
  );

  it('rejects unknown acquisition states even without a matching confirmed descriptor', async () => {
    const value = setup();
    value.finalArchive.assets['asset-z'].acquisition.state = 'invalid' as 'failed';
    value.records = [];
    expect(await build(value)).toBeUndefined();
  });
});
