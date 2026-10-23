/**
 * Attachment policy reconciles content-free route evidence with the graph
 * envelope and its conversation-level owner aliases. Raw-only callers retain
 * their separate fail-closed guard. No owner identity leaves this module.
 */

const OWNER_ALIASES = [
  'gizmo_id',
  'gizmoId',
  'project_id',
  'projectId',
  'conversation_template_id',
  'conversationTemplateId',
] as const;

/** Content-free runtime evidence; owner paths and identities stay background-only. */
export type ChatGptRouteFamily = 'standard' | 'custom-gpt' | 'project';

export function isChatGptRouteFamily(value: unknown): value is ChatGptRouteFamily {
  return value === 'standard' || value === 'custom-gpt' || value === 'project';
}

export type ChatGptOwnerContextPolicy =
  | { allowAttachments: true; reason: 'ordinary-conversation' }
  | {
      allowAttachments: false;
      reason:
        | 'invalid-graph'
        | 'ambiguous-graph'
        | 'owner-context'
        | 'wrapper-owner-context'
        | 'nonstandard-route';
    };

interface ChatGptOwnerContextSelection {
  conversation: Record<string, unknown>;
  wrapper?: Record<string, unknown>;
}

type OwnDataProperty =
  | { kind: 'missing' }
  | { kind: 'accessor' }
  | { kind: 'value'; value: unknown };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataProperty(value: Record<string, unknown>, key: string): OwnDataProperty {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return { kind: 'missing' };
  return 'value' in descriptor ? { kind: 'value', value: descriptor.value } : { kind: 'accessor' };
}

function hasAccessorProperty(...properties: OwnDataProperty[]): boolean {
  return properties.some(property => property.kind === 'accessor');
}

function isSelectedGraph(
  conversation: unknown,
  mapping: OwnDataProperty
): conversation is Record<string, unknown> {
  return isPlainRecord(conversation) && mapping.kind === 'value' && isPlainRecord(mapping.value);
}

function hasOwnerEvidence(conversation: Record<string, unknown>): boolean {
  // Missing, null, and the exact empty string are the only absent forms.
  // All nonempty strings, malformed values, conflicting aliases, and combined
  // owners fail closed alike; none can establish ordinary-chat authority.
  return OWNER_ALIASES.some(field => {
    const descriptor = Object.getOwnPropertyDescriptor(conversation, field);
    if (!descriptor) return false;
    if (!('value' in descriptor)) return true;
    return descriptor.value !== null && descriptor.value !== '';
  });
}

function selectChatGptOwnerContext(
  raw: unknown
): ChatGptOwnerContextSelection | ChatGptOwnerContextPolicy {
  if (!isPlainRecord(raw)) return { allowAttachments: false, reason: 'invalid-graph' };
  const mappingProperty = ownDataProperty(raw, 'mapping');
  const nestedProperty = ownDataProperty(raw, 'conversation');
  if (hasAccessorProperty(mappingProperty, nestedProperty)) {
    return { allowAttachments: false, reason: 'invalid-graph' };
  }
  const direct = mappingProperty.kind !== 'missing';
  const nested = nestedProperty.kind === 'value' ? nestedProperty.value : undefined;
  if (nestedProperty.kind === 'value' && !isPlainRecord(nested)) {
    return { allowAttachments: false, reason: 'invalid-graph' };
  }
  const nestedMapping = isPlainRecord(nested)
    ? ownDataProperty(nested, 'mapping')
    : ({ kind: 'missing' } as const);
  if (nestedMapping.kind === 'accessor') {
    return { allowAttachments: false, reason: 'invalid-graph' };
  }
  const nestedGraph = nestedMapping.kind !== 'missing';
  if (direct === nestedGraph) return { allowAttachments: false, reason: 'ambiguous-graph' };
  const conversation = direct ? raw : nested;
  const selectedMapping = direct ? mappingProperty : nestedMapping;
  if (!isSelectedGraph(conversation, selectedMapping)) {
    return { allowAttachments: false, reason: 'invalid-graph' };
  }
  return {
    conversation,
    wrapper: direct ? (isPlainRecord(nested) ? nested : undefined) : raw,
  };
}

export function classifyChatGptOwnerContext(
  raw: unknown,
  routeFamily?: ChatGptRouteFamily
): ChatGptOwnerContextPolicy {
  // Raw-only callers retain their independent guard. Runtime contexts must
  // additionally prove a standard route, even if the raw omits owner fields.
  if (routeFamily !== undefined && routeFamily !== 'standard') {
    return { allowAttachments: false, reason: 'nonstandard-route' };
  }
  const selected = selectChatGptOwnerContext(raw);
  if ('allowAttachments' in selected) return selected;
  if (selected.wrapper && hasOwnerEvidence(selected.wrapper)) {
    return { allowAttachments: false, reason: 'wrapper-owner-context' };
  }
  if (hasOwnerEvidence(selected.conversation)) {
    return { allowAttachments: false, reason: 'owner-context' };
  }
  return { allowAttachments: true, reason: 'ordinary-conversation' };
}

export function allowsChatGptAttachmentAcquisition(
  raw: unknown,
  routeFamily?: ChatGptRouteFamily
): boolean {
  return classifyChatGptOwnerContext(raw, routeFamily).allowAttachments;
}
