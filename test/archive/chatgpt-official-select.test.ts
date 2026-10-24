import { describe, expect, it } from 'vitest';
import {
  CHATGPT_OFFICIAL_HARD_LIMITS,
  ChatGptOfficialSelectionError,
  type ChatGptOfficialSelectionErrorCode,
  type ChatGptOfficialSelectionLimits,
  type SelectChatGptOfficialConversationInput,
} from '../../src/archive/importers/chatgpt-official/contracts';
import { selectChatGptOfficialConversation } from '../../src/archive/importers/chatgpt-official/select';

const textEncoder = new TextEncoder();
const encoder = {
  encode(text: string): Uint8Array {
    // jsdom and Node's TextEncoder can allocate typed arrays in different realms.
    return new Uint8Array(textEncoder.encode(text));
  },
};
const decoder = new TextDecoder();

function conversation(id: string, extras: Record<string, unknown> = {}): string {
  return JSON.stringify({ id, mapping: { root: { message: null } }, ...extras });
}

async function* chunks(bytes: Uint8Array, sizes = [bytes.length || 1]): AsyncIterable<Uint8Array> {
  let offset = 0;
  let index = 0;
  yield new Uint8Array(0);
  while (offset < bytes.length) {
    const end = Math.min(bytes.length, offset + sizes[index++ % sizes.length]);
    yield bytes.subarray(offset, end);
    offset = end;
  }
  yield new Uint8Array(0);
}

function select(
  source: string | Uint8Array,
  options: {
    id?: string;
    sizes?: number[];
    limits?: Partial<ChatGptOfficialSelectionLimits>;
  } = {}
) {
  return selectChatGptOfficialConversation({
    chunks: chunks(typeof source === 'string' ? encoder.encode(source) : source, options.sizes),
    conversationId: options.id ?? 'selected',
    limits: options.limits,
  });
}

async function refuses(
  source: string | Uint8Array,
  code: ChatGptOfficialSelectionErrorCode,
  options: Parameters<typeof select>[1] = {}
): Promise<void> {
  await expect(select(source, options)).rejects.toMatchObject({
    name: 'ChatGptOfficialSelectionError',
    code,
    message: `ChatGPT official export selection failed (${code}).`,
  });
}

