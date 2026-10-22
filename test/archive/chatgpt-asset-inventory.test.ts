import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHATGPT_ASSET_INVENTORY_DETAIL,
  CHATGPT_ASSET_INVENTORY_WARNING,
  CHATGPT_DERIVED_DOCUMENT_PREVIEW_DETAIL,
  inventoryChatGptRawAssets,
} from '../../src/archive/normalizers/chatgpt/inventory';
import {
  manifestAssetsById,
  reconcileManifestAssets,
  upsertAsset,
} from '../../src/archive/normalizers/chatgpt/assets';
import type { AssetContext } from '../../src/archive/normalizers/chatgpt/contracts';
import type { PrivacyTracker } from '../../src/archive/normalizers/chatgpt/privacy';

type RawRecord = Record<string, unknown>;

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function rootRaw(content: unknown, metadata: Record<string, unknown> = {}): RawRecord {
  return {
    mapping: {
      root: {
        message: { content, metadata },
      },
    },
  };
}

function contentWithParts(parts: unknown[]): RawRecord {
  return { content_type: 'text', parts };
}

async function inventory(raw: unknown) {
  return inventoryChatGptRawAssets({ raw, artifactId: 'conversation', sha256 });
}

const PREVIEW_NAME = `user-synthetic_user/${'a'.repeat(32)}/mnt/data/liska_pdf_render/page-1.png`;

function previewMessage(
  attachment: RawRecord = {},
  role = 'tool',
  field = 'attachments'
): RawRecord {
  const record = {
    id: 'preview-provider-id',
    name: PREVIEW_NAME,
    mime_type: 'image/png',
    ...attachment,
  };
  return {
    author: { role },
    ...(field === 'content'
      ? { content: contentWithParts([{ content_type: 'image_asset_pointer', ...record }]) }
      : { metadata: { [field]: [record] } }),
  };
}

function rawMessages(...messages: RawRecord[]): RawRecord {
  return {
    mapping: Object.fromEntries(messages.map((message, index) => [`node-${index}`, { message }])),
  };
}

