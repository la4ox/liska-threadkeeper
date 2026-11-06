/** Unwired, single-request executor. No persistence, assessment, resolver pass or retry. */
import { conversationKeyInput } from '../../archive/catalog/conversation-key';
import type { ChatGptCaptureResponse } from '../../lib/chatgpt-capture-contract';
import {
  validatePreparedChatGpt,
  type PreparedChatGptCapture,
} from '../../resumability-journal/capture-handoff';
import {
  captureChatGptArchive,
  ChatGptCurrentBranchError,
  type ChatGptArchiveCapture,
} from './chatgpt-current-branch';
import { sha256Hex } from './response';

export interface AdmittedChatGptCapture extends PreparedChatGptCapture {
  readonly capture: ChatGptArchiveCapture;
}
export interface AdmittedChatGptCaptureDependencies {
  readonly requestCapture: (conversationId: string) => Promise<ChatGptCaptureResponse>;
  readonly now?: () => Date;
}

function verifyResult(
  capture: ChatGptArchiveCapture,
  prepared: PreparedChatGptCapture,
  legacyDigest: string
): void {
  const { captureId, admission } = prepared.operation;
  const context = capture.assetExportContext;
  const manifest = context?.rawCaptureBundle.manifest;
  if (
    !context ||
    context.conversationId !== admission.conversationId ||
    manifest?.provider !== admission.provider ||
    manifest.conversationId !== admission.conversationId ||
    manifest.captureId !== captureId ||
    capture.archiveCompanion.captureId !== captureId ||
    capture.archiveCompanion.conversationKey !== legacyDigest ||
    capture.archive.conversation.provider !== admission.provider ||
    capture.archive.conversation.id !== admission.conversationId ||
    capture.archive.inputs.length !== 1 ||
    capture.archive.inputs[0].captureId !== captureId
  )
    throw new ChatGptCurrentBranchError('capture-integrity-failed', {
      archiveCompanion: capture.archiveCompanion,
    });
}

async function verifyIdentity(prepared: PreparedChatGptCapture): Promise<string> {
  try {
    const { provider, conversationId, conversationKey } = prepared.operation.admission;
    const digest = await sha256Hex(conversationKeyInput(provider, conversationId));
    if (conversationKey !== `liska-conversation-key/1:${digest}`) throw new Error();
    return await sha256Hex(new TextEncoder().encode(conversationId));
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
}

export async function capturePreparedChatGpt(
  input: PreparedChatGptCapture,
  dependencies: AdmittedChatGptCaptureDependencies
): Promise<AdmittedChatGptCapture> {
  const request = dependencies?.requestCapture;
  const now = dependencies?.now;
  const prepared = validatePreparedChatGpt(input);
  if (typeof request !== 'function' || (now !== undefined && typeof now !== 'function'))
    throw new ChatGptCurrentBranchError('capture-failed');
  const { operation, producerIntent } = prepared;
  const { conversationId } = operation.admission;
  const legacyDigest = await verifyIdentity(prepared);
  validatePreparedChatGpt(prepared);
  const capture = await captureChatGptArchive(conversationId, {
    requestCapture: id => {
      validatePreparedChatGpt(prepared);
      if (id !== conversationId) throw new ChatGptCurrentBranchError('capture-integrity-failed');
      return request(id);
    },
    createCaptureId: () => operation.captureId,
    ...(now && { now }),
  });
  verifyResult(capture, prepared, legacyDigest);
  return Object.freeze({ operation, producerIntent, capture });
}
