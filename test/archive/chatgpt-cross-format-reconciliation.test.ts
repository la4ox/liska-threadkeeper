import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_COMPARISON_HARD_LIMITS,
  ChatGptComparisonError,
  compareChatGptArchives,
  type ChatGptComparisonErrorCode,
  type ChatGptComparisonLimits,
} from '../../src/archive/reconciliation/chatgpt';
import type {
  ArchiveBlock,
  ArchiveDiagnostic,
  ArchiveMessage,
  JsonValue,
  LiskaThreadArchive,
} from '../../src/archive/types';
import { validateLiskaThreadArchive } from '../../src/archive/validate';
import fixture from '../fixtures/archive/branching-chatgpt-thread.json';

const SENTINEL = 'SECRET-CONTENT-SENTINEL';
const PATH = '/SECRET-LOCAL-PATH-SENTINEL';
const FILENAME = 'SECRET-FILENAME-SENTINEL.png';
const TITLE = 'SECRET-TITLE-SENTINEL';
const URL = 'https://example.test/SECRET-URL-SENTINEL';
const sha256 = async (bytes: Uint8Array): Promise<string> =>
  createHash('sha256').update(bytes).digest('hex');

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pair(): { left: LiskaThreadArchive; right: LiskaThreadArchive } {
  const left = clone(fixture) as LiskaThreadArchive;
  left.conversation.title = TITLE;
  left.conversation.url = URL;
  left.assets['asset-synthetic-image'].filename = FILENAME;
  left.assets['asset-synthetic-image'].localArtifactRef = PATH;
  const block = left.graph.nodes['node-current'].message!.blocks[0];
  if (block.type === 'text') block.text = SENTINEL;
  const right = clone(left);
  right.inputs[0].normalizer = 'chatgpt-official/1';
  right.inputs[0].captureId = 'official-capture';
  right.inputs[0].manifestSha256 = 'c'.repeat(64);
  right.inputs[0].capturedAt = null;
  return { left, right };
}

function message(archive: LiskaThreadArchive, id = 'node-current'): ArchiveMessage {
  return archive.graph.nodes[id].message!;
}

function diagnostic(
  code: string,
  severity: ArchiveDiagnostic['severity'] = 'warning'
): ArchiveDiagnostic {
  return {
    severity,
    code,
    message: SENTINEL,
    path: PATH,
    sourceRefs: clone(fixture.conversation.sourceRefs),
    extensions: { openai: SENTINEL },
  };
}

async function expectError(
  input: Parameters<typeof compareChatGptArchives>[0],
  code: ChatGptComparisonErrorCode
): Promise<void> {
  const error = await compareChatGptArchives(input).catch(error => error);
  expect(error).toBeInstanceOf(ChatGptComparisonError);
  expect(error.code).toBe(code);
  expect(error.message).toBe(`ChatGPT archive comparison failed (${code}).`);
  expect(JSON.stringify(error)).not.toContain(SENTINEL);
  expect(error.cause).toBeUndefined();
}

function expectPrivate(report: unknown): void {
  const serialized = JSON.stringify(report);
  for (const sentinel of [
    SENTINEL,
    PATH,
    FILENAME,
    TITLE,
    URL,
    'rawPointer',
    'sourceRefs',
    'extensions',
  ])
    expect(serialized).not.toContain(sentinel);
}

function freezeDeep(input: unknown): void {
  if (!input || typeof input !== 'object') return;
  Object.freeze(input);
  for (const value of Object.values(input)) freezeDeep(value);
}

