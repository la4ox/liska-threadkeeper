import {
  CHATGPT_OFFICIAL_HARD_LIMITS,
  CHATGPT_OFFICIAL_MULTI_HARD_LIMITS,
  ChatGptOfficialSelectionError,
  type ChatGptOfficialConversationSource,
  type ChatGptOfficialConversationSelection,
  type ChatGptOfficialSelectionErrorCode,
  type ChatGptOfficialSelectionLimits,
  type SelectChatGptOfficialConversationInput,
  type SelectChatGptOfficialConversationSourcesInput,
} from './contracts';

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const KEY_DECODER = new TextDecoder('utf-8', { fatal: true });
type RootState = 'start' | 'first-entry' | 'entry' | 'separator' | 'end';
type Selection = Omit<ChatGptOfficialConversationSelection, 'sourceByteLength'>;
interface ContainerFrame {
  closer: number;
  keys: Set<string> | null;
  expectKey: boolean;
}

interface SelectionLedger {
  ids: Set<string>;
  conversationCount: number;
  ignoredEmptyRecordCount: number;
}

interface AggregateLedger {
  sourceByteLength: number;
}

const INTERNAL_SELECTION_ERRORS = new WeakSet<object>();

function fail(code: ChatGptOfficialSelectionErrorCode): never {
  const error = new ChatGptOfficialSelectionError(code);
  INTERNAL_SELECTION_ERRORS.add(error);
  throw error;
}

function internalSelectionError(error: unknown): error is ChatGptOfficialSelectionError {
  return typeof error === 'object' && error !== null && INTERNAL_SELECTION_ERRORS.has(error);
}

/** Private-module trust check used by the importer without invoking caller prototypes. */
export function isOwnedChatGptOfficialSelectionError(
  error: unknown
): error is ChatGptOfficialSelectionError {
  return internalSelectionError(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && PORTABLE_ID.test(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function numericLimits<T extends Record<string, number>>(overrides: unknown, hard: T): T {
  if (overrides !== undefined && !isPlainObject(overrides)) fail('invalid-input');
  const limits = { ...hard };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!hasOwn(limits, key)) fail('invalid-input');
    const name = key as keyof T;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[name]
    )
      fail('invalid-input');
    limits[name] = value as T[keyof T];
  }
  return limits;
}

function validChunks(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function'
  );
}

function resolveSingleInput(input: SelectChatGptOfficialConversationInput) {
  if (!isPlainObject(input) || !validId(input.conversationId) || !validChunks(input.chunks))
    fail('invalid-input');
  return {
    conversationId: input.conversationId,
    chunks: input.chunks,
    limits: numericLimits(input.limits, { ...CHATGPT_OFFICIAL_HARD_LIMITS }),
  };
}

function arrayValues(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < 1) fail('invalid-input');
  if (value.length > maximum) fail('source-count-limit');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string') || keys.length !== value.length + 1)
    fail('invalid-input');
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) fail('invalid-input');
    return descriptor.value;
  });
}

function sourceDescriptor(value: unknown): ChatGptOfficialConversationSource {
  if (!isPlainObject(value)) fail('invalid-input');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some(key => typeof key !== 'string' || !['shardIndex', 'chunks'].includes(key))
  )
    fail('invalid-input');
  const shard = Object.getOwnPropertyDescriptor(value, 'shardIndex');
  const chunks = Object.getOwnPropertyDescriptor(value, 'chunks');
  if (!shard || !('value' in shard) || !chunks || !('value' in chunks)) fail('invalid-input');
  if (!Number.isSafeInteger(shard.value) || shard.value < 0 || shard.value > 999)
    fail('invalid-input');
  if (!validChunks(chunks.value)) fail('invalid-input');
  return { shardIndex: shard.value as number, chunks: chunks.value };
}

function resolveMultiInput(input: SelectChatGptOfficialConversationSourcesInput) {
  if (!isPlainObject(input) || !validId(input.conversationId)) fail('invalid-input');
  const limits = numericLimits(input.limits, { ...CHATGPT_OFFICIAL_MULTI_HARD_LIMITS });
  const sources = arrayValues(input.sources, limits.maxSources).map(sourceDescriptor);
  const seen = new Set<number>();
  for (const source of sources) {
    if (seen.has(source.shardIndex)) fail('invalid-input');
    seen.add(source.shardIndex);
  }
  sources.sort((left, right) => left.shardIndex - right.shardIndex);
  const selectionLimits: ChatGptOfficialSelectionLimits = {
    maxSourceBytes: limits.maxSourceBytes,
    maxConversationBytes: limits.maxConversationBytes,
    maxConversations: limits.maxConversations,
    maxDepth: limits.maxDepth,
  };
  return { conversationId: input.conversationId, sources, limits: selectionLimits };
}

