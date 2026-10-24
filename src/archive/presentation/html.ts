import type { ArchiveBlock, ArchiveMessage } from '../types';
import { getNodePath } from '../traverse';
import { validateLiskaThreadArchive } from '../validate';
import { validateHtmlBindings } from './assets';
import { createPreparedBranchSession } from './branches';
import {
  HTML_DIAGNOSTIC_LABELS,
  HTML_BRANCH_SESSION_MAX_LEAVES,
  HtmlPresentationError,
  LISKA_HTML_RENDERER_VERSION,
  LISKA_HTML_SCHEMA,
  type HtmlAssetBinding,
  type HtmlBranchSession,
  type HtmlBranchSessionInput,
  type HtmlPresentationInput,
  type HtmlPresentationLimits,
  type HtmlPresentationResult,
} from './contracts';
import { renderSafeMarkdown } from './markdown';
import {
  escapeHtml,
  exactKeys,
  fail,
  hasOwn,
  isRecord,
  isSafeUserLink,
  LOWERCASE_SHA256,
  preflightJson,
  PresentationContext,
  resolveLimits,
} from './safety';

const CSS = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.55}body{margin:auto;padding:1.5rem;max-width:58rem;overflow-wrap:anywhere}article{border-top:1px solid #8887;padding:1rem 0}h1,h2,h3{line-height:1.25}h2{font-size:1.15rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#8881;padding:.8rem;border-radius:.4rem}code{font-family:ui-monospace,monospace}blockquote{border-left:3px solid #8887;margin-left:0;padding-left:1rem}img{max-width:100%;height:auto}.text{white-space:pre-wrap}.placeholder,.inert-html,.diagnostics{color:inherit;background:#8881;padding:.3rem}.inert-html{white-space:pre-wrap}header small{display:block;overflow-wrap:anywhere}figure{margin:1rem 0}figcaption{font-size:.9rem}@media print{body{max-width:none;padding:0}article,figure,pre{break-inside:avoid}a{color:inherit}header small{font-size:8pt}}`;
const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

/** Count all selected source, including hidden/unsupported payloads, before rendering any block. */
function accountSource(value: unknown, context: PresentationContext): void {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') context.source(current);
    else if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        context.source(key);
        pending.push(child);
      }
    }
  }
}

function requireSelectedPath(input: HtmlPresentationInput): string[] {
  const target = hasOwn(input, 'targetNodeId')
    ? input.targetNodeId
    : input.archive.conversation.currentNodeId;
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    !hasOwn(input.archive.graph.nodes, target)
  )
    fail('html-target-invalid');
  try {
    return getNodePath(input.archive, target);
  } catch {
    fail('html-target-invalid');
  }
}

type TechnicalBlock = Extract<
  ArchiveBlock,
  { type: 'reasoning' | 'tool_call' | 'tool_result' | 'execution_output' | 'error' }
>;

function isTechnicalBlock(block: ArchiveBlock): block is TechnicalBlock {
  return ['reasoning', 'tool_call', 'tool_result', 'execution_output', 'error'].includes(
    block.type
  );
}

function hiddenMessage(message: ArchiveMessage): boolean {
  return (
    (message.visibility !== null && message.visibility !== 'visible') ||
    (message.channel !== null && message.channel !== 'final') ||
    (message.recipient !== null && message.recipient !== 'all' && message.recipient !== 'user')
  );
}

class BlockRenderer {
  constructor(
    readonly context: PresentationContext,
    readonly parts: string[],
    readonly source: HtmlRenderSource,
    readonly bindings: Map<string, HtmlAssetBinding>,
    readonly includeToolContent: boolean
  ) {}

  emit(value: string): void {
    this.context.emit(this.parts, value);
  }
  text(value: string): void {
    this.emit(escapeHtml(value));
  }
  placeholder(label: string): void {
    this.emit('<p class="placeholder">');
    this.text(label);
    this.emit('</p>');
  }
  pre(label: string, value: string): void {
    this.emit('<section><h3>');
    this.text(label);
    this.emit('</h3><pre><code>');
    if (value.length === 0) this.context.diagnostic('block-empty');
    this.text(value);
    this.emit('</code></pre></section>');
  }

  attachment(assetId: string): void {
    const filename = this.source.assetFilenames.get(assetId);
    if (filename === null) this.context.diagnostic('attachment-name-absent');
    else if (filename === '') this.context.diagnostic('attachment-name-empty');
    const label = filename || 'Unnamed attachment';
    const binding = this.bindings.get(assetId);
    if (!binding) {
      this.context.diagnostic('attachment-unbound');
      this.placeholder(
        `Attachment reference: ${label} [local bytes are not bound to this presentation]`
      );
    } else if (binding.renderMode === 'image') {
      this.emit(
        `<figure><img src="${binding.path}" alt="${escapeHtml(label)}" loading="lazy"><figcaption>`
      );
      this.text(label);
      this.emit('</figcaption></figure>');
    } else {
      this.emit(`<p><a href="${binding.path}" download>`);
      this.text(`Download attachment: ${label}`);
      this.emit('</a></p>');
    }
  }

