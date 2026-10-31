import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  validateArchiveStageSender,
  validateClaudeArchiveStageAbortSender,
  validateMessageContent,
} from '../../src/background/validation';
import { ARCHIVE_STAGE_MAX_BYTES } from '../../src/lib/archive-stage-contract';
import { CHATGPT_INLINE_CAPTURE_MAX_BYTES } from '../../src/lib/chatgpt-capture-contract';
import { bytesToBase64 } from '../../src/lib/image-utils';
import type { ExtensionMessage } from '../../src/lib/types';
import { branchHtmlMessage } from './derived-branch-html-fixture';
import { htmlMessage, htmlSettings } from './derived-html-fixture';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  persist: vi.fn(),
  stage: vi.fn(),
  derived: vi.fn(),
  branch: vi.fn(),
}));

vi.mock('../../src/lib/storage', () => ({
  getSettings: () => mocks.getSettings(),
  migrateSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/background/output-handlers', () => ({
  handlePersistArchiveCompanion: (...args: unknown[]) => mocks.persist(...args),
  handlePersistDerivedHtmlPresentation: (...args: unknown[]) => mocks.derived(...args),
  handlePersistDerivedBranchHtmlPresentation: (...args: unknown[]) => mocks.branch(...args),
}));
vi.mock('../../src/background/archive-stage-handlers', () => ({
  handleArchiveStageMessage: (...args: unknown[]) => mocks.stage(...args),
}));

const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';
const conversationUrl = `https://claude.ai/chat/${conversationId}`;
const stageId = `archive-stage-${'A'.repeat(32)}`;
const descriptor = {
  kind: 'raw' as const,
  relativePath: 'responses/conversation.json',
  mediaType: 'application/json' as const,
  byteLength: 2,
  sha256: 'b'.repeat(64),
};

function sender(overrides: Partial<chrome.runtime.MessageSender> = {}) {
  return {
    tab: { url: conversationUrl },
    frameId: 0,
    url: conversationUrl,
    ...overrides,
  } as chrome.runtime.MessageSender;
}

function companion(): Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }> {
  return {
    action: 'persistArchiveCompanion',
    source: 'claude',
    noteFileName: 'synthetic.md',
    captureId: 'capture-claude-11111111-2222-4333-8444-555555555555',
    conversationKey: 'a'.repeat(64),
    artifact: { ...descriptor, transport: 'inline', bodyBase64: 'e30=' },
    outputs: ['file', 'obsidian'],
  };
}

function stageRequests(): ExtensionMessage[] {
  return [
    { action: 'beginStagedArchiveArtifact', source: 'claude', descriptor },
    {
      action: 'appendStagedArchiveArtifact',
      source: 'claude',
      stageId,
      offset: 0,
      chunkBase64: 'e30=',
    },
    { action: 'sealStagedArchiveArtifact', source: 'claude', stageId, descriptor },
    {
      action: 'readStagedArchiveArtifact',
      source: 'claude',
      stageId,
      offset: 0,
      byteLength: 2,
    },
    {
      ...companion(),
      action: 'commitStagedArchiveCompanion',
      source: 'claude',
      artifact: { ...descriptor, transport: 'staged', stageId },
    },
    { action: 'abortStagedArchiveArtifact', source: 'claude', stageId },
  ];
}

const rejectedSenders: (readonly [string, chrome.runtime.MessageSender])[] = [
  ...[
    `http://claude.ai/chat/${conversationId}`,
    `https://claude.ai.evil.test/chat/${conversationId}`,
    `https://www.claude.ai/chat/${conversationId}`,
    `https://claude.ai:444/chat/${conversationId}`,
    `https://chatgpt.com/c/${conversationId}`,
    'https://chat.deepseek.com/a/chat/s/synthetic',
    `https://user@claude.ai/chat/${conversationId}`,
    `https://user:password@claude.ai/chat/${conversationId}`,
    `https://claude.ai/chat/${conversationId}?q=1`,
    `https://claude.ai/chat/${conversationId}?`,
    `https://claude.ai/chat/${conversationId}#fragment`,
    `https://claude.ai/chat/${conversationId}#`,
    `https://claude.ai/chat/${conversationId}/`,
    `https://claude.ai/chat/${conversationId.toUpperCase()}`,
    `https://claude.ai/chat/${conversationId.replace(/-/g, '')}`,
    `https://claude.ai/chat/%30${conversationId.slice(1)}`,
    'https://claude.ai/chat/not-a-uuid',
    `https://claude.ai/share/${conversationId}`,
    'https://claude.ai/new',
    `https://claude.ai/artifacts/${conversationId}`,
    `https://claude.ai/chat/${conversationId}/artifacts`,
    'not a URL',
  ].map(url => [`tab ${url}`, sender({ tab: { url } as chrome.tabs.Tab })] as const),
  ...[
    'http://claude.ai/new',
    'https://claude.ai.evil.test/new',
    'https://www.claude.ai/new',
    'https://chatgpt.com/',
    'https://user@claude.ai/new',
    'https://user:password@claude.ai/new',
    'not a URL',
  ].map(url => [`document ${url}`, sender({ url })] as const),
  ['subframe', sender({ frameId: 1 })],
  ['missing frame', sender({ frameId: undefined })],
  ['missing document URL', sender({ url: undefined })],
  ['missing tab', sender({ tab: undefined })],
];

