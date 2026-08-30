import type { ArchiveValidationIssue, UnknownRecord } from './contracts';
import {
  addIssue,
  expectExactObject,
  isNonEmptyString,
  isPlainObject,
  validateExtensions,
  validateJsonValue,
  validateNullableString,
  validateSourceReferences,
  validateTimestamp,
} from './shared';

export interface AssetReference {
  assetId: unknown;
  path: string;
}

type BlockPayloadValidator = (
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[],
  assetReferences: AssetReference[]
) => void;

const BLOCK_FIELDS: Record<string, readonly string[]> = {
  text: ['text'],
  markdown: ['markdown'],
  html: ['html'],
  code: ['code', 'language'],
  reasoning: ['text'],
  tool_call: ['toolName', 'arguments'],
  tool_result: ['toolName', 'result'],
  execution_output: ['output'],
  citation: ['label', 'url', 'content'],
  quote: ['text', 'attribution'],
  attachment: ['assetId'],
  canvas_event: ['event'],
  error: ['message', 'code'],
  unknown: ['providerType', 'raw'],
};

const BLOCK_VALIDATORS: Record<string, BlockPayloadValidator> = {
  text: validateTextPayload,
  markdown: validateMarkdownPayload,
  html: validateHtmlPayload,
  code: validateCodePayload,
  reasoning: validateTextPayload,
  tool_call: validateToolCallPayload,
  tool_result: validateToolResultPayload,
  execution_output: validateExecutionOutputPayload,
  citation: validateCitationPayload,
  quote: validateQuotePayload,
  attachment: validateAttachmentPayload,
  canvas_event: validateCanvasEventPayload,
  error: validateErrorPayload,
  unknown: validateUnknownPayload,
};

const MESSAGE_FIELDS = [
  'id',
  'author',
  'recipient',
  'channel',
  'createdAt',
  'updatedAt',
  'status',
  'model',
  'visibility',
  'blocks',
  'sourceRefs',
  'extensions',
];

export function validateBlock(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  assetReferences: AssetReference[]
): void {
  if (!isPlainObject(value)) {
    addIssue(issues, 'error', 'block-not-object', path, 'Block must be a plain JSON object.');
    return;
  }
  const type = typeof value.type === 'string' ? value.type : null;
  const fields = blockFields(type);
  const block = expectExactObject(value, path, fields, fields, issues, 'block-not-object');
  if (!block) {
    return;
  }
  validateBlockBase(block, type, path, issues);
  if (type && BLOCK_VALIDATORS[type]) {
    BLOCK_VALIDATORS[type](block, path, issues, assetReferences);
  }
}

function blockFields(type: string | null): string[] {
  return ['id', 'type', 'sourceRefs', 'extensions', ...(type ? (BLOCK_FIELDS[type] ?? []) : [])];
}

function validateBlockBase(
  block: UnknownRecord,
  type: string | null,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isNonEmptyString(block.id)) {
    addIssue(issues, 'error', 'block-id-invalid', `${path}/id`, 'Block ID must be non-empty.');
  }
  if (!type || !BLOCK_VALIDATORS[type]) {
    addIssue(
      issues,
      'error',
      'block-type-invalid',
      `${path}/type`,
      'Block type must be one of the liska-thread/1 block types.'
    );
  }
  validateSourceReferences(block.sourceRefs, `${path}/sourceRefs`, issues);
  validateExtensions(block.extensions, `${path}/extensions`, issues);
}

function validateTextPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (typeof block.text !== 'string') {
    addIssue(
      issues,
      'error',
      'block-payload-invalid',
      `${path}/text`,
      'Text payload must be a string.'
    );
  }
}

function validateMarkdownPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (typeof block.markdown !== 'string') {
    addIssue(
      issues,
      'error',
      'block-payload-invalid',
      `${path}/markdown`,
      'Markdown payload must be a string.'
    );
  }
}

function validateHtmlPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (typeof block.html !== 'string') {
    addIssue(
      issues,
      'error',
      'block-payload-invalid',
      `${path}/html`,
      'HTML payload must be a string.'
    );
  }
}

function validateCodePayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (typeof block.code !== 'string') {
    addIssue(
      issues,
      'error',
      'block-payload-invalid',
      `${path}/code`,
      'Code payload must be a string.'
    );
  }
  validateNullableString(block.language, `${path}/language`, issues);
}

function validateToolCallPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isNonEmptyString(block.toolName)) {
    addIssue(
      issues,
      'error',
      'block-payload-invalid',
      `${path}/toolName`,
      'Tool name must be non-empty.'
    );
  }
  validateJsonValue(block.arguments, `${path}/arguments`, issues);
}

function validateToolResultPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  validateNullableString(block.toolName, `${path}/toolName`, issues);
  validateJsonValue(block.result, `${path}/result`, issues);
}

function validateExecutionOutputPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  validateJsonValue(block.output, `${path}/output`, issues);
}

function validateCitationPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  validateNullableString(block.label, `${path}/label`, issues);
  validateNullableString(block.url, `${path}/url`, issues);
  validateJsonValue(block.content, `${path}/content`, issues);
}

function validateQuotePayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (typeof block.text !== 'string') {
    addIssue(
      issues,
      'error',
      'block-payload-invalid',
      `${path}/text`,
      'Quote text must be a string.'
    );
  }
  validateNullableString(block.attribution, `${path}/attribution`, issues);
}

function validateAttachmentPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[],
  assetReferences: AssetReference[]
): void {
  if (!isNonEmptyString(block.assetId)) {
    addIssue(
      issues,
      'error',
      'attachment-asset-id-invalid',
      `${path}/assetId`,
      'Attachment asset ID must be non-empty.'
    );
  }
  assetReferences.push({ assetId: block.assetId, path: `${path}/assetId` });
}

function validateCanvasEventPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  validateJsonValue(block.event, `${path}/event`, issues);
}

function validateErrorPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (typeof block.message !== 'string') {
    addIssue(
      issues,
      'error',
      'block-payload-invalid',
      `${path}/message`,
      'Error block message must be a string.'
    );
  }
  validateNullableString(block.code, `${path}/code`, issues);
}

function validateUnknownPayload(
  block: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isNonEmptyString(block.providerType)) {
    addIssue(
      issues,
      'error',
      'unknown-block-provider-type-invalid',
      `${path}/providerType`,
      'Unknown blocks must identify their provider content type.'
    );
  }
  validateJsonValue(block.raw, `${path}/raw`, issues);
}

export function validateMessage(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  messageIds: Set<string>,
  assetReferences: AssetReference[]
): void {
  const message = expectExactObject(
    value,
    path,
    MESSAGE_FIELDS,
    MESSAGE_FIELDS,
    issues,
    'message-not-object'
  );
  if (!message) {
    return;
  }
  validateMessageId(message, path, issues, messageIds);
  validateMessageAuthor(message.author, `${path}/author`, issues);
  validateMessageFields(message, path, issues);
  validateMessageBlocks(message.blocks, `${path}/blocks`, issues, assetReferences);
}

function validateMessageId(
  message: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[],
  messageIds: Set<string>
): void {
  if (!isNonEmptyString(message.id)) {
    addIssue(issues, 'error', 'message-id-invalid', `${path}/id`, 'Message ID must be non-empty.');
  } else if (messageIds.has(message.id)) {
    addIssue(issues, 'error', 'message-id-duplicate', `${path}/id`, 'Message IDs must be unique.');
  } else {
    messageIds.add(message.id);
  }
}

function validateMessageAuthor(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  const author = expectExactObject(
    value,
    path,
    ['role', 'name'],
    ['role', 'name'],
    issues,
    'message-author-invalid'
  );
  if (!author) {
    return;
  }
  if (!isNonEmptyString(author.role)) {
    addIssue(
      issues,
      'error',
      'message-author-role-invalid',
      `${path}/role`,
      'Author role must be non-empty.'
    );
  }
  validateNullableString(author.name, `${path}/name`, issues);
}

function validateMessageFields(
  message: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  ['recipient', 'channel', 'status', 'model', 'visibility'].forEach(field => {
    validateNullableString(message[field], `${path}/${field}`, issues);
  });
  validateTimestamp(message.createdAt, `${path}/createdAt`, issues);
  validateTimestamp(message.updatedAt, `${path}/updatedAt`, issues);
  validateSourceReferences(message.sourceRefs, `${path}/sourceRefs`, issues);
  validateExtensions(message.extensions, `${path}/extensions`, issues);
}

function validateMessageBlocks(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  assetReferences: AssetReference[]
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, 'error', 'message-blocks-not-array', path, 'Blocks must be an array.');
    return;
  }
  const blockIds = new Set<string>();
  value.forEach((block, index) =>
    validateMessageBlock(block, `${path}/${index}`, issues, blockIds, assetReferences)
  );
}

function validateMessageBlock(
  block: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  blockIds: Set<string>,
  assetReferences: AssetReference[]
): void {
  validateBlock(block, path, issues, assetReferences);
  if (!isPlainObject(block) || !isNonEmptyString(block.id)) {
    return;
  }
  if (blockIds.has(block.id)) {
    addIssue(issues, 'error', 'block-id-duplicate', `${path}/id`, 'Block IDs must be unique.');
  } else {
    blockIds.add(block.id);
  }
}
