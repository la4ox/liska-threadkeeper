/** Internal prepared-session construction. Only the validating entry point is public. */
import type { ArchiveMessage, LiskaThreadArchive } from '../types';
import { htmlBranchRelativePath } from './branch-paths';
import {
  HTML_DIAGNOSTIC_LABELS,
  HtmlPresentationError,
  LISKA_HTML_BRANCH_INDEX_SCHEMA,
  LISKA_HTML_RENDERER_VERSION,
  type HtmlBranchIndexResult,
  type HtmlBranchRenderFact,
  type HtmlBranchSession,
  type HtmlBranchSummary,
  type HtmlDiagnosticCode,
  type HtmlPresentationDiagnostic,
  type HtmlPresentationLimits,
  type HtmlPresentationResult,
} from './contracts';
import { escapeHtml, fail, PresentationContext } from './safety';

interface PreparedNode {
  parent: PreparedNode | null;
  message: ArchiveMessage | undefined;
  nodeCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  containsCurrentNode: boolean;
  lastBranchDepth: number;
}

interface PreparedLeaf {
  node: PreparedNode;
  summary: HtmlBranchSummary;
}

interface PreparedCatalog {
  leaves: PreparedLeaf[];
  branchPointCount: number;
}

interface SessionOptions {
  archive: LiskaThreadArchive;
  maxBranches: number;
  limits: HtmlPresentationLimits;
  canonicalSha256: string;
  assetBindingSha256: string | null;
  /** Internal renderer closure, never a callback supplied through the public API. */
  renderMessages: (messages: readonly (ArchiveMessage | undefined)[]) => HtmlPresentationResult;
}

type SessionRendering = Omit<SessionOptions, 'archive' | 'maxBranches'>;

const EMPTY_METRICS = {
  nodeCount: 0,
  messageCount: 0,
  userMessageCount: 0,
  assistantMessageCount: 0,
  containsCurrentNode: false,
  lastBranchDepth: 0,
};

function prepareNode(
  parent: PreparedNode | null,
  message: ArchiveMessage | undefined,
  isCurrent: boolean,
  isBranchPoint: boolean
): PreparedNode {
  const previous = parent ?? EMPTY_METRICS;
  const nodeCount = previous.nodeCount + 1;
  return {
    parent,
    message,
    nodeCount,
    messageCount: previous.messageCount + (message ? 1 : 0),
    userMessageCount: previous.userMessageCount + (message?.author.role === 'user' ? 1 : 0),
    assistantMessageCount:
      previous.assistantMessageCount + (message?.author.role === 'assistant' ? 1 : 0),
    containsCurrentNode: isCurrent || previous.containsCurrentNode,
    lastBranchDepth: isBranchPoint ? nodeCount : previous.lastBranchDepth,
  };
}

function leafSummary(node: PreparedNode, ordinal: number, isCurrent: boolean): HtmlBranchSummary {
  return Object.freeze({
    ordinal,
    relativePath: htmlBranchRelativePath({ role: 'leaf', ordinal })!,
    nodeCount: node.nodeCount,
    uniqueNodeCount: node.nodeCount - node.lastBranchDepth,
    messageCount: node.messageCount,
    userMessageCount: node.userMessageCount,
    assistantMessageCount: node.assistantMessageCount,
    isCurrentLeaf: isCurrent,
    containsCurrentNode: node.containsCurrentNode,
  });
}

