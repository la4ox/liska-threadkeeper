import type { ArchiveBlock, ArchiveMessage, LiskaThreadArchive } from '../types';
import { getNodePath } from '../traverse';
import { validateLiskaThreadArchive } from '../validate';
import {
  LISKA_TEXT_RENDERER_VERSION,
  LISKA_TEXT_SCHEMA,
  LISKA_TEXT_PREVIEW_SCHEMA,
  LISKA_READING_PROFILE_SCHEMA,
  LISKA_TEXT_SELECTION_SCHEMA,
  TEXT_DIAGNOSTIC_LABELS,
  TEXT_PRESENTATION_LIMITS,
  TextPresentationError,
  type TextDiagnosticCode,
  type TextPresentationDiagnostic,
  type TextPresentationErrorCode,
  type TextPresentationInput,
  type TextPresentationLimits,
  type TextPresentationResult,
  type TextPresentationSelection,
  type ArchiveTextPreview,
  type TextPreviewInput,
  type TextPreviewLimits,
  type TextPreviewRow,
  type TextSelectionResult,
} from './text-contracts';
import {
  adoptArchiveTextPreview,
  resolveTextPreviewLimits,
  resolveTextPresentationSelection,
  snapshotTextPresentationSelection,
} from './text-preview-selection';

const SHA256 = /^[a-f0-9]{64}$/;
const OUTPUT_CHUNK_CHARS = 8192;

function fail(code: TextPresentationErrorCode): never {
  throw new TextPresentationError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => hasOwn(value, key));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function resolveLimits(value: unknown): TextPresentationLimits {
  const limits: TextPresentationLimits = { ...TEXT_PRESENTATION_LIMITS };
  if (value === undefined) return limits;
  if (!isRecord(value)) fail('text-limits-invalid');
  for (const key of Object.keys(value)) {
    if (!hasOwn(limits, key)) fail('text-limits-invalid');
    const field = key as keyof TextPresentationLimits;
    const number = value[key];
    if (
      !Number.isSafeInteger(number) ||
      (number as number) <= 0 ||
      (number as number) > limits[field]
    )
      fail('text-limits-invalid');
    limits[field] = number as number;
  }
  return limits;
}

interface JsonFrame {
  value: unknown;
  depth: number;
  leave?: boolean;
}

/** Iterative hostile-input preflight: never invokes getters, toJSON, or caller code. */
// eslint-disable-next-line complexity -- Each JSON primitive/container rejection is an explicit fail-closed branch.
function preflightJson(value: unknown, limits: TextPresentationLimits): void {
  const active = new Set<object>();
  const stack: JsonFrame[] = [{ value, depth: 0 }];
  let nodes = 0;
  let scheduled = 1;
  let chars = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.leave) {
      active.delete(frame.value as object);
      continue;
    }
    if (++nodes > limits.maxInputJsonNodes) fail('text-input-node-limit');
    if (frame.depth > limits.maxInputJsonDepth) fail('text-input-depth-limit');
    const current = frame.value;
    if (typeof current === 'string') chars += current.length;
    else if (current !== null && typeof current === 'object') {
      const array = Array.isArray(current);
      if (
        (array && Object.getPrototypeOf(current) !== Array.prototype) ||
        (!array && !isRecord(current)) ||
        active.has(current)
      )
        fail('text-input-invalid');
      active.add(current);
      stack.push({ value: current, depth: frame.depth, leave: true });
      const keys = Reflect.ownKeys(current);
      scheduled += keys.length - (array ? 1 : 0);
      if (scheduled > limits.maxInputJsonNodes) fail('text-input-node-limit');
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (typeof key !== 'string') fail('text-input-invalid');
        if (array && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        if (!descriptor.enumerable || !hasOwn(descriptor, 'value')) fail('text-input-invalid');
        if (array && !/^(0|[1-9]\d*)$/.test(key)) fail('text-input-invalid');
        chars += key.length;
        stack.push({ value: descriptor.value, depth: frame.depth + 1 });
      }
      if (array && Object.keys(current).length !== current.length) fail('text-input-invalid');
    } else if (
      current !== null &&
      typeof current !== 'boolean' &&
      !(typeof current === 'number' && Number.isFinite(current))
    )
      fail('text-input-invalid');
    if (chars > limits.maxInputChars) fail('text-input-char-limit');
  }
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail('text-input-invalid');
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('text-input-invalid');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) fail('text-input-invalid');
    result[key] = descriptor.value;
  }
  return result;
}