  citation(block: Extract<ArchiveBlock, { type: 'citation' }>): void {
    if (block.label === null) this.context.diagnostic('citation-label-absent');
    else if (block.label === '') this.context.diagnostic('citation-label-empty');
    const label = block.label ?? 'Citation';
    this.emit('<aside><p>');
    if (block.url !== null && isSafeUserLink(block.url)) {
      this.emit(`<a href="${escapeHtml(block.url)}" target="_blank" rel="noopener noreferrer">`);
      this.text(label || '[Empty citation label]');
      this.emit('</a>');
    } else {
      this.text(label || '[Empty citation label]');
      if (block.url === null) this.context.diagnostic('citation-url-absent');
      else {
        this.context.diagnostic('unsafe-link-inert');
        this.text(` [Link: ${block.url}]`);
      }
    }
    this.emit('</p>');
    if (block.content === null) this.context.diagnostic('citation-content-absent');
    else if (typeof block.content === 'string') {
      if (block.content === '') this.context.diagnostic('block-empty');
      this.emit('<p class="text">');
      this.text(block.content);
      this.emit('</p>');
    } else {
      this.context.diagnostic('citation-content-unsupported');
      this.placeholder('Structured citation content is retained in the canonical archive.');
    }
    this.emit('</aside>');
  }

  technical(block: TechnicalBlock): void {
    if (!this.includeToolContent) {
      this.context.diagnostic('technical-content-omitted');
      this.placeholder('Technical content omitted by the presentation profile.');
      return;
    }
    switch (block.type) {
      case 'reasoning':
        this.pre('Reasoning', block.text);
        break;
      case 'tool_call':
        this.pre(`Tool call (${block.toolName})`, this.context.json(block.arguments));
        break;
      case 'tool_result':
        this.pre(
          block.toolName === null ? 'Tool result' : `Tool result (${block.toolName})`,
          this.context.json(block.result)
        );
        break;
      case 'execution_output':
        this.pre('Execution output', this.context.json(block.output));
        break;
      case 'error':
        this.pre(
          block.code === null ? 'Provider error' : `Provider error (${block.code})`,
          block.message
        );
        break;
    }
  }

  plainText(value: string): void {
    if (value === '') this.context.diagnostic('block-empty');
    this.emit('<p class="text">');
    this.text(value);
    this.emit('</p>');
  }

  markdown(value: string): void {
    if (value === '') {
      this.context.diagnostic('block-empty');
      this.placeholder('Empty Markdown block.');
    } else renderSafeMarkdown(value, this.context, this.parts);
  }

  quote(block: Extract<ArchiveBlock, { type: 'quote' }>): void {
    this.emit('<blockquote>');
    this.plainText(block.text);
    if (block.attribution !== null) {
      this.emit('<footer>');
      this.text(block.attribution);
      this.emit('</footer>');
    }
    this.emit('</blockquote>');
  }

  block(block: ArchiveBlock): void {
    if (isTechnicalBlock(block)) {
      this.technical(block);
      return;
    }
    switch (block.type) {
      case 'text':
        this.plainText(block.text);
        break;
      case 'markdown':
        this.markdown(block.markdown);
        break;
      case 'html':
        this.context.diagnostic('provider-html-inert');
        this.pre('Inert provider HTML source', block.html);
        break;
      case 'code':
        this.pre(block.language === null ? 'Code' : `Code (${block.language})`, block.code);
        break;
      case 'quote':
        this.quote(block);
        break;
      case 'citation':
        this.citation(block);
        break;
      case 'attachment':
        this.attachment(block.assetId);
        break;
      case 'canvas_event':
        this.context.diagnostic('canvas-unsupported');
        this.placeholder(
          'Canvas event: presentation unsupported; retained in the canonical archive.'
        );
        break;
      case 'unknown':
        this.context.diagnostic('unknown-unsupported');
        this.placeholder(
          'Unknown provider block: presentation unsupported; retained in the canonical archive.'
        );
        break;
      default: {
        const exhaustive: never = block;
        void exhaustive;
        fail('html-archive-invalid');
      }
    }
  }
}

/** Capture own data once; later validation/use never reads the caller's get trap. */
function snapshotOwnData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail('html-input-invalid');
  const snapshot: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('html-input-invalid');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) fail('html-input-invalid');
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return snapshot;
}

