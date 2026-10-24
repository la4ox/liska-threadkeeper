/** One already-built branch artifact transport; no preparation or bundle-completion claim. */
import { jsonUtf8ByteLength } from '../lib/byte-size';
import { MAX_EXTENSION_MESSAGE_SIZE } from '../lib/constants';
import {
  buildDerivedBranchOutputReceipt,
  matchDerivedBranchOutputReceipt,
  snapshotDerivedBranchHtmlArtifact,
} from '../lib/derived-branch-presentation-contract';
import {
  snapshotDerivedBranchHtmlPersistResponse,
  type DerivedBranchHtmlPersistResponse,
} from '../lib/derived-branch-persistence-contract';
import type { DerivedOutputIdentity } from '../lib/derived-presentation-contract';
import { isSerializedSyncSettingsSnapshot } from '../lib/sync-settings-snapshot';
import type { ExtensionMessage } from '../lib/types';

type BranchHtmlMessage = Extract<
  ExtensionMessage,
  { action: 'persistDerivedBranchHtmlPresentation' }
>;
export type DerivedBranchHtmlSend = (message: BranchHtmlMessage) => Promise<unknown>;
export type DerivedBranchHtmlPersistenceObservation =
  | { state: 'not-dispatched' }
  | { state: 'unconfirmed' }
  | { state: 'observed'; response: DerivedBranchHtmlPersistResponse };

/** Two sequential 30s Downloads windows plus offscreen/path checks; expiry never cancels or retries. */
export const DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS = 120_000;

/** Keep this new closed response separate from legacy MultiOutputResponse messaging. */
function sendBranchHtmlMessage(message: BranchHtmlMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (success: boolean, response?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (success) resolve(response);
      else reject(new Error('derived-branch-html-transport-unconfirmed'));
    };
    const timer = setTimeout(() => settle(false), DERIVED_BRANCH_HTML_DEFAULT_SEND_DEADLINE_MS);
    try {
      if (!chrome.runtime?.id) {
        settle(false);
        return;
      }
      chrome.runtime.sendMessage(message, response => {
        if (settled) return;
        try {
          if (!chrome.runtime?.id || chrome.runtime.lastError) settle(false);
          else settle(true, response);
        } catch {
          settle(false);
        }
      });
    } catch {
      settle(false);
    }
  });
}

/** Preflight is synchronous and detached; only one attempted send can produce an observation. */
export async function persistDerivedBranchHtmlArtifactForFile(
  expectedIdentity: DerivedOutputIdentity,
  value: unknown,
  expectedSyncSettingsSnapshot: string,
  send: DerivedBranchHtmlSend = sendBranchHtmlMessage
): Promise<DerivedBranchHtmlPersistenceObservation> {
  let message: BranchHtmlMessage;
  try {
    if (
      typeof send !== 'function' ||
      !isSerializedSyncSettingsSnapshot(expectedSyncSettingsSnapshot)
    )
      return { state: 'not-dispatched' };
    const artifact = snapshotDerivedBranchHtmlArtifact(value);
    if (!artifact) return { state: 'not-dispatched' };
    // The strict receipt builder snapshots caller identity through own data descriptors.
    // Match against its detached identity, never against the caller object again.
    const receipt = buildDerivedBranchOutputReceipt(expectedIdentity, artifact);
    const identity = {
      source: receipt.source,
      captureId: receipt.captureId,
      conversationKey: receipt.conversationKey,
    };
    if (!matchDerivedBranchOutputReceipt(receipt, identity, artifact))
      return { state: 'not-dispatched' };
    message = {
      action: 'persistDerivedBranchHtmlPresentation',
      reportDurableWriteOutcome: true,
      ...identity,
      expectedSyncSettingsSnapshot,
      artifact,
      outputs: ['file'],
    };
    if (jsonUtf8ByteLength(message) > MAX_EXTENSION_MESSAGE_SIZE)
      return { state: 'not-dispatched' };
  } catch {
    return { state: 'not-dispatched' };
  }
  try {
    const response = snapshotDerivedBranchHtmlPersistResponse(await send(message));
    return response ? { state: 'observed', response } : { state: 'unconfirmed' };
  } catch {
    return { state: 'unconfirmed' };
  }
}
