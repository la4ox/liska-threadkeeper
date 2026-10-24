// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveNode, LiskaThreadArchive } from '../../src/archive';
import {
  HTML_PRESENTATION_LIMITS,
  HtmlPresentationError,
  renderArchiveHtml,
  type HtmlPresentationLimits,
} from '../../src/archive/presentation';
import * as jsonSafety from '../../src/archive/presentation/safety';
import { authorizeDerivedHtmlContext } from '../../src/content/derived-html-authorization';
import { prepareDerivedHtmlArtifact } from '../../src/content/derived-html-presentation';
import { snapshotStructuredPresentationPath } from '../../src/content/structured-presentation-path';
import {
  retainStructuredArchivePresentation,
  retainStructuredPresentation,
} from '../../src/content/structured-presentation';
import { sha256Hex } from '../../src/lib/sha256';
import type { ArchiveCompanionArtifact, StructuredPresentationContext } from '../../src/lib/types';
import fixture from '../fixtures/archive/branching-chatgpt-thread.json';

vi.mock('../../src/lib/sha256', () => ({ sha256Hex: vi.fn() }));
vi.mock('../../src/archive/presentation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/archive/presentation')>();
  return { ...actual, renderArchiveHtml: vi.fn(actual.renderArchiveHtml) };
});

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const path = ['node-root', 'node-user', 'node-current'];

function setup(archive = structuredClone(fixture) as LiskaThreadArchive, selected = [...path]) {
  const captureId = 'capture-chatgpt-path-proof';
  const manifestSha256 = 'a'.repeat(64);
  archive.inputs[0].captureId = captureId;
  archive.inputs[0].manifestSha256 = manifestSha256;
  const bytes = new TextEncoder().encode(JSON.stringify(archive, null, 2));
  const artifact = (kind: 'raw' | 'manifest' | 'canonical'): ArchiveCompanionArtifact => ({
    kind,
    relativePath:
      kind === 'raw'
        ? 'responses/conversation.json'
        : kind === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json',
    byteLength: kind === 'canonical' ? bytes.byteLength : 2,
    sha256: kind === 'canonical' ? hash(bytes) : manifestSha256,
    transport: 'inline',
    bodyBase64: 'e30=',
  });
  const input = {
    source: 'chatgpt' as const,
    archive,
    targetNodeId: selected[selected.length - 1],
    selectedNodeIds: selected,
    includeToolContent: false,
    archiveCompanion: {
      captureId,
      conversationKey: 'c'.repeat(64),
      artifacts: [artifact('raw'), artifact('manifest'), artifact('canonical')] as const,
    },
  };
  const context = retainStructuredPresentation(input)!;
  return { archive, input, context };
}

type Fixture = ReturnType<typeof setup>;
type Getter = ReturnType<typeof vi.fn>;
type Mutation = (value: Fixture, getter: Getter) => void;
const accessor = (target: object, key: PropertyKey, getter: Getter) =>
  Object.defineProperty(target, key, { get: getter, enumerable: true, configurable: true });
const missing = (target: object, key: string) => {
  delete (target as Record<string, unknown>)[key];
};

