import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive/capture';
import { inventoryChatGptRawAssets } from '../../src/archive/normalizers/chatgpt/inventory';
import {
  CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT,
  chatGptAssetIdForIdentity,
  chatGptSandboxLinkIdentity,
  chatGptSandboxLinksFromAssistantTextPart,
} from '../../src/archive/chatgpt-sandbox-link';
import {
  CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT,
  classifyChatGptLibraryAssets,
  extractChatGptActiveResolverPlan,
  extractChatGptActiveImagePlan,
  extractChatGptLibraryJpegPlan,
  extractChatGptInterpreterAssetPlan,
  matchChatGptPageOwnedAssetResolvers,
  type ChatGptTransientResolverRecord,
} from '../../src/content/capture/chatgpt-asset-resolver';

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

async function resolver(
  fileId: string,
  downloadUrl: string
): Promise<ChatGptTransientResolverRecord> {
  return {
    resolverKey: await digest(new TextEncoder().encode(`liska-chatgpt-resolver/1\u0000${fileId}`)),
    downloadUrl,
  };
}

function asset(id: string, rawPointer: string): RawCaptureAssetRecord {
  return {
    id: `chatgpt-asset-${id.repeat(64).slice(0, 64)}`,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: 'image/png',
    byteLength: null,
    sha256: null,
    detail: 'raw-inventory-not-attempted',
    sourceRefs: [{ artifactId: 'conversation', rawPointer }],
  };
}

function assetWithSourceRefs(id: string, rawPointers: readonly string[]): RawCaptureAssetRecord {
  return {
    ...asset(id, rawPointers[0] ?? '/missing'),
    sourceRefs: rawPointers.map(rawPointer => ({ artifactId: 'conversation', rawPointer })),
  };
}

function indexedInterpreterAsset(index: number): RawCaptureAssetRecord {
  return {
    ...asset('a', `/mapping/node-${index}/message/metadata/attachments/0`),
    id: `chatgpt-asset-${index.toString(16).padStart(64, '0')}`,
  };
}