const abortRejectedSenders: (readonly [string, chrome.runtime.MessageSender])[] = [
  ...[
    'http://claude.ai/new',
    'https://claude.ai.evil.test/new',
    'https://www.claude.ai/new',
    'https://claude.ai:444/new',
    'https://claude.ai:443/new',
    'https://user@claude.ai/new',
    'https://user:password@claude.ai/new',
    'https://chatgpt.com/',
    'https://chat.deepseek.com/',
    '',
    'not a URL',
  ].flatMap(url => [
    [`tab ${url}`, sender({ tab: { url } as chrome.tabs.Tab })] as const,
    [`document ${url}`, sender({ url })] as const,
  ]),
  ['subframe', sender({ frameId: 1 })],
  ['missing frame', sender({ frameId: undefined })],
  ['missing document URL', sender({ url: undefined })],
  ['missing tab URL', sender({ tab: {} as chrome.tabs.Tab })],
  ['missing tab', sender({ tab: undefined })],
];

describe('Claude exact archive transport admission', () => {
  it('accepts a top-frame exact route with an older same-origin SPA document', () => {
    for (const url of [conversationUrl, 'https://claude.ai/new', 'https://claude.ai/']) {
      expect(validateArchiveStageSender(sender({ url }), 'claude')).toBe(true);
    }
    expect(validateArchiveStageSender(sender(), 'chatgpt')).toBe(false);
    expect(validateArchiveStageSender(sender(), 'deepseek')).toBe(false);
  });

  it.each(rejectedSenders)('rejects %s', (_label, invalidSender) => {
    expect(validateArchiveStageSender(invalidSender, 'claude')).toBe(false);
  });

  it('allows only Claude cleanup after the tab leaves its exact chat route', () => {
    const afterNavigation = sender({ tab: { url: 'https://claude.ai/new' } as chrome.tabs.Tab });
    expect(validateClaudeArchiveStageAbortSender(afterNavigation, 'claude')).toBe(true);
    expect(validateArchiveStageSender(afterNavigation, 'claude')).toBe(false);
    expect(validateClaudeArchiveStageAbortSender(afterNavigation, 'chatgpt')).toBe(false);
    expect(validateClaudeArchiveStageAbortSender(afterNavigation, 'deepseek')).toBe(false);
  });

  it.each(abortRejectedSenders)(
    'rejects Claude cleanup from hostile %s',
    (_label, invalidSender) => {
      expect(validateClaudeArchiveStageAbortSender(invalidSender, 'claude')).toBe(false);
    }
  );

  it('admits only exact Claude companion and stage message shapes and sources', () => {
    for (const request of [companion(), ...stageRequests()]) {
      expect(validateMessageContent(request)).toBe(true);
      expect(validateMessageContent({ ...request, providerId: 'must-not-cross' })).toBe(false);
      expect(validateMessageContent({ ...request, source: 'gemini' })).toBe(false);
      expect(validateMessageContent({ ...request, source: 'claude.ai' })).toBe(false);
    }
    const request = companion();
    expect(
      validateMessageContent({ ...request, artifact: { ...request.artifact, extra: true } })
    ).toBe(false);
    expect(validateMessageContent({ ...request, outputs: ['clipboard'] })).toBe(false);
    expect(validateMessageContent({ ...request, outputs: ['file', 'file'] })).toBe(false);
  });

  it('retains the provider-neutral 16 MiB raw inline threshold and existing 64 MiB stage bound', () => {
    const request = companion();
    for (const byteLength of [
      CHATGPT_INLINE_CAPTURE_MAX_BYTES,
      CHATGPT_INLINE_CAPTURE_MAX_BYTES + 1,
    ]) {
      expect(
        validateMessageContent({
          ...request,
          artifact: {
            ...request.artifact,
            byteLength,
            bodyBase64: bytesToBase64(new Uint8Array(byteLength)),
          },
        })
      ).toBe(byteLength === CHATGPT_INLINE_CAPTURE_MAX_BYTES);
    }
    for (const byteLength of [CHATGPT_INLINE_CAPTURE_MAX_BYTES + 1, ARCHIVE_STAGE_MAX_BYTES]) {
      const staged = { ...descriptor, byteLength };
      expect(
        validateMessageContent({
          action: 'beginStagedArchiveArtifact',
          source: 'claude',
          descriptor: staged,
        })
      ).toBe(true);
      expect(
        validateMessageContent({
          ...request,
          action: 'commitStagedArchiveCompanion',
          artifact: { ...staged, transport: 'staged', stageId },
        })
      ).toBe(true);
    }
    expect(
      validateMessageContent({
        action: 'beginStagedArchiveArtifact',
        source: 'claude',
        descriptor: { ...descriptor, byteLength: ARCHIVE_STAGE_MAX_BYTES + 1 },
      })
    ).toBe(false);
  });
});