function requireInput(value: TextPresentationInput): {
  input: TextPresentationInput;
  limits: TextPresentationLimits;
} {
  const snapshot = snapshotRecord(value);
  if (
    Object.keys(snapshot).some(
      key => !['archive', 'canonicalSha256', 'targetNodeId', 'profile', 'limits'].includes(key)
    )
  )
    fail('text-input-invalid');
  if (isRecord(snapshot.profile)) snapshot.profile = snapshotRecord(snapshot.profile);
  if (isRecord(snapshot.limits)) snapshot.limits = snapshotRecord(snapshot.limits);
  const input = snapshot as unknown as TextPresentationInput;
  if (input.limits !== undefined) preflightJson(input.limits, resolveLimits(undefined));
  const limits = resolveLimits(input.limits);
  preflightJson(input, limits);
  if (typeof input.canonicalSha256 !== 'string' || !SHA256.test(input.canonicalSha256))
    fail('text-canonical-digest-invalid');
  if (
    !isRecord(input.profile) ||
    !exactKeys(input.profile, ['includeToolContent']) ||
    typeof input.profile.includeToolContent !== 'boolean'
  )
    fail('text-profile-invalid');
  if (!validateLiskaThreadArchive(input.archive).valid) fail('text-archive-invalid');
  return { input, limits };
}

function selectedPath(input: TextPresentationInput): string[] {
  const target = hasOwn(input, 'targetNodeId')
    ? input.targetNodeId
    : input.archive.conversation.currentNodeId;
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    !hasOwn(input.archive.graph.nodes, target)
  )
    fail('text-target-invalid');
  try {
    return getNodePath(input.archive, target);
  } catch {
    fail('text-target-invalid');
  }
}

function hiddenMessage(message: ArchiveMessage): boolean {
  return (
    (message.visibility !== null && message.visibility !== 'visible') ||
    (message.channel !== null && message.channel !== 'final') ||
    (message.recipient !== null && message.recipient !== 'all' && message.recipient !== 'user')
  );
}

class TextRenderer {
  private readonly parts: string[] = [];
  private readonly pending: string[] = [];
  private pendingChars = 0;
  private outputChars = 0;
  private outputBytes = 0;
  private sourceChars = 0;
  private serializationChars = 0;
  private readonly counts = new Map<TextDiagnosticCode, number>();

  constructor(
    readonly limits: TextPresentationLimits,
    readonly archive: LiskaThreadArchive | undefined,
    readonly includeToolContent: boolean,
    private readonly onEmit?: (value: string) => void
  ) {}

  emit(value: string): void {
    if (value.length === 0) return;
    this.outputChars += value.length;
    this.outputBytes += utf8ByteLength(value);
    if (this.outputChars > this.limits.maxTextChars || this.outputBytes > this.limits.maxTextBytes)
      fail('text-output-limit');
    this.onEmit?.(value);
    this.pending.push(value);
    this.pendingChars += value.length;
    if (this.pendingChars >= OUTPUT_CHUNK_CHARS) this.flush();
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    // Nonempty fragments bound this array by chunk size, not physical line count.
    this.parts.push(this.pending.join(''));
    this.pending.length = 0;
    this.pendingChars = 0;
  }

  text(): string {
    this.flush();
    return this.parts.join('');
  }

  /** Drain a detached row while preserving aggregate output/source/JSON budgets. */
  takeText(): string {
    const result = this.text();
    this.parts.length = 0;
    return result;
  }

  source(value: string): void {
    this.sourceChars += value.length;
    if (this.sourceChars > this.limits.maxSourceChars) fail('text-source-char-limit');
  }

