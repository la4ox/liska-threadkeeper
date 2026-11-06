import { vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createPurposePersistenceStore,
  type PurposeStoreOptions,
  type JournalTimers,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import {
  createChatGptExecution,
  type ChatGptExecutionDependencies,
} from '../../../src/resumability-journal/execution-coordinator';
import type { ChatGptAssetExportDependencies } from '../../../src/content/chatgpt-asset-export';
import type { ProducerDestination } from '../../../src/lib/chatgpt-producer-evidence';
import { reserve, response, sha256, conversationId } from '../purpose-persistence-v2/fixtures';

export const sink: ChatGptAssetExportDependencies['persistArtifacts'] = async (
  companion,
  _name,
  _source,
  outputs,
  kinds
) => ({
  activeOutputs: [...outputs] as ProducerDestination[],
  warnings: [],
  observations: outputs.flatMap(destination =>
    companion.artifacts
      .filter(item => kinds.includes(item.kind))
      .map(item => ({
        destination: destination as ProducerDestination,
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
});
export function assetResponse() {
  return response(
    JSON.stringify({
      conversation_id: conversationId,
      title: 'Synthetic asset',
      current_node: 'a',
      mapping: {
        a: {
          id: 'a',
          parent: null,
          children: [],
          message: {
            id: 'a',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['[asset](sandbox:/mnt/data/a.png)'] },
          },
        },
      },
    })
  );
}
export async function setup(
  destinations: ProducerDestination[] = ['file'],
  options: Partial<PurposeStoreOptions> = {}
) {
  const factory = new IDBFactory();
  const store = createPurposePersistenceStore({ indexedDB: factory, sha256, ...options });
  await store.open();
  const { prepared } = await reserve(store, '1', { requiredDestinations: destinations });
  const abort = new AbortController();
  const requestCapture = vi.fn(async () => assetResponse());
  const persistArtifacts = vi.fn(sink);
  const input = {
    store,
    prepared,
    expectedReservedRevision: 0,
    noteFileName: 'synthetic.md',
    signal: abort.signal,
  };
  const dependencies = {
    requestCapture,
    persistArtifacts,
    now: () => new Date('2026-11-06T12:00:00.000Z'),
  };
  const execute = (overrides: Partial<ChatGptExecutionDependencies> = {}) =>
    createChatGptExecution(input, { ...dependencies, ...overrides });
  return {
    factory,
    store,
    prepared,
    abort,
    input,
    dependencies,
    execute,
    requestCapture,
    persistArtifacts,
  };
}
export class ManualTimers implements JournalTimers {
  pending = new Map<number, () => void>();
  sequence = 0;
  setTimeout(callback: () => void) {
    const id = ++this.sequence;
    this.pending.set(id, callback);
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  fire() {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    callbacks.forEach(callback => callback());
  }
}
