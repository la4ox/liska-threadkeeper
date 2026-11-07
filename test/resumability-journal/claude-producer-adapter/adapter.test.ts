// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { adaptClaudeProducerEvidence } from '../../../src/resumability-journal/claude-producer-adapter';
import { conversationKeyInput } from '../../../src/archive/catalog/conversation-key';
import {
  claudeReceipts,
  clone,
  commitment,
  conversationId,
  hash,
  operation,
} from '../purpose-persistence-v3/fixtures';

describe('unwired Claude producer evidence replay', () => {
  it('assesses exact independently bound file and readback facts with distinct destination manifests', async () => {
    const receipts = claudeReceipts();
    const sha256 = vi.fn(hash);
    const result = await adaptClaudeProducerEvidence(operation(), receipts, sha256);
    expect(result.assessment).toEqual({ kind: 'consistent', codes: [] });
    expect(sha256).toHaveBeenNthCalledWith(1, conversationKeyInput('claude', conversationId));
    expect(sha256).toHaveBeenNthCalledWith(2, new TextEncoder().encode(conversationId));
    expect(result.evidence!.binding!.admission.provider).toBe('claude');
    expect(result.evidence!.destinations![0].manifest).not.toEqual(
      result.evidence!.destinations![1].manifest
    );
    expect(result.evidence!.destinations![0].assurance!.artifacts![0].file).toBeDefined();
    expect(result.evidence!.destinations![0].assurance!.artifacts![0].readback).toBeUndefined();
    expect(Object.isFrozen(result.evidence!.destinations![1].assurance!.binding)).toBe(true);
    expect(result.evidence!.destinations![0].raw).not.toBe(receipts[0].raw);
  });
  it('requires all requested destinations and explicit pre-write intent; empty/manual receipts stay insufficient', async () => {
    expect((await adaptClaudeProducerEvidence(operation(), [], hash)).assessment.kind).toBe(
      'insufficient'
    );
    const receipts = claudeReceipts();
    expect(
      (await adaptClaudeProducerEvidence(operation(), [receipts[0]], hash)).assessment.codes
    ).toContain('destination-missing');
    receipts.forEach(receipt => Reflect.deleteProperty(receipt, 'intent'));
    const result = await adaptClaudeProducerEvidence(operation(), receipts, hash);
    expect(result.assessment.kind).toBe('insufficient');
    expect(result.assessment.codes).toContain('binding-missing');
    expect(result.evidence!.binding).toBeUndefined();
  });
  it.each([
    'operationId',
    'attemptId',
    'captureId',
    'conversationId',
    'conversationKey',
    'catalogSha256',
  ])('does not substitute a mismatched intent %s', async field => {
    const receipts = claudeReceipts();
    const mismatch = field.endsWith('Sha256')
      ? 'f'.repeat(64)
      : field === 'conversationKey'
        ? `liska-conversation-key/1:${'f'.repeat(64)}`
        : 'different';
    Object.assign(receipts[0].intent!, { [field]: mismatch });
    expect(await adaptClaudeProducerEvidence(operation(), receipts, hash)).toEqual({
      adapterCode: 'identity-conflict',
      assessment: { kind: 'conflict', codes: ['identity-conflict'] },
    });
  });
  it.each(['captureId', 'conversationId', 'legacyRoutingDigest'])(
    'rejects mismatched receipt %s independently of intent',
    async field => {
      const receipts = claudeReceipts();
      Object.assign(receipts[0], {
        [field]: field === 'legacyRoutingDigest' ? 'f'.repeat(64) : 'different',
      });
      const result = await adaptClaudeProducerEvidence(operation(), receipts, hash);
      expect(result.adapterCode).toBe('identity-conflict');
      expect(result.assessment.kind).toBe('conflict');
    }
  );
  it('keeps provider-aware keys distinct from ChatGPT and legacy routing hashes', async () => {
    for (const digest of [
      hash(conversationKeyInput('chatgpt', conversationId)),
      hash(new TextEncoder().encode(conversationId)),
    ]) {
      const current = operation();
      current.admission.conversationKey = `liska-conversation-key/1:${digest}`;
      expect((await adaptClaudeProducerEvidence(current, claudeReceipts(), hash)).adapterCode).toBe(
        'identity-conflict'
      );
    }
  });
  it.each(['request', 'intent', 'observation', 'duplicate', 'unrequested'])(
    'fails closed on %s destination conflicts',
    async field => {
      const receipts = claudeReceipts();
      if (field === 'request') Object.assign(receipts[0], { requestedDestinations: ['file'] });
      if (field === 'intent')
        Object.assign(receipts[0].intent!, { requiredDestinations: ['file'] });
      if (field === 'observation')
        Object.assign(receipts[0].observations[0], { destination: 'obsidian' });
      if (field === 'duplicate') receipts[1] = clone(receipts[0]);
      const current = field === 'unrequested' ? operation('claude', ['file']) : operation();
      const result = await adaptClaudeProducerEvidence(current, receipts, hash);
      expect(result.assessment.kind).toBe('conflict');
      expect(result.assessment.codes).toContain('destination-conflict');
    }
  );
  it.each([
    'raw',
    'observed-commitment',
    'duplicate-path',
    'readback-hash',
    'readback-length',
    'file-path',
  ])('detects %s commitment conflicts', async field => {
    const receipts = claudeReceipts();
    if (field === 'raw') Object.assign(receipts[1].raw, { sha256: 'f'.repeat(64) });
    if (field === 'observed-commitment')
      Object.assign(receipts[0].observations[0].commitment, { sha256: 'f'.repeat(64) });
    if (field === 'duplicate-path')
      Object.assign(receipts[0], {
        observations: [...receipts[0].observations, receipts[0].observations[0]],
      });
    if (field === 'readback-hash')
      Object.assign(receipts[1].observations[0].observation!, { sha256: 'f'.repeat(64) });
    if (field === 'readback-length')
      Object.assign(receipts[1].observations[0].observation!, { byteLength: 999 });
    if (field === 'file-path')
      Object.assign(receipts[0].observations[0].observation!, {
        observedRelativePath: 'renamed.json',
      });
    const result = await adaptClaudeProducerEvidence(operation(), receipts, hash);
    expect(result.assessment.kind).toBe('conflict');
    expect(result.assessment.codes).toContain('commitment-conflict');
  });
  it('requires the destination-specific sink assurance, never treating file path confirmation as readback', async () => {
    const receipts = claudeReceipts();
    Object.assign(receipts[0].observations[0], {
      observation: { kind: 'byte-readback-sha256', byteLength: 2, sha256: receipts[0].raw.sha256 },
    });
    const result = await adaptClaudeProducerEvidence(operation(), receipts, hash);
    expect(result.assessment.kind).toBe('conflict');
    expect(result.assessment.codes).toContain('assurance-conflict');
  });
  it.each(['partial', 'unknown', 'not-attempted'])(
    'keeps %s completeness insufficient',
    async state => {
      const receipts = claudeReceipts();
      Object.assign(receipts[0].completeness, { graph: state });
      const result = await adaptClaudeProducerEvidence(operation(), receipts, hash);
      expect(result.assessment.kind).toBe('insufficient');
      expect(result.assessment.codes).toContain('completeness-incomplete');
    }
  );
  it.each(['not-attempted', 'unavailable', 'declined', 'expired', 'failed', 'fetched'])(
    'does not promote a metadata-only %s asset',
    async state => {
      const receipts = claudeReceipts();
      Object.assign(receipts[0], { assets: [{ assetId: 'asset-1', state }] });
      const result = await adaptClaudeProducerEvidence(operation(), receipts, hash);
      expect(result.assessment.kind).toBe('insufficient');
      expect(result.assessment.codes).toContain('artifact-missing');
      expect(result.evidence!.destinations![0].assets![0].state).toBe(
        state === 'fetched' ? 'fetched' : state === 'not-attempted' ? 'unknown' : 'missing'
      );
    }
  );
  it('requires observed delivery of fetched assets and retains missing assurance as insufficient', async () => {
    const receipts = claudeReceipts();
    const asset = commitment('assets/a.png');
    Object.assign(receipts[0], {
      assets: [{ assetId: 'asset-1', state: 'fetched', commitment: asset }],
    });
    expect(
      (await adaptClaudeProducerEvidence(operation(), receipts, hash)).assessment.codes
    ).toContain('delivery-missing');
    Object.assign(receipts[0], {
      observations: [
        ...receipts[0].observations,
        {
          destination: 'file',
          commitment: asset,
          observation: {
            kind: 'browser-download-complete-path-confirmed',
            observedRelativePath: asset.relativePath,
          },
        },
      ],
    });
    expect((await adaptClaudeProducerEvidence(operation(), receipts, hash)).assessment.kind).toBe(
      'consistent'
    );
    Reflect.deleteProperty(receipts[0].observations[0], 'observation');
    expect((await adaptClaudeProducerEvidence(operation(), receipts, hash)).assessment.kind).toBe(
      'insufficient'
    );
  });
  it('rejects wrong providers, malformed facts and accessors before hashing without leaking exceptions', async () => {
    const sha256 = vi.fn(hash);
    const getter = vi.fn();
    const inputs = [
      [{ ...claudeReceipts()[0], provider: 'chatgpt' }],
      [{ ...claudeReceipts()[0], intent: { ...claudeReceipts()[0].intent, provider: 'chatgpt' } }],
      [{ ...claudeReceipts()[0], raw: { ...commitment('raw'), byteLength: -1 } }],
      Object.defineProperty([], '0', { get: getter, enumerable: true }),
      [...claudeReceipts(), claudeReceipts()[0]],
    ];
    for (const input of inputs) {
      expect((await adaptClaudeProducerEvidence(operation(), input, sha256)).assessment.kind).toBe(
        'rejected'
      );
    }
    expect(
      (await adaptClaudeProducerEvidence(operation('chatgpt'), [], sha256)).assessment.kind
    ).toBe('rejected');
    expect(sha256).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    const unsupported = await adaptClaudeProducerEvidence(
      operation(),
      [{ schema: 'unknown' }],
      sha256
    );
    expect(unsupported.adapterCode).toBe('unsupported-producer-receipt');
    expect(unsupported.assessment.kind).toBe('insufficient');
  });
  it.each(['throw', 'bad-primary', 'bad-routing', 'wrong-routing'])(
    'never succeeds with %s hashing',
    async mode => {
      let calls = 0;
      const sha256 = (bytes: Uint8Array) => {
        ++calls;
        if (mode === 'throw') throw new Error('private hash failure');
        if (mode === 'bad-primary' || (mode === 'bad-routing' && calls === 2)) return 'bad';
        if (mode === 'wrong-routing' && calls === 2) return 'f'.repeat(64);
        return hash(bytes);
      };
      const result = await adaptClaudeProducerEvidence(operation(), claudeReceipts(), sha256);
      expect(result.adapterCode).toBe(
        mode === 'wrong-routing' ? 'identity-conflict' : 'hash-failed'
      );
      expect(result.assessment.kind).toBe(mode === 'wrong-routing' ? 'conflict' : 'rejected');
      expect(result.evidence).toBeUndefined();
    }
  );
  it('pins caller operation and receipts before the first asynchronous hash', async () => {
    const current = operation();
    const receipts = claudeReceipts();
    let calls = 0;
    const result = await adaptClaudeProducerEvidence(current, receipts, async bytes => {
      if (++calls === 1) {
        Object.assign(current, { attemptId: 'changed' });
        Object.assign(receipts[0].raw, { sha256: 'f'.repeat(64) });
        Reflect.deleteProperty(receipts[0], 'intent');
      }
      await Promise.resolve();
      return hash(bytes);
    });
    expect(result.assessment.kind).toBe('consistent');
    expect(result.evidence!.binding!.attemptId).toBe('attempt-1');
  });
});
