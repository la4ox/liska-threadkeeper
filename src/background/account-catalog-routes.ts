import { collectClaudeAccountCatalog } from './claude-account-collector';
import { isAuthorizedClaudeListProbeSender } from './claude-list-probe';
import { listPickerSlots, copyLegacySlot } from './account-slot-actions';
import {
  snapshotSlotRequest,
  snapshotSlotInventory,
  snapshotAdoptionReceipt,
  slotInventory,
  adoptionReceipt,
} from '../lib/account-slot-contract';
import {
  collectorSummary,
  snapshotCollectorSummary,
  snapshotCollectorMessage,
} from '../lib/claude-account-collector-contract';

type Send = (value: unknown) => void;
function exactPopup(sender: chrome.runtime.MessageSender): boolean {
  return (
    (sender.frameId === undefined || sender.frameId === 0) &&
    (sender.documentLifecycle === undefined || sender.documentLifecycle === 'active') &&
    isAuthorizedClaudeListProbeSender(
      sender,
      chrome.runtime.id,
      chrome.runtime.getURL('src/popup/index.html')
    )
  );
}
type Failure = 'invalid-sender' | 'invalid-message' | 'result-invalid';
function replyChannel<T>(
  send: Send,
  snapshot: (value: unknown) => T | undefined,
  failure: (code: Failure) => T
) {
  const reply = (raw: unknown) => {
    const receipt = snapshot(raw) ?? failure('result-invalid');
    try {
      send(receipt);
    } catch {
      /* popup closure is not cancellation */
    }
  };
  return {
    reject(code: Failure) {
      reply(failure(code));
      return false;
    },
    run(work: Promise<T>) {
      void work.then(reply, () => reply(failure('result-invalid')));
      return true;
    },
  };
}
interface CollectionServices {
  operations: Set<number>;
  permitted: () => Promise<boolean>;
}

/** Inspect the original envelope before ordinary generation stripping. Undefined means no catalog route. */
export function routeAccountCatalogMessage(
  message: unknown,
  entry: PropertyDescriptor | undefined,
  sender: chrome.runtime.MessageSender,
  send: Send,
  services: CollectionServices
): boolean | undefined {
  if (!entry) return;
  switch (entry.value) {
    case 'collectClaudeAccountCatalog': {
      const channel = replyChannel(send, snapshotCollectorSummary, collectorSummary);
      if (!exactPopup(sender)) return channel.reject('invalid-sender');
      const request = snapshotCollectorMessage(message, entry);
      if (!request) return channel.reject('invalid-message');
      return channel.run(
        collectClaudeAccountCatalog({ ...services, source: request.source, slot: request.slot })
      );
    }
    case 'listAccountCatalogSlots': {
      const channel = replyChannel(send, snapshotSlotInventory, slotInventory);
      if (!exactPopup(sender)) return channel.reject('invalid-sender');
      if (snapshotSlotRequest(message, entry)?.action !== 'listAccountCatalogSlots')
        return channel.reject('invalid-message');
      return channel.run(listPickerSlots());
    }
    case 'adoptLegacyClaudeCatalog': {
      const channel = replyChannel(send, snapshotAdoptionReceipt, adoptionReceipt);
      if (!exactPopup(sender)) return channel.reject('invalid-sender');
      const request = snapshotSlotRequest(message, entry);
      if (request?.action !== 'adoptLegacyClaudeCatalog') return channel.reject('invalid-message');
      return channel.run(copyLegacySlot(request.slot));
    }
  }
}