describe('official ChatGPT exact-byte conversation selector', () => {
  const exactObject = [
    '{',
    String.raw`  "mapping": {"root": {"text": "raw Ж🌿; escaped \u0416; quote \"; slash \\; brackets } ] { ["}},`,
    String.raw`  "title": "Synthetic selected title",`,
    String.raw`  "conversation_id": "selected", "id": "selected"`,
    '}',
  ].join('\r\n');

  it.each([
    ['one byte', [1]],
    ['irregular', [2, 7, 1, 13, 3, 5]],
    ['one source chunk', [100_000]],
  ])(
    'preserves exact UTF-8 object bytes and source offsets with %s chunks',
    async (_name, sizes) => {
      const prefix = ` \r\n[\r\n${conversation('before', { title: 'BEFORE_SENTINEL Ω' })},\n\t`;
      const suffix = `,\r\n${conversation('after', { title: 'AFTER_SENTINEL' })}\r\n]\t \r\n`;
      const source = encoder.encode(prefix + exactObject + suffix);
      const expected = encoder.encode(exactObject);
      const result = await select(source, { sizes: sizes as number[] });

      expect(result).toEqual({
        bytes: expected,
        conversationId: 'selected',
        conversationIndex: 1,
        sourcePointer: '/1',
        sourceByteLength: source.length,
        byteStart: encoder.encode(prefix).length,
        byteEndExclusive: encoder.encode(prefix).length + expected.length,
      });
      expect(source.slice(result.byteStart, result.byteEndExclusive)).toEqual(result.bytes);
      expect(result.bytes.buffer).not.toBe(source.buffer);
      expect(result.bytes.byteOffset).toBe(0);
      expect(result.bytes.buffer.byteLength).toBe(expected.length);
      expect(decoder.decode(new Uint8Array(result.bytes.buffer))).not.toMatch(/BEFORE_|AFTER_/);
      expect(Object.keys(result).sort()).toEqual(
        [
          'bytes',
          'conversationId',
          'conversationIndex',
          'sourcePointer',
          'sourceByteLength',
          'byteStart',
          'byteEndExclusive',
        ].sort()
      );
    }
  );

  it('owns exact selected bytes independently of two-chat neighbor sentinels and source mutation', async () => {
    const expected = encoder.encode(conversation('selected'));
    const source = encoder.encode(
      `[${conversation('selected')},${conversation('neighbor', { text: 'NEIGHBOR_SENTINEL' })}]`
    );
    const result = await select(source);
    source.fill(0);
    expect(result.bytes).toEqual(expected);
    expect(result.bytes.buffer.byteLength).toBe(expected.length);
    expect(decoder.decode(new Uint8Array(result.bytes.buffer))).not.toContain('NEIGHBOR_SENTINEL');
  });

  it('copies spans before a generator reuses and overwrites its mutable chunk allocation', async () => {
    const expected = encoder.encode(exactObject);
    const source = encoder.encode(`[${exactObject},${conversation('neighbor')}]`);
    const scratch = new Uint8Array(7);
    async function* reused(): AsyncIterable<Uint8Array> {
      for (let offset = 0; offset < source.length; offset += scratch.length) {
        const length = Math.min(scratch.length, source.length - offset);
        scratch.set(source.subarray(offset, offset + length));
        yield scratch.subarray(0, length);
        scratch.fill(0xff);
      }
    }
    const result = await selectChatGptOfficialConversation({
      chunks: reused(),
      conversationId: 'selected',
    });
    scratch.fill(0);
    expect(result.bytes).toEqual(expected);
    expect(result.bytes.buffer).not.toBe(scratch.buffer);
  });

  it('accepts Uint8Array chunks allocated by a different runtime realm', async () => {
    const object = conversation('selected');
    const foreignBytes = textEncoder.encode(`[${object}]`);
    const result = await selectChatGptOfficialConversation({
      chunks: chunks(foreignBytes, [1, 5]),
      conversationId: 'selected',
    });
    expect(Array.from(result.bytes)).toEqual(Array.from(encoder.encode(object)));
  });

  it('accepts an own alias alone, exact matching aliases, and portable bounded IDs', async () => {
    const aliasOnly = JSON.stringify({ conversation_id: 'selected', mapping: { root: {} } });
    expect((await select(`[${aliasOnly}]`)).conversationIndex).toBe(0);
    const id = `a${'._:-0'.repeat(51)}`;
    expect(id).toHaveLength(256);
    expect((await select(`[${conversation(id)}]`, { id })).conversationId).toBe(id);
  });

  it('does not select a matching title or a plausible graph in place of exact identity', async () => {
    await refuses(`[${conversation('other', { title: 'selected' })}]`, 'conversation-not-found');
    await refuses('[]', 'conversation-not-found');
    await refuses(`[${conversation('SELECTED')}]`, 'conversation-not-found');
  });

  it.each([
    [{ mapping: { root: {} } }],
    [{ id: '', mapping: { root: {} } }],
    [{ id: 'a'.repeat(257), mapping: { root: {} } }],
    [{ id: null, mapping: { root: {} } }],
    [{ id: 7, mapping: { root: {} } }],
    [{ id: 'not portable', mapping: { root: {} } }],
    [{ id: '/selected', mapping: { root: {} } }],
    [{ id: 'selected\n', mapping: { root: {} } }],
    [{ id: 'selected', conversation_id: 'other', mapping: { root: {} } }],
    [{ id: 'selected', conversation_id: null, mapping: { root: {} } }],
    [{ id: 'selected', conversation_id: '', mapping: { root: {} } }],
    [{ metadata: { id: 'selected' }, mapping: { root: {} } }],
    [{ __proto__: { id: 'selected' }, mapping: { root: {} } }],
  ])('rejects missing, malformed, or disagreeing own identities: %j', async value => {
    await refuses(JSON.stringify([value]), 'malformed-id');
  });

  it.each([
    String.raw`{"id":"selected","id":"selected","mapping":{"root":{}}}`,
    String.raw`{"id":"selected","\u0069d":"other","mapping":{"root":{}}}`,
    String.raw`{"conversation_id":"selected","conversation_\u0069d":"selected","mapping":{"root":{}}}`,
  ])('refuses repeated identity keys, including escaped spellings', async value => {
    await refuses(`[${value}]`, 'duplicate-id', { sizes: [1] });
  });

  it('recognizes fully escaped identity keys without treating nested IDs as selectors', async () => {
    const source = String.raw`[{"\u0069\u0064":"selected","mapping":{"root":{"id":"nested-only"}}}]`;
    expect((await select(source)).conversationId).toBe('selected');
  });

  it.each([
    String.raw`{"id":"selected","mapping":{"first":{}},"mapping":{"second":{}}}`,
    String.raw`{"id":"selected","mapping":{"root":{},"root":{}}}`,
    String.raw`{"id":"selected","mapping":{"root":{"message":{"content":{"value":1,"value":2}}}}}`,
    String.raw`{"id":"selected","mapping":{"root":{"\u0069d":"a","id":"b"}}}`,
  ])(
    'refuses duplicate keys at any object depth before JSON.parse can discard evidence',
    async value => {
      await refuses(`[${value}]`, 'duplicate-key', { sizes: [1, 3, 11] });
    }
  );

  it.each([
    [conversation('selected'), conversation('selected')],
    [conversation('neighbor'), conversation('neighbor'), conversation('selected')],
    [conversation('selected'), conversation('neighbor'), conversation('neighbor')],
    [
      conversation('selected'),
      JSON.stringify({ conversation_id: 'selected', mapping: { root: {} } }),
    ],
  ])('refuses globally repeated identity anywhere in the source', async (...objects) => {
    await refuses(`[${objects.join(',')}]`, 'duplicate-id');
  });

  it.each([undefined, null, [], {}, 'mapping', 1].map(mapping => [mapping]))(
    'requires a nonempty plain mapping: %j',
    async mapping => {
      await refuses(`[${conversation('selected', { mapping })}]`, 'invalid-mapping');
    }
  );

  it.each(['{}', 'null', '"array"', '1', '[null]', '[1]', '["object"]', '[[]]'])(
    'rejects non-array roots or scalar entries: %s',
    async source => {
      await refuses(source, 'invalid-root');
    }
  );

  it.each([
    '',
    ' \r\n\t',
    '[',
    '[{',
    '[{"id":"selected"',
    '[{"id":"selected\\',
    '[{"mapping":[}',
    '[{"id":"selected","mapping":{"root":{}}',
    '[{"id":"selected","mapping":{"root":{}},"broken":}]',
    '[{"id":"selected","mapping":{"root":{}},"text":"\n"}]',
    `[${conversation('selected')},]`,
    `[${conversation('selected')}${conversation('other')}]`,
    `[${conversation('selected')}]null`,
    `[${conversation('selected')}] []`,
    `[${conversation('selected')}]\v`,
  ])('rejects malformed, trailing, or incomplete JSON: %s', async source => {
    await refuses(source, 'invalid-json', { sizes: [1, 2, 5] });
  });

  it('validates malformed neighbors even after an otherwise valid selected object', async () => {
    await refuses(`[${conversation('selected')},{"title":"NEIGHBOR_SENTINEL"}]`, 'malformed-id');
    await refuses(`[${conversation('selected')},`, 'invalid-json');
  });

  it.each([
    [0xff],
    [0x80],
    [0xc0, 0xaf],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xe2, 0x28, 0xa1],
  ])('rejects invalid UTF-8 without replacement decoding: %j', async (...invalid) => {
    const before = encoder.encode('[{"id":"selected","mapping":{"root":{}},"text":"');
    const after = encoder.encode('"}]');
    const source = new Uint8Array([...before, ...invalid, ...after]);
    await refuses(source, 'invalid-utf8', { sizes: [1] });
  });

  it('rejects truncated UTF-8 sequences and an explicit leading UTF-8 BOM across chunks', async () => {
    await refuses(new Uint8Array([0xef]), 'invalid-utf8', { sizes: [1] });
    await refuses(new Uint8Array([0xef, 0xbb]), 'invalid-utf8', { sizes: [1] });
    await refuses(
      new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(`[${conversation('selected')}]`)]),
      'bom-not-supported',
      { sizes: [1] }
    );
  });

  it('enforces source-byte limits over all bytes, including trailing whitespace after selection', async () => {
    const source = `[${conversation('selected')}]\r\n`;
    const length = encoder.encode(source).length;
    expect((await select(source, { limits: { maxSourceBytes: length } })).sourceByteLength).toBe(
      length
    );
    await refuses(source, 'source-limit', { limits: { maxSourceBytes: length - 1 }, sizes: [1] });
  });

  it('enforces exact object-byte limits on selected and unrelated objects', async () => {
    const object = conversation('selected');
    const length = encoder.encode(object).length;
    expect(
      (await select(`[${object}]`, { limits: { maxConversationBytes: length } })).bytes
    ).toHaveLength(length);
    await refuses(`[${object}]`, 'conversation-limit', {
      limits: { maxConversationBytes: length - 1 },
      sizes: [1],
    });
    await refuses(
      `[${object},${conversation('neighbor', { text: 'x'.repeat(128) })}]`,
      'conversation-limit',
      {
        limits: { maxConversationBytes: length },
      }
    );
  });

  it('enforces conversation counts even after selection', async () => {
    const first = conversation('selected');
    expect(
      (await select(`[${first}]`, { limits: { maxConversations: 1 } })).conversationIndex
    ).toBe(0);
    await refuses(`[${first},${conversation('other')}]`, 'conversation-count-limit', {
      limits: { maxConversations: 1 },
    });
  });

  it('counts object and array nesting, including the root, but not braces inside strings', async () => {
    const source = `[${conversation('selected', { text: '{{[[\\"}}]]' })}]`;
    expect((await select(source, { limits: { maxDepth: 4 } })).conversationId).toBe('selected');
    await refuses(source, 'depth-limit', { limits: { maxDepth: 3 } });
    await refuses(source, 'depth-limit', { limits: { maxDepth: 1 } });
    const deeper = `[${conversation('selected', { nested: [[[]]] })}]`;
    await refuses(deeper, 'depth-limit', { limits: { maxDepth: 4 } });
  });

  it('accepts the hard depth boundary and refuses one extra container', async () => {
    const nested = (count: number) =>
      `[{"id":"selected","mapping":{"root":{}},"deep":${'['.repeat(count)}0${']'.repeat(count)}}]`;
    expect((await select(nested(510), { sizes: [1] })).conversationId).toBe('selected');
    await refuses(nested(511), 'depth-limit', { sizes: [1] });
  });

  it('grows the bounded current buffer without corrupting multi-chunk content', async () => {
    const object = conversation('selected', { text: 'Ж'.repeat(4096) });
    const result = await select(`[${object}]`, { sizes: [3, 11, 128] });
    expect(result.bytes).toEqual(encoder.encode(object));
    expect(result.bytes.buffer.byteLength).toBe(encoder.encode(object).length);
  });

  it('publishes immutable hard maxima and refuses raising, noninteger, or unknown limits', async () => {
    expect(CHATGPT_OFFICIAL_HARD_LIMITS).toEqual({
      maxSourceBytes: 2_147_483_648,
      maxConversationBytes: 67_108_864,
      maxConversations: 100_000,
      maxDepth: 512,
    });
    expect(Object.isFrozen(CHATGPT_OFFICIAL_HARD_LIMITS)).toBe(true);
    const invalid = [
      ...Object.keys(CHATGPT_OFFICIAL_HARD_LIMITS).map(key => ({
        [key]: CHATGPT_OFFICIAL_HARD_LIMITS[key as keyof ChatGptOfficialSelectionLimits] + 1,
      })),
      { maxDepth: 0 },
      { maxDepth: -1 },
      { maxDepth: 1.5 },
      { maxDepth: Infinity },
      { maxDepth: NaN },
      { maxDepth: '2' },
      { unknownLimit: 1 },
      [],
      null,
    ];
    for (const limits of invalid) {
      await refuses(`[${conversation('selected')}]`, 'invalid-input', {
        limits: limits as Partial<ChatGptOfficialSelectionLimits>,
      });
    }
  });

  it.each([
    null,
    undefined,
    {},
    { conversationId: '', chunks: chunks(new Uint8Array()) },
    { conversationId: 'selected', chunks: [] },
  ])('rejects invalid runtime input without reading content', async input => {
    await expect(
      selectChatGptOfficialConversation(input as SelectChatGptOfficialConversationInput)
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('rejects invalid yielded chunks and sanitizes iterator failures', async () => {
    async function* invalidChunks() {
      yield 'not bytes';
    }
    await expect(
      selectChatGptOfficialConversation({
        chunks: invalidChunks() as unknown as AsyncIterable<Uint8Array>,
        conversationId: 'selected',
      })
    ).rejects.toMatchObject({ code: 'invalid-chunk' });
    async function* failedStream(): AsyncIterable<Uint8Array> {
      yield encoder.encode(`[${conversation('selected')}]`);
      throw new Error('PRIVATE_SOURCE_SENTINEL');
    }
    await expect(
      selectChatGptOfficialConversation({
        chunks: failedStream(),
        conversationId: 'selected',
      })
    ).rejects.toEqual(new ChatGptOfficialSelectionError('source-read-failed'));
  });

  it('sanitizes invalid input getters and refuses non-byte typed arrays', async () => {
    const input = {
      conversationId: 'selected',
      get chunks(): AsyncIterable<Uint8Array> {
        throw new Error('PRIVATE_INPUT_SENTINEL');
      },
    };
    await expect(selectChatGptOfficialConversation(input)).rejects.toEqual(
      new ChatGptOfficialSelectionError('invalid-input')
    );
    async function* otherTypedArray() {
      yield new Int8Array([91, 93]);
    }
    await expect(
      selectChatGptOfficialConversation({
        chunks: otherTypedArray() as unknown as AsyncIterable<Uint8Array>,
        conversationId: 'selected',
      })
    ).rejects.toEqual(new ChatGptOfficialSelectionError('invalid-chunk'));
  });

  it('does not expose provider text, IDs, parse messages, or partial selected bytes on failure', async () => {
    const secretId = 'PRIVATE_ID_SENTINEL';
    try {
      await select(
        `[${conversation(secretId, { title: 'PRIVATE_TITLE_SENTINEL' })}, {"PRIVATE_BODY_SENTINEL":}]`,
        { id: secretId }
      );
      expect.fail('Expected a fixed failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ChatGptOfficialSelectionError);
      const failure = error as ChatGptOfficialSelectionError;
      expect(failure.code).toBe('invalid-json');
      expect(failure.message).not.toContain('PRIVATE_');
      expect(JSON.stringify(failure)).not.toContain('PRIVATE_');
      expect(Object.keys(failure).sort()).toEqual(['code', 'name']);
    }
  });
});
