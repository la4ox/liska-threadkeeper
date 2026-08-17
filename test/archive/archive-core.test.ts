import { describe, expect, it } from 'vitest';
import schema from '../../src/archive/schema/liska-thread-1.schema.json';
import {
  ArchiveTraversalError,
  getCurrentNodePath,
  getLeafNodeIds,
  getLeafNodePaths,
  getNodePath,
  isLiskaThreadArchive,
  validateLiskaThreadArchive,
  type LiskaThreadArchive,
} from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';
import detachedCycleFixture from '../fixtures/archive/detached-cycle.json';
import malformedCycleFixture from '../fixtures/archive/malformed-cycle.json';
import malformedLinkFixture from '../fixtures/archive/malformed-link.json';

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function issueCodes(input: unknown): string[] {
  return validateLiskaThreadArchive(input).issues.map(issue => issue.code);
}

const sourceRef = {
  format: 'synthetic/1',
  kind: 'block',
  id: 'block-source',
  artifactId: 'conversation',
  rawPointer: '/mapping/message/content',
};

function makeBlock(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `block-${type}`,
    type,
    sourceRefs: [sourceRef],
    extensions: {},
    ...payload,
  };
}

describe('liska-thread/1 archive core', () => {
  const archive = branchingFixture as LiskaThreadArchive;

  it('ships a strict experimental JSON Schema artifact', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.properties.schema.const).toBe('liska-thread/1');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.node.additionalProperties).toBe(false);
    expect(schema.$defs.sourceReferences.minItems).toBe(1);
    expect(schema.$defs.textBlock).toMatchObject({
      type: 'object',
      unevaluatedProperties: false,
    });
    expect(schema.$defs.archiveInput.properties.manifestSha256.pattern).toBe('^[a-fA-F0-9]{64}$');
    expect(schema.$defs.extensions.additionalProperties).toEqual({ $ref: '#/$defs/jsonValue' });
  });

  it('preserves exact nodes, structural roots, ordered children, and typed block order', () => {
    const result = validateLiskaThreadArchive(archive);

    expect(result).toEqual({ valid: true, issues: [] });
    expect(Object.keys(archive.graph.nodes)).toEqual([
      'node-root',
      'node-user',
      'node-current',
      'node-alternate',
    ]);
    expect(archive.graph.nodes['node-root'].message).toBeUndefined();
    expect(archive.graph.nodes['node-user'].childIds).toEqual(['node-current', 'node-alternate']);
    expect(archive.graph.nodes['node-current'].message?.blocks.map(block => block.type)).toEqual([
      'text',
      'reasoning',
      'tool_call',
      'tool_result',
      'attachment',
      'unknown',
    ]);
  });

  it('retains an attachment manifest and an unknown provider block without flattening either', () => {
    const blocks = archive.graph.nodes['node-current'].message?.blocks ?? [];
    const attachment = blocks.find(block => block.type === 'attachment');
    const unknown = blocks.find(block => block.type === 'unknown');

    expect(attachment).toMatchObject({ type: 'attachment', assetId: 'asset-synthetic-image' });
    expect(archive.assets['asset-synthetic-image'].acquisition.state).toBe('fetched');
    expect(unknown).toMatchObject({
      type: 'unknown',
      providerType: 'future_content_part',
      raw: { kind: 'synthetic', version: 1 },
    });
  });

  it('traverses current and alternate branches in declared root and child order', () => {
    expect(getCurrentNodePath(archive)).toEqual(['node-root', 'node-user', 'node-current']);
    expect(getNodePath(archive, 'node-alternate')).toEqual([
      'node-root',
      'node-user',
      'node-alternate',
    ]);
    expect(getLeafNodeIds(archive)).toEqual(['node-current', 'node-alternate']);
    expect(getLeafNodePaths(archive)).toEqual([
      ['node-root', 'node-user', 'node-current'],
      ['node-root', 'node-user', 'node-alternate'],
    ]);
  });

  it('reports deterministic diagnostics for cycles and broken links', () => {
    const cycleCodes = issueCodes(malformedCycleFixture);
    const linkCodes = issueCodes(malformedLinkFixture);

    expect(cycleCodes).toContain('graph-cycle');
    expect(cycleCodes).toContain('root-parent-not-null');
    expect(linkCodes).toContain('child-reference-missing');

    expect(() => getNodePath(malformedCycleFixture as LiskaThreadArchive, 'node-child')).toThrow(
      ArchiveTraversalError
    );
    try {
      getNodePath(malformedCycleFixture as LiskaThreadArchive, 'node-child');
    } catch (error) {
      expect(error).toMatchObject({ code: 'graph-cycle' });
    }

    expect(() => getLeafNodePaths(malformedLinkFixture as LiskaThreadArchive)).toThrow(
      ArchiveTraversalError
    );
  });

  it('finds cycles in detached components while retaining unreachable warnings', () => {
    const result = validateLiskaThreadArchive(detachedCycleFixture);
    const detachedWarnings = result.issues.filter(
      issue => issue.severity === 'warning' && issue.code === 'node-unreachable'
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain('graph-cycle');
    expect(detachedWarnings.map(issue => issue.path)).toEqual([
      '/graph/nodes/node-detached-a',
      '/graph/nodes/node-detached-b',
    ]);
  });

  it.each([
    ['text', { text: 'plain text' }, { text: 1 }],
    ['markdown', { markdown: '**markdown**' }, { markdown: 1 }],
    ['html', { html: '<p>html</p>' }, { html: 1 }],
    ['code', { code: 'const x = 1;', language: 'ts' }, { code: 1, language: 'ts' }],
    ['reasoning', { text: 'reasoning' }, { text: 1 }],
    [
      'tool_call',
      { toolName: 'search', arguments: { q: 'archive' } },
      { toolName: '', arguments: {} },
    ],
    ['tool_result', { toolName: null, result: { ok: true } }, { toolName: 1, result: {} }],
    ['execution_output', { output: ['ok'] }, { output: new Date() }],
    [
      'citation',
      { label: null, url: null, content: { quote: 'source' } },
      { label: 1, url: null, content: null },
    ],
    ['quote', { text: 'quoted', attribution: null }, { text: 1, attribution: null }],
    ['attachment', { assetId: 'asset-synthetic-image' }, { assetId: '' }],
    ['canvas_event', { event: { revision: 1 } }, { event: new Date() }],
    ['error', { message: 'provider error', code: null }, { message: 1, code: null }],
    [
      'unknown',
      { providerType: 'future-part', raw: { retained: true } },
      { providerType: '', raw: null },
    ],
  ])(
    'accepts and rejects the full %s block payload contract',
    (type, validPayload, invalidPayload) => {
      const valid = cloneFixture(archive) as Record<string, any>;
      valid.graph.nodes['node-current'].message.blocks = [makeBlock(type, validPayload)];
      expect(validateLiskaThreadArchive(valid).valid).toBe(true);

      const invalid = cloneFixture(valid) as Record<string, any>;
      invalid.graph.nodes['node-current'].message.blocks = [makeBlock(type, invalidPayload)];
      expect(validateLiskaThreadArchive(invalid).valid).toBe(false);
    }
  );

  it('enforces required fields, strict object boundaries, JSON-safe values, and source pointer forms', () => {
    const malformed = cloneFixture(archive) as Record<string, any>;
    malformed.conversation.title = 42;
    malformed.conversation.url = 'not a URI';
    malformed.conversation.createdAt = 'yesterday';
    malformed.conversation.metadata.date = new Date();
    malformed.inputs[0].manifestSha256 = 'not-a-hash';
    malformed.inputs[0].capturedAt = 'not-a-timestamp';
    delete malformed.inputs[0].normalizer;
    malformed.inputs[0].extra = true;
    malformed.graph.nodes['node-current'].extra = true;
    malformed.graph.nodes['node-current'].message.blocks[0].extra = true;
    malformed.assets['asset-synthetic-image'].byteLength = -1;
    malformed.assets['asset-synthetic-image'].dimensions.width = Number.NaN;
    malformed.assets['asset-synthetic-image'].sha256 = 'bad';
    delete malformed.assets['asset-synthetic-image'].filename;
    malformed.diagnostics.entries = [{ severity: 'warning' }];
    malformed.extensions['not a namespace'] = { bad: true };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    malformed.conversation.metadata.cyclic = cyclic;

    const result = validateLiskaThreadArchive(malformed);
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        'nullable-string-invalid',
        'uri-invalid',
        'timestamp-invalid',
        'json-value-not-safe',
        'sha256-invalid',
        'unexpected-property',
        'asset-byte-length-invalid',
        'asset-dimension-invalid',
        'required-field-missing',
        'json-value-cycle',
        'extension-namespace-invalid',
      ])
    );

    const pointerArchive = cloneFixture(archive) as Record<string, any>;
    pointerArchive.inputs[0].sourceRefs[0].rawPointer = '';
    expect(validateLiskaThreadArchive(pointerArchive).valid).toBe(true);
  });

  it('rejects normalized-but-impossible calendar timestamps', () => {
    const leapDay = cloneFixture(archive) as Record<string, any>;
    leapDay.conversation.createdAt = '2024-02-29T23:59:59+23:59';
    expect(validateLiskaThreadArchive(leapDay).valid).toBe(true);

    for (const timestamp of [
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:00:00+24:00',
    ]) {
      const impossible = cloneFixture(archive) as Record<string, any>;
      impossible.conversation.createdAt = timestamp;
      expect(issueCodes(impossible)).toContain('timestamp-invalid');
    }
  });

  it('does not treat inherited properties as assets and guards malformed traversal structures', () => {
    const missingAsset = cloneFixture(archive) as Record<string, any>;
    missingAsset.graph.nodes['node-current'].message.blocks[4].assetId = 'toString';
    expect(issueCodes(missingAsset)).toContain('attachment-asset-reference-missing');

    const malformedTraversal = cloneFixture(archive) as Record<string, any>;
    malformedTraversal.graph.nodes['node-root'].childIds = { not: 'an array' };
    expect(() => getLeafNodePaths(malformedTraversal as LiskaThreadArchive)).toThrow(
      ArchiveTraversalError
    );
    try {
      getLeafNodePaths(malformedTraversal as LiskaThreadArchive);
    } catch (error) {
      expect(error).toMatchObject({ code: 'node-structure-invalid' });
    }
  });

  it('covers strict malformed object families without making the validator throw', () => {
    const variants: Array<(candidate: Record<string, any>) => void> = [
      candidate => {
        candidate.inputs = [null];
      },
      candidate => {
        candidate.inputs[0].captureId = '';
      },
      candidate => {
        candidate.conversation.id = '';
        candidate.conversation.provider = '';
      },
      candidate => {
        candidate.conversation.metadata = null;
        candidate.conversation.extensions = null;
      },
      candidate => {
        candidate.conversation.sourceRefs = [
          { format: '', kind: '', id: 1, artifactId: 1, rawPointer: 'bad' },
        ];
      },
      candidate => {
        candidate.graph.rootIds = null;
      },
      candidate => {
        candidate.graph.rootIds = ['', 'missing-root'];
      },
      candidate => {
        candidate.graph.nodes = null;
      },
      candidate => {
        candidate.graph.nodes['node-current'] = null;
      },
      candidate => {
        candidate.graph.nodes['node-current'].id = '';
        candidate.graph.nodes['node-current'].childIds = ['', 'node-user', 'node-user'];
      },
      candidate => {
        candidate.graph.nodes['node-current'].message = null;
      },
      candidate => {
        candidate.graph.nodes['node-current'].message.id = '';
        candidate.graph.nodes['node-current'].message.author.role = '';
        candidate.graph.nodes['node-current'].message.blocks = {};
      },
      candidate => {
        candidate.graph.nodes['node-alternate'].message.id = 'message-current';
      },
      candidate => {
        candidate.graph.nodes['node-current'].message.blocks = [
          null,
          { id: '', type: 'not-a-block', sourceRefs: [], extensions: {} },
        ];
      },
      candidate => {
        candidate.assets = null;
      },
      candidate => {
        candidate.assets['asset-synthetic-image'] = null;
      },
      candidate => {
        candidate.assets['asset-synthetic-image'].id = '';
      },
      candidate => {
        candidate.assets['asset-synthetic-image'].id = 'different-id';
        candidate.assets['asset-synthetic-image'].dimensions = {};
        candidate.assets['asset-synthetic-image'].acquisition.state = 'never';
      },
      candidate => {
        candidate.diagnostics.entries = null;
      },
      candidate => {
        candidate.diagnostics.entries = [
          null,
          { severity: 'bad', code: '', message: '', path: 1, sourceRefs: [], extensions: {} },
        ];
      },
    ];

    variants.forEach(mutate => {
      const candidate = cloneFixture(archive) as Record<string, any>;
      mutate(candidate);
      expect(() => validateLiskaThreadArchive(candidate)).not.toThrow();
      expect(validateLiskaThreadArchive(candidate).valid).toBe(false);
    });
  });

  it('returns ArchiveTraversalError for every malformed traversal boundary', () => {
    const cases: Array<{
      archive: unknown;
      target?: unknown;
      expected: string;
      method: 'path' | 'current' | 'leaves';
    }> = [
      { archive: null, expected: 'archive-structure-invalid', method: 'leaves' },
      {
        archive: { graph: { rootIds: null, nodes: {} } },
        expected: 'archive-structure-invalid',
        method: 'leaves',
      },
      { archive, target: null, expected: 'target-node-missing', method: 'path' },
      {
        archive: { ...cloneFixture(archive), conversation: null },
        expected: 'archive-structure-invalid',
        method: 'current',
      },
      {
        archive: (() => {
          const candidate = cloneFixture(archive) as Record<string, any>;
          candidate.graph.rootIds = [];
          return candidate;
        })(),
        target: 'node-root',
        expected: 'root-not-declared',
        method: 'path',
      },
      {
        archive: (() => {
          const candidate = cloneFixture(archive) as Record<string, any>;
          candidate.graph.nodes['node-user'].childIds = [];
          return candidate;
        })(),
        target: 'node-current',
        expected: 'parent-child-asymmetry',
        method: 'path',
      },
      {
        archive: (() => {
          const candidate = cloneFixture(archive) as Record<string, any>;
          candidate.graph.nodes['node-root'].childIds = ['node-current'];
          return candidate;
        })(),
        expected: 'child-parent-asymmetry',
        method: 'leaves',
      },
      { archive: malformedCycleFixture, expected: 'root-not-declared', method: 'leaves' },
    ];

    cases.forEach(({ archive: candidate, target, expected, method }) => {
      try {
        if (method === 'path') {
          getNodePath(candidate as LiskaThreadArchive, target as string | null);
        } else if (method === 'current') {
          getCurrentNodePath(candidate as LiskaThreadArchive);
        } else {
          getLeafNodePaths(candidate as LiskaThreadArchive);
        }
        throw new Error('Traversal should have failed.');
      } catch (error) {
        expect(error).toMatchObject({ code: expected });
      }
    });
  });

  it('checks graph and evidence invariants without throwing on malformed arbitrary input', () => {
    const malformed = cloneFixture(archive) as Record<string, any>;
    malformed.schema = 'some-other-schema';
    malformed.archiveId = '';
    malformed.conversation.currentNodeId = 'not-a-node';
    malformed.graph.rootIds = ['node-root', 'node-root'];
    malformed.graph.nodes['node-current'].id = 'wrong-node-id';
    malformed.graph.nodes['node-current'].message.sourceRefs = [];
    malformed.graph.nodes['node-current'].message.blocks[4].assetId = 'missing-asset';

    const codes = issueCodes(malformed);
    expect(codes).toEqual(
      expect.arrayContaining([
        'schema-tag-invalid',
        'archive-id-invalid',
        'root-id-duplicate',
        'node-key-id-mismatch',
        'current-node-reference-missing',
        'source-refs-missing',
        'attachment-asset-reference-missing',
      ])
    );
    expect(() => validateLiskaThreadArchive(['not', 'an', 'archive'])).not.toThrow();
    expect(validateLiskaThreadArchive(['not', 'an', 'archive'])).toEqual({
      valid: false,
      issues: [
        {
          severity: 'error',
          code: 'archive-not-object',
          path: '',
          message: 'Value must be a plain JSON object.',
        },
      ],
    });
    expect(isLiskaThreadArchive(archive)).toBe(true);
    expect(isLiskaThreadArchive({ schema: 'liska-thread/1' })).toBe(false);
  });
});
