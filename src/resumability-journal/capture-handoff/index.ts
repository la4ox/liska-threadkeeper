/** Unwired single-capture reservation. Neither dispatch authority nor durable uniqueness. */
import {
  admitCanonicalCatalog,
  type AdmissionIdentity,
  type CatalogSha256,
} from '../../archive/catalog/admission';
import { conversationKeyInput } from '../../archive/catalog/conversation-key';
import { isChatGptCaptureId, isChatGptConversationId } from '../../lib/chatgpt-capture-contract';
import {
  snapshotChatGptProducerIntent,
  type ChatGptProducerIntent,
  type ProducerDestination,
} from '../../lib/chatgpt-producer-evidence';
import { detachProducerData, producerList, producerRecord } from '../../lib/producer-evidence-data';
import {
  admitNewCaptureOperation,
  FILE_ASSURANCE,
  OBSIDIAN_ASSURANCE,
  OPERATION_SCHEMA,
  STRICT_COMPLETENESS,
  type NewCaptureOperation,
} from '../purpose';

export interface ChatGptNewCaptureRequest {
  readonly selection: AdmissionIdentity;
  readonly operationId: string;
  readonly attemptId: string;
  readonly captureId: string;
  readonly requiredDestinations: readonly ProducerDestination[];
}
export interface PreparedChatGptCapture {
  readonly operation: NewCaptureOperation;
  readonly producerIntent: ChatGptProducerIntent;
}
export class CaptureHandoffError extends Error {
  constructor(
    readonly code: 'invalid-request' | 'selection-mismatch' | 'hash-failed' | 'invalid-handoff'
  ) {
    super(code);
    this.name = 'CaptureHandoffError';
  }
}

function checkIdentity(operation: NewCaptureOperation): void {
  if (
    operation.admission.provider !== 'chatgpt' ||
    !isChatGptConversationId(operation.admission.conversationId) ||
    !isChatGptCaptureId(operation.captureId)
  )
    throw new CaptureHandoffError('invalid-request');
}

/** The admitted operation is the only source of producer intent fields. */
function producerIntent(operation: NewCaptureOperation): ChatGptProducerIntent {
  checkIdentity(operation);
  return snapshotChatGptProducerIntent({
    operationId: operation.operationId,
    attemptId: operation.attemptId,
    captureId: operation.captureId,
    ...operation.admission,
    catalogSha256: operation.sourceSelection.catalogSha256,
    requiredDestinations: operation.destinations.map(item => item.destination),
  });
}

function snapshotRequest(input: ChatGptNewCaptureRequest): NewCaptureOperation {
  const request = producerRecord(detachProducerData(input), [
    'selection',
    'operationId',
    'attemptId',
    'captureId',
    'requiredDestinations',
  ]);
  const operation = admitNewCaptureOperation({
    schema: OPERATION_SCHEMA,
    purpose: 'new-capture',
    operationId: request.operationId,
    attemptId: request.attemptId,
    captureId: request.captureId,
    admission: request.selection,
    sourceSelection: { catalogSha256: '0'.repeat(64) },
    destinations: producerList(request.requiredDestinations, 2).map(destination => ({
      destination,
      assurance: destination === 'file' ? FILE_ASSURANCE : OBSIDIAN_ASSURANCE,
    })),
    completenessPolicy: STRICT_COMPLETENESS,
  });
  producerIntent(operation); // Also validate producer IDs before invoking the hash dependency.
  return operation;
}

/** A dependency owns only its copy; mutation or cancellation cannot change the admitted bytes. */
function checkedHash(hash: CatalogSha256, signal: AbortSignal): CatalogSha256 {
  return async input => {
    try {
      if (signal.aborted) throw new Error();
      const expected = new Uint8Array(input);
      const supplied = expected.slice();
      const digest = await hash(supplied, signal);
      if (
        signal.aborted ||
        typeof digest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(digest) ||
        supplied.length !== expected.length ||
        !expected.every((byte, index) => supplied[index] === byte)
      )
        throw new Error();
      return digest;
    } catch {
      throw new CaptureHandoffError('hash-failed');
    }
  };
}

/** Snapshot every caller-owned input and dependency reference before the first await. */
export async function prepareChatGptNewCapture(
  catalogBytes: Uint8Array,
  request: ChatGptNewCaptureRequest,
  dependencies: { readonly sha256: CatalogSha256; readonly signal: AbortSignal }
): Promise<PreparedChatGptCapture> {
  const bytes = new Uint8Array(catalogBytes);
  const hash = dependencies.sha256;
  const signal = dependencies.signal;
  const candidate = snapshotRequest(request);
  if (typeof hash !== 'function' || !signal || typeof signal.aborted !== 'boolean')
    throw new CaptureHandoffError('invalid-request');
  const ownedHash = checkedHash(hash, signal);
  const catalog = await admitCanonicalCatalog(bytes, signal, ownedHash);
  const selection = candidate.admission;
  if (
    !catalog.identities.some(
      identity =>
        identity.provider === selection.provider &&
        identity.conversationId === selection.conversationId &&
        identity.conversationKey === selection.conversationKey
    )
  )
    throw new CaptureHandoffError('selection-mismatch');
  const digest = await ownedHash(
    conversationKeyInput(selection.provider, selection.conversationId),
    signal
  );
  // This continuation runs after checkedHash's own cancellation check; no await follows.
  if (signal.aborted) throw new CaptureHandoffError('hash-failed');
  if (selection.conversationKey !== `liska-conversation-key/1:${digest}`)
    throw new CaptureHandoffError('selection-mismatch');
  const operation = admitNewCaptureOperation({
    ...candidate,
    sourceSelection: { catalogSha256: catalog.catalogSha256 },
  });
  return Object.freeze({ operation, producerIntent: producerIntent(operation) });
}

function deeplyFrozen(value: unknown): boolean {
  return (
    !value ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
  );
}

/** Re-admit detached data, require exact canonical consistency, and retain the immutable pair. */
export function validatePreparedChatGpt(input: unknown): PreparedChatGptCapture {
  try {
    const data = producerRecord(detachProducerData(input), ['operation', 'producerIntent']);
    const operation = admitNewCaptureOperation(data.operation);
    const supplied = snapshotChatGptProducerIntent(data.producerIntent);
    if (
      JSON.stringify(supplied) !== JSON.stringify(producerIntent(operation)) ||
      JSON.stringify(data.operation) !== JSON.stringify(detachProducerData(operation)) ||
      !deeplyFrozen(input)
    )
      throw new Error();
    return input as PreparedChatGptCapture;
  } catch {
    throw new CaptureHandoffError('invalid-handoff');
  }
}