/** One reusable current-object buffer. Clearing erases unrelated bytes before reuse. */
class ConversationBuffer {
  private bytes = new Uint8Array(0);
  length = 0;

  constructor(private readonly maximum: number) {}

  append(byte: number): void {
    if (this.length === this.maximum) fail('conversation-limit');
    if (this.length === this.bytes.length) {
      const capacity = Math.min(this.maximum, Math.max(1024, this.bytes.length * 2));
      const grown = new Uint8Array(capacity);
      grown.set(this.bytes);
      this.bytes.fill(0);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }

  view(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }

  clear(): void {
    this.bytes.fill(0, 0, this.length);
    this.length = 0;
  }
}

/** Streaming UTF-8 validation does not construct or retain decoded source text. */
class Utf8Validator {
  private remaining = 0;
  private minimum = 0x80;
  private maximum = 0xbf;

  accept(byte: number): void {
    if (this.remaining > 0) {
      if (byte < this.minimum || byte > this.maximum) fail('invalid-utf8');
      this.remaining--;
      this.minimum = 0x80;
      this.maximum = 0xbf;
      return;
    }
    if (byte <= 0x7f) return;
    if (byte >= 0xc2 && byte <= 0xdf) this.remaining = 1;
    else if (byte >= 0xe0 && byte <= 0xef) this.remaining = 2;
    else if (byte >= 0xf0 && byte <= 0xf4) this.remaining = 3;
    else fail('invalid-utf8');
    if (byte === 0xe0) this.minimum = 0xa0;
    if (byte === 0xed) this.maximum = 0x9f;
    if (byte === 0xf0) this.minimum = 0x90;
    if (byte === 0xf4) this.maximum = 0x8f;
  }

  finish(): void {
    if (this.remaining !== 0) fail('invalid-utf8');
  }
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function decodedJsonKey(bytes: Uint8Array, start: number): string | null {
  try {
    const token = KEY_DECODER.decode(bytes.subarray(start));
    const key: unknown = JSON.parse(token);
    return typeof key === 'string' ? key : null;
  } catch {
    // The full object is parsed after its exact byte span closes.
    return null;
  }
}

function conversationIdentity(value: unknown): string {
  if (!isPlainObject(value)) fail('invalid-root');
  const hasId = hasOwn(value, 'id');
  const hasAlias = hasOwn(value, 'conversation_id');
  if (!hasId && !hasAlias) fail('malformed-id');
  if ((hasId && !validId(value.id)) || (hasAlias && !validId(value.conversation_id))) {
    fail('malformed-id');
  }
  if (hasId && hasAlias && value.id !== value.conversation_id) fail('malformed-id');
  requireMapping(value);
  return (hasId ? value.id : value.conversation_id) as string;
}

function requireMapping(value: Record<string, unknown>): void {
  if (!hasOwn(value, 'mapping') || !isPlainObject(value.mapping)) fail('invalid-mapping');
  if (Object.keys(value.mapping).length === 0) fail('invalid-mapping');
}

class ConversationScanner {
  private readonly buffer: ConversationBuffer;
  private readonly utf8 = new Utf8Validator();
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private root: RootState = 'start';
  private readonly prefix: number[] = [];
  private prefixResolved = false;
  private readonly stack: ContainerFrame[] = [];
  private inString = false;
  private escaped = false;
  private keyStart: number | null = null;
  private conversationCount = 0;
  private byteStart = 0;
  private selected: Selection | null = null;

  constructor(
    private readonly expectedId: string,
    private readonly limits: ChatGptOfficialSelectionLimits,
    private readonly ledger: SelectionLedger,
    private readonly shardIndex?: number
  ) {
    this.buffer = new ConversationBuffer(limits.maxConversationBytes);
  }

  accept(byte: number, offset: number): void {
    this.utf8.accept(byte);
    if (this.prefixResolved) return this.scan(byte, offset);
    this.prefix.push(byte);
    if (
      this.prefix[0] === 0xef &&
      (this.prefix.length === 1 || (this.prefix.length === 2 && this.prefix[1] === 0xbb))
    ) {
      return;
    }
    if (this.prefix[0] === 0xef && this.prefix[1] === 0xbb && this.prefix[2] === 0xbf) {
      fail('bom-not-supported');
    }
    this.prefixResolved = true;
    this.prefix.forEach((value, index) => this.scan(value, index));
    this.prefix.length = 0;
  }

