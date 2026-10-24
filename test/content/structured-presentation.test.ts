import { describe, expect, it, vi } from 'vitest';
import type { LiskaThreadArchive } from '../../src/archive';
import { retainStructuredPresentation } from '../../src/content/structured-presentation';
import type {
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  StructuredArchiveSource,
} from '../../src/lib/types';

const CAPTURE_ID = 'capture-chatgpt-structured-context';
const MANIFEST_SHA256 = 'b'.repeat(64);
const CONVERSATION_KEY = 'a'.repeat(64);

function captureId(source: StructuredArchiveSource): string {
  return `capture-${source}-structured-context`;
}

function archive(source: StructuredArchiveSource = 'chatgpt'): LiskaThreadArchive {
  const conversationId = `${source}-conversation`;
  return {
    schema: 'liska-thread/1',
    archiveId: `${source}:${conversationId}`,
    inputs: [
      {
        captureId: captureId(source),
        manifestSha256: MANIFEST_SHA256,
        normalizer: `${source}/1`,
        capturedAt: '2026-10-24T05:00:00.000Z',
        sourceRefs: [],
        extensions: {},
      },
    ],
    conversation: {
      id: conversationId,
      title: 'Structured context fixture',
      provider: source,
      url: null,
      currentNodeId: 'current',
      createdAt: null,
      updatedAt: null,
      metadata: {},
      sourceRefs: [],
      extensions: {},
    },
    graph: {
      rootIds: ['root'],
      nodes: {
        root: { id: 'root', parentId: null, childIds: ['user'], sourceRefs: [], extensions: {} },
        user: {
          id: 'user',
          parentId: 'root',
          childIds: ['current', 'alternate'],
          sourceRefs: [],
          extensions: {},
        },
        current: {
          id: 'current',
          parentId: 'user',
          childIds: [],
          sourceRefs: [],
          extensions: {},
        },
        alternate: {
          id: 'alternate',
          parentId: 'user',
          childIds: [],
          sourceRefs: [],
          extensions: {},
        },
      },
    },
    assets: {},
    diagnostics: { entries: [], extensions: {} },
    extensions: {},
  };
}

function artifact(
  kind: ArchiveCompanionArtifact['kind'],
  overrides: Partial<ArchiveCompanionArtifact> = {}
): ArchiveCompanionArtifact {
  return {
    transport: 'inline',
    kind,
    relativePath:
      kind === 'raw'
        ? 'responses/conversation.json'
        : kind === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json',
    byteLength: 2,
    sha256:
      kind === 'manifest'
        ? MANIFEST_SHA256
        : kind === 'canonical'
          ? 'c'.repeat(64)
          : 'd'.repeat(64),
    bodyBase64: 'e30=',
    ...overrides,
  } as ArchiveCompanionArtifact;
}

function companion(
  source: StructuredArchiveSource = 'chatgpt',
  value: LiskaThreadArchive = archive(source)
): ArchiveCompanionBundle {
  return {
    captureId: captureId(source),
    conversationKey: CONVERSATION_KEY,
    capturedAt: '2026-10-24T05:00:00.000Z',
    artifacts: [
      artifact('raw'),
      artifact('manifest'),
      artifact('canonical', {
        byteLength: new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength,
      }),
    ],
  };
}

function retain(
  source: StructuredArchiveSource,
  value: LiskaThreadArchive,
  evidence: ArchiveCompanionBundle,
  targetNodeId = 'current',
  selectedNodeIds: string[] = ['root', 'user', targetNodeId]
) {
  return retainStructuredPresentation({
    source,
    archive: value,
    archiveCompanion: evidence,
    targetNodeId,
    selectedNodeIds,
    includeToolContent: true,
  });
}

