// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DOCX_LIMITS,
  DOCX_REQUEST_SCHEMA,
  DOCX_RESULT_SCHEMA,
  resolveDocxLimits,
  snapshotDocxRequest,
  snapshotDocxReply,
  type DocxLimits,
} from '../../src/text-preview/docx-contract';
import { renderDocxRequest } from '../../src/text-preview/docx-core';

const token = '12345678-1234-4234-8234-123456789abc';
const wire = () => ({
  schema: DOCX_REQUEST_SCHEMA,
  operationToken: token,
  title: 'Title',
  rows: [{ role: 'user', htmlBody: '<p>hello</p>' }],
  limits: { ...DOCX_LIMITS },
});

describe('DOCX exact local contracts', () => {
  it('takes a frozen, detached, exact selected-row request', () => {
    const value = wire();
    const request = snapshotDocxRequest(value);
    value.rows[0].htmlBody = 'mutated';
    value.limits.maxRows = 2;
    expect(request.rows[0].htmlBody).toBe('<p>hello</p>');
    expect(request.limits.maxRows).toBe(DOCX_LIMITS.maxRows);
    for (const item of [request, request.rows, request.rows[0], request.limits])
      expect(Object.isFrozen(item)).toBe(true);
    expect(Object.keys(request.rows[0])).toEqual(['role', 'htmlBody']);
  });
  it.each(['archive', 'markdownBody', 'destination', 'profile', 'sourceRefs', 'xmlOverrides'])(
    'refuses extra request authority %s',
    key => {
      expect(() => snapshotDocxRequest({ ...wire(), [key]: null })).toThrow('docx-input-invalid');
      expect(() =>
        snapshotDocxRequest({ ...wire(), rows: [{ ...wire().rows[0], [key]: null }] })
      ).toThrow('docx-input-invalid');
    }
  );
  it('refuses accessors, holes, symbol fields, prototypes, traps and incorrect schema/token/role', () => {
    const getter = vi.fn(() => 'secret');
    const accessor = { ...wire() };
    Object.defineProperty(accessor, 'title', { enumerable: true, get: getter });
    for (const value of [
      accessor,
      { ...wire(), [Symbol('extra')]: 1 },
      Object.assign(Object.create(null), wire()),
      new Proxy(wire(), {
        ownKeys() {
          throw new Error('private');
        },
      }),
      { ...wire(), schema: 'future/2' },
      { ...wire(), operationToken: 'bad' },
      { ...wire(), title: undefined },
      { ...wire(), title: 'x'.repeat(64 * 1024 + 1) },
      { ...wire(), rows: [{ role: 'tool', htmlBody: '' }] },
    ])
      expect(() => snapshotDocxRequest(value)).toThrow('docx-input-invalid');
    expect(getter).not.toHaveBeenCalled();
    expect(() => snapshotDocxRequest({ ...wire(), rows: [, wire().rows[0]] })).toThrow(
      'docx-row-limit'
    );
    expect(() => snapshotDocxRequest({ ...wire(), rows: [] })).toThrow('docx-selection-invalid');
    expect(() => snapshotDocxRequest({ ...wire(), limits: undefined })).toThrow(
      'docx-limits-invalid'
    );
    const get = vi.fn(() => {
      throw new Error('private');
    });
    expect(
      snapshotDocxRequest(new Proxy({ ...wire(), rows: new Proxy(wire().rows, { get }) }, { get }))
        .rows
    ).toHaveLength(1);
    expect(get).not.toHaveBeenCalled();
  });
  it('has independently lowering-only limits, including the deadline', () => {
    expect(resolveDocxLimits()).toEqual(DOCX_LIMITS);
    for (const key of Object.keys(DOCX_LIMITS) as (keyof DocxLimits)[]) {
      expect(resolveDocxLimits({ [key]: 1 })[key]).toBe(1);
      for (const value of [0, -1, 1.5, NaN, Infinity, DOCX_LIMITS[key] + 1])
        expect(() => resolveDocxLimits({ [key]: value })).toThrow('docx-limits-invalid');
    }
    expect(() => resolveDocxLimits({ unknown: 1 })).toThrow('docx-limits-invalid');
    expect(() =>
      snapshotDocxRequest({
        ...wire(),
        rows: [wire().rows[0], wire().rows[0]],
        limits: { ...DOCX_LIMITS, maxRows: 1 },
      })
    ).toThrow('docx-row-limit');
    expect(() =>
      snapshotDocxRequest({ ...wire(), limits: { ...DOCX_LIMITS, maxHtmlChars: 11 } })
    ).toThrow('docx-html-char-limit');
  });
  it('adopts only exact, bounded, token-bound transferable ArrayBuffer results', async () => {
    const request = snapshotDocxRequest(wire());
    const result = await renderDocxRequest(request);
    const adopted = snapshotDocxReply(result, request);
    expect(adopted).toEqual(result);
    for (const value of [
      { ...result, saved: true },
      { ...result, operationToken: token.replace(/c$/, 'd') },
      { ...result, ok: 1 },
      { ...result, bytes: new Uint8Array(1) },
      { ...result, bytes: new SharedArrayBuffer(1) },
      { ...result, bytes: new ArrayBuffer(0) },
      { ...result, counts: { ...result.counts, messageCount: 0 } },
      { ...result, counts: { ...result.counts, runs: Infinity } },
      { ...result, diagnostics: [{ code: 'future-code', count: 1 }] },
      { ...result, diagnostics: [{ code: 'links-literalized', count: 1 }] },
    ])
      expect(() => snapshotDocxReply(value, request)).toThrow('docx-result-invalid');
    const detached = new ArrayBuffer(4);
    structuredClone(detached, { transfer: [detached] });
    expect(() => snapshotDocxReply({ ...result, bytes: detached }, request)).toThrow(
      'docx-result-invalid'
    );
    const overflow = snapshotDocxRequest({
      ...wire(),
      limits: { ...DOCX_LIMITS, maxOutputBytes: 1 },
    });
    expect(() => snapshotDocxReply(result, overflow)).toThrow('docx-output-limit');
    expect(
      snapshotDocxReply(
        { schema: DOCX_RESULT_SCHEMA, operationToken: token, ok: false, error: 'docx-pack-failed' },
        request
      )
    ).toMatchObject({ ok: false, error: 'docx-pack-failed' });
    expect(() =>
      snapshotDocxReply(
        {
          schema: DOCX_RESULT_SCHEMA,
          operationToken: token,
          ok: false,
          error: 'private upstream error',
        },
        request
      )
    ).toThrow('docx-result-invalid');
  });
});
