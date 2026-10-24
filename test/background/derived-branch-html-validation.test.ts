import { describe, expect, it, vi } from 'vitest';
import { MAX_EXTENSION_MESSAGE_SIZE } from '../../src/lib/constants';
import { DERIVED_BRANCH_HTML_MAX_ORDINAL } from '../../src/lib/derived-branch-presentation-contract';
import { validateMessageContent } from '../../src/background/validation';
import {
  snapshotPersistDerivedBranchHtmlMessage,
  validatePersistDerivedBranchHtmlMessage,
} from '../../src/background/derived-branch-html-validation';
import { htmlMessage } from './derived-html-fixture';
import { branchHtmlMessage } from './derived-branch-html-fixture';

describe('branch HTML exact pre-sizing admission', () => {
  it('never executes a top-level Proxy toJSON/get hook or retains its mutated identity', async () => {
    const original = await branchHtmlMessage();
    const expected = structuredClone(original);
    const toJSON = vi.fn(() => {
      original.captureId = 'capture-chatgpt-provider-private-value';
      return original;
    });
    const get = vi.fn((_target: object, key: string | symbol) => {
      if (key === 'toJSON') return toJSON;
      original.captureId = 'capture-chatgpt-provider-private-value';
      return 'provider-private-value';
    });
    const proxy = new Proxy(original, { get });
    const snapshot = snapshotPersistDerivedBranchHtmlMessage(proxy)!;
    expect(snapshot).toEqual(expected);
    expect(snapshot).not.toBe(original);
    expect(snapshot.artifact).not.toBe(original.artifact);
    expect(snapshot.outputs).not.toBe(original.outputs);
    expect(validatePersistDerivedBranchHtmlMessage(proxy)).toBe(true);
    expect(validateMessageContent(proxy)).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    original.captureId = 'capture-chatgpt-provider-private-value';
    original.artifact.bodyBase64 = 'AA==';
    original.outputs[0] = 'obsidian' as 'file';
    expect(snapshot).toEqual(expected);
  });

  it.each([{ role: 'leaf', ordinal: 1 }, { role: 'index' }] as const)(
    'reads stateful nested %s descriptors once and never uses Proxy get traps',
    async target => {
      const original = await branchHtmlMessage('chatgpt', target);
      const expected = structuredClone(original);
      const gets = vi.fn(() => {
        throw new Error('provider-private-value');
      });
      const artifactReads = new Map<PropertyKey, number>();
      const outputReads = new Map<PropertyKey, number>();
      const once = (counts: Map<PropertyKey, number>, value: object, key: string | symbol) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        if (count > 1) throw new Error('provider-private-value');
        return Object.getOwnPropertyDescriptor(value, key);
      };
      const artifact = new Proxy(original.artifact, {
        get: gets,
        getOwnPropertyDescriptor: (value, key) => once(artifactReads, value, key),
      });
      const outputs = new Proxy(original.outputs, {
        get: gets,
        getOwnPropertyDescriptor: (value, key) => once(outputReads, value, key),
      });
      const snapshot = snapshotPersistDerivedBranchHtmlMessage({ ...original, artifact, outputs })!;
      expect(snapshot).toEqual(expected);
      expect(gets).not.toHaveBeenCalled();
      expect([...artifactReads.values()].every(count => count === 1)).toBe(true);
      expect([...outputReads.entries()]).toEqual([
        ['length', 1],
        ['0', 1],
      ]);
      expect(snapshot.artifact === artifact).toBe(false);
      expect(snapshot.outputs === outputs).toBe(false);
      expect(validateMessageContent(snapshot)).toBe(true);
      original.outputs.push('file');
      Object.assign(original.artifact, {
        bodyBase64: 'AA==',
        relativePath: 'provider-private-value',
      });
      expect(snapshot).toEqual(expected);
    }
  );

  it('captures a stateful envelope identity descriptor exactly once', async () => {
    const original = await branchHtmlMessage();
    const expected = structuredClone(original);
    let reads = 0;
    const proxy = new Proxy(original, {
      get: () => {
        throw new Error('provider-private-value');
      },
      getOwnPropertyDescriptor(value, key) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (key === 'captureId') {
          reads += 1;
          value.captureId = 'capture-chatgpt-provider-private-value';
        }
        return descriptor;
      },
    });
    const snapshot = snapshotPersistDerivedBranchHtmlMessage(proxy)!;
    expect(reads).toBe(1);
    expect(snapshot).toEqual(expected);
    expect(JSON.stringify(snapshot)).not.toContain('provider-private-value');
  });

  it('rejects stateful nested accessor descriptors without invoking getters', async () => {
    const original = await branchHtmlMessage();
    const get = vi.fn(() => 'provider-private-value');
    for (const field of ['artifact', 'outputs'] as const) {
      const nested = new Proxy(original[field], {
        get,
        getOwnPropertyDescriptor(value, key) {
          if (key === (field === 'artifact' ? 'bodyBase64' : '0'))
            return { configurable: true, enumerable: true, get };
          return Object.getOwnPropertyDescriptor(value, key);
        },
      });
      expect(
        snapshotPersistDerivedBranchHtmlMessage({ ...original, [field]: nested })
      ).toBeUndefined();
      expect(validateMessageContent({ ...original, [field]: nested })).toBe(false);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects forged output own-key sets even when descriptors would claim one File item', async () => {
    const message = await branchHtmlMessage();
    for (const extra of ['extra', Symbol('extra')]) {
      const outputs = new Proxy(message.outputs, { ownKeys: () => ['length', extra] });
      expect(snapshotPersistDerivedBranchHtmlMessage({ ...message, outputs })).toBeUndefined();
      expect(validateMessageContent({ ...message, outputs })).toBe(false);
    }
  });

  for (const source of ['chatgpt', 'deepseek'] as const) {
    it.each([
      { role: 'leaf', ordinal: 1 },
      { role: 'leaf', ordinal: DERIVED_BRANCH_HTML_MAX_ORDINAL },
      { role: 'index' },
    ] as const)(`accepts ${source} %s`, async target => {
      expect(validateMessageContent(await branchHtmlMessage(source, target))).toBe(true);
      expect(MAX_EXTENSION_MESSAGE_SIZE).toBe(60 * 1024 * 1024);
    });
  }

  it('keeps v1 and branch artifacts mutually exclusive', async () => {
    const current = await htmlMessage();
    const branch = await branchHtmlMessage();
    expect(validateMessageContent({ ...current, artifact: branch.artifact })).toBe(false);
    expect(validateMessageContent({ ...branch, artifact: current.artifact })).toBe(false);
  });

  it.each([
    ['source', 'claude'],
    ['captureId', 'capture-plain'],
    ['captureId', 'capture-deepseek-mismatch'],
    ['captureId', 'capture-chatgpt-../escape'],
    ['captureId', `capture-chatgpt-${'a'.repeat(241)}`],
    ['captureId', 1],
    ['conversationKey', 'provider-id'],
    ['conversationKey', 'A'.repeat(64)],
    ['outputs', []],
    ['outputs', ['file', 'file']],
    ['outputs', ['obsidian']],
    ['outputs', ['clipboard']],
    ['outputs', ['file', 'obsidian']],
    ['expectedSyncSettingsSnapshot', '{}'],
    ['expectedSyncSettingsSnapshot', null],
    ['reportDurableWriteOutcome', false],
    ['artifact', null],
  ])('rejects invalid envelope %s=%s', async (key, value) => {
    expect(validateMessageContent({ ...(await branchHtmlMessage()), [key]: value })).toBe(false);
  });

  it.each([
    ['schema', 'liska-derived-html/1'],
    ['transport', 'staged'],
    ['relativePath', 'index.html'],
    ['relativePath', 'branch-000002.html'],
    ['relativePath', '../branch-000001.html'],
    ['role', 'other'],
    ['ordinal', 0],
    ['ordinal', 1.5],
    ['ordinal', DERIVED_BRANCH_HTML_MAX_ORDINAL + 1],
    ['mediaType', 'text/plain'],
    ['sha256', 'bad'],
    ['byteLength', -1],
    ['bodyBase64', 'AB=='],
    ['bodyBase64', 'A'.repeat(MAX_EXTENSION_MESSAGE_SIZE)],
    ['rendererVersion', 'other'],
    ['sourceCanonicalSha256', 'bad'],
    ['assetBindingSha256', 'bad'],
  ])('rejects malformed branch artifact %s', async (key, value) => {
    const message = await branchHtmlMessage();
    expect(
      validateMessageContent({ ...message, artifact: { ...message.artifact, [key]: value } })
    ).toBe(false);
  });

  it('rejects ordinal on an index and caller-controlled extras', async () => {
    const message = await branchHtmlMessage('chatgpt', { role: 'index' });
    expect(
      validateMessageContent({ ...message, artifact: { ...message.artifact, ordinal: 1 } })
    ).toBe(false);
    for (const key of [
      'receipt',
      'filename',
      'path',
      'archive',
      'canonical',
      'raw',
      'nodeId',
      'bundleCount',
      'complete',
    ])
      expect(validateMessageContent({ ...message, [key]: 'private' })).toBe(false);
  });

  it('rejects getters at every envelope/artifact/output field without evaluating them', async () => {
    const hook = vi.fn(() => 'private');
    const message = await branchHtmlMessage();
    for (const key of Object.keys(message)) {
      const value = Object.defineProperty({ ...message }, key, { enumerable: true, get: hook });
      expect(validateMessageContent(value)).toBe(false);
    }
    for (const key of Object.keys(message.artifact)) {
      const artifact = Object.defineProperty({ ...message.artifact }, key, {
        enumerable: true,
        get: hook,
      });
      expect(validateMessageContent({ ...message, artifact })).toBe(false);
    }
    expect(
      validateMessageContent({
        ...message,
        outputs: Object.defineProperty(['file'], '0', { get: hook }),
      })
    ).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  it('rejects custom/inherited/sparse data, omissions, symbols and toJSON before serialization', async () => {
    const message = await branchHtmlMessage();
    const hook = vi.fn();
    for (const key of Object.keys(message)) {
      const missing = { ...message } as Record<string, unknown>;
      delete missing[key];
      expect(validateMessageContent(missing)).toBe(false);
    }
    for (const value of [
      Object.assign(Object.create({ inherited: true }), message),
      { ...message, toJSON: hook },
      { ...message, [Symbol('extra')]: true },
      { ...message, artifact: Object.assign(Object.create({}), message.artifact) },
      { ...message, artifact: { ...message.artifact, toJSON: hook } },
      { ...message, artifact: { ...message.artifact, [Symbol('extra')]: true } },
      { ...message, outputs: new Array(1) },
      { ...message, outputs: Object.assign(['file'], { toJSON: hook }) },
      { ...message, outputs: Object.assign(['file'], { extra: true }) },
      { ...message, outputs: Object.setPrototypeOf(['file'], null) },
    ])
      expect(validateMessageContent(value)).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(validateMessageContent(Object.assign(Object.create(null), message))).toBe(true);
  });
});
