// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  PDF_ERROR_CODES,
  PDF_LIMITS,
  PDF_REQUEST_SCHEMA,
  PDF_RESULT_SCHEMA,
  PdfRenderError,
  pdfGuard,
  resolvePdfLimits,
  snapshotPdfReply,
  snapshotPdfRequest,
} from '../../src/text-preview/pdf-contract';

const input = () => ({
  schema: PDF_REQUEST_SCHEMA,
  operationToken: '12345678-1234-4234-8234-123456789abc',
  title: 'PDF',
  rows: [{ role: 'user', htmlBody: '<p>x</p>' }],
  limits: PDF_LIMITS,
});
const reply = () => ({
  schema: PDF_RESULT_SCHEMA,
  operationToken: input().operationToken,
  ok: true,
  bytes: new ArrayBuffer(12),
  pageCount: 1,
  counts: {
    messageCount: 1,
    htmlChars: 8,
    codePoints: 20,
    tokens: 3,
    maxDepth: 1,
    maxListDepth: 0,
    layoutNodes: 8,
    layoutVisits: 4,
    blocks: 4,
    runs: 4,
    maxPreCodePoints: 0,
    maxPreLineCodePoints: 0,
    links: 0,
    placeholders: 0,
    tabs: 0,
    emojiClusters: 0,
  },
  diagnostics: [],
});
describe('PDF exact isolated request/reply contracts', () => {
  it('snapshots descriptor-only exact records/arrays without retaining mutable caller values', () => {
    const raw = input();
    const value = snapshotPdfRequest(raw);
    raw.title = 'changed';
    raw.rows[0].htmlBody = 'changed';
    expect(value.title).toBe('PDF');
    expect(value.rows[0].htmlBody).toBe('<p>x</p>');
    for (const item of [value, value.rows, value.rows[0], value.limits])
      expect(Object.isFrozen(item)).toBe(true);
    expect(resolvePdfLimits()).toEqual(PDF_LIMITS);
    expect(resolvePdfLimits({ maxRows: 1 })).toEqual({ ...PDF_LIMITS, maxRows: 1 });
  });
  it.each([0, -1, 1.5, NaN, Infinity, '1', undefined])('refuses invalid/larger limit %s', bad => {
    expect(() => resolvePdfLimits({ maxRows: bad })).toThrow('pdf-limits-invalid');
  });
  it('refuses larger limits, unknown keys, nonplain descriptors and missing dimensions', () => {
    expect(() => resolvePdfLimits({ maxPages: PDF_LIMITS.maxPages + 1 })).toThrow(
      'pdf-limits-invalid'
    );
    expect(() => resolvePdfLimits({ extra: 1 })).toThrow('pdf-limits-invalid');
    expect(() => snapshotPdfRequest({ ...input(), limits: { maxRows: 1 } })).toThrow(
      'pdf-limits-invalid'
    );
    expect(() => snapshotPdfRequest({ ...input(), rows: [] })).toThrow('pdf-selection-invalid');
    expect(() =>
      snapshotPdfRequest({
        ...input(),
        rows: [...input().rows, ...input().rows],
        limits: { ...PDF_LIMITS, maxRows: 1 },
      })
    ).toThrow('pdf-row-limit');
    expect(() =>
      snapshotPdfRequest({ ...input(), limits: { ...PDF_LIMITS, maxHtmlChars: 1 } })
    ).toThrow('pdf-html-char-limit');
  });
  it('never invokes caller getters and rejects accessors, inherited keys, sparse arrays, symbols and extra fields', () => {
    const getter = vi.fn(() => input().operationToken);
    const accessor = { ...input() };
    Object.defineProperty(accessor, 'operationToken', { enumerable: true, get: getter });
    const sparse = new Array(1);
    const symbol = { ...input(), [Symbol('extra')]: true };
    const hidden = { ...input() };
    Object.defineProperty(hidden, 'title', { value: 'hidden', enumerable: false });
    for (const bad of [
      accessor,
      symbol,
      hidden,
      Object.assign(Object.create({}), input()),
      { ...input(), extra: true },
      { ...input(), rows: [{ role: 'tool', htmlBody: 'x' }] },
      { ...input(), rows: [{ role: 'user', htmlBody: 'x', extra: true }] },
      { ...input(), title: 'x'.repeat(65537) },
      { ...input(), operationToken: 'bad' },
    ])
      expect(() => snapshotPdfRequest(bad)).toThrow('pdf-input-invalid');
    expect(() => snapshotPdfRequest({ ...input(), rows: sparse })).toThrow('pdf-row-limit');
    expect(getter).not.toHaveBeenCalled();
  });
  it('adopts only exact finite result counts, diagnostics, page count and owned ArrayBuffer shape', () => {
    const request = snapshotPdfRequest(input());
    const valid = reply();
    const adopted = snapshotPdfReply(valid, request);
    expect(adopted.ok).toBe(true);
    expect(Object.isFrozen(adopted)).toBe(true);
    for (const patch of [
      { extra: true },
      { pageCount: 0 },
      { pageCount: 1.5 },
      { bytes: new Uint8Array(12) },
      { operationToken: 'different' },
      { diagnostics: [{ code: 'links-literalized', count: 1 }] },
      { counts: { ...valid.counts, messageCount: 2 } },
      { counts: { ...valid.counts, htmlChars: 7 } },
      { counts: { ...valid.counts, runs: -1 } },
      { counts: { ...valid.counts, layoutVisits: PDF_LIMITS.maxLayoutNodes + 1 } },
      { counts: { ...valid.counts, emojiClusters: 21 } },
      { ok: 'true' },
    ])
      expect(() => snapshotPdfReply({ ...valid, ...patch }, request)).toThrow('pdf-result-invalid');
    expect(() =>
      snapshotPdfReply({ ...valid, bytes: new ArrayBuffer(PDF_LIMITS.maxOutputBytes + 1) }, request)
    ).toThrow('pdf-output-limit');
    expect(() =>
      snapshotPdfReply({ ...valid, pageCount: PDF_LIMITS.maxPages + 1 }, request)
    ).toThrow('pdf-page-limit');
    const custom = new ArrayBuffer(12);
    Object.defineProperty(custom, 'extra', { value: 1 });
    expect(() => snapshotPdfReply({ ...valid, bytes: custom }, request)).toThrow(
      'pdf-result-invalid'
    );
  });
  it('keeps stable error codes and guards away native exception text', () => {
    const request = snapshotPdfRequest(input());
    for (const error of PDF_ERROR_CODES)
      expect(
        snapshotPdfReply(
          { schema: PDF_RESULT_SCHEMA, operationToken: request.operationToken, ok: false, error },
          request
        )
      ).toEqual({
        schema: PDF_RESULT_SCHEMA,
        operationToken: request.operationToken,
        ok: false,
        error,
      });
    expect(() =>
      snapshotPdfReply(
        {
          schema: PDF_RESULT_SCHEMA,
          operationToken: request.operationToken,
          ok: false,
          error: 'private stack',
        },
        request
      )
    ).toThrow('pdf-result-invalid');
    expect(() =>
      pdfGuard(() => {
        throw new Error('private');
      }, 'pdf-input-invalid')
    ).toThrow('pdf-input-invalid');
    expect(() =>
      pdfGuard(() => {
        throw new PdfRenderError('pdf-deadline');
      }, 'pdf-input-invalid')
    ).toThrow('pdf-deadline');
  });
});