  diagnostic(code: TextDiagnosticCode): void {
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1);
  }

  diagnostics(): TextPresentationDiagnostic[] {
    return [...this.counts]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([code, count]) => ({ code, count }));
  }

  takeDiagnostics(): TextPresentationDiagnostic[] {
    const result = this.diagnostics();
    this.counts.clear();
    return result;
  }

  openSection(label: string): void {
    this.emit(`[${label}]\n`);
  }

  closeSection(label: string): void {
    this.emit(`[END ${label}]\n\n`);
  }

  placeholder(label: string): void {
    this.openSection(label);
    this.closeSection(label);
  }

  /**
   * Prefix every physical source line. All recognized line separators become LF
   * in this replaceable view; the canonical archive retains the exact string.
   * Emitting incrementally keeps prefix expansion inside the normal output budget.
   */
  framed(value: string): void {
    let start = 0;
    this.emit('│ ');
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char !== '\n' && char !== '\r' && char !== '\u2028' && char !== '\u2029') continue;
      this.emit(value.slice(start, index));
      this.emit('\n│ ');
      if (char === '\r' && value[index + 1] === '\n') index += 1;
      start = index + 1;
    }
    this.emit(value.slice(start));
    this.emit('\n');
  }

  sourceField(label: string, value: string): void {
    this.openSection(label);
    this.framed(value);
  }

  sourceSection(label: string, value: string): void {
    this.sourceField(label, value);
    this.closeSection(label);
  }

  json(value: unknown): string {
    let result: string;
    try {
      result = JSON.stringify(value);
    } catch {
      fail('text-input-invalid');
    }
    this.serializationChars += result.length;
    if (this.serializationChars > this.limits.maxJsonSerializationChars)
      fail('text-json-serialization-limit');
    return result;
  }

  content(label: string, value: string): void {
    if (value.length === 0) this.diagnostic('block-empty');
    this.sourceSection(label, value);
  }

  technical(
    block: Extract<
      ArchiveBlock,
      { type: 'reasoning' | 'tool_call' | 'tool_result' | 'execution_output' | 'error' }
    >
  ): void {
    if (!this.includeToolContent) {
      this.diagnostic('technical-content-omitted');
      this.placeholder('TECHNICAL CONTENT OMITTED BY PROFILE');
      return;
    }
    if (block.type === 'reasoning') this.content('REASONING SOURCE', block.text);
    else if (block.type === 'tool_call') {
      this.openSection('TOOL CALL SOURCE');
      this.sourceField('TOOL NAME', block.toolName);
      this.sourceField('ARGUMENTS JSON', this.json(block.arguments));
      this.closeSection('TOOL CALL SOURCE');
    } else if (block.type === 'tool_result') {
      this.openSection('TOOL RESULT SOURCE');
      if (block.toolName === null) this.emit('[TOOL NAME UNSPECIFIED]\n');
      else this.sourceField('TOOL NAME', block.toolName);
      this.sourceField('RESULT JSON', this.json(block.result));
      this.closeSection('TOOL RESULT SOURCE');
    } else if (block.type === 'execution_output')
      this.content('EXECUTION OUTPUT SOURCE', this.json(block.output));
    else {
      this.openSection('PROVIDER ERROR SOURCE');
      if (block.code === null) this.emit('[ERROR CODE UNSPECIFIED]\n');
      else this.sourceField('ERROR CODE', block.code);
      if (block.message.length === 0) this.diagnostic('block-empty');
      this.sourceField('ERROR MESSAGE', block.message);
      this.closeSection('PROVIDER ERROR SOURCE');
    }
  }

  // eslint-disable-next-line complexity, max-lines-per-function -- Ordered block semantics stay visible in one exhaustive dispatcher.
  block(block: ArchiveBlock): void {
    if (
      ['reasoning', 'tool_call', 'tool_result', 'execution_output', 'error'].includes(block.type)
    ) {
      this.technical(
        block as Extract<
          ArchiveBlock,
          { type: 'reasoning' | 'tool_call' | 'tool_result' | 'execution_output' | 'error' }
        >
      );
      return;
    }
    switch (block.type) {
      case 'text':
        this.content('TEXT', block.text);
        break;
      case 'markdown':
        this.content('MARKDOWN SOURCE', block.markdown);
        break;
      case 'html':
        this.diagnostic('provider-html-inert');
        this.content('INERT PROVIDER HTML SOURCE', block.html);
        break;
      case 'code':
        this.openSection('CODE SOURCE');
        if (block.language === null) this.emit('[LANGUAGE UNSPECIFIED]\n');
        else this.sourceField('LANGUAGE', block.language);
        if (block.code.length === 0) this.diagnostic('block-empty');
        this.sourceField('CODE CONTENT', block.code);
        this.closeSection('CODE SOURCE');
        break;
      case 'quote':
        this.content('QUOTE', block.text);
        if (block.attribution !== null) this.content('QUOTE ATTRIBUTION', block.attribution);
        break;
      case 'citation': {
        if (block.label === null) this.diagnostic('citation-label-absent');
        else if (block.label === '') this.diagnostic('citation-label-empty');
        if (block.url === null) this.diagnostic('citation-url-absent');
        this.openSection('CITATION');
        if (block.label === null) this.emit('[LABEL ABSENT]\n');
        else this.sourceField('LABEL', block.label);
        if (block.url === null) this.emit('[URL ABSENT]\n');
        else this.sourceField('URL', block.url);
        if (block.content === null) {
          this.diagnostic('citation-content-absent');
          this.emit('[CONTENT ABSENT]\n');
        } else if (typeof block.content === 'string') {
          if (block.content === '') this.diagnostic('block-empty');
          this.sourceField('CONTENT', block.content);
        } else {
          this.diagnostic('citation-content-unsupported');
          this.emit('[STRUCTURED CONTENT RETAINED IN CANONICAL ARCHIVE]\n');
        }
        this.closeSection('CITATION');
        break;
      }
      case 'attachment': {
        const filename = this.archive?.assets[block.assetId]?.filename;
        if (filename === null || filename === undefined) this.diagnostic('attachment-name-absent');
        else if (filename === '') this.diagnostic('attachment-name-empty');
        this.openSection('ATTACHMENT REFERENCE');
        if (filename === null || filename === undefined) this.emit('[FILENAME ABSENT]\n');
        else this.sourceField('FILENAME', filename);
        this.emit('[BYTES NOT EMBEDDED; CONSULT THE CANONICAL ARCHIVE]\n');
        this.closeSection('ATTACHMENT REFERENCE');
        break;
      }
      case 'canvas_event':
        this.diagnostic('canvas-unsupported');
        this.placeholder('CANVAS EVENT RETAINED IN CANONICAL ARCHIVE');
        break;
      case 'unknown':
        this.diagnostic('unknown-unsupported');
        this.openSection('UNKNOWN PROVIDER BLOCK');
        this.sourceField('PROVIDER TYPE', block.providerType);
        this.emit('[RAW CONTENT RETAINED IN CANONICAL ARCHIVE]\n');
        this.closeSection('UNKNOWN PROVIDER BLOCK');
        break;
      default: {
        fail('text-archive-invalid');
      }
    }
  }
}

