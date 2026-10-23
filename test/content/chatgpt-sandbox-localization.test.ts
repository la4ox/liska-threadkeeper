import { describe, expect, it } from 'vitest';
import { projectArchiveBranch } from '../../src/content/archive-projection';
import {
  buildChatGptSandboxLocalizationEvidence,
  localizeChatGptSandboxLinks,
  type ChatGptSandboxLocalizationEvidence,
} from '../../src/content/chatgpt-sandbox-localization';
import {
  buildChatGptBinaryAwareArchiveCompanion,
  captureChatGptArchive,
  captureChatGptCurrentBranch,
  retainChatGptStructuredPresentation,
} from '../../src/content/capture/chatgpt-current-branch';
import { buildChatGptDestinationArchiveReceipt } from '../../src/content/chatgpt-destination-receipt';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import { sha256Hex } from '../../src/content/capture/response';
import type { ConversationData, ChatGptStructuredPresentationContext } from '../../src/lib/types';
import type { RawCaptureAsset, RawCaptureAssetRecord } from '../../src/archive';

const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';
const captureId = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const firstText =
  '[one](sandbox:/mnt/data/a.pdf) and [again](sandbox:/mnt/data/a.pdf) then [two](sandbox:/mnt/data/b.pdf)';
const pointer = '/mapping/a~1node~0/message/content/parts/0';

function rawFixture(text = firstText) {
  return {
    conversation_id: conversationId,
    title: 'Synthetic sandbox links',
    current_node: 'a/node~',
    create_time: 1786963200,
    update_time: 1786963500,
    mapping: {
      root: { id: 'root', parent: null, children: ['a/node~', 'b'], message: null },
      'a/node~': {
        id: 'a/node~',
        parent: 'root',
        children: [],
        message: {
          id: 'assistant-a',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: [text] },
        },
      },
      b: {
        id: 'b',
        parent: 'root',
        children: [],
        message: {
          id: 'assistant-b',
          author: { role: 'assistant' },
          content: {
            content_type: 'text',
            parts: ['[sibling same path](sandbox:/mnt/data/a.pdf)'],
          },
        },
      },
    },
  };
}

async function request(raw = rawFixture()) {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  return {
    success: true as const,
    data: {
      transport: 'inline' as const,
      bodyBase64: Buffer.from(bytes).toString('base64'),
      byteLength: bytes.length,
      sha256: await sha256Hex(bytes),
      mediaType: 'application/json',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      routeFamily: 'standard' as const,
      transientAssetResolvers: [],
    },
  };
}

async function fixture(
  text = firstText,
  target?: string,
  transformRaw: (raw: ReturnType<typeof rawFixture>) => unknown = raw => raw
) {
  const raw = transformRaw(rawFixture(text));
  const capture = await captureChatGptArchive(conversationId, {
    requestCapture: () => request(raw as ReturnType<typeof rawFixture>),
    createCaptureId: () => captureId,
    now: () => new Date('2026-10-23T10:00:00.000Z'),
  });
  const projection = projectArchiveBranch(capture.archive, {
    targetNodeId: target,
    includeToolContent: true,
  });
  const context = retainChatGptStructuredPresentation(capture, projection, true)!;
  const data: ConversationData = {
    ...projection.data,
    capture: { mode: 'structured-api', completeness: 'complete' },
    ...(target && {
      presentation: {
        mode: 'selected-branch' as const,
        captureId,
        branchOrdinal: 2,
        branchCount: 2,
        branchPointCount: 1,
      },
    }),
  };
  const assets: RawCaptureAsset[] = await Promise.all(
    capture.assetExportContext!.rawCaptureBundle.manifest.assets.map(async (record, index) => {
      const bytes = new TextEncoder().encode(`%PDF-synthetic-${index}`);
      const sha256 = await sha256Hex(bytes);
      return {
        bytes,
        record: {
          ...record,
          state: 'fetched' as const,
          mediaType: 'application/pdf',
          attemptedAt: '2026-10-23T10:01:00.000Z',
          relativePath: `assets/${sha256}.pdf`,
          byteLength: bytes.length,
          sha256,
          detail: 'synthetic',
        },
      };
    })
  );
  const finalCompanion = await buildChatGptBinaryAwareArchiveCompanion(
    capture.assetExportContext!,
    assets.map(asset => asset.record),
    assets
  );
  const receipt = buildChatGptDestinationArchiveReceipt(finalCompanion, 'file', assets);
  const evidence = (await buildChatGptSandboxLocalizationEvidence(finalCompanion, receipt))!;
  expect(evidence).toBeDefined();
  return { capture, projection, context, data, assets, finalCompanion, receipt, evidence };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function localize(f: Fixture) {
  return localizeChatGptSandboxLinks(f.data, f.context, f.evidence, f.receipt, 'file');
}

async function rebindArchive(f: Fixture): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(f.capture.archive, null, 2));
  f.context = {
    ...f.context,
    canonical: { ...f.context.canonical, byteLength: bytes.length, sha256: await sha256Hex(bytes) },
  };
  const projection = projectArchiveBranch(f.capture.archive, {
    targetNodeId: f.context.targetNodeId,
    includeToolContent: true,
  });
  f.data = { ...f.data, messages: projection.data.messages };
}

