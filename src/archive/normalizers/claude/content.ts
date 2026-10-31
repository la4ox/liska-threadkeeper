import type { ArchiveBlock } from '../../types';
import type { ClaudeContext, ClaudeRecord } from './contracts';
import {
  at,
  citationUrl,
  diagnostic,
  isRecord,
  nullableText,
  ref,
  residual,
  sanitize,
  text,
} from './privacy';

const ASSET_TYPES = new Set(['image', 'document', 'attachment']);
const KNOWN_TYPES = new Set([
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'citation',
  ...ASSET_TYPES,
]);

export interface ClaudeContentContext extends ClaudeContext {
  assetIdsByPointer: ReadonlyMap<string, string>;
}

export function observedClaudeUnknownTypes(messages: unknown[]): string[] {
  const observed = new Set<string>();
  function scan(value: unknown, depth: number, isMessage = false): void {
    if (depth > 16 || !isRecord(value)) return;
    if (
      (isMessage || value.type === 'tool_result') &&
      Array.isArray(value.content) &&
      value.content.length
    ) {
      for (const block of value.content) {
        const unknown = unknownType(block);
        if (unknown !== null) observed.add(unknown);
        if (unknown === null) scan(block, depth + 1);
      }
    } else if (
      isMessage &&
      value.content !== undefined &&
      value.content !== null &&
      !Array.isArray(value.content)
    )
      observed.add('message.content');
    for (const field of ['attachments', 'files', 'citations', 'artifacts']) {
      const entries = value[field];
      if (entries === undefined || entries === null) continue;
      if (!Array.isArray(entries)) {
        observed.add(`message.${field}`);
        continue;
      }
      for (const entry of entries) {
        if (field === 'artifacts') observed.add('artifact');
        else if (!isRecord(entry)) observed.add(`${field}:malformed`);
      }
    }
  }
  messages.forEach(message => {
    scan(message, 0, true);
    if (
      isRecord(message) &&
      (!Array.isArray(message.content) || !message.content.length) &&
      message.text !== undefined &&
      message.text !== null &&
      typeof message.text !== 'string'
    )
      observed.add('message.text');
  });
  return [...observed].sort();
}

