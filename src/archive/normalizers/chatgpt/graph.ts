import type { ArchiveMessage, ArchiveNode, JsonValue } from '../../types';
import type { BlockContext, JsonRecord, NormalizedGraph, RawEnvelope } from './contracts';
import { appendMetadataBlocks, contentProviderFields, normalizeContent } from './content';
import {
  assertSafeIdentifier,
  fail,
  hasOwn,
  isPlainRecord,
  nullableAliasedString,
  nullableString,
  optionalTimestamp,
  pointerAt,
  providerFields,
  requireBoundedString,
  requireRecord,
  sourceRef,
} from './privacy';

export function normalizeGraph(envelope: RawEnvelope, context: BlockContext): NormalizedGraph {
  const mapping = requireMapping(envelope.conversation);
  const rawNodes = readRawNodes(mapping, envelope.basePointer);
  const currentNodeId = readCurrentNode(envelope.conversation, rawNodes, envelope.basePointer);
  const links = readAllLinks(rawNodes, envelope.basePointer);
  validateGraphLinks(links);
  return {
    rootIds: [...links.entries()].filter(([, link]) => link.parentId === null).map(([id]) => id),
    nodes: normalizeNodes(rawNodes, links, envelope.basePointer, context),
    currentNodeId,
  };
}

function requireMapping(conversation: JsonRecord): JsonRecord {
  const mapping = conversation.mapping;
  if (!isMapping(mapping))
    fail('malformed-graph', 'ChatGPT mapping must be a non-empty plain object.');
  return mapping;
}

function isMapping(value: unknown): value is JsonRecord {
  return isPlainRecord(value) && Object.keys(value).length > 0;
}

function readRawNodes(mapping: JsonRecord, basePointer: string): Map<string, JsonRecord> {
  const nodes = new Map<string, JsonRecord>();
  for (const nodeId of Object.keys(mapping)) {
    assertSafeIdentifier(nodeId, `${basePointer}/mapping key`);
    const pointer = pointerAt(basePointer, 'mapping', nodeId);
    const node = requireRecord(mapping[nodeId], pointer, 'malformed-node');
    if (!hasOwn(node, 'id')) fail('malformed-node', `Mapping node ${nodeId} is missing node.id.`);
    assertSafeIdentifier(node.id, pointerAt(pointer, 'id'));
    if (node.id !== nodeId)
      fail('node-id-mismatch', `Mapping key ${nodeId} does not match its node.id.`);
    nodes.set(nodeId, node);
  }
  return nodes;
}

function readCurrentNode(
  conversation: JsonRecord,
  nodes: Map<string, JsonRecord>,
  pointer: string
): string | null {
  const fields = ['current_node', 'currentNodeId'].filter(field => hasOwn(conversation, field));
  if (fields.length === 0) fail('missing-current-node', 'ChatGPT graph is missing current_node.');
  const values = fields.map(field => {
    const value = conversation[field];
    if (value === null) return null;
    assertSafeIdentifier(value, pointerAt(pointer, field));
    return value;
  });
  if (new Set(values).size !== 1)
    fail('ambiguous-current-node', 'ChatGPT current node aliases disagree.');
  const current = values[0];
  if (current !== null && !nodes.has(current))
    fail('current-node-missing', 'ChatGPT current node is absent from mapping.');
  return current;
}

function readAllLinks(
  nodes: Map<string, JsonRecord>,
  basePointer: string
): Map<string, { parentId: string | null; childIds: string[] }> {
  const links = new Map<string, { parentId: string | null; childIds: string[] }>();
  nodes.forEach((node, nodeId) =>
    links.set(nodeId, readNodeLinks(node, nodeId, nodes, basePointer))
  );
  return links;
}

function readNodeLinks(
  node: JsonRecord,
  nodeId: string,
  nodes: Map<string, JsonRecord>,
  basePointer: string
): { parentId: string | null; childIds: string[] } {
  if (!hasOwn(node, 'parent') || !hasOwn(node, 'children')) {
    fail('malformed-node-links', `Node ${nodeId} is missing parent or children.`);
  }
  const parentId = readParent(node.parent, nodeId, nodes, basePointer);
  const childIds = readChildren(node.children, nodeId, nodes, basePointer);
  return { parentId, childIds };
}

function readParent(
  parent: unknown,
  nodeId: string,
  nodes: Map<string, JsonRecord>,
  basePointer: string
): string | null {
  if (parent === null) return null;
  assertSafeIdentifier(parent, pointerAt(basePointer, 'mapping', nodeId, 'parent'));
  if (!nodes.has(parent))
    fail('parent-missing', `Node ${nodeId} points to missing parent ${parent}.`);
  return parent;
}

