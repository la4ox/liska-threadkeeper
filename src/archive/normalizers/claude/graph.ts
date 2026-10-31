import type { ArchiveGraph } from '../../types';
import { fail, type ClaudeContext, type ClaudeRecord } from './contracts';
import { at, diagnostic, identifier, isRecord, ref } from './privacy';

export interface ParsedClaudeMessage {
  id: string;
  parentId: string | null;
  pointer: string;
  value: ClaudeRecord;
}

export interface ClaudeTopology {
  messages: ParsedClaudeMessage[];
  graph: ArchiveGraph;
  currentNodeId: string | null;
}

export function parseClaudeDetail(
  raw: unknown,
  expectedId: string
): ClaudeRecord & { chat_messages: unknown[] } {
  if (!isRecord(raw) || !Array.isArray(raw.chat_messages))
    fail('malformed-raw-artifact', 'Claude detail must be an object with chat_messages.');
  if (identifier(raw.uuid, '/uuid') !== expectedId)
    fail('conversation-id-mismatch', 'Claude detail UUID does not match the capture conversation.');
  if (raw.chat_messages.length > 20_000)
    fail('graph-node-limit-exceeded', 'Claude graph exceeds the 20000-node normalization limit.');
  return raw as ClaudeRecord & { chat_messages: unknown[] };
}

export function parseClaudeTopology(
  detail: ClaudeRecord & { chat_messages: unknown[] },
  context: ClaudeContext
): ClaudeTopology {
  const messages: ParsedClaudeMessage[] = [];
  const byId = new Map<string, ParsedClaudeMessage>();
  let previousIndex = -1;
  detail.chat_messages.forEach((value, arrayIndex) => {
    const pointer = at('/chat_messages', String(arrayIndex));
    if (!isRecord(value)) fail('malformed-message', `${pointer} must be an object.`);
    const id = identifier(value.uuid, at(pointer, 'uuid'));
    if (byId.has(id)) fail('duplicate-message-id', 'Claude message IDs must be unique.');
    if (!Object.prototype.hasOwnProperty.call(value, 'parent_message_uuid'))
      fail('missing-parent-id', `${pointer} must explicitly identify its parent or root.`);
    if (value.index !== undefined && value.index !== null) {
      if (
        !Number.isSafeInteger(value.index) ||
        (value.index as number) < 0 ||
        (value.index as number) <= previousIndex
      )
        fail(
          'invalid-message-index',
          'Supplied Claude message indices must be nonnegative and strictly increasing.'
        );
      previousIndex = value.index as number;
    }
    const parsed = {
      id,
      parentId:
        value.parent_message_uuid === null
          ? null
          : identifier(value.parent_message_uuid, at(pointer, 'parent_message_uuid')),
      pointer,
      value,
    };
    byId.set(id, parsed);
    messages.push(parsed);
  });
  const unresolved = messages.filter(
    message => message.parentId !== null && !byId.has(message.parentId)
  );
  if (unresolved.length > 1)
    fail('parent-message-missing', 'Claude detail contains more than one unresolved parent edge.');
  const sentinel = unresolved[0];
  if (sentinel) {
    diagnostic(
      context,
      'unresolved-root-parent',
      at(sentinel.pointer, 'parent_message_uuid'),
      'One unresolved provider parent was rebound to a canonical root; its original ID remains in the node extension.'
    );
  }
  assertAcyclic(messages, byId);
  const graph: ArchiveGraph = { rootIds: [], nodes: {} };
  for (const message of messages) {
    const parentId = message === sentinel ? null : message.parentId;
    graph.nodes[message.id] = {
      id: message.id,
      parentId,
      childIds: [],
      sourceRefs: [ref(context, 'node', message.pointer, message.id)],
      extensions: message === sentinel ? { claude: { parent_message_uuid: message.parentId } } : {},
    };
    if (parentId === null) graph.rootIds.push(message.id);
  }
  for (const message of messages) {
    const node = graph.nodes[message.id];
    if (node.parentId !== null) graph.nodes[node.parentId].childIds.push(message.id);
  }
  const currentNodeId =
    detail.current_leaf_message_uuid === null || detail.current_leaf_message_uuid === undefined
      ? null
      : identifier(detail.current_leaf_message_uuid, '/current_leaf_message_uuid');
  if (
    (messages.length && (currentNodeId === null || !byId.has(currentNodeId))) ||
    (!messages.length && currentNodeId !== null)
  )
    fail('current-message-missing', 'Claude current leaf is absent from chat_messages.');
  if (currentNodeId !== null && graph.nodes[currentNodeId].childIds.length)
    fail('current-message-not-leaf', 'Claude current leaf must not have child messages.');
  return { messages, graph, currentNodeId };
}

/** Iterative parent walk avoids stack overflow on long provider chains. */
function assertAcyclic(
  messages: ParsedClaudeMessage[],
  byId: Map<string, ParsedClaudeMessage>
): void {
  const done = new Set<string>();
  for (const start of messages) {
    const active = new Set<string>();
    let cursor: ParsedClaudeMessage | undefined = start;
    while (cursor && !done.has(cursor.id)) {
      if (active.has(cursor.id)) fail('graph-cycle', 'Claude parent topology contains a cycle.');
      active.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
    active.forEach(id => done.add(id));
  }
}