describe('compareChatGptArchives', () => {
  it('compares validated canonical scopes without exporting content or provenance', async () => {
    const input = pair();
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.schema).toBe('liska-chatgpt-comparison/1');
    expect(report.comparisonVersion).toBe('chatgpt-canonical-semantic/1');
    expect(report.identity).toEqual({
      provider: 'chatgpt',
      conversationId: 'synthetic-branching-thread',
    });
    expect(report.scopes.left).toEqual({
      side: 'left',
      captureId: 'capture-synthetic-001',
      manifestSha256: 'a'.repeat(64),
      normalizer: 'chatgpt-web/1',
      sourceFormat: 'chatgpt.web.history',
      capturedAt: '2026-08-17T10:00:00.000Z',
    });
    expect(report.scopes.right).toMatchObject({
      side: 'right',
      normalizer: 'chatgpt-official/1',
      sourceFormat: 'chatgpt.official.export',
      capturedAt: null,
    });
    expect(report.nodes.matchedCount).toBe(4);
    expect(report.messages.matchedCount).toBe(3);
    expect(report.assets.matchedCount).toBe(1);
    expect(report.nodes.conflicts).toEqual([]);
    expect(report.messages.conflicts).toEqual([]);
    expect(report.assets.conflicts).toEqual([]);
    expect(report.facts.left).toMatchObject({
      nodeCount: 4,
      structuralNodeCount: 1,
      messageCount: 3,
      blockCount: 8,
      assetCount: 1,
      diagnosticCount: 0,
      rootIds: ['node-root'],
      currentNodeId: 'node-current',
      leafIds: ['node-alternate', 'node-current'],
      branchPointIds: ['node-user'],
      orderEvidence: 'explicit-or-unknown',
      blocksByType: { text: 2, reasoning: 1, markdown: 1, unknown: 1 },
      assetsByAcquisitionState: { fetched: 1 },
    });
    expect(report.messages.left['message-current'].ownerNodeId).toBe('node-current');
    expect(report.conversation.leftSemanticSha256).toBe(report.conversation.rightSemanticSha256);
    expect(report.notices).toHaveLength(3);
    expectPrivate(report);
  });

  it('ignores only canonical provenance, extensions and block IDs', async () => {
    const input = pair();
    input.right.archiveId = 'unrelated-capture-archive';
    const rewrite = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'sourceRefs' && Array.isArray(child))
          for (const ref of child) {
            ref.id = SENTINEL;
            ref.rawPointer = PATH;
            ref.format = SENTINEL;
          }
        else if (key === 'extensions')
          (value as Record<string, unknown>)[key] = { openai: { private: SENTINEL } };
        else rewrite(child);
      }
    };
    rewrite(input.right);
    for (const node of Object.values(input.right.graph.nodes))
      for (const block of node.message?.blocks ?? []) block.id = `other-${block.id}`;
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.nodes.left).toEqual(report.nodes.right);
    expect(report.messages.left).toEqual(report.messages.right);
    expect(report.assets.left).toEqual(report.assets.right);
    expectPrivate(report);
  });

  it('sorts JSON object keys but retains same-named payload boundary keys', async () => {
    const input = pair();
    const l = message(input.left).blocks.find(block => block.type === 'tool_call')!;
    const r = message(input.right).blocks.find(block => block.type === 'tool_call')!;
    if (l.type !== 'tool_call' || r.type !== 'tool_call') throw new Error('fixture');
    l.arguments = {
      z: [null, '', { token: '}' }],
      id: 'payload-id',
      sourceRefs: { nested: true },
      extensions: { a: 1, b: 2 },
    };
    r.arguments = {
      extensions: { b: 2, a: 1 },
      sourceRefs: { nested: true },
      id: 'payload-id',
      z: [null, '', { token: '}' }],
    };
    expect((await compareChatGptArchives({ ...input, sha256 })).messages.conflicts).toEqual([]);
    r.arguments.id = 'different';
    expect(
      (await compareChatGptArchives({ ...input, sha256 })).messages.conflicts[0].fields
    ).toEqual(['blocks']);
    r.arguments = clone(l.arguments);
    r.arguments.extensions = { a: 1, b: 3 };
    expect(
      (await compareChatGptArchives({ ...input, sha256 })).messages.conflicts[0].fields
    ).toEqual(['blocks']);
    r.arguments = clone(l.arguments);
    r.arguments.sourceRefs = {};
    expect(
      (await compareChatGptArchives({ ...input, sha256 })).messages.conflicts[0].fields
    ).toEqual(['blocks']);
  });

  it('reports ordered-block and text changes only through static labels and hashes', async () => {
    const input = pair();
    message(input.right).blocks.reverse();
    let report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.messages.conflicts).toMatchObject([
      { id: 'message-current', fields: ['blocks'], contentConflict: true },
    ]);
    expect(report.nodes.conflicts).toEqual([]);
    expect(report.messages.conflicts[0].leftSemanticSha256).not.toBe(
      report.messages.conflicts[0].rightSemanticSha256
    );
    expectPrivate(report);
    const blocks = message(input.right).blocks;
    blocks.reverse();
    if (blocks[0].type === 'text') blocks[0].text += 'changed';
    report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.messages.conflicts[0].fields).toEqual(['blocks']);
    expectPrivate(report);
  });

  it('uses an explicit semantic field allowlist for every block variant', async () => {
    const payloads: Array<Record<string, JsonValue>> = [
      { type: 'text', text: SENTINEL },
      { type: 'markdown', markdown: SENTINEL },
      { type: 'html', html: SENTINEL },
      { type: 'code', code: SENTINEL, language: null },
      { type: 'reasoning', text: SENTINEL },
      { type: 'tool_call', toolName: SENTINEL, arguments: { id: SENTINEL } },
      { type: 'tool_result', toolName: null, result: { sourceRefs: SENTINEL } },
      { type: 'execution_output', output: [SENTINEL] },
      { type: 'citation', label: SENTINEL, url: URL, content: null },
      { type: 'quote', text: SENTINEL, attribution: null },
      { type: 'attachment', assetId: 'asset-synthetic-image' },
      { type: 'canvas_event', event: { extensions: { private: SENTINEL } } },
      { type: 'error', message: SENTINEL, code: null },
      {
        type: 'unknown',
        providerType: SENTINEL,
        raw: { id: SENTINEL, sourceRefs: SENTINEL, extensions: SENTINEL },
      },
    ];
    for (const payload of payloads) {
      const input = pair();
      message(input.left).blocks = [
        {
          id: 'variant',
          sourceRefs: clone(fixture.conversation.sourceRefs),
          extensions: {},
          ...payload,
        } as unknown as ArchiveBlock,
      ];
      message(input.right).blocks = clone(message(input.left).blocks);
      const report = await compareChatGptArchives({ ...input, sha256 });
      expect(report.messages.conflicts).toEqual([]);
      expectPrivate(report);
      if (payload.type !== 'attachment') {
        const block = message(input.right).blocks[0] as unknown as Record<string, JsonValue>;
        const key = Object.keys(payload).find(key => key !== 'type')!;
        const original = block[key];
        block[key] = typeof original === 'string' ? `${original}changed` : { changed: true };
        // Some typed fields require nullable strings; preserve their canonical shape.
        if (key === 'toolName') block[key] = 'changed';
        expect(
          (await compareChatGptArchives({ ...input, sha256 })).messages.conflicts[0].fields
        ).toEqual(['blocks']);
      }
    }
  });

  it('keeps sibling/root order differences informational and detects derived evidence', async () => {
    const input = pair();
    for (const archive of [input.left, input.right]) {
      archive.graph.nodes['second-root'] = {
        ...clone(archive.graph.nodes['node-root']),
        id: 'second-root',
        childIds: [],
      };
      archive.graph.rootIds.push('second-root');
    }
    input.right.graph.rootIds.reverse();
    input.right.graph.nodes['node-user'].childIds.reverse();
    input.right.diagnostics.entries.push(diagnostic('official-export-children-derived'));
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.topology).toMatchObject({
      rootMembershipEqual: true,
      rootOrderEqual: false,
      rootOrderInformational: true,
      leafMembershipEqual: true,
      branchPointMembershipEqual: true,
      leafPathDifferenceIds: [],
      childOrderDifferenceIds: ['node-user'],
    });
    expect(report.nodes.conflicts).toMatchObject([
      { id: 'node-user', fields: ['child-order'], contentConflict: false },
    ]);
    expect(report.messages.conflicts).toEqual([]);
    expect(report.facts.right.orderEvidence).toBe('parent-derived');
    expect(report.notices).toHaveLength(4);
    expectPrivate(report);
  });

  it('compares exact leaf ancestor chains without ordinal branch matching', async () => {
    const input = pair();
    input.right.graph.nodes['node-user'].childIds = ['node-alternate'];
    input.right.graph.nodes['node-root'].childIds.push('node-current');
    input.right.graph.nodes['node-current'].parentId = 'node-root';
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.topology.leafPathDifferenceIds).toEqual(['node-current']);
    expect(report.topology.branchPoints).toEqual({
      leftOnlyIds: ['node-user'],
      rightOnlyIds: ['node-root'],
    });
    expect(report.nodes.conflicts.map(row => [row.id, row.fields])).toEqual([
      ['node-current', ['parent']],
      ['node-root', ['child-membership']],
      ['node-user', ['child-membership']],
    ]);
    expect(report.messages.conflicts).toEqual([]);
  });

  it('reports current-node and root/leaf membership differences explicitly', async () => {
    const input = pair();
    input.right.conversation.currentNodeId = null;
    input.right.graph.nodes['extra-root'] = {
      ...clone(input.right.graph.nodes['node-root']),
      id: 'extra-root',
      childIds: [],
    };
    input.right.graph.rootIds.push('extra-root');
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.topology).toMatchObject({
      currentNodeEqual: false,
      rootMembershipEqual: false,
      rootOrderEqual: false,
      roots: { leftOnlyIds: [], rightOnlyIds: ['extra-root'] },
      leafMembershipEqual: false,
      leaves: { leftOnlyIds: [], rightOnlyIds: ['extra-root'] },
      leafPathDifferenceIds: [],
    });
    expect(report.facts.right.currentNodeId).toBeNull();
  });

  it('reports side-only IDs without matching text, names or source references', async () => {
    const input = pair();
    const node = input.right.graph.nodes['node-alternate'];
    delete input.right.graph.nodes['node-alternate'];
    input.right.graph.nodes['replacement-leaf'] = {
      ...node,
      id: 'replacement-leaf',
      message: { ...node.message!, id: 'replacement-message' },
    };
    input.right.graph.nodes['node-user'].childIds[1] = 'replacement-leaf';
    input.right.assets['new-asset'] = {
      ...clone(input.right.assets['asset-synthetic-image']),
      id: 'new-asset',
    };
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.nodes.leftOnlyIds).toEqual(['node-alternate']);
    expect(report.nodes.rightOnlyIds).toEqual(['replacement-leaf']);
    expect(report.messages.leftOnlyIds).toEqual(['message-alternate']);
    expect(report.messages.rightOnlyIds).toEqual(['replacement-message']);
    expect(report.assets.rightOnlyIds).toEqual(['new-asset']);
    expectPrivate(report);
  });

  it('matches a moved message ID independently of its owning node', async () => {
    const input = pair();
    input.right.graph.nodes['node-root'].message = message(input.right);
    delete input.right.graph.nodes['node-current'].message;
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.messages.matchedCount).toBe(2);
    expect(report.messages.leftOnlyIds).toEqual([]);
    expect(report.messages.conflicts).toMatchObject([
      { id: 'message-current', fields: ['owner-node'] },
    ]);
    expect(report.messages.right['message-current'].ownerNodeId).toBe('node-root');
    expect(report.nodes.conflicts.map(row => row.fields)).toEqual([['message-id'], ['message-id']]);
  });

  it('distinguishes null, empty string, absent JSON keys and ordered arrays', async () => {
    const input = pair();
    message(input.right).channel = '';
    input.right.conversation.title = null;
    input.left.conversation.metadata = { a: null, list: [1, 2] };
    input.right.conversation.metadata = { list: [2, 1] };
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.conversation.fields).toEqual(['title', 'metadata']);
    expect(report.messages.conflicts[0].fields).toEqual(['channel']);
  });

  it('reports static message-field differences without their values', async () => {
    const input = pair();
    Object.assign(message(input.right), {
      author: { role: SENTINEL, name: SENTINEL },
      recipient: SENTINEL,
      channel: SENTINEL,
      createdAt: null,
      updatedAt: null,
      status: SENTINEL,
      model: SENTINEL,
      visibility: SENTINEL,
    });
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.messages.conflicts[0].fields).toEqual([
      'author',
      'recipient',
      'channel',
      'createdAt',
      'updatedAt',
      'status',
      'model',
      'visibility',
    ]);
    expectPrivate(report);
  });

  it('hashes asset metadata, content claims and destination-honest acquisition separately', async () => {
    const input = pair();
    const asset = input.right.assets['asset-synthetic-image'];
    asset.filename = 'different';
    asset.byteLength = 5;
    asset.acquisition = { state: 'not-attempted', attemptedAt: null, detail: SENTINEL };
    asset.localArtifactRef = null;
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.assets.conflicts[0].fields).toEqual(['metadata', 'content-claim', 'acquisition']);
    expect(report.assets.right['asset-synthetic-image'].acquisitionState).toBe('not-attempted');
    expect(report.facts.right.assetsByAcquisitionState['not-attempted']).toBe(1);
    expectPrivate(report);
  });

  it('reports safe diagnostic severity/code counts and collapses unsafe codes', async () => {
    const input = pair();
    input.left.diagnostics.entries = [
      diagnostic('safe-code'),
      diagnostic('safe-code'),
      diagnostic('safe-code', 'error'),
      diagnostic(`${URL}?${SENTINEL}`),
    ];
    input.right.diagnostics.entries = [
      diagnostic('safe-code'),
      diagnostic('a'.repeat(97)),
      diagnostic('UPPERCASE'),
      diagnostic('safe-code', 'info'),
    ];
    const report = await compareChatGptArchives({ ...input, sha256 });
    expect(report.diagnostics).toEqual([
      { severity: 'error', code: 'safe-code', leftCount: 1, rightCount: 0 },
      { severity: 'info', code: 'safe-code', leftCount: 0, rightCount: 1 },
      { severity: 'warning', code: 'safe-code', leftCount: 2, rightCount: 1 },
      { severity: 'warning', code: 'unclassified-diagnostic-code', leftCount: 1, rightCount: 2 },
    ]);
    expectPrivate(report);
  });

  it('accepts reversed orientation and repeats deterministically without changing frozen input', async () => {
    const input = pair();
    message(input.right).channel = 'changed';
    const before = clone(input);
    freezeDeep(input);
    const forward = await compareChatGptArchives({ ...input, sha256 });
    const repeated = await compareChatGptArchives({ ...input, sha256 });
    const reverse = await compareChatGptArchives({ left: input.right, right: input.left, sha256 });
    expect(repeated).toEqual(forward);
    expect(input).toEqual(before);
    expect(reverse.scopes.left.normalizer).toBe('chatgpt-official/1');
    expect(reverse.messages.conflicts[0].leftSemanticSha256).toBe(
      forward.messages.conflicts[0].rightSemanticSha256
    );
    expect(reverse.messages.conflicts[0].rightSemanticSha256).toBe(
      forward.messages.conflicts[0].leftSemanticSha256
    );
  });

  it('rejects invalid requests, archives, identity, input cardinality and normalizer pairs', async () => {
    await expectError(null as never, 'invalid-request');
    await expectError({ ...pair(), sha256: null as never }, 'invalid-request');
    await expectError({ ...pair(), left: {}, sha256 }, 'archive-invalid');
    let input = pair();
    input.left.conversation.provider = 'other';
    await expectError({ ...input, sha256 }, 'provider-mismatch');
    input = pair();
    input.right.conversation.id = 'other';
    await expectError({ ...input, sha256 }, 'conversation-mismatch');
    input = pair();
    input.right.inputs[0].normalizer = 'chatgpt-web/1';
    await expectError({ ...input, sha256 }, 'normalizer-pair-invalid');
    input = pair();
    input.right.inputs[0].normalizer = 'other';
    await expectError({ ...input, sha256 }, 'normalizer-pair-invalid');
    input = pair();
    input.right.inputs.push({ ...clone(input.right.inputs[0]), captureId: 'another' });
    expect(validateLiskaThreadArchive(input.right).valid).toBe(true);
    await expectError({ ...input, sha256 }, 'input-count-invalid');
    input = pair();
    input.left.inputs = [];
    await expectError({ ...input, sha256 }, 'input-count-invalid');
    input = pair();
    input.right.graph.nodes['node-user'].childIds = [];
    await expectError({ ...input, sha256 }, 'archive-invalid');
  });

  it.each([
    'maxJsonValues',
    'maxJsonDepth',
    'maxJsonStringCodeUnits',
    'maxNodes',
    'maxBlocks',
    'maxAssets',
    'maxDiagnostics',
    'maxDifferenceRows',
    'maxDigestProjectionBytes',
    'maxAggregateDigestBytes',
  ] as const)('enforces lowered %s before hashing', async key => {
    const input = pair();
    input.left.diagnostics.entries.push(diagnostic('some-code'));
    const hash = vi.fn(sha256);
    await expectError({ ...input, sha256: hash, limits: { [key]: 0 } }, 'limit-exceeded');
    expect(hash).not.toHaveBeenCalled();
  });

  it('enforces combined limits exactly and rejects raised/non-integral/unknown limits', async () => {
    const input = pair();
    expect(
      (
        await compareChatGptArchives({
          ...input,
          sha256,
          limits: {
            maxNodes: 8,
            maxBlocks: 16,
            maxAssets: 2,
            maxDiagnostics: 0,
            maxDifferenceRows: 0,
          },
        })
      ).nodes.matchedCount
    ).toBe(4);
    await expectError({ ...input, sha256, limits: { maxNodes: 7 } }, 'limit-exceeded');
    for (const value of [-1, NaN, Infinity, 1.5, CHATGPT_COMPARISON_HARD_LIMITS.maxNodes + 1])
      await expectError({ ...input, sha256, limits: { maxNodes: value } }, 'invalid-limits');
    await expectError(
      { ...input, sha256, limits: { bogus: 2 } as Partial<ChatGptComparisonLimits> },
      'invalid-limits'
    );
  });

  it('enforces exact UTF-8 report byte limits at the boundary and one byte over', async () => {
    const input = pair();
    for (const archive of [input.left, input.right]) archive.inputs[0].captureId += '-Лиска-♥';
    const baseline = await compareChatGptArchives({ ...input, sha256 });
    const size = new TextEncoder().encode(JSON.stringify(baseline)).byteLength;
    expect(
      await compareChatGptArchives({ ...input, sha256, limits: { maxReportBytes: size } })
    ).toEqual(baseline);
    await expectError({ ...input, sha256, limits: { maxReportBytes: size - 1 } }, 'limit-exceeded');
    await expectError(
      {
        ...input,
        sha256,
        limits: { maxReportBytes: CHATGPT_COMPARISON_HARD_LIMITS.maxReportBytes + 1 },
      },
      'invalid-limits'
    );
  });

  it('enforces exact aggregate/projection UTF-8 digest byte boundaries', async () => {
    const input = pair();
    for (const archive of [input.left, input.right])
      archive.conversation.metadata = { '10': 'Лиска', '2': '♥', a: { '\uE000': 1, '𐀀': 2 } };
    const serialized: string[] = [];
    const captureHash = async (bytes: Uint8Array): Promise<string> => {
      serialized.push(new TextDecoder().decode(bytes));
      return sha256(bytes);
    };
    const baseline = await compareChatGptArchives({ ...input, sha256: captureHash });
    const aggregate = serialized.reduce(
      (sum, text) => sum + new TextEncoder().encode(text).byteLength,
      0
    );
    const projection = Math.max(
      ...serialized.map(text => new TextEncoder().encode(text).byteLength)
    );
    expect(serialized[0]).toContain('"metadata":{"10":"Лиска","2":"♥","a":{"𐀀":2,"\uE000":1}}');
    expect(
      await compareChatGptArchives({
        ...input,
        sha256,
        limits: { maxAggregateDigestBytes: aggregate, maxDigestProjectionBytes: projection },
      })
    ).toEqual(baseline);
    await expectError(
      { ...input, sha256, limits: { maxAggregateDigestBytes: aggregate - 1 } },
      'limit-exceeded'
    );
    await expectError(
      { ...input, sha256, limits: { maxDigestProjectionBytes: projection - 1 } },
      'limit-exceeded'
    );
  });

  it('rejects unsafe JSON without invoking accessors or toJSON', async () => {
    const getter = vi.fn(() => SENTINEL),
      toJSON = vi.fn(() => SENTINEL);
    const cases: Array<(input: ReturnType<typeof pair>) => void> = [
      input => {
        Object.defineProperty(input.left.conversation, 'title', { get: getter });
      },
      input => {
        input.left.conversation.metadata = { toJSON } as never;
      },
      input => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        input.left.conversation.metadata = cycle as never;
      },
      input => {
        input.left.conversation.metadata = { sparse: Array(1) } as never;
      },
      input => {
        input.left.conversation.metadata = { x: undefined } as never;
      },
      input => {
        input.left.conversation.metadata = { x: NaN };
      },
      input => {
        input.left.conversation.metadata = { x: new Date(0) } as never;
      },
      input => {
        input.left.conversation.metadata = { x: 1n } as never;
      },
      input => {
        Object.defineProperty(input.left.conversation.metadata, Symbol('private'), {
          value: SENTINEL,
        });
      },
    ];
    for (const mutate of cases) {
      const input = pair();
      mutate(input);
      const hash = vi.fn(sha256);
      await expectError({ ...input, sha256: hash }, 'invalid-json');
      expect(hash).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('sanitizes caller-thrown exported error lookalikes and exception text', async () => {
    const input = pair();
    const forged = new ChatGptComparisonError('invalid-json');
    forged.message = SENTINEL;
    input.left = new Proxy(input.left, {
      getPrototypeOf() {
        throw forged;
      },
    });
    await expectError({ ...input, sha256 }, 'archive-invalid');
  });

  it('sanitizes hostile and revoked proxies thrown by caller traps', async () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(SENTINEL);
        },
      }
    );
    const hostileInput = new Proxy(pair(), {
      getPrototypeOf() {
        throw hostile;
      },
    });
    await expectError(hostileInput as never, 'archive-invalid');

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const revokedInput = new Proxy(pair(), {
      getPrototypeOf() {
        throw revoked.proxy;
      },
    });
    await expectError(revokedInput as never, 'archive-invalid');
  });

  it.each(['object', 'array'] as const)(
    'rejects a wide %s before reading all child descriptors',
    async kind => {
      const input = pair();
      const width = 10_000;
      const target =
        kind === 'array'
          ? Array.from({ length: width }, (_, index) => index)
          : Object.fromEntries(
              Array.from({ length: width }, (_, index) => [`key-${index}`, index])
            );
      let descriptorReads = 0;
      const wide = new Proxy(target, {
        getOwnPropertyDescriptor(value, key) {
          descriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(value, key);
        },
      });
      input.left.conversation.metadata = { wide } as never;
      await expectError({ ...input, sha256, limits: { maxJsonValues: 1_000 } }, 'limit-exceeded');
      expect(descriptorReads).toBe(0);
    }
  );

  it('rejects invalid, throwing and mutating hash implementations with value-free errors', async () => {
    for (const result of ['A'.repeat(64), 'a'.repeat(63), `${SENTINEL}`, null])
      await expectError({ ...pair(), sha256: async () => result as string }, 'sha256-invalid');
    await expectError(
      {
        ...pair(),
        sha256: async () => {
          throw new Error(SENTINEL);
        },
      },
      'sha256-failed'
    );
    await expectError(
      {
        ...pair(),
        sha256: async bytes => {
          const digest = await sha256(bytes);
          bytes[0] ^= 1;
          return digest;
        },
      },
      'sha256-mutated'
    );
  });

  it('detaches every projection and report field before the first hash await', async () => {
    const input = pair();
    const baseline = await compareChatGptArchives({ ...input, sha256 });
    let calls = 0;
    const hash = async (bytes: Uint8Array): Promise<string> => {
      calls += 1;
      if (calls === 1) {
        input.left.conversation.title = 'mutated';
        input.right.graph.nodes['node-current'].childIds.push('bad');
        message(input.left).blocks.reverse();
        input.right.inputs[0].captureId = 'changed';
        input.left.assets['asset-synthetic-image'].filename = 'mutated';
        input.right.diagnostics.entries.push(diagnostic('new-code'));
      }
      await Promise.resolve();
      return sha256(bytes);
    };
    expect(await compareChatGptArchives({ ...input, sha256: hash })).toEqual(baseline);
  });

  it('domain-separates versioned UTF-8 projections and hashes sequentially', async () => {
    const input = pair();
    const envelopes: Array<{ domain: string; version: string; value: JsonValue }> = [];
    let active = 0,
      maxActive = 0;
    const hash = async (bytes: Uint8Array): Promise<string> => {
      active += 1;
      maxActive = Math.max(active, maxActive);
      envelopes.push(JSON.parse(new TextDecoder().decode(bytes)));
      await Promise.resolve();
      active -= 1;
      return sha256(bytes);
    };
    await compareChatGptArchives({ ...input, sha256: hash });
    expect(maxActive).toBe(1);
    expect(new Set(envelopes.map(item => item.domain))).toEqual(
      new Set(['conversation', 'node', 'message', 'asset'])
    );
    expect(new Set(envelopes.map(item => item.version))).toEqual(
      new Set(['chatgpt-canonical-semantic/1'])
    );
  });
});