/** Declared root/child DFS order, matching the validated archive catalog. O(nodes), iterative. */
function prepareCatalog(archive: LiskaThreadArchive, maxBranches: number): PreparedCatalog {
  const { nodes } = archive.graph;
  const current = archive.conversation.currentNodeId;
  const stack: { id: string; parent: PreparedNode | null }[] = archive.graph.rootIds
    .map(id => ({ id, parent: null }))
    .reverse();
  const visited = new Set<string>();
  const leaves: PreparedLeaf[] = [];
  let branchPointCount = 0;
  while (stack.length) {
    const { id, parent } = stack.pop()!;
    if (visited.has(id) || !Object.prototype.hasOwnProperty.call(nodes, id))
      fail('html-branch-catalog-invalid');
    visited.add(id);
    const source = nodes[id];
    const children = source.childIds.slice();
    const node = prepareNode(parent, source.message, id === current, children.length > 1);
    if (children.length > 1) branchPointCount++;
    if (children.length === 0) {
      if (leaves.length >= maxBranches) fail('html-branch-count-limit');
      leaves.push({ node, summary: leafSummary(node, leaves.length + 1, id === current) });
    }
    for (let index = children.length - 1; index >= 0; index--)
      stack.push({ id: children[index], parent: node });
  }
  if (leaves.length === 0 || visited.size !== Object.keys(nodes).length)
    fail('html-branch-catalog-invalid');
  return { leaves, branchPointCount };
}

function selectedMessages(node: PreparedNode, maxNodes: number): (ArchiveMessage | undefined)[] {
  if (node.nodeCount > maxNodes) fail('html-selected-node-limit');
  const messages = new Array<ArchiveMessage | undefined>(node.nodeCount);
  let current: PreparedNode | null = node;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (!current) fail('html-branch-catalog-invalid');
    messages[index] = current.message;
    current = current.parent;
  }
  if (current !== null) fail('html-branch-catalog-invalid');
  return messages;
}

function renderFact(
  summary: HtmlBranchSummary,
  result: HtmlPresentationResult
): HtmlBranchRenderFact {
  return Object.freeze({
    ordinal: summary.ordinal,
    relativePath: summary.relativePath,
    selectedNodeCount: result.selectedNodeCount,
    renderedMessageCount: result.renderedMessageCount,
    diagnostics: Object.freeze(result.diagnostics.map(item => Object.freeze({ ...item }))),
  });
}

function requireFacts(
  value: readonly HtmlBranchRenderFact[],
  count: number,
  issued: WeakSet<HtmlBranchRenderFact>
): HtmlBranchRenderFact[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== count
  )
    fail('html-branch-facts-invalid');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== count + 1) fail('html-branch-facts-invalid');
  const facts: HtmlBranchRenderFact[] = [];
  for (let index = 0; index < count; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('html-branch-facts-invalid');
    const fact = descriptor.value as HtmlBranchRenderFact;
    // Identity is checked before any property access; clones/proxies cannot grant authority.
    if (!issued.has(fact) || fact.ordinal !== index + 1) fail('html-branch-facts-invalid');
    facts.push(fact);
  }
  return facts;
}

function aggregateDiagnostics(
  facts: readonly HtmlBranchRenderFact[]
): HtmlPresentationDiagnostic[] {
  const counts = new Map<HtmlDiagnosticCode, number>();
  for (const fact of facts) {
    for (const diagnostic of fact.diagnostics) {
      const count = (counts.get(diagnostic.code) ?? 0) + diagnostic.count;
      if (!Number.isSafeInteger(count)) fail('html-branch-index-invalid');
      counts.set(diagnostic.code, count);
    }
  }
  return [...counts]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([code, count]) => ({ code, count }));
}

const INDEX_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const INDEX_STYLE =
  'body{font-family:system-ui,sans-serif;line-height:1.5;max-width:58rem;margin:auto;padding:1.5rem;overflow-wrap:anywhere}li{margin:.6rem 0}small{display:block}';