function accountSource(value: unknown, renderer: TextRenderer): void {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') renderer.source(current);
    else if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        renderer.source(key);
        pending.push(child);
      }
    }
  }
}

function renderHeader(input: TextPresentationInput, renderer: TextRenderer): void {
  const title = input.archive.conversation.title;
  if (title === null) renderer.diagnostic('title-absent');
  else if (title === '') renderer.diagnostic('title-empty');
  renderer.emit('LISKA CANONICAL TEXT READING VIEW\n=================================\n\n');
  if (title === null) renderer.emit('[TITLE ABSENT]\n');
  else renderer.sourceField('TITLE', title);
  renderer.emit(`Renderer: ${LISKA_TEXT_RENDERER_VERSION}\n`);
  renderer.emit(`Canonical SHA-256: ${input.canonicalSha256}\n`);
  renderer.emit(
    'Notice: This is a replaceable reading view, not archive authority. Raw, manifest, and canonical artifacts retain the archival evidence for this capture.\n'
  );
  renderer.emit(
    'Framing note: Every canonical-controlled source and metadata line is prefixed with "│ ". CRLF, lone CR, LF, U+2028, and U+2029 separators are normalized to LF in this replaceable reading view; the canonical archive retains the exact strings. Unprefixed labels and delimiters are structural reading aids, not a machine-readable format or authenticity boundary.\n\n'
  );
}

function renderMessages(
  messages: readonly (ArchiveMessage | undefined)[],
  renderer: TextRenderer
): number {
  let rendered = 0;
  let visibleOrdinal = 0;
  for (const message of messages) {
    if (!message) {
      renderer.diagnostic('structural-node');
      renderer.placeholder('STRUCTURAL NODE | NO MESSAGE');
      continue;
    }
    if (message.author.role !== 'user' && message.author.role !== 'assistant') {
      renderer.diagnostic('message-role-omitted');
      renderer.placeholder('NON-USER/ASSISTANT MESSAGE BODY OMITTED');
      continue;
    }
    if (hiddenMessage(message)) {
      renderer.diagnostic('message-hidden-omitted');
      renderer.placeholder('HIDDEN OR TECHNICAL-CHANNEL MESSAGE BODY OMITTED');
      continue;
    }
    rendered += 1;
    visibleOrdinal += 1;
    renderer.emit(`--- MESSAGE ${visibleOrdinal}: ${message.author.role.toUpperCase()} ---\n\n`);
    renderMessageBody(message, renderer);
  }
  return rendered;
}

