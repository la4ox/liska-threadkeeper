import { EXPORT_CLEANUP_ACTIONS } from './export-operation-contract';

export interface ContentExportScope {
  id: string;
  route: string;
  abort: AbortController;
  closed: boolean;
}
export interface ContentTextPreviewScope {
  id: string;
  route: string;
  abort: AbortController;
  closed: boolean;
}
export type ContentOperationGeneration =
  | { readonly kind: 'export'; readonly scope: ContentExportScope }
  | { readonly kind: 'text-preview'; readonly scope: ContentTextPreviewScope };
let current: ContentExportScope | undefined;
let currentPreview: ContentTextPreviewScope | undefined;
const preparedMessages = new WeakSet<object>();
/** Only the claimed content client installs this scope; popup bundles never install one. */
export function installExportScope(scope: ContentExportScope): void {
  if (current || currentPreview) throw new Error('A capture generation is still active');
  current = scope;
}
export function captureExportScope(): ContentExportScope | undefined {
  return current;
}
export function clearExportScope(scope: ContentExportScope): void {
  scope.closed = true;
  if (current === scope) current = undefined;
}

export function installTextPreviewScope(scope: ContentTextPreviewScope): void {
  if (current || currentPreview) throw new Error('A capture generation is still active');
  currentPreview = scope;
}

export function captureTextPreviewScope(): ContentTextPreviewScope | undefined {
  return currentPreview;
}

/** Snapshot the one active generation before a promise may outlive its content client. */
export function captureOperationGeneration(): ContentOperationGeneration | undefined {
  if (currentPreview) return { kind: 'text-preview', scope: currentPreview };
  return current ? { kind: 'export', scope: current } : undefined;
}

export function clearTextPreviewScope(scope: ContentTextPreviewScope): void {
  scope.closed = true;
  if (currentPreview === scope) currentPreview = undefined;
}
/** Snapshot before any asynchronous boundary; late cleanup keeps its original generation. */
export function withExportGeneration<
  T extends {
    action: string;
    exportOperationId?: string;
    textPreviewCaptureId?: string;
  },
>(message: T, scope = current): T & { exportOperationId?: string; textPreviewCaptureId?: string } {
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

function withTextPreviewGeneration<
  T extends {
    action: string;
    exportOperationId?: string;
    textPreviewCaptureId?: string;
  },
>(
  message: T,
  scope = currentPreview
): T & { exportOperationId?: string; textPreviewCaptureId?: string } {
  if (!scope) return message;
  const cleanup = message.action === 'abortStagedArchiveArtifact';
  if (
    !cleanup &&
    (scope.closed || scope.abort.signal.aborted || window.location.href !== scope.route)
  ) {
    scope.abort.abort();
    throw new Error('Text preview capture stopped or conversation changed');
  }
  return { ...message, textPreviewCaptureId: scope.id };
}

/** Reapply an already-snapshotted generation to exact late cleanup. */
export function withOperationGeneration<
  T extends {
    action: string;
    exportOperationId?: string;
    textPreviewCaptureId?: string;
  },
>(
  message: T,
  generation = captureOperationGeneration()
): T & { exportOperationId?: string; textPreviewCaptureId?: string } {
  if (generation?.kind === 'export') return withExportGeneration(message, generation.scope);
  if (generation?.kind === 'text-preview')
    return withTextPreviewGeneration(message, generation.scope);
  return message;
}

/** Synchronous admission before a caller relinquishes an exact temporary stage. */
export function prepareRuntimeMessage<
  T extends {
    action: string;
    exportOperationId?: string;
    textPreviewCaptureId?: string;
  },
>(message: T): T {
  try {
    if (!chrome.runtime?.id) throw new Error('invalid context');
  } catch {
    throw new Error('Extension context invalidated. Please reload the page.');
  }
  const prepared = withOperationGeneration(message);
  preparedMessages.add(prepared);
  return prepared;
}

/** Consume the synchronous preparation without a second, post-transfer guard. */
export function takePreparedRuntimeMessage<
  T extends {
    action: string;
    exportOperationId?: string;
    textPreviewCaptureId?: string;
  },
>(message: T): T {
  const prepared = preparedMessages.has(message) ? message : prepareRuntimeMessage(message);
  preparedMessages.delete(prepared);
  return prepared;
}
