import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCaptureManifest } from '../../src/archive/capture';
import type { ArchiveCompanionBundle, InlineArchiveCompanionArtifact } from '../../src/lib/types';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../src/lib/constants';
import * as archiveProjection from '../../src/content/archive-projection';
import {
  CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING,
  CLAUDE_ASSET_INVENTORY_INCOMPLETE_WARNING,
  CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING,
  CLAUDE_DETAIL_MAX_BYTES,
  CLAUDE_DETAIL_PATH_PATTERN,
  CLAUDE_DETAIL_TIMEOUT_MS,
  CLAUDE_SCOPE_UNVERIFIED_WARNING,
  ClaudeStructuredCaptureError,
  fetchClaudeConversation,
  resolveClaudeOrganizationId,
} from '../../src/content/extractors/claude-api';

// Deliberately synthetic; no provider export or captured personal conversation is used here.
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const INACTIVE_ID = '55555555-5555-4555-8555-555555555555';
const ANSWER_ID = '66666666-6666-4666-8666-666666666666';
const CAPTURE_ID = 'capture-claude-synthetic-001';
const CAPTURE_TIME = '2026-10-31T07:00:00.000Z';
const FIXED_DEPENDENCIES = {
  createCaptureId: () => CAPTURE_ID,
  now: () => new Date(CAPTURE_TIME),
};
const RESOLVED_DEPENDENCIES = {
  ...FIXED_DEPENDENCIES,
  resolveOrganizationId: () => ORGANIZATION_ID,
};
const FIXED_WARNINGS = [
  CLAUDE_SCOPE_UNVERIFIED_WARNING,
  CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING,
  CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING,
];
const originalResourceDescriptor = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');

function syntheticDetail() {
  return {
    uuid: CONVERSATION_ID,
    name: 'Synthetic conversation — проверка',
    created_at: '2026-10-31T06:00:00.000Z',
    updated_at: '2026-10-31T06:30:00.000Z',
    current_leaf_message_uuid: ANSWER_ID,
    chat_messages: [
      {
        uuid: USER_ID,
        parent_message_uuid: null,
        index: 0,
        sender: 'human',
        text: 'A synthetic question.',
        content: [],
        attachments: [
          { uuid: '77777777-7777-4777-8777-777777777777', file_name: 'example.txt', file_size: 12 },
        ],
      },
      {
        uuid: INACTIVE_ID,
        parent_message_uuid: USER_ID,
        index: 1,
        sender: 'assistant',
        text: 'Inactive synthetic answer.',
        content: [],
      },
      {
        uuid: ANSWER_ID,
        parent_message_uuid: USER_ID,
        index: 2,
        sender: 'assistant',
        text: 'This legacy duplicate must not be projected.',
        content: [
          { type: 'thinking', thinking: 'Synthetic reasoning.' },
          { type: 'text', text: 'Visible synthetic answer.' },
          { type: 'tool_use', name: 'synthetic-tool', input: { value: 1 } },
          { type: 'FUTURE_WIDGET', payload: { label: 'Retain this unknown part.' } },
        ],
      },
    ],
  };
}

function detailBytes(detail: unknown = syntheticDetail()): Uint8Array {
  return new TextEncoder().encode(` \n${JSON.stringify(detail, null, 2)}\n`);
}

function inventoryOverCapDetail() {
  const raw = syntheticDetail();
  return {
    ...raw,
    current_leaf_message_uuid: USER_ID,
    chat_messages: [
      { ...raw.chat_messages[0], attachments: Array.from({ length: 50_001 }, () => ({})) },
    ],
  };
}

