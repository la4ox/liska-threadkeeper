// @vitest-environment node
import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createPurposePersistenceStore } from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import { capturePreparedChatGpt } from '../../../src/content/capture/chatgpt-admitted-capture';
import { persistChatGptDestinationHonestAttachments } from '../../../src/content/chatgpt-asset-export';
import { adaptChatGptProducerEvidence } from '../../../src/resumability-journal/producer-adapter';
import type { ProducerDestination } from '../../../src/lib/chatgpt-producer-evidence';
import { reserve, sha256, response } from './fixtures';

it('retains actual prepare -> capture/normalizer -> producer -> adapter facts, with real not-attempted insufficiency', async () => {
  const factory = new IDBFactory();
  const value = createPurposePersistenceStore({ indexedDB: factory, sha256 });
  await value.open();
  try {
    const { prepared } = await reserve(value);
    const { token } = await value.claimDispatch(prepared.operation.operationId, 0);
    expect(await value.checkCurrent(token)).toBe(true);
    // Test-only composition. The production store has no executor/provider consumer.
    const captured = await capturePreparedChatGpt(prepared, {
      requestCapture: async () => response(),
      now: () => new Date('2026-11-06T12:00:00.000Z'),
    });
    const produced = await persistChatGptDestinationHonestAttachments(
      captured.capture.assetExportContext!,
      captured.capture.archiveCompanion,
      'synthetic.md',
      ['file'],
      {
        producerIntent: captured.producerIntent,
        persistArtifacts: async (companion, _name, _source, outputs, kinds) => ({
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
                observation: {
                  kind: 'browser-download-complete-path-confirmed' as const,
                  observedRelativePath: item.relativePath,
                },
              }))
          ),
        }),
      }
    );
    const expected = await adaptChatGptProducerEvidence(
      captured.operation,
      produced.producerReceipts,
      sha256
    );
    const stored = await value.recordProducerReceipts(
      prepared.operation.operationId,
      1,
      produced.producerReceipts
    );
    expect(stored.observation?.adaptation).toEqual(expected);
    expect(stored.observation?.adaptation.assessment).toEqual({
      kind: 'insufficient',
      codes: ['completeness-incomplete'],
    });
    expect(stored.observation?.receipts[0].completeness.assets).toBe('not-attempted');
    expect(stored.phase).toBe('awaiting-resolution');
    expect(await value.checkCurrent(token)).toBe(false);
    value.close();
    const next = createPurposePersistenceStore({ indexedDB: factory, sha256 });
    try {
      await next.open();
      expect(await next.read(prepared.operation.operationId)).toEqual(stored);
    } finally {
      next.close();
    }
  } finally {
    value.close();
  }
});
