import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNodePath, type LiskaThreadArchive } from '../../src/archive';
import { renderArchiveText } from '../../src/archive/presentation';
import { retainStructuredPresentation } from '../../src/content/structured-presentation';
import { prepareDerivedTextArtifact } from '../../src/content/derived-text-presentation';
import { base64ToBytes } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/lib/sha256';
import type {
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  StructuredPresentationContext,
} from '../../src/lib/types';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

vi.mock('../../src/archive/presentation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/archive/presentation')>();
  return { ...actual, renderArchiveText: vi.fn(actual.renderArchiveText) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(renderArchiveText).mockClear();
});

async function context(): Promise<StructuredPresentationContext> {
  const archive = structuredClone(branchingFixture) as LiskaThreadArchive;
  archive.inputs[0].captureId = 'capture-chatgpt-text-test';
  const canonicalBytes = new TextEncoder().encode(JSON.stringify(archive, null, 2));
  const canonicalSha256 = await sha256Hex(canonicalBytes);
  const artifact = (kind: 'raw' | 'manifest' | 'canonical'): ArchiveCompanionArtifact => ({
    kind,
    relativePath:
      kind === 'raw'
        ? 'responses/conversation.json'
        : kind === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json',
    byteLength: kind === 'canonical' ? canonicalBytes.byteLength : 2,
    sha256:
      kind === 'canonical'
        ? canonicalSha256
        : kind === 'manifest'
          ? archive.inputs[0].manifestSha256
          : 'c'.repeat(64),
    transport: 'inline',
    bodyBase64: 'e30=',
  });
  const archiveCompanion: ArchiveCompanionBundle = {
    captureId: archive.inputs[0].captureId,
    conversationKey: 'b'.repeat(64),
    artifacts: [artifact('raw'), artifact('manifest'), artifact('canonical')],
  };
  return retainStructuredPresentation({
    source: 'chatgpt',
    archive,
    archiveCompanion,
    includeToolContent: false,
    targetNodeId: archive.conversation.currentNodeId!,
    selectedNodeIds: getNodePath(archive, archive.conversation.currentNodeId!),
  })!;
}

describe('derived text exact-canonical integration', () => {
  it('builds verifiable UTF-8 bytes only from the retained structured context', async () => {
    const value = await context();
    const artifact = await prepareDerivedTextArtifact(value);
    const bytes = base64ToBytes(artifact.bodyBase64);
    const text = new TextDecoder().decode(bytes);
    expect(artifact).toMatchObject({
      schema: 'liska-derived-text/1',
      kind: 'text',
      relativePath: 'index.txt',
      mediaType: 'text/plain',
      rendererVersion: 'liska-text/1',
      sourceCanonicalSha256: value.canonical.sha256,
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
    expect(text).toContain('Current answer starts here.');
    expect(text).not.toContain('Alternate **answer** remains a separate leaf.');
  });

  it('rejects canonical descriptor drift before rendering', async () => {
    const value = await context();
    const changed = {
      ...value,
      canonical: { ...value.canonical, sha256: 'c'.repeat(64) },
    } as StructuredPresentationContext;
    await expect(prepareDerivedTextArtifact(changed)).rejects.toMatchObject({
      code: 'derived-text-canonical-hash-mismatch',
    });
    expect(renderArchiveText).not.toHaveBeenCalled();
  });

  it.each(['too-small', 'off-by-one'] as const)(
    'rejects a %s canonical byte length without rendering',
    async mode => {
      const value = await context();
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      const changed = {
        ...value,
        canonical: {
          ...value.canonical,
          byteLength: mode === 'too-small' ? 1 : value.canonical.byteLength + 1,
        },
      } as StructuredPresentationContext;
      await expect(prepareDerivedTextArtifact(changed)).rejects.toMatchObject({
        code: 'derived-text-canonical-length-mismatch',
        message: 'derived-text-canonical-length-mismatch',
      });
      expect(renderArchiveText).not.toHaveBeenCalled();
      if (mode === 'too-small') expect(encode).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['capture identity', { captureId: 'capture-chatgpt-other' }],
    ['target node', { targetNodeId: 'missing' }],
    ['selected path', { selectedNodeIds: ['node-current'] }],
    ['tool profile', { includeToolContent: 'true' }],
  ])('rejects inconsistent %s without rendering', async (_label, overrides) => {
    const value = await context();
    await expect(
      prepareDerivedTextArtifact({ ...value, ...overrides } as StructuredPresentationContext)
    ).rejects.toMatchObject({
      code: 'derived-text-context-invalid',
      message: 'derived-text-context-invalid',
    });
    expect(renderArchiveText).not.toHaveBeenCalled();
  });
});
