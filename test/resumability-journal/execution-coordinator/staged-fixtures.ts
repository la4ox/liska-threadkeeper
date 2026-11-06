import { expect, vi } from 'vitest';
import {
  CHATGPT_INLINE_CAPTURE_MAX_BYTES,
  type ChatGptCaptureResponse,
} from '../../../src/lib/chatgpt-capture-contract';
import type { ArchiveCompanionPersistenceOutcome } from '../../../src/content/chatgpt-asset-export';
import type { StagedArchiveCompanionArtifact } from '../../../src/lib/types';
import {
  type ExecutionStagePort,
  type SealedExecutionStage,
  type SelectedArchiveWrite,
  type StageExecutionBinding,
  type StageReleaseOutcome,
  type StagedExecutionDependencies,
} from '../../../src/resumability-journal/execution-coordinator/stages';
import { createChatGptExecution } from '../../../src/resumability-journal/execution-coordinator';
import { hash, response } from '../purpose-persistence-v2/fixtures';
import { assetResponse, setup } from './fixtures';

export function selectedOutcome(write: SelectedArchiveWrite): ArchiveCompanionPersistenceOutcome {
  return {
    activeOutputs: [...write.destinations],
    warnings: [],
    observations: write.destinations.flatMap(destination =>
      write.artifacts.map(item => ({
        destination,
        commitment: {
          relativePath: item.relativePath,
          byteLength: item.byteLength,
          sha256: item.sha256,
        },
        observation:
          destination === 'file'
            ? {
                kind: 'browser-download-complete-path-confirmed' as const,
                observedRelativePath: item.relativePath,
              }
            : {
                kind: 'byte-readback-sha256' as const,
                byteLength: item.byteLength,
                sha256: item.sha256,
              },
      }))
    ),
  };
}

// Real production size threshold; whitespace grows transport without inflating normalized content.
const rawCache = new Map<string, Uint8Array>();
function stagedBytes(capture: Extract<ChatGptCaptureResponse, { success: true }>) {
  if (capture.data.transport !== 'inline') throw new Error('fixture');
  const base64 = capture.data.bodyBase64;
  let bytes = rawCache.get(base64);
  if (!bytes) {
    bytes = new TextEncoder().encode(
      atob(base64) + ' '.repeat(CHATGPT_INLINE_CAPTURE_MAX_BYTES + 1)
    );
    rawCache.set(base64, bytes);
  }
  return bytes;
}

export async function stagedSetup(
  options: {
    inline?: boolean;
    assets?: boolean;
    destinations?: ('file' | 'obsidian')[];
    text?: string;
  } = {}
) {
  const ctx = await setup(options.destinations ?? ['file', 'obsidian']);
  const captured =
    options.text !== undefined
      ? response(options.text)
      : options.assets
        ? assetResponse()
        : response();
  if (!captured.success) throw new Error('fixture');
  const content = options.inline ? undefined : stagedBytes(captured);
  const stored = new Map<
    object,
    { lease: SealedExecutionStage; bytes: Uint8Array; owner: 'provider' | 'sink' | 'released' }
  >();
  const events: string[] = [];
  const hooks: {
    read?: (lease: SealedExecutionStage) => Promise<void> | void;
    create?: (lease: SealedExecutionStage) => Promise<void> | void;
    sink?: (
      write: SelectedArchiveWrite
    ) => Promise<ArchiveCompanionPersistenceOutcome> | ArchiveCompanionPersistenceOutcome;
    release?: (lease: SealedExecutionStage) => Promise<StageReleaseOutcome> | StageReleaseOutcome;
    request?: (binding: StageExecutionBinding) => Promise<void> | void;
  } = {};
  const issue = (
    binding: StageExecutionBinding,
    bytes: Uint8Array,
    kind: 'raw' | 'canonical'
  ): SealedExecutionStage => {
    const artifact: StagedArchiveCompanionArtifact = Object.freeze({
      transport: 'staged',
      kind,
      relativePath:
        kind === 'raw' ? 'responses/conversation.json' : 'canonical/liska-thread-1.json',
      mediaType: 'application/json',
      byteLength: bytes.byteLength,
      sha256: hash(bytes),
      stageId: `archive-stage-${String(stored.size + 1).padStart(32, '0')}`,
    });
    const lease = Object.freeze({ binding, token: Object.freeze({}), artifact });
    stored.set(lease.token, { lease, bytes, owner: 'provider' });
    return lease;
  };
  const check = (lease: SealedExecutionStage) => {
    const item = stored.get(lease.token);
    expect(item).toBeDefined();
    expect(item!.lease.binding).toBe(lease.binding);
    expect(item!.lease.artifact).toEqual(lease.artifact);
    expect(item!.owner).toBe('provider');
    return item!;
  };
  const read = vi.fn<ExecutionStagePort['read']>(async (lease, range) => {
    events.push('read');
    const item = check(lease);
    await hooks.read?.(lease);
    return item.bytes.slice(range.offset, range.offset + range.byteLength);
  });
  const create = vi.fn<ExecutionStagePort['create']>(async (binding, commitment, bytes) => {
    events.push('create');
    expect(hash(bytes)).toBe(commitment.sha256);
    const lease = issue(binding, bytes, 'canonical');
    await hooks.create?.(lease);
    return lease;
  });
  const release = vi.fn<ExecutionStagePort['release']>(async lease => {
    events.push(`release:${lease.artifact.kind}`);
    const item = check(lease);
    const outcome = (await hooks.release?.(lease)) ?? 'released';
    if (outcome === 'released') item.owner = 'released';
    return outcome;
  });
  const stagePort = Object.freeze({ read, create, release });
  const requestCapture = vi.fn<StagedExecutionDependencies['requestCapture']>(
    async (_id, binding) => {
      events.push('request');
      await hooks.request?.(binding);
      if (!content) return { response: captured };
      const lease = issue(binding, content, 'raw');
      const { bodyBase64, ...data } = captured.data as Extract<
        typeof captured.data,
        { transport: 'inline' }
      >;
      void bodyBase64;
      return {
        response: {
          success: true,
          data: {
            ...data,
            transport: 'staged',
            stageId: lease.artifact.stageId,
            byteLength: content.byteLength,
            sha256: lease.artifact.sha256,
          },
        },
        lease,
      };
    }
  );
  const persistSelectedArtifacts = vi.fn<StagedExecutionDependencies['persistSelectedArtifacts']>(
    write => {
      events.push(`sink:${write.artifacts.map(item => item.kind).join(',')}`);
      for (const lease of write.leases) check(lease).owner = 'sink';
      return Promise.resolve(hooks.sink ? hooks.sink(write) : selectedOutcome(write));
    }
  );
  const dependencies: StagedExecutionDependencies = {
    captureTransport: 'staged',
    requestCapture,
    stagePort,
    persistSelectedArtifacts,
    now: ctx.dependencies.now,
  };
  const execute = (overrides: Partial<StagedExecutionDependencies> = {}) =>
    createChatGptExecution(ctx.input, { ...dependencies, ...overrides });
  return {
    ...ctx,
    execute,
    dependencies,
    stored,
    hooks,
    events,
    requestCapture,
    read,
    create,
    release,
    persistSelectedArtifacts,
  };
}