describe('ChatGPT raw attachment inventory', () => {
  it.each([
    ['pdf', '1'],
    ['docx', '12'],
    ['pdf', '999999'],
  ])(
    'policy-declines exact tool %s page %s previews without changing raw identity/provenance',
    async (kind, page) => {
      const message = previewMessage({
        name: `user-synthetic_user/${'a'.repeat(32)}/mnt/data/liska_${kind}_render/page-${page}.png`,
        mime_type: ' IMAGE/PNG; charset=binary ',
      });
      const raw = rawMessages(message);
      const before = JSON.stringify(raw);
      const result = await inventory(raw);
      const ordinary = await inventory(rawMessages({ ...message, author: { role: 'user' } }));
      expect(result).toEqual({
        assets: [
          {
            ...ordinary.assets[0],
            state: 'declined',
            detail: CHATGPT_DERIVED_DOCUMENT_PREVIEW_DETAIL,
          },
        ],
        completeness: 'complete',
        warnings: [],
      });
      expect(result.assets[0]).toMatchObject({
        attemptedAt: null,
        relativePath: null,
        byteLength: null,
        sha256: null,
        mediaType: 'image/png',
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/mapping/node-0/message/metadata/attachments/0',
          },
        ],
      });
      expect(JSON.stringify(raw)).toBe(before);
      expect(JSON.stringify(result)).not.toContain('preview-provider-id');
      expect(JSON.stringify(result)).not.toContain('liska_pdf_render');
    }
  );

  it.each([
    ['assistant role', {}, 'assistant', 'attachments'],
    ['user role', {}, 'user', 'attachments'],
    ['system role', {}, 'system', 'attachments'],
    ['metadata files', {}, 'tool', 'files'],
    ['content part', {}, 'tool', 'content'],
    ['JPEG MIME', { mime_type: 'image/jpeg' }, 'tool', 'attachments'],
    ['unknown MIME', { mime_type: 'image/x-png' }, 'tool', 'attachments'],
    ['missing MIME', { mime_type: null }, 'tool', 'attachments'],
    ...[
      '/mnt/data/liska_pdf_render/page-1.png',
      PREVIEW_NAME.replace('user-', 'account-'),
      PREVIEW_NAME.replace('synthetic_user', ''),
      PREVIEW_NAME.replace('synthetic_user', 'a'.repeat(129)),
      PREVIEW_NAME.replace('a'.repeat(32), 'A'.repeat(32)),
      PREVIEW_NAME.replace('a'.repeat(32), 'a'.repeat(31)),
      PREVIEW_NAME.replace('liska_pdf_render', 'pdf_render'),
      PREVIEW_NAME.replace('liska_pdf_render', 'liska_pdf_render_backup'),
      PREVIEW_NAME.replace('page-1.png', 'page-0.png'),
      PREVIEW_NAME.replace('page-1.png', 'page-01.png'),
      PREVIEW_NAME.replace('page-1.png', 'page-1000000.png'),
      PREVIEW_NAME.replace('page-1.png', 'page-1.PNG'),
      PREVIEW_NAME.replace('/page-1', '/../page-1'),
      PREVIEW_NAME.replace('/page-1', '/%2e%2e/page-1'),
      PREVIEW_NAME.replace('/page-1', '/%70age-1'),
      PREVIEW_NAME.replace('/page-1', '\\page-1'),
      PREVIEW_NAME.replace('/page-1', '//page-1'),
      `prefix/${PREVIEW_NAME}`,
      `${PREVIEW_NAME}.bak`,
      `${PREVIEW_NAME}?download=1`,
      `${PREVIEW_NAME}\n`,
      `${PREVIEW_NAME}\u0000`,
    ].map(name => ['nonexact name', { name }, 'tool', 'attachments']),
  ] as const)('leaves %s ordinary', async (_label, attachment, role, field) => {
    const result = await inventory(rawMessages(previewMessage(attachment, role, field)));
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      state: 'not-attempted',
      detail: CHATGPT_ASSET_INVENTORY_DETAIL,
    });
    expect(result.completeness).toBe('not-attempted');
  });

  it('does not invoke an attachment name accessor to apply policy', async () => {
    const message = previewMessage();
    const record = ((message.metadata as RawRecord).attachments as RawRecord[])[0];
    let reads = 0;
    Object.defineProperty(record, 'name', {
      get: () => {
        reads += 1;
        return PREVIEW_NAME;
      },
    });
    const result = await inventory(rawMessages(message));
    expect(reads).toBe(0);
    expect(result.assets[0]?.state).toBe('not-attempted');
  });

  it.each(['author', 'role', 'mime_type'] as const)(
    'does not invoke the %s accessor to apply policy',
    async field => {
      const message = previewMessage();
      const record = ((message.metadata as RawRecord).attachments as RawRecord[])[0];
      const target =
        field === 'author' ? message : field === 'role' ? (message.author as RawRecord) : record;
      let reads = 0;
      Object.defineProperty(target, field, {
        get: () => {
          reads += 1;
          return field === 'author' ? { role: 'tool' } : field === 'role' ? 'tool' : 'image/png';
        },
      });
      const result = await inventory(rawMessages(message));
      expect(reads).toBe(0);
      expect(result.assets[0]?.state).toBe('not-attempted');
    }
  );

  it.each(['slash/value', 'encoded%20value', 'x'.repeat(513), 'trailing-newline\n'])(
    'does not use an unsafe provider key to group a preview with a pointer alias',
    async id => {
      const result = await inventory(
        rawMessages(
          previewMessage({ id }),
          previewMessage({ id: null, asset_pointer: `sediment://${id}` }, 'user')
        )
      );
      expect(result.assets).toHaveLength(2);
      expect(result.assets.map(asset => asset.state).sort()).toEqual(['declined', 'not-attempted']);
    }
  );

  it('accepts bounded ordinary provider keys for conservative policy cancellation', async () => {
    const id = `file.${'x'.repeat(507)}`;
    expect(id).toHaveLength(512);
    const result = await inventory(
      rawMessages(
        previewMessage({ id }),
        previewMessage({ id: null, asset_pointer: `sediment://${id}` }, 'user')
      )
    );
    expect(result.assets.every(asset => asset.state === 'not-attempted')).toBe(true);
  });

  it.each(['direct', 'file-service', 'sediment'] as const)(
    'ordinary %s evidence cancels preview exclusion in either order without merging aliases',
    async kind => {
      const preview = previewMessage();
      const ordinary = previewMessage(
        kind === 'direct' ? {} : { id: null, asset_pointer: `${kind}://preview-provider-id` },
        'user'
      );
      for (const messages of [
        [preview, ordinary],
        [ordinary, preview],
      ]) {
        const result = await inventory(rawMessages(...messages));
        expect(result.assets).toHaveLength(kind === 'direct' ? 1 : 2);
        expect(result.assets.every(asset => asset.state === 'not-attempted')).toBe(true);
        expect(result.assets.flatMap(asset => asset.sourceRefs)).toHaveLength(2);
        expect(result.completeness).toBe('not-attempted');
      }
    }
  );

  it.each(['file-service:', 'sediment://'])(
    'ordinary direct evidence cancels a derived %s pointer alias without changing records',
    async prefix => {
      const preview = previewMessage({ id: null, asset_pointer: `${prefix}preview-provider-id` });
      const ordinary = previewMessage({}, 'user');
      for (const messages of [
        [preview, ordinary],
        [ordinary, preview],
      ]) {
        const result = await inventory(rawMessages(...messages));
        expect(result.assets).toHaveLength(2);
        expect(result.assets.every(asset => asset.state === 'not-attempted')).toBe(true);
      }
    }
  );

  it('keeps unrelated previews declined when a genuine attachment remains required', async () => {
    const result = await inventory(
      rawMessages(previewMessage(), previewMessage({ id: 'genuine-id' }, 'user'))
    );
    expect(result.assets.map(asset => asset.state).sort()).toEqual(['declined', 'not-attempted']);
    expect(result.completeness).toBe('not-attempted');
  });

  it('retains every exact reference when all duplicate identity evidence is derived', async () => {
    const result = await inventory(
      rawMessages(
        previewMessage(),
        previewMessage({ name: PREVIEW_NAME.replace('page-1', 'page-2') })
      )
    );
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.state).toBe('declined');
    expect(result.assets[0]?.sourceRefs).toEqual([
      { artifactId: 'conversation', rawPointer: '/mapping/node-0/message/metadata/attachments/0' },
      { artifactId: 'conversation', rawPointer: '/mapping/node-1/message/metadata/attachments/0' },
    ]);
    expect(result.completeness).toBe('complete');
  });

  it.each([
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ])(
    'propagates ordinary policy evidence through a provider-key bridge in order %s/%s/%s',
    async (...order) => {
      const messages = [
        previewMessage({ id: 'a' }, 'user'),
        previewMessage({ asset_id: 'b', id: 'a' }),
        previewMessage({ id: null, asset_pointer: 'sediment://b' }),
      ];
      const result = await inventory(rawMessages(...order.map(index => messages[index])));
      expect(result.assets).toHaveLength(3);
      expect(result.assets.every(asset => asset.state === 'not-attempted')).toBe(true);
      expect(result.assets.flatMap(asset => asset.sourceRefs)).toHaveLength(3);
    }
  );

  it('propagates across a long reversed provider-key chain without merging identities', async () => {
    const length = 2_000;
    const chain = Array.from({ length }, (_, index) =>
      previewMessage({ asset_id: `key-${index + 1}`, id: `key-${index}` })
    );
    const messages = [
      previewMessage({ id: null, asset_pointer: `file-service://key-${length}` }),
      ...chain.reverse(),
      previewMessage({ id: 'key-0' }, 'user'),
    ];
    const result = await inventory(rawMessages(...messages));
    expect(result.assets).toHaveLength(length + 2);
    expect(result.assets.every(asset => asset.state === 'not-attempted')).toBe(true);
    expect(result.assets.flatMap(asset => asset.sourceRefs)).toHaveLength(length + 2);
  });

  it.each([false, true])(
    'handles cyclic provider aliases with ordinary evidence=%s',
    async ordinary => {
      const messages = [
        previewMessage({ asset_id: 'a', id: 'b' }),
        previewMessage({ asset_id: 'b', id: 'c' }),
        previewMessage({ asset_id: 'c', id: 'd' }),
        previewMessage({ asset_id: 'd', id: 'a' }),
        previewMessage({ id: null, asset_pointer: 'sediment://c' }),
        ...(ordinary ? [previewMessage({ id: 'a' }, 'user')] : []),
      ];
      for (const ordered of [messages, [...messages].reverse()]) {
        const result = await inventory(rawMessages(...ordered));
        expect(result.assets).toHaveLength(5);
        expect(result.assets.flatMap(asset => asset.sourceRefs)).toHaveLength(ordinary ? 6 : 5);
        expect(
          result.assets.every(asset => asset.state === (ordinary ? 'not-attempted' : 'declined'))
        ).toBe(true);
      }
    }
  );

  it.each(['invalid/key', 'encoded%20key', 'x'.repeat(513), 'newline\n'])(
    'does not propagate cancellation across an invalid bridge key',
    async invalid => {
      const result = await inventory(
        rawMessages(
          previewMessage({ id: 'ordinary' }, 'user'),
          previewMessage({ asset_id: invalid, id: 'ordinary' }),
          previewMessage({ id: null, asset_pointer: `sediment://${invalid}` })
        )
      );
      expect(result.assets).toHaveLength(3);
      const stateAt = (index: number) =>
        result.assets.find(asset =>
          asset.sourceRefs.some(ref => ref.rawPointer.includes(`/node-${index}/`))
        )?.state;
      expect(stateAt(0)).toBe('not-attempted');
      expect(stateAt(1)).toBe('not-attempted');
      expect(stateAt(2)).toBe('declined');
    }
  );

  it('discovers sediment and file-service pointer-only assets across nested content without retaining transport', async () => {
    const sedimentPointer = 'sediment://opaque-private-value';
    const fileServicePointer = 'file-service:opaque-private-value';
    const result = await inventory(
      rootRaw(
        contentWithParts([
          {
            content_type: 'file_asset_pointer',
            asset_pointer: sedimentPointer,
            filename: 'same-name.txt',
            mime_type: 'text/plain',
          },
          contentWithParts([
            {
              content_type: 'file_asset_pointer',
              asset_pointer: fileServicePointer,
              filename: 'same-name.txt',
              mime_type: 'application/not-a-known-type',
            },
          ]),
        ])
      )
    );

    expect(result.completeness).toBe('not-attempted');
    expect(result.warnings).toEqual([]);
    expect(result.assets).toHaveLength(2);
    expect(result.assets.map(asset => asset.mediaType).sort()).toEqual([null, 'text/plain']);
    expect(result.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^chatgpt-asset-[a-f0-9]{64}$/),
          state: 'not-attempted',
          attemptedAt: null,
          byteLength: null,
          sha256: null,
          detail: CHATGPT_ASSET_INVENTORY_DETAIL,
        }),
      ])
    );
    expect(JSON.stringify(result.assets)).not.toContain(sedimentPointer);
    expect(JSON.stringify(result.assets)).not.toContain(fileServicePointer);
    expect(JSON.stringify(result.assets)).not.toContain('same-name.txt');
  });

  it('discovers metadata-only IDs but makes no byte-length claim', async () => {
    const metadataId = 'metadata-only-private-id';
    const result = await inventory(
      rootRaw(contentWithParts(['plain text']), {
        attachments: [
          {
            id: metadataId,
            name: 'metadata-only.txt',
            mime_type: 'application/pdf',
            size: 123_456,
            library_file_id: 'library-private-id',
            source: 'library',
          },
        ],
      })
    );

    expect(result.assets).toEqual([
      expect.objectContaining({
        mediaType: 'application/pdf',
        byteLength: null,
        sha256: null,
        relativePath: null,
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/mapping/root/message/metadata/attachments/0',
          },
        ],
      }),
    ]);
    expect(JSON.stringify(result.assets)).not.toContain(metadataId);
    expect(JSON.stringify(result.assets)).not.toContain('library-private-id');
  });

  it('deduplicates only exact identities and never filenames', async () => {
    const repeatedPointer = 'sediment://one';
    const result = await inventory(
      rootRaw(
        contentWithParts([
          {
            content_type: 'image_asset_pointer',
            asset_pointer: repeatedPointer,
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'image_asset_pointer',
            asset_pointer: repeatedPointer,
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'image_asset_pointer',
            asset_pointer: 'sediment://two',
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'file',
            file_id: 'provider-id-one',
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'file',
            file_id: 'provider-id-one',
            filename: 'different-name.png',
            mime_type: 'image/png',
          },
        ])
      )
    );

    expect(result.assets).toHaveLength(3);
    expect(result.assets.map(asset => asset.sourceRefs.length).sort()).toEqual([1, 2, 2]);
    expect(
      result.assets.flatMap(asset => asset.sourceRefs.map(source => source.rawPointer))
    ).toEqual(
      expect.arrayContaining([
        '/mapping/root/message/content/parts/0',
        '/mapping/root/message/content/parts/1',
        '/mapping/root/message/content/parts/2',
        '/mapping/root/message/content/parts/3',
        '/mapping/root/message/content/parts/4',
      ])
    );
  });

  it('deduplicates one exact provider ID across content and metadata locations', async () => {
    const sharedId = 'shared-private-provider-id';
    const result = await inventory(
      rootRaw(
        contentWithParts([
          {
            content_type: 'file',
            file_id: sharedId,
            mime_type: 'application/pdf',
          },
        ]),
        {
          attachments: [{ id: sharedId, mime_type: 'application/pdf' }],
          files: [{ fileId: sharedId, mimeType: 'application/pdf' }],
        }
      )
    );

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.sourceRefs).toEqual([
      {
        artifactId: 'conversation',
        rawPointer: '/mapping/root/message/content/parts/0',
      },
      {
        artifactId: 'conversation',
        rawPointer: '/mapping/root/message/metadata/attachments/0',
      },
      {
        artifactId: 'conversation',
        rawPointer: '/mapping/root/message/metadata/files/0',
      },
    ]);
    expect(JSON.stringify(result.assets)).not.toContain(sharedId);
  });

  it('accepts a nested conversation envelope and retains its exact raw location', async () => {
    const result = await inventory({
      conversation: rootRaw(
        contentWithParts([
          {
            content_type: 'file',
            file_id: 'nested-private-id',
            mime_type: 'text/plain',
          },
        ])
      ),
    });

    expect(result.completeness).toBe('not-attempted');
    expect(result.assets[0]?.sourceRefs).toEqual([
      {
        artifactId: 'conversation',
        rawPointer: '/conversation/mapping/root/message/content/parts/0',
      },
    ]);
  });

  it('inventories one rendered assistant sandbox link without retaining its path or label', async () => {
    const result = await inventory({
      mapping: {
        root: {
          message: {
            id: 'assistant-message-1',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: ['Download [report](sandbox:/mnt/data/Quarterly%20Report.docx).'],
            },
          },
        },
      },
    });

    expect(result.assets).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^chatgpt-asset-[a-f0-9]{64}$/),
        mediaType: null,
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/mapping/root/message/content/parts/0',
          },
        ],
      }),
    ]);
    expect(JSON.stringify(result.assets)).not.toContain('Quarterly Report.docx');
    expect(JSON.stringify(result.assets)).not.toContain('sandbox:/mnt/data');
  });

  it('inventories multiple distinct assistant links in one text part deterministically', async () => {
    const raw = {
      mapping: {
        root: {
          message: {
            id: 'assistant-message-2',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: ['[second](sandbox:/mnt/data/b.txt) and [first](sandbox:/mnt/data/a.txt)'],
            },
          },
        },
      },
    };
    const first = await inventory(raw);
    const second = await inventory(raw);

    expect(first.assets).toHaveLength(2);
    expect(first.assets).toEqual(second.assets);
    expect(first.assets.map(asset => asset.sourceRefs)).toEqual([
      [{ artifactId: 'conversation', rawPointer: '/mapping/root/message/content/parts/0' }],
      [{ artifactId: 'conversation', rawPointer: '/mapping/root/message/content/parts/0' }],
    ]);
  });

  it('ignores user, tool, arbitrary-code, malformed, and unsafe sandbox-looking strings', async () => {
    const result = await inventory({
      mapping: {
        user: {
          message: {
            id: 'user-message',
            author: { role: 'user' },
            content: {
              content_type: 'text',
              parts: ['[user](sandbox:/mnt/data/user.txt)'],
            },
          },
        },
        tool: {
          message: {
            id: 'tool-message',
            author: { role: 'tool' },
            content: {
              content_type: 'text',
              parts: ['[tool](sandbox:/mnt/data/tool.txt)'],
            },
          },
        },
        code: {
          message: {
            id: 'assistant-code',
            author: { role: 'assistant' },
            content: {
              content_type: 'code',
              parts: ['[code](sandbox:/mnt/data/not-a-link.txt)'],
            },
          },
        },
        inlineCode: {
          message: {
            id: 'assistant-inline-code',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: ['`[inline example](sandbox:/mnt/data/not-rendered.txt)`'],
            },
          },
        },
        fencedCode: {
          message: {
            id: 'assistant-fenced-code',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: ['```markdown\n[fenced example](sandbox:/mnt/data/not-rendered.txt)\n```'],
            },
          },
        },
        indentedCode: {
          message: {
            id: 'assistant-indented-code',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: ['    [indented example](sandbox:/mnt/data/not-rendered.txt)'],
            },
          },
        },
        tabIndentedCode: {
          message: {
            id: 'assistant-tab-indented-code',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: ['\t[tab-indented example](sandbox:/mnt/data/not-rendered.txt)'],
            },
          },
        },
        unsafe: {
          message: {
            id: 'assistant-unsafe',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: [
                '[bad encoding](sandbox:/mnt/data/a%2Fb.txt) [bad percent](sandbox:/mnt/data/%ZZ) [traversal](sandbox:/mnt/data/%2e%2e/up.txt) [double encoded](sandbox:/mnt/data/%252e%252e/up.txt) [slash](sandbox:/mnt/data/a%5Cb.txt)',
              ],
            },
          },
        },
      },
    });

    expect(result).toEqual({ assets: [], completeness: 'not-attempted', warnings: [] });
  });

  it('falls back to a stable unknown inventory on malformed or ambiguous raw shape', async () => {
    const malformed = await inventory(rootRaw({ content_type: 'text', parts: 'not-an-array' }));
    const ambiguous = await inventory({
      ...rootRaw(contentWithParts([])),
      conversation: rootRaw(contentWithParts([])),
    });

    for (const result of [malformed, ambiguous]) {
      expect(result).toEqual({
        assets: [],
        completeness: 'unknown',
        warnings: [CHATGPT_ASSET_INVENTORY_WARNING],
      });
    }
  });

  it('fails closed for invalid inputs, ambiguous metadata, and non-canonical digests', async () => {
    const invalidInput = await inventoryChatGptRawAssets({
      raw: rootRaw(contentWithParts([])),
      artifactId: 1 as unknown as string,
      sha256,
    });
    const missingContentType = await inventory(
      rootRaw(contentWithParts([{ file_id: 'missing-type' }]))
    );
    const conflictingMime = await inventory(
      rootRaw(
        contentWithParts([
          { content_type: 'file', file_id: 'same-id', mime_type: 'image/png' },
          { content_type: 'file', file_id: 'same-id', mime_type: 'image/jpeg' },
        ])
      )
    );
    const invalidDigest = await inventoryChatGptRawAssets({
      raw: rootRaw(contentWithParts([{ content_type: 'file', file_id: 'digest-id' }])),
      artifactId: 'conversation',
      sha256: () => Promise.resolve('NOT-A-DIGEST'),
    });
    const collidingDigest = await inventoryChatGptRawAssets({
      raw: rootRaw(
        contentWithParts([
          { content_type: 'file', file_id: 'first' },
          { content_type: 'file', file_id: 'second' },
        ])
      ),
      artifactId: 'conversation',
      sha256: () => Promise.resolve('a'.repeat(64)),
    });

    for (const result of [
      invalidInput,
      missingContentType,
      conflictingMime,
      invalidDigest,
      collidingDigest,
    ]) {
      expect(result).toEqual({
        assets: [],
        completeness: 'unknown',
        warnings: [CHATGPT_ASSET_INVENTORY_WARNING],
      });
    }
  });

  it('uses the exact raw location when an attachment has no ID or transport pointer', async () => {
    const first = await inventory(
      rootRaw(contentWithParts([{ content_type: 'file', mime_type: 'text/plain' }]))
    );
    const second = await inventory(
      rootRaw(contentWithParts([{ content_type: 'file', mime_type: 'text/plain' }]))
    );

    expect(first.assets).toHaveLength(1);
    expect(first.assets[0]?.id).toBe(second.assets[0]?.id);
    expect(first.assets[0]?.sourceRefs[0]?.rawPointer).toBe(
      '/mapping/root/message/content/parts/0'
    );
  });

  it('deduplicates thousands of references and bounds concurrent identity hashes', async () => {
    const repeated = Array.from({ length: 2_000 }, () => ({
      content_type: 'file',
      file_id: 'one-repeated-id',
    }));
    const unique = Array.from({ length: 40 }, (_, index) => ({
      content_type: 'file',
      file_id: `unique-${index}`,
    }));
    let active = 0;
    let maximum = 0;
    const boundedSha256 = async (bytes: Uint8Array): Promise<string> => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return createHash('sha256').update(bytes).digest('hex');
    };

    const result = await inventoryChatGptRawAssets({
      raw: rootRaw(contentWithParts([...repeated, ...unique])),
      artifactId: 'conversation',
      sha256: boundedSha256,
    });

    expect(result.assets).toHaveLength(41);
    expect(result.assets.find(asset => asset.sourceRefs.length === 2_000)).toBeDefined();
    expect(maximum).toBeLessThanOrEqual(16);
  });

  it('matches manifest evidence by exact raw pointer before a provider ID and propagates attemptedAt', () => {
    const privacy: PrivacyTracker = { redactions: [] };
    const pointer = '/mapping/root/message/content/parts/0';
    const context: AssetContext = {
      assets: {},
      assetIdsByIdentity: new Map(),
      manifestAssets: manifestAssetsById([
        {
          id: `chatgpt-asset-${'a'.repeat(64)}`,
          state: 'expired',
          attemptedAt: '2026-08-17T12:00:01.000Z',
          relativePath: null,
          mediaType: 'text/plain',
          byteLength: null,
          sha256: null,
          detail: 'acquisition-expired',
          sourceRefs: [{ artifactId: 'conversation', rawPointer: pointer }],
        },
      ]),
      artifactId: 'conversation',
      format: 'synthetic',
      privacy,
    };

    const assetId = upsertAsset(
      {
        content_type: 'file',
        file_id: 'different-provider-id',
        filename: 'private-name.txt',
        mime_type: 'text/plain',
      },
      pointer,
      context
    );

    expect(assetId).toBe(`chatgpt-asset-${'a'.repeat(64)}`);
    expect(context.assets[assetId]?.acquisition).toEqual({
      state: 'expired',
      attemptedAt: '2026-08-17T12:00:01.000Z',
      detail: 'acquisition-expired',
    });
    expect(context.assets[assetId]?.sourceRefs).toContainEqual(
      expect.objectContaining({ id: 'different-provider-id', rawPointer: pointer })
    );
  });

  it('preserves manifest references to another artifact and rejects conflicting source IDs', () => {
    const privacy: PrivacyTracker = { redactions: [] };
    const manifestAsset = {
      id: `chatgpt-asset-${'b'.repeat(64)}`,
      state: 'not-attempted',
      attemptedAt: null,
      relativePath: null,
      mediaType: null,
      byteLength: null,
      sha256: null,
      detail: CHATGPT_ASSET_INVENTORY_DETAIL,
      sourceRefs: [{ artifactId: 'other-artifact', rawPointer: '/asset' }],
    };
    const foreignContext: AssetContext = {
      assets: {},
      assetIdsByIdentity: new Map(),
      manifestAssets: manifestAssetsById([manifestAsset]),
      artifactId: 'conversation',
      format: 'synthetic',
      privacy,
    };
    reconcileManifestAssets(foreignContext);
    expect(foreignContext.assets[manifestAsset.id]?.sourceRefs).toEqual([
      expect.objectContaining({ artifactId: 'other-artifact', rawPointer: '/asset' }),
    ]);

    const pointer = '/asset';
    const conflictContext: AssetContext = {
      assets: {},
      assetIdsByIdentity: new Map(),
      manifestAssets: manifestAssetsById([
        {
          ...manifestAsset,
          sourceRefs: [{ artifactId: 'conversation', rawPointer: pointer }],
        },
      ]),
      artifactId: 'conversation',
      format: 'synthetic',
      privacy: { redactions: [] },
    };
    upsertAsset({ content_type: 'file', file_id: 'first-id' }, pointer, conflictContext);
    expect(() =>
      upsertAsset({ content_type: 'file', file_id: 'second-id' }, pointer, conflictContext)
    ).toThrow(expect.objectContaining({ code: 'asset-conflict' }));
  });
});