const cases: Array<[string, Mutation]> = [
  [
    'empty rootIds',
    ({ archive }) => {
      archive.graph.rootIds = [];
    },
  ],
  [
    'selected root not declared',
    ({ archive }) => {
      archive.graph.rootIds = ['node-alternate'];
    },
  ],
  [
    'duplicate selected root',
    ({ archive }) => {
      archive.graph.rootIds = ['node-root', 'node-root'];
    },
  ],
  ['selected root node missing', ({ archive }) => missing(archive.graph.nodes, 'node-root')],
  ['missing rootIds', ({ archive }) => missing(archive.graph, 'rootIds')],
  [
    'sparse rootIds',
    ({ archive }) => {
      delete archive.graph.rootIds[0];
    },
  ],
  [
    'custom rootIds',
    ({ archive }) => Object.setPrototypeOf(archive.graph.rootIds, Object.create(Array.prototype)),
  ],
  ['rootIds accessor', ({ archive }, getter) => accessor(archive.graph, 'rootIds', getter)],
  [
    'rootIds element accessor',
    ({ archive }, getter) => accessor(archive.graph.rootIds, '0', getter),
  ],
  [
    'root has an extra ancestor',
    ({ archive }) => {
      archive.graph.nodes['node-root'].parentId = 'node-alternate';
    },
  ],
  [
    'parent childIds cleared',
    ({ archive }) => {
      archive.graph.nodes['node-root'].childIds = [];
    },
  ],
  [
    'parent omits selected child',
    ({ archive }) => {
      archive.graph.nodes['node-root'].childIds = ['node-alternate'];
    },
  ],
  [
    'parent childIds missing',
    ({ archive }) => missing(archive.graph.nodes['node-root'], 'childIds'),
  ],
  [
    'parent childIds duplicate selected child',
    ({ archive }) => {
      archive.graph.nodes['node-root'].childIds = ['node-user', 'node-user'];
    },
  ],
  [
    'parent childIds sparse',
    ({ archive }) => {
      delete archive.graph.nodes['node-root'].childIds[0];
    },
  ],
  [
    'parent childIds custom array',
    ({ archive }) =>
      Object.setPrototypeOf(
        archive.graph.nodes['node-root'].childIds,
        Object.create(Array.prototype)
      ),
  ],
  [
    'parent childIds accessor',
    ({ archive }, getter) => accessor(archive.graph.nodes['node-root'], 'childIds', getter),
  ],
  [
    'parent childIds element accessor',
    ({ archive }, getter) => accessor(archive.graph.nodes['node-root'].childIds, '0', getter),
  ],
  [
    'parent childIds nonenumerable entry',
    ({ archive }) =>
      Object.defineProperty(archive.graph.nodes['node-root'].childIds, '0', {
        value: 'node-user',
        enumerable: false,
      }),
  ],
  [
    'target childIds missing',
    ({ archive }) => missing(archive.graph.nodes['node-current'], 'childIds'),
  ],
  [
    'parentId mismatch',
    ({ archive }) => {
      archive.graph.nodes['node-current'].parentId = 'node-root';
    },
  ],
  [
    'parentId accessor',
    ({ archive }, getter) => accessor(archive.graph.nodes['node-current'], 'parentId', getter),
  ],
  [
    'parentId inherited',
    ({ archive }) => {
      const node = archive.graph.nodes['node-current'];
      missing(node, 'parentId');
      Object.setPrototypeOf(node, { parentId: 'node-user' });
    },
  ],
  [
    'target mismatch',
    ({ input }) => {
      input.targetNodeId = 'node-alternate';
    },
  ],
  [
    'parent cycle',
    ({ archive }) => {
      archive.graph.nodes['node-root'].parentId = 'node-current';
    },
  ],
  [
    'repeated selected node',
    ({ input }) => {
      input.selectedNodeIds = ['node-root', 'node-user', 'node-user', 'node-current'];
    },
  ],
  [
    'missing selected ancestor',
    ({ input }) => {
      input.selectedNodeIds = ['node-user', 'node-current'];
    },
  ],
  [
    'extra selected node',
    ({ input }) => {
      input.selectedNodeIds = ['node-root', 'node-user', 'node-alternate', 'node-current'];
    },
  ],
  [
    'selected array sparse',
    ({ input }) => {
      delete input.selectedNodeIds[1];
    },
  ],
  [
    'selected array custom',
    ({ input }) => Object.setPrototypeOf(input.selectedNodeIds, Object.create(Array.prototype)),
  ],
  ['selected array accessor', ({ input }, getter) => accessor(input.selectedNodeIds, '1', getter)],
  ['graph accessor', ({ archive }, getter) => accessor(archive, 'graph', getter)],
  ['nodes accessor', ({ archive }, getter) => accessor(archive.graph, 'nodes', getter)],
  ['node accessor', ({ archive }, getter) => accessor(archive.graph.nodes, 'node-user', getter)],
  [
    'graph custom prototype',
    ({ archive }) => Object.setPrototypeOf(archive.graph, { private: true }),
  ],
  [
    'node-map custom prototype',
    ({ archive }) => Object.setPrototypeOf(archive.graph.nodes, { private: true }),
  ],
  [
    'node custom prototype',
    ({ archive }) => Object.setPrototypeOf(archive.graph.nodes['node-user'], { private: true }),
  ],
  [
    'node-map descriptor trap',
    ({ archive }) => {
      archive.graph.nodes = new Proxy(archive.graph.nodes, {
        getOwnPropertyDescriptor() {
          throw new Error('PRIVATE');
        },
      });
    },
  ],
  [
    'child-array descriptor trap',
    ({ archive }) => {
      archive.graph.nodes['node-root'].childIds = new Proxy(['node-user'], {
        getOwnPropertyDescriptor() {
          throw new Error('PRIVATE');
        },
      });
    },
  ],
];

// These were rejected by the selected API's JSON preflight before graph-path checks.
const inputShapeFailures = new Set([
  'sparse rootIds',
  'custom rootIds',
  'rootIds accessor',
  'rootIds element accessor',
  'parent childIds sparse',
  'parent childIds custom array',
  'parent childIds accessor',
  'parent childIds element accessor',
  'parent childIds nonenumerable entry',
  'parentId accessor',
  'parentId inherited',
  'selected array sparse',
  'selected array custom',
  'selected array accessor',
  'graph accessor',
  'nodes accessor',
  'node accessor',
  'graph custom prototype',
  'node-map custom prototype',
  'node custom prototype',
]);