  private scan(byte: number, offset: number): void {
    if (this.stack.length > 0) return this.scanObject(byte, offset);
    if (isWhitespace(byte)) return;
    if (this.root === 'start') {
      if (byte !== 0x5b) fail('invalid-root');
      this.root = 'first-entry';
      return;
    }
    if (this.root === 'end') fail('invalid-json');
    if (this.root === 'separator') {
      if (byte !== 0x2c && byte !== 0x5d) fail('invalid-json');
      this.root = byte === 0x2c ? 'entry' : 'end';
      return;
    }
    if (byte === 0x5d && this.root === 'first-entry') {
      this.root = 'end';
      return;
    }
    if (byte === 0x5d) fail('invalid-json');
    if (byte !== 0x7b) fail('invalid-root');
    this.startObject(offset);
  }

  private startObject(offset: number): void {
    if (this.ledger.conversationCount === this.limits.maxConversations)
      fail('conversation-count-limit');
    if (this.limits.maxDepth < 2) fail('depth-limit');
    this.ledger.conversationCount++;
    this.conversationCount++;
    this.byteStart = offset;
    this.stack.push({ closer: 0x7d, keys: new Set(), expectKey: true });
    this.buffer.append(0x7b);
  }

  private scanObject(byte: number, offset: number): void {
    this.buffer.append(byte);
    if (this.inString) return this.scanString(byte);
    if (this.startString(byte)) return;
    if (this.openContainer(byte)) return;
    if (this.closeContainer(byte, offset + 1)) return;
    if (byte === 0x2c) {
      const frame = this.stack[this.stack.length - 1];
      if (frame?.keys !== null) frame.expectKey = true;
    }
  }

  private startString(byte: number): boolean {
    if (byte !== 0x22) return false;
    this.inString = true;
    const frame = this.stack[this.stack.length - 1];
    if (frame?.keys !== null && frame?.expectKey) this.keyStart = this.buffer.length - 1;
    return true;
  }

  private openContainer(byte: number): boolean {
    if (byte !== 0x7b && byte !== 0x5b) return false;
    if (this.stack.length + 2 > this.limits.maxDepth) fail('depth-limit');
    this.stack.push(
      byte === 0x7b
        ? { closer: 0x7d, keys: new Set(), expectKey: true }
        : { closer: 0x5d, keys: null, expectKey: false }
    );
    return true;
  }

  private closeContainer(byte: number, byteEndExclusive: number): boolean {
    if (byte !== 0x7d && byte !== 0x5d) return false;
    if (this.stack.pop()?.closer !== byte) fail('invalid-json');
    if (this.stack.length === 0) this.closeObject(byteEndExclusive);
    return true;
  }

  private scanString(byte: number): void {
    if (this.escaped) {
      this.escaped = false;
      return;
    }
    if (byte === 0x5c) {
      this.escaped = true;
      return;
    }
    if (byte !== 0x22) return;
    this.inString = false;
    if (this.keyStart === null) return;
    const frame = this.stack[this.stack.length - 1];
    const key = decodedJsonKey(this.buffer.view(), this.keyStart);
    if (frame?.keys !== null && key !== null) {
      if (frame.keys.has(key)) {
        const duplicateIdentity =
          this.stack.length === 1 && (key === 'id' || key === 'conversation_id');
        fail(duplicateIdentity ? 'duplicate-id' : 'duplicate-key');
      }
      frame.keys.add(key);
      frame.expectKey = false;
    }
    this.keyStart = null;
  }

  private closeObject(byteEndExclusive: number): void {
    try {
      let text: string;
      try {
        text = this.decoder.decode(this.buffer.view());
      } catch {
        fail('invalid-utf8');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        fail('invalid-json');
      }
      if (isPlainObject(parsed) && Object.keys(parsed).length === 0) {
        this.ledger.ignoredEmptyRecordCount += 1;
        this.root = 'separator';
        return;
      }
      const id = conversationIdentity(parsed);
      if (this.ledger.ids.has(id)) fail('duplicate-id');
      this.ledger.ids.add(id);
      if (id === this.expectedId) {
        const conversationIndex = this.conversationCount - 1;
        this.selected = {
          bytes: this.buffer.view().slice(),
          conversationId: id,
          conversationIndex,
          sourcePointer: `/${conversationIndex}`,
          byteStart: this.byteStart,
          byteEndExclusive,
          ...(this.shardIndex !== undefined && { shardIndex: this.shardIndex }),
        };
      }
      this.root = 'separator';
    } finally {
      this.buffer.clear();
    }
  }