function detailResponse(bytes = detailBytes()): Response {
  return new Response(bytes.slice(), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function detailUrl(organizationId = ORGANIZATION_ID, conversationId = CONVERSATION_ID): string {
  return `https://claude.ai/api/organizations/${organizationId}/chat_conversations/${conversationId}`;
}

function resourceEntries(...names: string[]): void {
  vi.mocked(performance.getEntriesByType).mockReturnValue(
    names.map(name => ({ name, entryType: 'resource' }) as PerformanceEntry)
  );
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function inlineBytes(artifact: InlineArchiveCompanionArtifact): Uint8Array {
  return new Uint8Array(Buffer.from(artifact.bodyBase64, 'base64'));
}

function inlineArtifacts(
  companion: ArchiveCompanionBundle
): readonly InlineArchiveCompanionArtifact[] {
  expect(companion.artifacts.every(artifact => artifact.transport === 'inline')).toBe(true);
  return companion.artifacts as readonly InlineArchiveCompanionArtifact[];
}

function manifestOf(companion: ArchiveCompanionBundle): RawCaptureManifest {
  const manifest = inlineArtifacts(companion).find(artifact => artifact.kind === 'manifest')!;
  return JSON.parse(new TextDecoder().decode(inlineBytes(manifest))) as RawCaptureManifest;
}

function expectVerifiedRawPair(error: unknown, expectedBytes: Uint8Array): void {
  expect(error).toBeInstanceOf(ClaudeStructuredCaptureError);
  const companion = (error as ClaudeStructuredCaptureError).archiveCompanion!;
  const artifacts = inlineArtifacts(companion);
  expect(artifacts.map(artifact => artifact.kind)).toEqual(['raw', 'manifest']);
  expect(Buffer.from(inlineBytes(artifacts[0])).equals(Buffer.from(expectedBytes))).toBe(true);
  for (const artifact of artifacts) {
    expect(artifact.sha256).toBe(hash(inlineBytes(artifact)));
    expect(artifact.byteLength).toBe(inlineBytes(artifact).byteLength);
  }
  expect(manifestOf(companion).artifacts[0].sha256).toBe(hash(expectedBytes));
}

describe('Claude exact-detail capture and archive composition', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: vi.fn(() => []),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalResourceDescriptor)
      Object.defineProperty(performance, 'getEntriesByType', originalResourceDescriptor);
    else Reflect.deleteProperty(performance, 'getEntriesByType');
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('uses the latest matching exact resource without inspecting storage or credentials', async () => {
    resourceEntries(
      detailUrl(OTHER_ORGANIZATION_ID),
      detailUrl(),
      detailUrl(OTHER_ORGANIZATION_ID, INACTIVE_ID),
      `${detailUrl(OTHER_ORGANIZATION_ID)}?tree=true`,
      detailUrl(OTHER_ORGANIZATION_ID).replace('claude.ai', 'example.invalid')
    );
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const enumerate = vi.spyOn(Storage.prototype, 'key');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse());

    const result = await fetchClaudeConversation(CONVERSATION_ID, false, FIXED_DEPENDENCIES);

    expect(result).not.toBeNull();
    expect(performance.getEntriesByType).toHaveBeenCalledExactlyOnceWith('resource');
    expect(fetcher.mock.calls[0][0]).toBe(detailUrl());
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(enumerate).not.toHaveBeenCalled();
  });

  it('ignores mismatched resources and reads only the exact named organization hint', async () => {
    resourceEntries(
      detailUrl(ORGANIZATION_ID, INACTIVE_ID),
      `${detailUrl()}?query=1`,
      `${detailUrl()}#fragment`,
      `${detailUrl()}/extra`,
      detailUrl().replace('https://', 'https://synthetic-user@'),
      detailUrl().replace(ORGANIZATION_ID, 'not-a-canonical-uuid'),
      'https://claude.ai/api/organizations'
    );
    localStorage.setItem('ccd-sync-org', OTHER_ORGANIZATION_ID);
    localStorage.setItem('unrelated-token', 'must-not-be-read');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const enumerate = vi.spyOn(Storage.prototype, 'key');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse());

    await fetchClaudeConversation(CONVERSATION_ID, false, FIXED_DEPENDENCIES);

    expect(fetcher.mock.calls[0][0]).toBe(detailUrl(OTHER_ORGANIZATION_ID));
    expect(getItem).toHaveBeenCalledExactlyOnceWith('ccd-sync-org');
    expect(enumerate).not.toHaveBeenCalled();
  });

  it('can use the exact storage fallback when resource timing is unavailable', async () => {
    vi.mocked(performance.getEntriesByType).mockImplementation(() => {
      throw new Error('unavailable');
    });
    localStorage.setItem('ccd-sync-org', ORGANIZATION_ID);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse());

    await fetchClaudeConversation(CONVERSATION_ID, false, FIXED_DEPENDENCIES);

    expect(fetcher.mock.calls[0][0]).toBe(detailUrl());
  });

  it('can use an exact current-route verification banner as a non-secret routing hint', async () => {
    vi.mocked(performance.getEntriesByType).mockReturnValue([]);
    document.body.innerHTML = `<a href="https://portal.anthropic.com/verify?org=${ORGANIZATION_ID}&return_to=claude&return_path=%2Fchat%2F${CONVERSATION_ID}">Verify</a>`;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse());

    await fetchClaudeConversation(CONVERSATION_ID, false, FIXED_DEPENDENCIES);

    expect(fetcher.mock.calls[0][0]).toBe(detailUrl());
  });

  it('ignores malformed resources and a verification banner bound to another route', () => {
    resourceEntries('not a URL');
    document.body.innerHTML = `<a href="https://portal.anthropic.com/verify?org=${ORGANIZATION_ID}&return_to=claude&return_path=%2Fchat%2F${INACTIVE_ID}">Verify</a>`;

    expect(resolveClaudeOrganizationId(CONVERSATION_ID)).toBeNull();
  });

  it('fails closed when an injected organization resolver throws', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');

    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, {
        resolveOrganizationId: () => {
          throw new Error('private resolver failure');
        },
      })
    ).resolves.toBeNull();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '',
    ` ${ORGANIZATION_ID}`,
    `${ORGANIZATION_ID}\n`,
    JSON.stringify(ORGANIZATION_ID),
    JSON.stringify({ uuid: ORGANIZATION_ID }),
    ORGANIZATION_ID.replace('22222222', 'INVALID!'),
  ])(
    'returns null without a request when the sole storage hint is not an exact UUID: %j',
    async hint => {
      if (hint !== null) localStorage.setItem('ccd-sync-org', hint);
      const fetcher = vi.spyOn(globalThis, 'fetch');

      await expect(fetchClaudeConversation(CONVERSATION_ID, false)).resolves.toBeNull();

      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it('returns null without a request when both safe sources are unavailable', async () => {
    vi.mocked(performance.getEntriesByType).mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const fetcher = vi.spyOn(globalThis, 'fetch');

    await expect(fetchClaudeConversation(CONVERSATION_ID, false)).resolves.toBeNull();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates the requested conversation and any injected organization before a request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(
      fetchClaudeConversation(`${CONVERSATION_ID}?tree=true`, false, RESOLVED_DEPENDENCIES)
    ).rejects.toMatchObject({ code: 'conversation-id-invalid' });
    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, {
        resolveOrganizationId: () => `${ORGANIZATION_ID}/other`,
      })
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('issues one credential-free exact GET with the required fetch controls', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse());

    await fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(detailUrl());
    expect(new URL(String(url)).search).toBe('');
    expect(options).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
    expect([...new Headers(options!.headers).entries()]).toEqual([['accept', 'application/json']]);
    expect(options!.body).toBeUndefined();
    expect(options!.signal).toBeInstanceOf(AbortSignal);
    expect(options!.signal!.aborted).toBe(false);
  });

  it('binds exact UTF-8 raw bytes, conservative manifest and canonical hash provenance', async () => {
    const bytes = detailBytes();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(bytes));

    const result = (await fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES))!;

    const artifacts = inlineArtifacts(result.archiveCompanion);
    expect(artifacts.map(artifact => artifact.kind)).toEqual(['raw', 'manifest', 'canonical']);
    expect(Array.from(inlineBytes(artifacts[0]))).toEqual(Array.from(bytes));
    for (const artifact of artifacts) {
      expect(artifact.sha256).toBe(hash(inlineBytes(artifact)));
      expect(artifact.byteLength).toBe(inlineBytes(artifact).byteLength);
    }
    const manifest = manifestOf(result.archiveCompanion);
    expect(manifest).toMatchObject({
      schema: 'liska-capture/1',
      captureId: CAPTURE_ID,
      provider: 'claude',
      conversationId: CONVERSATION_ID,
      capturedAt: CAPTURE_TIME,
      method: 'same-origin-api',
      completeness: {
        graph: 'unknown',
        messages: 'unknown',
        branches: 'unknown',
        assets: 'not-attempted',
      },
      observedUnknownContentTypes: ['FUTURE_WIDGET'],
      warnings: FIXED_WARNINGS,
    });
    expect(manifest.artifacts).toEqual([
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: bytes.byteLength,
        sha256: hash(bytes),
        endpoint: { method: 'GET', pathPattern: CLAUDE_DETAIL_PATH_PATTERN },
      },
    ]);
    expect(manifest.assets).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^claude-asset-[a-f0-9]{64}$/),
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        byteLength: null,
        sha256: null,
        sourceRefs: [{ artifactId: 'conversation', rawPointer: '/chat_messages/0/attachments/0' }],
      }),
    ]);
    expect(JSON.stringify(manifest)).not.toContain(ORGANIZATION_ID);
    expect(JSON.stringify(result.archive)).not.toContain(ORGANIZATION_ID);
    expect(result.archive.inputs[0].manifestSha256).toBe(hash(inlineBytes(artifacts[1])));
    expect(JSON.parse(new TextDecoder().decode(inlineBytes(artifacts[2])))).toEqual(result.archive);
    expect(result.archiveCompanion.conversationKey).toBe(
      hash(new TextEncoder().encode(CONVERSATION_ID))
    );
  });

  it('projects only the current leaf, labels readable capture partial, and creates no presentation authority', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse());

    const result = (await fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES))!;

    expect(result.data.capture).toEqual({ mode: 'structured-api', completeness: 'partial' });
    expect(result.data.messages.map(message => message.id)).toEqual([USER_ID, ANSWER_ID]);
    expect(result.data.messages.map(message => message.content)).toEqual([
      'A synthetic question.',
      'Visible synthetic answer.',
    ]);
    expect(result.archive.graph.nodes[INACTIVE_ID]).toBeDefined();
    expect(result.data.messages.every(message => message.toolContent === undefined)).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining(FIXED_WARNINGS));
    expect(result).not.toHaveProperty('structuredPresentationContext');
    expect(result).not.toHaveProperty('chatGptStructuredPresentationContext');
    expect(result).not.toHaveProperty('assetExportContext');
  });

  it('changes only the readable reasoning/tool projection when includeThinking changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => detailResponse());

    const withoutThinking = (await fetchClaudeConversation(
      CONVERSATION_ID,
      false,
      RESOLVED_DEPENDENCIES
    ))!;
    const withThinking = (await fetchClaudeConversation(
      CONVERSATION_ID,
      true,
      RESOLVED_DEPENDENCIES
    ))!;

    expect(withoutThinking.archive).toEqual(withThinking.archive);
    expect(withoutThinking.archiveCompanion).toEqual(withThinking.archiveCompanion);
    expect(withoutThinking.data.messages.map(message => message.content)).toEqual(
      withThinking.data.messages.map(message => message.content)
    );
    expect(withThinking.data.messages[1].toolContent).toContain(
      '**Claude reasoning**\nSynthetic reasoning.'
    );
    expect(withThinking.data.messages[1].toolContent).toContain('Tool call: synthetic-tool');
    expect(
      withThinking.archive.graph.nodes[ANSWER_ID].message!.blocks.map(block => block.type)
    ).toEqual(['reasoning', 'markdown', 'tool_call', 'unknown']);
  });

  it('does not invent absent rich content when includeThinking is true', async () => {
    const raw = syntheticDetail();
    raw.chat_messages[2].content = [];
    raw.chat_messages[2].text = 'Only source text exists.';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(detailBytes(raw)));

    const result = (await fetchClaudeConversation(CONVERSATION_ID, true, RESOLVED_DEPENDENCIES))!;

    expect(result.data.messages[1]).toMatchObject({ content: 'Only source text exists.' });
    expect(result.data.messages[1].toolContent).toBeUndefined();
    expect(result.warnings).toContain(CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING);
    expect(manifestOf(result.archiveCompanion).completeness.messages).toBe('unknown');
  });

  it('bounds the readable title without changing exact raw or canonical title evidence', async () => {
    const raw = syntheticDetail();
    raw.name = 'Synthetic title '.repeat(20);
    const bytes = detailBytes(raw);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(bytes));

    const result = (await fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES))!;

    expect(result.data.title).toBe(raw.name.slice(0, MAX_CONVERSATION_TITLE_LENGTH));
    expect(result.archive.conversation.title).toBe(raw.name);
    expect(Array.from(inlineBytes(inlineArtifacts(result.archiveCompanion)[0]))).toEqual(
      Array.from(bytes)
    );
  });

  it('rejects mismatched response identity before normalization or companion persistence', async () => {
    const raw = syntheticDetail();
    raw.uuid = INACTIVE_ID;
    const normalizeCapture = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(detailBytes(raw)));

    const error = await fetchClaudeConversation(CONVERSATION_ID, false, {
      ...RESOLVED_DEPENDENCIES,
      normalizeCapture,
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'conversation-id-mismatch', archiveCompanion: undefined });
    expect(String(error)).not.toContain(INACTIVE_ID);
    expect(normalizeCapture).not.toHaveBeenCalled();
  });

  it('never preserves a mismatched conversation even when its asset inventory would exceed the cap', async () => {
    const raw = inventoryOverCapDetail();
    raw.uuid = INACTIVE_ID;
    const normalizeCapture = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(detailBytes(raw)));

    const error = await fetchClaudeConversation(CONVERSATION_ID, false, {
      ...RESOLVED_DEPENDENCIES,
      normalizeCapture,
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'conversation-id-mismatch', archiveCompanion: undefined });
    expect(normalizeCapture).not.toHaveBeenCalled();
  });

  it.each([
    new TextEncoder().encode('{broken-json'),
    new Uint8Array([0xc3, 0x28]),
    new TextEncoder().encode('{}'),
  ])('rejects malformed UTF-8, JSON, or schema with one stable bounded code', async bytes => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(bytes));
    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES)
    ).rejects.toMatchObject({ code: 'response-schema-invalid', archiveCompanion: undefined });
  });

  it.each([401, 503])(
    'cancels HTTP %s without reading or exposing response content',
    async status => {
      const response = new Response('synthetic sensitive failure detail', { status });
      const cancel = vi
        .spyOn(response.body!, 'cancel')
        .mockRejectedValue(new Error('synthetic sensitive cancellation detail'));
      const getReader = vi.spyOn(response.body!, 'getReader');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const error = await fetchClaudeConversation(
        CONVERSATION_ID,
        false,
        RESOLVED_DEPENDENCIES
      ).catch((reason: unknown) => reason);

      expect(error).toMatchObject({ code: 'response-status-invalid', archiveCompanion: undefined });
      expect(String(error)).not.toContain('sensitive');
      expect(cancel).toHaveBeenCalledOnce();
      expect(getReader).not.toHaveBeenCalled();
    }
  );

  it('does not accept an empty 204 merely because Response.ok is true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES)
    ).rejects.toMatchObject({ code: 'response-status-invalid' });
  });

  it.each([null, 'text/html', 'application/problem+json'])(
    'rejects an unexpected media type %j before reading its body',
    async contentType => {
      const response = new Response(detailBytes(), {
        status: 200,
        headers: contentType ? { 'content-type': contentType } : {},
      });
      const cancel = vi.spyOn(response.body!, 'cancel');
      const getReader = vi.spyOn(response.body!, 'getReader');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      await expect(
        fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES)
      ).rejects.toMatchObject({ code: 'response-media-type-invalid' });

      expect(cancel).toHaveBeenCalledOnce();
      expect(getReader).not.toHaveBeenCalled();
    }
  );

  it('rejects a declared oversized response before reading bytes', async () => {
    const response = detailResponse();
    response.headers.set('content-length', String(CLAUDE_DETAIL_MAX_BYTES + 1));
    const cancel = vi.spyOn(response.body!, 'cancel');
    const getReader = vi.spyOn(response.body!, 'getReader');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES)
    ).rejects.toMatchObject({ code: 'response-too-large' });

    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('enforces the 32 MiB limit during streaming even without a declared size', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(CLAUDE_DETAIL_MAX_BYTES + 1));
        },
        cancel,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, RESOLVED_DEPENDENCIES)
    ).rejects.toMatchObject({ code: 'response-too-large' });

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds a fetch that ignores abort and does not consume a late response', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          resolveFetch = resolve;
        })
    );
    const normalizeCapture = vi.fn();
    const pending = fetchClaudeConversation(CONVERSATION_ID, false, {
      ...RESOLVED_DEPENDENCIES,
      normalizeCapture,
    }).catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(CLAUDE_DETAIL_TIMEOUT_MS);
    const error = await pending;
    const response = detailResponse();
    const cancel = vi.spyOn(response.body!, 'cancel');
    const getReader = vi.spyOn(response.body!, 'getReader');
    resolveFetch(response);
    await Promise.resolve();

    expect(error).toMatchObject({ code: 'request-timeout', archiveCompanion: undefined });
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
    expect(normalizeCapture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds a successful response whose body never finishes', async () => {
    vi.useFakeTimers();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      }),
      { headers: { 'content-type': 'application/json' } }
    );
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const normalizeCapture = vi.fn();
    const pending = fetchClaudeConversation(CONVERSATION_ID, false, {
      ...RESOLVED_DEPENDENCIES,
      normalizeCapture,
    }).catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(CLAUDE_DETAIL_TIMEOUT_MS);
    const error = await pending;
    bodyController.close();
    await Promise.resolve();

    expect(error).toMatchObject({ code: 'request-timeout', archiveCompanion: undefined });
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(normalizeCapture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leak network error details or retry the request', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error(`synthetic network detail ${ORGANIZATION_ID}`));
    const error = await fetchClaudeConversation(
      CONVERSATION_ID,
      false,
      RESOLVED_DEPENDENCIES
    ).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'request-failed', archiveCompanion: undefined });
    expect(String(error)).not.toContain(ORGANIZATION_ID);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('preserves verified exact raw and manifest if normalization fails', async () => {
    const bytes = detailBytes();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(bytes));
    const error = await fetchClaudeConversation(CONVERSATION_ID, false, {
      ...RESOLVED_DEPENDENCIES,
      normalizeCapture: () => {
        throw new Error('synthetic untrusted normalizer failure');
      },
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'normalization-failed' });
    expect(String(error)).not.toContain('untrusted');
    expectVerifiedRawPair(error, bytes);
  });

  it('preserves verified raw and manifest when a matching detail has no current leaf', async () => {
    const raw = syntheticDetail();
    Reflect.deleteProperty(raw, 'current_leaf_message_uuid');
    const bytes = detailBytes(raw);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(bytes));

    const error = await fetchClaudeConversation(
      CONVERSATION_ID,
      false,
      RESOLVED_DEPENDENCIES
    ).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'normalization-failed' });
    expectVerifiedRawPair(error, bytes);
    const manifest = manifestOf((error as ClaudeStructuredCaptureError).archiveCompanion!);
    expect(manifest.completeness).toEqual({
      graph: 'unknown',
      messages: 'unknown',
      branches: 'unknown',
      assets: 'not-attempted',
    });
  });

  it('preserves a conservative verified pair before reporting an over-cap asset inventory', async () => {
    const bytes = detailBytes(inventoryOverCapDetail());
    const normalizeCapture = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(bytes));

    const error = await fetchClaudeConversation(CONVERSATION_ID, false, {
      ...RESOLVED_DEPENDENCIES,
      normalizeCapture,
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'asset-inventory-failed' });
    expectVerifiedRawPair(error, bytes);
    expect(normalizeCapture).not.toHaveBeenCalled();
    const manifest = manifestOf((error as ClaudeStructuredCaptureError).archiveCompanion!);
    expect(manifest.assets).toEqual([]);
    expect(manifest.completeness).toEqual({
      graph: 'unknown',
      messages: 'unknown',
      branches: 'unknown',
      assets: 'unknown',
    });
    expect(manifest.warnings).toEqual([
      CLAUDE_SCOPE_UNVERIFIED_WARNING,
      CLAUDE_ASSET_INVENTORY_INCOMPLETE_WARNING,
      CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING,
    ]);
    expect(manifest.warnings).not.toContain(CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING);
    expect(JSON.stringify(manifest)).not.toContain(ORGANIZATION_ID);
  });

  it('preserves the already verified pair if current-branch projection fails', async () => {
    const bytes = detailBytes();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(detailResponse(bytes));
    vi.spyOn(archiveProjection, 'projectArchiveBranch').mockImplementation(() => {
      throw new Error('synthetic projection failure');
    });

    const error = await fetchClaudeConversation(
      CONVERSATION_ID,
      false,
      RESOLVED_DEPENDENCIES
    ).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'projection-failed' });
    expectVerifiedRawPair(error, bytes);
  });

  it('bounds capture identity and clock failures without exposing hook error text', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => detailResponse());
    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, {
        ...RESOLVED_DEPENDENCIES,
        createCaptureId: () => 'unsafe capture id',
      })
    ).rejects.toMatchObject({ code: 'capture-id-invalid' });
    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, {
        ...RESOLVED_DEPENDENCIES,
        createCaptureId: () => {
          throw new Error('untrusted');
        },
      })
    ).rejects.toMatchObject({ code: 'capture-id-invalid' });
    await expect(
      fetchClaudeConversation(CONVERSATION_ID, false, {
        ...RESOLVED_DEPENDENCIES,
        now: () => new Date(Number.NaN),
      })
    ).rejects.toMatchObject({ code: 'capture-time-invalid' });
  });
});