describe('Claude archive service-worker route', () => {
  let listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => boolean | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(htmlSettings());
    mocks.persist.mockResolvedValue({ allSuccessful: true, anySuccessful: true, results: [] });
    mocks.stage.mockResolvedValue({ success: true });
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(candidate => {
      listener = candidate as typeof listener;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  it('routes inline Claude persistence and all six stage actions with provider-bound authority', async () => {
    const inline = companion();
    const inlineResponse = vi.fn();
    expect(listener(inline, sender({ url: 'https://claude.ai/new' }), inlineResponse)).toBe(true);
    await vi.waitFor(() => expect(inlineResponse).toHaveBeenCalledOnce());
    expect(mocks.persist).toHaveBeenCalledExactlyOnceWith(inline, expect.any(Object));

    for (const request of stageRequests()) {
      const respond = vi.fn();
      expect(listener(request, sender(), respond)).toBe(true);
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      expect(mocks.stage).toHaveBeenLastCalledWith(
        request,
        ...(request.action === 'commitStagedArchiveCompanion' ? [expect.any(Object)] : [])
      );
    }
    expect(mocks.stage).toHaveBeenCalledTimes(6);
  });

  it.each(rejectedSenders)(
    'rejects inline and staged Claude persistence from %s',
    (_label, invalidSender) => {
      for (const request of [
        companion(),
        ...stageRequests().filter(request => request.action !== 'abortStagedArchiveArtifact'),
      ]) {
        const respond = vi.fn();
        expect(listener(request, invalidSender, respond)).toBe(false);
        expect(respond).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
      }
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.stage).not.toHaveBeenCalled();
    }
  );

  it('allows /new to abort only the existing Claude stage, not the other six archive actions', async () => {
    const afterNavigation = sender({ tab: { url: 'https://claude.ai/new' } as chrome.tabs.Tab });
    for (const request of [companion(), ...stageRequests()]) {
      const respond = vi.fn();
      if (request.action === 'abortStagedArchiveArtifact') {
        expect(listener(request, afterNavigation, respond)).toBe(true);
        await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
        expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(request);
      } else {
        expect(listener(request, afterNavigation, respond)).toBe(false);
        expect(respond).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
      }
    }
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each(abortRejectedSenders)(
    'rejects abort routing from hostile %s',
    (_label, invalidSender) => {
      const respond = vi.fn();
      expect(
        listener(
          { action: 'abortStagedArchiveArtifact', source: 'claude', stageId },
          invalidSender,
          respond
        )
      ).toBe(false);
      expect(respond).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
      expect(mocks.stage).not.toHaveBeenCalled();
    }
  );

  it('keeps non-Claude aborts and malformed stage capabilities rejected after Claude navigation', () => {
    const afterNavigation = sender({ tab: { url: 'https://claude.ai/new' } as chrome.tabs.Tab });
    for (const source of ['chatgpt', 'deepseek']) {
      const respond = vi.fn();
      expect(
        listener(
          { action: 'abortStagedArchiveArtifact', source, stageId },
          afterNavigation,
          respond
        )
      ).toBe(false);
      expect(respond).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
    }
    const respond = vi.fn();
    expect(
      listener(
        { action: 'abortStagedArchiveArtifact', source: 'claude', stageId: 'unsafe' },
        afterNavigation,
        respond
      )
    ).toBe(false);
    expect(respond).toHaveBeenCalledWith({ success: false, error: 'Invalid message content' });
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it('does not admit Claude to current-path or all-branches derived HTML', async () => {
    for (const request of [await htmlMessage(), await branchHtmlMessage()]) {
      const claude = { ...request, source: 'claude', captureId: 'capture-claude-synthetic' };
      expect(validateMessageContent(claude)).toBe(false);
      const invalidSource = vi.fn();
      expect(listener(claude, sender(), invalidSource)).toBe(false);
      expect(invalidSource).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid message content',
      });
      const invalidSender = vi.fn();
      expect(listener(request, sender(), invalidSender)).toBe(false);
      expect(invalidSender).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
    }
    expect(mocks.derived).not.toHaveBeenCalled();
    expect(mocks.branch).not.toHaveBeenCalled();
  });
});