/** A nonempty structured array owns visible content; direct text never duplicates it. */
export function claudeMessageBlocks(
  message: ClaudeRecord,
  messageId: string,
  role: string,
  pointer: string,
  context: ClaudeContentContext
): ArchiveBlock[] {
  const blocks: ArchiveBlock[] = [];
  const addUnknown = (type: string, value: unknown, location: string): void => {
    context.unknownTypes.add(type);
    diagnostic(
      context,
      'unknown-content-type',
      location,
      'Unmapped Claude content was retained as a bounded unknown block.',
      'info'
    );
    blocks.push({
      ...base(location),
      type: 'unknown',
      providerType: type,
      raw: sanitize(value, context, location),
    });
  };
  const base = (location: string) => ({
    id: `${messageId}:block:${blocks.length}`,
    sourceRefs: [ref(context, 'content-part', location, messageId)],
    extensions: {},
  });
  function attachment(value: unknown, location: string, malformedType: string): void {
    const assetId = context.assetIdsByPointer.get(location);
    if (!isRecord(value) || !assetId) {
      addUnknown(malformedType, value, location);
      return;
    }
    blocks.push({ ...base(location), type: 'attachment', assetId });
  }
  function citation(value: ClaudeRecord, location: string): void {
    const label = value.title ?? value.label ?? value.source;
    blocks.push({
      ...base(location),
      type: 'citation',
      label: typeof label === 'string' ? text(label, context, location) : null,
      url: citationUrl(value.url, context, at(location, 'url')),
      content: sanitize(value, context, location),
    });
  }
  function extras(container: ClaudeRecord, location: string): void {
    for (const field of ['attachments', 'files', 'citations', 'artifacts']) {
      const entries = container[field];
      if (entries === undefined || entries === null) continue;
      if (!Array.isArray(entries)) {
        addUnknown(`message.${field}`, entries, at(location, field));
        continue;
      }
      entries.forEach((value, index) => {
        const itemPointer = at(location, field, String(index));
        if (field === 'artifacts') addUnknown('artifact', value, itemPointer);
        else if (field === 'citations') {
          if (isRecord(value)) citation(value, itemPointer);
          else addUnknown('citations:malformed', value, itemPointer);
        } else attachment(value, itemPointer, `${field}:malformed`);
      });
    }
  }
  function structured(value: unknown, location: string): void {
    const unknown = unknownType(value);
    if (unknown !== null || !isRecord(value)) {
      addUnknown(unknown ?? 'INVALID_CONTENT_BLOCK', value, location);
      return;
    }
    const type = value.type as string;
    const common = {
      ...base(location),
      extensions: residual(value, mappedFields(type, value), context, location),
    };
    if (type === 'text') {
      const content = text(value.text as string, context, at(location, 'text'));
      blocks.push(
        role === 'assistant'
          ? { ...common, type: 'markdown', markdown: content }
          : { ...common, type: 'text', text: content }
      );
    } else if (type === 'thinking') {
      const field = typeof value.thinking === 'string' ? 'thinking' : 'text';
      blocks.push({
        ...common,
        type: 'reasoning',
        text: text(value[field] as string, context, at(location, field)),
      });
    } else if (type === 'tool_use') {
      blocks.push({
        ...common,
        type: 'tool_call',
        toolName: text(value.name as string, context, at(location, 'name')),
        arguments: sanitize(value.input, context, at(location, 'input')),
      });
    } else if (type === 'tool_result') {
      blocks.push({
        ...common,
        type: 'tool_result',
        toolName: nullableText(value.name, context, at(location, 'name')),
        result: sanitize(value.content, context, at(location, 'content')),
      });
      // Nested rich content remains in result; expose unmapped/asset parts too so none disappear.
      nestedEvidence(value.content, at(location, 'content'), 0);
    } else if (type === 'citation') citation(value, location);
    else attachment(value, location, `${type}:malformed`);
    extras(value, location);
  }
  function nestedEvidence(entries: unknown, location: string, depth: number): void {
    if (!Array.isArray(entries) || depth > 16) return;
    entries.forEach((nested, index) => {
      const nestedPointer = at(location, String(index));
      const nestedUnknown = unknownType(nested);
      if (nestedUnknown !== null || !isRecord(nested)) {
        addUnknown(nestedUnknown ?? 'INVALID_CONTENT_BLOCK', nested, nestedPointer);
        return;
      }
      if (ASSET_TYPES.has(nested.type as string))
        attachment(nested, nestedPointer, 'attachment:malformed');
      if (nested.type === 'tool_result')
        nestedEvidence(nested.content, at(nestedPointer, 'content'), depth + 1);
      extras(nested, nestedPointer);
    });
  }
  if (Array.isArray(message.content) && message.content.length) {
    message.content.forEach((value, index) =>
      structured(value, at(pointer, 'content', String(index)))
    );
  } else {
    if (
      message.content !== undefined &&
      message.content !== null &&
      !Array.isArray(message.content)
    )
      addUnknown('message.content', message.content, at(pointer, 'content'));
    if (typeof message.text === 'string') {
      if (!Object.prototype.hasOwnProperty.call(message, 'content') && message.text.length)
        diagnostic(
          context,
          'web-detail-direct-text-only',
          at(pointer, 'text'),
          'This web-detail message provides direct text without structured content; richer block availability is unknown.',
          'info'
        );
      const value = text(message.text, context, at(pointer, 'text'));
      blocks.push(
        role === 'assistant'
          ? { ...base(at(pointer, 'text')), type: 'markdown', markdown: value }
          : { ...base(at(pointer, 'text')), type: 'text', text: value }
      );
    } else if (message.text !== undefined && message.text !== null)
      addUnknown('message.text', message.text, at(pointer, 'text'));
  }
  extras(message, pointer);
  return blocks;
}

function unknownType(value: unknown): string | null {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.type)
  )
    return 'INVALID_CONTENT_BLOCK';
  const type = value.type;
  if (!KNOWN_TYPES.has(type)) return type;
  if (type === 'text' && typeof value.text !== 'string') return 'text:malformed';
  if (type === 'thinking' && typeof value.thinking !== 'string' && typeof value.text !== 'string')
    return 'thinking:malformed';
  if (
    type === 'tool_use' &&
    (typeof value.name !== 'string' ||
      !value.name.trim() ||
      !Object.prototype.hasOwnProperty.call(value, 'input'))
  )
    return 'tool_use:malformed';
  if (type === 'tool_result' && !Object.prototype.hasOwnProperty.call(value, 'content'))
    return 'tool_result:malformed';
  if (
    type === 'tool_result' &&
    value.name !== undefined &&
    value.name !== null &&
    typeof value.name !== 'string'
  )
    return 'tool_result:malformed';
  return null;
}

function mappedFields(type: string, value: ClaudeRecord): string[] {
  const common = ['type', 'attachments', 'files', 'citations', 'artifacts'];
  if (type === 'text') return [...common, 'text'];
  if (type === 'thinking')
    return [...common, typeof value.thinking === 'string' ? 'thinking' : 'text'];
  if (type === 'tool_use') return [...common, 'name', 'input'];
  if (type === 'tool_result') return [...common, 'name', 'content'];
  return common;
}