async function resign(evidence: ChatGptSandboxLocalizationEvidence): Promise<void> {
  const { snapshotSha256: _ignored, ...payload } = evidence;
  Object.assign(evidence, {
    snapshotSha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(payload))),
  });
}

function localTarget(f: Fixture, asset: RawCaptureAsset): string {
  return `_liska-archive/${f.receipt.conversationKey}/${captureId}/${asset.record.relativePath}`;
}

describe('destination-owned sandbox link localization', () => {
  it('retains current context without cloning the archive; repeated renders are immutable and deterministic', async () => {
    const response = await request();
    const projection = await captureChatGptCurrentBranch(conversationId, true, {
      requestCapture: async () => response,
      createCaptureId: () => captureId,
    });
    expect(projection.chatGptStructuredPresentationContext).toMatchObject({
      selectedNodeIds: ['root', 'a/node~'],
      targetNodeId: 'a/node~',
      includeToolContent: true,
      captureId,
    });
    expect(Object.isFrozen(projection.chatGptStructuredPresentationContext?.selectedNodeIds)).toBe(
      true
    );
    const f = await fixture();
    expect(f.context.archive).toBe(f.capture.archive);
    const before = JSON.stringify(f);
    const first = await localize(f);
    const second = await localize(f);
    expect(first).toEqual(second);
    expect(first).not.toBe(f.data);
    expect(await localizeChatGptSandboxLinks(first, f.context, f.evidence, f.receipt, 'file')).toBe(
      first
    );
    expect(JSON.stringify(f)).toBe(before);
    const targets = f.assets.filter(asset =>
      asset.record.sourceRefs.some(ref => ref.rawPointer === pointer)
    );
    expect(targets).toHaveLength(2);
    const body = first.messages[0].content;
    expect(body).not.toContain('sandbox:');
    expect(body.match(/_liska-archive\//g)).toHaveLength(3);
    for (const asset of targets) expect(body).toContain(localTarget(f, asset));
    expect(first.messages[0].trustedMarkdownDestinations).toEqual(
      targets.map(asset => localTarget(f, asset)).sort()
    );
    const siblingAsset = f.assets.find(asset => !targets.includes(asset))!;
    expect(body).not.toContain(localTarget(f, siblingAsset));
    expect(first.metadata).toBe(f.data.metadata);
    expect(first.extractedAt).toBe(f.data.extractedAt);
    expect(first.title).toBe(f.data.title);
  });

  it('selects a sibling with the same sandbox path by message identity, never the current asset', async () => {
    const f = await fixture(firstText, 'b');
    const result = await localize(f);
    const asset = f.assets.find(item =>
      item.record.sourceRefs.some(ref => ref.rawPointer.includes('/mapping/b/'))
    )!;
    expect(result.messages[0].content).toContain(localTarget(f, asset));
    expect(result.presentation).toBe(f.data.presentation);
    expect(result.messages).toHaveLength(1);
  });

  it('resolves the supported conversation envelope with escaped node pointer segments', async () => {
    const f = await fixture(firstText, undefined, raw => ({ conversation: raw }));
    expect((await localize(f)).messages[0].content.match(/_liska-archive\//g)).toHaveLength(3);
  });

  it.each(['multimodal_text', 'user', 'nested-text'])(
    'does not grant inline authority to raw %s content',
    async kind => {
      const f = await fixture(firstText, undefined, raw => {
        const message = raw.mapping['a/node~'].message;
        if (kind === 'user') message.author.role = 'user';
        if (kind === 'multimodal_text') message.content.content_type = kind;
        if (kind === 'nested-text')
          message.content.parts = [{ content_type: 'text', text: firstText }] as never;
        return raw;
      });
      expect(await localize(f)).toBe(f.data);
    }
  );

  it('retains repeated links and aliases across multiple parts of one assistant message', async () => {
    const raw = rawFixture();
    raw.mapping['a/node~'].message.content.parts.push('[alias](sandbox:/mnt/data/a.pdf)');
    const capture = await captureChatGptArchive(conversationId, {
      requestCapture: () => request(raw),
      createCaptureId: () => captureId,
    });
    const repeated = capture.assetExportContext!.rawCaptureBundle.manifest.assets.filter(
      record => record.sourceRefs.length === 2
    );
    expect(repeated).toHaveLength(1);
    const f = await fixture();
    // Each fixture uses the real inventory and normalizer; records with aliases
    // stay one opaque identity and are not rejected merely for multiple refs.
    const projection = projectArchiveBranch(capture.archive, { includeToolContent: true });
    const assets = await Promise.all(
      capture.assetExportContext!.rawCaptureBundle.manifest.assets.map(async (record, index) => {
        const base = f.assets[index];
        return {
          bytes: base.bytes,
          record: { ...base.record, id: record.id, sourceRefs: record.sourceRefs },
        };
      })
    );
    const final = await buildChatGptBinaryAwareArchiveCompanion(
      capture.assetExportContext!,
      assets.map(asset => asset.record),
      assets
    );
    const receipt = buildChatGptDestinationArchiveReceipt(final, 'file', assets);
    const evidence = await buildChatGptSandboxLocalizationEvidence(final, receipt);
    const data = { ...projection.data, capture: f.data.capture };
    const result = await localizeChatGptSandboxLinks(
      data,
      retainChatGptStructuredPresentation(capture, projection, true),
      evidence,
      receipt,
      'file'
    );
    expect(result.messages[0].content.match(/_liska-archive\//g)).toHaveLength(4);
    expect(result.messages[0].content).not.toContain('sandbox:');
  });

  it('does not rewrite a link rendered inside a fence spanning two text parts', async () => {
    const f = await fixture(firstText, undefined, raw => {
      raw.mapping['a/node~'].message.content.parts = [
        '~~~markdown',
        '[example](sandbox:/mnt/data/a.pdf)\n~~~',
      ];
      return raw;
    });
    expect(f.data.messages[0].content).toContain('[example](sandbox:/mnt/data/a.pdf)');
    expect(await localize(f)).toBe(f.data);
  });

  it('does not swap a hidden fenced occurrence for a later visible link with the same identity', async () => {
    const f = await fixture(firstText, undefined, raw => {
      raw.mapping['a/node~'].message.content.parts = [
        '~~~markdown',
        '[hidden](sandbox:/mnt/data/a.pdf)\n~~~\n\n[visible](sandbox:/mnt/data/a.pdf)',
      ];
      return raw;
    });
    const result = await localize(f);
    expect(result).toBe(f.data);
    expect(result.messages[0].content).toContain('[hidden](sandbox:/mnt/data/a.pdf)');
    expect(result.messages[0].content).toContain('[visible](sandbox:/mnt/data/a.pdf)');
  });

  it.each(['dom-fallback', 'all-branches-leaf', 'all-branches-index', 'missing-context'])(
    'leaves %s presentations untouched',
    async mode => {
      const f = await fixture();
      if (mode === 'dom-fallback') f.data.capture = { mode, completeness: 'partial' };
      else if (mode === 'missing-context') f.context = undefined as never;
      else
        f.data.presentation = {
          mode: mode as 'all-branches-index',
          captureId,
          branchCount: 2,
          branchPointCount: 1,
        };
      expect(await localize(f)).toBe(f.data);
    }
  );

  it('uses only the requested destination, including a separate valid Obsidian receipt', async () => {
    const f = await fixture();
    expect(
      await localizeChatGptSandboxLinks(f.data, f.context, f.evidence, f.receipt, 'obsidian')
    ).toBe(f.data);
    const receipt = { ...f.receipt, destination: 'obsidian' as const };
    const evidence = await buildChatGptSandboxLocalizationEvidence(f.finalCompanion, receipt);
    const result = await localizeChatGptSandboxLinks(
      f.data,
      f.context,
      evidence,
      receipt,
      'obsidian'
    );
    expect(result.messages[0].content).toContain('_liska-archive/');
  });

  it.each([
    'capture',
    'conversation',
    'manifest',
    'canonical-hash',
    'canonical-length',
    'raw-hash',
    'receipt-tuple',
  ])('fails closed for %s binding drift', async field => {
    const f = await fixture();
    switch (field) {
      case 'capture':
        f.receipt.captureId += '-other';
        break;
      case 'conversation':
        f.receipt.conversationKey = 'a'.repeat(64);
        break;
      case 'manifest':
        f.receipt.manifestSha256 = 'a'.repeat(64);
        break;
      case 'canonical-hash':
        f.evidence.canonical.sha256 = 'a'.repeat(64);
        break;
      case 'canonical-length':
        f.evidence.canonical.byteLength += 1;
        break;
      case 'raw-hash':
        f.evidence.raw.sha256 = 'a'.repeat(64);
        break;
      case 'receipt-tuple':
        f.receipt.assets[0].byteLength += 1;
        break;
    }
    expect(await localize(f)).toBe(f.data);
  });

  it.each([
    'duplicate',
    'malformed',
    'failed',
    'not-attempted',
    'tuple',
    'source',
    'duplicate-source',
  ])('does not localize a %s finalized ledger', async mode => {
    const f = await fixture();
    const records = f.evidence.records as RawCaptureAssetRecord[];
    if (mode === 'duplicate') records.push({ ...records[0], state: 'failed' });
    else
      for (const record of records) {
        if (mode === 'malformed') record.id = 'not-an-opaque-id';
        if (mode === 'failed' || mode === 'not-attempted') record.state = mode;
        if (mode === 'tuple') record.byteLength! += 1;
        if (mode === 'source')
          record.sourceRefs = [
            { artifactId: 'conversation', rawPointer: '/mapping/wrong/message/content/parts/0' },
          ];
        if (mode === 'duplicate-source') record.sourceRefs.push({ ...record.sourceRefs[0] });
      }
    await resign(f.evidence);
    expect(await localize(f)).toBe(f.data);
  });

  it.each([
    'block-text',
    'block-source-owner',
    'block-pointer',
    'node-source',
    'message-source',
    'duplicate-block',
    'block-role',
    'unsupported-block',
  ])(
    'requires exact raw/canonical %s evidence even for an otherwise valid canonical archive',
    async mode => {
      const f = await fixture();
      const node = f.capture.archive.graph.nodes['a/node~'];
      const message = node.message!;
      const block = message.blocks[0];
      if (mode === 'block-text' && block.type === 'text') block.text += ' edited';
      if (mode === 'block-source-owner') block.sourceRefs[0].id = 'assistant-b';
      if (mode === 'block-pointer')
        block.sourceRefs[0].rawPointer = '/mapping/b/message/content/parts/0';
      if (mode === 'node-source') node.sourceRefs[0].id = 'b';
      if (mode === 'message-source') message.sourceRefs[0].rawPointer = '/mapping/b/message';
      if (mode === 'duplicate-block') message.blocks.push({ ...block, id: 'duplicate-block' });
      if (mode === 'block-role') message.author.role = 'user';
      if (mode === 'unsupported-block' && block.type === 'text') {
        const { text, ...base } = block;
        message.blocks[0] = { ...base, type: 'markdown', markdown: text };
      }
      await rebindArchive(f);
      expect(await localize(f)).toBe(f.data);
    }
  );

  it.each([
    '`[code](sandbox:/mnt/data/a.pdf)`',
    '> [quote](sandbox:/mnt/data/a.pdf)',
    '<div>[html](sandbox:/mnt/data/a.pdf)</div>',
    '[reference][x]\n\n[x]: sandbox:/mnt/data/a.pdf',
  ])('does not reinterpret unsupported Markdown %s', async text => {
    const f = await fixture(text);
    expect(await localize(f)).toBe(f.data);
  });

  it('leaves privacy-modified raw text unchanged rather than guessing changed offsets', async () => {
    const f = await fixture(
      '[file](sandbox:/mnt/data/a.pdf) https://example.invalid/?access_token=synthetic'
    );
    expect(f.data.messages[0].content).not.toContain('access_token=synthetic');
    expect(await localize(f)).toBe(f.data);
  });

  it('rejects archive, raw ledger, raw bytes, and selected path drift after capture', async () => {
    for (const change of ['archive', 'raw-ledger', 'raw-bytes', 'selected-path']) {
      const f = await fixture();
      if (change === 'archive') f.capture.archive.conversation.title = 'Changed';
      if (change === 'raw-ledger')
        f.capture.assetExportContext!.rawCaptureBundle.manifest.assets[0].sourceRefs[0].rawPointer =
          '/changed';
      if (change === 'raw-bytes')
        f.capture.assetExportContext!.rawCaptureBundle.artifacts[0].bytes[0] = 0;
      if (change === 'selected-path') f.context = { ...f.context, selectedNodeIds: ['root', 'b'] };
      expect(await localize(f), change).toBe(f.data);
    }
  });

  it('checks late duplicate IDs in the whole ledger before filtering nonfetched records', async () => {
    const f = await fixture();
    const records = f.evidence.records as RawCaptureAssetRecord[];
    const first = records[0];
    for (let index = 0; index < 4200; index += 1)
      records.push({
        ...first,
        id: `chatgpt-asset-${index.toString(16).padStart(64, '0')}`,
        state: 'not-attempted',
      });
    records.push({ ...first, state: 'failed' });
    await resign(f.evidence);
    expect(await localize(f)).toBe(f.data);
  });

  it('rejects archive mutation during a digest await and does not throw on malformed optional evidence', async () => {
    const f = await fixture();
    const promise = localize(f);
    f.capture.archive.graph.nodes['a/node~'].message!.blocks.reverse();
    f.capture.archive.conversation.title = 'drift';
    expect(await promise).toBe(f.data);
    expect(
      await localizeChatGptSandboxLinks(
        f.data,
        {} as ChatGptStructuredPresentationContext,
        f.evidence,
        f.receipt,
        'file'
      )
    ).toBe(f.data);
  });

  it('detaches evidence before awaits and rejects invalid final manifest bytes', async () => {
    const f = await fixture();
    const receiptBefore = structuredClone(f.receipt);
    const pending = buildChatGptSandboxLocalizationEvidence(f.finalCompanion, f.receipt);
    f.receipt.assets[0].byteLength += 1;
    expect((await pending)?.receipt).toEqual(receiptBefore);
    const manifest = f.finalCompanion.artifacts.find(artifact => artifact.kind === 'manifest')!;
    if (manifest.transport === 'inline') manifest.bodyBase64 = 'e30=';
    expect(
      await buildChatGptSandboxLocalizationEvidence(f.finalCompanion, receiptBefore)
    ).toBeUndefined();
  });
});