  finish(sourceByteLength: number): ChatGptOfficialConversationSelection | null {
    this.utf8.finish();
    if (this.root !== 'end' || this.stack.length !== 0 || this.inString) fail('invalid-json');
    return this.selected === null ? null : { ...this.selected, sourceByteLength };
  }

  clearFailure(): void {
    this.buffer.clear();
    this.selected?.bytes.fill(0);
    this.selected = null;
  }
}

/**
 * Select one exact identity from an uncompressed official conversations JSON array.
 * The complete stream is validated, including neighbors and trailing input. At most
 * one bounded current object and the selected owned bytes survive between chunks;
 * unrelated object bytes are erased immediately after JSON/identity validation.
 */
export async function selectChatGptOfficialConversation(
  input: SelectChatGptOfficialConversationInput
): Promise<ChatGptOfficialConversationSelection> {
  let resolved: ReturnType<typeof resolveSingleInput>;
  try {
    resolved = resolveSingleInput(input);
  } catch {
    fail('invalid-input');
  }
  const ledger: SelectionLedger = {
    ids: new Set(),
    conversationCount: 0,
    ignoredEmptyRecordCount: 0,
  };
  const selection = await scanSource(
    resolved.chunks,
    resolved.conversationId,
    resolved.limits,
    ledger,
    { sourceByteLength: 0 }
  );
  if (selection === null) fail('conversation-not-found');
  return withIgnoredEmptyRecords(selection, ledger);
}

function withIgnoredEmptyRecords(
  selection: ChatGptOfficialConversationSelection,
  ledger: SelectionLedger
): ChatGptOfficialConversationSelection {
  return ledger.ignoredEmptyRecordCount === 0
    ? selection
    : { ...selection, ignoredEmptyRecordCount: ledger.ignoredEmptyRecordCount };
}

async function scanSource(
  chunks: AsyncIterable<Uint8Array>,
  conversationId: string,
  limits: ChatGptOfficialSelectionLimits,
  ledger: SelectionLedger,
  aggregate: AggregateLedger,
  shardIndex?: number
): Promise<ChatGptOfficialConversationSelection | null> {
  const scanner = new ConversationScanner(conversationId, limits, ledger, shardIndex);
  let localSourceByteLength = 0;
  try {
    for await (const chunk of chunks) {
      if (
        !ArrayBuffer.isView(chunk) ||
        Object.prototype.toString.call(chunk) !== '[object Uint8Array]'
      ) {
        fail('invalid-chunk');
      }
      if (chunk.byteLength > limits.maxSourceBytes - aggregate.sourceByteLength)
        fail('source-limit');
      const start = localSourceByteLength;
      localSourceByteLength += chunk.byteLength;
      aggregate.sourceByteLength += chunk.byteLength;
      // append() copies each byte synchronously, before a reused source chunk can be yielded again.
      for (let index = 0; index < chunk.length; index++)
        scanner.accept(chunk[index], start + index);
    }
    return scanner.finish(localSourceByteLength);
  } catch (error) {
    scanner.clearFailure();
    if (internalSelectionError(error)) throw error;
    fail('source-read-failed');
  }
}

/** Validate every supplied shard and retain only one exact matching conversation. */
export async function selectChatGptOfficialConversationSources(
  input: SelectChatGptOfficialConversationSourcesInput
): Promise<ChatGptOfficialConversationSelection> {
  let resolved: ReturnType<typeof resolveMultiInput>;
  try {
    resolved = resolveMultiInput(input);
  } catch (error) {
    if (internalSelectionError(error)) throw error;
    fail('invalid-input');
  }
  const ledger: SelectionLedger = {
    ids: new Set(),
    conversationCount: 0,
    ignoredEmptyRecordCount: 0,
  };
  const aggregate: AggregateLedger = { sourceByteLength: 0 };
  let selected: ChatGptOfficialConversationSelection | null = null;
  try {
    for (const source of resolved.sources) {
      const candidate = await scanSource(
        source.chunks,
        resolved.conversationId,
        resolved.limits,
        ledger,
        aggregate,
        source.shardIndex
      );
      if (candidate !== null) selected = candidate;
    }
    if (selected === null) fail('conversation-not-found');
    return withIgnoredEmptyRecords(selected, ledger);
  } catch (error) {
    selected?.bytes.fill(0);
    if (internalSelectionError(error)) throw error;
    fail('source-read-failed');
  }
}
