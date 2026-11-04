import { DOCX_RESULT_SCHEMA, DocxRenderError, isDocxOperationToken } from './docx-contract';
import { renderDocxRequest } from './docx-core';

// This entry is bundled separately by Vite. No page, provider, destination, or storage imports.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  close(): void;
};
let taken = false;
scope.onmessage = event => {
  if (taken) return;
  taken = true;
  void (async () => {
    let operationToken: unknown;
    try {
      // Read a data descriptor only, even if the rest of the exact request is invalid.
      operationToken = Object.getOwnPropertyDescriptor(event.data, 'operationToken')?.value;
      const result = await renderDocxRequest(event.data);
      scope.postMessage(result, [result.bytes]);
    } catch (error) {
      if (isDocxOperationToken(operationToken))
        scope.postMessage(
          {
            schema: DOCX_RESULT_SCHEMA,
            operationToken,
            ok: false,
            error: error instanceof DocxRenderError ? error.code : 'docx-worker-failed',
          },
          []
        );
    } finally {
      scope.close();
    }
  })();
};
