// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOCX_LIMITS,
  DOCX_REQUEST_SCHEMA,
  snapshotDocxReply,
  snapshotDocxRequest,
} from '../../src/text-preview/docx-contract';

const token = '12345678-1234-4234-8234-123456789abc';
const request = () =>
  snapshotDocxRequest({
    schema: DOCX_REQUEST_SCHEMA,
    operationToken: token,
    title: 'Worker',
    rows: [{ role: 'user', htmlBody: '<p>Worker local content</p>' }],
    limits: DOCX_LIMITS,
  });
async function workerScope() {
  const scope = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  vi.stubGlobal('self', scope);
  await import('../../src/text-preview/docx-worker');
  return scope;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('DOCX one-shot module worker entry', () => {
  it('renders once, transfers ArrayBuffer ownership, and closes immediately', async () => {
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
    const result = snapshotDocxReply(received, input);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(new Uint8Array(result.bytes).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
    expect(scope.postMessage).toHaveBeenCalledTimes(1);
  });
  it('returns stable value-free failure for an invalid request with a valid token, then closes', async () => {
    const scope = await workerScope();
    scope.onmessage!(
      new MessageEvent('message', {
        data: { ...request(), rows: [{ role: 'user', htmlBody: '<script>private body</script>' }] },
      })
    );
    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledTimes(1));
    expect(scope.postMessage).toHaveBeenCalledWith(
      {
        schema: 'liska-docx-result/1',
        operationToken: token,
        ok: false,
        error: 'docx-html-invalid',
      },
      []
    );
    expect(JSON.stringify(scope.postMessage.mock.calls)).not.toContain('private body');
  });
  it('refuses extra fields without accepting caller code or XML overrides', async () => {
    const scope = await workerScope();
    scope.onmessage!(
      new MessageEvent('message', { data: { ...request(), overrides: '<private/>' } })
    );
    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledTimes(1));
    expect(scope.postMessage).toHaveBeenCalledWith(
      {
        schema: 'liska-docx-result/1',
        operationToken: token,
        ok: false,
        error: 'docx-input-invalid',
      },
      []
    );
  });
  it('never invokes token accessors and closes silently for a malformed token', async () => {
    const scope = await workerScope();
    const getter = vi.fn(() => token);
    const input = { ...request() };
    Object.defineProperty(input, 'operationToken', { get: getter, enumerable: true });
    scope.onmessage!(new MessageEvent('message', { data: input }));
    await vi.waitFor(() => expect(scope.close).toHaveBeenCalledTimes(1));
    expect(getter).not.toHaveBeenCalled();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });
});
