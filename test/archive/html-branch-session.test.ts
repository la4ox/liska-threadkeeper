import { afterEach, describe, expect, it, vi } from 'vitest';
import * as publicArchive from '../../src/archive';
import * as validation from '../../src/archive/validate';
import * as traversal from '../../src/archive/traverse';
import * as bindingValidation from '../../src/archive/presentation/assets';
import * as markdownRendering from '../../src/archive/presentation/markdown';
import {
  HTML_BRANCH_SESSION_MAX_LEAVES,
  HtmlPresentationError,
  getArchiveBranchCatalog,
  prepareArchiveHtmlBranchSession,
  renderArchiveHtml,
  type ArchiveNode,
  type HtmlBranchRenderFact,
  type HtmlBranchSession,
  type HtmlBranchSessionInput,
  type LiskaThreadArchive,
} from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const canonicalSha256 = 'a'.repeat(64);
const assetSha256 = 'b'.repeat(64);
const bindingSha256 = 'c'.repeat(64);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function input(archive = clone(branchingFixture) as LiskaThreadArchive): HtmlBranchSessionInput {
  return { archive, canonicalSha256, profile: { includeToolContent: false } };
}

function boundInput(): HtmlBranchSessionInput {
  const candidate = input();
  const assetId = 'asset-synthetic-image';
  const asset = candidate.archive.assets[assetId];
  asset.acquisition.state = 'fetched';
  asset.sha256 = assetSha256;
  asset.mimeType = 'image/png';
  asset.byteLength = 42;
  asset.localArtifactRef = `assets/${assetSha256}.png`;
  candidate.assetBindings = {
    sha256: bindingSha256,
    bindings: [
      {
        assetId,
        path: asset.localArtifactRef,
        sha256: assetSha256,
        byteLength: 42,
        mimeType: 'image/png',
        renderMode: 'image',
      },
    ],
  };
  return candidate;
}

function structural(id: string, parentId: string | null, childIds: string[] = []): ArchiveNode {
  return {
    id,
    parentId,
    childIds,
    sourceRefs: [
      { format: 'synthetic/1', kind: 'node', id: null, artifactId: null, rawPointer: null },
    ],
    extensions: {},
  };
}

function sharedPrefix(depth: number, leaves: number): LiskaThreadArchive {
  const result = input().archive;
  const nodes: Record<string, ArchiveNode> = {};
  for (let index = 0; index < depth; index++) {
    const id = `prefix-${index}`;
    nodes[id] = structural(
      id,
      index === 0 ? null : `prefix-${index - 1}`,
      index + 1 < depth ? [`prefix-${index + 1}`] : []
    );
  }
  const parent = `prefix-${depth - 1}`;
  for (let index = 0; index < leaves; index++) {
    const id = `leaf-${index}`;
    nodes[parent].childIds.push(id);
    nodes[id] = structural(id, parent);
  }
  result.graph = { rootIds: ['prefix-0'], nodes };
  result.assets = {};
  result.conversation.currentNodeId = leaves ? 'leaf-0' : parent;
  return result;
}

function facts(session: HtmlBranchSession): HtmlBranchRenderFact[] {
  return session.branches.map(branch => session.renderLeaf(branch.ordinal).fact);
}

function fails(run: () => unknown, code: string): void {
  expect(run).toThrowError(HtmlPresentationError);
  expect(run).toThrowError(expect.objectContaining({ code, message: code }));
}

