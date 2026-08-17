import type { ArchiveBlock, JsonValue } from '../../types';
import type { BlockContext, JsonRecord } from './contracts';
import { upsertAsset } from './assets';
import {
  fail,
  hasOwn,
  isPlainRecord,
  nullableAliasedString,
  pointerAt,
  providerFields,
  redactSensitiveUrls,
  requireRecord,
  sanitizedCitationUrl,
  sanitizeJson,
  sourceRef,
} from './privacy';

const ASSET_TYPES = new Set([
  'attachment',
  'file',
  'file_asset_pointer',
  'image',
  'image_asset_pointer',
  'audio',
  'audio_asset_pointer',
  'video',
  'video_asset_pointer',
]);
const REASONING_TYPES = new Set(['reasoning', 'reasoning_recap', 'thoughts']);
const TOOL_CALL_TYPES = new Set(['tool_call', 'tool_calls', 'tool_use']);
const TOOL_RESULT_TYPES = new Set(['tool_result', 'tool_results', 'tool_response']);
const EXECUTION_TYPES = new Set([
  'execution_output',
  'execution_result',
  'code_interpreter_output',
]);
const CITATION_TYPES = new Set([
  'citation',
  'citations',
  'content_reference',
  'content_references',
]);
const CANVAS_TYPES = new Set(['canvas', 'canvas_event', 'canvas_update', 'canvas_document']);
const ERROR_TYPES = new Set(['error', 'provider_error', 'model_error']);
const KNOWN_CONTENT_TYPES = new Set([
  'text',
  'multimodal_text',
  'markdown',
  'html',
  'code',
  ...REASONING_TYPES,
  ...TOOL_CALL_TYPES,
  ...TOOL_RESULT_TYPES,
  ...EXECUTION_TYPES,
  ...CITATION_TYPES,
  ...ASSET_TYPES,
  ...CANVAS_TYPES,
  ...ERROR_TYPES,
]);

