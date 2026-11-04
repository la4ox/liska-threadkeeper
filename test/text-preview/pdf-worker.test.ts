// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PDF_LIMITS,
  PDF_REQUEST_SCHEMA,
  snapshotPdfReply,
  snapshotPdfRequest,
} from '../../src/text-preview/pdf-contract';
const token = '12345678-1234-4234-8234-123456789abc';
const request = () =>
  snapshotPdfRequest({
    schema: PDF_REQUEST_SCHEMA,
    operationToken: token,
    title: 'Worker ♥',
    rows: [{ role: 'user', htmlBody: '<p>Кириллица 🦊</p>' }],
    limits: PDF_LIMITS,
  });
async function workerScope() {
  const scope = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  vi.stubGlobal('self', scope);
  await import('../../src/text-preview/pdf-worker');
  return scope;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe('PDF one-shot module worker entry', () => {
  it('renders once, transfers exact bytes and closes', async () => {
    const scope = await workerScope();
    let received: unknown;
    scope.postMessage.mockImplementation((message, transfer) => {
      expect(transfer).toEqual([message.bytes]);
      received = structuredClone(message, { transfer });
      expect(message.bytes.byteLength).toBe(0);
    });
    const input = request();
    scope.onmessage!(new MessageEvent('message', { data: input }));
    scope.onmessage!(new MessageEvent('message', { data: input }));
    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledTimes(1));
    const result = snapshotPdfReply(received, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pageCount).toBe(1);
    expect(scope.postMessage).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['<script>private</script>', 'pdf-html-invalid'],
    ['<p>漢</p>', 'pdf-font-unsupported'],
  ])('returns value-free failure for %s', async (html, error) => {
    const scope = await workerScope();
    scope.onmessage!(
      new MessageEvent('message', {
        data: { ...request(), rows: [{ role: 'user', htmlBody: html }] },
      })
    );
    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledTimes(1));
    expect(scope.postMessage).toHaveBeenCalledWith(
      { schema: 'liska-pdf-result/1', operationToken: token, ok: false, error },
      []
    );
    expect(JSON.stringify(scope.postMessage.mock.calls)).not.toContain('private');
  });
  it('rejects extra caller document definitions and never calls token accessors', async () => {
    let scope = await workerScope();
    scope.onmessage!(new MessageEvent('message', { data: { ...request(), definition: {} } }));
    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledTimes(1));
    expect(scope.postMessage).toHaveBeenCalledWith(
      {
        schema: 'liska-pdf-result/1',
        operationToken: token,
        ok: false,
        error: 'pdf-input-invalid',
      },
      []
    );
    vi.resetModules();
    scope = await workerScope();
    const getter = vi.fn(() => token),
      input = { ...request() };
    Object.defineProperty(input, 'operationToken', { get: getter, enumerable: true });
    scope.onmessage!(new MessageEvent('message', { data: input }));
    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledTimes(1));
    expect(getter).not.toHaveBeenCalled();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });
});
