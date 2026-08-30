import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive/capture';
import { inventoryChatGptRawAssets } from '../../src/archive/normalizers/chatgpt/inventory';
import {
  chatGptAssetIdForIdentity,
  chatGptSandboxLinkIdentity,
} from '../../src/archive/chatgpt-sandbox-link';
import {
  CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT,
  extractChatGptActiveResolverPlan,
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
  describe('interpreter attachment plan', () => {
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
