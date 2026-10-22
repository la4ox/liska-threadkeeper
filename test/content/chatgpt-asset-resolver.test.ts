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
  extractChatGptActiveResolverPlan,
  extractChatGptActivePngPlan,
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
      expect(extractChatGptActivePngPlan(raw, assets, [alias.id])).toBeUndefined();
    }
  });

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

  describe('one-PNG data plan before dispatch', () => {
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
          expect(extractChatGptActivePngPlan(raw, inventory.assets, [opaque.id])).toBeUndefined();
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
      expect(extractChatGptActivePngPlan(raw, [second, first], [second.id, first.id])).toEqual({
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
      expect(extractChatGptActivePngPlan(raw, [pointer, direct], [pointer.id, direct.id])).toEqual({
        assetId: direct.id,
        providerFileId: 'file_one',
      });
      expect(extractChatGptActivePngPlan(raw, [pointer, direct], [pointer.id])).toBeUndefined();
    });
    it('keeps Library-ID evidence out of the ordinary route without promoting its pointer alias', () => {
      const raw = {
        direct: { file_id: 'file_one', library_file_id: 'library_one', source: 'local' },
        pointer: { asset_pointer: 'sediment://file_one' },
      };
      const direct = asset('b', '/direct');
      const pointer = asset('a', '/pointer');
      for (const records of [
        [direct, pointer],
        [pointer, direct],
      ]) {
        expect(extractChatGptActivePngPlan(raw, records, [direct.id, pointer.id])).toBeUndefined();
      }
    });
    it('does not infer Library ownership from source=local alone', () => {
      const record = asset('a', '/direct');
      expect(
        extractChatGptActivePngPlan(
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
          extractChatGptActivePngPlan(
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
        extractChatGptActivePngPlan(raw, [first, second], [first.id, second.id])
      ).toBeUndefined();
      expect(extractChatGptActivePngPlan(raw, [first, first], [first.id])).toBeUndefined();
      expect(
        extractChatGptActivePngPlan(raw, [assetWithSourceRefs('a', ['/one', '/two'])], [first.id])
      ).toBeUndefined();
      expect(
        extractChatGptActivePngPlan(raw, [asset('a', '/ambiguous'), second], [first.id, second.id])
      ).toBeUndefined();
    });
    it('does not recover unsupported direct IDs through weaker transport pointers', () => {
      const raw = {
        one: { file_id: 'file.unsupported', asset_pointer: 'file-service://file_valid' },
        two: { asset_pointer: 'file-service://file_valid' },
      };
      const record = assetWithSourceRefs('a', ['/one', '/two']);
      expect(extractChatGptActivePngPlan(raw, [record], [record.id])).toBeUndefined();
    });
    it.each(['non-PNG', 'attempted', 'declined', 'unlisted', 'other artifact', 'missing ref'])(
      'skips %s before any network plan',
      mode => {
        const record = asset('a', '/one');
        if (mode === 'non-PNG') record.mediaType = 'application/pdf';
        if (mode === 'attempted') record.state = 'failed';
        if (mode === 'declined') record.state = 'declined';
        if (mode === 'other artifact') record.sourceRefs[0].artifactId = 'other';
        if (mode === 'missing ref') record.sourceRefs[0].rawPointer = '/missing';
        expect(
          extractChatGptActivePngPlan(
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
