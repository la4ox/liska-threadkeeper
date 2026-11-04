import { PDF_RESULT_SCHEMA, PdfRenderError, isPdfOperationToken } from './pdf-contract';
import { renderPdfRequest } from './pdf-core';

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
      operationToken = Object.getOwnPropertyDescriptor(event.data, 'operationToken')?.value;
      const result = await renderPdfRequest(event.data);
      scope.postMessage(result, [result.bytes]);
    } catch (error) {
      if (isPdfOperationToken(operationToken))
        scope.postMessage(
          {
            schema: PDF_RESULT_SCHEMA,
            operationToken,
            ok: false,
            error: error instanceof PdfRenderError ? error.code : 'pdf-worker-failed',
          },
          []
        );
    } finally {
      scope.close();
    }
  })();
};