function snapshotInput<T extends HtmlPresentationInput | HtmlBranchSessionInput>(
  value: T,
  branchSession: boolean
): T {
  const snapshot = snapshotOwnData(value);
  const allowed = new Set([
    'archive',
    'canonicalSha256',
    branchSession ? 'maxBranches' : 'targetNodeId',
    'profile',
    'assetBindings',
    'limits',
  ]);
  if (Object.keys(snapshot).some(key => !allowed.has(key))) fail('html-input-invalid');
  // These small configuration records contain scalars only. Retain no caller
  // Proxy for the profile or limits; the graph is intentionally not deep-cloned.
  if (isRecord(snapshot.profile)) snapshot.profile = snapshotOwnData(snapshot.profile);
  if (isRecord(snapshot.limits)) snapshot.limits = snapshotOwnData(snapshot.limits);
  return snapshot as unknown as T;
}

function requireInput<T extends HtmlPresentationInput | HtmlBranchSessionInput>(
  value: T,
  branchSession = false
): { input: T; limits: HtmlPresentationLimits } {
  // The detached limits govern the first traversal of the untrusted archive.
  const input = snapshotInput(value, branchSession);
  if (branchSession) requireMaxBranches((input as HtmlBranchSessionInput).maxBranches);
  if (input.limits !== undefined) preflightJson(input.limits, resolveLimits(undefined));
  const limits = resolveLimits(input.limits);
  preflightJson(input, limits);
  if (typeof input.canonicalSha256 !== 'string' || !LOWERCASE_SHA256.test(input.canonicalSha256))
    fail('html-canonical-digest-invalid');
  if (
    !isRecord(input.profile) ||
    !exactKeys(input.profile, ['includeToolContent']) ||
    typeof input.profile.includeToolContent !== 'boolean'
  )
    fail('html-profile-invalid');
  if (!validateLiskaThreadArchive(input.archive).valid) fail('html-archive-invalid');
  return { input, limits };
}

function accountSelectedSource(
  source: HtmlRenderSource,
  messages: readonly (ArchiveMessage | undefined)[],
  context: PresentationContext
): void {
  let blocks = 0;
  accountSource(source.title, context);
  for (const message of messages) {
    if (message) {
      blocks += message.blocks.length;
      if (blocks > context.limits.maxSelectedBlocks) fail('html-selected-block-limit');
      accountSource(message.blocks, context);
      for (const block of message.blocks) {
        if (block.type === 'attachment')
          accountSource(source.assetFilenames.get(block.assetId), context);
      }
    }
  }
}

interface HtmlRenderSource {
  title: string | null;
  assetFilenames: ReadonlyMap<string, string | null>;
}

interface HtmlRenderPreparation {
  source: HtmlRenderSource;
  limits: HtmlPresentationLimits;
  bindings: Map<string, HtmlAssetBinding>;
  includeToolContent: boolean;
  canonicalSha256: string;
  assetBindingSha256: string | null;
}

function snapshotPresentation(
  input: HtmlPresentationInput | HtmlBranchSessionInput,
  limits: HtmlPresentationLimits
): HtmlRenderPreparation {
  const finalizedBindings = validateHtmlBindings(
    input.assetBindings,
    input.archive,
    limits.maxAssetBindings
  );
  return {
    source: {
      title: input.archive.conversation.title,
      assetFilenames: new Map(
        Object.entries(input.archive.assets).map(([id, asset]) => [id, asset.filename])
      ),
    },
    limits,
    bindings: finalizedBindings.bindings,
    includeToolContent: input.profile.includeToolContent,
    canonicalSha256: input.canonicalSha256,
    assetBindingSha256: finalizedBindings.sha256,
  };
}

function prepareRenderer(
  prepared: HtmlRenderPreparation,
  messages: readonly (ArchiveMessage | undefined)[]
): BlockRenderer {
  const { limits, source, bindings, includeToolContent } = prepared;
  if (messages.length > limits.maxSelectedNodes) fail('html-selected-node-limit');
  const context = new PresentationContext(limits);
  accountSelectedSource(source, messages, context);
  const parts: string[] = [];
  const renderer = new BlockRenderer(context, parts, source, bindings, includeToolContent);
  return renderer;
}

function renderHeader(input: HtmlRenderPreparation, renderer: BlockRenderer): void {
  const { context } = renderer;
  const title = input.source.title;
  if (title === null) context.diagnostic('title-absent');
  else if (title === '') context.diagnostic('title-empty');
  renderer.emit('<!doctype html><html lang="und"><head><meta charset="utf-8">');
  renderer.emit(`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CSP)}">`);
  renderer.emit(
    '<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
  );
  renderer.text(title ?? 'Untitled archived conversation');
  renderer.emit(`</title><style>${CSS}</style></head><body><header><h1>`);
  renderer.text(
    title === null
      ? 'Untitled archived conversation'
      : title === ''
        ? '[Empty conversation title]'
        : title
  );
  renderer.emit(
    '</h1><p>This is a reading view, not a lossless backup. The canonical archive retains the full graph and original structured content.</p><small>Renderer: '
  );
  renderer.text(LISKA_HTML_RENDERER_VERSION);
  renderer.emit('</small><small>Canonical SHA-256: ');
  renderer.text(input.canonicalSha256);
  renderer.emit('</small>');
  renderer.emit('<small>Asset binding SHA-256: ');
  renderer.text(input.assetBindingSha256 ?? 'none');
  renderer.emit('</small></header><main>');
}

