/** Test-only capabilities. No destination, provider or browser-extension I/O. */
import type {
  ExecutionStagePort,
  SealedExecutionStage,
  StageExecutionBinding,
  StagedExecutionDependencies,
} from '../../../src/resumability-journal/execution-coordinator/stages';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_INLINE_CAPTURE_MAX_BYTES,
} from '../../../src/lib/chatgpt-capture-contract';
import type { StagedArchiveCompanionArtifact } from '../../../src/lib/types';

const requireFact = (value: unknown): void => {
  if (!value) throw new Error('synthetic-check-failed');
};

export function installNetworkDenial(target: typeof globalThis) {
  let count = 0;
  const restore: (() => void)[] = [];
  const deny = function () {
    count = Math.min(1_000_000, count + 1);
    throw new Error('synthetic-network-denied');
  };
  const replace = (object: object, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, writable: true, value: deny });
    restore.push(() => {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    });
  };
  try {
    for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) replace(target, key);
    replace(target.navigator, 'sendBeacon');
  } catch {
    restore.reverse().forEach(undo => undo());
    throw new Error('synthetic-network-denial-unavailable');
  }
  return Object.freeze({
    calls: () => count,
    restore: () =>
      restore
        .reverse()
        .splice(0)
        .forEach(undo => undo()),
  });
}

export interface EffectCounts {
  request: number;
  sink: number;
  stageIssue: number;
  stageCreate: number;
  stageRead: number;
  stageRelease: number;
  stageTransfer: number;
  verifiedArtifacts: number;
}
export const effectCounts = (): EffectCounts => ({
  request: 0,
  sink: 0,
  stageIssue: 0,
  stageCreate: 0,
  stageRead: 0,
  stageRelease: 0,
  stageTransfer: 0,
  verifiedArtifacts: 0,
});

export function syntheticStagedCapabilities(
  sha256: (bytes: Uint8Array) => Promise<string>,
  counts: EffectCounts,
  check: () => void
): StagedExecutionDependencies {
  const stored = new Map<
    object,
    { lease: SealedExecutionStage; bytes: Uint8Array; owner: 'provider' | 'sink' | 'released' }
  >();
  const issue = async (
    binding: StageExecutionBinding,
    source: Uint8Array,
    kind: 'raw' | 'canonical'
  ): Promise<SealedExecutionStage> => {
    const bytes = source.slice();
    counts.stageIssue++;
    const artifact: StagedArchiveCompanionArtifact = Object.freeze({
      transport: 'staged',
      kind,
      relativePath:
        kind === 'raw' ? 'responses/conversation.json' : 'canonical/liska-thread-1.json',
      mediaType: 'application/json',
      byteLength: bytes.byteLength,
      sha256: await sha256(bytes),
      stageId: `archive-stage-${String(counts.stageIssue).padStart(32, '0')}`,
    });
    const lease = Object.freeze({ binding, artifact, token: Object.freeze({}) });
    stored.set(lease.token, { lease, bytes, owner: 'provider' });
    return lease;
  };
  const owned = (lease: SealedExecutionStage, owner: 'provider' | 'sink') => {
    const item = stored.get(lease.token);
    requireFact(
      item &&
        item.owner === owner &&
        item.lease.binding === lease.binding &&
        JSON.stringify(item.lease.artifact) === JSON.stringify(lease.artifact)
    );
    return item!;
  };
  const read = async (
    lease: SealedExecutionStage,
    owner: 'provider' | 'sink',
    offset = 0,
    byteLength?: number
  ) => {
    check();
    counts.stageRead++;
    const bytes = owned(lease, owner).bytes;
    return bytes.slice(offset, byteLength === undefined ? undefined : offset + byteLength);
  };
  const stagePort = Object.freeze<ExecutionStagePort>({
    read: async (lease, range) => {
      requireFact(
        Number.isSafeInteger(range.offset) &&
          range.offset >= 0 &&
          Number.isSafeInteger(range.byteLength) &&
          range.byteLength > 0 &&
          range.offset + range.byteLength <= lease.artifact.byteLength
      );
      return read(lease, 'provider', range.offset, range.byteLength);
    },
    create: async (binding, commitment, bytes) => {
      check();
      counts.stageCreate++;
      requireFact(
        bytes.byteLength === commitment.byteLength && (await sha256(bytes)) === commitment.sha256
      );
      return issue(binding, bytes, 'canonical');
    },
    release: async lease => {
      counts.stageRelease++;
      owned(lease, 'provider').owner = 'released';
      return 'released';
    },
  });
  return {
    captureTransport: 'staged',
    stagePort,
    now: () => new Date('2026-11-07T00:00:00.000Z'),
    requestCapture: async (conversationId, binding) => {
      check();
      counts.request++;
      const text = JSON.stringify({
        conversation_id: conversationId,
        title: 'Synthetic',
        current_node: 'a',
        mapping: {
          a: {
            id: 'a',
            parent: null,
            children: [],
            message: {
              id: 'a',
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Synthetic'] },
            },
          },
        },
      });
      // The real shared response validator requires staged raw to exceed 16 MiB.
      // Whitespace adds no conversation content and reaches that exact minimum only.
      const bytes = new TextEncoder().encode(
        text + ' '.repeat(CHATGPT_INLINE_CAPTURE_MAX_BYTES + 1 - text.length)
      );
      const lease = await issue(binding, bytes, 'raw');
      return {
        lease,
        response: {
          success: true,
          data: {
            transport: 'staged',
            stageId: lease.artifact.stageId,
            byteLength: bytes.length,
            sha256: lease.artifact.sha256,
            mediaType: 'application/json',
            endpoint: CHATGPT_CAPTURE_ENDPOINT,
            routeFamily: 'standard',
            transientAssetResolvers: [],
          },
        },
      };
    },
    persistSelectedArtifacts: async write => {
      check();
      counts.sink++;
      // Ownership transfers synchronously, including when later verification rejects.
      for (const lease of write.leases) {
        owned(lease, 'provider').owner = 'sink';
        counts.stageTransfer++;
      }
      for (const artifact of write.artifacts) {
        const lease = write.leases.find(
          item =>
            item.artifact.stageId ===
            (artifact.transport === 'staged' ? artifact.stageId : undefined)
        );
        const bytes =
          artifact.transport === 'staged'
            ? await read(lease!, 'sink')
            : Uint8Array.from(atob(artifact.bodyBase64), character => character.charCodeAt(0));
        requireFact(
          bytes.length === artifact.byteLength && (await sha256(bytes)) === artifact.sha256
        );
        counts.verifiedArtifacts++;
      }
      // Explicitly synthetic observations, after independently reading actual selected bytes.
      return {
        activeOutputs: [...write.destinations],
        warnings: [],
        observations: write.destinations.flatMap(destination =>
          write.artifacts.map(artifact => ({
            destination,
            commitment: {
              relativePath: artifact.relativePath,
              byteLength: artifact.byteLength,
              sha256: artifact.sha256,
            },
            observation:
              destination === 'file'
                ? {
                    kind: 'browser-download-complete-path-confirmed' as const,
                    observedRelativePath: artifact.relativePath,
                  }
                : {
                    kind: 'byte-readback-sha256' as const,
                    byteLength: artifact.byteLength,
                    sha256: artifact.sha256,
                  },
          }))
        ),
      };
    },
  };
}