export function normalizeContent(
  raw: unknown,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock[] {
  const content = requireRecord(raw, pointer, 'malformed-content');
  const blocks: ArchiveBlock[] = [];
  normalizeContentRecord(blocks, content, pointer, messageId, context, false);
  return blocks;
}

export function appendMetadataBlocks(
  blocks: ArchiveBlock[],
  metadata: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  for (const field of Object.keys(metadata)) {
    if (metadata[field] === null) continue;
    if (field === 'citations' || field === 'content_references') {
      appendCitationArray(blocks, metadata[field], pointerAt(pointer, field), messageId, context);
    }
    if (field === 'attachments' || field === 'files') {
      appendAttachmentArray(blocks, metadata[field], pointerAt(pointer, field), messageId, context);
    }
  }
}

/**
 * Typed payloads are excluded from contentMetadata. Residual provider fields
 * stay exactly once in that metadata unless the typed representation retains
 * the complete payload itself.
 */
export function contentProviderFields(
  content: JsonRecord,
  context: BlockContext,
  pointer: string
): JsonValue {
  const type = contentType(content, pointer);
  if (
    ASSET_TYPES.has(type) ||
    CANVAS_TYPES.has(type) ||
    type.startsWith('canvas_') ||
    ERROR_TYPES.has(type) ||
    CITATION_TYPES.has(type) ||
    type === 'tool_call' ||
    type === 'tool_result' ||
    !KNOWN_CONTENT_TYPES.has(type)
  ) {
    return {};
  }
  return providerFields(content, mappedContentFields(type), context.privacy, pointer);
}

function mappedContentFields(type: string): Set<string> {
  const fields = new Set(['content_type']);
  if (type === 'text' || type === 'multimodal_text') {
    ['parts', 'text'].forEach(field => fields.add(field));
  } else if (type === 'markdown') {
    ['markdown', 'text'].forEach(field => fields.add(field));
  } else if (type === 'html') {
    ['html', 'text'].forEach(field => fields.add(field));
  } else if (type === 'code') {
    ['code', 'text', 'language'].forEach(field => fields.add(field));
  } else if (REASONING_TYPES.has(type)) {
    ['thoughts', 'text', 'content', 'summary'].forEach(field => fields.add(field));
  } else if (TOOL_CALL_TYPES.has(type)) {
    ['tool_calls', 'calls', 'parts'].forEach(field => fields.add(field));
  } else if (TOOL_RESULT_TYPES.has(type)) {
    ['tool_results', 'results', 'parts'].forEach(field => fields.add(field));
  } else if (EXECUTION_TYPES.has(type)) {
    ['output', 'result', 'text', 'content'].forEach(field => fields.add(field));
  }
  return fields;
}

function appendNestedContentResidual(
  blocks: ArchiveBlock[],
  blockStart: number,
  content: JsonRecord,
  type: string,
  pointer: string,
  context: BlockContext,
  nested: boolean
): void {
  if (!nested) return;
  if (
    ASSET_TYPES.has(type) ||
    CANVAS_TYPES.has(type) ||
    type.startsWith('canvas_') ||
    ERROR_TYPES.has(type) ||
    CITATION_TYPES.has(type) ||
    type === 'tool_call' ||
    type === 'tool_result' ||
    !KNOWN_CONTENT_TYPES.has(type)
  ) {
    return;
  }
  const residual = providerFields(content, mappedContentFields(type), context.privacy, pointer);
  if (!isPlainRecord(residual) || Object.keys(residual).length === 0) return;
  const firstBlock = blocks[blockStart];
  if (!firstBlock) {
    fail('invalid-output', 'Nested content block has invalid extension storage.');
  }
  if (firstBlock.extensions.openai === undefined) firstBlock.extensions.openai = {};
  if (!isPlainRecord(firstBlock.extensions.openai))
    fail('invalid-output', 'Nested content block has invalid extension storage.');
  firstBlock.extensions.openai.contentContainer = residual;
}

function normalizeContentRecord(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext,
  nested: boolean
): void {
  const type = contentType(content, pointer);
  const blockStart = blocks.length;
  if (type === 'text' || type === 'multimodal_text') {
    normalizeTextContent(blocks, content, pointer, messageId, context);
  } else if (type === 'markdown') {
    blocks.push(markdownBlock(blocks, content, pointer, messageId, context));
  } else if (type === 'html') {
    blocks.push(htmlBlock(blocks, content, pointer, messageId, context));
  } else if (type === 'code') {
    blocks.push(codeBlock(blocks, content, pointer, messageId, context));
  } else if (REASONING_TYPES.has(type)) {
    normalizeReasoning(blocks, content, pointer, messageId, context);
  } else if (TOOL_CALL_TYPES.has(type)) {
    normalizeToolCalls(blocks, content, pointer, messageId, context);
  } else if (TOOL_RESULT_TYPES.has(type)) {
    normalizeToolResults(blocks, content, pointer, messageId, context);
  } else if (EXECUTION_TYPES.has(type)) {
    blocks.push(executionBlock(blocks, content, pointer, messageId, context));
  } else if (CITATION_TYPES.has(type)) {
    normalizeCitations(blocks, content, pointer, messageId, context);
  } else if (ASSET_TYPES.has(type)) {
    blocks.push(attachmentBlock(blocks, content, pointer, messageId, context));
  } else if (CANVAS_TYPES.has(type) || type.startsWith('canvas_')) {
    blocks.push(canvasBlock(blocks, content, pointer, messageId, context));
  } else if (ERROR_TYPES.has(type)) {
    blocks.push(errorBlock(blocks, content, pointer, messageId, context));
  } else {
    context.observedUnknownContentTypes.add(type);
    blocks.push(unknownBlock(blocks, type, content, pointer, messageId, context));
  }
  appendNestedContentResidual(blocks, blockStart, content, type, pointer, context, nested);
}

function normalizeTextContent(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  if (hasOwn(content, 'parts')) appendParts(blocks, content.parts, pointer, messageId, context);
  if (hasOwn(content, 'text'))
    blocks.push(textBlock(blocks, content.text, pointerAt(pointer, 'text'), messageId, context));
  if (!hasOwn(content, 'parts') && !hasOwn(content, 'text')) {
    fail('malformed-content', `${pointer} text content needs parts or text.`);
  }
}

function appendParts(
  blocks: ArchiveBlock[],
  parts: unknown,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  if (!Array.isArray(parts))
    fail('malformed-content-parts', `${pointerAt(pointer, 'parts')} must be an array.`);
  parts.forEach((part, index) => {
    const partPointer = pointerAt(pointer, 'parts', String(index));
    if (typeof part === 'string')
      blocks.push(textBlock(blocks, part, partPointer, messageId, context));
    else
      normalizeContentRecord(
        blocks,
        requireRecord(part, partPointer, 'malformed-content-part'),
        partPointer,
        messageId,
        context,
        true
      );
  });
}

function normalizeReasoning(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  if (Array.isArray(content.thoughts)) {
    content.thoughts.forEach((thought, index) => {
      const thoughtPointer = pointerAt(pointer, 'thoughts', String(index));
      blocks.push(
        reasoningBlock(
          blocks,
          reasoningText(thought, thoughtPointer),
          thoughtPointer,
          messageId,
          context
        )
      );
    });
  } else if (typeof content.thoughts === 'string') {
    blocks.push(
      reasoningBlock(blocks, content.thoughts, pointerAt(pointer, 'thoughts'), messageId, context)
    );
  } else {
    blocks.push(
      reasoningBlock(blocks, reasoningText(content, pointer), pointer, messageId, context)
    );
  }
}

function normalizeToolCalls(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  const direct = content.content_type === 'tool_call';
  const selected = direct
    ? { field: null, items: [content] }
    : selectedArray(content, ['tool_calls', 'calls', 'parts'], pointer, 'malformed-tool-call');
  selected.items.forEach((value, index) => {
    const callPointer = selectedItemPointer(pointer, selected.field, index);
    const call = requireRecord(value, callPointer, 'malformed-tool-call');
    const name = requiredAlias(
      call,
      ['name', 'tool_name', 'recipient'],
      callPointer,
      'malformed-tool-call'
    );
    const argumentsValue = firstPresent(call, ['arguments', 'args', 'input']) ?? null;
    const excluded = new Set(['name', 'tool_name', 'recipient', 'arguments', 'args', 'input']);
    if (direct) excluded.add('content_type');
    blocks.push({
      id: blockId(messageId, blocks.length),
      type: 'tool_call',
      toolName: name,
      arguments: sanitizeJson(argumentsValue, context.privacy, callPointer).value,
      sourceRefs: [sourceRef(context, 'tool-call', messageId, callPointer)],
      extensions: {
        openai: providerFields(call, excluded, context.privacy, callPointer),
      },
    });
  });
}

function normalizeToolResults(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  const direct = content.content_type === 'tool_result';
  const selected = direct
    ? { field: null, items: [content] }
    : selectedArray(
        content,
        ['tool_results', 'results', 'parts'],
        pointer,
        'malformed-tool-result'
      );
  selected.items.forEach((value, index) => {
    const resultPointer = selectedItemPointer(pointer, selected.field, index);
    const result = requireRecord(value, resultPointer, 'malformed-tool-result');
    const recognizedPayload = firstPresent(result, ['result', 'output', 'content']);
    const excluded = new Set(['name', 'tool_name', 'result', 'output', 'content']);
    if (direct) excluded.add('content_type');
    blocks.push({
      id: blockId(messageId, blocks.length),
      type: 'tool_result',
      toolName: nullableAliasedString(
        [
          [result, 'name', resultPointer],
          [result, 'tool_name', resultPointer],
        ],
        'ambiguous-tool-result-name'
      ),
      result: sanitizeJson(
        recognizedPayload === undefined ? result : recognizedPayload,
        context.privacy,
        resultPointer
      ).value,
      sourceRefs: [sourceRef(context, 'tool-result', messageId, resultPointer)],
      extensions: {
        openai:
          recognizedPayload === undefined
            ? {}
            : providerFields(result, excluded, context.privacy, resultPointer),
      },
    });
  });
}

function normalizeCitations(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  const selected = selectedArray(
    content,
    ['citations', 'content_references', 'parts'],
    pointer,
    'malformed-citation'
  );
  selected.items.forEach((value, index) => {
    const citationPointer = selectedItemPointer(pointer, selected.field, index);
    blocks.push(
      citationBlock(
        blocks,
        requireRecord(value, citationPointer, 'malformed-citation'),
        citationPointer,
        messageId,
        context
      )
    );
  });
}

function appendCitationArray(
  blocks: ArchiveBlock[],
  values: unknown,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  if (!Array.isArray(values)) fail('malformed-citation', `${pointer} must be an array.`);
  values.forEach((value, index) => {
    const citationPointer = pointerAt(pointer, String(index));
    blocks.push(
      citationBlock(
        blocks,
        requireRecord(value, citationPointer, 'malformed-citation'),
        citationPointer,
        messageId,
        context
      )
    );
  });
}

function appendAttachmentArray(
  blocks: ArchiveBlock[],
  values: unknown,
  pointer: string,
  messageId: string,
  context: BlockContext
): void {
  if (!Array.isArray(values)) fail('malformed-attachment', `${pointer} must be an array.`);
  values.forEach((value, index) => {
    const attachmentPointer = pointerAt(pointer, String(index));
    blocks.push(
      attachmentBlock(
        blocks,
        requireRecord(value, attachmentPointer, 'malformed-attachment'),
        attachmentPointer,
        messageId,
        context
      )
    );
  });
}

function textBlock(
  blocks: ArchiveBlock[],
  text: unknown,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  if (typeof text !== 'string') fail('malformed-content', `${pointer} must be a string.`);
  return baseBlock(blocks, 'text', messageId, pointer, context, 'content-part', {
    text: redactSensitiveUrls(text, context.privacy, pointer),
  });
}

function markdownBlock(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'markdown', messageId, pointer, context, 'content-part', {
    markdown: redactSensitiveUrls(
      requiredContentString(content, ['markdown', 'text'], pointer),
      context.privacy,
      pointer
    ),
  });
}