function indexHeader(emit: (value: string) => void, rendering: SessionRendering): void {
  emit('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  emit(`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(INDEX_CSP)}">`);
  emit(
    '<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Archived conversation branches</title>'
  );
  emit(`<style>${INDEX_STYLE}</style></head><body><header><h1>Archived conversation branches</h1>`);
  emit(
    '<p>Reading views are not lossless backups. The canonical archive retains the full graph. This index describes rendered views, not completed file writes.</p>'
  );
  emit(
    `<small>Renderer: ${LISKA_HTML_RENDERER_VERSION}</small><small>Canonical SHA-256: ${escapeHtml(rendering.canonicalSha256)}</small>`
  );
  emit(
    `<small>Asset binding SHA-256: ${escapeHtml(rendering.assetBindingSha256 ?? 'none')}</small></header><main>`
  );
}

function renderIndex(
  catalog: PreparedCatalog,
  facts: readonly HtmlBranchRenderFact[],
  rendering: SessionRendering
): HtmlBranchIndexResult {
  const parts: string[] = [];
  const context = new PresentationContext(rendering.limits);
  const emit = (value: string) => context.emit(parts, value);
  const diagnostics = aggregateDiagnostics(facts);
  indexHeader(emit, rendering);
  emit(`<p>Branches: ${facts.length}. Branch points: ${catalog.branchPointCount}.</p><ol>`);
  for (const fact of facts) {
    const summary = catalog.leaves[fact.ordinal - 1].summary;
    emit(`<li><a href="${summary.relativePath}">Branch ${summary.ordinal}</a>`);
    emit(
      ` — ${summary.nodeCount} nodes; ${summary.messageCount} messages; ${fact.renderedMessageCount} rendered messages; ${summary.uniqueNodeCount} unique suffix nodes.`
    );
    if (summary.isCurrentLeaf) emit(' Current leaf.');
    else if (summary.containsCurrentNode) emit(' Contains the current node.');
    emit('</li>');
  }
  emit(
    '</ol></main><section><h2>Aggregate presentation diagnostics</h2><p>Counts include shared prefixes once per rendered branch.</p><ul>'
  );
  for (const diagnostic of diagnostics)
    emit(
      `<li>${escapeHtml(HTML_DIAGNOSTIC_LABELS[diagnostic.code])} Count: ${diagnostic.count}.</li>`
    );
  emit('</ul></section></body></html>');
  return {
    schema: LISKA_HTML_BRANCH_INDEX_SCHEMA,
    rendererVersion: LISKA_HTML_RENDERER_VERSION,
    html: parts.join(''),
    relativePath: 'branches.html',
    branchCount: facts.length,
    branchPointCount: catalog.branchPointCount,
    totalSelectedNodeCount: facts.reduce((sum, fact) => sum + fact.selectedNodeCount, 0),
    totalRenderedMessageCount: facts.reduce((sum, fact) => sum + fact.renderedMessageCount, 0),
    diagnostics,
    canonicalSha256: rendering.canonicalSha256,
    assetBindingSha256: rendering.assetBindingSha256,
  };
}

function sessionFromCatalog(
  catalog: PreparedCatalog,
  rendering: SessionRendering
): HtmlBranchSession {
  // Weak capabilities retain no HTML and do not grow a strong collection on repeated renders.
  const issued = new WeakSet<HtmlBranchRenderFact>();
  return Object.freeze({
    branches: Object.freeze(catalog.leaves.map(leaf => leaf.summary)),
    branchCount: catalog.leaves.length,
    branchPointCount: catalog.branchPointCount,
    renderLeaf(ordinal: number) {
      try {
        if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > catalog.leaves.length)
          fail('html-branch-ordinal-invalid');
        const leaf = catalog.leaves[ordinal - 1];
        const messages = selectedMessages(leaf.node, rendering.limits.maxSelectedNodes);
        const presentation = rendering.renderMessages(messages);
        const fact = renderFact(leaf.summary, presentation);
        issued.add(fact);
        return { presentation, fact };
      } catch (error) {
        if (error instanceof HtmlPresentationError) throw error;
        fail('html-input-invalid');
      }
    },
    renderIndex(facts: readonly HtmlBranchRenderFact[]) {
      try {
        return renderIndex(catalog, requireFacts(facts, catalog.leaves.length, issued), rendering);
      } catch (error) {
        if (error instanceof HtmlPresentationError) throw error;
        fail('html-branch-facts-invalid');
      }
    },
  });
}

/** Internal only: called after JSON preflight, archive/profile/limits/binding validation. */
export function createPreparedBranchSession(options: SessionOptions): HtmlBranchSession {
  const catalog = prepareCatalog(options.archive, options.maxBranches);
  return sessionFromCatalog(catalog, {
    limits: options.limits,
    canonicalSha256: options.canonicalSha256,
    assetBindingSha256: options.assetBindingSha256,
    renderMessages: options.renderMessages,
  });
}