function renderMessages(
  messages: readonly (ArchiveMessage | undefined)[],
  renderer: BlockRenderer
): number {
  const { context } = renderer;
  let renderedMessageCount = 0;
  for (const message of messages) {
    if (!message) {
      context.diagnostic('structural-node');
      renderer.placeholder('Structural node: no message.');
      continue;
    }
    if (message.author.role !== 'user' && message.author.role !== 'assistant') {
      context.diagnostic('message-role-omitted');
      renderer.placeholder('Non-user/assistant message body omitted.');
      continue;
    }
    if (hiddenMessage(message)) {
      context.diagnostic('message-hidden-omitted');
      renderer.placeholder('Hidden or technical-channel message body omitted.');
      continue;
    }
    renderedMessageCount++;
    renderer.emit(`<article><h2>${message.author.role === 'user' ? 'User' : 'Assistant'}</h2>`);
    if (message.blocks.length === 0) {
      context.diagnostic('message-empty');
      renderer.placeholder('Empty message: no content blocks.');
    }
    for (const block of message.blocks) renderer.block(block);
    renderer.emit('</article>');
  }
  return renderedMessageCount;
}

function renderDiagnostics(renderer: BlockRenderer): void {
  renderer.emit('</main><section class="diagnostics"><h2>Presentation diagnostics</h2>');
  const diagnostics = renderer.context.diagnostics();
  if (diagnostics.length === 0) renderer.emit('<p>No presentation omissions were detected.</p>');
  else {
    renderer.emit('<ul>');
    for (const diagnostic of diagnostics) {
      renderer.emit('<li>');
      renderer.text(`${HTML_DIAGNOSTIC_LABELS[diagnostic.code]} Count: ${diagnostic.count}.`);
      renderer.emit('</li>');
    }
    renderer.emit('</ul>');
  }
  renderer.emit('</section></body></html>');
}

function renderPrepared(
  input: HtmlRenderPreparation,
  messages: readonly (ArchiveMessage | undefined)[]
): HtmlPresentationResult {
  const renderer = prepareRenderer(input, messages);
  renderHeader(input, renderer);
  const renderedMessageCount = renderMessages(messages, renderer);
  renderDiagnostics(renderer);
  return {
    schema: LISKA_HTML_SCHEMA,
    rendererVersion: LISKA_HTML_RENDERER_VERSION,
    html: renderer.parts.join(''),
    selectedNodeCount: messages.length,
    renderedMessageCount,
    diagnostics: renderer.context.diagnostics(),
    canonicalSha256: input.canonicalSha256,
    assetBindingSha256: input.assetBindingSha256,
  };
}

/** Pure, deterministic, fail-closed canonical branch presentation. Never mutates the archive. */
export function renderArchiveHtml(value: HtmlPresentationInput): HtmlPresentationResult {
  try {
    const { input, limits } = requireInput(value);
    const path = requireSelectedPath(input);
    if (path.length > limits.maxSelectedNodes) fail('html-selected-node-limit');
    const prepared = snapshotPresentation(input, limits);
    return renderPrepared(
      prepared,
      path.map(id => input.archive.graph.nodes[id].message)
    );
  } catch (error) {
    if (error instanceof HtmlPresentationError) throw error;
    // Unexpected proxy/descriptor/parser errors must never leak provider values.
    fail('html-input-invalid');
  }
}

function requireMaxBranches(value: unknown): number {
  if (value === undefined) return HTML_BRANCH_SESSION_MAX_LEAVES;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > HTML_BRANCH_SESSION_MAX_LEAVES
  )
    fail('html-limits-invalid');
  return value as number;
}

/** Validate once; retain private structure/scalars, never every rendered leaf body. */
export function prepareArchiveHtmlBranchSession(value: HtmlBranchSessionInput): HtmlBranchSession {
  try {
    const { input, limits } = requireInput(value, true);
    const prepared = snapshotPresentation(input, limits);
    return createPreparedBranchSession({
      archive: input.archive,
      maxBranches: requireMaxBranches(input.maxBranches),
      limits,
      canonicalSha256: prepared.canonicalSha256,
      assetBindingSha256: prepared.assetBindingSha256,
      renderMessages: messages => renderPrepared(prepared, messages),
    });
  } catch (error) {
    if (error instanceof HtmlPresentationError) throw error;
    fail('html-input-invalid');
  }
}