describe('ChatGPT page-owned asset resolver matching', () => {
  describe('separate Library JPEG admission', () => {
    function libraryFixture(extra: Record<string, unknown> = {}) {
      const raw = {
        mapping: {
          node: {
            message: {
              metadata: {
                attachments: [
                  { id: 'file_library_direct', library_file_id: 'private-library-id', ...extra },
                ],
              },
            },
          },
        },
      };
      const record = {
        ...asset('a', '/mapping/node/message/metadata/attachments/0'),
        mediaType: 'image/jpeg',
      };
      return { raw, record };
    }

    it('admits one exact direct attachment while ordinary active/passive stay denied', async () => {
      const { raw, record } = libraryFixture();
      expect(extractChatGptLibraryJpegPlan(raw, [record], [record.id])).toEqual({
        assetId: record.id,
        providerFileId: 'file_library_direct',
      });
      expect(extractChatGptActiveImagePlan(raw, [record], [record.id])).toBeUndefined();
      expect(
        await matchChatGptPageOwnedAssetResolvers({
          raw,
          assets: [record],
          resolvers: [await resolver('file_library_direct', 'https://private-download')],
          sha256: digest,
        })
      ).toEqual([]);
    });

    it.each([
      { id: undefined },
      { id: undefined, asset_pointer: 'file-service://file_library_direct' },
      { id: undefined, name: 'file_library_direct', source: 'local' },
      { id: 'unsupported/value' },
      { id: 42 },
      { file_id: { private: true } },
      { file_id: 'file_conflicting' },
      { asset_pointer: 'file-service://file_conflicting' },
      { libraryFileId: 'private-conflict' },
      { library_file_id: null },
      { library_file_id: undefined, source: 'local' },
    ])(
      'association cannot authorize missing, malformed, or conflicting direct evidence %#',
      extra => {
        const { raw, record } = libraryFixture(extra);
        expect(extractChatGptLibraryJpegPlan(raw, [record], [record.id])).toBeUndefined();
      }
    );

    it('does not authorize a non-attachment Library record or a foreign source ref', () => {
      const { raw, record } = libraryFixture();
      const other = { ...asset('b', '/library'), mediaType: 'image/jpeg' };
      const evidence = { id: 'file_other', library_file_id: 'private-library' };
      expect(
        extractChatGptLibraryJpegPlan({ ...raw, library: evidence }, [other], [other.id])
      ).toBeUndefined();
      record.sourceRefs[0].artifactId = 'foreign';
      expect(extractChatGptLibraryJpegPlan(raw, [record], [record.id])).toBeUndefined();
    });

    it.each([
      'gizmo_id',
      'gizmoId',
      'project_id',
      'projectId',
      'conversation_template_id',
      'conversationTemplateId',
    ])('blocks unsupported root %s context, including malformed values', field => {
      const { raw, record } = libraryFixture();
      for (const value of ['private-owner', {}, [], false, 0]) {
        expect(
          extractChatGptLibraryJpegPlan({ ...raw, [field]: value }, [record], [record.id])
        ).toBeUndefined();
      }
      for (const value of [undefined, null, '']) {
        expect(
          extractChatGptLibraryJpegPlan({ ...raw, [field]: value }, [record], [record.id])
        ).toBeDefined();
      }
    });

    it.each([
      'image/png',
      'image/webp',
      'image/jpg',
      'IMAGE/JPEG',
      'image/jpeg; charset=utf-8',
      null,
    ])('does not admit MIME %s', mediaType => {
      const { raw, record } = libraryFixture();
      expect(
        extractChatGptLibraryJpegPlan(raw, [{ ...record, mediaType }], [record.id])
      ).toBeUndefined();
    });

    it('requires unique opaque ID, eligibility, and not-attempted state', () => {
      const { raw, record } = libraryFixture();
      expect(
        extractChatGptLibraryJpegPlan(raw, [record, { ...record }], [record.id])
      ).toBeUndefined();
      expect(extractChatGptLibraryJpegPlan(raw, [record], [])).toBeUndefined();
      expect(
        extractChatGptLibraryJpegPlan(raw, [{ ...record, state: 'failed' }], [record.id])
      ).toBeUndefined();
      expect(
        extractChatGptLibraryJpegPlan(raw, [{ ...record, id: 'not-opaque' }], ['not-opaque'])
      ).toBeUndefined();
    });

    it('keeps interpreter ownership separate from its bounded dispatch plan', () => {
      const { raw, record } = libraryFixture();
      Object.assign(raw.mapping.node.message, { id: 'message-library' });
      Object.assign(raw.mapping.node.message.metadata.attachments[0], {
        name: '/mnt/data/library.jpg',
      });
      expect(classifyChatGptLibraryAssets(raw, [record]).associatedAssetIds).toEqual([record.id]);
      expect(extractChatGptLibraryJpegPlan(raw, [record], [record.id])).toBeUndefined();
    });

    it('gives any merged sibling interpreter sourceRef ownership before Library admission', () => {
      const { raw, record } = libraryFixture();
      Object.assign(raw.mapping.node.message, { id: 'message-library' });
      raw.mapping.node.message.metadata.attachments.push({
        id: 'file_library_direct',
        name: '/mnt/data/sibling-interpreter.jpg',
        mime_type: 'image/jpeg',
      });
      record.sourceRefs.push({
        artifactId: 'conversation',
        rawPointer: '/mapping/node/message/metadata/attachments/1',
      });

      expect(classifyChatGptLibraryAssets(raw, [record]).associatedAssetIds).toEqual([record.id]);
      expect(extractChatGptLibraryJpegPlan(raw, [record], [record.id])).toBeUndefined();
    });

    it.each([
      { id: 'file_library_direct' },
      { id: 42, asset_pointer: 'sediment://file_library_direct' },
      { id: 'file_other', asset_pointer: 'file-service://file_library_direct' },
      { id: 'unsupported/value', asset_pointer: 'sediment://file_library_direct' },
      { id: 'file_other', file_id: 'file_library_direct' },
      { id: 'file_library_direct', library_file_id: 'another-library' },
    ])(
      'resolves whole-ledger identity collisions before eligibility and independently of order %#',
      collision => {
        const { raw, record } = libraryFixture();
        const other = { ...asset('b', '/collision'), state: 'failed' as const };
        for (const assets of [
          [record, other],
          [other, record],
        ]) {
          expect(
            extractChatGptLibraryJpegPlan({ ...raw, collision }, assets, [record.id])
          ).toBeUndefined();
        }
      }
    );

    it('allows a weaker pointer-only ledger alias while selecting the exact Library direct ID', () => {
      const { raw, record } = libraryFixture();
      const alias = { ...asset('b', '/pointer-alias'), mediaType: null };
      const withAlias = {
        ...raw,
        'pointer-alias': { asset_pointer: 'sediment://file_library_direct' },
      };
      for (const assets of [
        [record, alias],
        [alias, record],
      ]) {
        expect(extractChatGptLibraryJpegPlan(withAlias, assets, [record.id])).toEqual({
          assetId: record.id,
          providerFileId: 'file_library_direct',
        });
      }
    });

    it('blocks a matching pointer-only sibling with exact interpreter ownership', () => {
      const { raw, record } = libraryFixture();
      const interpreterRaw = {
        ...raw,
        mapping: {
          ...raw.mapping,
          interpreter: {
            message: {
              id: 'message-interpreter',
              metadata: {
                attachments: [
                  {
                    asset_pointer: 'sediment://file_library_direct',
                    name: '/mnt/data/sibling-interpreter.jpg',
                  },
                ],
              },
            },
          },
        },
      };
      const alias = {
        ...asset('b', '/mapping/interpreter/message/metadata/attachments/0'),
        mediaType: null,
      };
      for (const assets of [
        [record, alias],
        [alias, record],
      ]) {
        expect(extractChatGptLibraryJpegPlan(interpreterRaw, assets, [record.id])).toBeUndefined();
      }
    });

    it('selects only one Library JPEG deterministically, without treating shared Library ID as a direct collision', () => {
      const { raw, record } = libraryFixture();
      raw.mapping.node.message.metadata.attachments.push({
        id: 'file_second',
        library_file_id: 'private-library-id',
      });
      const second = {
        ...asset('b', '/mapping/node/message/metadata/attachments/1'),
        mediaType: 'image/jpeg',
      };
      for (const records of [
        [record, second],
        [second, record],
      ]) {
        expect(extractChatGptLibraryJpegPlan(raw, records, [record.id, second.id])).toEqual({
          assetId: record.id,
          providerFileId: 'file_library_direct',
        });
      }
    });
  });

  describe('offline Library association classification', () => {
    it('classifies only the exact Library ledger record and returns no provider identity', () => {
      const raw = {
        library: {
          file_id: 'file_one',
          library_file_id: 'library-private',
          libraryFileId: 'library-private',
        },
        pointerAlias: { asset_pointer: 'sediment://file_one' },
        ordinary: { file_id: 'file_two', source: 'local' },
      };
      const library = asset('b', '/library');
      const pointerAlias = asset('a', '/pointerAlias');
      const ordinary = asset('c', '/ordinary');
      const classification = classifyChatGptLibraryAssets(raw, [pointerAlias, ordinary, library]);
      expect(classification).toEqual({
        associatedAssetIds: [library.id],
        ambiguousAssetIds: [],
      });
      expect(JSON.stringify(classification)).not.toContain('library-private');
    });

    it.each([
      ['conflicting aliases', { library_file_id: 'library-one', libraryFileId: 'library-two' }],
      ['non-string identity', { library_file_id: { malformed: true } }],
      ['control character', { library_file_id: 'library\u0000one' }],
      ['overlong identity', { library_file_id: 'x'.repeat(513) }],
    ])('retains %s as ambiguous non-dispatchable evidence', (_label, value) => {
      const record = asset('a', '/candidate');
      expect(classifyChatGptLibraryAssets({ candidate: value }, [record])).toEqual({
        associatedAssetIds: [],
        ambiguousAssetIds: [record.id],
      });
    });

    it('treats disagreement across exact source refs as ambiguous', () => {
      const record = assetWithSourceRefs('a', ['/one', '/two']);
      expect(
        classifyChatGptLibraryAssets(
          {
            one: { library_file_id: 'library-one' },
            two: { library_file_id: 'library-two' },
          },
          [record]
        )
      ).toEqual({ associatedAssetIds: [], ambiguousAssetIds: [record.id] });
    });

    it.each(['missing', 'duplicate'] as const)(
      'fails closed when Library evidence has a %s conversation source ref',
      mode => {
        const record = assetWithSourceRefs(
          'a',
          mode === 'missing' ? ['/library', '/missing'] : ['/library', '/library']
        );
        expect(
          classifyChatGptLibraryAssets({ library: { library_file_id: 'library-one' } }, [record])
        ).toEqual({ associatedAssetIds: [], ambiguousAssetIds: [record.id] });
      }
    );

    it('fails closed on malformed artifact identity beside valid Library evidence', () => {
      const record = asset('a', '/library');
      record.sourceRefs.push({ artifactId: 42 as never, rawPointer: '/other' });
      expect(
        classifyChatGptLibraryAssets({ library: { library_file_id: 'library-one' } }, [record])
      ).toEqual({ associatedAssetIds: [], ambiguousAssetIds: [record.id] });
    });

    it('does not merge different ledger assets that share one Library association', () => {
      const first = asset('a', '/first');
      const second = asset('b', '/second');
      expect(
        classifyChatGptLibraryAssets(
          {
            first: { file_id: 'file_one', library_file_id: 'library-shared' },
            second: { file_id: 'file_two', library_file_id: 'library-shared' },
          },
          [second, first]
        )
      ).toEqual({ associatedAssetIds: [first.id, second.id], ambiguousAssetIds: [] });
    });

    it('classifies pointerless JPEG/WebP inventory records without acquisition authority', async () => {
      const raw = {
        mapping: {
          node: {
            id: 'node',
            parent: null,
            children: [],
            message: {
              id: 'message',
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['synthetic'] },
              metadata: {
                attachments: [
                  {
                    id: 'file_one',
                    library_file_id: 'library-one',
                    mime_type: 'image/jpeg',
                  },
                  {
                    id: 'file_two',
                    library_file_id: 'library-two',
                    mime_type: 'image/webp',
                  },
                ],
              },
            },
          },
        },
      };
      const inventory = await inventoryChatGptRawAssets({
        raw,
        artifactId: 'conversation',
        sha256: digest,
      });
      expect(inventory.assets).toHaveLength(2);
      expect(
        inventory.assets.map(record => ({
          state: record.state,
          attemptedAt: record.attemptedAt,
          relativePath: record.relativePath,
          sha256: record.sha256,
        }))
      ).toEqual(
        Array.from({ length: 2 }, () => ({
          state: 'not-attempted',
          attemptedAt: null,
          relativePath: null,
          sha256: null,
        }))
      );
      const classification = classifyChatGptLibraryAssets(raw, inventory.assets);
      expect(classification).toEqual({
        associatedAssetIds: inventory.assets.map(record => record.id).sort(),
        ambiguousAssetIds: [],
      });
      expect(JSON.stringify({ inventory, classification })).not.toMatch(
        /file_one|file_two|library-one|library-two/
      );
    });

    it('does not infer Library association from source=local or empty aliases', () => {
      const local = asset('a', '/local');
      const empty = asset('b', '/empty');
      expect(
        classifyChatGptLibraryAssets(
          {
            local: { file_id: 'file_one', source: 'local' },
            empty: { library_file_id: '', libraryFileId: null },
          },
          [local, empty]
        )
      ).toEqual({ associatedAssetIds: [], ambiguousAssetIds: [] });
    });

    it('fails closed on duplicate ledger IDs and malformed asset arrays', () => {
      const record = asset('a', '/library');
      expect(
        classifyChatGptLibraryAssets({ library: { library_file_id: 'library-one' } }, [
          record,
          record,
        ])
      ).toEqual({ associatedAssetIds: [], ambiguousAssetIds: [record.id] });
      expect(classifyChatGptLibraryAssets({}, null as never)).toEqual({
        associatedAssetIds: [],
        ambiguousAssetIds: [],
      });
    });
  });

  describe('bounded sandbox-link parsing', () => {
    it('handles dense unmatched link openers without inventing evidence', () => {
      expect(chatGptSandboxLinksFromAssistantTextPart('message-1', '['.repeat(100_000))).toEqual(
        []
      );
    });

    it('fails explicitly before retaining an unbounded number of unique links', () => {
      const markdown = Array.from(
        { length: CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT + 1 },
        (_, index) => `[file-${index}](sandbox:/mnt/data/file-${index}.txt)`
      ).join(' ');

      expect(() => chatGptSandboxLinksFromAssistantTextPart('message-1', markdown)).toThrow(
        RangeError
      );
    });

    it('keeps code masking and ordinary link discovery deterministic at scale', () => {
      const code = Array.from(
        { length: 2_000 },
        (_, index) => `\`[ignored-${index}](sandbox:/mnt/data/ignored-${index}.txt)\``
      ).join(' ');
      const visible = '[report](sandbox:/mnt/data/report.txt)';

      expect(chatGptSandboxLinksFromAssistantTextPart('message-1', `${code} ${visible}`)).toEqual([
        {
          messageId: 'message-1',
          sandboxPath: '/mnt/data/report.txt',
          identity: 'sandbox-link:message-1\u0000/mnt/data/report.txt',
        },
      ]);
    });

    it('masks quoted fenced-code examples without letting another container close the fence', () => {
      const quoted =
        '> ~~~\n> [hidden](sandbox:/mnt/data/hidden.txt)\n> ~~~\n\n[visible](sandbox:/mnt/data/visible.txt)';
      const topLevel =
        '~~~\n> ~~~\n[hidden](sandbox:/mnt/data/hidden.txt)\n~~~\n[visible](sandbox:/mnt/data/visible.txt)';

      for (const markdown of [quoted, topLevel]) {
        expect(chatGptSandboxLinksFromAssistantTextPart('message-1', markdown)).toEqual([
          {
            messageId: 'message-1',
            sandboxPath: '/mnt/data/visible.txt',
            identity: 'sandbox-link:message-1\u0000/mnt/data/visible.txt',
          },
        ]);
      }
    });
  });

  it('keeps declined direct evidence in whole-ledger matching so a weaker eligible alias is not promoted', async () => {
    const raw = {
      direct: { file_id: 'file_one' },
      alias: { asset_pointer: 'file-service://file_one' },
    };
    const direct = { ...asset('a', '/direct'), state: 'declined' as const };
    const alias = asset('b', '/alias');
    const downloadUrl =
      'https://chatgpt.com/backend-api/estuary/content?cid=123456&id=file_one&p=fs&sig=' +
      'a'.repeat(64) +
      '&ts=123456&v=1';
    for (const assets of [
      [direct, alias],
      [alias, direct],
    ]) {
      const matched = await matchChatGptPageOwnedAssetResolvers({
        raw,
        assets,
        resolvers: [await resolver('file_one', downloadUrl)],
        sha256: digest,
      });
      expect(matched.map(candidate => candidate.assetId)).toEqual([direct.id]);
      expect(matched.filter(candidate => candidate.assetId === alias.id)).toEqual([]);
      expect(extractChatGptActiveImagePlan(raw, assets, [alias.id])).toBeUndefined();
    }
  });

  it('keeps Library-ID evidence and its weaker pointer alias out of passive matching', async () => {
    const raw = {
      direct: { file_id: 'file_one', library_file_id: 'library_one', source: 'local' },
      pointer: { asset_pointer: 'sediment://file_one' },
    };
    const direct = { ...asset('b', '/direct'), mediaType: 'image/jpeg' };
    const pointer = { ...asset('a', '/pointer'), mediaType: 'image/jpeg' };
    const observed = await resolver('file_one', 'https://chatgpt.com/synthetic-signed');
    for (const assets of [
      [direct, pointer],
      [pointer, direct],
    ]) {
      await expect(
        matchChatGptPageOwnedAssetResolvers({
          raw,
          assets,
          resolvers: [observed],
          sha256: digest,
        })
      ).resolves.toEqual([]);
    }
  });

  it('blocks a Library pointer identity before an ordinary direct winner can promote it', () => {
    const raw = {
      libraryPointer: {
        asset_pointer: 'file-service://file_one',
        library_file_id: 'library_one',
      },
      ordinaryDirect: { file_id: 'file_one' },
    };
    const libraryPointer = { ...asset('a', '/libraryPointer'), mediaType: 'image/jpeg' };
    const ordinaryDirect = { ...asset('b', '/ordinaryDirect'), mediaType: 'image/jpeg' };
    for (const assets of [
      [libraryPointer, ordinaryDirect],
      [ordinaryDirect, libraryPointer],
    ]) {
      expect(
        extractChatGptActiveImagePlan(
          raw,
          assets,
          assets.map(record => record.id)
        )
      ).toBeUndefined();
    }
  });

  it('blocks passive aliases even when an ambiguous Library record is not itself matchable', async () => {
    const raw = {
      library: {
        file_id: 'file_one',
        id: 'file_two',
        library_file_id: 'library_one',
      },
      pointer: { asset_pointer: 'file-service://file_one' },
    };
    const library = { ...asset('b', '/library'), mediaType: 'image/jpeg' };
    const pointer = { ...asset('a', '/pointer'), mediaType: 'image/jpeg' };
    const signedUrl = (fileId: string, signature: string) =>
      'https://chatgpt.com/backend-api/estuary/content?' +
      `cid=123456&id=${fileId}&p=fs&sig=${signature.repeat(64)}&ts=123456&v=1`;
    const resolvers = [
      await resolver('file_one', signedUrl('file_one', 'a')),
      await resolver('file_two', signedUrl('file_two', 'b')),
    ];
    for (const assets of [
      [library, pointer],
      [pointer, library],
    ]) {
      await expect(
        matchChatGptPageOwnedAssetResolvers({ raw, assets, resolvers, sha256: digest })
      ).resolves.toEqual([]);
    }
  });

  it('keeps ambiguous multi-ID evidence in whole-ledger active and passive selection', async () => {
    const raw = {
      mapping: {
        node: {
          id: 'node',
          parent: null,
          children: [],
          message: {
            id: 'message',
            author: { role: 'user' },
            content: {
              content_type: 'multimodal_text',
              parts: [
                {
                  content_type: 'image_asset_pointer',
                  mime_type: 'image/jpeg',
                  asset_pointer: 'sediment://file_one',
                },
              ],
            },
            metadata: {
              attachments: [
                {
                  file_id: 'file_one',
                  id: 'file_two',
                  mime_type: 'image/jpeg',
                  name: 'ambiguous.jpg',
                },
              ],
            },
          },
        },
      },
    };
    const inventory = await inventoryChatGptRawAssets({
      raw,
      artifactId: 'conversation',
      sha256: digest,
    });
    expect(inventory.assets).toHaveLength(2);
    expect(
      extractChatGptActiveImagePlan(
        raw,
        inventory.assets,
        inventory.assets.map(record => record.id)
      )
    ).toBeUndefined();
    const signedUrl = (fileId: string, signature: string) =>
      'https://chatgpt.com/backend-api/estuary/content?' +
      `cid=123456&id=${fileId}&p=fs&sig=${signature.repeat(64)}&ts=123456&v=1`;
    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw,
        assets: inventory.assets,
        resolvers: [
          await resolver('file_one', signedUrl('file_one', 'a')),
          await resolver('file_two', signedUrl('file_two', 'b')),
        ],
        sha256: digest,
      })
    ).resolves.toEqual([]);
  });

  it('does not promote a separate pointer alias past unsupported direct evidence', async () => {
    const raw = {
      unsupported: {
        file_id: 'file/unsupported',
        asset_pointer: 'file-service://file_one',
      },
      pointer: { asset_pointer: 'sediment://file_one' },
    };
    const unsupported = { ...asset('b', '/unsupported'), mediaType: 'image/jpeg' };
    const pointer = { ...asset('a', '/pointer'), mediaType: 'image/jpeg' };
    const observed = await resolver('file_one', 'https://chatgpt.com/synthetic-signed');
    for (const assets of [
      [unsupported, pointer],
      [pointer, unsupported],
    ]) {
      expect(
        extractChatGptActiveImagePlan(
          raw,
          assets,
          assets.map(record => record.id)
        )
      ).toBeUndefined();
      await expect(
        matchChatGptPageOwnedAssetResolvers({
          raw,
          assets,
          resolvers: [observed],
          sha256: digest,
        })
      ).resolves.toEqual([]);
    }
  });

  it.each(['file.with.dot', 'x'.repeat(257)])(
    'blocks an active pointer alias when the stronger direct identity is active-incompatible',
    directId => {
      const raw = {
        direct: {
          file_id: directId,
          asset_pointer: 'file-service://file_one',
        },
        pointer: { asset_pointer: 'sediment://file_one' },
      };
      const direct = { ...asset('b', '/direct'), mediaType: 'image/jpeg' };
      const pointer = { ...asset('a', '/pointer'), mediaType: 'image/jpeg' };
      expect(
        extractChatGptActiveImagePlan(raw, [direct, pointer], [direct.id, pointer.id])
      ).toBeUndefined();
    }
  );

  describe.each(['passive', 'active-metric'] as const)('%s direct identity rejection', route => {
    it.each(['slash', 'Unicode', 'over-limit'] as const)(
      'rejects %s direct identity without sibling/pointer fallback',
      async kind => {
        const invalid =
          kind === 'slash'
            ? 'file/unsupported'
            : kind === 'Unicode'
              ? 'file-неподдерживаемый'
              : 'x'.repeat(route === 'passive' ? 513 : 257);
        const observed = await resolver('file_valid', 'https://chatgpt.com/synthetic-signed');
        for (const mixed of [false, true]) {
          for (const field of ['asset_id', 'assetId', 'file_id', 'fileId', 'id']) {
            const record = {
              asset_pointer: 'file-service://file_valid',
              ...(mixed ? { [field === 'id' ? 'file_id' : 'id']: 'file_valid' } : {}),
              [field]: invalid,
            };
            const assets = [asset('a', '/candidate')];
            if (route === 'passive')
              expect(
                await matchChatGptPageOwnedAssetResolvers({
                  raw: { candidate: record },
                  assets,
                  resolvers: [observed],
                  sha256: digest,
                })
              ).toEqual([]);
            else
              expect(extractChatGptActiveResolverPlan({ candidate: record }, assets)).toEqual({
                providerFileIds: [],
              });
          }
        }
      }
    );
  });

  it('preserves the wider passive grammar without relaxing the active metric grammar', async () => {
    for (const direct of ['file.with.dot', 'x'.repeat(512)]) {
      const assets = [asset('a', '/candidate')];
      const raw = { candidate: { file_id: direct, asset_pointer: 'file-service://file_valid' } };
      const observed = await resolver(direct, 'https://chatgpt.com/synthetic-signed');
      expect(
        await matchChatGptPageOwnedAssetResolvers({
          raw,
          assets,
          resolvers: [observed],
          sha256: digest,
        })
      ).toEqual([{ assetId: assets[0].id, downloadUrl: observed.downloadUrl }]);
      expect(extractChatGptActiveResolverPlan(raw, assets)).toEqual({ providerFileIds: [] });
    }
  });

  describe('ordinary image data plan before dispatch', () => {
    it.each([
      ['image/png', true],
      ['image/jpeg', true],
      ['image/gif', false],
      ['image/webp', false],
      ['application/pdf', false],
      [null, false],
      ['image/jpg', false],
      ['IMAGE/JPEG', false],
      ['image/jpeg; charset=binary', false],
    ])('admits only the exact ordinary PNG/JPEG media types (%s)', (mediaType, admitted) => {
      const record = { ...asset('a', '/direct'), mediaType };
      const plan = extractChatGptActiveImagePlan(
        { direct: { file_id: 'file_one' } },
        [record],
        [record.id]
      );
      expect(plan).toEqual(
        admitted ? { assetId: record.id, providerFileId: 'file_one' } : undefined
      );
    });
    it.each([
      ['IMAGE/JPEG; charset=binary', 'image/jpeg', true],
      ['image/jpg', null, false],
    ] as const)(
      'plans from canonical inventory MIME essence for raw %s',
      async (rawMime, canonicalMime, admitted) => {
        const raw = {
          mapping: {
            node: {
              id: 'node',
              parent: null,
              children: [],
              message: {
                id: 'message',
                author: { role: 'user' },
                content: {
                  content_type: 'multimodal_text',
                  parts: [
                    {
                      content_type: 'image_asset_pointer',
                      mime_type: rawMime,
                      file_id: 'file_one',
                    },
                  ],
                },
                metadata: {},
              },
            },
          },
        };
        const inventory = await inventoryChatGptRawAssets({
          raw,
          artifactId: 'conversation',
          sha256: digest,
        });
        expect(inventory.assets).toHaveLength(1);
        expect(inventory.assets[0].mediaType).toBe(canonicalMime);
        expect(
          extractChatGptActiveImagePlan(raw, inventory.assets, [inventory.assets[0].id])
        ).toEqual(
          admitted ? { assetId: inventory.assets[0].id, providerFileId: 'file_one' } : undefined
        );
      }
    );
    it.each([
      ['slash', 'file/unsupported'],
      ['Unicode', 'file-неподдерживаемый'],
      ['over-512', 'x'.repeat(513)],
    ])(
      'rejects a nonempty %s direct identity before pointer fallback, including mixed valid/invalid direct fields',
      async (_label, invalidId) => {
        for (const mixed of [false, true]) {
          const attachment = {
            content_type: 'image_asset_pointer',
            mime_type: 'image/png',
            file_id: invalidId,
            asset_pointer: 'file-service://file_valid',
            ...(mixed ? { id: 'file_valid' } : {}),
          };
          const raw = {
            mapping: {
              node: {
                id: 'node',
                parent: null,
                children: [],
                message: {
                  id: 'message',
                  author: { role: 'user' },
                  content: { content_type: 'multimodal_text', parts: [attachment] },
                  metadata: {},
                },
              },
            },
          };
          const inventory = await inventoryChatGptRawAssets({
            raw,
            artifactId: 'conversation',
            sha256: digest,
          });
          expect(inventory.assets).toHaveLength(1);
          const opaque = inventory.assets[0];
          expect(opaque.id).toBe(
            await chatGptAssetIdForIdentity(`provider-id:${invalidId}`, digest)
          );
          expect(extractChatGptActiveImagePlan(raw, inventory.assets, [opaque.id])).toBeUndefined();
        }
      }
    );
    it('deduplicates equivalent pointers and chooses one deterministic opaque asset', () => {
      const raw = {
        first: { file_id: 'file_one' },
        duplicate: { asset_pointer: 'file-service://file_one' },
        second: { file_id: 'file_two' },
        outside: { file_id: 'must-not-scan' },
      };
      const first = assetWithSourceRefs('a', ['/first', '/duplicate']);
      const second = asset('b', '/second');
      expect(extractChatGptActiveImagePlan(raw, [second, first], [second.id, first.id])).toEqual({
        assetId: first.id,
        providerFileId: 'file_one',
      });
    });
    it('gives a direct metadata identity precedence over pointer-only ledger records, not array order', () => {
      const raw = {
        direct: { file_id: 'file_one', asset_pointer: 'file-service://ignored' },
        pointer: { asset_pointer: 'file-service://file_one' },
      };
      const direct = asset('b', '/direct'),
        pointer = asset('a', '/pointer');
      expect(
        extractChatGptActiveImagePlan(raw, [pointer, direct], [pointer.id, direct.id])
      ).toEqual({
        assetId: direct.id,
        providerFileId: 'file_one',
      });
      expect(extractChatGptActiveImagePlan(raw, [pointer, direct], [pointer.id])).toBeUndefined();
    });
    it.each(['image/gif', 'image/webp', 'application/pdf'])(
      'keeps stronger ineligible %s evidence ahead of a weaker eligible JPEG pointer',
      mediaType => {
        const raw = {
          direct: { file_id: 'file_one' },
          pointer: { asset_pointer: 'file-service://file_one' },
        };
        const direct = { ...asset('b', '/direct'), mediaType };
        const pointer = { ...asset('a', '/pointer'), mediaType: 'image/jpeg' };
        for (const records of [
          [direct, pointer],
          [pointer, direct],
        ]) {
          expect(
            extractChatGptActiveImagePlan(raw, records, [direct.id, pointer.id])
          ).toBeUndefined();
        }
      }
    );
    it.each(['image/png', 'image/jpeg'])(
      'keeps Library-ID %s out of the ordinary route without promoting its pointer alias',
      mediaType => {
        const raw = {
          direct: { file_id: 'file_one', library_file_id: 'library_one', source: 'local' },
          pointer: { asset_pointer: 'sediment://file_one' },
        };
        const direct = { ...asset('b', '/direct'), mediaType };
        const pointer = { ...asset('a', '/pointer'), mediaType };
        for (const records of [
          [direct, pointer],
          [pointer, direct],
        ]) {
          expect(
            extractChatGptActiveImagePlan(raw, records, [direct.id, pointer.id])
          ).toBeUndefined();
        }
      }
    );
    it('does not infer Library ownership from source=local alone', () => {
      const record = asset('a', '/direct');
      expect(
        extractChatGptActiveImagePlan(
          { direct: { file_id: 'file_one', source: 'local' } },
          [record],
          [record.id]
        )
      ).toEqual({ assetId: record.id, providerFileId: 'file_one' });
    });
    it.each([{ malformed: true }, 42])(
      'fails closed on malformed Library identity evidence %#',
      libraryFileId => {
        const record = asset('a', '/direct');
        expect(
          extractChatGptActiveImagePlan(
            { direct: { file_id: 'file_one', library_file_id: libraryFileId } },
            [record],
            [record.id]
          )
        ).toBeUndefined();
      }
    );
    it('skips multiple identities, cross-record ties, and duplicate opaque records', () => {
      const raw = {
        one: { file_id: 'file_one' },
        two: { file_id: 'file_two' },
        ambiguous: { file_id: 'file_one', id: 'file_two' },
      };
      const first = asset('a', '/one'),
        second = asset('b', '/one');
      expect(
        extractChatGptActiveImagePlan(raw, [first, second], [first.id, second.id])
      ).toBeUndefined();
      expect(extractChatGptActiveImagePlan(raw, [first, first], [first.id])).toBeUndefined();
      expect(
        extractChatGptActiveImagePlan(raw, [assetWithSourceRefs('a', ['/one', '/two'])], [first.id])
      ).toBeUndefined();
      expect(
        extractChatGptActiveImagePlan(
          raw,
          [asset('a', '/ambiguous'), second],
          [first.id, second.id]
        )
      ).toBeUndefined();
    });
    it('does not recover unsupported direct IDs through weaker transport pointers', () => {
      const raw = {
        one: { file_id: 'file.unsupported', asset_pointer: 'file-service://file_valid' },
        two: { asset_pointer: 'file-service://file_valid' },
      };
      const record = assetWithSourceRefs('a', ['/one', '/two']);
      expect(extractChatGptActiveImagePlan(raw, [record], [record.id])).toBeUndefined();
    });
    it.each(['non-image', 'attempted', 'declined', 'unlisted', 'other artifact', 'missing ref'])(
      'skips %s before any network plan',
      mode => {
        const record = asset('a', '/one');
        if (mode === 'non-image') record.mediaType = 'application/pdf';
        if (mode === 'attempted') record.state = 'failed';
        if (mode === 'declined') record.state = 'declined';
        if (mode === 'other artifact') record.sourceRefs[0].artifactId = 'other';
        if (mode === 'missing ref') record.sourceRefs[0].rawPointer = '/missing';
        expect(
          extractChatGptActiveImagePlan(
            { one: { file_id: 'file_one' } },
            [record],
            mode === 'unlisted' ? [] : [record.id]
          )
        ).toBeUndefined();
      }
    );
  });
  describe('interpreter attachment plan', () => {
    it('never selects declined metadata attachments even when their sandbox path is resolvable', async () => {
      const record = {
        ...asset('a', '/mapping/node/message/metadata/attachments/0'),
        state: 'declined' as const,
      };
      const raw = {
        mapping: {
          node: {
            message: {
              id: 'message_123',
              metadata: { attachments: [{ name: '/mnt/data/preview.png' }] },
            },
          },
        },
      };
      await expect(extractChatGptInterpreterAssetPlan(raw, [record])).resolves.toEqual([]);
    });

    it('matches each assistant Markdown link from one exact text-part ledger source', async () => {
      const raw = {
        mapping: {
          node: {
            message: {
              id: 'assistant-message',
              author: { role: 'assistant' },
              content: {
                content_type: 'text',
                parts: [
                  '[document](sandbox:/mnt/data/one%20file.docx) [sheet](sandbox:/mnt/data/two.xlsx)',
                ],
              },
            },
          },
        },
      };
      const inventory = await inventoryChatGptRawAssets({
        raw,
        artifactId: 'conversation',
        sha256: digest,
      });
      const plan = await extractChatGptInterpreterAssetPlan(raw, inventory.assets, digest);

      expect(inventory.assets).toHaveLength(2);
      expect(plan).toHaveLength(2);
      expect(plan.map(candidate => candidate.sandboxPath).sort()).toEqual([
        '/mnt/data/one file.docx',
        '/mnt/data/two.xlsx',
      ]);
      expect(plan.every(candidate => candidate.messageId === 'assistant-message')).toBe(true);
      await expect(
        extractChatGptInterpreterAssetPlan(raw, [...inventory.assets].reverse(), digest)
      ).resolves.toEqual(plan);
    });

    it('rejects a matching opaque ledger ID when its source link is inside indented code', async () => {
      const messageId = 'assistant-message';
      const sandboxPath = '/mnt/data/private.txt';
      const identity = chatGptSandboxLinkIdentity(messageId, sandboxPath);
      if (!identity) throw new Error('synthetic identity must be valid');
      const assetId = await chatGptAssetIdForIdentity(identity, digest);
      if (!assetId) throw new Error('synthetic asset ID must be valid');
      const raw = {
        mapping: {
          node: {
            message: {
              id: messageId,
              author: { role: 'assistant' },
              content: {
                content_type: 'text',
                parts: ['    [code example](sandbox:/mnt/data/private.txt)'],
              },
            },
          },
        },
      };
      const forgedLedgerAsset: RawCaptureAssetRecord = {
        ...asset('a', '/mapping/node/message/content/parts/0'),
        id: assetId,
      };

      await expect(
        extractChatGptInterpreterAssetPlan(raw, [forgedLedgerAsset], digest)
      ).resolves.toEqual([]);
    });

    it('extracts an exact metadata attachment with its same-node message and safe Unicode filename', async () => {
      const metadata = asset('a', '/mapping/node~1current/message/metadata/attachments/0');
      const plan = await extractChatGptInterpreterAssetPlan(
        {
          mapping: {
            'node/current': {
              message: {
                id: 'message_123',
                metadata: {
                  attachments: [
                    {
                      id: 'attachment',
                      mime_type: 'text/plain',
                      name: '/mnt/data/Отчёт 01.txt',
                      size: 12,
                    },
                  ],
                },
              },
            },
          },
        },
        [metadata]
      );

      expect(plan).toEqual([
        {
          assetId: metadata.id,
          messageId: 'message_123',
          sandboxPath: '/mnt/data/Отчёт 01.txt',
        },
      ]);
      expect(Object.keys(plan[0] ?? {}).sort()).toEqual(['assetId', 'messageId', 'sandboxPath']);
      expect(plan[0]).not.toHaveProperty('raw');
      expect(plan[0]).not.toHaveProperty('url');
      expect(plan[0]).not.toHaveProperty('downloadUrl');
      expect(plan[0]).not.toHaveProperty('headers');
      expect(plan[0]).not.toHaveProperty('body');
    });

    it('ignores incidental sandbox-looking strings and first-slice content parts', async () => {
      const parts = asset('a', '/mapping/root/message/content/parts/0');
      expect(
        await extractChatGptInterpreterAssetPlan(
          {
            mapping: {
              root: {
                message: {
                  id: 'message_123',
                  content: {
                    parts: [
                      '/mnt/data/incidental-in-text.txt',
                      { content_type: 'code', text: 'open(/mnt/data/incidental-code.py)' },
                      { content_type: 'execution_output', text: '/mnt/data/incidental-output.csv' },
                    ],
                  },
                  metadata: { note: '/mnt/data/not-an-attachment.txt' },
                },
              },
            },
          },
          [parts]
        )
      ).toEqual([]);
    });

    it.each([
      ['relative path', 'relative.txt'],
      ['different root', '/tmp/file.txt'],
      ['empty filename', '/mnt/data/'],
      ['empty segment', '/mnt/data/folder//file.txt'],
      ['dot segment', '/mnt/data/./file.txt'],
      ['parent segment', '/mnt/data/../file.txt'],
      ['backslash', '/mnt/data/folder\\file.txt'],
      ['control character', '/mnt/data/file\n.txt'],
      ['overlong path', `/mnt/data/${'a'.repeat(4_100)}`],
    ])('rejects %s in a sandbox path', async (_label, name) => {
      const metadata = asset('a', '/mapping/root/message/metadata/attachments/0');
      expect(
        await extractChatGptInterpreterAssetPlan(
          {
            mapping: {
              root: {
                message: {
                  id: 'message_123',
                  metadata: { attachments: [{ name }] },
                },
              },
            },
          },
          [metadata]
        )
      ).toEqual([]);
    });

    it.each([
      ['an empty pointer', ''],
      ['an overlong pointer', `/${'a'.repeat(4_100)}`],
      ['a control-bearing pointer', '/mapping/root/message/metadata/attachments/0\n'],
      ['a non-string pointer', 42],
    ])('rejects %s before pointer traversal', async (_label, rawPointer) => {
      const invalid = {
        ...asset('a', '/mapping/root/message/metadata/attachments/0'),
        sourceRefs: [{ artifactId: 'conversation', rawPointer }],
      } as unknown as RawCaptureAssetRecord;
      await expect(extractChatGptInterpreterAssetPlan({ mapping: {} }, [invalid])).resolves.toEqual(
        []
      );
    });

    it.each([null, {}, { id: 'missing-name' }])(
      'rejects an exact attachment value without a string name %#',
      async attachment => {
        const metadata = asset('a', '/mapping/root/message/metadata/attachments/0');
        expect(
          await extractChatGptInterpreterAssetPlan(
            {
              mapping: {
                root: {
                  message: {
                    id: 'message_123',
                    metadata: { attachments: [attachment] },
                  },
                },
              },
            },
            [metadata]
          )
        ).toEqual([]);
      }
    );

    it('rejects malformed pointers and unsafe paths, message IDs, and internal asset IDs', async () => {
      const pointers = [
        '/mapping/node~2bad/message/metadata/attachments/0',
        '/mapping//message/metadata/attachments/0',
        '/mapping/root/message/content/parts/0',
        '/mapping/root/message/metadata/attachments/00',
        '/mapping/root/message/metadata/attachments/0/extra',
      ];
      const malformed = pointers.map((pointer, index) =>
        asset(String.fromCharCode(97 + index), pointer)
      );
      const unsafePath = asset('f', '/mapping/path/message/metadata/attachments/0');
      const unsafeMessage = asset('a', '/mapping/message/message/metadata/attachments/0');
      const unsafeAsset = {
        ...asset('b', '/mapping/asset/message/metadata/attachments/0'),
        id: 'unsafe-id',
      };

      expect(
        await extractChatGptInterpreterAssetPlan(
          {
            mapping: {
              root: {
                message: {
                  id: 'message_123',
                  metadata: { attachments: [{ name: '/mnt/data/a.txt' }] },
                },
              },
              path: {
                message: {
                  id: 'message_123',
                  metadata: { attachments: [{ name: '/mnt/data/../up.txt' }] },
                },
              },
              message: {
                message: {
                  id: 'unsafe message\n',
                  metadata: { attachments: [{ name: '/mnt/data/ok.txt' }] },
                },
              },
              asset: {
                message: {
                  id: 'message_123',
                  metadata: { attachments: [{ name: '/mnt/data/ok.txt' }] },
                },
              },
            },
          },
          [...malformed, unsafePath, unsafeMessage, unsafeAsset]
        )
      ).toEqual([]);
    });

    it('skips an asset with conflicting attachment source refs', async () => {
      const conflicting = assetWithSourceRefs('a', [
        '/mapping/first/message/metadata/attachments/0',
        '/mapping/second/message/metadata/attachments/0',
      ]);
      expect(
        await extractChatGptInterpreterAssetPlan(
          {
            mapping: {
              first: {
                message: {
                  id: 'message_1',
                  metadata: { attachments: [{ name: '/mnt/data/one.txt' }] },
                },
              },
              second: {
                message: {
                  id: 'message_2',
                  metadata: { attachments: [{ name: '/mnt/data/two.txt' }] },
                },
              },
            },
          },
          [conflicting]
        )
      ).toEqual([]);
    });

    it('deduplicates exact message-path pairs and remains stable when assets are reversed', async () => {
      const first = asset('a', '/mapping/first/message/metadata/attachments/0');
      const duplicate = asset('b', '/mapping/duplicate/message/metadata/attachments/0');
      const distinct = asset('c', '/mapping/distinct/message/metadata/attachments/0');
      const raw = {
        mapping: {
          first: {
            message: {
              id: 'message_1',
              metadata: { attachments: [{ name: '/mnt/data/shared.txt' }] },
            },
          },
          duplicate: {
            message: {
              id: 'message_1',
              metadata: { attachments: [{ name: '/mnt/data/shared.txt' }] },
            },
          },
          distinct: {
            message: {
              id: 'message_2',
              metadata: { attachments: [{ name: '/mnt/data/other.txt' }] },
            },
          },
        },
      };
      const expected = [
        {
          assetId: first.id,
          messageId: 'message_1',
          sandboxPath: '/mnt/data/shared.txt',
        },
        {
          assetId: distinct.id,
          messageId: 'message_2',
          sandboxPath: '/mnt/data/other.txt',
        },
      ];

      expect(await extractChatGptInterpreterAssetPlan(raw, [duplicate, distinct, first])).toEqual(
        expected
      );
      expect(
        await extractChatGptInterpreterAssetPlan(raw, [first, distinct, duplicate].reverse())
      ).toEqual(expected);
    });

    it('uses its dedicated 20-candidate cap after deterministic asset ordering', async () => {
      const assets = Array.from({ length: 25 }, (_, index) => indexedInterpreterAsset(index));
      const raw = {
        mapping: Object.fromEntries(
          assets.map((_, index) => [
            `node-${index}`,
            {
              message: {
                id: `message_${index}`,
                metadata: { attachments: [{ name: `/mnt/data/file-${index}.txt` }] },
              },
            },
          ])
        ),
      };
      const plan = await extractChatGptInterpreterAssetPlan(raw, [...assets].reverse());

      expect(plan).toHaveLength(CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT);
      expect(plan.map(candidate => candidate.assetId)).toEqual(
        assets.slice(0, CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT).map(candidate => candidate.id)
      );
    });
  });

  it('extracts a bounded deterministic active plan only from exact ledger pointers', () => {
    const direct = asset('a', '/mapping/root/message/metadata/attachments/0');
    const ambiguous = asset('b', '/mapping/root/message/content/parts/0');
    const duplicate = asset('c', '/mapping/root/message/metadata/attachments/1');
    const plan = extractChatGptActiveResolverPlan(
      {
        mapping: {
          root: {
            message: {
              metadata: { attachments: [{ file_id: 'one' }, { id: 'one' }] },
              content: { parts: [{ file_id: 'two', asset_id: 'three' }] },
            },
          },
        },
        unrelated: { file_id: 'must-not-be-scanned' },
      },
      [ambiguous, duplicate, direct]
    );
    expect(plan).toEqual({ providerFileIds: ['one'] });
    expect(JSON.stringify(plan)).not.toContain('must-not-be-scanned');
  });

  it('uses the active 20-ID cap without leaking rejected malformed values', () => {
    const assets = Array.from({ length: 25 }, (_, index) => asset(`x${index}`, `/asset/${index}`));
    const raw = {
      asset: Array.from({ length: 25 }, (_, index) => ({ file_id: `file_${index}` })),
    };
    const plan = extractChatGptActiveResolverPlan(raw, assets);
    expect(plan.providerFileIds).toHaveLength(20);
    expect(extractChatGptActiveResolverPlan(raw, [...assets].reverse())).toEqual(plan);
  });

  it('accepts one safe transport pointer and ignores a pointed record without one', () => {
    const pointer = asset('pointer', '/asset/0');
    const missing = asset('missing', '/asset/1');
    expect(
      extractChatGptActiveResolverPlan(
        {
          asset: [{ asset_pointer: 'sediment://pointer-one' }, { content_type: 'text' }],
        },
        [missing, pointer]
      )
    ).toEqual({ providerFileIds: ['pointer-one'] });
  });

  it('matches an exact provider ID without returning that private ID', async () => {
    const privateId = 'private-file-id';
    const signedUrl =
      'https://chatgpt.com/backend-api/estuary/content?cid=c&id=i&p=p&sig=s&ts=t&v=v';
    const metadata = asset('a', '/mapping/root/message/metadata/attachments/0');
    const result = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: { message: { metadata: { attachments: [{ id: privateId }] } } },
        },
      },
      assets: [metadata],
      resolvers: [await resolver(privateId, signedUrl)],
      sha256: digest,
    });

    expect(result).toEqual([{ assetId: metadata.id, downloadUrl: signedUrl }]);
    expect(JSON.stringify(result)).not.toContain(privateId);
  });

  it('retains the opaque key only for numeric resolver URLs that exactly bind the raw file ID', async () => {
    const privateId = 'file-image_123';
    const numericImageUrl =
      'https://chatgpt.com/backend-api/estuary/content?' +
      `cid=123456&id=${privateId}&p=fs&sig=${'a'.repeat(64)}&ts=123456&v=1`;
    const metadata = asset('a', '/mapping/root/message/metadata/attachments/0');
    const observed = await resolver(privateId, numericImageUrl);
    const raw = {
      mapping: {
        root: { message: { metadata: { attachments: [{ file_id: privateId }] } } },
      },
    };

    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw,
        assets: [metadata],
        resolvers: [observed],
        sha256: digest,
      })
    ).resolves.toEqual([
      {
        assetId: metadata.id,
        downloadUrl: numericImageUrl,
        resolverKey: observed.resolverKey,
      },
    ]);
    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw,
        assets: [metadata],
        resolvers: [
          await resolver(privateId, numericImageUrl.replace(`id=${privateId}`, 'id=file-other')),
        ],
        sha256: digest,
      })
    ).resolves.toEqual([]);

    const numericEightUrl =
      'https://chatgpt.com/backend-api/estuary/content?' +
      `cd=attachment&cid=123456&fn=synthetic-image.png&id=${privateId}` +
      `&p=fs&sig=${'a'.repeat(64)}&ts=123456&v=1`;
    const numericEightObserved = await resolver(privateId, numericEightUrl);
    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw,
        assets: [metadata],
        resolvers: [numericEightObserved],
        sha256: digest,
      })
    ).resolves.toEqual([
      {
        assetId: metadata.id,
        downloadUrl: numericEightUrl,
        resolverKey: numericEightObserved.resolverKey,
      },
    ]);
    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw,
        assets: [metadata],
        resolvers: [
          await resolver(privateId, numericEightUrl.replace(`id=${privateId}`, 'id=file-forged')),
        ],
        sha256: digest,
      })
    ).resolves.toEqual([]);
  });

  it('prefers a direct metadata ID over a pointer-only duplicate', async () => {
    const fileId = 'shared-file-id';
    const pointer = asset('a', '/mapping/root/message/content/parts/0');
    const metadata = asset('b', '/mapping/root/message/metadata/attachments/0');
    const result = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: {
            message: {
              content: {
                parts: [{ asset_pointer: `file-service:${fileId}` }],
              },
              metadata: { attachments: [{ file_id: fileId }] },
            },
          },
        },
      },
      assets: [pointer, metadata],
      resolvers: [await resolver(fileId, 'https://chatgpt.com/signed')],
      sha256: digest,
    });

    expect(result).toEqual([{ assetId: metadata.id, downloadUrl: 'https://chatgpt.com/signed' }]);
  });

  it('accepts a pointer-only resolver and rejects ambiguous or malformed evidence', async () => {
    const pointer = asset('a', '/mapping/root/message/content/parts/0');
    const key = await resolver('pointer-id', 'https://chatgpt.com/one');
    const accepted = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: { message: { content: { parts: [{ asset_pointer: 'sediment://pointer-id' }] } } },
        },
      },
      assets: [pointer],
      resolvers: [key],
      sha256: digest,
    });
    const rejected = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: { message: { content: { parts: [{ asset_pointer: 'sediment://pointer-id' }] } } },
        },
      },
      assets: [pointer],
      resolvers: [key, { ...key, downloadUrl: 'https://chatgpt.com/two' }],
      sha256: digest,
    });

    expect(accepted).toEqual([{ assetId: pointer.id, downloadUrl: 'https://chatgpt.com/one' }]);
    expect(rejected).toEqual([]);
  });

  it('fails soft for invalid pointers, unsupported pointer schemes, and digest failures', async () => {
    const invalidPointer = asset('a', '/missing');
    const unsupported = asset('b', '/mapping/root/message/content/parts/0');
    const observed = await resolver('pointer-id', 'https://chatgpt.com/signed');
    const raw = {
      mapping: {
        root: { message: { content: { parts: [{ asset_pointer: 'unknown://pointer-id' }] } } },
      },
    };

    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw,
        assets: [invalidPointer, unsupported],
        resolvers: [observed],
        sha256: () => Promise.reject(new Error('unavailable')),
      })
    ).resolves.toEqual([]);
  });

  it('rejects invalid inputs and malformed resolver records before raw matching', async () => {
    await expect(matchChatGptPageOwnedAssetResolvers(null as never)).resolves.toEqual([]);
    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw: {},
        assets: [],
        resolvers: [null, { resolverKey: 'bad', downloadUrl: 1 }] as never,
        sha256: digest,
      })
    ).resolves.toEqual([]);
  });

  it('fails soft when hashing a real provider ID is unavailable', async () => {
    const direct = asset('a', '/asset');
    const observed = await resolver('direct-id', 'https://chatgpt.com/signed');

    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw: { asset: { file_id: 'direct-id' } },
        assets: [direct],
        resolvers: [observed],
        sha256: () => Promise.reject(new Error('digest unavailable')),
      })
    ).resolves.toEqual([]);
  });

  it('drops equal-strength ambiguity and deterministically sorts independent matches', async () => {
    const first = asset('a', '/first');
    const duplicate = asset('b', '/duplicate');
    const second = asset('c', '/second');
    const shared = await resolver('shared-id', 'https://chatgpt.com/shared');
    const other = await resolver('other-id', 'https://chatgpt.com/other');
    const ambiguous = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        first: { asset_pointer: 'file-service:shared-id' },
        duplicate: { asset_pointer: 'sediment://shared-id' },
      },
      assets: [first, duplicate],
      resolvers: [shared],
      sha256: digest,
    });
    const sorted = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        first: { file_id: 'shared-id' },
        second: { file_id: 'other-id' },
      },
      assets: [second, first],
      resolvers: [other, shared],
      sha256: digest,
    });

    expect(ambiguous).toEqual([]);
    expect(sorted.map(candidate => candidate.assetId)).toEqual([first.id, second.id]);
  });
});