function htmlBlock(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'html', messageId, pointer, context, 'content-part', {
    html: redactSensitiveUrls(
      requiredContentString(content, ['html', 'text'], pointer),
      context.privacy,
      pointer
    ),
  });
}

function codeBlock(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'code', messageId, pointer, context, 'content-part', {
    code: redactSensitiveUrls(
      requiredContentString(content, ['code', 'text'], pointer),
      context.privacy,
      pointer
    ),
    language: nullableAliasedString([[content, 'language', pointer]], 'ambiguous-code-language'),
  });
}

function reasoningBlock(
  blocks: ArchiveBlock[],
  text: string,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'reasoning', messageId, pointer, context, 'reasoning', {
    text: redactSensitiveUrls(text, context.privacy, pointer),
  });
}

function executionBlock(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'execution_output', messageId, pointer, context, 'execution-output', {
    output: sanitizeJson(
      requiredContentValue(content, ['output', 'result', 'text', 'content'], pointer),
      context.privacy,
      pointer
    ).value,
  });
}

function attachmentBlock(
  blocks: ArchiveBlock[],
  attachment: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'attachment', messageId, pointer, context, 'attachment', {
    assetId: upsertAsset(attachment, pointer, context),
  });
}

function canvasBlock(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'canvas_event', messageId, pointer, context, 'canvas-event', {
    event: sanitizeJson(content, context.privacy, pointer).value,
  });
}