beforeEach(() => {
  vi.mocked(sha256Hex)
    .mockReset()
    .mockImplementation(async bytes => hash(bytes));
  vi.mocked(renderArchiveHtml).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('shared descriptor-only selected path compatibility', () => {
  it.each(cases)(
    'rejects %s in retention and authorization before hash/render',
    async (label, mutate) => {
      const value = setup();
      expect(value.context).toBeDefined();
      const getter = vi.fn(() => {
        throw new Error('PRIVATE getter must not run');
      });
      mutate(value, getter);
      expect(
        snapshotStructuredPresentationPath(
          value.archive,
          value.input.targetNodeId,
          value.input.selectedNodeIds
        )
      ).toBeUndefined();
      expect(retainStructuredPresentation(value.input)).toBeUndefined();
      const input: StructuredPresentationContext = {
        ...value.context,
        targetNodeId: value.input.targetNodeId,
        selectedNodeIds: value.input.selectedNodeIds,
      };
      const code = inputShapeFailures.has(label)
        ? 'html-input-invalid'
        : 'derived-html-context-invalid';
      const error = await prepareDerivedHtmlArtifact(input).catch(error => error);
      expect(error).toMatchObject({ code, message: code });
      if (inputShapeFailures.has(label)) expect(error).toBeInstanceOf(HtmlPresentationError);
      expect(sha256Hex).not.toHaveBeenCalled();
      expect(renderArchiveHtml).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it('preflights archive JSON before inspecting an inconsistent selected path', async () => {
    const value = setup();
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    accessor(value.archive.graph, 'rootIds', getter);
    const context = { ...value.context, selectedNodeIds: ['wrong-path'] };
    await expect(prepareDerivedHtmlArtifact(context)).rejects.toEqual(
      new HtmlPresentationError('html-input-invalid')
    );
    expect(getter).not.toHaveBeenCalled();
    expect(sha256Hex).not.toHaveBeenCalled();
    expect(renderArchiveHtml).not.toHaveBeenCalled();
  });

  it.each(['', null, 42])(
    'preserves invalid target-envelope precedence for %s',
    async targetNodeId => {
      const value = setup();
      const getter = vi.fn(() => {
        throw new Error('PRIVATE');
      });
      accessor(value.archive.graph, 'rootIds', getter);
      const context = { ...value.context, targetNodeId: targetNodeId as string };
      await expect(prepareDerivedHtmlArtifact(context)).rejects.toMatchObject({
        code: 'derived-html-context-invalid',
      });
      expect(getter).not.toHaveBeenCalled();
      expect(sha256Hex).not.toHaveBeenCalled();
      expect(renderArchiveHtml).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['input nodes', { maxInputJsonNodes: 1 }, 'html-input-node-limit'],
    ['input depth', { maxInputJsonDepth: 1 }, 'html-input-depth-limit'],
    ['input characters', { maxInputChars: 1 }, 'html-input-char-limit'],
  ] as const)(
    'preserves the original %s preflight error before selected-path checks',
    async (_label, tightened, code) => {
      const value = setup();
      const context = { ...value.context, selectedNodeIds: ['wrong-path'] };
      await expect(
        authorizeDerivedHtmlContext(context, undefined, 'selected', {
          ...HTML_PRESENTATION_LIMITS,
          ...tightened,
        })
      ).rejects.toEqual(new HtmlPresentationError(code));
      expect(sha256Hex).not.toHaveBeenCalled();
      expect(renderArchiveHtml).not.toHaveBeenCalled();
    }
  );

  it.each(['depth', 'nodes'] as const)(
    'preserves selected-array %s preflight errors before selected-ID checks',
    async mode => {
      const value = setup();
      let selected: unknown[];
      let limits: HtmlPresentationLimits = { ...HTML_PRESENTATION_LIMITS };
      if (mode === 'depth') {
        const nested: Record<string, unknown> = {};
        let cursor = nested;
        for (let index = 0; index < 100; index++) {
          cursor.child = {};
          cursor = cursor.child as Record<string, unknown>;
        }
        selected = [nested];
      } else {
        selected = Array.from({ length: 1001 }, () => 'node-root');
        limits = { ...limits, maxInputJsonNodes: 1000 };
      }
      const preflight = vi.spyOn(jsonSafety, 'preflightJson');
      const context = { ...value.context, selectedNodeIds: selected as string[] };
      const code = mode === 'depth' ? 'html-input-depth-limit' : 'html-input-node-limit';
      await expect(
        authorizeDerivedHtmlContext(context, undefined, 'selected', limits)
      ).rejects.toEqual(new HtmlPresentationError(code));
      expect(preflight.mock.calls.map(call => call[0])).toEqual([value.archive, selected]);
      expect(sha256Hex).not.toHaveBeenCalled();
      expect(renderArchiveHtml).not.toHaveBeenCalled();
    }
  );

  it('does not repeat whole-archive preflight after hashing but keeps selected-array preflight', async () => {
    const value = setup();
    const selected = [...value.context.selectedNodeIds];
    const context = { ...value.context, selectedNodeIds: selected };
    const preflight = vi.spyOn(jsonSafety, 'preflightJson');
    await authorizeDerivedHtmlContext(context, undefined, 'selected');
    expect(preflight.mock.calls.map(call => call[0])).toEqual([value.archive, selected, selected]);
    expect(sha256Hex).toHaveBeenCalledTimes(1);
  });

  it('preserves selected-array accessor failure after the canonical await', async () => {
    const value = setup();
    const selected = [...value.context.selectedNodeIds];
    const context = { ...value.context, selectedNodeIds: selected };
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    vi.mocked(sha256Hex).mockImplementationOnce(async bytes => {
      accessor(selected, '1', getter);
      return hash(bytes);
    });
    await expect(prepareDerivedHtmlArtifact(context)).rejects.toEqual(
      new HtmlPresentationError('html-input-invalid')
    );
    expect(sha256Hex).toHaveBeenCalledTimes(1);
    expect(renderArchiveHtml).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(cases.slice(0, 9))(
    'leaves target-free base validation independent of %s',
    (_label, mutate) => {
      const value = setup();
      const getter = vi.fn(() => {
        throw new Error('PRIVATE');
      });
      mutate(value, getter);
      expect(retainStructuredArchivePresentation(value.input)).toBeDefined();
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it('returns a detached frozen path, including a valid non-leaf target', () => {
    const value = setup();
    const selected = ['node-root', 'node-user'];
    const result = snapshotStructuredPresentationPath(value.archive, 'node-user', selected)!;
    expect(result).toEqual(selected);
    expect(Object.isFrozen(result)).toBe(true);
    selected[0] = 'mutated';
    value.archive.graph.nodes['node-root'].childIds = [];
    expect(result).toEqual(['node-root', 'node-user']);
  });

  it('uses a bounded dense selected array and only permits tightened path bounds', () => {
    const value = setup();
    expect(snapshotStructuredPresentationPath(value.archive, 'node-current', path, 3)).toEqual(
      path
    );
    for (const limit of [0, -1, 2, 1.5, 50001, Infinity])
      expect(
        snapshotStructuredPresentationPath(value.archive, 'node-current', path, limit)
      ).toBeUndefined();
    expect(
      snapshotStructuredPresentationPath(value.archive, 'node-current', Array(50001))
    ).toBeUndefined();
  });

  it('accepts a deep valid path without recursion and authorizes/renders its unchanged bytes', async () => {
    const archive = structuredClone(fixture) as LiskaThreadArchive;
    const selected = Array.from({ length: 4096 }, (_, index) => `deep-${index}`);
    const nodes: Record<string, ArchiveNode> = {};
    for (let index = 0; index < selected.length; index++)
      nodes[selected[index]] = {
        id: selected[index],
        parentId: index === 0 ? null : selected[index - 1],
        childIds: index + 1 === selected.length ? [] : [selected[index + 1]],
        sourceRefs: [
          { format: 'synthetic/1', kind: 'node', id: null, artifactId: null, rawPointer: null },
        ],
        extensions: {},
      };
    archive.graph = { rootIds: [selected[0]], nodes };
    archive.assets = {};
    archive.conversation.currentNodeId = selected[selected.length - 1];
    const value = setup(archive, selected);
    expect(value.context.selectedNodeIds).toEqual(selected);
    const result = snapshotStructuredPresentationPath(archive, value.input.targetNodeId, selected);
    expect(result).toEqual(selected);
    expect(result).not.toBe(selected);
    const artifact = await prepareDerivedHtmlArtifact(value.context);
    expect(artifact.sourceCanonicalSha256).toBe(value.context.canonical.sha256);
    expect(sha256Hex).toHaveBeenCalledTimes(2);
    expect(renderArchiveHtml).toHaveBeenCalledTimes(1);
    expect(Buffer.from(artifact.bodyBase64, 'base64').byteLength).toBe(artifact.byteLength);
  });

  it('rechecks root and edge evidence after the canonical await without invoking accessors', async () => {
    const value = setup();
    const getter = vi.fn(() => {
      throw new Error('PRIVATE');
    });
    vi.mocked(sha256Hex).mockImplementationOnce(async bytes => {
      accessor(value.archive.graph.nodes['node-root'], 'childIds', getter);
      return hash(bytes);
    });
    await expect(prepareDerivedHtmlArtifact(value.context)).rejects.toMatchObject({
      code: 'derived-html-context-invalid',
    });
    expect(sha256Hex).toHaveBeenCalledTimes(1);
    expect(renderArchiveHtml).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });
});