function assertMatchesDefensive(candidate: HtmlBranchSessionInput): void {
  const { maxBranches: _maxBranches, ...single } = candidate;
  const catalog = getArchiveBranchCatalog(candidate.archive);
  const session = prepareArchiveHtmlBranchSession(candidate);
  expect(session.branchPointCount).toBe(catalog.branchPointCount);
  expect(session.branchCount).toBe(catalog.branches.length);
  for (const branch of catalog.branches) {
    const rendered = session.renderLeaf(branch.ordinal);
    expect(rendered.presentation).toEqual(
      renderArchiveHtml({ ...single, targetNodeId: branch.targetNodeId })
    );
    expect(session.branches[branch.ordinal - 1]).toEqual({
      ordinal: branch.ordinal,
      relativePath: `branch-${String(branch.ordinal).padStart(6, '0')}.html`,
      nodeCount: branch.nodeCount,
      uniqueNodeCount: branch.uniqueNodeIds.length,
      messageCount: branch.messageCount,
      userMessageCount: branch.userMessageCount,
      assistantMessageCount: branch.assistantMessageCount,
      isCurrentLeaf: branch.isCurrentLeaf,
      containsCurrentNode: branch.containsCurrentNode,
    });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('prepared all-branches HTML session', () => {
  it.each([false, true])(
    'byte-matches defensive current/alternate renders with tool profile %s',
    includeToolContent => {
      const candidate = boundInput();
      candidate.profile.includeToolContent = includeToolContent;
      assertMatchesDefensive(candidate);
      expect(prepareArchiveHtmlBranchSession(candidate).renderLeaf(1).presentation).toEqual(
        renderArchiveHtml(candidate)
      );
    }
  );

  it.each(['tool', 'hidden', 'analysis', 'structural'])(
    'retains %s branches with the same presentation semantics',
    kind => {
      const candidate = input();
      const node = candidate.archive.graph.nodes['node-alternate'];
      if (kind === 'tool') node.message!.author.role = 'tool';
      if (kind === 'hidden') node.message!.visibility = 'hidden';
      if (kind === 'analysis') node.message!.channel = 'analysis';
      if (kind === 'structural') delete node.message;
      assertMatchesDefensive(candidate);
    }
  );

  it('supports a structural-only leaf and keeps the defensive non-leaf target API', () => {
    const candidate = input(sharedPrefix(1, 0));
    assertMatchesDefensive(candidate);
    expect(prepareArchiveHtmlBranchSession(candidate).renderLeaf(1).presentation).toMatchObject({
      selectedNodeCount: 1,
      renderedMessageCount: 0,
    });
    expect(renderArchiveHtml({ ...input(), targetNodeId: 'node-root' })).toMatchObject({
      selectedNodeCount: 1,
      renderedMessageCount: 0,
    });
  });

  it('matches nested/multiple-root declared order, not object key order, with internal current node', () => {
    const candidate = input(sharedPrefix(3, 3));
    const nodes = candidate.archive.graph.nodes;
    nodes['leaf-1'].childIds = ['nested-b', 'nested-a'];
    nodes['nested-a'] = structural('nested-a', 'leaf-1');
    nodes['nested-b'] = structural('nested-b', 'leaf-1');
    nodes['extra-root'] = structural('extra-root', null);
    candidate.archive.graph.rootIds.unshift('extra-root');
    candidate.archive.conversation.currentNodeId = 'prefix-1';
    candidate.archive.graph.nodes = Object.fromEntries(Object.entries(nodes).reverse());
    assertMatchesDefensive(candidate);
    const session = prepareArchiveHtmlBranchSession(candidate);
    expect(session.branches.map(branch => branch.containsCurrentNode)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(session.branches.every(branch => !branch.isCurrentLeaf)).toBe(true);
  });

  it('supports missing current metadata without inventing a current leaf', () => {
    const candidate = input();
    candidate.archive.conversation.currentNodeId = null;
    assertMatchesDefensive(candidate);
    expect(
      prepareArchiveHtmlBranchSession(candidate).branches.every(
        branch => !branch.containsCurrentNode
      )
    ).toBe(true);
  });

  it('handles a deep graph iteratively without retaining expanded shared-prefix paths', () => {
    const candidate = input(sharedPrefix(12_000, 3));
    assertMatchesDefensive(candidate);
    const session = prepareArchiveHtmlBranchSession(candidate);
    expect(session.branches.map(branch => branch.nodeCount)).toEqual([12_001, 12_001, 12_001]);
    expect(session.branches.map(branch => branch.uniqueNodeCount)).toEqual([1, 1, 1]);
  });

  it('accepts exactly 512 leaves, follows wide catalog order, and rejects 513', () => {
    expect(HTML_BRANCH_SESSION_MAX_LEAVES).toBe(512);
    const candidate = input(sharedPrefix(2, 512));
    assertMatchesDefensive(candidate);
    fails(
      () => prepareArchiveHtmlBranchSession(input(sharedPrefix(2, 513))),
      'html-branch-count-limit'
    );
    const session = prepareArchiveHtmlBranchSession(candidate);
    expect(session.renderIndex(facts(session)).branchCount).toBe(512);
  });

  it('supports tightened leaf ceilings only', () => {
    expect(prepareArchiveHtmlBranchSession({ ...input(), maxBranches: 2 }).branchCount).toBe(2);
    fails(
      () => prepareArchiveHtmlBranchSession({ ...input(), maxBranches: 1 }),
      'html-branch-count-limit'
    );
    for (const value of [0, -1, 1.5, 513, Infinity, NaN, '2', null])
      fails(
        () => prepareArchiveHtmlBranchSession({ ...input(), maxBranches: value as number }),
        'html-limits-invalid'
      );
  });

  it('validates the whole archive and bindings once; no child/catalog/path reads while rendering', () => {
    const candidate = boundInput();
    const validate = vi.spyOn(validation, 'validateLiskaThreadArchive');
    const bindings = vi.spyOn(bindingValidation, 'validateHtmlBindings');
    const getPath = vi.spyOn(traversal, 'getNodePath');
    const session = prepareArchiveHtmlBranchSession(candidate);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(bindings).toHaveBeenCalledTimes(1);
    expect(getPath).not.toHaveBeenCalled();
    const forbidden = vi.fn(() => {
      throw new Error('private structural data');
    });
    for (const node of Object.values(candidate.archive.graph.nodes)) {
      Object.defineProperty(node, 'childIds', { get: forbidden });
      Object.defineProperty(node, 'parentId', { get: forbidden });
    }
    Object.defineProperty(candidate.archive.graph, 'nodes', { get: forbidden });
    Object.defineProperty(candidate.archive.graph, 'rootIds', { get: forbidden });
    const renderedFacts = facts(session);
    session.renderIndex(renderedFacts);
    session.renderLeaf(1);
    expect(forbidden).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(bindings).toHaveBeenCalledTimes(1);
    expect(getPath).not.toHaveBeenCalled();
  });

  it('snapshots bindings, title, asset labels, profile, limits and branch metrics without freezing inputs', () => {
    const candidate = boundInput();
    candidate.limits = { maxHtmlChars: 100_000 };
    const session = prepareArchiveHtmlBranchSession(candidate);
    const expected = session.renderLeaf(1).presentation;
    const expectedIndex = session.renderIndex(facts(session));
    candidate.canonicalSha256 = 'd'.repeat(64);
    candidate.archive.conversation.title = '<script>changed title</script>';
    candidate.archive.conversation.currentNodeId = 'node-alternate';
    candidate.archive.assets['asset-synthetic-image'].filename = 'changed label';
    candidate.assetBindings!.sha256 = 'e'.repeat(64);
    candidate.assetBindings!.bindings[0].path = 'https://evil.invalid/private';
    candidate.assetBindings!.bindings[0].renderMode = 'download';
    candidate.assetBindings!.bindings[0].assetId = 'different';
    candidate.profile.includeToolContent = true;
    candidate.limits.maxHtmlChars = 1;
    candidate.archive.graph.nodes['node-root'].childIds = [];
    expect(Object.isFrozen(candidate.archive)).toBe(false);
    expect(session.renderLeaf(1).presentation).toEqual(expected);
    expect(session.renderIndex(facts(session))).toEqual(expectedIndex);
  });

  it('returns one output at a time, retains only compact facts and does not reuse mutable result bodies', () => {
    const session = prepareArchiveHtmlBranchSession(input());
    const markdown = vi.spyOn(markdownRendering, 'renderSafeMarkdown');
    const first = session.renderLeaf(2);
    const expected = first.presentation.html;
    first.presentation.html = 'caller-replaced-output';
    first.presentation.diagnostics.splice(0);
    const second = session.renderLeaf(2);
    expect(markdown).toHaveBeenCalledTimes(2);
    expect(second.presentation.html).toBe(expected);
    expect(second.presentation).not.toBe(first.presentation);
    expect(second.fact).not.toBe(first.fact);
    expect('html' in first.fact).toBe(false);
    expect(Object.keys(session)).toEqual([
      'branches',
      'branchCount',
      'branchPointCount',
      'renderLeaf',
      'renderIndex',
    ]);
    expect(JSON.stringify(session)).not.toContain('Current answer');
    expect(first.fact.diagnostics.length).toBeGreaterThan(0);
  });

  it.each([0, -1, 3, 1.5, NaN, Infinity, '1', null, undefined])(
    'rejects invalid leaf ordinal %s',
    ordinal => {
      const session = prepareArchiveHtmlBranchSession(input());
      fails(() => session.renderLeaf(ordinal as number), 'html-branch-ordinal-invalid');
    }
  );

  it('does not expose an unvalidated constructor through the public archive barrel', () => {
    expect('createPreparedBranchSession' in publicArchive).toBe(false);
    expect('skipValidation' in publicArchive).toBe(false);
  });
});

describe('session-bound branch HTML index', () => {
  it('is deterministic across equivalent sessions with closed links and aggregate diagnostics', () => {
    const first = prepareArchiveHtmlBranchSession(boundInput());
    const second = prepareArchiveHtmlBranchSession(boundInput());
    const firstFacts = facts(first);
    const result = first.renderIndex(firstFacts);
    expect(result).toEqual(second.renderIndex(facts(second)));
    expect(result).toMatchObject({
      schema: 'liska-html-branch-index/1',
      rendererVersion: 'liska-html/1',
      relativePath: 'branches.html',
      branchCount: 2,
      branchPointCount: 1,
      totalSelectedNodeCount: 6,
      totalRenderedMessageCount: 4,
      canonicalSha256,
      assetBindingSha256: bindingSha256,
    });
    const document = new DOMParser().parseFromString(result.html, 'text/html');
    expect(
      [...document.querySelectorAll('a')].map(link => [link.getAttribute('href'), link.textContent])
    ).toEqual([
      ['branch-000001.html', 'Branch 1'],
      ['branch-000002.html', 'Branch 2'],
    ]);
    expect(result.diagnostics).toContainEqual({ code: 'structural-node', count: 2 });
    expect(result.html).toContain('Counts include shared prefixes once per rendered branch.');
  });

  it('accepts actual facts rendered in any order only when supplied in complete ordinal order', () => {
    const session = prepareArchiveHtmlBranchSession(input());
    const second = session.renderLeaf(2).fact;
    const first = session.renderLeaf(1).fact;
    expect(session.renderIndex(Object.freeze([first, second])).branchCount).toBe(2);
    for (const invalid of [
      [],
      [first],
      [first, first],
      [second, first],
      [first, second, second],
      [{ ...first }, second],
      [new Proxy(first, {}), second],
    ])
      fails(() => session.renderIndex(invalid), 'html-branch-facts-invalid');
  });

  it('rejects cross-session, modified copies and caller paths; facts are deeply frozen', () => {
    const session = prepareArchiveHtmlBranchSession(input());
    const rendered = facts(session);
    const other = facts(prepareArchiveHtmlBranchSession(input()));
    fails(() => session.renderIndex(other), 'html-branch-facts-invalid');
    expect(Object.isFrozen(rendered[0])).toBe(true);
    expect(Object.isFrozen(rendered[0].diagnostics)).toBe(true);
    expect(Object.isFrozen(rendered[0].diagnostics[0])).toBe(true);
    expect(Reflect.set(rendered[0], 'relativePath', 'https://evil.invalid')).toBe(false);
    expect(Reflect.set(rendered[0].diagnostics[0], 'count', 999)).toBe(false);
    for (const mutated of [
      { ...rendered[0], relativePath: 'evil.html' },
      { ...rendered[0], ordinal: 2 },
      { ...rendered[0], diagnostics: [] },
    ])
      fails(() => session.renderIndex([mutated, rendered[1]]), 'html-branch-facts-invalid');
  });

  it('rejects hostile fact arrays without invoking accessors or leaking exception text', () => {
    const session = prepareArchiveHtmlBranchSession(input());
    const rendered = facts(session);
    const getter = vi.fn(() => {
      throw new Error('private getter text');
    });
    const accessor = [...rendered];
    Object.defineProperty(accessor, '0', { get: getter });
    const added = Object.assign([...rendered], { url: 'https://evil.invalid' });
    const hostile = new Proxy(rendered, { ownKeys: getter });
    const custom = Object.setPrototypeOf([...rendered], {});
    for (const value of [null, {}, new Array(2), accessor, added, hostile, custom])
      fails(
        () => session.renderIndex(value as HtmlBranchRenderFact[]),
        'html-branch-facts-invalid'
      );
    // Only the explicit Proxy trap is unavoidable; the array accessor is never evaluated.
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it('never emits provider IDs, titles, previews, URLs, resources, scripts or caller markup', () => {
    const candidate = boundInput();
    candidate.archive.conversation.title =
      '<img src="https://evil.invalid/title" onerror="attack()">';
    const session = prepareArchiveHtmlBranchSession(candidate);
    const result = session.renderIndex(facts(session));
    const document = new DOMParser().parseFromString(result.html, 'text/html');
    for (const marker of [
      'node-current',
      'synthetic-branching-thread',
      'Current answer',
      'Alternate',
      'https:',
      'chatgpt',
      'onerror',
      'attack()',
      'synthetic-image',
    ])
      expect(result.html).not.toContain(marker);
    expect(document.querySelectorAll('script,img,iframe,object,embed,link,base,form').length).toBe(
      0
    );
    const csp = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute('content');
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "img-src 'none'",
      "connect-src 'none'",
      "base-uri 'none'",
    ])
      expect(csp).toContain(directive);
  });

  it('is independent of clock, browser, network and storage', () => {
    const session = prepareArchiveHtmlBranchSession(input());
    const rendered = facts(session);
    const expected = session.renderIndex(rendered);
    for (const key of ['Date', 'window', 'document', 'chrome']) vi.stubGlobal(key, undefined);
    vi.stubGlobal('fetch', () => {
      throw new Error('forbidden');
    });
    expect(session.renderIndex(rendered)).toEqual(expected);
  });

  it('enforces the existing output ceiling on the index separately from individual leaves', () => {
    const candidate = input(sharedPrefix(1, 100));
    candidate.limits = { maxHtmlChars: 5_000 };
    const session = prepareArchiveHtmlBranchSession(candidate);
    const rendered = facts(session);
    fails(() => session.renderIndex(rendered), 'html-output-limit');
  });
});

describe('prepared-session validation and tightened work limits', () => {
  it.each(['canonicalSha256', 'assetBindings'] as const)(
    'captures top-level %s data once and never consults stateful get traps',
    field => {
      const ordinary = boundInput();
      ordinary.limits = { maxHtmlChars: 100_000 };
      ordinary.maxBranches = 2;
      const payload = '<a href="https://evil.invalid/proxy">injected provenance</a>';
      let reads = 0;
      const getter = vi.fn((target: HtmlBranchSessionInput, key: PropertyKey) => {
        if (key === field) {
          reads++;
          if (field === 'canonicalSha256') return reads <= 2 ? canonicalSha256 : payload;
          return reads === 1 ? ordinary.assetBindings : { bindings: [], sha256: payload };
        }
        return Reflect.get(target, key);
      });
      const descriptorReads = new Map<PropertyKey, number>();
      const candidate = new Proxy(ordinary, {
        get: getter,
        getOwnPropertyDescriptor(target, key) {
          descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const expectedSession = prepareArchiveHtmlBranchSession(ordinary);
      const session = prepareArchiveHtmlBranchSession(candidate);
      expect(session.renderLeaf(1).presentation).toEqual(
        expectedSession.renderLeaf(1).presentation
      );
      const result = session.renderIndex(facts(session));
      expect(result).toEqual(expectedSession.renderIndex(facts(expectedSession)));
      expect(result.canonicalSha256).toBe(canonicalSha256);
      expect(result.assetBindingSha256).toBe(bindingSha256);
      expect(result.html).not.toContain('evil.invalid');
      expect(getter).not.toHaveBeenCalled();
      for (const key of Object.keys(ordinary)) expect(descriptorReads.get(key)).toBe(1);
    }
  );

  it('uses the first captured canonical descriptor even when later descriptors would drift', () => {
    const ordinary = boundInput();
    let reads = 0;
    const candidate = new Proxy(ordinary, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== 'canonicalSha256') return descriptor;
        return {
          ...descriptor,
          value: ++reads === 1 ? canonicalSha256 : '<img src=x onerror=attack()>',
        };
      },
    });
    const session = prepareArchiveHtmlBranchSession(candidate);
    const result = session.renderIndex(facts(session));
    expect(reads).toBe(1);
    expect(result.canonicalSha256).toBe(canonicalSha256);
    expect(result.html).not.toContain('onerror');
  });

  it('uses the binding digest and binding scalar values from the same detached validation snapshot', () => {
    const ordinary = boundInput();
    const candidate = boundInput();
    let digestReads = 0;
    const setGetter = vi.fn((target, key) => {
      if (key === 'sha256')
        return ++digestReads <= 2 ? bindingSha256 : '<iframe src="https://evil.invalid">';
      return Reflect.get(target, key);
    });
    const scalarGetter = vi.fn((target, key) =>
      key === 'path' ? 'https://evil.invalid/binding-path' : Reflect.get(target, key)
    );
    candidate.assetBindings!.bindings = [
      new Proxy(candidate.assetBindings!.bindings[0], { get: scalarGetter }),
    ];
    candidate.assetBindings = new Proxy(candidate.assetBindings!, { get: setGetter });
    const session = prepareArchiveHtmlBranchSession(candidate);
    const expected = prepareArchiveHtmlBranchSession(ordinary);
    expect(session.renderLeaf(1).presentation).toEqual(expected.renderLeaf(1).presentation);
    expect(session.renderIndex(facts(session))).toEqual(expected.renderIndex(facts(expected)));
    expect(setGetter).not.toHaveBeenCalled();
    expect(scalarGetter).not.toHaveBeenCalled();
  });

  it('fails closed when a binding descriptor drifts after preflight but before validation', () => {
    const candidate = boundInput();
    let reads = 0;
    candidate.assetBindings = new Proxy(candidate.assetBindings!, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== 'sha256') return descriptor;
        return {
          ...descriptor,
          value: ++reads === 1 ? bindingSha256 : '<script>private()</script>',
        };
      },
    });
    expect(() => prepareArchiveHtmlBranchSession(candidate)).toThrowError(
      expect.objectContaining({ code: 'html-bindings-invalid', message: 'html-bindings-invalid' })
    );
  });

  it('keeps the ordinary renderer byte-compatible through the same descriptor snapshot boundary', () => {
    const ordinary = boundInput();
    ordinary.limits = { maxHtmlChars: 100_000 };
    const originalProfile = ordinary.profile;
    const profileGet = vi.fn(() => '<script>profile-drift</script>');
    const limitGet = vi.fn(() => 1);
    const candidate = {
      ...ordinary,
      profile: new Proxy(originalProfile, { get: profileGet }),
      limits: new Proxy(ordinary.limits, { get: limitGet }),
    };
    const inputGet = vi.fn(() => '<script>top-level-drift</script>');
    expect(renderArchiveHtml(new Proxy(candidate, { get: inputGet }))).toEqual(
      renderArchiveHtml(ordinary)
    );
    expect(inputGet).not.toHaveBeenCalled();
    expect(profileGet).not.toHaveBeenCalled();
    expect(limitGet).not.toHaveBeenCalled();
  });

  it('rejects accessor/custom-prototype/cyclic input before native details can leak', () => {
    const getter = vi.fn(() => {
      throw new Error('private-native-details');
    });
    const accessor = input();
    Object.defineProperty(accessor.archive.graph.nodes['node-current'], 'childIds', {
      get: getter,
    });
    const cyclic = input();
    cyclic.archive.conversation.metadata.cycle = cyclic.archive.conversation.metadata;
    const custom = input();
    Object.setPrototypeOf(custom.archive, { private: 'secret' });
    const proxy = new Proxy(input(), { getPrototypeOf: getter });
    for (const candidate of [accessor, cyclic, custom, proxy])
      fails(() => prepareArchiveHtmlBranchSession(candidate), 'html-input-invalid');
    expect(getter).toHaveBeenCalledTimes(2); // Proxy trap twice, never accessor.
  });

  it('applies tightened input limits before the first archive traversal', () => {
    const candidate = input();
    const trap = vi.fn(() => {
      throw new Error('archive should not be traversed');
    });
    candidate.archive = new Proxy(candidate.archive, { ownKeys: trap });
    candidate.limits = { maxInputJsonNodes: 1 };
    fails(() => prepareArchiveHtmlBranchSession(candidate), 'html-input-node-limit');
    expect(trap).not.toHaveBeenCalled();
  });

  it.each([
    [{ maxInputChars: 1 }, 'html-input-char-limit'],
    [{ maxInputJsonDepth: 1 }, 'html-input-depth-limit'],
    [{ maxAssetBindings: 1 }, 'html-binding-count-limit'],
  ])('enforces preparation limits %j', (limits, code) => {
    const candidate = boundInput();
    if (code === 'html-binding-count-limit')
      candidate.assetBindings!.bindings = [
        ...candidate.assetBindings!.bindings,
        { ...candidate.assetBindings!.bindings[0] },
      ];
    candidate.limits = limits;
    fails(() => prepareArchiveHtmlBranchSession(candidate), code);
  });

  it.each([
    [{ maxSelectedNodes: 2 }, 'html-selected-node-limit'],
    [{ maxSelectedBlocks: 1 }, 'html-selected-block-limit'],
    [{ maxSourceChars: 1 }, 'html-source-char-limit'],
    [{ maxHtmlBytes: 1 }, 'html-output-limit'],
    [{ maxMarkdownChars: 1 }, 'html-markdown-char-limit'],
  ])('retains per-leaf limits %j', (limits, code) => {
    const candidate = input();
    candidate.limits = limits;
    const session = prepareArchiveHtmlBranchSession(candidate);
    fails(() => session.renderLeaf(2), code);
  });

  it('rejects caller targets/unknown fields and bad archive/profile/digests value-free', () => {
    fails(
      () =>
        prepareArchiveHtmlBranchSession({
          ...input(),
          targetNodeId: 'private',
        } as HtmlBranchSessionInput),
      'html-input-invalid'
    );
    fails(
      () => prepareArchiveHtmlBranchSession({ ...input(), canonicalSha256: 'private' }),
      'html-canonical-digest-invalid'
    );
    fails(
      () =>
        prepareArchiveHtmlBranchSession({
          ...input(),
          profile: { includeToolContent: 'private' },
        } as unknown as HtmlBranchSessionInput),
      'html-profile-invalid'
    );
    const invalid = input();
    invalid.archive.graph.nodes['node-current'].parentId = 'missing-private-parent';
    fails(() => prepareArchiveHtmlBranchSession(invalid), 'html-archive-invalid');
    const mismatch = boundInput();
    mismatch.assetBindings!.bindings[0].sha256 = 'd'.repeat(64);
    mismatch.assetBindings!.bindings[0].path = `assets/${'d'.repeat(64)}.png`;
    fails(() => prepareArchiveHtmlBranchSession(mismatch), 'html-binding-mismatch');
  });

  it('does not fabricate a branch index for an empty canonical graph', () => {
    const candidate = input();
    candidate.archive.graph = { rootIds: [], nodes: {} };
    candidate.archive.assets = {};
    candidate.archive.conversation.currentNodeId = null;
    expect(validation.validateLiskaThreadArchive(candidate.archive).valid).toBe(true);
    fails(() => prepareArchiveHtmlBranchSession(candidate), 'html-branch-catalog-invalid');
  });
});