function errorBlock(
  blocks: ArchiveBlock[],
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  const nested = hasOwn(content, 'error')
    ? requireRecord(content.error, pointerAt(pointer, 'error'), 'malformed-error')
    : null;
  const message = errorMessage(content, nested);
  const code = nullableAliasedString(
    nested
      ? [
          [content, 'code', pointer],
          [nested, 'code', pointerAt(pointer, 'error')],
        ]
      : [[content, 'code', pointer]],
    'ambiguous-error-code'
  );
  const block = baseBlock(blocks, 'error', messageId, pointer, context, 'provider-error', {
    message: redactSensitiveUrls(message, context.privacy, pointer),
    code,
  });
  const residual = providerFields(
    content,
    new Set(['content_type', 'message', 'text', 'code', 'error']),
    context.privacy,
    pointer
  ) as Record<string, JsonValue>;
  if (nested) {
    const nestedResidual = providerFields(
      nested,
      new Set(['message', 'code']),
      context.privacy,
      pointerAt(pointer, 'error')
    ) as Record<string, JsonValue>;
    if (Object.keys(nestedResidual).length > 0) residual.error = nestedResidual;
  }
  block.extensions = { openai: residual };
  return block;
}

function unknownBlock(
  blocks: ArchiveBlock[],
  providerType: string,
  content: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  return baseBlock(blocks, 'unknown', messageId, pointer, context, 'content-part', {
    providerType,
    raw: sanitizeJson(content, context.privacy, pointer).value,
  });
}