function renderMessageBody(message: ArchiveMessage, renderer: TextRenderer): void {
  if (message.blocks.length === 0) {
    renderer.diagnostic('message-empty');
    renderer.placeholder('EMPTY MESSAGE | NO CONTENT BLOCKS');
  }
  for (const block of message.blocks) renderer.block(block);
}

function accountMessages(
  input: TextPresentationInput,
  messages: readonly (ArchiveMessage | undefined)[],
  renderer: TextRenderer
): void {
  let blocks = 0;
  accountSource(input.archive.conversation.title, renderer);
  for (const message of messages) {
    if (!message) continue;
    blocks += message.blocks.length;
    if (blocks > renderer.limits.maxSelectedBlocks) fail('text-selected-block-limit');
    accountSource(message.blocks, renderer);
    for (const block of message.blocks)
      if (block.type === 'attachment')
        accountSource(input.archive.assets[block.assetId]?.filename, renderer);
  }
}

function renderDiagnostics(renderer: TextRenderer): void {
  renderer.emit('=== PRESENTATION DIAGNOSTICS ===\n');
  const diagnostics = renderer.diagnostics();
  if (diagnostics.length === 0) renderer.emit('No presentation omissions were detected.\n');
  else
    for (const diagnostic of diagnostics)
      renderer.emit(`- ${TEXT_DIAGNOSTIC_LABELS[diagnostic.code]} Count: ${diagnostic.count}.\n`);
}

/** Pure deterministic canonical-branch renderer. It never reads Markdown output or the network. */
export function renderArchiveText(value: TextPresentationInput): TextPresentationResult {
  try {
    const { input, limits } = requireInput(value);
    const path = selectedPath(input);
    if (path.length > limits.maxSelectedNodes) fail('text-selected-node-limit');
    const messages = path.map(id => input.archive.graph.nodes[id].message);
    const renderer = new TextRenderer(limits, input.archive, input.profile.includeToolContent);
    accountMessages(input, messages, renderer);
    renderHeader(input, renderer);
    const renderedMessageCount = renderMessages(messages, renderer);
    renderDiagnostics(renderer);
    return {
      schema: LISKA_TEXT_SCHEMA,
      rendererVersion: LISKA_TEXT_RENDERER_VERSION,
      text: renderer.text(),
      selectedNodeCount: messages.length,
      renderedMessageCount,
      diagnostics: renderer.diagnostics(),
      canonicalSha256: input.canonicalSha256,
    };
  } catch (error) {
    if (error instanceof TextPresentationError) throw error;
    fail('text-input-invalid');
  }
}

function prepareTextRows(
  input: TextPresentationInput,
  limits: TextPresentationLimits,
  path: readonly string[],
  previewLimits: TextPreviewLimits,
  onRow?: (nodeId: string, diagnostics: TextPresentationDiagnostic[]) => void
): TextPreviewRow[] {
  const title = input.archive.conversation.title;
  let totalChars =
    path[path.length - 1].length + input.canonicalSha256.length + (title?.length ?? 0);
  if (totalChars > previewLimits.maxTotalChars) fail('text-preview-total-char-limit');
  let rowChars = 0;
  const renderer = new TextRenderer(
    limits,
    input.archive,
    input.profile.includeToolContent,
    part => {
      rowChars += part.length;
      totalChars += part.length;
      if (rowChars > previewLimits.maxRowChars) fail('text-preview-row-char-limit');
      if (totalChars > previewLimits.maxTotalChars) fail('text-preview-total-char-limit');
    }
  );
  const messages = path.map(id => input.archive.graph.nodes[id].message);
  accountMessages(input, messages, renderer);
  const rows: TextPreviewRow[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const message = messages[index];
    if (
      !message ||
      (message.author.role !== 'user' && message.author.role !== 'assistant') ||
      hiddenMessage(message)
    )
      continue;
    if (rows.length >= previewLimits.maxRows) fail('text-preview-row-limit');
    totalChars += path[index].length;
    if (totalChars > previewLimits.maxTotalChars) fail('text-preview-total-char-limit');
    rowChars = 0;
    renderMessageBody(message, renderer);
    rows.push({
      nodeId: path[index],
      role: message.author.role,
      presentedText: renderer.takeText(),
    });
    onRow?.(path[index], renderer.takeDiagnostics());
  }
  return rows;
}

/** Prepare one validated branch without retaining any canonical objects. */
export function prepareArchiveTextPreview(value: TextPreviewInput): ArchiveTextPreview {
  return prepareTextPreviewWithDiagnostics(value).preview;
}

