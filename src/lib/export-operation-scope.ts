import { EXPORT_CLEANUP_ACTIONS } from './export-operation-contract';

export interface ContentExportScope {
  id: string;
  route: string;
  abort: AbortController;
  closed: boolean;
}
let current: ContentExportScope | undefined;
const preparedMessages = new WeakSet<object>();
/** Only the claimed content client installs this scope; popup bundles never install one. */
export function installExportScope(scope: ContentExportScope): void {
  if (current) throw new Error('An export generation is still active');
  current = scope;
}
export function captureExportScope(): ContentExportScope | undefined {
  return current;
}
export function clearExportScope(scope: ContentExportScope): void {
  scope.closed = true;
  if (current === scope) current = undefined;
}
/** Snapshot before any asynchronous boundary; late cleanup keeps its original generation. */
export function withExportGeneration<T extends { action: string; exportOperationId?: string }>(
  message: T,
  scope = current
): T & { exportOperationId?: string } {
  if (!scope) return message;
  if (
    !EXPORT_CLEANUP_ACTIONS.has(message.action) &&
    (scope.closed || scope.abort.signal.aborted || window.location.href !== scope.route)
  ) {
    scope.abort.abort();
    throw new Error('Export stopped or conversation changed');
  }
  return { ...message, exportOperationId: scope.id };
}

/** Synchronous admission before a caller relinquishes an exact temporary stage. */
export function prepareRuntimeMessage<T extends { action: string; exportOperationId?: string }>(
  message: T
): T {
  try {
    if (!chrome.runtime?.id) throw new Error('invalid context');
  } catch {
    throw new Error('Extension context invalidated. Please reload the page.');
  }
  const prepared = withExportGeneration(message);
  preparedMessages.add(prepared);
  return prepared;
}

/** Consume the synchronous preparation without a second, post-transfer guard. */
export function takePreparedRuntimeMessage<
  T extends { action: string; exportOperationId?: string },
>(message: T): T {
  const prepared = preparedMessages.has(message) ? message : prepareRuntimeMessage(message);
  preparedMessages.delete(prepared);
  return prepared;
}