function citationBlock(
  blocks: ArchiveBlock[],
  citation: JsonRecord,
  pointer: string,
  messageId: string,
  context: BlockContext
): ArchiveBlock {
  const urlFields = ['url', 'link'].filter(field => hasOwn(citation, field));
  const rawUrl = nullableAliasedString(
    [
      [citation, 'url', pointer],
      [citation, 'link', pointer],
    ],
    'ambiguous-citation-url'
  );
  const block = baseBlock(blocks, 'citation', messageId, pointer, context, 'citation', {
    label: nullableAliasedString(
      [
        [citation, 'label', pointer],
        [citation, 'title', pointer],
        [citation, 'name', pointer],
      ],
      'ambiguous-citation-label'
    ),
    url: sanitizedCitationUrl(rawUrl, pointerAt(pointer, urlFields[0] ?? 'url'), context),
    content:
      firstPresent(citation, ['content', 'text']) === undefined
        ? null
        : sanitizeJson(firstPresent(citation, ['content', 'text']), context.privacy, pointer).value,
  });
  block.extensions = {
    openai: providerFields(
      citation,
      new Set(['content_type', 'label', 'title', 'name', 'url', 'link', 'content', 'text']),
      context.privacy,
      pointer
    ),
  };
  return block;
}

function baseBlock(
  blocks: ArchiveBlock[],
  type: ArchiveBlock['type'],
  messageId: string,
  pointer: string,
  context: BlockContext,
  sourceKind: string,
  payload: Record<string, unknown>
): ArchiveBlock {
  return {
    id: `${messageId}:block:${blocks.length}`,
    type,
    ...payload,
    sourceRefs: [sourceRef(context, sourceKind, messageId, pointer)],
    extensions: {},
  } as ArchiveBlock;
}

function blockId(messageId: string, index: number): string {
  return `${messageId}:block:${index}`;
}

function contentType(content: JsonRecord, pointer: string): string {
  const value = content.content_type;
  if (typeof value !== 'string' || value.length === 0 || value.length > 160) {
    fail(
      'invalid-content-type',
      `${pointerAt(pointer, 'content_type')} must be a bounded non-empty string.`
    );
  }
  return value;
}

function reasoningText(value: unknown, pointer: string): string {
  if (typeof value === 'string') return value;
  const record = requireRecord(value, pointer, 'malformed-reasoning');
  return requiredContentString(record, ['text', 'content', 'summary'], pointer);
}

function selectedArray(
  content: JsonRecord,
  fields: string[],
  pointer: string,
  code: string
): { field: string | null; items: unknown[] } {
  for (const field of fields) {
    if (!hasOwn(content, field)) continue;
    if (!Array.isArray(content[field]))
      fail(code, `${pointerAt(pointer, field)} must be an array.`);
    return { field, items: content[field] };
  }
  return { field: null, items: [content] };
}

function selectedItemPointer(base: string, field: string | null, index: number): string {
  return field === null ? base : pointerAt(base, field, String(index));
}

function requiredAlias(
  record: JsonRecord,
  fields: string[],
  pointer: string,
  code: string
): string {
  const present = fields.filter(field => hasOwn(record, field));
  if (present.length === 0)
    fail(code, `Value at ${pointer} is missing one of ${fields.join(', ')}.`);
  const values = present.map(field => record[field]);
  if (values.some(value => typeof value !== 'string' || value.length === 0))
    fail(code, `Tool name at ${pointer} must be non-empty.`);
  if (new Set(values).size !== 1) fail(code, `Alias values at ${pointer} disagree.`);
  return values[0] as string;
}

function requiredContentString(content: JsonRecord, fields: string[], pointer: string): string {
  const value = requiredContentValue(content, fields, pointer);
  if (typeof value !== 'string')
    fail('malformed-content', `${pointer} has no string ${fields.join(' or ')} field.`);
  return value;
}

function requiredContentValue(content: JsonRecord, fields: string[], pointer: string): unknown {
  const value = firstPresent(content, fields);
  if (value === undefined)
    fail('malformed-content', `${pointer} has no ${fields.join(' or ')} payload.`);
  return value;
}

function firstPresent(record: JsonRecord, fields: string[]): unknown {
  for (const field of fields) if (hasOwn(record, field)) return record[field];
  return undefined;
}

function errorMessage(content: JsonRecord, nested: JsonRecord | null): string {
  if (typeof content.message === 'string') return content.message;
  if (typeof content.text === 'string') return content.text;
  if (nested && typeof nested.message === 'string') return nested.message;
  return '';
}