function readChildren(
  children: unknown,
  nodeId: string,
  nodes: Map<string, JsonRecord>,
  basePointer: string
): string[] {
  if (!Array.isArray(children))
    fail('malformed-node-links', `Node ${nodeId} children must be an array.`);
  const childIds = children.map((child, index) => {
    assertSafeIdentifier(
      child,
      pointerAt(basePointer, 'mapping', nodeId, 'children', String(index))
    );
    if (!nodes.has(child))
      fail('child-missing', `Node ${nodeId} points to missing child ${child}.`);
    return child;
  });
  if (new Set(childIds).size !== childIds.length)
    fail('duplicate-child', `Node ${nodeId} repeats a child ID.`);
  return childIds;
}

function validateGraphLinks(
  links: Map<string, { parentId: string | null; childIds: string[] }>
): void {
  links.forEach((link, nodeId) => validateNodeSymmetry(links, nodeId, link));
  validateCycles(links);
  if (![...links.values()].some(link => link.parentId === null)) {
    fail('missing-root', 'ChatGPT graph does not have a null-parent root.');
  }
}

function validateNodeSymmetry(
  links: Map<string, { parentId: string | null; childIds: string[] }>,
  nodeId: string,
  link: { parentId: string | null; childIds: string[] }
): void {
  if (link.parentId !== null && !links.get(link.parentId)?.childIds.includes(nodeId)) {
    fail('parent-child-asymmetry', `Parent ${link.parentId} does not list child ${nodeId}.`);
  }
  for (const childId of link.childIds) {
    if (links.get(childId)?.parentId !== nodeId) {
      fail('child-parent-asymmetry', `Child ${childId} does not point back to parent ${nodeId}.`);
    }
  }
}

function validateCycles(links: Map<string, { parentId: string | null; childIds: string[] }>): void {
  const states = new Map<string, 'visiting' | 'visited'>();
  for (const startId of links.keys()) {
    if (states.get(startId) === 'visited') continue;
    const stack: Array<{ nodeId: string; exiting: boolean }> = [
      { nodeId: startId, exiting: false },
    ];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) break;
      if (frame.exiting) {
        states.set(frame.nodeId, 'visited');
        continue;
      }

      const state = states.get(frame.nodeId);
      if (state === 'visiting') {
        fail('graph-cycle', `ChatGPT graph contains a cycle at ${frame.nodeId}.`);
      }
      if (state === 'visited') continue;

      states.set(frame.nodeId, 'visiting');
      stack.push({ nodeId: frame.nodeId, exiting: true });
      const children = links.get(frame.nodeId)?.childIds ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ nodeId: children[index], exiting: false });
      }
    }
  }
}

function normalizeNodes(
  rawNodes: Map<string, JsonRecord>,
  links: Map<string, { parentId: string | null; childIds: string[] }>,
  basePointer: string,
  context: BlockContext
): Record<string, ArchiveNode> {
  const nodes: Record<string, ArchiveNode> = {};
  rawNodes.forEach((rawNode, nodeId) => {
    const pointer = pointerAt(basePointer, 'mapping', nodeId);
    const link = links.get(nodeId);
    if (!link) fail('malformed-graph', `Missing links for node ${nodeId}.`);
    nodes[nodeId] = normalizeNode(rawNode, nodeId, link, pointer, context);
  });
  return nodes;
}

function normalizeNode(
  rawNode: JsonRecord,
  nodeId: string,
  link: { parentId: string | null; childIds: string[] },
  pointer: string,
  context: BlockContext
): ArchiveNode {
  if (!hasOwn(rawNode, 'message')) fail('malformed-node', `Node ${nodeId} is missing message.`);
  const node: ArchiveNode = {
    id: nodeId,
    parentId: link.parentId,
    childIds: link.childIds,
    sourceRefs: [sourceRef(context, 'node', nodeId, pointer)],
    extensions: {
      openai: providerFields(
        rawNode,
        new Set(['id', 'parent', 'children', 'message']),
        context.privacy,
        pointer
      ),
    },
  };
  if (rawNode.message !== null)
    node.message = normalizeMessage(
      rawNode.message,
      nodeId,
      pointerAt(pointer, 'message'),
      context
    );
  return node;
}