describe('provider-neutral structured presentation retention', () => {
  it.each([
    ['chatgpt', 'current', ['root', 'user', 'current']],
    ['chatgpt', 'alternate', ['root', 'user', 'alternate']],
    ['deepseek', 'current', ['root', 'user', 'current']],
  ] as const)('retains an exact %s structured path to %s', (source, target, path) => {
    const value = archive(source);
    const context = retain(source, value, companion(source, value), target, [...path]);

    expect(context).toMatchObject({
      source,
      archive: value,
      captureId: captureId(source),
      conversationKey: CONVERSATION_KEY,
      manifest: { kind: 'manifest', relativePath: 'manifest.json', sha256: MANIFEST_SHA256 },
      canonical: { kind: 'canonical', relativePath: 'canonical/liska-thread-1.json' },
      targetNodeId: target,
      selectedNodeIds: path,
      includeToolContent: true,
    });
    expect(context?.archive).toBe(value);
  });

  it.each([
    [
      'missing manifest',
      (items: ArchiveCompanionArtifact[]) => items.filter(item => item.kind !== 'manifest'),
    ],
    [
      'missing canonical',
      (items: ArchiveCompanionArtifact[]) => items.filter(item => item.kind !== 'canonical'),
    ],
    ['duplicate manifest', (items: ArchiveCompanionArtifact[]) => [...items, artifact('manifest')]],
    [
      'duplicate canonical',
      (items: ArchiveCompanionArtifact[]) => [...items, artifact('canonical')],
    ],
  ])('fails closed for %s evidence', (_label, mutate) => {
    const evidence = companion();
    evidence.artifacts = mutate([...evidence.artifacts]) as ArchiveCompanionBundle['artifacts'];
    expect(retain('chatgpt', archive(), evidence)).toBeUndefined();
  });

  it.each([
    ['manifest path', 'manifest', { relativePath: 'other.json' }],
    ['canonical path', 'canonical', { relativePath: 'canonical/other.json' }],
    ['manifest media', 'manifest', { mediaType: 'text/json' }],
    ['canonical media', 'canonical', { mediaType: 'text/json' }],
    ['manifest hash', 'manifest', { sha256: 'A'.repeat(64) }],
    ['canonical hash', 'canonical', { sha256: 'not-a-digest' }],
    ['manifest length', 'manifest', { byteLength: 0 }],
    ['canonical length', 'canonical', { byteLength: -1 }],
  ] as const)('rejects a wrong fixed %s', (_label, kind, overrides) => {
    const evidence = companion();
    evidence.artifacts = evidence.artifacts.map(item =>
      item.kind === kind ? artifact(kind, overrides as Partial<ArchiveCompanionArtifact>) : item
    ) as ArchiveCompanionBundle['artifacts'];
    expect(retain('chatgpt', archive(), evidence)).toBeUndefined();
  });

  it('binds provider, capture, manifest, opaque conversation, and archive conversation identities', () => {
    const mutations: Array<
      () => [StructuredArchiveSource, LiskaThreadArchive, ArchiveCompanionBundle]
    > = [
      () => ['deepseek', archive('chatgpt'), companion()],
      () => {
        const value = archive();
        value.inputs[0].captureId = 'capture-chatgpt-other';
        return ['chatgpt', value, companion()];
      },
      () => {
        const value = archive();
        value.inputs[0].manifestSha256 = 'e'.repeat(64);
        return ['chatgpt', value, companion()];
      },
      () => {
        const evidence = companion();
        evidence.conversationKey = 'not-an-opaque-key';
        return ['chatgpt', archive(), evidence];
      },
      () => {
        const value = archive();
        value.archiveId = 'chatgpt:other-conversation';
        return ['chatgpt', value, companion()];
      },
      () => {
        const evidence = companion();
        evidence.capturedAt = '2026-10-24T05:00:01.000Z';
        return ['chatgpt', archive(), evidence];
      },
    ];

    for (const mutate of mutations) {
      const [source, value, evidence] = mutate();
      expect(retain(source, value, evidence)).toBeUndefined();
    }
  });

  it.each([
    ['chatgpt', 240],
    ['deepseek', 236],
  ] as const)('uses the established %s capture suffix bound', (source, suffixLength) => {
    const value = archive(source);
    const exactCaptureId = `capture-${source}-${'a'.repeat(suffixLength)}`;
    value.inputs[0].captureId = exactCaptureId;
    const evidence = companion(source, value);
    evidence.captureId = exactCaptureId;
    expect(retain(source, value, evidence)).toBeDefined();

    const oversized = archive(source);
    const oversizedCaptureId = `${exactCaptureId}a`;
    oversized.inputs[0].captureId = oversizedCaptureId;
    const oversizedEvidence = companion(source, oversized);
    oversizedEvidence.captureId = oversizedCaptureId;
    expect(retain(source, oversized, oversizedEvidence)).toBeUndefined();
  });

  it.each([
    ['wrong order', 'current', ['root', 'current', 'user']],
    ['wrong terminal target', 'alternate', ['root', 'user', 'current']],
    ['missing ancestor', 'current', ['user', 'current']],
    ['unknown target', 'missing', ['root', 'user', 'missing']],
  ])('rejects a selected path with %s', (_label, target, path) => {
    expect(retain('chatgpt', archive(), companion(), target, path)).toBeUndefined();
  });

  it('rejects an archive whose declared current node is not a graph member', () => {
    const value = archive();
    value.conversation.currentNodeId = 'missing';
    expect(retain('chatgpt', value, companion())).toBeUndefined();
  });

  it('retains an explicit selected leaf when the provider declares no current node', () => {
    const value = archive();
    value.conversation.currentNodeId = null;
    const evidence = companion('chatgpt', value);

    expect(
      retain('chatgpt', value, evidence, 'alternate', ['root', 'user', 'alternate'])
    ).toMatchObject({
      targetNodeId: 'alternate',
      selectedNodeIds: ['root', 'user', 'alternate'],
    });
  });

  it('does not reserialize or UTF-8 encode the canonical archive during context retention', () => {
    const value = archive();
    const evidence = companion('chatgpt', value);
    const stringify = vi.spyOn(JSON, 'stringify');
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      expect(retain('chatgpt', value, evidence)).toBeDefined();
      expect(stringify).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
      encode.mockRestore();
    }
  });

  it.each(['conversation key', 'canonical digest'])(
    'rejects a coercible %s without invoking caller behavior',
    field => {
      const value = archive();
      const evidence = companion('chatgpt', value);
      const coerce = vi.fn(() => 'a'.repeat(64));
      const coercible = { toString: coerce } as unknown as string;
      if (field === 'conversation key') evidence.conversationKey = coercible;
      else evidence.artifacts.find(item => item.kind === 'canonical')!.sha256 = coercible;

      expect(retain('chatgpt', value, evidence)).toBeUndefined();
      expect(coerce).not.toHaveBeenCalled();
    }
  );

  it('detaches and freezes scalar/path metadata while retaining the archive reference', () => {
    const value = archive();
    const evidence = companion();
    const selectedNodeIds = ['root', 'user', 'current'];
    const context = retain('chatgpt', value, evidence, 'current', selectedNodeIds)!;

    selectedNodeIds[0] = 'mutated';
    evidence.captureId = 'capture-chatgpt-mutated';
    evidence.artifacts[1].relativePath = 'mutated.json';
    evidence.artifacts[2].sha256 = 'f'.repeat(64);

    expect(context.archive).toBe(value);
    expect(context.captureId).toBe(CAPTURE_ID);
    expect(context.selectedNodeIds).toEqual(['root', 'user', 'current']);
    expect(context.manifest.relativePath).toBe('manifest.json');
    expect(context.canonical.sha256).toBe('c'.repeat(64));
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.selectedNodeIds)).toBe(true);
    expect(Object.isFrozen(context.manifest)).toBe(true);
    expect(Object.isFrozen(context.canonical)).toBe(true);
    expect(context).not.toHaveProperty('rawCaptureBundle');
    expect(context).not.toHaveProperty('destination');
  });
});