/** @internal Same Text bytes with row-local diagnostics for the richer projection. */
export function prepareTextPreviewWithDiagnostics(value: TextPreviewInput): {
  preview: ArchiveTextPreview;
  diagnostics: ReadonlyMap<string, TextPresentationDiagnostic[]>;
} {
  try {
    const snapshot = snapshotRecord(value);
    const previewLimits = resolveTextPreviewLimits(snapshot.previewLimits);
    delete snapshot.previewLimits;
    const { input, limits } = requireInput(snapshot as unknown as TextPresentationInput);
    const path = selectedPath(input);
    if (path.length > limits.maxSelectedNodes) fail('text-selected-node-limit');
    const title = input.archive.conversation.title;
    if (title !== null && title.length > previewLimits.maxTitleChars)
      fail('text-preview-title-char-limit');
    const diagnostics = new Map<string, TextPresentationDiagnostic[]>();
    const rows = prepareTextRows(input, limits, path, previewLimits, (id, items) =>
      diagnostics.set(id, items)
    );
    const preview = adoptArchiveTextPreview(
      {
        schema: LISKA_TEXT_PREVIEW_SCHEMA,
        sourceCanonicalSha256: input.canonicalSha256,
        branchTargetNodeId: path[path.length - 1],
        title,
        profile: {
          schema: LISKA_READING_PROFILE_SCHEMA,
          includeToolContent: input.profile.includeToolContent,
        },
        rows,
      },
      previewLimits
    );
    return { preview, diagnostics };
  } catch (error) {
    if (error instanceof TextPresentationError) throw error;
    fail('text-input-invalid');
  }
}

function renderTextSelectionHeader(
  preview: ArchiveTextPreview,
  selection: TextPresentationSelection,
  renderer: TextRenderer
): void {
  renderer.emit('LISKA SELECTED TEXT READING VIEW\n================================\n\n');
  if (preview.title === null) renderer.emit('[TITLE ABSENT]\n');
  else renderer.sourceField('TITLE', preview.title);
  renderer.emit(`Renderer: ${LISKA_TEXT_RENDERER_VERSION}\n`);
  renderer.emit(`Selection schema: ${selection.schema}\n`);
  renderer.emit(`Canonical SHA-256: ${selection.sourceCanonicalSha256}\n`);
  renderer.sourceField('BRANCH TARGET NODE ID', selection.branchTargetNodeId);
  renderer.emit(`Reading profile: ${selection.profile.schema}\n`);
  renderer.emit(`Include tool content: ${selection.profile.includeToolContent}\n`);
  renderer.emit(
    `Selected messages: ${selection.messageNodeIds.length} of ${preview.rows.length}\n`
  );
  renderer.emit(
    'Notice: This selected reading view is an explicit excerpt, not a complete branch or archive authority.\n'
  );
  renderer.emit(
    'Framing note: Canonical-controlled source and metadata lines are prefixed with "│ "; line separators are normalized to LF. Unprefixed labels are structural reading aids, not an authenticity boundary.\n\n'
  );
}

/** Render only the explicit selected rows, never the original archive or a search result. */
export function renderTextSelection(
  preview: ArchiveTextPreview,
  value: unknown,
  limitOverrides?: Partial<TextPresentationLimits>
): TextSelectionResult {
  try {
    const selection = snapshotTextPresentationSelection(preview, value);
    const rows = resolveTextPresentationSelection(preview, selection);
    const limits = resolveLimits(
      limitOverrides === undefined ? undefined : snapshotRecord(limitOverrides)
    );
    const renderer = new TextRenderer(limits, undefined, selection.profile.includeToolContent);
    accountSource(preview.title, renderer);
    renderer.source(selection.branchTargetNodeId);
    for (const row of rows) {
      renderer.source(row.nodeId);
      renderer.source(row.presentedText);
    }
    renderTextSelectionHeader(preview, selection, renderer);
    rows.forEach((row, index) => {
      renderer.emit(`--- SELECTED MESSAGE ${index + 1}: ${row.role.toUpperCase()} ---\n\n`);
      renderer.sourceField('MESSAGE NODE ID', row.nodeId);
      renderer.emit(row.presentedText);
    });
    return Object.freeze({
      schema: LISKA_TEXT_SELECTION_SCHEMA,
      rendererVersion: LISKA_TEXT_RENDERER_VERSION,
      text: renderer.text(),
      selection,
      availableMessageCount: preview.rows.length,
      renderedMessageCount: rows.length,
    });
  } catch (error) {
    if (error instanceof TextPresentationError) throw error;
    fail('text-input-invalid');
  }
}