function normalizeMessage(
  raw: unknown,
  nodeId: string,
  pointer: string,
  context: BlockContext
): ArchiveMessage {
  const message = requireRecord(raw, pointer, 'malformed-message');
  assertSafeIdentifier(message.id, pointerAt(pointer, 'id'));
  const author = requireRecord(message.author, pointerAt(pointer, 'author'), 'malformed-author');
  const metadata = hasOwn(message, 'metadata')
    ? requireRecord(message.metadata, pointerAt(pointer, 'metadata'), 'malformed-metadata')
    : {};
  if (!hasOwn(message, 'content'))
    fail('missing-content', `Message ${message.id} is missing content.`);
  const normalized: ArchiveMessage = {
    id: message.id,
    author: {
      role: requireBoundedString(author.role, pointerAt(pointer, 'author', 'role')),
      name: nullableString(author, 'name', pointerAt(pointer, 'author', 'name')),
    },
    recipient: nullableString(message, 'recipient', pointerAt(pointer, 'recipient')),
    channel: nullableString(message, 'channel', pointerAt(pointer, 'channel')),
    createdAt: optionalTimestamp(message, ['create_time', 'created_at', 'createdAt'], pointer),
    updatedAt: optionalTimestamp(message, ['update_time', 'updated_at', 'updatedAt'], pointer),
    status: nullableString(message, 'status', pointerAt(pointer, 'status')),
    model: messageModel(message, metadata, pointer),
    visibility: messageVisibility(message, metadata, pointer),
    blocks: [],
    sourceRefs: [sourceRef(context, 'message', message.id, pointer)],
    extensions: { openai: messageExtensions(message, author, metadata, pointer, context) },
  };
  if (message.content !== null)
    normalized.blocks.push(
      ...normalizeContent(message.content, pointerAt(pointer, 'content'), message.id, context)
    );
  appendMetadataBlocks(
    normalized.blocks,
    metadata,
    pointerAt(pointer, 'metadata'),
    message.id,
    context
  );
  return normalized;
}

function messageExtensions(
  message: JsonRecord,
  author: JsonRecord,
  metadata: JsonRecord,
  pointer: string,
  context: BlockContext
): Record<string, JsonValue> {
  return {
    author: providerFields(
      author,
      new Set(['role', 'name']),
      context.privacy,
      pointerAt(pointer, 'author')
    ),
    metadata: providerFields(
      metadata,
      mappedMetadataFields(),
      context.privacy,
      pointerAt(pointer, 'metadata')
    ),
    contentMetadata:
      message.content === null
        ? {}
        : contentProviderFields(
            requireRecord(message.content, pointerAt(pointer, 'content'), 'malformed-content'),
            context,
            pointerAt(pointer, 'content')
          ),
    providerFields: providerFields(message, mappedMessageFields(), context.privacy, pointer),
  };
}

function mappedMessageFields(): Set<string> {
  return new Set([
    'id',
    'author',
    'recipient',
    'channel',
    'create_time',
    'created_at',
    'createdAt',
    'update_time',
    'updated_at',
    'updatedAt',
    'status',
    'model',
    'model_slug',
    'visibility',
    'content',
    'metadata',
  ]);
}

function mappedMetadataFields(): Set<string> {
  return new Set([
    'model',
    'model_slug',
    'is_visually_hidden',
    'is_visible',
    'attachments',
    'files',
    'citations',
    'content_references',
  ]);
}

function messageModel(message: JsonRecord, metadata: JsonRecord, pointer: string): string | null {
  const actualAliases: Array<[JsonRecord, string, string]> = [
    [message, 'model', pointer],
    [message, 'model_slug', pointer],
    [metadata, 'model', pointerAt(pointer, 'metadata')],
    [metadata, 'model_slug', pointerAt(pointer, 'metadata')],
  ];
  if (actualAliases.some(([record, field]) => hasOwn(record, field))) {
    return nullableAliasedString(actualAliases, 'ambiguous-model');
  }
  return nullableAliasedString(
    [[metadata, 'default_model_slug', pointerAt(pointer, 'metadata')]],
    'ambiguous-default-model'
  );
}

function messageVisibility(
  message: JsonRecord,
  metadata: JsonRecord,
  pointer: string
): string | null {
  const explicit = nullableAliasedString(
    [[message, 'visibility', pointer]],
    'ambiguous-visibility'
  );
  if (explicit !== null || hasOwn(message, 'visibility')) return explicit;
  const values = visibilityValues(metadata, pointer);
  if (values.length === 0) return null;
  if (new Set(values).size !== 1)
    fail('ambiguous-visibility', 'ChatGPT visibility fields disagree.');
  return values[0];
}

function visibilityValues(metadata: JsonRecord, pointer: string): string[] {
  const values: string[] = [];
  if (hasOwn(metadata, 'is_visually_hidden'))
    values.push(
      booleanVisibility(
        metadata.is_visually_hidden,
        pointerAt(pointer, 'metadata', 'is_visually_hidden'),
        true
      )
    );
  if (hasOwn(metadata, 'is_visible'))
    values.push(
      booleanVisibility(metadata.is_visible, pointerAt(pointer, 'metadata', 'is_visible'), false)
    );
  return values;
}

function booleanVisibility(value: unknown, pointer: string, inverted: boolean): string {
  if (typeof value !== 'boolean') fail('malformed-visibility', `${pointer} must be boolean.`);
  return value === inverted ? 'hidden' : 'visible';
}
